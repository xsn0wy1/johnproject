<?php
declare(strict_types=1);
namespace Hospital\Modules\Auth;
use Hospital\Http\ApiException;
use Hospital\Security\Csrf;
use Hospital\Security\RateLimiter;

final class AuthService
{
    private \PDO $db;
    private array $config;
    private UserRepository $users;
    private SessionRepository $sessions;
    private RateLimiter $limiter;

    public function __construct(\PDO $db, array $config)
    {
        $this->db = $db; $this->config = $config;
        $this->users = new UserRepository($db); $this->sessions = new SessionRepository($db);
        $this->limiter = new RateLimiter($db, $config['app_key']);
    }

    public static function registrationFields(array $input): array
    {
        $fields = []; $errors = [];
        foreach (['username', 'email', 'password', 'national_id'] as $name) {
            if (!isset($input[$name]) || !is_string($input[$name])) $errors[$name] = 'Completá este campo.';
        }
        if ($errors) throw new ApiException(422, 'VALIDATION_FAILED', 'Revisá los campos indicados.', $errors);
        $fields['username'] = strtolower(trim($input['username']));
        $fields['email'] = strtolower(trim($input['email']));
        $fields['national_id'] = preg_replace('/[.\s-]/', '', trim($input['national_id']));
        $fields['password'] = $input['password'];
        if (!preg_match('/^[a-z0-9][a-z0-9_.-]{2,49}$/', $fields['username'])) $errors['username'] = 'Usá entre 3 y 50 letras sin tildes, números, puntos, guiones o guiones bajos.';
        if (strlen($fields['email']) > 254 || !filter_var($fields['email'], FILTER_VALIDATE_EMAIL)) $errors['email'] = 'Ingresá un email válido.';
        if (!preg_match('/^[0-9]{6,12}$/', $fields['national_id'])) $errors['national_id'] = 'Ingresá una CI de 6 a 12 dígitos, con o sin puntos y guion.';
        $length = function_exists('mb_strlen') ? mb_strlen($fields['password'], 'UTF-8') : preg_match_all('/./us', $fields['password']);
        if ($length < 12 || strlen($fields['password']) > 72 || str_contains($fields['password'], "\0")) $errors['password'] = 'Usá al menos 12 caracteres y un máximo de 72 bytes. Se permiten espacios.';
        if ($errors) throw new ApiException(422, 'VALIDATION_FAILED', 'Revisá los campos indicados.', $errors);
        return $fields;
    }

    public function register(array $input): array
    {
        if (isset($_SESSION['user_id'])) throw new ApiException(409, 'ALREADY_AUTHENTICATED', 'Cerrá tu sesión antes de registrar otra cuenta.');
        $this->limiter->consume('register:' . ($_SERVER['REMOTE_ADDR'] ?? 'local'), 10, 3600);
        $fields = self::registrationFields($input);
        $hash = password_hash($fields['password'], PASSWORD_BCRYPT, ['cost' => $this->config['bcrypt_cost']]);
        $this->db->beginTransaction();
        try {
            $id = $this->users->createPending($fields, $hash);
            $this->users->audit(null, 'account.registered', $id, $GLOBALS['request_id']);
            $this->db->commit();
        } catch (\PDOException $e) {
            $this->db->rollBack();
            if (($e->errorInfo[1] ?? 0) === 1062) throw new ApiException(409, 'ACCOUNT_CONFLICT', 'Ya existe una solicitud o cuenta con esos datos.');
            throw $e;
        } catch (\Throwable $e) { $this->db->rollBack(); throw $e; }
        return ['user_id' => $id, 'status' => 'pending', 'message' => 'Solicitud registrada. Un administrador debe aprobar tu cuenta antes de que puedas ingresar.'];
    }

