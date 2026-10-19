<?php
declare(strict_types=1);
namespace Hospital\Modules\Doctors;
use Hospital\Http\ApiException;
use Hospital\Modules\Auth\UserRepository;
use Hospital\Modules\Patients\PatientService;
use Hospital\Modules\Patients\PatientInput;
use Hospital\Modules\Transfers\TransferAccess;

final class DoctorService
{
    private \PDO $db;
    private array $config;
    public function __construct(\PDO $db,array $config) { $this->db=$db; $this->config=$config; }
    public function access(string $actor): void { (new PatientService($this->db,$this->config))->access($actor); }
    private function transaction(string $actor,callable $work)
    {
        return (new TransferAccess($this->db,$this->config))->serialized(function() use($actor,$work) {
            $this->db->beginTransaction();
            try {
                $u=(new UserRepository($this->db))->byId($actor,true);
                if (!$u || $u['status']!=='active' || $u['staff_status']!=='active' || (int)$u['auth_version']!==(int)($_SESSION['auth_version']??0)) throw new ApiException(401,'SESSION_EXPIRED','La sesión ya no tiene acceso.');
                $this->access($actor); $result=$work(); $this->db->commit(); return $result;
            } catch (\Throwable $e) {
                if ($this->db->inTransaction()) $this->db->rollBack();
                if ($e instanceof \PDOException && ($e->errorInfo[1]??0)===1062) throw new ApiException(409,'DOCTOR_CONFLICT','Ya existe un médico con ese documento o registro MSP.');
                throw $e;
            }
        });
    }
    private function query(): string
    {
        return 'SELECT d.*,s.version AS staff_version,s.full_name,s.national_id,s.status AS staff_status,sp.name AS specialty,dep.name AS department FROM doctor_profiles d JOIN staff s ON s.id=d.staff_id JOIN specialties sp ON sp.id=d.specialty_id JOIN departments dep ON dep.id=d.department_id';
    }
    private function serialize(array $r): array
    {
        $r['id']=(string)$r['staff_id']; unset($r['staff_id']);
        $r['specialty_id']=(string)$r['specialty_id']; $r['department_id']=(string)$r['department_id']; $r['version']=(int)$r['version']+(int)$r['staff_version']; unset($r['staff_version']);
        foreach (['start_time','end_time'] as $key) $r[$key]=$r[$key]===null?null:substr($r[$key],0,5);
        foreach (['created_at','updated_at','archived_at'] as $key) $r[$key]=$r[$key]===null?null:UserRepository::date($r[$key]);
        return $r;
    }
    public function listing(string $actor): array
    {
        $this->access($actor);
        // The school directory is small; retain the existing browser filters/pagination.
        return array_map(fn(array $r):array=>$this->serialize($r),$this->db->query($this->query().' ORDER BY s.full_name,s.id')->fetchAll());
    }
    public function get(string $actor,string $id): array
    {
        $this->access($actor); $s=$this->db->prepare($this->query().' WHERE d.staff_id=?'); $s->execute([$id]); $r=$s->fetch();
        if (!$r) throw new ApiException(404,'DOCTOR_NOT_FOUND','No se encontró el médico.');
        return $this->serialize($r);
    }
    public function catalogs(string $actor): array
    {
        $this->access($actor);
        return ['specialties'=>$this->db->query("SELECT name FROM specialties WHERE status='active' ORDER BY name")->fetchAll(\PDO::FETCH_COLUMN),'departments'=>$this->db->query("SELECT name FROM departments WHERE status='active' ORDER BY name")->fetchAll(\PDO::FETCH_COLUMN)];
    }
    private function lock(string $id,int $version): array
    {
        $s=$this->db->prepare('SELECT d.*,s.version AS staff_version FROM doctor_profiles d JOIN staff s ON s.id=d.staff_id WHERE d.staff_id=? FOR UPDATE'); $s->execute([$id]); $r=$s->fetch();
        if (!$r) throw new ApiException(404,'DOCTOR_NOT_FOUND','No se encontró el médico.');
        if ((int)$r['version']+(int)$r['staff_version']!==$version) throw new ApiException(409,'VERSION_CONFLICT','El médico cambió. Volvé a abrirlo antes de guardar.');
        return $r;
    }
    private function checkTransfer(string $id): void
    {
        $s=$this->db->prepare("SELECT t.id FROM transfers t JOIN transfer_crew c ON c.transfer_id=t.id WHERE c.staff_id=? AND c.responsibility='doctor' AND t.status NOT IN ('completed','cancelled') LIMIT 1"); $s->execute([$id]);
        if ($s->fetchColumn()) throw new ApiException(409,'DOCTOR_IN_USE','El médico tiene un traslado pendiente o en curso.');
    }
    private function catalogId(string $table,string $name): string
    {
        // Table names are internal constants; labels are always bound parameters.
        $s=$this->db->prepare("INSERT INTO $table (name) VALUES (?) ON DUPLICATE KEY UPDATE id=LAST_INSERT_ID(id)"); $s->execute([$name]); $id=$this->db->lastInsertId();
        $s=$this->db->prepare("SELECT status FROM $table WHERE id=?"); $s->execute([$id]);
        if ($s->fetchColumn()!=='active') throw new ApiException(422,'CATALOG_INACTIVE','Seleccioná una especialidad y un servicio activos.');
        return $id;
    }
    public function save(string $actor,array $input,?string $id=null): array
    {
        $f=DoctorInput::fields($input); $version=$id===null?null:PatientInput::version($input['version']??null);
        $id=$this->transaction($actor,function() use($actor,$f,$id,$version) {
            if ($id!==null) {
                $old=$this->lock($id,$version);
                if ($old['status']!=='active') throw new ApiException(409,'DOCTOR_ARCHIVED','Restaurá el médico antes de editarlo.');
                if ($f['availability']==='inactive') $this->checkTransfer($id);
                $s=$this->db->prepare('SELECT registration_national_id FROM users WHERE staff_id=?'); $s->execute([$id]); $ci=$s->fetchColumn();
                if ($ci!==false && $ci!==$f['national_id']) throw new ApiException(409,'IDENTITY_LINKED','El documento está vinculado a una cuenta y no puede cambiarse desde este directorio.');
            } else {
                $s=$this->db->prepare('SELECT id,status FROM staff WHERE national_id=? FOR UPDATE'); $s->execute([$f['national_id']]); $staff=$s->fetch();
                if ($staff) {
                    if ($staff['status']!=='active') throw new ApiException(409,'STAFF_INACTIVE','La identidad del personal está inactiva.');
                    $id=(string)$staff['id'];
                    $s=$this->db->prepare('SELECT staff_id FROM doctor_profiles WHERE staff_id=?'); $s->execute([$id]);
                    if ($s->fetchColumn()) throw new ApiException(409,'DOCTOR_CONFLICT','Ya existe un médico con ese documento; revisá también los inactivos.');
                } else {
                    $s=$this->db->prepare('INSERT INTO staff (national_id,full_name) VALUES (?,?)'); $s->execute([$f['national_id'],$f['full_name']]); $id=$this->db->lastInsertId();
                }
            }
            $s=$this->db->prepare('UPDATE staff SET national_id=?,full_name=?,version=version+1 WHERE id=?'); $s->execute([$f['national_id'],$f['full_name'],$id]);
            $specialty=$this->catalogId('specialties',$f['specialty']); $department=$this->catalogId('departments',$f['department']);
            $values=[$f['title'],$f['license'],$specialty,$department,$f['office'],$f['phone'],$f['email'],$f['availability'],$f['shift'],$f['days'],$f['start_time'],$f['end_time'],$f['notes'],$id];
            if ($version===null) {
                $s=$this->db->prepare('INSERT INTO doctor_profiles (title,license,specialty_id,department_id,office,phone,email,availability,shift,days,start_time,end_time,notes,staff_id) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)');
            } else {
                $s=$this->db->prepare('UPDATE doctor_profiles SET title=?,license=?,specialty_id=?,department_id=?,office=?,phone=?,email=?,availability=?,shift=?,days=?,start_time=?,end_time=?,notes=?,version=version+1 WHERE staff_id=?');
            }
            $s->execute($values);
            $s=$this->db->prepare("INSERT IGNORE INTO staff_roles (staff_id,role_code) VALUES (?,'doctor')"); $s->execute([$id]);
            (new TransferAccess($this->db,$this->config))->audit($actor,$version===null?'doctor.created':'doctor.updated',$id,'doctor');
            return $id;
        });
        return $this->get($actor,$id);
    }
    public function archive(string $actor,string $id,int $version,bool $restore=false): array
    {
        $this->transaction($actor,function() use($actor,$id,$version,$restore) {
            $old=$this->lock($id,$version); $state=$restore?'active':'archived';
            if ($old['status']===$state) throw new ApiException(409,'VERSION_CONFLICT','El estado del médico cambió.');
            if (!$restore) $this->checkTransfer($id);
            // Keep shared staff and existing encounter/crew references intact.
            $s=$this->db->prepare('UPDATE doctor_profiles SET status=?,archived_at=?,version=version+1 WHERE staff_id=?'); $s->execute([$state,$restore?null:gmdate('Y-m-d H:i:s'),$id]);
            (new TransferAccess($this->db,$this->config))->audit($actor,$restore?'doctor.restored':'doctor.archived',$id,'doctor');
        });
        return $this->get($actor,$id);
    }
}
