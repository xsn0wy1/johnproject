<?php
declare(strict_types=1);
require dirname(__DIR__,4).'/bootstrap.php';
use Hospital\Http\Request;
Request::method('POST');Hospital\Security\Csrf::verify();$actor=$auth->requireAdmin();
$body=Request::body(['user_id','version','action','roles'],['roles']);
$action=$body['action']??null;if(!is_string($action)||!is_array($body['roles']??[]))throw new Hospital\Http\ApiException(422,'VALIDATION_FAILED','Acción no válida.');
(new Hospital\Modules\Auth\AccountAdministration($db))->manage(Request::id($body['user_id']??null),Hospital\Modules\Transfers\TransferInput::version($body['version']??null),$action,$body['roles']??[],(string)$actor['id'],$GLOBALS['request_id']);
Hospital\Http\Response::json(['saved'=>true]);
