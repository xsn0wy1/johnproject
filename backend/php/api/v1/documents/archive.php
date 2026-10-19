<?php
declare(strict_types=1);
require dirname(__DIR__, 3) . '/bootstrap.php';
use Hospital\Http\Request;
use Hospital\Http\Response;
$service = new Hospital\Modules\Documents\DocumentService($db, $config);
Request::method('POST'); Hospital\Security\Csrf::verify(); $user = $auth->requireUser();
$body = Request::body(['id', 'version']);
Response::json($service->archive((string) $user['id'], Request::id($body['id'] ?? null), $body['version'] ?? null));

