<?php
declare(strict_types=1);
namespace Hospital\Modules\Settings;
use Hospital\Http\ApiException;

final class AvatarService
{
    private \PDO $db;
    private array $config;
    public function __construct(\PDO $db, array $config) { $this->db = $db; $this->config = $config; }

    public function directory(bool $create = false): string
    {
        return (new \Hospital\Storage\PrivateStorage($this->config))->directory('users', $create);
    }

    public function path(string $key): string
    {
        if (!preg_match('/^[a-f0-9]{64}$/', $key)) throw new \RuntimeException('Invalid storage key.');
        return $this->directory() . '/' . $key . '.png';
    }

    private function normalize(array $file): string
    {
        $error = $file['error'] ?? UPLOAD_ERR_NO_FILE;
        if (!is_int($error) || $error !== UPLOAD_ERR_OK) throw new ApiException(in_array($error, [UPLOAD_ERR_INI_SIZE, UPLOAD_ERR_FORM_SIZE], true) ? 413 : 422, 'INVALID_UPLOAD', 'No se recibió una imagen válida.');
        if (!is_string($file['tmp_name'] ?? null) || !is_uploaded_file($file['tmp_name'])) throw new ApiException(422, 'INVALID_UPLOAD', 'No se recibió una imagen válida.');
        if (filesize($file['tmp_name']) > 5 * 1024 * 1024) throw new ApiException(413, 'FILE_TOO_LARGE', 'La imagen supera 5 MiB.');
        $bytes = file_get_contents($file['tmp_name']);
        $info = @getimagesizefromstring($bytes);
        if (!$info || !in_array($info['mime'], ['image/png', 'image/jpeg', 'image/webp'], true) || $info[0] > 4096 || $info[1] > 4096 || $info[0] * $info[1] > 8000000) throw new ApiException(415, 'INVALID_IMAGE', 'Usá una imagen PNG, JPEG o WebP de dimensiones permitidas.');
        if (!function_exists('imagecreatefromstring')) throw new \RuntimeException('GD extension required.');
        $source = @imagecreatefromstring($bytes);
        if (!$source) throw new ApiException(415, 'INVALID_IMAGE', 'No se pudo decodificar la imagen.');
        $scale = min(1, 512 / max($info[0], $info[1]));
        $width = max(1, (int) round($info[0] * $scale)); $height = max(1, (int) round($info[1] * $scale));
        $image = imagecreatetruecolor($width, $height); imagealphablending($image, false); imagesavealpha($image, true);
        imagecopyresampled($image, $source, 0, 0, 0, 0, $width, $height, $info[0], $info[1]);
        ob_start(); imagepng($image, null, 6); $normalized = ob_get_clean();
        imagedestroy($source); imagedestroy($image);
        if (!is_string($normalized) || $normalized === '') throw new \RuntimeException('Image encoding failed.');
        return $normalized;
    }

    public function replace(string $id, $version, ?array $file): void
    {
        $newPath = null; $key = null; $bytes = null;
        if ($file !== null) {
            $bytes = $this->normalize($file); $key = bin2hex(random_bytes(32));
            $newPath = $this->directory(true) . '/' . $key . '.png';
            $oldMask = umask(0077);
            try {
                $handle = fopen($newPath, 'xb');
                if (!$handle) throw new \RuntimeException('Private storage unavailable.');
                try { if (fwrite($handle, $bytes) !== strlen($bytes)) throw new \RuntimeException('Incomplete private file write.'); }
                finally { fclose($handle); }
            } catch (\Throwable $error) {
                if (is_file($newPath)) unlink($newPath);
                throw $error;
            } finally { umask($oldMask); }
        }
        $oldKey = null;
        $this->db->beginTransaction();
        try {
            $settings = new SettingsService($this->db); $settings->lock($id, $version);
            $stmt = $this->db->prepare('SELECT f.id, f.storage_key FROM user_settings s JOIN stored_files f ON f.id = s.avatar_file_id AND f.owner_user_id = s.user_id WHERE s.user_id = ?'); $stmt->execute([$id]); $old = $stmt->fetch();
            $fileId = null;
            if ($bytes !== null) {
                $stmt = $this->db->prepare("INSERT INTO stored_files (owner_user_id, storage_key, mime_type, byte_size, sha256) VALUES (?, ?, 'image/png', ?, ?)"); $stmt->execute([$id, $key, strlen($bytes), hash('sha256', $bytes)]); $fileId = $this->db->lastInsertId();
            }
            $stmt = $this->db->prepare('UPDATE user_settings SET avatar_file_id = ? WHERE user_id = ?'); $stmt->execute([$fileId, $id]);
            if ($old) { $stmt = $this->db->prepare("UPDATE stored_files SET state = 'retired' WHERE id = ?"); $stmt->execute([$old['id']]); $oldKey = $old['storage_key']; }
            $settings->changed($id, $file === null ? 'settings.photo_deleted' : 'settings.photo_updated'); $this->db->commit();
        } catch (\Throwable $error) {
            $this->db->rollBack(); if ($newPath !== null && is_file($newPath)) unlink($newPath); throw $error;
        }
        if ($oldKey !== null) {
            $oldPath = $this->path($oldKey);
            if (is_file($oldPath) && !@unlink($oldPath)) error_log('Hospital private avatar cleanup deferred.');
        }
    }

    public function content(string $viewer, string $target): array
    {
        $stmt = $this->db->prepare("SELECT f.storage_key, f.byte_size, s.photo_visible_to_staff FROM user_settings s JOIN users u ON u.id = s.user_id JOIN staff st ON st.id = u.staff_id JOIN stored_files f ON f.id = s.avatar_file_id AND f.owner_user_id = u.id AND f.state = 'ready' WHERE u.id = ? AND u.status = 'active' AND st.status = 'active'"); $stmt->execute([$target]); $file = $stmt->fetch();
        if (!$file || ($viewer !== $target && !$file['photo_visible_to_staff'])) throw new ApiException(404, 'PHOTO_NOT_FOUND', 'No se encontró la imagen.');
        $path = $this->path($file['storage_key']);
        if (!is_file($path)) throw new ApiException(404, 'PHOTO_NOT_FOUND', 'No se encontró la imagen.');
        return ['path' => $path, 'size' => $file['byte_size']];
    }
}
