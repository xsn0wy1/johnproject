<?php
declare(strict_types=1);
// CLI-only test transport: never exposes reset credentials through the web server.
if (PHP_SAPI!=='cli') { http_response_code(404);exit; }
require dirname(__DIR__).'/autoload.php';
$config=Hospital\Config::load();
if (!preg_match('/^hospital_recovery_[a-f0-9]{8}_test$/',$config['db']['name'])) exit(2);
$db=Hospital\Database::connect($config);
$input=json_decode(stream_get_contents(STDIN),true,32,JSON_THROW_ON_ERROR);
$GLOBALS['request_id']='recovery-test';
$_SERVER['REMOTE_ADDR']='recovery-cli';
$_SERVER['HTTP_X_HOSPITAL_LOCALE']=$input['locale']??'es-UY';
$mails=[];
$transport=static function(array $payload) use (&$mails,$db,$config,$input): void {
    if ($db->inTransaction()) throw new LogicException('Delivery inside transaction.');
    $mails[]=$payload;
    if (($input['delivery']??'')==='replace_then_fail') {
        $next=new Hospital\Modules\Auth\BrevoMailer($config,static function(array $new) use (&$mails): void { $mails[]=$new; });
        (new Hospital\Modules\Auth\PasswordService($db,$config,$next))->requestReset(['email'=>$payload['to'][0]['email']]);
    }
    if (in_array($input['delivery']??'',['fail','replace_then_fail'],true)) throw new RuntimeException('A sensitive provider error must never be logged.');
};
$service=new Hospital\Modules\Auth\PasswordService($db,$config,new Hospital\Modules\Auth\BrevoMailer($config,$transport));
try {
    if ($input['action']==='request') $result=$service->requestReset(['email'=>$input['email']]);
    elseif ($input['action']==='reset') { $service->resetWithToken($input['body']);$result=['changed'=>true]; }
    elseif ($input['action']==='change') {
        $_SESSION=['auth_version'=>$input['auth_version']];
        $service->change($input['user_id'],$input['user_id'],$input['body']);$result=['changed'=>true];
    } else exit(2);
    echo json_encode(['status'=>200,'result'=>$result,'mails'=>$mails],JSON_THROW_ON_ERROR);
} catch (Hospital\Http\ApiException $e) {
    echo json_encode(['status'=>$e->status,'code'=>$e->errorCode],JSON_THROW_ON_ERROR);
}
