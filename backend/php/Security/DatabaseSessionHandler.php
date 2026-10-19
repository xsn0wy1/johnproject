<?php
declare(strict_types=1);
namespace Hospital\Security;

final class DatabaseSessionHandler implements \SessionHandlerInterface, \SessionUpdateTimestampHandlerInterface
{
    private \PDO $db;
    private array $config;
    private ?string $lock = null;
    public function __construct(\PDO $db, array $config) { $this->db = $db; $this->config = $config; }
    public function open(string $path, string $name): bool { return true; }
    public function close(): bool
    {
        if ($this->lock !== null) {
            $stmt = $this->db->prepare('SELECT RELEASE_LOCK(?)'); $stmt->execute([$this->lock]);
            $this->lock = null;
        }
        return true;
    }

    public function validateId(string $id): bool
    {
        $stmt = $this->db->prepare('SELECT id FROM user_sessions WHERE session_hash = ? AND revoked_at IS NULL AND expires_at > UTC_TIMESTAMP() AND absolute_expires_at > UTC_TIMESTAMP()');
        $stmt->execute([hash('sha256', $id)]);
        return (bool) $stmt->fetchColumn();
    }

    public function read(string $id): string|false
    {
        // Serialize one cookie's requests; separate browser sessions stay parallel.
        $this->close();
        $name = 'hs:' . substr(hash('sha256', $id), 0, 61);
        $lock = $this->db->prepare('SELECT GET_LOCK(?, 5)'); $lock->execute([$name]);
        if ((int) $lock->fetchColumn() !== 1) throw new \RuntimeException('Session lock unavailable.');
        $this->lock = $name;
        $stmt = $this->db->prepare('SELECT payload FROM user_sessions WHERE session_hash = ? AND revoked_at IS NULL AND expires_at > UTC_TIMESTAMP() AND absolute_expires_at > UTC_TIMESTAMP()');
        $stmt->execute([hash('sha256', $id)]);
        return $stmt->fetchColumn() ?: '';
    }

    public function write(string $id, string $data): bool
    {
        $now = time();
        $started = (int) ($_SESSION['_auth_started'] ?? $_SESSION['_created_at'] ?? $now);
        $activity = (int) ($_SESSION['_last_activity'] ?? $now);
        $absolute = $started + (isset($_SESSION['user_id']) ? $this->config['session_absolute_seconds'] : 900);
        $idle = min((int) ($_SESSION['_idle_seconds'] ?? $this->config['session_idle_seconds']), $this->config['session_idle_seconds']);
        $expiry = min($activity + (isset($_SESSION['user_id']) ? $idle : 900), $absolute);
        // A concurrent logout/revoke must never be undone by an in-flight writer.
        $sql = 'INSERT INTO user_sessions (session_hash, user_id, payload, user_agent, created_at, last_seen_at, expires_at, absolute_expires_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON DUPLICATE KEY UPDATE
            payload = IF(revoked_at IS NULL AND expires_at > UTC_TIMESTAMP(), VALUES(payload), payload),
            user_id = IF(revoked_at IS NULL AND expires_at > UTC_TIMESTAMP(), VALUES(user_id), user_id),
            last_seen_at = IF(revoked_at IS NULL AND expires_at > UTC_TIMESTAMP(), VALUES(last_seen_at), last_seen_at),
            expires_at = IF(revoked_at IS NULL AND expires_at > UTC_TIMESTAMP(), VALUES(expires_at), expires_at)';
        $stmt = $this->db->prepare($sql);
        return $stmt->execute([hash('sha256', $id), $_SESSION['user_id'] ?? null, $data,
            substr($_SERVER['HTTP_USER_AGENT'] ?? '', 0, 255), gmdate('Y-m-d H:i:s', $started), gmdate('Y-m-d H:i:s', $now),
            gmdate('Y-m-d H:i:s', $expiry), gmdate('Y-m-d H:i:s', $absolute)]);
    }

    public function updateTimestamp(string $id, string $data): bool { return $this->write($id, $data); }

    public function destroy(string $id): bool
    {
        $stmt = $this->db->prepare('UPDATE user_sessions SET revoked_at = COALESCE(revoked_at, UTC_TIMESTAMP()), payload = ? WHERE session_hash = ?');
        return $stmt->execute(['', hash('sha256', $id)]);
    }

    public function gc(int $max_lifetime): int|false
    {
        $count = $this->db->exec('DELETE FROM user_sessions WHERE expires_at < UTC_TIMESTAMP() - INTERVAL 1 DAY');
        $this->db->exec('DELETE FROM auth_rate_limits WHERE resets_at < UTC_TIMESTAMP() - INTERVAL 1 DAY');
        return $count;
    }
}
