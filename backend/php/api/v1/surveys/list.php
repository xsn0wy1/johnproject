<?php
declare(strict_types=1);
require dirname(__DIR__,3).'/bootstrap.php';
use Hospital\Http\Request;
use Hospital\Http\Response;
use Hospital\Modules\Surveys\SurveyService;
use Hospital\Modules\Surveys\SurveyInput;
$service=new SurveyService($db,$config);
Request::method('GET');$user=$auth->requireUser(false);$actor=(string)$user['id'];
$page=SurveyInput::integer($_GET['page']??1,1,100000);$size=SurveyInput::integer($_GET['page_size']??100,1,100);
[$rows,$total]=$service->listing($actor,$page,$size,($_GET['archived']??'0')==='1');
Response::json($rows,200,['page'=>$page,'page_size'=>$size,'total'=>$total]);
