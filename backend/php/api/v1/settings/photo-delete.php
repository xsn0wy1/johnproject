<?php
declare(strict_types=1);
require dirname(__DIR__, 3) . '/bootstrap.php';
use Hospital\Http\Request;
use Hospital\Http\Response;
use Hospital\Security\Csrf;
use Hospital\Modules\Settings\SettingsService;

Request::method('POST'); Csrf::verify();
$user = $auth->requireUser(); $body = Request::body(['version']);
(new Hospital\Modules\Settings\AvatarService($db, $config))->replace((string) $user['id'], $body['version'] ?? null, null);
Response::json($auth->payload($auth->requireUser(false)));
