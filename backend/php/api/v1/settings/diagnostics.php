<?php
declare(strict_types=1);
require dirname(__DIR__, 3) . '/bootstrap.php';
use Hospital\Http\Request;
use Hospital\Http\Response;
use Hospital\Security\Csrf;
use Hospital\Modules\Settings\SettingsService;

Request::method('POST'); Csrf::verify();
$user = $auth->requireUser(false); $body = Request::body(['load_ms']);
(new Hospital\Security\RateLimiter($db, $config['app_key']))->consume('diagnostics:' . $user['id'], 60, 3600);
(new SettingsService($db))->diagnostics((string) $user['id'], $body['load_ms'] ?? null);
Response::json(['recorded' => true]);
