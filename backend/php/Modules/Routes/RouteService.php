<?php
declare(strict_types=1);
namespace Hospital\Modules\Routes;
use Hospital\Http\ApiException;
use Hospital\Modules\Auth\UserRepository;
use Hospital\Modules\Settings\SettingsService;
use Hospital\Modules\Transfers\TransferAccess;
use Hospital\Modules\Transfers\TransferInput;

final class RouteService
{
    public const FIELDS=['name','category','direction','availability','origin_name','origin_address','destination_name','destination_address','stops','distance_meters','duration_seconds','notes'];
    private \PDO $db;
    private array $config;
    private TransferAccess $access;
    public function __construct(\PDO $db,array $config) { $this->db=$db; $this->config=$config; $this->access=new TransferAccess($db,$config); }
    public function access(string $actor): void { $this->access->requireDispatch($actor); }
    private function transaction(string $actor,callable $work)
    {
        return $this->access->serialized(function() use($actor,$work) {
            $this->db->beginTransaction();
            try { $this->access->actor($actor); $result=$work(); $this->db->commit(); return $result; }
            catch (\Throwable $e) { if ($this->db->inTransaction()) $this->db->rollBack(); throw $e; }
        });
    }
    private function fields(array $input): array
    {
        $f=[];
        foreach (['name'=>80,'origin_name'=>100,'origin_address'=>160,'destination_name'=>100,'destination_address'=>160] as $key=>$max) $f[$key]=SettingsService::text($input[$key]??null,$key,$max,false);
        $f['category']=TransferInput::choice($input['category']??null,['interhospital','consultation','treatment','discharge']);
        $f['direction']=TransferInput::choice($input['direction']??null,['one_way','round_trip']);
        $f['availability']=TransferInput::choice($input['availability']??null,['active','inactive']);
        $f['notes']=TransferInput::notes($input['notes']??'');
        if (mb_strlen($f['notes'])>500) throw new ApiException(422,'VALIDATION_FAILED','Las indicaciones admiten hasta 500 caracteres.');
        foreach (['distance_meters'=>[100,2000000],'duration_seconds'=>[60,172800]] as $key=>[$min,$max]) {
            $value=$input[$key]??null;
            if ((!is_int($value)&&!is_string($value)) || !preg_match('/^[0-9]+$/',(string)$value) || (int)$value<$min || (int)$value>$max) throw new ApiException(422,'VALIDATION_FAILED','Revisá las estimaciones del recorrido.');
            $f[$key]=(int)$value;
        }
        $stops=$input['stops']??[];
        if (!is_array($stops) || count($stops)>6 || ($stops && array_keys($stops)!==range(0,count($stops)-1))) throw new ApiException(422,'VALIDATION_FAILED','Se admiten hasta seis paradas ordenadas.');
        $f['stops']=[];
        foreach ($stops as $stop) {
            if (!is_array($stop) || array_diff(array_keys($stop),['name','address'])) throw new ApiException(422,'VALIDATION_FAILED','Parada no válida.');
            $f['stops'][]=['name'=>SettingsService::text($stop['name']??null,'name',100,false),'address'=>SettingsService::text($stop['address']??null,'address',160,false)];
        }
        $points=self::places($f);
        $same=static fn(array $a,array $b):bool=>mb_strtolower($a['name'])===mb_strtolower($b['name']) && mb_strtolower($a['address'])===mb_strtolower($b['address']);
        if ($same($points[0],$points[count($points)-1])) throw new ApiException(422,'VALIDATION_FAILED','El origen y destino deben ser diferentes.');
        for ($i=1;$i<count($points);$i++) if ($same($points[$i-1],$points[$i])) throw new ApiException(422,'VALIDATION_FAILED','Dos paradas consecutivas deben ser diferentes.');
        return $f;
    }
    public static function places(array $f): array
    {
        return array_merge([['name'=>$f['origin_name'],'address'=>$f['origin_address']]],$f['stops'],[['name'=>$f['destination_name'],'address'=>$f['destination_address']]]);
    }
    public function listing(string $actor): array
    {
        $this->access($actor); $rows=$this->db->query('SELECT * FROM route_templates ORDER BY id')->fetchAll();
        return array_map(fn(array $r):array=>$this->payload($r),$rows);
    }
    public function payload(array $row): array
    {
        $s=$this->db->prepare('SELECT name,address FROM route_stops WHERE route_id=? ORDER BY stop_number'); $s->execute([$row['id']]);
        $row['stops']=$s->fetchAll(); $row['geometry']=json_decode($row['geometry'],true,32,JSON_THROW_ON_ERROR);
        foreach (['id','origin_facility_id','destination_facility_id'] as $key) $row[$key]=$row[$key]===null?null:(string)$row[$key];
        foreach (['version','distance_meters','duration_seconds'] as $key) $row[$key]=(int)$row[$key];
        foreach (['created_at','updated_at','archived_at'] as $key) $row[$key]=$row[$key]===null?null:UserRepository::date($row[$key]);
        return $row;
    }
    public function get(string $actor,string $id): array
    {
        $this->access($actor); $s=$this->db->prepare('SELECT * FROM route_templates WHERE id=?'); $s->execute([$id]); $row=$s->fetch();
        if (!$row) throw new ApiException(404,'ROUTE_NOT_FOUND','No se encontró la ruta.');
        return $this->payload($row);
    }
    private function lock(string $id,int $version): array
    {
        $s=$this->db->prepare('SELECT * FROM route_templates WHERE id=? FOR UPDATE'); $s->execute([$id]); $row=$s->fetch();
        if (!$row) throw new ApiException(404,'ROUTE_NOT_FOUND','No se encontró la ruta.');
        if ((int)$row['version']!==$version) throw new ApiException(409,'VERSION_CONFLICT','La ruta cambió. Volvé a abrirla antes de guardar.');
        return $row;
    }
    public function save(string $actor,array $input,?string $id=null): array
    {
        $this->access($actor); $f=$this->fields($input); $version=$id===null?null:TransferInput::version($input['version']??null);
        $previous=$id===null?null:$this->get($actor,$id);
        if ($previous && $previous['version']!==$version) throw new ApiException(409,'VERSION_CONFLICT','La ruta cambió. Volvé a abrirla antes de guardar.');
        $same=$previous && self::places($f)===self::places($previous);
        $geometry=$same?json_encode($previous['geometry'],JSON_THROW_ON_ERROR):'[]';
        if (!$same || !$previous['geometry']) { $mapped=(new RouteMapper($this->db,$this->config))->path(self::places($f)); if ($mapped) $geometry=$mapped['geometry']; }
        $id=$this->transaction($actor,function() use($actor,$f,$id,$version,$geometry) {
            if ($id!==null && $this->lock($id,$version)['status']!=='active') throw new ApiException(409,'ROUTE_ARCHIVED','Restaurá la ruta antes de editarla.');
            $s=$this->db->prepare('SELECT id FROM route_templates WHERE name=? AND id<>? LIMIT 1'); $s->execute([$f['name'],$id??0]);
            if ($s->fetchColumn()) throw new ApiException(409,'ROUTE_CONFLICT','Ya existe una ruta con ese nombre. Revisá también las inactivas.');
            $row=$f; unset($row['stops']); $row['geometry']=$geometry;
            // Optional catalog associations never create hospital centers implicitly.
            foreach (['origin','destination'] as $prefix) {
                $s=$this->db->prepare("SELECT id FROM facilities WHERE name=? AND address=? AND status='active' AND availability='active' ORDER BY id LIMIT 2"); $s->execute([$f[$prefix.'_name'],$f[$prefix.'_address']]); $ids=$s->fetchAll(\PDO::FETCH_COLUMN);
                $row[$prefix.'_facility_id']=count($ids)===1?$ids[0]:null;
            }
            if ($id===null) {
                $row['code']='new-'.bin2hex(random_bytes(12));
                $s=$this->db->prepare('INSERT INTO route_templates ('.implode(',',array_keys($row)).') VALUES ('.implode(',',array_fill(0,count($row),'?')).')'); $s->execute(array_values($row)); $id=$this->db->lastInsertId();
                $number=max((int)$id,1+(int)$this->db->query("SELECT COALESCE(MAX(CAST(SUBSTRING(code,4) AS UNSIGNED)),0) FROM route_templates WHERE code REGEXP '^RT-[0-9]+$'")->fetchColumn());
                $s=$this->db->prepare('UPDATE route_templates SET code=? WHERE id=?'); $s->execute(['RT-'.str_pad((string)$number,3,'0',STR_PAD_LEFT),$id]);
            } else {
                $sets=array_map(static fn(string $key):string=>$key.'=?',array_keys($row));
                $s=$this->db->prepare('UPDATE route_templates SET '.implode(',',$sets).',version=version+1 WHERE id=?'); $s->execute(array_merge(array_values($row),[$id]));
            }
            $s=$this->db->prepare('DELETE FROM route_stops WHERE route_id=?'); $s->execute([$id]);
            foreach ($f['stops'] as $index=>$stop) { $s=$this->db->prepare('INSERT INTO route_stops (route_id,stop_number,name,address) VALUES (?,?,?,?)'); $s->execute([$id,$index+1,$stop['name'],$stop['address']]); }
            $this->access->audit($actor,$version===null?'route.created':'route.updated',$id,'route'); return $id;
        });
        return $this->get($actor,$id);
    }
    public function archive(string $actor,string $id,int $version,bool $restore=false): array
    {
        $this->transaction($actor,function() use($actor,$id,$version,$restore) {
            $old=$this->lock($id,$version); $state=$restore?'active':'archived';
            if ($old['status']===$state) throw new ApiException(409,'VERSION_CONFLICT','El estado de la ruta cambió.');
            $s=$this->db->prepare('UPDATE route_templates SET status=?,archived_at=?,version=version+1 WHERE id=?'); $s->execute([$state,$restore?null:gmdate('Y-m-d H:i:s'),$id]);
            $this->access->audit($actor,$restore?'route.restored':'route.archived',$id,'route');
        });
        return $this->get($actor,$id);
    }
}
