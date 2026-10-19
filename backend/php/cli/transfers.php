<?php
declare(strict_types=1);
if(PHP_SAPI!=='cli'){http_response_code(404);exit;}
require dirname(__DIR__).'/autoload.php';
try{
    $config=Hospital\Config::load();$db=Hospital\Database::connect($config);$command=$argv[1]??'';
    $catalog=new Hospital\Modules\Transfers\TransferCatalog($db);
    if($command==='catalogs')$result=$catalog->selection();
    elseif(in_array($command,['import','seed-demo'],true)){
        $path=$command==='seed-demo'?dirname(__DIR__,3).'/db/json/fixtures/traces-demo.json':($argv[2]??'');
        if(!is_file($path)||filesize($path)>1048576)throw new RuntimeException('Invalid catalog file.');
        $input=json_decode(file_get_contents($path),true,32,JSON_THROW_ON_ERROR);
        $result=(new Hospital\Modules\Transfers\TransferAccess($db,$config))->serialized(fn()=>$catalog->import($input));
    }else{fwrite(STDERR,"Commands: catalogs | import PRIVATE_JSON_FILE | seed-demo (explicit fictional catalog only)\n");exit(1);}
    echo json_encode($result,JSON_PRETTY_PRINT|JSON_UNESCAPED_UNICODE|JSON_THROW_ON_ERROR)."\n";
}catch(Throwable $e){fwrite(STDERR,"Transfer catalog operation failed. Check the private configuration and input.\n");exit(1);}
