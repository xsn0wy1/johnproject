<?php
declare(strict_types=1);
require dirname(__DIR__,3).'/bootstrap.php';
use Hospital\Http\Request;
use Hospital\Http\Response;
use Hospital\Modules\Transfers\TransferInput;
$service=new Hospital\Modules\Transfers\TransferService($db,$config);
Request::method('POST'); Hospital\Security\Csrf::verify(); $user=$auth->requireUser();
$body=Request::body(array_merge(TransferInput::FIELDS,['create_token','draft_version']));
(new Hospital\Security\RateLimiter($db,$config['app_key']))->consume('transfer-create:'.$user['id'],60,3600);
Response::json($service->create((string)$user['id'],$body),201);
