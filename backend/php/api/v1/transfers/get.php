<?php
declare(strict_types=1);
require dirname(__DIR__,3).'/bootstrap.php';
use Hospital\Http\Request;
use Hospital\Http\Response;
use Hospital\Modules\Transfers\TransferInput;
$service=new Hospital\Modules\Transfers\TransferService($db,$config);
Request::method('GET'); $user=$auth->requireUser(false);
if(array_diff(array_keys($_GET),['id']))throw new Hospital\Http\ApiException(422,'UNEXPECTED_FIELDS','Parámetro no permitido.');
Response::json($service->get((string)$user['id'],Request::id($_GET['id']??null)));
