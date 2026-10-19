<?php
declare(strict_types=1);
require dirname(__DIR__,3).'/bootstrap.php';
use Hospital\Http\Request;
use Hospital\Http\Response;
$service=new Hospital\Modules\Transfers\TrackingService($db,$config);
Request::method('GET'); $user=$auth->requireUser(false);
session_write_close();
Response::json($service->snapshot((string)$user['id'],$_GET));
