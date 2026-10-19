<?php
declare(strict_types=1);
require dirname(__DIR__,4).'/bootstrap.php';
use Hospital\Http\Request;
use Hospital\Http\Response;
use Hospital\Modules\Surveys\SurveyService;
use Hospital\Modules\Surveys\SurveyInput;
$service=new SurveyService($db,$config);
Request::method('POST');
$body=Request::body(['token']);$token=SurveyInput::text($body['token']??'',64,true);
(new Hospital\Security\RateLimiter($db,$config['app_key']))->consume('survey-read:'.($_SERVER['REMOTE_ADDR']??''),180,600);
if ($service->audience($token)==='staff')$auth->requireUser(false);
Response::json($service->publicGet($token));
