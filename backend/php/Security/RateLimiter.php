<?php
declare(strict_types=1);
namespace Hospital\Security;
use Hospital\Http\ApiException;

final class RateLimiter
{
    private \PDO $db;
    private string $key;
    public function __construct(\PDO $db, string $key) { $this->db = $db; $this->key = $key; }

    public function consume(string $name, int $limit, int $seconds): void
    {
        $bucket = hash_hmac('sha256', $name, $this->key);
        $this->db->beginTransaction();
        try {
            $stmt = $this->db->prepare('INSERT IGNORE INTO auth_rate_limits (bucket_key, attempts, resets_at) VALUES (?, 0, ?)');
            $stmt->execute([$bucket, gmdate('Y-m-d H:i:s', time() + $seconds)]);
            $stmt = $this->db->prepare('SELECT attempts, resets_at FROM auth_rate_limits WHERE bucket_key = ? FOR UPDATE');
            $stmt->execute([$bucket]);
            $row = $stmt->fetch();
            $expired = strtotime($row['resets_at'] . ' UTC') <= time();
            $attempts = $expired ? 0 : (int) $row['attempts'];
            $resets = $expired ? gmdate('Y-m-d H:i:s', time() + $seconds) : $row['resets_at'];
            if ($attempts >= $limit) {
                $this->db->commit();
                header('Retry-After: ' . max(1, strtotime($resets . ' UTC') - time()));
                throw new ApiException(429, 'RATE_LIMITED', 'Demasiados intentos. Esperá unos minutos.');
            }
            $stmt = $this->db->prepare('UPDATE auth_rate_limits SET attempts = ?, resets_at = ? WHERE bucket_key = ?');
            $stmt->execute([$attempts + 1, $resets, $bucket]);
            $this->db->commit();
        } catch (\Throwable $e) {
            if ($this->db->inTransaction()) $this->db->rollBack();
            throw $e;
        }
    }
}