    public function login(array $input): array
    {
        $username = is_string($input['username'] ?? null) ? strtolower(trim($input['username'])) : '';
        $password = is_string($input['password'] ?? null) ? $input['password'] : '';
        $ip = $_SERVER['REMOTE_ADDR'] ?? 'local';
        $this->limiter->consume('login-ip:' . $ip, 60, 900);
        $this->limiter->consume('login-account:' . $username, 10, 900);
        // A valid dummy hash gives unknown accounts the same verification work.
        $dummy = '$2y$12$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2uheWG/igi';
        $row = strlen($username) <= 50 ? $this->users->byUsername($username) : null;
        $valid = strlen($password) <= 72 && !str_contains($password, "\0") && password_verify($password, $row['password_hash'] ?? $dummy);
        if (!$row || !$valid) throw new ApiException(401, 'INVALID_CREDENTIALS', 'Usuario o contraseña incorrectos.');
        if ($row['status'] === 'pending') throw new ApiException(403, 'ACCOUNT_PENDING', 'Tu cuenta está pendiente de aprobación por un administrador.');
        if ($row['status'] !== 'active' || !$row['staff_id']) throw new ApiException(403, 'ACCOUNT_DISABLED', 'Tu cuenta no tiene acceso al sistema.');
        // Lock with disable/approval operations; a disabled account cannot race login.
        $this->db->beginTransaction();
        try {
            $row = $this->users->byId((string) $row['id'], true);
            if ($row['status'] !== 'active' || $row['staff_status'] !== 'active') throw new ApiException(403, 'ACCOUNT_DISABLED', 'Tu cuenta no tiene acceso al sistema.');
            $rehash = password_needs_rehash($row['password_hash'], PASSWORD_BCRYPT, ['cost' => $this->config['bcrypt_cost']]) ? password_hash($password, PASSWORD_BCRYPT, ['cost' => $this->config['bcrypt_cost']]) : null;
            $this->users->loginRecorded((string) $row['id'], $rehash);
            $this->users->audit((string) $row['id'], 'session.login', (string) $row['id'], $GLOBALS['request_id']);
            $stmt = $this->db->prepare("INSERT INTO user_notifications (user_id, kind) SELECT user_id, 'new_login' FROM user_settings WHERE user_id = ? AND security_notifications = 1"); $stmt->execute([$row['id']]);
            // Keep a bounded private inbox; auditing remains independent of this preference.
            $stmt = $this->db->prepare('DELETE FROM user_notifications WHERE user_id = ? AND id NOT IN (SELECT id FROM (SELECT id FROM user_notifications WHERE user_id = ? ORDER BY id DESC LIMIT 100) recent)'); $stmt->execute([$row['id'], $row['id']]);
            $this->db->commit();
        } catch (\Throwable $e) { $this->db->rollBack(); throw $e; }
        if (!session_regenerate_id(true)) throw new \RuntimeException('Session rotation failed.');
        $_SESSION = ['user_id' => (string) $row['id'], 'auth_version' => (int) $row['auth_version'], '_created_at' => time(), '_auth_started' => time(), '_last_activity' => time(), '_idle_seconds' => $this->idleSeconds((string) $row['id'])];
        return $this->payload($this->users->byId((string) $row['id']));
    }

    public function requireUser(bool $touch = true): array
    {
        $id = $_SESSION['user_id'] ?? null;
        if (!is_string($id)) throw new ApiException(401, 'UNAUTHENTICATED', 'Iniciá sesión para continuar.');
        $row = $this->users->byId($id);
        $idle = $this->idleSeconds($id);
        $_SESSION['_idle_seconds'] = $idle;
        $expired = time() - (int) ($_SESSION['_last_activity'] ?? 0) >= $idle ||
            time() - (int) ($_SESSION['_auth_started'] ?? 0) >= $this->config['session_absolute_seconds'];
        if (!$row || $row['status'] !== 'active' || $row['staff_status'] !== 'active' ||
            (int) $row['auth_version'] !== (int) ($_SESSION['auth_version'] ?? 0) || $expired ||
            !$this->sessions->isLive(hash('sha256', session_id()), $id)) {
            $this->clearSession();
            throw new ApiException(401, 'SESSION_EXPIRED', 'Tu sesión venció o fue cerrada. Iniciá sesión nuevamente.');
        }
        if ($touch) $_SESSION['_last_activity'] = time();
        return $row;
    }

