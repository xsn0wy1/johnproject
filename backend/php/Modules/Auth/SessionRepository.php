<?php
declare(strict_types=1);
namespace Hospital\Modules\Auth;

final class SessionRepository
{
    private \PDO $db;
    public function __construct(\PDO $db) { $this->db = $db; }

    public function isLive(string $hash, string $userId): bool
    {
        $stmt = $this->db->prepare('SELECT id FROM user_sessions WHERE session_hash = ? AND user_id = ? AND revoked_at IS NULL AND expires_at > UTC_TIMESTAMP() AND absolute_expires_at > UTC_TIMESTAMP()');
        $stmt->execute([$hash, $userId]);
        return (bool) $stmt->fetchColumn();
    }

    public function listOwn(string $userId, string $currentHash): array
    {
        $stmt = $this->db->prepare('SELECT id, session_hash, user_agent, created_at, last_seen_at, expires_at FROM user_sessions WHERE user_id = ? AND revoked_at IS NULL AND expires_at > UTC_TIMESTAMP() AND absolute_expires_at > UTC_TIMESTAMP() ORDER BY id DESC');
        $stmt->execute([$userId]);
        return array_map(static function (array $row) use ($currentHash): array {
            return ['id' => (string) $row['id'], 'is_current' => hash_equals($currentHash, $row['session_hash']),
                'user_agent' => $row['user_agent'], 'created_at' => UserRepository::date($row['created_at']),
                'last_seen_at' => UserRepository::date($row['last_seen_at']), 'expires_at' => UserRepository::date($row['expires_at'])];
        }, $stmt->fetchAll());
    }

    public function revokeOwn(string $id, string $userId): ?string
    {
        $stmt = $this->db->prepare('SELECT session_hash FROM user_sessions WHERE id = ? AND user_id = ? FOR UPDATE');
        $stmt->execute([$id, $userId]);
        $hash = $stmt->fetchColumn();
        if (!$hash) return null;
        $stmt = $this->db->prepare('UPDATE user_sessions SET revoked_at = COALESCE(revoked_at, UTC_TIMESTAMP()), payload = ? WHERE id = ? AND user_id = ?');
        $stmt->execute(['', $id, $userId]);
        return $hash;
    }

    public function revokeAll(string $userId): void
    {
        $stmt = $this->db->prepare('UPDATE user_sessions SET revoked_at = COALESCE(revoked_at, UTC_TIMESTAMP()), payload = ? WHERE user_id = ?');
        $stmt->execute(['', $userId]);
    }
}
