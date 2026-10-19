<?php
declare(strict_types=1);
namespace Hospital\Modules\Personnel;
use Hospital\Http\ApiException;
use Hospital\Modules\Auth\UserRepository;
use Hospital\Modules\Patients\PatientInput;
use Hospital\Modules\Transfers\TransferAccess;
use Hospital\Modules\Transfers\TransferInput;

final class PersonnelService
{
    public const FIELDS = ['full_name','national_id','phone','responsibility','driving_license','availability'];
    private \PDO $db;
    private TransferAccess $access;
    public function __construct(\PDO $db,array $config) { $this->db=$db; $this->access=new TransferAccess($db,$config); }
    public function access(string $actor): void { $this->access->requireDispatch($actor); }
    private function transaction(string $actor,callable $work)
    {
        return $this->access->serialized(function() use($actor,$work) {
            $this->db->beginTransaction();
            try { $this->access->actor($actor); $result=$work(); $this->db->commit(); return $result; }
            catch (\Throwable $error) {
                if ($this->db->inTransaction()) $this->db->rollBack();
                if ($error instanceof \PDOException && ($error->errorInfo[1]??0)===1062) throw new ApiException(409,'PERSONNEL_CONFLICT',\Hospital\I18n::t("errors.ya_existe_un_registro_con_ese_documento_o_licencia_revisa_tambien_los_archivados"));
                throw $error;
            }
        });
    }
    private function fields(array $input): array
    {
        $f=['full_name'=>PatientInput::text($input['full_name']??null,'full_name',100,false),'national_id'=>PatientInput::identity($input['national_id']??null),
            'phone'=>PatientInput::phone($input['phone']??null,'phone'),'responsibility'=>TransferInput::choice($input['responsibility']??null,['driver','copilot']),
            'availability'=>TransferInput::choice($input['availability']??null,['active','inactive'])];
        if (strlen(preg_replace('/\D/','',$f['phone']))<8) throw new ApiException(422,'VALIDATION_FAILED',\Hospital\I18n::t("errors.ingresa_un_telefono_valido"));
        $license=strtoupper(preg_replace('/[\s.-]/u','',PatientInput::text($input['driving_license']??null,'driving_license',30)));
        if (($f['responsibility']==='driver' && $license==='') || ($license!=='' && !preg_match('/^[A-Z0-9]{2,30}$/',$license))) throw new ApiException(422,'VALIDATION_FAILED',\Hospital\I18n::t("errors.ingresa_una_licencia_valida_para_el_chofer"));
        $f['driving_license']=$license===''?null:$license;
        return $f;
    }
    private function query(): string
    {
        // Include legacy crew imported before personnel profiles existed.
        return "SELECT s.id,s.full_name,s.national_id,s.phone,s.status AS staff_status,s.version AS staff_version,
            COALESCE(p.responsibility,CASE WHEN EXISTS(SELECT 1 FROM staff_roles r WHERE r.staff_id=s.id AND r.role_code='driver') THEN 'driver' ELSE 'copilot' END) AS responsibility,
            p.driving_license,p.availability,p.status,p.version,p.archived_at
            FROM staff s LEFT JOIN personnel_profiles p ON p.staff_id=s.id
            WHERE (p.staff_id IS NOT NULL OR EXISTS(SELECT 1 FROM staff_roles r WHERE r.staff_id=s.id AND r.role_code IN ('driver','copilot')))";
    }
    private function serialize(array $r): array
    {
        $r['id']=(string)$r['id']; $r['version']=(int)($r['version']??0)+(int)$r['staff_version']; unset($r['staff_version']);
        $r['phone']=$r['phone']??''; $r['driving_license']=$r['driving_license']??'';
        $r['availability']=$r['availability']??'active'; $r['status']=$r['status']??'active';
        $r['archived_at']=$r['archived_at']===null?null:UserRepository::date($r['archived_at']);
        return $r;
    }
    public function listing(string $actor): array
    {
        $this->access($actor);
        return array_map(fn(array $r):array=>$this->serialize($r),$this->db->query($this->query().' ORDER BY s.full_name,s.id')->fetchAll());
    }
    public function get(string $actor,string $id): array
    {
        $this->access($actor); $s=$this->db->prepare($this->query().' AND s.id=?'); $s->execute([$id]); $r=$s->fetch();
        if (!$r) throw new ApiException(404,'PERSONNEL_NOT_FOUND',\Hospital\I18n::t("errors.no_se_encontro_el_registro_de_personal"));
        return $this->serialize($r);
    }
    private function lock(string $id,int $version): array
    {
        $s=$this->db->prepare('SELECT * FROM staff WHERE id=? FOR UPDATE'); $s->execute([$id]); $staff=$s->fetch();
        if (!$staff) throw new ApiException(404,'PERSONNEL_NOT_FOUND',\Hospital\I18n::t("errors.no_se_encontro_el_registro_de_personal"));
        $s=$this->db->prepare('SELECT * FROM personnel_profiles WHERE staff_id=? FOR UPDATE'); $s->execute([$id]); $profile=$s->fetch();
        $s=$this->db->prepare("SELECT role_code FROM staff_roles WHERE staff_id=? AND role_code IN ('driver','copilot') ORDER BY role_code"); $s->execute([$id]); $roles=$s->fetchAll(\PDO::FETCH_COLUMN);
        if (!$profile && !$roles) throw new ApiException(404,'PERSONNEL_NOT_FOUND',\Hospital\I18n::t("errors.no_se_encontro_el_registro_de_personal"));
        if ((int)($profile['version']??0)+(int)$staff['version']!==$version) throw new ApiException(409,'VERSION_CONFLICT',\Hospital\I18n::t("errors.el_registro_cambio_volve_a_abrirlo_antes_de_guardar"));
        return ['staff'=>$staff,'profile'=>$profile,'roles'=>$roles];
    }
    private function checkTransfers(string $id): void
    {
        $s=$this->db->prepare("SELECT t.id FROM transfers t JOIN transfer_crew c ON c.transfer_id=t.id WHERE c.staff_id=? AND c.responsibility IN ('driver','copilot') AND t.status NOT IN ('completed','cancelled') LIMIT 1"); $s->execute([$id]);
        if ($s->fetchColumn()) throw new ApiException(409,'PERSONNEL_IN_USE',\Hospital\I18n::t("errors.el_personal_tiene_un_traslado_pendiente_o_en_curso"));
    }
    public function save(string $actor,array $input,?string $id=null): array
    {
        $f=$this->fields($input); $version=$id===null?null:TransferInput::version($input['version']??null);
        $id=$this->transaction($actor,function() use($actor,$f,$id,$version) {
            if ($id===null) {
                $profileExists=false;
                $s=$this->db->prepare('SELECT id,status FROM staff WHERE national_id=? FOR UPDATE'); $s->execute([$f['national_id']]); $staff=$s->fetch();
                if ($staff) {
                    $id=(string)$staff['id'];
                    if ($staff['status']!=='active') throw new ApiException(409,'STAFF_INACTIVE',\Hospital\I18n::t("errors.la_identidad_del_personal_esta_inactiva"));
                    $s=$this->db->prepare("SELECT id FROM staff WHERE id=? AND (EXISTS(SELECT 1 FROM personnel_profiles WHERE staff_id=staff.id) OR EXISTS(SELECT 1 FROM staff_roles WHERE staff_id=staff.id AND role_code IN ('driver','copilot')))"); $s->execute([$id]);
                    if ($s->fetchColumn()) throw new ApiException(409,'PERSONNEL_CONFLICT',\Hospital\I18n::t("errors.el_personal_ya_esta_registrado_abrilo_desde_el_listado_para_editarlo"));
                } else {
                    $s=$this->db->prepare('INSERT INTO staff (full_name,national_id) VALUES (?,?)'); $s->execute([$f['full_name'],$f['national_id']]); $id=$this->db->lastInsertId();
                }
            } else {
                $old=$this->lock($id,$version); $profileExists=(bool)$old['profile'];
                if (($old['profile']['status']??'active')!=='active') throw new ApiException(409,'PERSONNEL_ARCHIVED',\Hospital\I18n::t("errors.restaura_el_registro_antes_de_editarlo"));
                if ($f['availability']==='inactive' || array_diff($old['roles'],[$f['responsibility']])) $this->checkTransfers($id);
                $s=$this->db->prepare('SELECT registration_national_id FROM users WHERE staff_id=?'); $s->execute([$id]); $ci=$s->fetchColumn();
                if ($ci!==false && $ci!==$f['national_id']) throw new ApiException(409,'IDENTITY_LINKED',\Hospital\I18n::t("errors.el_documento_esta_vinculado_a_una_cuenta_y_no_puede_cambiarse_desde_este_directorio"));
            }
            $s=$this->db->prepare('UPDATE staff SET full_name=?,national_id=?,phone=?,version=version+1 WHERE id=?'); $s->execute([$f['full_name'],$f['national_id'],$f['phone'],$id]);
            if ($profileExists) {
                $s=$this->db->prepare('UPDATE personnel_profiles SET responsibility=?,driving_license=?,availability=?,version=version+1 WHERE staff_id=?');
                $s->execute([$f['responsibility'],$f['driving_license'],$f['availability'],$id]);
            } else {
                $s=$this->db->prepare('INSERT INTO personnel_profiles (staff_id,responsibility,driving_license,availability) VALUES (?,?,?,?)');
                $s->execute([$id,$f['responsibility'],$f['driving_license'],$f['availability']]);
            }
            // The form owns crew responsibilities only; preserve doctor/account roles.
            $s=$this->db->prepare("DELETE FROM staff_roles WHERE staff_id=? AND role_code IN ('driver','copilot')"); $s->execute([$id]);
            $s=$this->db->prepare('INSERT INTO staff_roles (staff_id,role_code) VALUES (?,?)'); $s->execute([$id,$f['responsibility']]);
            $this->access->audit($actor,$version===null?'personnel.created':'personnel.updated',$id,'personnel'); return $id;
        });
        return $this->get($actor,$id);
    }
    public function archive(string $actor,string $id,int $version,bool $restore=false): array
    {
        $this->transaction($actor,function() use($actor,$id,$version,$restore) {
            $old=$this->lock($id,$version); $state=$restore?'active':'archived';
            if (($old['profile']['status']??'active')===$state) throw new ApiException(409,'VERSION_CONFLICT',\Hospital\I18n::t("errors.el_estado_del_registro_cambio"));
            if (!$restore) $this->checkTransfers($id);
            if (!$old['profile']) {
                $role=in_array('driver',$old['roles'],true)?'driver':'copilot';
                $s=$this->db->prepare('INSERT INTO personnel_profiles (staff_id,responsibility) VALUES (?,?)'); $s->execute([$id,$role]);
            }
            $s=$this->db->prepare('UPDATE personnel_profiles SET status=?,archived_at=?,version=version+1 WHERE staff_id=?'); $s->execute([$state,$restore?null:gmdate('Y-m-d H:i:s'),$id]);
            $this->access->audit($actor,$restore?'personnel.restored':'personnel.archived',$id,'personnel');
        });
        return $this->get($actor,$id);
    }
}
