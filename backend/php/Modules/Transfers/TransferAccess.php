<?php
declare(strict_types=1);
namespace Hospital\Modules\Transfers;
use Hospital\Http\ApiException;
use Hospital\Modules\Auth\UserRepository;

final class TransferAccess
{
    private \PDO $db;
    private array $config;
    public function __construct(\PDO $db, array $config) { $this->db=$db; $this->config=$config; }
    public function dispatch(string $actor): bool { return in_array('dispatcher', (new UserRepository($this->db))->roles($actor), true); }
    public function requireDispatch(string $actor): void { if (!$this->dispatch($actor)) throw new ApiException(403,'FORBIDDEN',\Hospital\I18n::t("errors.se_requiere_permiso_de_coordinacion_de_traslados")); }
    public function scope(string $actor, array &$args): string
    {
        if ($this->dispatch($actor)) return '1=1';
        $args[]=$actor;
        return 'EXISTS (SELECT 1 FROM transfer_crew tc JOIN users au ON au.staff_id=tc.staff_id WHERE tc.transfer_id=t.id AND au.id=?)';
    }
    public function actor(string $actor): void
    {
        $user=(new UserRepository($this->db))->byId($actor,true);
        if (!$user || $user['status']!=='active' || $user['staff_status']!=='active' || (int)$user['auth_version']!==(int)($_SESSION['auth_version']??0)) throw new ApiException(401,'SESSION_EXPIRED',\Hospital\I18n::t("errors.la_sesion_ya_no_tiene_acceso"));
        $this->requireDispatch($actor);
    }
    public function lockName(string $name='write'): string { return 'ht:'.substr(hash('sha256',$this->config['db']['name'].':'.$name),0,60); }
    public function serialized(callable $work, string $name='write')
    {
        $key=$this->lockName($name); $stmt=$this->db->prepare('SELECT GET_LOCK(?,5)'); $stmt->execute([$key]);
        if ((int)$stmt->fetchColumn()!==1) throw new ApiException(409,'RESOURCE_BUSY',\Hospital\I18n::t("errors.hay_otra_actualizacion_en_curso_reintenta"));
        try { return $work(); }
        finally { $stmt=$this->db->prepare('SELECT RELEASE_LOCK(?)'); $stmt->execute([$key]); }
    }
    public function audit(?string $actor,string $action,?string $id,string $type='transfer'): void
    {
        $s=$this->db->prepare('INSERT INTO audit_events (actor_user_id,action,resource_type,resource_id,request_id) VALUES (?,?,?,?,?)');
        $s->execute([$actor,$action,$type,$id,$GLOBALS['request_id']??'cli-'.bin2hex(random_bytes(12))]);
    }
}
