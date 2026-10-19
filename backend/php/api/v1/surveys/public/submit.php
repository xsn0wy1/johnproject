<?php
declare(strict_types=1);
require dirname(__DIR__,4).'/bootstrap.php';
use Hospital\Http\Request;
use Hospital\Http\Response;
use Hospital\Modules\Surveys\SurveyService;
use Hospital\Modules\Surveys\SurveyInput;
$service=new SurveyService($db,$config);
Request::method('POST');
Hospital\Security\Csrf::verify();
$body=Request::body(['token','version','submit_token','participant_name','answers'],['answers'],262144);$token=SurveyInput::text($body['token']??'',64,true);
(new Hospital\Security\RateLimiter($db,$config['app_key']))->consume('survey-submit:'.($_SERVER['REMOTE_ADDR']??''),120,3600);
if ($service->audience($token)==='staff')$auth->requireUser(false);
Response::json($service->submit($token,$body),201);
