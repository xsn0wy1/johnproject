<?php
declare(strict_types=1);
require dirname(__DIR__,3).'/bootstrap.php';
use Hospital\Http\Request;
use Hospital\Http\Response;
use Hospital\Modules\Transfers\TransferInput;
$service=new Hospital\Modules\Transfers\TransferService($db,$config);
Request::method('POST'); Hospital\Security\Csrf::verify(); $user=$auth->requireUser();
$body=Request::body(array_merge(TransferInput::FIELDS,['id','version','refresh_route']));
Response::json($service->update((string)$user['id'],Request::id($body['id']??null),$body));
