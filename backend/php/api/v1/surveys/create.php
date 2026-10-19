<?php
declare(strict_types=1);
require dirname(__DIR__,3).'/bootstrap.php';
use Hospital\Http\Request;
use Hospital\Http\Response;
use Hospital\Modules\Surveys\SurveyService;
use Hospital\Modules\Surveys\SurveyInput;
$service=new SurveyService($db,$config);
Request::method('POST');Hospital\Security\Csrf::verify();$user=$auth->requireUser(true);$actor=(string)$user['id'];
$body=Request::body(SurveyInput::FIELDS,['config','items'],262144);
Response::json($service->save($actor,$body),201);
