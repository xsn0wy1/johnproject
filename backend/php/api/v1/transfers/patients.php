<?php
declare(strict_types=1);
require dirname(__DIR__,3).'/bootstrap.php';
use Hospital\Http\Request;
use Hospital\Http\Response;
use Hospital\Modules\Transfers\TransferInput;
$service=new Hospital\Modules\Transfers\TransferService($db,$config);
Request::method('POST'); Hospital\Security\Csrf::verify(); $user=$auth->requireUser(false);
(new Hospital\Modules\Transfers\TransferAccess($db,$config))->requireDispatch((string)$user['id']);
if($_GET)throw new Hospital\Http\ApiException(422,'UNEXPECTED_FIELDS','Parámetro no permitido.');
$body=Request::body(['q']); Response::json((new Hospital\Modules\Transfers\TransferCatalog($db))->patients($body['q']??''));
