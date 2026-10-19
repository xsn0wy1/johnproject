<?php
declare(strict_types=1);
require dirname(__DIR__,3).'/bootstrap.php';
Hospital\Http\Request::method('POST');
Hospital\Security\Csrf::verify();
$body=Hospital\Http\Request::body(['token','new_password']);
(new Hospital\Modules\Auth\PasswordService($db,$config))->resetWithToken($body);
$auth->clearSession();
Hospital\Http\Response::json(['changed'=>true,'sign_in_required'=>true]);
