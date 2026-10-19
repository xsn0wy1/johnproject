<?php
declare(strict_types=1);
namespace Hospital\Modules\Auth;
use Hospital\Http\ApiException;
use Hospital\Modules\Transfers\TransferInput;
use Hospital\I18n;
use Hospital\Security\RateLimiter;

final class PasswordService
{
    private \PDO $db;
    private array $config;
    private BrevoMailer $mailer;
    public function __construct(\PDO $db,array $config,?BrevoMailer $mailer=null) { $this->db=$db;$this->config=$config;$this->mailer=$mailer??new BrevoMailer($config); }

    private function passwordHash($password): string
    {
        if (!is_string($password) || !mb_check_encoding($password,'UTF-8') || mb_strlen($password)<12 || strlen($password)>72 || str_contains($password,"\0")) throw new ApiException(422,'VALIDATION_FAILED',I18n::t('errors.usa_entre_12_caracteres_y_72_bytes'));
        return password_hash($password,PASSWORD_BCRYPT,['cost'=>$this->config['bcrypt_cost']]);
    }

    /** Caller holds the account lock and owns the transaction. */
    private function replacePassword(string $id,string $hash,?string $actor,string $action): void
    {
        $s=$this->db->prepare('UPDATE users SET password_hash=?,auth_version=auth_version+1,version=version+1 WHERE id=?');$s->execute([$hash,$id]);
        $s=$this->db->prepare('DELETE FROM password_reset_tokens WHERE user_id=?');$s->execute([$id]);
        (new SessionRepository($this->db))->revokeAll($id);
        (new UserRepository($this->db))->audit($actor,$action,$id,$GLOBALS['request_id']??'cli');
    }

    private function recoveryEligible(?array $user): bool
    {
        return $user!==null && ($user['status']==='pending' || ($user['status']==='active' && $user['staff_status']==='active'));
    }

    public function requestReset(array $input): array
    {
        $email=is_string($input['email']??null)?strtolower(trim($input['email'])):'';
        if (strlen($email)>254 || !filter_var($email,FILTER_VALIDATE_EMAIL)) throw new ApiException(422,'VALIDATION_FAILED',I18n::t('errors.email_no_valido'),['email'=>I18n::t('errors.ingresa_un_email_valido')]);
        // Check global availability before discovering whether this address exists.
        $this->mailer->requireConfiguration();
        $limiter=new RateLimiter($this->db,$this->config['app_key']);
        $limiter->consume('reset-request-ip:'.($_SERVER['REMOTE_ADDR']??'local'),20,3600);
        $limiter->consume('reset-request-email:'.$email,3,900);
        $result=['requested'=>true,'message'=>I18n::t('recovery.requested')];
        $s=$this->db->prepare('SELECT id FROM users WHERE email=?');$s->execute([$email]);$id=$s->fetchColumn();
        if ($id===false) return $result;
        $token=bin2hex(random_bytes(32));$hash=hash('sha256',$token);
        $this->db->beginTransaction();
        try {
            // Every reset path locks user before token, also serializing email edits.
            $user=(new UserRepository($this->db))->byId((string)$id,true);
            if (!$this->recoveryEligible($user) || $user['email']!==$email) { $this->db->commit();return $result; }
            $s=$this->db->prepare('INSERT INTO password_reset_tokens (user_id,token_hash,auth_version,created_at,expires_at) VALUES (?,?,?,UTC_TIMESTAMP(),UTC_TIMESTAMP()+INTERVAL 30 MINUTE) ON DUPLICATE KEY UPDATE token_hash=VALUES(token_hash),auth_version=VALUES(auth_version),created_at=VALUES(created_at),expires_at=VALUES(expires_at)');
            $s->execute([$id,$hash,$user['auth_version']]);
            (new UserRepository($this->db))->audit(null,'account.password_reset_requested',(string)$id,$GLOBALS['request_id']??'cli');
            $this->db->commit();
        } catch (\Throwable $e) { if ($this->db->inTransaction())$this->db->rollBack();throw $e; }
        $url=$this->config['app_url'].'src/views/register-restore/restore-password.html'.(I18n::locale()==='en'?'?lang=en':'').'#token='.$token;
        try { $this->mailer->sendReset($email,$url); }
        catch (\Throwable $e) {
            // A slower failed send must never delete a newer request's token.
            $s=$this->db->prepare('DELETE FROM password_reset_tokens WHERE user_id=? AND token_hash=?');$s->execute([$id,$hash]);
            error_log('Hospital password recovery delivery failed; request '.($GLOBALS['request_id']??'cli'));
        }
        return $result;
    }

