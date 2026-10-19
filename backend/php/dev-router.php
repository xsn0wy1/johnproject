<?php
declare(strict_types=1);
// PHP built-in server only. Apache uses the supplied Alias and public/.htaccess.
if (PHP_SAPI !== 'cli-server') { http_response_code(404); exit; }
require_once __DIR__ . '/autoload.php';
try { $config = Hospital\Config::load(); }
catch (Throwable $error) {
    $GLOBALS['request_id'] = bin2hex(random_bytes(12));
    header('Cache-Control: no-store, private');
    header('X-Content-Type-Options: nosniff');
    Hospital\Http\Response::error(new Hospital\Http\ApiException(503, 'SERVICE_UNAVAILABLE', 'Completá la configuración local siguiendo docs/xampp-setup.md.'));
    return;
}
$mount = $config['base_path'];
$path = rawurldecode(parse_url($_SERVER['REQUEST_URI'], PHP_URL_PATH) ?: '/');
if ($mount !== '' && !str_starts_with($path, $mount . '/') && $path !== $mount) { http_response_code(404); exit; }
$path = substr($path, strlen($mount));
if ($path === '' || $path === '/') $path = '/index.html';
if (str_starts_with($path, '/api/v1/')) {
    $relative = substr($path, strlen('/api/v1/'));
    $root = realpath(__DIR__ . '/api/v1');
    $file = realpath($root . '/' . $relative);
    if (!$file || !str_starts_with($file, $root . '/') || !is_file($file) || !preg_match('#^[a-z0-9/-]+\.php$#', $relative)) {
        require __DIR__ . '/api/v1/errors/not-found.php'; return;
    }
    require $file; return;
}
if ($path !== '/src/views/surveys/user-view/survey-user.html' && preg_match('#^/src/views/(?!register-restore/)(.+\.html)$#', $path, $match)) {
    $_GET['view'] = $match[1];
    require __DIR__ . '/api/v1/auth/page.php'; return;
}
$root = realpath(dirname(__DIR__, 2) . '/public');
$file = realpath($root . $path);
$types = ['html' => 'text/html; charset=utf-8', 'js' => 'application/javascript; charset=utf-8', 'mjs' => 'application/javascript; charset=utf-8', 'css' => 'text/css; charset=utf-8', 'wasm' => 'application/wasm', 'bcmap' => 'application/octet-stream', 'ttf' => 'font/ttf', 'pfb' => 'application/octet-stream',
    'svg' => 'image/svg+xml', 'png' => 'image/png', 'jpg' => 'image/jpeg', 'jpeg' => 'image/jpeg', 'ico' => 'image/x-icon', 'woff2' => 'font/woff2'];
$ext = $file ? strtolower(pathinfo($file, PATHINFO_EXTENSION)) : '';
if (!$file || !str_starts_with($file, $root . '/') || !is_file($file) || !isset($types[$ext])) { http_response_code(404); exit; }
header('Content-Type: ' . $types[$ext]);
header('X-Content-Type-Options: nosniff');
if (in_array($ext, ['js', 'mjs', 'css'], true)) header('Cache-Control: no-cache');
if (($_SERVER['REQUEST_METHOD'] ?? 'GET') !== 'HEAD') readfile($file);
