<?php
declare(strict_types=1);
require dirname(__DIR__, 4) . '/bootstrap.php';
use Hospital\Http\Request;
use Hospital\Http\Response;
use Hospital\Security\Csrf;

Request::method('GET');
$auth->requireAdmin();
Response::json((new Hospital\Modules\Auth\UserRepository($db))->pending());

