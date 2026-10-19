<?php
declare(strict_types=1);
namespace Hospital\Modules\Auth;
use Hospital\Http\ApiException;
use Hospital\Modules\Transfers\TransferInput;

final class PasswordService
{
    private \PDO $db;
    private array $config;
    public function __construct(\PDO $db,array $config) { $this->db=$db;$this->config=$config; }
    public function change(?string $actor,string $id,array $input,bool $admin=false): void
    {
        if ($actor===null && (PHP_SAPI!=='cli'||!$admin)) throw new ApiException(403,'FORBIDDEN',\Hospital\I18n::t("errors.operacion_no_permitida"));
        if (!$admin && $actor!==$id) throw new ApiException(403,'FORBIDDEN',\Hospital\I18n::t("errors.operacion_no_permitida"));
        $password=$input['new_password']??null;
        if (!is_string($password) || !mb_check_encoding($password,'UTF-8') || mb_strlen($password)<12 || strlen($password)>72 || str_contains($password,"\0")) throw new ApiException(422,'VALIDATION_FAILED',\Hospital\I18n::t("errors.usa_entre_12_caracteres_y_72_bytes"));
        if ($admin && $actor===$id) throw new ApiException(422,'USE_PASSWORD_CHANGE',\Hospital\I18n::t("errors.cambia_tu_contrasena_desde_configuracion"));
        $hash=password_hash($password,PASSWORD_BCRYPT,['cost'=>$this->config['bcrypt_cost']]);$users=new UserRepository($this->db);
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
            $s=$this->db->prepare('UPDATE users SET password_hash=?,auth_version=auth_version+1,version=version+1 WHERE id=?');$s->execute([$hash,$id]);
            (new SessionRepository($this->db))->revokeAll($id);$users->audit($actor,$admin?'account.password_reset':'account.password_changed',$id,$GLOBALS['request_id']??'cli');$this->db->commit();
        } catch (\Throwable $e) { if ($this->db->inTransaction())$this->db->rollBack();throw $e; }
    }
}