    public function requireAdmin(): array
    {
        $user = $this->requireUser();
        if (!in_array('admin', $this->users->roles((string) $user['id']), true)) throw new ApiException(403, 'FORBIDDEN', 'No tenés permiso para esta acción.');
        return $user;
    }

    public function payload(array $row): array
    {
        $id = (string) $row['id'];
        $_SESSION['_idle_seconds'] = $this->idleSeconds($id);
        return ['user' => ['id' => $id, 'staff_id' => $row['staff_id'] === null ? null : (string) $row['staff_id'],
            'username' => $row['username'], 'email' => $row['email'], 'full_name' => $row['staff_name'] ?? $row['display_name'],
            'national_id' => $row['staff_national_id'] ?? $row['registration_national_id'], 'status' => $row['status'],
            'roles' => $this->users->roles($id), 'version' => (int) $row['version'],
            'created_at' => UserRepository::date($row['created_at']), 'last_login_at' => UserRepository::date($row['last_login_at'])],
            'settings' => $this->users->settings($id), 'csrf_token' => Csrf::token(),
            'session' => ['idle_timeout_seconds' => $_SESSION['_idle_seconds'], 'idle_expires_at' => gmdate('Y-m-d\TH:i:s\Z', min((int) $_SESSION['_last_activity'] + $_SESSION['_idle_seconds'], (int) $_SESSION['_auth_started'] + $this->config['session_absolute_seconds'])),
                'absolute_expires_at' => gmdate('Y-m-d\TH:i:s\Z', (int) $_SESSION['_auth_started'] + $this->config['session_absolute_seconds'])]];
    }

    private function idleSeconds(string $id): int
    {
        $stmt = $this->db->prepare('SELECT automatic_logout FROM user_settings WHERE user_id = ?'); $stmt->execute([$id]);
        return $stmt->fetchColumn() ? min(300, $this->config['session_idle_seconds']) : $this->config['session_idle_seconds'];
    }

    public function logout(): void
    {
        if (isset($_SESSION['user_id'])) $this->users->audit($_SESSION['user_id'], 'session.logout', $_SESSION['user_id'], $GLOBALS['request_id']);
        $this->clearSession();
    }

    public function clearSession(): void
    {
        $_SESSION = [];
        if (session_status() === PHP_SESSION_ACTIVE) session_destroy();
        setcookie(session_name(), '', ['expires' => time() - 3600, 'path' => ($this->config['base_path'] ?: '') . '/',
            'secure' => $this->config['secure_cookies'], 'httponly' => true, 'samesite' => 'Lax']);
    }

    public function sessions(): array
    {
        $user = $this->requireUser(false);
        return $this->sessions->listOwn((string) $user['id'], hash('sha256', session_id()));
    }

    public function revokeSession(string $id): array
    {
        $user = $this->requireUser();
        $this->db->beginTransaction();
        try {
            $hash = $this->sessions->revokeOwn($id, (string) $user['id']);
            if ($hash === null) throw new ApiException(404, 'SESSION_NOT_FOUND', 'No se encontró esa sesión.');
            $this->users->audit((string) $user['id'], 'session.revoked', (string) $user['id'], $GLOBALS['request_id']);
            $this->db->commit();
        } catch (\Throwable $e) { $this->db->rollBack(); throw $e; }
        $current = hash_equals(hash('sha256', session_id()), $hash);
        if ($current) $this->clearSession();
        return ['revoked' => true, 'current_session_revoked' => $current];
    }
}
