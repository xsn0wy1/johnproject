<?php
declare(strict_types=1);
require dirname(__DIR__,3).'/bootstrap.php';
Hospital\Http\Request::method('POST');
Hospital\Security\Csrf::verify();
$body=Hospital\Http\Request::body(['email']);
Hospital\Http\Response::json((new Hospital\Modules\Auth\PasswordService($db,$config))->requestReset($body),202);
