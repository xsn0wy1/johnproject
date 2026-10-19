<?php
declare(strict_types=1);
require dirname(__DIR__,3).'/bootstrap.php';
use Hospital\Http\Request;
use Hospital\Http\Response;
$service=new Hospital\Modules\Transfers\TrackingService($db,$config);
Request::method('GET','POST'); $user=$auth->requireAdmin();
if($_SERVER['REQUEST_METHOD']==='GET'){Response::json($service->status());return;}
Hospital\Security\Csrf::verify(); $body=Request::body(['command','version','speed']);
$command=Hospital\Modules\Transfers\TransferInput::choice($body['command']??null,['start','pause','resume','stop','reset']);
Response::json($service->control($command,$body['version']??null,$body['speed']??1,(string)$user['id']));
