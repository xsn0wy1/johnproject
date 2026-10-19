<?php
declare(strict_types=1);
namespace Hospital\Modules\Ambulances;
use Hospital\Http\ApiException;
use Hospital\Modules\Auth\UserRepository;
use Hospital\Modules\Settings\SettingsService;
use Hospital\Modules\Transfers\TransferAccess;
use Hospital\Modules\Transfers\TransferInput;

final class AmbulanceService
{
    public const FIELDS = ['plate','model','capacity','operational_status'];
    private \PDO $db;
    private TransferAccess $access;
    public function __construct(\PDO $db,array $config) { $this->db=$db; $this->access=new TransferAccess($db,$config); }
    public function access(string $actor): void { $this->access->requireDispatch($actor); }
    private function transaction(string $actor,callable $work)
    {
        // Use the same lock as transfer bookings and the simulation worker.
        return $this->access->serialized(function() use($actor,$work) {
            $this->db->beginTransaction();
            try { $this->access->actor($actor); $result=$work(); $this->db->commit(); return $result; }
            catch (\Throwable $error) {
                if ($this->db->inTransaction()) $this->db->rollBack();
                if ($error instanceof \PDOException && ($error->errorInfo[1]??0)===1062) throw new ApiException(409,'AMBULANCE_CONFLICT',\Hospital\I18n::t("errors.ya_existe_una_ambulancia_con_esa_matricula_o_codigo_revisa_tambien_las_archivadas"));
                throw $error;
            }
        });
    }
    private function fields(array $input): array
    {
        $plate=strtoupper(preg_replace('/[\s-]/u','',SettingsService::text($input['plate']??null,'plate',20,false)));
        if (!preg_match('/^[A-Z0-9]{1,20}$/',$plate)) throw new ApiException(422,'VALIDATION_FAILED',\Hospital\I18n::t("errors.ingresa_una_matricula_valida"),['plate'=>\Hospital\I18n::t("errors.valor_no_valido")]);
        $model=SettingsService::text($input['model']??null,'model',100,false);
        $capacity=$input['capacity']??null;
        if ((!is_int($capacity) && !is_string($capacity)) || !preg_match('/^[1-9][0-9]?$/',(string)$capacity)) throw new ApiException(422,'VALIDATION_FAILED',\Hospital\I18n::t("errors.la_capacidad_debe_ser_de_1_a_99_plazas"),['capacity'=>\Hospital\I18n::t("errors.valor_no_valido")]);
        $status=TransferInput::choice($input['operational_status']??null,['available','maintenance','out_of_service']);
        return ['plate'=>$plate,'model'=>$model,'capacity'=>(int)$capacity,'operational_status'=>$status];
    }
    private function serialize(array $row): array
    {
        $row['id']=(string)$row['id']; $row['capacity']=(int)$row['capacity']; $row['version']=(int)$row['version'];
        foreach (['created_at','updated_at','archived_at'] as $key) $row[$key]=$row[$key]===null?null:UserRepository::date($row[$key]);
        return $row;
    }
    public function listing(string $actor): array
    {
        $this->access($actor);
        // The school fleet is small; retain existing browser search/pagination.
        return array_map(fn(array $row):array=>$this->serialize($row),$this->db->query('SELECT * FROM ambulances ORDER BY id DESC')->fetchAll());
    }
    public function get(string $actor,string $id): array
    {
        $this->access($actor); $s=$this->db->prepare('SELECT * FROM ambulances WHERE id=?'); $s->execute([$id]); $row=$s->fetch();
        if (!$row) throw new ApiException(404,'AMBULANCE_NOT_FOUND',\Hospital\I18n::t("errors.no_se_encontro_la_ambulancia"));
        return $this->serialize($row);
    }
    private function lock(string $id,int $version): array
    {
        $s=$this->db->prepare('SELECT * FROM ambulances WHERE id=? FOR UPDATE'); $s->execute([$id]); $row=$s->fetch();
        if (!$row) throw new ApiException(404,'AMBULANCE_NOT_FOUND',\Hospital\I18n::t("errors.no_se_encontro_la_ambulancia"));
        if ((int)$row['version']!==$version) throw new ApiException(409,'VERSION_CONFLICT',\Hospital\I18n::t("errors.la_ambulancia_cambio_volve_a_abrirla_antes_de_guardar"));
        return $row;
    }
    private function checkTransfers(string $id): void
    {
        $s=$this->db->prepare("SELECT id FROM transfers WHERE ambulance_id=? AND status NOT IN ('completed','cancelled') LIMIT 1"); $s->execute([$id]);
        if ($s->fetchColumn()) throw new ApiException(409,'AMBULANCE_IN_USE',\Hospital\I18n::t("errors.la_ambulancia_tiene_un_traslado_pendiente_o_en_curso"));
    }
    public function save(string $actor,array $input,?string $id=null): array
    {
        $f=$this->fields($input); $version=$id===null?null:TransferInput::version($input['version']??null);
        $id=$this->transaction($actor,function() use($actor,$id,$f,$version) {
            if ($id===null) {
                // Allocate the ID first, then give the unit a stable display code.
                $s=$this->db->prepare('INSERT INTO ambulances (code,plate,model,capacity,operational_status) VALUES (?,?,?,?,?)');
                $s->execute(['NEW-'.bin2hex(random_bytes(6)),$f['plate'],$f['model'],$f['capacity'],$f['operational_status']]); $id=$this->db->lastInsertId();
                $s=$this->db->prepare('UPDATE ambulances SET code=? WHERE id=?'); $s->execute(['AMB-'.str_pad($id,6,'0',STR_PAD_LEFT),$id]);
            } else {
                $old=$this->lock($id,$version);
                if ($old['status']!=='active') throw new ApiException(409,'AMBULANCE_ARCHIVED',\Hospital\I18n::t("errors.restaura_la_ambulancia_antes_de_editarla"));
                if ($f['operational_status']!=='available') $this->checkTransfers($id);
                $s=$this->db->prepare('UPDATE ambulances SET plate=?,model=?,capacity=?,operational_status=?,version=version+1 WHERE id=?');
                $s->execute([$f['plate'],$f['model'],$f['capacity'],$f['operational_status'],$id]);
            }
            $this->access->audit($actor,$version===null?'ambulance.created':'ambulance.updated',$id,'ambulance'); return $id;
        });
        return $this->get($actor,$id);
    }
    public function archive(string $actor,string $id,int $version,bool $restore=false): array
    {
        $this->transaction($actor,function() use($actor,$id,$version,$restore) {
            $old=$this->lock($id,$version); $state=$restore?'active':'archived';
            if ($old['status']===$state) throw new ApiException(409,'VERSION_CONFLICT',\Hospital\I18n::t("errors.el_estado_de_la_ambulancia_cambio"));
            if (!$restore) $this->checkTransfers($id);
            $s=$this->db->prepare('UPDATE ambulances SET status=?,archived_at=?,version=version+1 WHERE id=?'); $s->execute([$state,$restore?null:gmdate('Y-m-d H:i:s'),$id]);
            $this->access->audit($actor,$restore?'ambulance.restored':'ambulance.archived',$id,'ambulance');
        });
        return $this->get($actor,$id);
    }
}
