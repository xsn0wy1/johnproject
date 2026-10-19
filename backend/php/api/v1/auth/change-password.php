<?php
declare(strict_types=1);
require dirname(__DIR__,3).'/bootstrap.php';
Hospital\Http\Request::method('POST');Hospital\Security\Csrf::verify();$user=$auth->requireUser();
$body=Hospital\Http\Request::body(['current_password','new_password']);
(new Hospital\Modules\Auth\PasswordService($db,$config))->change((string)$user['id'],(string)$user['id'],$body);
$auth->logout();Hospital\Http\Response::json(['changed'=>true,'sign_in_required'=>true]);
