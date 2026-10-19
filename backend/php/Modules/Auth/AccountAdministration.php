<?php
declare(strict_types=1);
namespace Hospital\Modules\Auth;
use Hospital\Http\ApiException;

final class AccountAdministration
{
    private \PDO $db;
    private UserRepository $users;
    public function __construct(\PDO $db) { $this->db = $db; $this->users = new UserRepository($db); }

    private function lockAdminRole(): void
    {
        $this->db->query("SELECT id FROM roles WHERE code = 'admin' FOR UPDATE")->fetchColumn();
    }

    private function activeAdminCount(): int
    {
        return (int) $this->db->query("SELECT COUNT(*) FROM user_roles ur JOIN roles r ON r.id = ur.role_id JOIN users u ON u.id = ur.user_id WHERE r.code = 'admin' AND u.status = 'active'")->fetchColumn();
    }

    private function assertActor(?string $actor): void
    {
        // null is reserved for trusted CLI operations. HTTP always supplies its actor.
        if ($actor === null) return;
        $user = $this->users->byId($actor, true);
        if (!$user || $user['status'] !== 'active' || $user['staff_status'] !== 'active' || (int)$user['auth_version']!==(int)($_SESSION['auth_version']??0) || !in_array('admin', $this->users->roles($actor), true)) {
            throw new ApiException(403, 'FORBIDDEN', \Hospital\I18n::t("errors.no_tenes_permiso_para_esta_accion"));
        }
    }

    public function listing(): array
    {
        $rows=$this->db->query('SELECT id,username,email,status,version,created_at FROM users ORDER BY id DESC')->fetchAll();
        foreach ($rows as &$row) { $row['id']=(string)$row['id'];$row['version']=(int)$row['version'];$row['created_at']=UserRepository::date($row['created_at']);$row['roles']=$this->users->roles($row['id']); } unset($row);
        return $rows;
    }

    public function manage(string $id,int $version,string $action,array $roles,?string $actor,string $request): void
    {
        if (!in_array($action,['approve','roles','disable','reactivate','revoke_sessions'],true)) throw new ApiException(422,'VALIDATION_FAILED',\Hospital\I18n::t("errors.accion_no_valida"));
        if (count($roles)>4 || array_values($roles)!==$roles) throw new ApiException(422,'INVALID_ROLE',\Hospital\I18n::t("errors.roles_no_validos"));
        foreach ($roles as $role) if (!is_string($role) || !in_array($role,['admin','staff','records_manager','dispatcher'],true)) throw new ApiException(422,'INVALID_ROLE',\Hospital\I18n::t("errors.rol_no_valido"));
        $roles=array_values(array_unique($roles));
        if (in_array($action,['approve','roles'],true) && !$roles) throw new ApiException(422,'INVALID_ROLE',\Hospital\I18n::t("errors.selecciona_al_menos_un_rol"));
        $this->db->beginTransaction();
        try {
            $this->lockAdminRole();$this->assertActor($actor);$user=$this->users->byId($id,true);
            if (!$user) throw new ApiException(404,'USER_NOT_FOUND',\Hospital\I18n::t("errors.no_se_encontro_la_cuenta"));
            if ((int)$user['version']!==$version) throw new ApiException(409,'VERSION_CONFLICT',\Hospital\I18n::t("errors.la_cuenta_cambio_volve_a_abrirla"));
            $current=$this->users->roles($id);
            $removesAdmin=$action==='disable' || ($action==='roles'&&!in_array('admin',$roles,true));
            if ($user['status']==='active' && in_array('admin',$current,true) && $removesAdmin && $this->activeAdminCount()<=1) throw new ApiException(409,'LAST_ADMIN',\Hospital\I18n::t("errors.conserva_al_menos_un_administrador_activo"));
            if ($action==='approve') $this->activate($user,$roles[0],$actor,$request);
            elseif ($action==='roles' && $user['status']!=='active') throw new ApiException(409,'ACCOUNT_NOT_ACTIVE',\Hospital\I18n::t("errors.la_cuenta_debe_estar_activa"));
            elseif ($action==='reactivate') {
                if ($user['status']!=='disabled' || $user['staff_status']!=='active' || !$current) throw new ApiException(409,'ACCOUNT_NOT_DISABLED',\Hospital\I18n::t("errors.no_se_puede_reactivar_esta_cuenta"));
                $s=$this->db->prepare("UPDATE users SET status='active' WHERE id=?");$s->execute([$id]);
            } elseif ($action==='disable') {
                if ($user['status']!=='active') throw new ApiException(409,'ACCOUNT_NOT_ACTIVE',\Hospital\I18n::t("errors.la_cuenta_debe_estar_activa"));
                $s=$this->db->prepare("UPDATE users SET status='disabled' WHERE id=?");$s->execute([$id]);
            }
            if (in_array($action,['approve','roles'],true)) {
                $s=$this->db->prepare('DELETE FROM user_roles WHERE user_id=?');$s->execute([$id]);
                $s=$this->db->prepare('INSERT INTO user_roles (user_id,role_id) SELECT ?,id FROM roles WHERE code=?');foreach ($roles as $role) $s->execute([$id,$role]);
            }
            $s=$this->db->prepare('UPDATE users SET auth_version=auth_version+1,version=version+1 WHERE id=?');$s->execute([$id]);
            (new SessionRepository($this->db))->revokeAll($id);$this->users->audit($actor,'account.'.$action,$id,$request);$this->db->commit();
        } catch (\Throwable $e) { if ($this->db->inTransaction())$this->db->rollBack();throw $e; }
    }

