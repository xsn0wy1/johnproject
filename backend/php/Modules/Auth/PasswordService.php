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
        if ($actor===null && (PHP_SAPI!=='cli'||!$admin)) throw new ApiException(403,'FORBIDDEN','Operación no permitida.');
        if (!$admin && $actor!==$id) throw new ApiException(403,'FORBIDDEN','Operación no permitida.');
        $password=$input['new_password']??null;
        if (!is_string($password) || !mb_check_encoding($password,'UTF-8') || mb_strlen($password)<12 || strlen($password)>72 || str_contains($password,"\0")) throw new ApiException(422,'VALIDATION_FAILED','Usá entre 12 caracteres y 72 bytes.');
        if ($admin && $actor===$id) throw new ApiException(422,'USE_PASSWORD_CHANGE','Cambiá tu contraseña desde Configuración.');
        $hash=password_hash($password,PASSWORD_BCRYPT,['cost'=>$this->config['bcrypt_cost']]);$users=new UserRepository($this->db);
        $this->db->beginTransaction();
        try {
            $acting=$actor===null?null:$users->byId($actor,true);
            if ($actor!==null && (!$acting || $acting['status']!=='active' || $acting['staff_status']!=='active' || (int)$acting['auth_version']!==(int)($_SESSION['auth_version']??0))) throw new ApiException(401,'SESSION_EXPIRED','La sesión venció.');
            if ($admin && $actor!==null && !in_array('admin',$users->roles($actor),true)) throw new ApiException(403,'FORBIDDEN','Se requiere un administrador.');
            $user=$actor===$id?$acting:$users->byId($id,true);
            if (!$user) throw new ApiException(404,'USER_NOT_FOUND','No se encontró la cuenta.');
            if ($admin) {
                if ((int)$user['version']!==TransferInput::version($input['version']??null)) throw new ApiException(409,'VERSION_CONFLICT','La cuenta cambió. Volvé a abrirla.');
                if ($user['status']==='pending') throw new ApiException(409,'ACCOUNT_PENDING','Aprobá primero la cuenta.');
            } elseif (!is_string($input['current_password']??null) || !password_verify($input['current_password'],$user['password_hash'])) throw new ApiException(422,'INVALID_CURRENT_PASSWORD','La contraseña actual no coincide.');
            $s=$this->db->prepare('UPDATE users SET password_hash=?,auth_version=auth_version+1,version=version+1 WHERE id=?');$s->execute([$hash,$id]);
            (new SessionRepository($this->db))->revokeAll($id);$users->audit($actor,$admin?'account.password_reset':'account.password_changed',$id,$GLOBALS['request_id']??'cli');$this->db->commit();
        } catch (\Throwable $e) { if ($this->db->inTransaction())$this->db->rollBack();throw $e; }
    }
}
