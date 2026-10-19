<?php
declare(strict_types=1);
namespace Hospital\Modules\Auth;

final class UserRepository
{
    private \PDO $db;
    public function __construct(\PDO $db) { $this->db = $db; }

    public function byUsername(string $username): ?array
    {
        $stmt = $this->db->prepare('SELECT * FROM users WHERE username = ?');
        $stmt->execute([$username]);
        return $stmt->fetch() ?: null;
    }

    public function byId(string $id, bool $lock = false): ?array
    {
        $stmt = $this->db->prepare('SELECT u.*, s.full_name AS staff_name, s.national_id AS staff_national_id, s.status AS staff_status, s.version AS staff_version FROM users u LEFT JOIN staff s ON s.id = u.staff_id WHERE u.id = ?' . ($lock ? ' FOR UPDATE' : ''));
        $stmt->execute([$id]);
        return $stmt->fetch() ?: null;
    }

    public function createPending(array $fields, string $hash): string
    {
        $stmt = $this->db->prepare('INSERT INTO users (username, email, display_name, registration_national_id, password_hash) VALUES (?, ?, ?, ?, ?)');
        $stmt->execute([$fields['username'], $fields['email'], '', $fields['national_id'], $hash]);
        $id = $this->db->lastInsertId();
        $stmt = $this->db->prepare('INSERT INTO user_settings (user_id) VALUES (?)');
        $stmt->execute([$id]);
        return $id;
    }

    public function roles(string $id): array
    {
        $stmt = $this->db->prepare('SELECT r.code FROM user_roles ur JOIN roles r ON r.id = ur.role_id WHERE ur.user_id = ? ORDER BY r.code');
        $stmt->execute([$id]);
        return $stmt->fetchAll(\PDO::FETCH_COLUMN);
    }

    public function settings(string $id): array
    {
        $stmt = $this->db->prepare('SELECT us.*,COALESCE(s.version,0) AS staff_revision FROM user_settings us JOIN users u ON u.id=us.user_id LEFT JOIN staff s ON s.id=u.staff_id WHERE us.user_id = ?');
        $stmt->execute([$id]);
        $row = $stmt->fetch();
        if (!$row) throw new \RuntimeException('Missing settings row.');
        $stmt = $this->db->prepare('SELECT c.id, c.name FROM staff_specialties ss JOIN specialties c ON c.id = ss.specialty_id JOIN users u ON u.staff_id = ss.staff_id WHERE u.id = ? ORDER BY c.name'); $stmt->execute([$id]);
        $specialties = array_map(static fn(array $item): array => ['id' => (string) $item['id'], 'name' => $item['name']], $stmt->fetchAll());
        $stmt = $this->db->prepare('SELECT name, status FROM facilities WHERE id = ?'); $stmt->execute([$row['default_facility_id']]); $facility = $stmt->fetch();
        return ['locale' => $row['locale'], 'theme' => $row['theme'],
            'photo_visible_to_staff' => (bool) $row['photo_visible_to_staff'], 'optional_diagnostics' => (bool) $row['optional_diagnostics'],
            'security_notifications' => (bool) $row['security_notifications'], 'automatic_logout' => (bool) $row['automatic_logout'],
            'avatar_url' => $row['avatar_file_id'] === null ? null : 'api/v1/settings/photo.php?user_id=' . $id . '&v=' . $row['avatar_file_id'],
            'default_facility_id' => $row['default_facility_id'] === null ? null : (string) $row['default_facility_id'],
            'default_facility_name' => $facility ? $facility['name'] : '', 'default_facility_active' => $facility ? $facility['status'] === 'active' : false,
            'specialties' => $specialties, 'version' => (int) $row['version']+(int)$row['staff_revision']];
    }

    public function loginRecorded(string $id, ?string $rehash): void
    {
        $stmt = $this->db->prepare('UPDATE users SET last_login_at = UTC_TIMESTAMP(), password_hash = COALESCE(?, password_hash) WHERE id = ?');
        $stmt->execute([$rehash, $id]);
    }

    public function audit(?string $actor, string $action, ?string $resource, string $request): void
    {
        $stmt = $this->db->prepare("INSERT INTO audit_events (actor_user_id, action, resource_type, resource_id, request_id) VALUES (?, ?, 'user', ?, ?)");
        $stmt->execute([$actor, $action, $resource, $request]);
    }

    public function pending(): array
    {
        $rows = $this->db->query("SELECT id, username, email, registration_national_id AS national_id, status, created_at FROM users WHERE status = 'pending' ORDER BY id LIMIT 100")->fetchAll();
        return array_map(static function (array $row): array {
            $row['id'] = (string) $row['id'];
            $row['created_at'] = self::date($row['created_at']);
            return $row;
        }, $rows);
    }

    public static function date(?string $date): ?string { return $date === null ? null : str_replace(' ', 'T', $date) . 'Z'; }
}
