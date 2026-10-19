<?php
declare(strict_types=1);
require dirname(__DIR__,3).'/bootstrap.php';
use Hospital\Http\Request;
use Hospital\Http\Response;
use Hospital\Modules\Surveys\SurveyService;
use Hospital\Modules\Surveys\SurveyInput;
$service=new SurveyService($db,$config);
Request::method('GET');$user=$auth->requireUser(false);$actor=(string)$user['id'];
Response::json($service->get($actor,Request::id($_GET['id']??null)));
