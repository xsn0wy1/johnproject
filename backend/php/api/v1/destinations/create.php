<?php
declare(strict_types=1);
require dirname(__DIR__, 3) . '/bootstrap.php';
use Hospital\Http\Request;
use Hospital\Http\Response;
use Hospital\Modules\Destinations\DestinationService;
use Hospital\Modules\Transfers\TransferInput;
$service = new DestinationService($db, $config);
Request::method('POST'); Hospital\Security\Csrf::verify(); $user=$auth->requireUser(true); $actor=(string)$user['id']; $service->access($actor);
if (array_diff(array_keys($_GET), [])) throw new Hospital\Http\ApiException(422,'UNEXPECTED_FIELDS','Filtro no permitido.');
$body=Request::body(DestinationService::FIELDS);
Response::json($service->save($actor,$body),201);
