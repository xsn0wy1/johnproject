<?php
declare(strict_types=1);
require dirname(__DIR__, 4) . '/bootstrap.php';
use Hospital\Http\Request;
use Hospital\Http\Response;
use Hospital\Security\Csrf;

Request::method('POST');
Csrf::verify();
$actor = $auth->requireAdmin();
$body = Request::body(['user_id']);
$id = Request::id($body['user_id'] ?? null);
(new Hospital\Modules\Auth\AccountAdministration($db))->disable($id, (string) $actor['id'], $GLOBALS['request_id']);
Response::json(['user_id' => $id, 'status' => 'disabled']);

