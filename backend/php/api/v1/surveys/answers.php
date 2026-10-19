<?php
declare(strict_types=1);
require dirname(__DIR__,3).'/bootstrap.php';
use Hospital\Http\Request;
use Hospital\Http\Response;
use Hospital\Modules\Surveys\SurveyService;
use Hospital\Modules\Surveys\SurveyInput;
$service=new SurveyService($db,$config);
Request::method('GET');$user=$auth->requireUser(false);$actor=(string)$user['id'];
$page=SurveyInput::integer($_GET['page']??1,1,100000);$size=SurveyInput::integer($_GET['page_size']??3,1,50);
[$rows,$total]=$service->entries($actor,Request::id($_GET['id']??null),SurveyInput::text($_GET['question_id']??'',48,true),SurveyInput::text($_GET['q']??'',150),$page,$size);
Response::json($rows,200,['page'=>$page,'page_size'=>$size,'total'=>$total]);
