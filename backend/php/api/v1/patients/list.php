<?php
declare(strict_types=1);
require dirname(__DIR__, 3) . '/bootstrap.php';
use Hospital\Http\Request;
use Hospital\Http\Response;
use Hospital\Security\Csrf;
use Hospital\Modules\Patients\PatientInput;
$service = new Hospital\Modules\Patients\PatientService($db, $config);
Request::method('POST'); Csrf::verify(); $user=$auth->requireUser(false); $actor=(string)$user['id']; $service->access($actor);
if ($_GET) throw new Hospital\Http\ApiException(422,'UNEXPECTED_FIELDS',\Hospital\I18n::t("errors.filtro_no_permitido"));
$body=Request::body(['q','care_status','state','page','page_size']);
$result=$service->listing($actor,$body);
Response::json($result['data'],200,$result['meta']);
