<?php
declare(strict_types=1);
require dirname(__DIR__,3).'/bootstrap.php';
use Hospital\Http\Request;
use Hospital\Http\Response;
use Hospital\Modules\Surveys\SurveyService;
use Hospital\Modules\Surveys\SurveyInput;
$service=new SurveyService($db,$config);
Request::method('POST');Hospital\Security\Csrf::verify();$user=$auth->requireUser(true);$actor=(string)$user['id'];
$body=Request::body(['id','version','action']);$action=SurveyInput::choice($body['action']??null,['publish','close','reopen','archive','restore']);
Response::json($service->transition($actor,Request::id($body['id']??null),$body['version']??null,$action));
