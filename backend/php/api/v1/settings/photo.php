<?php
declare(strict_types=1);
require dirname(__DIR__, 3) . '/bootstrap.php';
use Hospital\Http\Request;
use Hospital\Http\Response;
use Hospital\Security\Csrf;
use Hospital\Modules\Settings\AvatarService;

$service = new AvatarService($db, $config);
if (($_SERVER['REQUEST_METHOD'] ?? '') === 'GET') {
    $user = $auth->requireUser(false);
    $target = isset($_GET['user_id']) ? Request::id($_GET['user_id']) : (string) $user['id'];
    $file = $service->content((string) $user['id'], $target);
    session_write_close();
    header('Content-Type: image/png'); header('Content-Length: ' . $file['size']);
    header('Content-Disposition: inline; filename="avatar.png"'); readfile($file['path']);
} elseif (($_SERVER['REQUEST_METHOD'] ?? '') === 'POST') {
    Csrf::verify(); $user = $auth->requireUser();
    $body = Request::body(['version'], [], 6 * 1024 * 1024);
    if (array_keys($_FILES) !== ['photo'] || !is_array($_FILES['photo'])) throw new Hospital\Http\ApiException(422, 'INVALID_UPLOAD', 'Se requiere una imagen.');
    $service->replace((string) $user['id'], $body['version'] ?? null, $_FILES['photo']);
    Response::json($auth->payload($auth->requireUser(false)));
} else {
    header('Allow: GET, POST'); throw new Hospital\Http\ApiException(405, 'METHOD_NOT_ALLOWED', 'Método no permitido.');
}
