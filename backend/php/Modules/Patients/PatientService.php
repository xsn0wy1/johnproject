<?php
declare(strict_types=1);
namespace Hospital\Modules\Patients;
use Hospital\Http\ApiException;
use Hospital\Http\Request;
use Hospital\Modules\Auth\UserRepository;
use Hospital\Modules\Transfers\TransferAccess;

final class PatientService
{
    private \PDO $db;
    private array $config;
    public function __construct(\PDO $db,array $config) { $this->db=$db; $this->config=$config; }
    public function access(string $actor): void
    {
        if (!in_array('records_manager',(new UserRepository($this->db))->roles($actor),true)) throw new ApiException(403,'FORBIDDEN','Se requiere permiso de gestión de registros.');
    }
    private function actor(?string $actor): void
    {
        if ($actor===null) return; // Trusted local CLI only; HTTP always supplies an ID.
        $u=(new UserRepository($this->db))->byId($actor,true);
        if (!$u || $u['status']!=='active' || $u['staff_status']!=='active' || (int)$u['auth_version']!==(int)($_SESSION['auth_version']??0)) throw new ApiException(401,'SESSION_EXPIRED','La sesión ya no tiene acceso.');
        $this->access($actor);
    }
    private function audit(?string $actor,string $action,string $id): void { (new TransferAccess($this->db,$this->config))->audit($actor,$action,$id,'patient'); }
    private function transaction(?string $actor,callable $work)
    {
        return (new TransferAccess($this->db,$this->config))->serialized(function() use($actor,$work) {
            $this->db->beginTransaction();
            try { $this->actor($actor); $result=$work(); $this->db->commit(); return $result; }
            catch (\Throwable $error) {
                if ($this->db->inTransaction()) $this->db->rollBack();
                if ($error instanceof \PDOException && ($error->errorInfo[1]??0)===1062) throw new ApiException(409,'PATIENT_CONFLICT','Ya existe un registro con ese documento.');
                throw $error;
            }
        });
    }
    private function lock(string $id,?int $version=null): array
    {
        $s=$this->db->prepare('SELECT * FROM patients WHERE id=? FOR UPDATE'); $s->execute([$id]); $p=$s->fetch();
        if (!$p) throw new ApiException(404,'PATIENT_NOT_FOUND','No se encontró el paciente.');
        if ($version!==null && (int)$p['version']!==$version) throw new ApiException(409,'VERSION_CONFLICT','El paciente cambió. Volvé a abrirlo antes de guardar.');
        return $p;
    }
    private function joins(): string
    {
        return ' FROM patients p LEFT JOIN patient_contacts c ON c.patient_id=p.id LEFT JOIN patient_encounters e ON e.id=(SELECT MAX(ep.id) FROM patient_encounters ep WHERE ep.patient_id=p.id) LEFT JOIN departments dep ON dep.id=e.department_id LEFT JOIN staff doctor ON doctor.id=e.doctor_staff_id LEFT JOIN doctor_profiles dp ON dp.staff_id=doctor.id ';
    }
    private function select(): string
    {
        return "SELECT p.*,c.full_name AS emergency_name,c.phone AS emergency_phone,c.relationship AS emergency_relationship,e.id AS encounter_id,e.care_status,e.room,e.department_id,dep.name AS department,e.doctor_staff_id,doctor.full_name AS doctor_name,CASE WHEN doctor.status='active' AND (dp.staff_id IS NULL OR (dp.status='active' AND dp.availability<>'inactive')) THEN 'active' ELSE 'inactive' END AS doctor_status,e.doctor_specialty,e.admission_date,e.discharged_at,e.diagnosis,e.clinical_state";
    }
    private function serialize(array $p): array
    {
        $age=$p['estimated_age']===null?null:(int)$p['estimated_age'];
        if ($p['date_of_birth']!==null) $age=(new \DateTimeImmutable($p['date_of_birth']))->diff(new \DateTimeImmutable(PatientInput::today()))->y;
        $result=['id'=>(string)$p['id'],'version'=>(int)$p['version'],'full_name'=>$p['full_name'],'national_id'=>$p['national_id'],'status'=>$p['status'],
            'date_of_birth'=>$p['date_of_birth'],'sex'=>$p['sex'],'age'=>$age,'age_is_estimate'=>$age!==null && $p['date_of_birth']===null,'age_recorded_on'=>$p['age_recorded_on'],
            'phone'=>$p['phone'],'blood_group'=>$p['blood_group'],'allergies'=>$p['allergies'],
            'emergency_contact'=>['full_name'=>$p['emergency_name']??'','phone'=>$p['emergency_phone']??'','relationship'=>$p['emergency_relationship']??''],
            'encounter'=>null,'created_at'=>UserRepository::date($p['created_at']),'updated_at'=>UserRepository::date($p['updated_at'])];
        if ($p['encounter_id']!==null) $result['encounter']=['id'=>(string)$p['encounter_id'],'care_status'=>$p['care_status'],'room'=>$p['room'],'department_id'=>$p['department_id']===null?null:(string)$p['department_id'],'department'=>$p['department']??'',
            'doctor_staff_id'=>$p['doctor_staff_id']===null?null:(string)$p['doctor_staff_id'],'doctor_name'=>$p['doctor_name']??'','doctor_active'=>$p['doctor_status']==='active','doctor_specialty'=>$p['doctor_specialty'],
            'admission_date'=>$p['admission_date'],'discharged_at'=>$p['discharged_at']===null?null:UserRepository::date($p['discharged_at']),'diagnosis'=>$p['diagnosis'],'clinical_state'=>$p['clinical_state']];
        return $result;
    }
    public function get(string $actor,string $id): array
    {
        $this->access($actor); $s=$this->db->prepare($this->select().$this->joins().' WHERE p.id=?'); $s->execute([$id]); $p=$s->fetch();
        if (!$p) throw new ApiException(404,'PATIENT_NOT_FOUND','No se encontró el paciente.');
        $this->audit($actor,'patient.viewed',$id); return $this->serialize($p);
    }
    public function listing(string $actor,array $input): array
    {
        $this->access($actor);
        $page=PatientInput::version($input['page']??1); $size=PatientInput::version($input['page_size']??5);
        if ($size>50 || $page>1000000) PatientInput::invalid('page');
        $state=$input['state']??'active'; if (!in_array($state,['active','archived'],true)) PatientInput::invalid('state');
        $care=$input['care_status']??''; if (!in_array($care,['','inpatient','outpatient','emergency','discharged'],true)) PatientInput::invalid('care_status');
        $q=PatientInput::text($input['q']??'','q',150);
        $where=' WHERE p.status=?'; $args=[$state];
        if ($care!=='') { $where.=' AND e.care_status=?'; $args[]=$care; }
        if ($q!=='') {
            $escape=static fn(string $s):string=>'%'.str_replace(['!','%','_'],['!!','!%','!_'],$s).'%';
            $where.=" AND (p.full_name LIKE ? ESCAPE '!' OR p.national_id LIKE ? ESCAPE '!' OR p.phone LIKE ? ESCAPE '!' OR REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(p.phone,' ',''),'-',''),'(',''),')',''),'+','') LIKE ? ESCAPE '!')";
            array_push($args,$escape($q),$escape(preg_replace('/[.\s-]/u','',$q) ?: $q),$escape($q),$escape(preg_match('/^[+0-9 ()-]+$/',$q) ? (preg_replace('/\D/','',$q) ?: $q) : $q));
        }
        $s=$this->db->prepare('SELECT COUNT(*)'.$this->joins().$where); $s->execute($args); $total=(int)$s->fetchColumn();
        $page=min($page,max(1,(int)ceil($total/$size))); $offset=($page-1)*$size;
        $s=$this->db->prepare($this->select().$this->joins().$where." ORDER BY p.id DESC LIMIT $size OFFSET $offset"); $s->execute($args);
        $rows=array_map(fn(array $p):array=>$this->serialize($p),$s->fetchAll());
        $this->audit($actor,'patient.listed','0');
        return ['data'=>$rows,'meta'=>['page'=>$page,'page_size'=>$size,'total'=>$total,'stats'=>$this->stats()]];
    }
    private function stats(): array
    {
        $today=new \DateTimeImmutable(PatientInput::today(),new \DateTimeZone('America/Montevideo'));
        $start=$today->setTimezone(new \DateTimeZone('UTC'))->format('Y-m-d H:i:s'); $end=$today->modify('+1 day')->setTimezone(new \DateTimeZone('UTC'))->format('Y-m-d H:i:s');
        $active=(int)$this->db->query("SELECT COUNT(*) FROM patients WHERE status='active'")->fetchColumn();
        $inpatient=(int)$this->db->query("SELECT COUNT(*)".$this->joins()." WHERE p.status='active' AND e.care_status='inpatient'")->fetchColumn();
        $s=$this->db->prepare('SELECT COUNT(DISTINCT patient_id) FROM patient_encounters WHERE discharged_at>=? AND discharged_at<?'); $s->execute([$start,$end]); $discharged=(int)$s->fetchColumn();
        $s=$this->db->prepare("SELECT COUNT(*) FROM patient_appointments a JOIN patients p ON p.id=a.patient_id WHERE a.status='scheduled' AND p.status='active' AND a.scheduled_at>=? AND a.scheduled_at<?"); $s->execute([$start,$end]);
        return ['active'=>$active,'inpatient'=>$inpatient,'discharged_today'=>$discharged,'appointments_today'=>(int)$s->fetchColumn()];
    }
    public function catalogs(string $actor): array
    {
        $this->access($actor);
        $doctors=$this->db->query("SELECT s.id,s.full_name FROM staff s JOIN staff_roles r ON r.staff_id=s.id AND r.role_code='doctor' LEFT JOIN doctor_profiles dp ON dp.staff_id=s.id WHERE s.status='active' AND (dp.staff_id IS NULL OR (dp.status='active' AND dp.availability<>'inactive')) ORDER BY s.full_name,s.id")->fetchAll();
        $departments=$this->db->query("SELECT id,name FROM departments WHERE status='active' ORDER BY name,id")->fetchAll();
        return ['doctors'=>array_map(static fn(array $r):array=>['id'=>(string)$r['id'],'full_name'=>$r['full_name']],$doctors),'departments'=>array_map(static fn(array $r):array=>['id'=>(string)$r['id'],'name'=>$r['name']],$departments),'create_token'=>bin2hex(random_bytes(32))];
    }
    private function saveRelated(string $id,array $f,?array $old): void
    {
        $s=$this->db->prepare('INSERT INTO patient_contacts (patient_id,full_name,phone,relationship) VALUES (?,?,?,?) ON DUPLICATE KEY UPDATE full_name=VALUES(full_name),phone=VALUES(phone),relationship=VALUES(relationship)');
        $s->execute([$id,$f['emergency_name'],$f['emergency_phone'],$f['emergency_relationship']]);
        $s=$this->db->prepare('SELECT * FROM patient_encounters WHERE patient_id=? ORDER BY id DESC LIMIT 1 FOR UPDATE'); $s->execute([$id]); $encounter=$s->fetch();
        if ($f['care_status']===null) { if ($encounter) PatientInput::invalid('care_status'); return; }
        if (!$encounter && $f['care_status']==='discharged') PatientInput::invalid('care_status');
        $newCase=!$encounter || ($encounter['care_status']==='discharged' && $f['care_status']!=='discharged');
        if ($f['doctor_staff_id']!==null) {
            $s=$this->db->prepare("SELECT s.id FROM staff s JOIN staff_roles r ON r.staff_id=s.id AND r.role_code='doctor' LEFT JOIN doctor_profiles dp ON dp.staff_id=s.id WHERE s.id=? AND s.status='active' AND (dp.staff_id IS NULL OR (dp.status='active' AND dp.availability<>'inactive')) FOR UPDATE"); $s->execute([$f['doctor_staff_id']]);
            if (!$s->fetchColumn() && ($newCase || (string)$encounter['doctor_staff_id']!==$f['doctor_staff_id'])) PatientInput::invalid('doctor_staff_id');
        }
        $department=null;
        if ($f['department']!=='') {
            $s=$this->db->prepare('INSERT INTO departments (name) VALUES (?) ON DUPLICATE KEY UPDATE id=LAST_INSERT_ID(id)'); $s->execute([$f['department']]); $department=$this->db->lastInsertId();
            $s=$this->db->prepare('SELECT status FROM departments WHERE id=?'); $s->execute([$department]);
            if ($s->fetchColumn()!=='active' && ($newCase || (string)$encounter['department_id']!==$department)) PatientInput::invalid('department');
        }
        $discharge=$f['care_status']==='discharged' ? ($encounter['discharged_at']??gmdate('Y-m-d H:i:s')) : null;
        $values=[$f['care_status'],$f['room'],$department,$f['doctor_staff_id'],$f['doctor_specialty'],$f['admission_date'],$discharge,$f['diagnosis'],$f['clinical_state']];
        if ($newCase) {
            $s=$this->db->prepare('INSERT INTO patient_encounters (care_status,room,department_id,doctor_staff_id,doctor_specialty,admission_date,discharged_at,diagnosis,clinical_state,patient_id) VALUES (?,?,?,?,?,?,?,?,?,?)'); $values[]=$id;
        } else {
            $s=$this->db->prepare('UPDATE patient_encounters SET care_status=?,room=?,department_id=?,doctor_staff_id=?,doctor_specialty=?,admission_date=?,discharged_at=?,diagnosis=?,clinical_state=? WHERE id=?'); $values[]=$encounter['id'];
        }
        $s->execute($values);
    }
    private function identityValues(array $f,?array $old): array
    {
        $recorded=$f['age']===null?null:($old && $old['date_of_birth']===null && $old['estimated_age']!==null && (int)$old['estimated_age']===$f['age'] ? $old['age_recorded_on'] : PatientInput::today());
        return [$f['full_name'],$f['national_id'],$f['date_of_birth'],$f['sex'],$f['age'],$recorded,$f['phone'],$f['blood_group'],$f['allergies']];
    }
    public function create(string $actor,array $input): array
    {
        $f=PatientInput::fields($input); $token=$input['create_token']??null;
        if (!is_string($token) || !preg_match('/^[a-f0-9]{64}$/',$token)) throw new ApiException(422,'CREATE_TOKEN_REQUIRED','Se requiere una referencia de creación válida.');
        $key=hash('sha256',$actor.':'.$token); $fingerprint=hash('sha256',json_encode($f,JSON_UNESCAPED_UNICODE|JSON_THROW_ON_ERROR));
        $id=$this->transaction($actor,function() use($actor,$f,$key,$fingerprint) {
            $s=$this->db->prepare('SELECT id,create_fingerprint FROM patients WHERE create_key=?'); $s->execute([$key]); $existing=$s->fetch();
            if ($existing) { if (!hash_equals($existing['create_fingerprint'],$fingerprint)) throw new ApiException(409,'CREATE_TOKEN_REUSED','La referencia ya se utilizó con otros datos.'); return (string)$existing['id']; }
            $values=$this->identityValues($f,null); array_push($values,$key,$fingerprint);
            $s=$this->db->prepare('INSERT INTO patients (full_name,national_id,date_of_birth,sex,estimated_age,age_recorded_on,phone,blood_group,allergies,create_key,create_fingerprint) VALUES (?,?,?,?,?,?,?,?,?,?,?)'); $s->execute($values); $id=$this->db->lastInsertId();
            $this->saveRelated($id,$f,null); $this->audit($actor,'patient.created',$id); return $id;
        });
        return $this->get($actor,$id);
    }
    public function update(string $actor,string $id,array $input): array
    {
        $f=PatientInput::fields($input); $version=PatientInput::version($input['version']??null);
        $this->transaction($actor,function() use($actor,$id,$f,$version) {
            $p=$this->lock($id,$version); if ($p['status']!=='active') throw new ApiException(409,'PATIENT_ARCHIVED','Restaurá el paciente antes de editarlo.');
            $values=$this->identityValues($f,$p); $values[]=$id;
            $s=$this->db->prepare('UPDATE patients SET full_name=?,national_id=?,date_of_birth=?,sex=?,estimated_age=?,age_recorded_on=?,phone=?,blood_group=?,allergies=?,version=version+1 WHERE id=?'); $s->execute($values);
            $this->saveRelated($id,$f,$p); $this->audit($actor,'patient.updated',$id);
        });
        return $this->get($actor,$id);
    }
    public function archive(?string $actor,string $id,int $version,bool $restore=false): ?array
    {
        $this->transaction($actor,function() use($actor,$id,$version,$restore) {
            $p=$this->lock($id,$version); $wanted=$restore?'active':'archived';
            if ($p['status']===$wanted) throw new ApiException(409,'PATIENT_STATE_CONFLICT','El estado del registro cambió.');
            if (!$restore) {
                $s=$this->db->prepare("SELECT id FROM transfers WHERE patient_id=? AND status NOT IN ('completed','cancelled') LIMIT 1"); $s->execute([$id]);
                if ($s->fetchColumn()) throw new ApiException(409,'PATIENT_IN_USE','El paciente tiene un traslado pendiente o en curso.');
                $s=$this->db->prepare("SELECT id FROM patient_appointments WHERE patient_id=? AND status='scheduled' AND scheduled_at>=UTC_TIMESTAMP() LIMIT 1"); $s->execute([$id]);
                if ($s->fetchColumn()) throw new ApiException(409,'PATIENT_IN_USE','El paciente tiene una cita pendiente.');
            }
            $s=$this->db->prepare('UPDATE patients SET status=?,archived_at=?,version=version+1 WHERE id=?'); $s->execute([$wanted,$restore?null:gmdate('Y-m-d H:i:s'),$id]);
            $this->audit($actor,$restore?'patient.restored':'patient.archived',$id);
        });
        return $actor===null?null:$this->get($actor,$id);
    }
    public function addIdentity(string $ci,string $name): string
    {
        $ci=PatientInput::identity($ci); $name=PatientInput::text($name,'full_name',150,false);
        return $this->transaction(null,function() use($ci,$name) {
            $s=$this->db->prepare('INSERT INTO patients (national_id,full_name) VALUES (?,?)'); $s->execute([$ci,$name]); $id=$this->db->lastInsertId(); $this->audit(null,'patient.created',$id); return $id;
        });
    }
}
