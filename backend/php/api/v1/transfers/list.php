<?php
declare(strict_types=1);
require dirname(__DIR__,3).'/bootstrap.php';
use Hospital\Http\Request;
use Hospital\Http\Response;
use Hospital\Modules\Transfers\TransferInput;
$service=new Hospital\Modules\Transfers\TransferService($db,$config);
Request::method('POST'); Hospital\Security\Csrf::verify(); $user=$auth->requireUser(false);
$body=Request::body(['page','page_size','state','type','sort','q']);
$result=$service->listing((string)$user['id'],$body); Response::json($result['data'],200,$result['meta']);
