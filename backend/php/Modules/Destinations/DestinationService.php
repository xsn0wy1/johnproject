<?php
declare(strict_types=1);
namespace Hospital\Modules\Destinations;
use Hospital\Http\ApiException;
use Hospital\Modules\Auth\UserRepository;
use Hospital\Modules\Settings\SettingsService;
use Hospital\Modules\Transfers\TransferAccess;
use Hospital\Modules\Transfers\TransferInput;

final class DestinationService
{
    public const FIELDS=['name','address','locality','facility_type','phone','notes','availability'];
    private \PDO $db;
    private TransferAccess $access;
    public function __construct(\PDO $db,array $config) { $this->db=$db; $this->access=new TransferAccess($db,$config); }
    public function access(string $actor): void { $this->access->requireDispatch($actor); }
    private function transaction(string $actor,callable $work)
    {
        return $this->access->serialized(function() use($actor,$work) {
            $this->db->beginTransaction();
            try { $this->access->actor($actor); $result=$work(); $this->db->commit(); return $result; }
            catch (\Throwable $e) {
                if ($this->db->inTransaction()) $this->db->rollBack();
                if ($e instanceof \PDOException && ($e->errorInfo[1]??0)===1062) throw new ApiException(409,'DESTINATION_CONFLICT',\Hospital\I18n::t("errors.ya_existe_ese_centro_con_la_misma_direccion_y_localidad_revisa_tambien_los_inactivos"));
                throw $e;
            }
        });
    }
    private function fields(array $input): array
    {
        $f=[];
        foreach (['name'=>100,'address'=>180,'locality'=>80,'phone'=>25] as $key=>$max) $f[$key]=SettingsService::text($input[$key]??null,$key,$max,$key==='phone');
        $digits=strlen(preg_replace('/\D/','',$f['phone']));
        if ($f['phone']!=='' && (!preg_match('/^\+?[0-9 ().-]+$/',$f['phone']) || $digits<8 || $digits>15)) throw new ApiException(422,'VALIDATION_FAILED',\Hospital\I18n::t("errors.ingresa_un_telefono_de_8_a_15_digitos_o_dejalo_vacio"));
        $f['facility_type']=TransferInput::choice($input['facility_type']??null,['hospital','sanatorium','health_center','other']);
        $f['availability']=TransferInput::choice($input['availability']??null,['active','inactive']);
        $f['notes']=TransferInput::notes($input['notes']??null);
        if (mb_strlen($f['notes'])>400) throw new ApiException(422,'VALIDATION_FAILED',\Hospital\I18n::t("errors.la_referencia_admite_hasta_400_caracteres"));
        return $f;
    }
    private function serialize(array $row): array
    {
        $row['id']=(string)$row['id']; $row['version']=(int)$row['version'];
        foreach (['latitude','longitude'] as $key) $row[$key]=$row[$key]===null?null:(float)$row[$key];
        foreach (['created_at','updated_at','archived_at'] as $key) $row[$key]=$row[$key]===null?null:UserRepository::date($row[$key]);
        return $row;
    }
    public function listing(string $actor): array
    {
        $this->access($actor);
        return array_map(fn(array $r):array=>$this->serialize($r),$this->db->query('SELECT * FROM facilities ORDER BY name,address,locality,id')->fetchAll());
    }
    public function get(string $actor,string $id): array
    {
        $this->access($actor); $s=$this->db->prepare('SELECT * FROM facilities WHERE id=?'); $s->execute([$id]); $row=$s->fetch();
        if (!$row) throw new ApiException(404,'DESTINATION_NOT_FOUND',\Hospital\I18n::t("errors.no_se_encontro_el_destino"));
        return $this->serialize($row);
    }
    private function lock(string $id,int $version): array
    {
        $s=$this->db->prepare('SELECT * FROM facilities WHERE id=? FOR UPDATE'); $s->execute([$id]); $row=$s->fetch();
        if (!$row) throw new ApiException(404,'DESTINATION_NOT_FOUND',\Hospital\I18n::t("errors.no_se_encontro_el_destino"));
        if ((int)$row['version']!==$version) throw new ApiException(409,'VERSION_CONFLICT',\Hospital\I18n::t("errors.el_destino_cambio_volve_a_abrirlo_antes_de_guardar"));
        return $row;
    }
    public function save(string $actor,array $input,?string $id=null): array
    {
        $f=$this->fields($input); $version=$id===null?null:TransferInput::version($input['version']??null);
        $id=$this->transaction($actor,function() use($actor,$f,$id,$version) {
            $values=[$f['name'],$f['address'],$f['locality'],$f['facility_type'],$f['phone'],$f['notes'],$f['availability']];
            if ($id===null) {
                $s=$this->db->prepare('INSERT INTO facilities (name,address,locality,facility_type,phone,notes,availability) VALUES (?,?,?,?,?,?,?)'); $s->execute($values); $id=$this->db->lastInsertId();
            } else {
                $old=$this->lock($id,$version);
                if ($old['status']!=='active') throw new ApiException(409,'DESTINATION_ARCHIVED',\Hospital\I18n::t("errors.restaura_el_destino_antes_de_editarlo"));
                // A changed address must not keep an old map location. Trace snapshots remain intact.
                $moved=$old['address']!==$f['address'] || $old['locality']!==$f['locality'];
                $values[]=$id;
                $s=$this->db->prepare('UPDATE facilities SET name=?,address=?,locality=?,facility_type=?,phone=?,notes=?,availability=?,version=version+1'.($moved?',latitude=NULL,longitude=NULL':'').' WHERE id=?'); $s->execute($values);
            }
            $this->access->audit($actor,$version===null?'destination.created':'destination.updated',$id,'facility'); return $id;
        });
        return $this->get($actor,$id);
    }
    public function archive(string $actor,string $id,int $version,bool $restore=false): array
    {
        $this->transaction($actor,function() use($actor,$id,$version,$restore) {
            $old=$this->lock($id,$version); $state=$restore?'active':'archived';
            if ($old['status']===$state) throw new ApiException(409,'VERSION_CONFLICT',\Hospital\I18n::t("errors.el_estado_del_destino_cambio"));
            $s=$this->db->prepare('UPDATE facilities SET status=?,archived_at=?,version=version+1 WHERE id=?'); $s->execute([$state,$restore?null:gmdate('Y-m-d H:i:s'),$id]);
            $this->access->audit($actor,$restore?'destination.restored':'destination.archived',$id,'facility');
        });
        return $this->get($actor,$id);
    }
}