    public function resetWithToken(array $input): void
    {
        (new RateLimiter($this->db,$this->config['app_key']))->consume('reset-password-ip:'.($_SERVER['REMOTE_ADDR']??'local'),20,900);
        $invalid=static fn(): ApiException => new ApiException(422,'RESET_TOKEN_INVALID',I18n::t('recovery.invalid_token'));
        $token=$input['token']??null;
        if (!is_string($token) || !preg_match('/^[a-f0-9]{64}$/D',$token)) throw $invalid();
        $tokenHash=hash('sha256',$token);
        $s=$this->db->prepare('SELECT user_id FROM password_reset_tokens WHERE token_hash=?');$s->execute([$tokenHash]);$id=$s->fetchColumn();
        if ($id===false) throw $invalid();
        $hash=$this->passwordHash($input['new_password']??null);
        $this->db->beginTransaction();
        try {
            $user=(new UserRepository($this->db))->byId((string)$id,true);
            $s=$this->db->prepare('SELECT auth_version,expires_at FROM password_reset_tokens WHERE user_id=? AND token_hash=? FOR UPDATE');$s->execute([$id,$tokenHash]);$reset=$s->fetch();
            if (!$this->recoveryEligible($user) || !$reset || (int)$reset['auth_version']!==(int)$user['auth_version'] || strtotime($reset['expires_at'].' UTC')<=time()) throw $invalid();
            $this->replacePassword((string)$id,$hash,null,'account.password_reset');
            $this->db->commit();
        } catch (\Throwable $e) { if ($this->db->inTransaction())$this->db->rollBack();throw $e; }
    }
    public function change(?string $actor,string $id,array $input,bool $admin=false): void
    {
        if ($actor===null && (PHP_SAPI!=='cli'||!$admin)) throw new ApiException(403,'FORBIDDEN',\Hospital\I18n::t("errors.operacion_no_permitida"));
        if (!$admin && $actor!==$id) throw new ApiException(403,'FORBIDDEN',\Hospital\I18n::t("errors.operacion_no_permitida"));
        $hash=$this->passwordHash($input['new_password']??null);
        if ($admin && $actor===$id) throw new ApiException(422,'USE_PASSWORD_CHANGE',\Hospital\I18n::t("errors.cambia_tu_contrasena_desde_configuracion"));
        $users=new UserRepository($this->db);
        $this->db->beginTransaction();
        try {
            $acting=$actor===null?null:$users->byId($actor,true);
            if ($actor!==null && (!$acting || $acting['status']!=='active' || $acting['staff_status']!=='active' || (int)$acting['auth_version']!==(int)($_SESSION['auth_version']??0))) throw new ApiException(401,'SESSION_EXPIRED',\Hospital\I18n::t("errors.la_sesion_vencio"));
            if ($admin && $actor!==null && !in_array('admin',$users->roles($actor),true)) throw new ApiException(403,'FORBIDDEN',\Hospital\I18n::t("errors.se_requiere_un_administrador"));
            $user=$actor===$id?$acting:$users->byId($id,true);
            if (!$user) throw new ApiException(404,'USER_NOT_FOUND',\Hospital\I18n::t("errors.no_se_encontro_la_cuenta"));
            if ($admin) {
                if ((int)$user['version']!==TransferInput::version($input['version']??null)) throw new ApiException(409,'VERSION_CONFLICT',\Hospital\I18n::t("errors.la_cuenta_cambio_volve_a_abrirla"));
                if ($user['status']==='pending') throw new ApiException(409,'ACCOUNT_PENDING',\Hospital\I18n::t("errors.aproba_primero_la_cuenta"));
            } elseif (!is_string($input['current_password']??null) || !password_verify($input['current_password'],$user['password_hash'])) throw new ApiException(422,'INVALID_CURRENT_PASSWORD',\Hospital\I18n::t("errors.la_contrasena_actual_no_coincide"));
            $this->replacePassword($id,$hash,$actor,$admin?'account.password_reset':'account.password_changed');$this->db->commit();
        } catch (\Throwable $e) { if ($this->db->inTransaction())$this->db->rollBack();throw $e; }
    }
}
