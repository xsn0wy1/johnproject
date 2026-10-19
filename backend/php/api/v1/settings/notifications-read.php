<?php
declare(strict_types=1);
require dirname(__DIR__, 3) . '/bootstrap.php';
use Hospital\Http\Request;
use Hospital\Http\Response;
use Hospital\Security\Csrf;
use Hospital\Modules\Settings\SettingsService;

Request::method('POST'); Csrf::verify();
$user = $auth->requireUser(); $body = Request::body(['through_id']);
(new SettingsService($db))->readNotifications((string) $user['id'], Request::id($body['through_id'] ?? null));
Response::json(['read' => true]);
