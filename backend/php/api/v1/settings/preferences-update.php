<?php
declare(strict_types=1);
require dirname(__DIR__, 3) . '/bootstrap.php';
use Hospital\Http\Request;
use Hospital\Http\Response;
use Hospital\Security\Csrf;
use Hospital\Modules\Settings\SettingsService;

Request::method('POST'); Csrf::verify();
$user = $auth->requireUser();
$body = Request::body(['version', 'locale', 'theme', 'photo_visible_to_staff', 'optional_diagnostics', 'security_notifications', 'automatic_logout'], []);
(new SettingsService($db))->preferences((string) $user['id'], $body);
Response::json($auth->payload($auth->requireUser(false)));
