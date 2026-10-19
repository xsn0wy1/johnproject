<?php
declare(strict_types=1);
namespace Hospital\Modules\Transfers;
use Hospital\Http\ApiException;
use Hospital\Http\Request;
use Hospital\Modules\Settings\SettingsService;

final class TransferCatalog
{
    private \PDO $db;
    public function __construct(\PDO $db) { $this->db=$db; }
    public function selection(): array
    {
        $vehicles=$this->db->query("SELECT id,code,plate FROM ambulances WHERE status='active' AND operational_status='available' ORDER BY code LIMIT 1000")->fetchAll();
        $crew=$this->db->query("SELECT s.id,s.full_name,r.role_code FROM staff s JOIN staff_roles r ON r.staff_id=s.id LEFT JOIN doctor_profiles d ON d.staff_id=s.id LEFT JOIN personnel_profiles p ON p.staff_id=s.id WHERE s.status='active' AND (r.role_code<>'doctor' OR d.staff_id IS NULL OR (d.status='active' AND d.availability<>'inactive')) AND (r.role_code NOT IN ('driver','copilot') OR p.staff_id IS NULL OR (p.status='active' AND p.availability='active' AND p.responsibility=r.role_code)) ORDER BY s.full_name,s.id LIMIT 2000")->fetchAll();
        $facilities=$this->db->query("SELECT id,name,address,locality,facility_type FROM facilities WHERE status='active' AND availability='active' ORDER BY name,id LIMIT 1000")->fetchAll();
        $routeRows=$this->db->query("SELECT * FROM route_templates WHERE status='active' AND availability='active' ORDER BY name,id LIMIT 2000")->fetchAll();
        $routeService=new \Hospital\Modules\Routes\RouteService($this->db,[]);
        $routes=array_map(fn(array $row):array=>$routeService->payload($row),$routeRows);
        $stringIds=static function(array $row):array { foreach($row as $key=>&$value) if ($key==='id'||str_ends_with($key,'_id')) $value=$value===null?null:(string)$value; return $row; };
        return ['ambulances'=>array_map($stringIds,$vehicles),'crew'=>array_map($stringIds,$crew),'facilities'=>array_map($stringIds,$facilities),'routes'=>array_map($stringIds,$routes)];
    }
    public function patients($query): array
    {
        $q=SettingsService::text($query,'q',150);
        if (mb_strlen($q)<2) return [];
        $escape=static fn(string $s):string=>'%'.str_replace(['!','%','_'],['!!','!%','!_'],$s).'%';
        $s=$this->db->prepare("SELECT id,full_name,national_id,date_of_birth,sex,estimated_age,age_recorded_on FROM patients WHERE status='active' AND (full_name LIKE ? ESCAPE '!' OR national_id LIKE ? ESCAPE '!') ORDER BY full_name,id LIMIT 20");
        $s->execute([$escape($q),$escape(preg_replace('/[.\s-]/','',$q))]);
        return array_map([self::class,'patient'],$s->fetchAll());
    }
    public static function patient(array $row): array
    {
        $age=isset($row['estimated_age'])?(int)$row['estimated_age']:null;
        if ($row['date_of_birth']!==null) $age=(new \DateTimeImmutable($row['date_of_birth']))->diff(new \DateTimeImmutable('today',new \DateTimeZone('America/Montevideo')))->y;
        return ['id'=>(string)$row['id'],'full_name'=>$row['full_name'],'national_id'=>$row['national_id'],'age'=>$age,'age_is_estimate'=>$age!==null && $row['date_of_birth']===null,'age_recorded_on'=>$row['age_recorded_on']??null,'sex'=>$row['sex']];
    }
    /** Trusted local administration; future management APIs must call equivalent validation. */
    public function import(array $input): array
    {
        if (array_diff(array_keys($input),['facilities','ambulances','crew','routes'])) throw new ApiException(422,'VALIDATION_FAILED','Catálogo no válido.');
        $this->db->beginTransaction();
        try {
            foreach ($input['facilities']??[] as $item) {
                $name=SettingsService::text($item['name']??null,'name',150,false); $address=SettingsService::text($item['address']??'','address',255);
                foreach(['latitude'=>90,'longitude'=>180] as $key=>$limit) if (!is_numeric($item[$key]??null)||abs((float)$item[$key])>$limit) throw new ApiException(422,'INVALID_ROUTE','Coordenadas no válidas.');
                $s=$this->db->prepare('SELECT id FROM facilities WHERE name=? ORDER BY id LIMIT 1 FOR UPDATE'); $s->execute([$name]); $id=$s->fetchColumn();
                if ($id) { $s=$this->db->prepare('UPDATE facilities SET address=?,latitude=?,longitude=?,version=version+1 WHERE id=?'); $s->execute([$address,$item['latitude'],$item['longitude'],$id]); }
                else { $s=$this->db->prepare('INSERT INTO facilities (name,address,latitude,longitude) VALUES (?,?,?,?)'); $s->execute([$name,$address,$item['latitude'],$item['longitude']]); }
            }
            foreach($input['ambulances']??[] as $item) {
                $code=strtoupper(SettingsService::text($item['code']??null,'code',20,false)); $plate=strtoupper(preg_replace('/[\s-]/','',SettingsService::text($item['plate']??null,'plate',20,false)));
                if (!preg_match('/^[A-Z0-9-]{1,20}$/',$code)||!preg_match('/^[A-Z0-9]{1,20}$/',$plate)) throw new ApiException(422,'VALIDATION_FAILED','Identidad de vehículo no válida.');
                $s=$this->db->prepare('INSERT INTO ambulances (code,plate,model) VALUES (?,?,?) ON DUPLICATE KEY UPDATE id=LAST_INSERT_ID(id)'); $s->execute([$code,$plate,SettingsService::text($item['model']??'','model',100)]);
                $s=$this->db->prepare('SELECT code,plate FROM ambulances WHERE code=? OR plate=?');$s->execute([$code,$plate]);$rows=$s->fetchAll();
                if(count($rows)!==1||$rows[0]['code']!==$code||$rows[0]['plate']!==$plate) throw new ApiException(409,'CATALOG_CONFLICT','Código o matrícula ya utilizados.');
            }
            foreach($input['crew']??[] as $item) {
                $ci=preg_replace('/[.\s-]/','',$item['national_id']??''); if(!preg_match('/^[0-9]{6,12}$/',$ci)) throw new ApiException(422,'VALIDATION_FAILED','Identidad de personal no válida.');
                $name=SettingsService::text($item['full_name']??null,'full_name',150,false);
                $s=$this->db->prepare('INSERT INTO staff (national_id,full_name) VALUES (?,?) ON DUPLICATE KEY UPDATE id=LAST_INSERT_ID(id)');$s->execute([$ci,$name]); $staff=$this->db->lastInsertId();
                foreach($item['responsibilities']??[] as $role) { TransferInput::choice($role,['driver','copilot','doctor']);$s=$this->db->prepare('INSERT IGNORE INTO staff_roles (staff_id,role_code) VALUES (?,?)');$s->execute([$staff,$role]); }
            }
            foreach($input['routes']??[] as $item) {
                $points=TransferInput::geometry($item['geometry']??null); $ends=[];
                foreach(['origin','destination'] as $key) { $s=$this->db->prepare("SELECT id,name,address,latitude,longitude FROM facilities WHERE name=? AND status='active' ORDER BY id LIMIT 1 FOR UPDATE");$s->execute([$item[$key]??null]);$row=$s->fetch();if(!$row||$row['latitude']===null||$row['longitude']===null) throw new ApiException(422,'INVALID_ROUTE','Centro no válido.');$ends[]=$row; }
                if ($ends[0]['id']===$ends[1]['id']||TransferInput::distance($ends[0],$points['points'][0])>100||TransferInput::distance($ends[1],$points['points'][count($points['points'])-1])>100) throw new ApiException(422,'INVALID_ROUTE','La geometría debe unir los centros seleccionados.');
                $seconds=$item['duration_seconds']??null; if(!is_int($seconds)||$seconds<30||$seconds>86400) throw new ApiException(422,'INVALID_ROUTE','Duración no válida.');
                $code=SettingsService::text($item['code']??null,'code',40,false); $name=SettingsService::text($item['name']??null,'name',150,false);
                $s=$this->db->prepare('INSERT INTO route_templates (code,name,origin_facility_id,destination_facility_id,geometry,distance_meters,duration_seconds) VALUES (?,?,?,?,?,?,?) ON DUPLICATE KEY UPDATE name=VALUES(name),origin_facility_id=VALUES(origin_facility_id),destination_facility_id=VALUES(destination_facility_id),geometry=VALUES(geometry),distance_meters=VALUES(distance_meters),duration_seconds=VALUES(duration_seconds),version=version+1');
                $s->execute([$code,$name,$ends[0]['id'],$ends[1]['id'],json_encode($points['points'],JSON_THROW_ON_ERROR),$points['distance'],$seconds]);
                $s=$this->db->prepare('UPDATE route_templates SET origin_name=?,origin_address=?,destination_name=?,destination_address=? WHERE code=?');$s->execute([$ends[0]['name'],$ends[0]['address'],$ends[1]['name'],$ends[1]['address'],$code]);
            }
            (new TransferAccess($this->db, ['db'=>['name'=>'cli']]))->audit(null,'transfer.catalog_import',null,'catalog');
            $this->db->commit();
        } catch(\Throwable $e) { if($this->db->inTransaction())$this->db->rollBack();throw $e; }
        return $this->selection();
    }
}
