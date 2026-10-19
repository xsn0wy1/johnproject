<?php
declare(strict_types=1);
require dirname(__DIR__, 3) . '/bootstrap.php';
use Hospital\Http\Request;
use Hospital\Http\Response;
use Hospital\Modules\Doctors\DoctorInput;
use Hospital\Modules\Patients\PatientInput;
$service = new Hospital\Modules\Doctors\DoctorService($db, $config);
Request::method('POST'); Hospital\Security\Csrf::verify(); $user=$auth->requireUser(true); $actor=(string)$user['id']; $service->access($actor);
if (array_diff(array_keys($_GET), [])) throw new Hospital\Http\ApiException(422,'UNEXPECTED_FIELDS',\Hospital\I18n::t("errors.filtro_no_permitido"));
$body=Request::body(DoctorInput::FIELDS);
Response::json($service->save($actor,$body),201);
