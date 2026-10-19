<?php
declare(strict_types=1);
namespace Hospital\Modules\Transfers;
use Hospital\Http\ApiException;
use Hospital\Http\Request;
use Hospital\Modules\Auth\UserRepository;

final class TransferService
{
    private \PDO $db;
    private array $config;
    private TransferAccess $access;
    public function __construct(\PDO $db,array $config) { $this->db=$db;$this->config=$config;$this->access=new TransferAccess($db,$config); }
    public function row(string $actor,string $id,bool $lock=false): array
    {
        $args=[$id];$scope=$this->access->scope($actor,$args);
        $s=$this->db->prepare('SELECT t.* FROM transfers t WHERE t.id=? AND '.$scope.($lock?' FOR UPDATE':''));$s->execute($args);$row=$s->fetch();
        if(!$row)throw new ApiException(404,'TRANSFER_NOT_FOUND',\Hospital\I18n::t("errors.no_se_encontro_el_traslado"));
        return $row;
    }
    private function revision(array $row,$version):void
    {
        if((int)$row['version']!==TransferInput::version($version))throw new ApiException(409,'VERSION_CONFLICT',\Hospital\I18n::t("errors.el_traslado_cambio_volve_a_abrirlo_antes_de_guardar"));
    }
    private function transaction(string $actor,callable $work)
    {
        return $this->access->serialized(function()use($actor,$work){
            $this->db->beginTransaction();
            try{$this->access->actor($actor);$result=$work();$this->db->commit();return $result;}
            catch(\Throwable $e){if($this->db->inTransaction())$this->db->rollBack();throw $e;}
        });
    }
    private function catalog(array $f,?array $existing=null,?array $prepared=null,bool $refresh=false):array
    {
        // Lock canonical resources in stable ID order. All transfer writes also
        // use a database-wide domain lock, including the simulation worker.
        $s=$this->db->prepare("SELECT * FROM ambulances WHERE id=? FOR UPDATE");$s->execute([$f['ambulance_id']]);$vehicle=$s->fetch();
        if(!$vehicle||$vehicle['status']!=='active'||$vehicle['operational_status']!=='available')throw new ApiException(422,'VEHICLE_UNAVAILABLE',\Hospital\I18n::t("errors.selecciona_una_ambulancia_operativa"));
        $ids=array_values(array_filter([$f['driver_id'],$f['companion_id']]));sort($ids,SORT_NUMERIC);
        $s=$this->db->prepare('SELECT * FROM staff WHERE id IN ('.implode(',',array_fill(0,count($ids),'?')).') ORDER BY id FOR UPDATE');$s->execute($ids);$staff=[];
        foreach($s->fetchAll() as $member)$staff[(string)$member['id']]=$member;
        foreach(['driver_id'=>['driver'],'companion_id'=>['copilot','doctor']] as $key=>$roles){
            if($f[$key]===null)continue;$member=$staff[$f[$key]]??null;
            $s=$this->db->prepare('SELECT role_code FROM staff_roles WHERE staff_id=? FOR UPDATE');$s->execute([$f[$key]]);$responsibilities=$s->fetchAll(\PDO::FETCH_COLUMN);
            $s=$this->db->prepare('SELECT status,availability FROM doctor_profiles WHERE staff_id=?');$s->execute([$f[$key]]);$doctor=$s->fetch();
            if($doctor && ($doctor['status']!=='active'||$doctor['availability']==='inactive'))$responsibilities=array_values(array_diff($responsibilities,['doctor']));
            $s=$this->db->prepare('SELECT status,availability,responsibility FROM personnel_profiles WHERE staff_id=?');$s->execute([$f[$key]]);$personnel=$s->fetch();
            if($personnel)foreach(['driver','copilot'] as $role)if($personnel['status']!=='active'||$personnel['availability']!=='active'||$personnel['responsibility']!==$role)$responsibilities=array_values(array_diff($responsibilities,[$role]));
            if(!$member||$member['status']!=='active'||!array_intersect($roles,$responsibilities))throw new ApiException(422,'CREW_UNAVAILABLE',\Hospital\I18n::t("errors.selecciona_personal_activo_con_la_funcion_requerida"));
            $staff[$f[$key]]['responsibility']=$key==='driver_id'?'driver':(in_array('doctor',$responsibilities,true)?'doctor':'copilot');
        }
        if($f['patient_id']!==null){
            $keep=$existing&&$existing['patient_id']!==null&&(string)$existing['patient_id']===$f['patient_id'];
            $s=$this->db->prepare('SELECT id FROM patients WHERE id=?'.($keep?'':" AND status='active'").' FOR UPDATE');$s->execute([$f['patient_id']]);
            if(!$s->fetchColumn())throw new ApiException(422,'PATIENT_UNAVAILABLE',\Hospital\I18n::t("errors.selecciona_un_paciente_activo_del_hospital"));
        }
        $resolved=(new TransferLocations($this->db,$this->config))->resolve($f,$existing,true,$refresh);
        if ($prepared!==null) {
            if (!hash_equals($prepared['fingerprint'],TransferLocations::fingerprint($resolved))) throw new ApiException(409,'VERSION_CONFLICT',\Hospital\I18n::t("errors.la_ubicacion_o_la_ruta_cambio_durante_la_consulta_reintenta"));
            $resolved['route']=$prepared['route'];
        }
        extract($resolved);
        return compact('vehicle','staff','origin','destination','route','sameRoute');
    }
    private function prepareLocations(array $f,?array $existing=null,bool $refresh=false): array
    {
        $resolved=(new TransferLocations($this->db,$this->config))->resolve($f,$existing,false,$refresh);
        $fingerprint=TransferLocations::fingerprint($resolved);$route=$resolved['route'];
        if ($route['geometry']==='[]' && (!$resolved['sameRoute'] || $refresh)) {
            $snapshot=$route['route_snapshot']??null;$stops=$snapshot===null?[]:(json_decode($snapshot,true,32,JSON_THROW_ON_ERROR)['stops']??[]);
            $mapped=(new \Hospital\Modules\Routes\RouteMapper($this->db,$this->config))->path(array_merge([$resolved['origin']],$stops,[$resolved['destination']]));
            if ($mapped) {
                $route['geometry']=$mapped['geometry'];
                if ($route['id']===null) { $route['distance_meters']=$mapped['distance_meters'];$route['duration_seconds']=$mapped['duration_seconds']; }
            } elseif ($refresh) throw new ApiException(503,'MAP_UNAVAILABLE',\Hospital\I18n::t("errors.no_se_pudo_resolver_el_mapa_se_conservo_el_traslado"));
        }
        return ['fingerprint'=>$fingerprint,'route'=>$route];
    }
    private function reserve(array $f,array $catalog,string $id,string $start,bool $starting=false):string
    {
        $end=gmdate('Y-m-d H:i:s',strtotime($start.' UTC')+(int)($catalog['route']['duration_seconds']??$this->config['unmapped_duration_seconds']??3600)+900);
        $resources=[['ambulance',$f['ambulance_id']],['staff',$f['driver_id']]];
        if($f['companion_id']!==null)$resources[]=['staff',$f['companion_id']];
        foreach($resources as [$kind,$resource]){
            $s=$this->db->prepare("SELECT r.transfer_id FROM resource_reservations r JOIN transfers t ON t.id=r.transfer_id WHERE r.resource_type=? AND r.resource_id=? AND r.transfer_id<>? AND ((r.starts_at<? AND r.ends_at>?) OR (t.status IN ('in_progress','arrived') AND r.ends_at<=UTC_TIMESTAMP())".($starting?" OR t.status IN ('in_progress','arrived')":'').') LIMIT 1 FOR UPDATE');
            $s->execute([$kind,$resource,$id,$end,$start]);
            if($s->fetchColumn())throw new ApiException(409,'ASSIGNMENT_CONFLICT',\Hospital\I18n::t("errors.la_ambulancia_o_el_personal_ya_tienen_otro_traslado_en_ese_intervalo"));
        }
        $s=$this->db->prepare('DELETE FROM resource_reservations WHERE transfer_id=?');$s->execute([$id]);
        foreach($resources as [$kind,$resource]){$s=$this->db->prepare('INSERT INTO resource_reservations (transfer_id,resource_type,resource_id,starts_at,ends_at) VALUES (?,?,?,?,?)');$s->execute([$id,$kind,$resource,$start,$end]);}
        return $end;
    }
    private function crew(string $id,array $f,array $catalog):void
    {
        $s=$this->db->prepare('DELETE FROM transfer_crew WHERE transfer_id=?');$s->execute([$id]);
        foreach(['driver'=>'driver_id','companion'=>'companion_id'] as $duty=>$key){if($f[$key]===null)continue;$s=$this->db->prepare('INSERT INTO transfer_crew (transfer_id,staff_id,duty,name_snapshot,responsibility) VALUES (?,?,?,?,?)');$s->execute([$id,$f[$key],$duty,$catalog['staff'][$f[$key]]['full_name'],$catalog['staff'][$f[$key]]['responsibility']]);}
    }
    public function event(string $id,?string $actor,string $type,?string $from=null,?string $to=null):void
    {
        $s=$this->db->prepare('INSERT INTO transfer_events (transfer_id,actor_user_id,event_type,from_status,to_status) VALUES (?,?,?,?,?)');$s->execute([$id,$actor,$type,$from,$to]);
    }
    public function create(string $actor,array $input):array
    {
        $this->access->requireDispatch($actor);$f=TransferInput::fields($input);$token=$input['create_token']??null;
        if(!is_string($token)||!preg_match('/^[a-f0-9]{64}$/',$token))throw new ApiException(422,'CREATE_TOKEN_REQUIRED',\Hospital\I18n::t("errors.se_requiere_la_referencia_de_creacion"));
        $fingerprint=hash('sha256',json_encode($f,JSON_THROW_ON_ERROR));
        $s=$this->db->prepare('SELECT id,create_fingerprint FROM transfers WHERE created_by=? AND create_key=?');$s->execute([$actor,hash('sha256',$token)]);$retry=$s->fetch();
        if($retry){if(!hash_equals($retry['create_fingerprint'],$fingerprint))throw new ApiException(409,'CREATE_TOKEN_REUSED',\Hospital\I18n::t("errors.la_referencia_ya_fue_utilizada"));return $this->get($actor,(string)$retry['id']);}
        $prepared=$this->prepareLocations($f);
        $id=$this->transaction($actor,function()use($actor,$input,$f,$token,$fingerprint,$prepared){
            $s=$this->db->prepare('SELECT id,create_fingerprint FROM transfers WHERE created_by=? AND create_key=?');$s->execute([$actor,hash('sha256',$token)]);$existing=$s->fetch();
            if($existing){if(!hash_equals($existing['create_fingerprint'],$fingerprint))throw new ApiException(409,'CREATE_TOKEN_REUSED',\Hospital\I18n::t("errors.la_referencia_ya_fue_utilizada_con_otros_datos"));return(string)$existing['id'];}
            $when=strtotime($f['scheduled_at'].' UTC');
            if($when<time()-86400||$when>time()+366*86400)throw new ApiException(422,'INVALID_SCHEDULE',\Hospital\I18n::t("errors.la_fecha_debe_estar_entre_ayer_y_el_proximo_ano"));
            $c=$this->catalog($f,null,$prepared);$route=$c['route'];$v=$c['vehicle'];
            $row=['created_by'=>$actor,'ambulance_id'=>$f['ambulance_id'],'patient_id'=>$f['patient_id'],'route_template_id'=>$route['id'],'origin_facility_id'=>$c['origin']['id'],'destination_facility_id'=>$c['destination']['id'],'ambulance_code'=>$v['code'],'ambulance_plate'=>$v['plate'],'origin_name'=>$c['origin']['name'],'destination_name'=>$c['destination']['name'],'origin_address'=>$c['origin']['address'],'destination_address'=>$c['destination']['address'],'geometry'=>$route['geometry'],'route_snapshot'=>$route['route_snapshot']??null,'distance_meters'=>$route['distance_meters'],'duration_seconds'=>$route['duration_seconds'],'reserved_until'=>$f['scheduled_at'],'create_key'=>hash('sha256',$token),'create_fingerprint'=>$fingerprint];
            foreach($f as $key=>$value)if(!in_array($key,['driver_id','companion_id','route_template_id','route_version','origin_facility_id','destination_facility_id','origin_name','origin_address','destination_name','destination_address'],true))$row[$key]=$value;
            $s=$this->db->prepare('INSERT INTO transfers ('.implode(',',array_keys($row)).') VALUES ('.implode(',',array_fill(0,count($row),'?')).')');$s->execute(array_values($row));$id=$this->db->lastInsertId();
            $end=$this->reserve($f,$c,$id,$f['scheduled_at']);$s=$this->db->prepare('UPDATE transfers SET reserved_until=? WHERE id=?');$s->execute([$end,$id]);
            $this->crew($id,$f,$c);$this->event($id,$actor,'created',null,'scheduled');$this->access->audit($actor,'transfer.created',$id);
            (new TrackingService($this->db,$this->config))->sample($id,json_decode($route['geometry'],true),0,null,1);
            if(isset($input['draft_version'])){$version=TransferInput::version($input['draft_version']);$s=$this->db->prepare("UPDATE transfer_drafts SET payload='{}',version=version+1 WHERE user_id=? AND version=?");$s->execute([$actor,$version]);}
            return $id;
        });return $this->get($actor,$id);
    }
    public function update(string $actor,string $id,array $input):array
    {
        $this->access->requireDispatch($actor);$f=TransferInput::fields($input);
        $before=$this->row($actor,$id);$this->revision($before,$input['version']??null);
        if($before['status']!=='scheduled')throw new ApiException(409,'TRANSFER_LOCKED',\Hospital\I18n::t("errors.solo_los_traslados_programados_permiten_cambiar_sus_datos"));
        $refresh=$input['refresh_route']??false;if(!is_bool($refresh))throw new ApiException(422,'VALIDATION_FAILED',\Hospital\I18n::t("errors.opcion_no_valida"));
        $prepared=$this->prepareLocations($f,$before,$refresh);
        $this->transaction($actor,function()use($actor,$id,$input,$f,$prepared,$refresh){
            $row=$this->row($actor,$id,true);$this->revision($row,$input['version']??null);
            if($row['status']!=='scheduled')throw new ApiException(409,'TRANSFER_LOCKED',\Hospital\I18n::t("errors.solo_los_traslados_programados_permiten_cambiar_sus_datos"));
            $when=strtotime($f['scheduled_at'].' UTC');
            if($f['scheduled_at']!==$row['scheduled_at']&&($when<time()-86400||$when>time()+366*86400))throw new ApiException(422,'INVALID_SCHEDULE',\Hospital\I18n::t("errors.la_fecha_debe_estar_entre_ayer_y_el_proximo_ano"));
            $c=$this->catalog($f,$row,$prepared,$refresh);$end=$this->reserve($f,$c,$id,$f['scheduled_at']);
            $changes=$f;unset($changes['driver_id'],$changes['companion_id'],$changes['origin_name'],$changes['origin_address'],$changes['destination_name'],$changes['destination_address'],$changes['route_template_id'],$changes['route_version']);$changes['origin_facility_id']=$c['origin']['id'];$changes['destination_facility_id']=$c['destination']['id'];$changes['reserved_until']=$end;
            $changes['ambulance_code']=$c['vehicle']['code'];$changes['ambulance_plate']=$c['vehicle']['plate'];
            if(!$c['sameRoute'])foreach(['route_template_id'=>$c['route']['id'],'origin_name'=>$c['origin']['name'],'destination_name'=>$c['destination']['name'],'origin_address'=>$c['origin']['address'],'destination_address'=>$c['destination']['address'],'geometry'=>$c['route']['geometry'],'route_snapshot'=>$c['route']['route_snapshot']??null,'distance_meters'=>$c['route']['distance_meters'],'duration_seconds'=>$c['route']['duration_seconds']] as $key=>$value)$changes[$key]=$value;
            $sets=array_map(static fn(string $key):string=>$key.'=?',array_keys($changes));
            $s=$this->db->prepare('UPDATE transfers SET '.implode(',',$sets).',version=version+1,updated_at=UTC_TIMESTAMP() WHERE id=?');$s->execute(array_merge(array_values($changes),[$id]));
            $this->crew($id,$f,$c);$this->event($id,$actor,'updated');$this->access->audit($actor,'transfer.updated',$id);
            if(!$c['sameRoute'])(new TrackingService($this->db,$this->config))->sample($id,json_decode($c['route']['geometry'],true),0,null,1);
        });return $this->get($actor,$id);
    }
    public function changeStatus(string $actor,string $id,$version,string $status):array
    {
        TransferInput::choice($status,['in_progress','arrived','completed','cancelled']);
        $this->transaction($actor,function()use($actor,$id,$version,$status){
            $row=$this->row($actor,$id,true);$this->revision($row,$version);
            $allowed=['scheduled'=>['in_progress','cancelled'],'in_progress'=>['arrived','cancelled'],'arrived'=>['completed','cancelled'],'completed'=>[],'cancelled'=>[]];
            if(!in_array($status,$allowed[$row['status']],true))throw new ApiException(409,'INVALID_TRANSITION',\Hospital\I18n::t("errors.el_estado_no_permite_esa_transicion"));
            $column=['in_progress'=>'started_at','arrived'=>'arrived_at','completed'=>'finished_at','cancelled'=>'finished_at'][$status];
            if($status==='in_progress'){
                $s=$this->db->prepare('SELECT staff_id,duty FROM transfer_crew WHERE transfer_id=?');$s->execute([$id]);$crew=[];foreach($s->fetchAll() as $member)$crew[$member['duty']]=(string)$member['staff_id'];
                $f=['ambulance_id'=>(string)$row['ambulance_id'],'patient_id'=>$row['patient_id']===null?null:(string)$row['patient_id'],'driver_id'=>$crew['driver'],'companion_id'=>$crew['companion']??null,'origin_facility_id'=>$row['origin_facility_id']===null?null:(string)$row['origin_facility_id'],'destination_facility_id'=>$row['destination_facility_id']===null?null:(string)$row['destination_facility_id'],'origin_name'=>$row['origin_name'],'origin_address'=>$row['origin_address'],'destination_name'=>$row['destination_name'],'destination_address'=>$row['destination_address']];
                // Resources must still be eligible; endpoint/route snapshots belong to this trace.
                $snapshot=$row;$snapshot['patient_id']=null;
                $c=$this->catalog($f,$snapshot);
                $c['route']=['duration_seconds'=>$row['duration_seconds']];
                $end=$this->reserve($f,$c,$id,gmdate('Y-m-d H:i:s'),true);$s=$this->db->prepare('UPDATE transfers SET reserved_until=? WHERE id=?');$s->execute([$end,$id]);
                (new TrackingService($this->db,$this->config))->sample($id,json_decode($row['geometry'],true),0,null,1);
            }
            if($status==='arrived')(new TrackingService($this->db,$this->config))->sample($id,json_decode($row['geometry'],true),1,null,1);
            $s=$this->db->prepare('UPDATE transfers SET status=?,'.$column.'=UTC_TIMESTAMP(),version=version+1,updated_at=UTC_TIMESTAMP() WHERE id=?');$s->execute([$status,$id]);
            if(in_array($status,['completed','cancelled'],true)){$s=$this->db->prepare('DELETE FROM resource_reservations WHERE transfer_id=?');$s->execute([$id]);}
            $this->event($id,$actor,'status_changed',$row['status'],$status);$this->access->audit($actor,'transfer.'.$status,$id);
        });return $this->get($actor,$id);
    }
    public function payload(array $row,bool $detail=false):array
    {
        $s=$this->db->prepare('SELECT staff_id,duty,name_snapshot,responsibility FROM transfer_crew WHERE transfer_id=? ORDER BY duty');$s->execute([$row['id']]);$crew=[];
        foreach($s->fetchAll() as $member)$crew[$member['duty']]=['id'=>(string)$member['staff_id'],'name'=>$member['name_snapshot'],'responsibility'=>$member['responsibility']];
        $elapsed=$row['started_at']===null?0:max(0,strtotime(($row['finished_at']??$row['arrived_at']??gmdate('Y-m-d H:i:s')).' UTC')-strtotime($row['started_at'].' UTC'));
        $delayed=$row['status']==='in_progress'&&(($row['duration_seconds']!==null && $elapsed>(int)$row['duration_seconds'])||strtotime($row['started_at'].' UTC')>strtotime($row['scheduled_at'].' UTC')+300);
        $data=['id'=>(string)$row['id'],'code'=>'TR-'.str_pad((string)$row['id'],6,'0',STR_PAD_LEFT),'version'=>(int)$row['version'],'status'=>$row['status'],'is_delayed'=>$delayed,'cargo_type'=>$row['cargo_type'],'priority'=>$row['priority'],'reason'=>$row['reason'],'ambulance'=>['id'=>(string)$row['ambulance_id'],'code'=>$row['ambulance_code'],'plate'=>$row['ambulance_plate']],'crew'=>$crew,'origin'=>['id'=>$row['origin_facility_id']===null?null:(string)$row['origin_facility_id'],'name'=>$row['origin_name'],'address'=>$row['origin_address']],'destination'=>['id'=>$row['destination_facility_id']===null?null:(string)$row['destination_facility_id'],'name'=>$row['destination_name'],'address'=>$row['destination_address']],'scheduled_at'=>UserRepository::date($row['scheduled_at']),'started_at'=>UserRepository::date($row['started_at']),'arrived_at'=>UserRepository::date($row['arrived_at']),'finished_at'=>UserRepository::date($row['finished_at']),'created_at'=>UserRepository::date($row['created_at']),'updated_at'=>UserRepository::date($row['updated_at']),'duration_seconds'=>$row['duration_seconds']===null?null:(int)$row['duration_seconds'],'distance_meters'=>$row['distance_meters']===null?null:(int)$row['distance_meters'],'elapsed_seconds'=>$elapsed,'eta'=>$row['duration_seconds']===null?null:UserRepository::date(gmdate('Y-m-d H:i:s',strtotime(($row['started_at']??$row['scheduled_at']).' UTC')+(int)$row['duration_seconds']))];
        if($detail){
            $data['notes']=$row['notes'];$data['route_template_id']=$row['route_template_id']===null?null:(string)$row['route_template_id'];$data['geometry']=json_decode($row['geometry'],true,32,JSON_THROW_ON_ERROR);$data['route_snapshot']=$row['route_snapshot']===null?null:json_decode($row['route_snapshot'],true,32,JSON_THROW_ON_ERROR);
            foreach(['special_equipment','with_family','interdepartmental','critical_patient'] as $key)$data[$key]=(bool)$row[$key];
            $data['patient']=null;
            if($row['patient_id']!==null){$s=$this->db->prepare('SELECT * FROM patients WHERE id=?');$s->execute([$row['patient_id']]);$patient=$s->fetch();$data['patient']=TransferCatalog::patient($patient);}
            $s=$this->db->prepare('SELECT id,event_type,from_status,to_status,created_at FROM transfer_events WHERE transfer_id=? ORDER BY id DESC LIMIT 100');$s->execute([$row['id']]);$events=array_reverse($s->fetchAll());
            foreach($events as &$event){$event['id']=(string)$event['id'];$event['created_at']=UserRepository::date($event['created_at']);}unset($event);$data['events']=$events;
            $data['position']=(new TrackingService($this->db,$this->config))->latest((string)$row['id']);
        }return $data;
    }
    public function get(string $actor,string $id):array
    {
        $data=$this->payload($this->row($actor,$id),true);$data['can_manage']=$this->access->dispatch($actor);return $data;
    }
    public function listing(string $actor,array $query):array
    {
        if(array_diff(array_keys($query),['page','page_size','state','type','sort','q']))throw new ApiException(422,'UNEXPECTED_FIELDS',\Hospital\I18n::t("errors.filtro_no_permitido"));
        $page=$query['page']??'1';$size=$query['page_size']??'20';
        if(!is_scalar($page)||!preg_match('/^[1-9][0-9]{0,5}$/',(string)$page)||!is_scalar($size)||!preg_match('/^[1-9][0-9]{0,2}$/',(string)$size)||(int)$size>100)throw new ApiException(422,'VALIDATION_FAILED',\Hospital\I18n::t("errors.paginacion_no_valida"));
        $args=[];$scope=$this->access->scope($actor,$args);
        $s=$this->db->prepare("SELECT COUNT(*) AS all_count,COALESCE(SUM(t.status IN ('scheduled','in_progress','arrived')),0) AS active_count,COALESCE(SUM(t.status='completed'),0) AS completed_count FROM transfers t WHERE ".$scope);$s->execute($args);$counts=$s->fetch();$counts=array_map('intval',$counts);
        $where=[$scope];$state=TransferInput::choice($query['state']??'active',['active','completed','all']);
        if($state==='active')$where[]="t.status IN ('scheduled','in_progress','arrived')";elseif($state==='completed')$where[]="t.status='completed'";
        $type=TransferInput::choice($query['type']??'all',['all','patient','biological','equipment']);if($type!=='all'){$where[]='t.cargo_type=?';$args[]=$type;}
        $q=\Hospital\Modules\Settings\SettingsService::text($query['q']??'','q',150);
        if($q!==''){$pattern='%'.str_replace(['!','%','_'],['!!','!%','!_'],$q).'%';$where[]="(t.ambulance_code LIKE ? ESCAPE '!' OR t.origin_name LIKE ? ESCAPE '!' OR t.destination_name LIKE ? ESCAPE '!' OR CONCAT('TR-',LPAD(t.id,6,'0')) LIKE ? ESCAPE '!' OR EXISTS(SELECT 1 FROM transfer_crew c WHERE c.transfer_id=t.id AND c.name_snapshot LIKE ? ESCAPE '!'))";array_push($args,$pattern,$pattern,$pattern,$pattern,$pattern);}
        $sort=TransferInput::choice($query['sort']??'recent',['recent','oldest']);$order=$sort==='recent'?'DESC':'ASC';$condition=implode(' AND ',$where);
        $s=$this->db->prepare('SELECT COUNT(*) FROM transfers t WHERE '.$condition);$s->execute($args);$total=(int)$s->fetchColumn();
        $offset=((int)$page-1)*(int)$size;
        $s=$this->db->prepare('SELECT t.* FROM transfers t WHERE '.$condition.' ORDER BY t.scheduled_at '.$order.',t.id '.$order.' LIMIT '.(int)$size.' OFFSET '.$offset);$s->execute($args);
        return ['data'=>array_map(fn(array $row):array=>$this->payload($row),$s->fetchAll()),'meta'=>['page'=>(int)$page,'page_size'=>(int)$size,'total'=>$total,'counts'=>$counts,'can_manage'=>$this->access->dispatch($actor)]];
    }
}
