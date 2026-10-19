<?php
declare(strict_types=1);
namespace Hospital\Modules\Transfers;
use Hospital\Http\ApiException;
use Hospital\Http\Request;
use Hospital\Modules\Auth\UserRepository;

final class TrackingService
{
    private \PDO $db;
    private array $config;
    private TransferAccess $access;
    public function __construct(\PDO $db,array $config){$this->db=$db;$this->config=$config;$this->access=new TransferAccess($db,$config);}
    private function position(array $row):array
    {
        return ['id'=>(string)$row['id'],'transfer_id'=>(string)$row['transfer_id'],'run_id'=>$row['run_id']===null?null:(string)$row['run_id'],'generation'=>(int)$row['generation'],'progress'=>(float)$row['progress'],'latitude'=>(float)$row['latitude'],'longitude'=>(float)$row['longitude'],'recorded_at'=>UserRepository::date($row['recorded_at']),'source'=>'simulated'];
    }
    public function latest(string $id):?array
    {
        $s=$this->db->prepare('SELECT p.* FROM transfer_latest_positions l JOIN transfer_positions p ON p.id=l.position_id WHERE l.transfer_id=?');$s->execute([$id]);$row=$s->fetch();return $row?$this->position($row):null;
    }
    public function sample(string $id,array $points,float $progress,?string $run,int $generation):void
    {
        if (count($points)<2) { $s=$this->db->prepare('DELETE FROM transfer_latest_positions WHERE transfer_id=?'); $s->execute([$id]); return; }
        $progress=max(0,min(1,$progress));$lengths=[];$total=0;
        for($i=1;$i<count($points);$i++){$length=TransferInput::distance($points[$i-1],$points[$i]);$lengths[]=$length;$total+=$length;}
        $remaining=$total*$progress;$point=$points[count($points)-1];
        foreach($lengths as $i=>$length){if($remaining<=$length){$fraction=$length>0?$remaining/$length:0;$point=['latitude'=>$points[$i]['latitude']+($points[$i+1]['latitude']-$points[$i]['latitude'])*$fraction,'longitude'=>$points[$i]['longitude']+($points[$i+1]['longitude']-$points[$i]['longitude'])*$fraction];break;}$remaining-=$length;}
        $s=$this->db->prepare('INSERT INTO transfer_positions (transfer_id,run_id,generation,progress,latitude,longitude) VALUES (?,?,?,?,?,?)');$s->execute([$id,$run,$generation,$progress,$point['latitude'],$point['longitude']]);$position=$this->db->lastInsertId();
        $s=$this->db->prepare('INSERT INTO transfer_latest_positions (transfer_id,position_id) VALUES (?,?) ON DUPLICATE KEY UPDATE position_id=VALUES(position_id)');$s->execute([$id,$position]);
    }
    public function status():array
    {
        $row=$this->db->query('SELECT s.version AS state_version,r.* FROM simulation_state s LEFT JOIN simulation_runs r ON r.id=s.current_run_id WHERE s.id=1')->fetch();
        $heartbeat=$row['heartbeat_at']===null?null:strtotime($row['heartbeat_at'].' UTC');
        return ['version'=>(int)$row['state_version'],'run_id'=>$row['id']===null?null:(string)$row['id'],'status'=>$row['status']??'stopped','speed'=>$row['speed']===null?1:(float)$row['speed'],'generation'=>$row['generation']===null?1:(int)$row['generation'],'heartbeat_at'=>UserRepository::date($row['heartbeat_at']),'stale'=>$heartbeat===null||time()-$heartbeat>15,'source'=>'simulated'];
    }
    /** Explicit administrator/CLI controls only; GET requests never advance time. */
    public function control(string $command,$version,$speed=1,?string $actor=null):array
    {
        TransferInput::choice($command,['start','pause','resume','stop','reset']);
        if((!is_int($speed)&&!is_float($speed))||!is_finite((float)$speed)||$speed<0.1||$speed>100)throw new ApiException(422,'VALIDATION_FAILED',\Hospital\I18n::t("errors.velocidad_de_simulacion_no_valida"));
        $this->access->serialized(function()use($command,$version,$speed,$actor){
            $this->db->beginTransaction();
            try{
                if($actor!==null){$user=(new UserRepository($this->db))->byId($actor,true);if(!$user||$user['status']!=='active'||$user['staff_status']!=='active'||(int)$user['auth_version']!==(int)($_SESSION['auth_version']??0))throw new ApiException(401,'SESSION_EXPIRED',\Hospital\I18n::t("errors.la_sesion_vencio"));if(!in_array('admin',(new UserRepository($this->db))->roles($actor),true))throw new ApiException(403,'FORBIDDEN',\Hospital\I18n::t("errors.se_requiere_administracion"));}
                $state=$this->db->query('SELECT * FROM simulation_state WHERE id=1 FOR UPDATE')->fetch();
                if((int)$state['version']!==TransferInput::version($version))throw new ApiException(409,'VERSION_CONFLICT',\Hospital\I18n::t("errors.la_simulacion_cambio"));
                $run=null;if($state['current_run_id']!==null){$s=$this->db->prepare('SELECT * FROM simulation_runs WHERE id=? FOR UPDATE');$s->execute([$state['current_run_id']]);$run=$s->fetch();}
                if($command==='start'){
                    if($run&&$run['status']!=='stopped')throw new ApiException(409,'SIMULATION_STATE',\Hospital\I18n::t("errors.la_simulacion_ya_esta_iniciada"));
                    $s=$this->db->prepare("INSERT INTO simulation_runs (speed) VALUES (?)");$s->execute([$speed]);$id=$this->db->lastInsertId();$s=$this->db->prepare('UPDATE simulation_state SET current_run_id=?,version=version+1 WHERE id=1');$s->execute([$id]);
                }else{
                    if(!$run||$run['status']==='stopped'||($command==='pause'&&$run['status']!=='running')||($command==='resume'&&$run['status']!=='paused'))throw new ApiException(409,'SIMULATION_STATE',\Hospital\I18n::t("errors.el_estado_de_la_simulacion_no_permite_esa_accion"));
                    $status=['pause'=>'paused','resume'=>'running','stop'=>'stopped','reset'=>$run['status']][$command];
                    $s=$this->db->prepare('UPDATE simulation_runs SET status=?,last_tick_at=NULL,version=version+1,generation=generation+? WHERE id=?');$s->execute([$status,$command==='reset'?1:0,$run['id']]);
                    if($command==='reset'){
                        $rows=$this->db->query("SELECT id,geometry FROM transfers WHERE status='in_progress' ORDER BY id FOR UPDATE")->fetchAll();
                        foreach($rows as $row)$this->sample((string)$row['id'],json_decode($row['geometry'],true),0,(string)$run['id'],(int)$run['generation']+1);
                    }
                    $this->db->exec('UPDATE simulation_state SET version=version+1 WHERE id=1');
                }
                $this->access->audit($actor,'simulation.'.$command,null,'simulation');$this->db->commit();
            }catch(\Throwable $e){if($this->db->inTransaction())$this->db->rollBack();throw $e;}
        });return $this->status();
    }
    public function tick():int
    {
        return $this->access->serialized(function(){
            $this->db->beginTransaction();
            try{
                $s=$this->db->query('SELECT r.*,UTC_TIMESTAMP() AS now_utc FROM simulation_state s JOIN simulation_runs r ON r.id=s.current_run_id WHERE s.id=1 FOR UPDATE');$run=$s->fetch();
                if(!$run||$run['status']==='stopped'){$this->db->commit();return 0;}
                $seconds=$run['last_tick_at']===null?0:max(0,min(5,strtotime($run['now_utc'].' UTC')-strtotime($run['last_tick_at'].' UTC')));
                $s=$this->db->prepare('UPDATE simulation_runs SET heartbeat_at=UTC_TIMESTAMP(),last_tick_at=UTC_TIMESTAMP() WHERE id=?');$s->execute([$run['id']]);$count=0;
                if($run['status']==='running'){
                    $rows=$this->db->query("SELECT t.*,p.progress FROM transfers t LEFT JOIN transfer_latest_positions l ON l.transfer_id=t.id LEFT JOIN transfer_positions p ON p.id=l.position_id WHERE t.status='in_progress' ORDER BY t.id FOR UPDATE")->fetchAll();
                    foreach($rows as $row){
                        if ($row['duration_seconds']===null || (int)$row['duration_seconds']<=0) continue;
                        $progress=min(1,(float)($row['progress']??0)+$seconds*(float)$run['speed']/(int)$row['duration_seconds']);
                        $this->sample((string)$row['id'],json_decode($row['geometry'],true),$progress,(string)$run['id'],(int)$run['generation']);$count++;
                        if($progress>=1){$s=$this->db->prepare("UPDATE transfers SET status='arrived',arrived_at=UTC_TIMESTAMP(),version=version+1,updated_at=UTC_TIMESTAMP() WHERE id=?");$s->execute([$row['id']]);(new TransferService($this->db,$this->config))->event((string)$row['id'],null,'simulation_arrived','in_progress','arrived');$this->access->audit(null,'transfer.simulation_arrived',(string)$row['id']);}
                    }
                }
                $this->db->commit();return $count;
            }catch(\Throwable $e){if($this->db->inTransaction())$this->db->rollBack();throw $e;}
        });
    }
    public function snapshot(string $actor,array $query):array
    {
        if(array_diff(array_keys($query),['after_id','transfer_id']))throw new ApiException(422,'UNEXPECTED_FIELDS',\Hospital\I18n::t("errors.filtro_no_permitido"));
        $args=[];$scope=$this->access->scope($actor,$args);$where=[$scope];
        if(isset($query['transfer_id'])){$where[]='t.id=?';$args[]=Request::id($query['transfer_id']);(new TransferService($this->db,$this->config))->row($actor,(string)$args[count($args)-1]);}
        else $where[]="t.status IN ('scheduled','in_progress','arrived')";
        if(isset($query['after_id'])){$where[]='t.id>?';$args[]=Request::id($query['after_id']);}
        $s=$this->db->prepare('SELECT t.* FROM transfers t WHERE '.implode(' AND ',$where).' ORDER BY t.id LIMIT 101');$s->execute($args);$rows=$s->fetchAll();$more=count($rows)>100;$rows=array_slice($rows,0,100);$service=new TransferService($this->db,$this->config);
        $data=[];foreach($rows as $row){$item=$service->payload($row);unset($item['crew']);$item['geometry']=json_decode($row['geometry'],true);$item['position']=$this->latest((string)$row['id']);$data[]=$item;}
        return ['transfers'=>$data,'next_cursor'=>$more?(string)$rows[count($rows)-1]['id']:null,'server_time'=>gmdate('Y-m-d\TH:i:s\Z'),'simulation'=>$this->status()];
    }
    public function history(string $actor,array $query):array
    {
        if(array_diff(array_keys($query),['transfer_id','after_id','limit']))throw new ApiException(422,'UNEXPECTED_FIELDS',\Hospital\I18n::t("errors.filtro_no_permitido"));
        $id=Request::id($query['transfer_id']??null);(new TransferService($this->db,$this->config))->row($actor,$id);
        $after=isset($query['after_id'])?Request::id($query['after_id']):'0';$limit=$query['limit']??'100';
        if(!is_scalar($limit)||!preg_match('/^[1-9][0-9]{0,3}$/',(string)$limit)||(int)$limit>1000)throw new ApiException(422,'VALIDATION_FAILED',\Hospital\I18n::t("errors.limite_no_valido"));
        $s=$this->db->prepare('SELECT * FROM transfer_positions WHERE transfer_id=? AND id>? ORDER BY id LIMIT '.((int)$limit+1));$s->execute([$id,$after]);$rows=$s->fetchAll();$more=count($rows)>(int)$limit;$rows=array_slice($rows,0,(int)$limit);
        return ['positions'=>array_map(fn(array $row):array=>$this->position($row),$rows),'next_cursor'=>$more?(string)$rows[count($rows)-1]['id']:null,'source'=>'simulated'];
    }
    public function prune():int
    {
        return $this->db->exec('DELETE FROM transfer_positions WHERE recorded_at<UTC_TIMESTAMP()-INTERVAL 7 DAY AND id NOT IN (SELECT position_id FROM transfer_latest_positions) LIMIT 1000');
    }
}
