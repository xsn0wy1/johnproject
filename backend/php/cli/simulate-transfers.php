<?php
declare(strict_types=1);
if(PHP_SAPI!=='cli'){http_response_code(404);exit;}
require dirname(__DIR__).'/autoload.php';
try{
    $config=Hospital\Config::load();$db=Hospital\Database::connect($config);$service=new Hospital\Modules\Transfers\TrackingService($db,$config);$command=$argv[1]??'status';
    if($command==='worker'){
        $name=(new Hospital\Modules\Transfers\TransferAccess($db,$config))->lockName('worker');$s=$db->prepare('SELECT GET_LOCK(?,0)');$s->execute([$name]);
        if((int)$s->fetchColumn()!==1)throw new RuntimeException('Another simulation worker already owns this database.');
        $duration=$argv[2]??'0';if(!preg_match('/^[0-9]{1,6}$/',$duration))throw new RuntimeException('Invalid worker duration.');
        $stop=(int)$duration?time()+(int)$duration:PHP_INT_MAX;$ticks=0;
        try{
            do{try{$service->tick();if(++$ticks%20===0)$service->prune();}catch(Hospital\Http\ApiException $e){if($e->errorCode!=='RESOURCE_BUSY')throw $e;fwrite(STDERR,"Simulation tick deferred: resources busy.\n");}if(time()>=$stop)break;sleep(3);}while(time()<$stop);
        }finally{$s=$db->prepare('SELECT RELEASE_LOCK(?)');$s->execute([$name]);}
        echo "Simulation worker stopped.\n";
    }elseif($command==='status')echo json_encode($service->status(),JSON_PRETTY_PRINT|JSON_THROW_ON_ERROR)."\n";
    else{
        $speed=$argv[2]??'1';if(!is_numeric($speed))throw new RuntimeException('Invalid speed.');
        $result=$service->control($command,$service->status()['version'],(float)$speed);
        echo json_encode($result,JSON_PRETTY_PRINT|JSON_THROW_ON_ERROR)."\n";
    }
}catch(Throwable $e){fwrite(STDERR,"Simulation operation failed: ".($e instanceof PDOException?'Check the database connection.':$e->getMessage())."\n");exit(1);}
