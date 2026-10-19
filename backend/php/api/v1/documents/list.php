<?php
declare(strict_types=1);
require dirname(__DIR__, 3) . '/bootstrap.php';
use Hospital\Http\Request;
use Hospital\Http\Response;
$service = new Hospital\Modules\Documents\DocumentService($db, $config);
Request::method('GET'); $user = $auth->requireUser(false);
$result = $service->listing((string) $user['id'], $_GET);
Response::json($result['items'], 200, ['page' => $result['page'], 'page_size' => $result['page_size'], 'total' => $result['total']]);

