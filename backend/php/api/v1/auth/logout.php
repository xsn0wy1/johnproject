<?php
declare(strict_types=1);
require dirname(__DIR__, 3) . '/bootstrap.php';
use Hospital\Http\Request;
use Hospital\Http\Response;
use Hospital\Security\Csrf;

Request::method('POST');
Csrf::verify();
$auth->logout();
Response::json(['logged_out' => true]);

