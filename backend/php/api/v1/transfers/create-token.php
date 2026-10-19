<?php
declare(strict_types=1);
require dirname(__DIR__,3).'/bootstrap.php';
use Hospital\Http\Request;
use Hospital\Http\Response;
use Hospital\Modules\Transfers\TransferInput;
$service=new Hospital\Modules\Transfers\TransferService($db,$config);
Request::method('GET'); $user=$auth->requireUser(false);
(new Hospital\Modules\Transfers\TransferAccess($db,$config))->requireDispatch((string)$user['id']);
Response::json(['create_token'=>bin2hex(random_bytes(32))]);
