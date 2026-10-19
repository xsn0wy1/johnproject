<?php
declare(strict_types=1);
require dirname(__DIR__, 3) . '/bootstrap.php';
use Hospital\Http\Request;
use Hospital\Http\Response;
$service = new Hospital\Modules\Documents\DocumentService($db, $config);
Request::method('GET'); $auth->requireUser(false);
Response::json(['create_token' => bin2hex(random_bytes(32))]);

