<?php
declare(strict_types=1);
require dirname(__DIR__,4).'/bootstrap.php';
use Hospital\Http\Request;
Request::method('POST');Hospital\Security\Csrf::verify();$actor=$auth->requireAdmin();
$body=Request::body(['user_id','version','new_password']);
(new Hospital\Modules\Auth\PasswordService($db,$config))->change((string)$actor['id'],Request::id($body['user_id']??null),$body,true);
Hospital\Http\Response::json(['changed'=>true]);
