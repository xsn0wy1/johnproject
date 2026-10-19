<?php
declare(strict_types=1);
require dirname(__DIR__, 3) . '/bootstrap.php';
use Hospital\Http\Request;
use Hospital\Http\Response;
use Hospital\Security\Csrf;
use Hospital\Modules\Settings\SettingsService;

Request::method('GET');
$user = $auth->requireUser(false);
Response::json((new SettingsService($db))->notifications((string) $user['id']));