    private function activate(array $user, string $role, ?string $actor, string $request): void
    {
        $stmt = $this->db->prepare('SELECT id FROM roles WHERE code = ?'); $stmt->execute([$role]); $roleId = $stmt->fetchColumn();
        if (!$roleId) throw new ApiException(422, 'INVALID_ROLE', \Hospital\I18n::t("errors.el_rol_no_es_valido"));
        if ($user['status'] !== 'pending') throw new ApiException(409, 'ACCOUNT_NOT_PENDING', \Hospital\I18n::t("errors.la_cuenta_no_esta_pendiente_de_aprobacion"));
        $stmt = $this->db->prepare('SELECT id FROM staff WHERE national_id = ? FOR UPDATE');
        $stmt->execute([$user['registration_national_id']]); $staffId = $stmt->fetchColumn();
        if (!$staffId) {
            $stmt = $this->db->prepare('INSERT INTO staff (national_id, full_name) VALUES (?, ?)');
            $stmt->execute([$user['registration_national_id'], $user['display_name']]); $staffId = $this->db->lastInsertId();
        } else {
            $stmt = $this->db->prepare("SELECT status FROM staff WHERE id = ?"); $stmt->execute([$staffId]);
            if ($stmt->fetchColumn() !== 'active') throw new ApiException(409, 'STAFF_INACTIVE', \Hospital\I18n::t("errors.el_funcionario_esta_inactivo"));
        }
        $stmt = $this->db->prepare("UPDATE users SET staff_id = ?, status = 'active', approved_by = ?, approved_at = UTC_TIMESTAMP(), auth_version = auth_version + 1, version = version + 1 WHERE id = ?");
        $stmt->execute([$staffId, $actor, $user['id']]);
        $stmt = $this->db->prepare('INSERT INTO user_roles (user_id, role_id) VALUES (?, ?)'); $stmt->execute([$user['id'], $roleId]);
        $this->users->audit($actor, 'account.approved', (string) $user['id'], $request);
    }

    public function approve(string $id, string $role, ?string $actor, string $request): void
    {
        $this->db->beginTransaction();
        try {
            $this->lockAdminRole();
            $this->assertActor($actor);
            $user = $this->users->byId($id, true);
            if (!$user) throw new ApiException(404, 'USER_NOT_FOUND', \Hospital\I18n::t("errors.no_se_encontro_la_cuenta"));
            $this->activate($user, $role, $actor, $request); $this->db->commit();
        } catch (\Throwable $e) { $this->db->rollBack(); throw $e; }
    }

    public function createFirstAdmin(array $input, int $cost, string $request): string
    {
        $fields = AuthService::registrationFields($input);
        $hash = password_hash($fields['password'], PASSWORD_BCRYPT, ['cost' => $cost]);
        $this->db->beginTransaction();
        try {
            $this->lockAdminRole();
            if ($this->activeAdminCount() > 0) throw new ApiException(409, 'ADMIN_EXISTS', \Hospital\I18n::t("errors.ya_existe_un_administrador_usa_el_flujo_de_aprobacion"));
            $id = $this->users->createPending($fields, $hash);
            $this->activate($this->users->byId($id, true), 'admin', null, $request);
            $this->db->commit(); return $id;
        } catch (\Throwable $e) { $this->db->rollBack(); throw $e; }
    }

    public function disable(string $id, ?string $actor, string $request): void
    {
        $this->db->beginTransaction();
        try {
            $this->lockAdminRole();
            $this->assertActor($actor);
            $user = $this->users->byId($id, true);
            if (!$user) throw new ApiException(404, 'USER_NOT_FOUND', \Hospital\I18n::t("errors.no_se_encontro_la_cuenta"));
            if ($user['status'] === 'active' && in_array('admin', $this->users->roles($id), true) && $this->activeAdminCount() <= 1) {
                throw new ApiException(409, 'LAST_ADMIN', \Hospital\I18n::t("errors.no_se_puede_desactivar_al_ultimo_administrador"));
            }
            $stmt = $this->db->prepare("UPDATE users SET status = 'disabled', auth_version = auth_version + 1, version = version + 1 WHERE id = ?"); $stmt->execute([$id]);
            (new SessionRepository($this->db))->revokeAll($id);
            $this->users->audit($actor, 'account.disabled', $id, $request); $this->db->commit();
        } catch (\Throwable $e) { $this->db->rollBack(); throw $e; }
    }
}
