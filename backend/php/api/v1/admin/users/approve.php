<?php
declare(strict_types=1);
require dirname(__DIR__, 4) . '/bootstrap.php';
use Hospital\Http\Request;
use Hospital\Http\Response;
use Hospital\Security\Csrf;

Request::method('POST');
Csrf::verify();
$actor = $auth->requireAdmin();
$body = Request::body(['user_id', 'role']);
$id = Request::id($body['user_id'] ?? null);
$role = $body['role'] ?? 'staff';
if (!is_string($role)) throw new Hospital\Http\ApiException(422, 'INVALID_ROLE', \Hospital\I18n::t("errors.el_rol_no_es_valido"));
(new Hospital\Modules\Auth\AccountAdministration($db))->approve($id, $role, (string) $actor['id'], $GLOBALS['request_id']);
Response::json(['user_id' => $id, 'status' => 'active']);

