<?php
declare(strict_types=1);
require dirname(__DIR__,3).'/bootstrap.php';
use Hospital\Http\Request;
use Hospital\Http\Response;
use Hospital\Modules\Transfers\TransferInput;
$service=new Hospital\Modules\Transfers\TransferService($db,$config);
Request::method('GET','POST'); $user=$auth->requireUser(false);
$draft=new Hospital\Modules\Transfers\TransferDraft($db,$config);
if($_SERVER['REQUEST_METHOD']==='GET'){Response::json($draft->get((string)$user['id']));return;}
Hospital\Security\Csrf::verify(); $body=Request::body(['version','payload','clear'],['payload']);
if(isset($body['clear'])&&!is_bool($body['clear']))throw new Hospital\Http\ApiException(422,'VALIDATION_FAILED',\Hospital\I18n::t("errors.opcion_no_valida"));
Response::json($draft->save((string)$user['id'],$body,$body['clear']??false));
