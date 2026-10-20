<?php
declare(strict_types=1);
require dirname(__DIR__, 3) . '/bootstrap.php';
use Hospital\Http\Request;
Request::method('POST'); Hospital\Security\Csrf::verify(); $user = $auth->requireUser(true);
$body = Request::body(['id', 'version', 'file_version', 'action', 'token']);
$action = $body['action'] ?? '';
if (!in_array($action, ['create', 'revoke'], true) || ($action === 'revoke' && (!is_string($body['token'] ?? null) || !preg_match('/^[a-f0-9]{64}$/', $body['token']))) || ($action === 'create' && array_key_exists('token', $body))) {
    throw new Hospital\Http\ApiException(422, 'VALIDATION_FAILED', Hospital\I18n::t("errors.accion_no_valida"));
}
$service = new Hospital\Modules\Documents\DocumentService($db, $config);
Hospital\Http\Response::json($service->patientLink((string) $user['id'], Request::id($body['id'] ?? null), $body['version'] ?? null, Request::id($body['file_version'] ?? null), $action === 'revoke' ? $body['token'] : null));
