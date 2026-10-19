<?php
declare(strict_types=1);
require dirname(__DIR__, 3) . '/bootstrap.php';
use Hospital\Http\Request;
use Hospital\Http\Response;
use Hospital\Security\Csrf;
use Hospital\Modules\Patients\PatientInput;
$service = new Hospital\Modules\Patients\PatientService($db, $config);
Request::method('GET'); $user=$auth->requireUser(false); $actor=(string)$user['id']; $service->access($actor);
if ($_GET) throw new Hospital\Http\ApiException(422,'UNEXPECTED_FIELDS','Filtro no permitido.');
Response::json($service->catalogs($actor));
