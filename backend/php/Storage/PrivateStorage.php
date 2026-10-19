<?php
declare(strict_types=1);
namespace Hospital\Storage;

/** Opaque paths shared by document uploads and profile images. */
final class PrivateStorage
{
    private array $config;
    public function __construct(array $config) { $this->config = $config; }

    public function directory(string $area, bool $create = false): string
    {
        if (!in_array($area, ['users', 'documents', 'quarantine'], true)) throw new \RuntimeException('Invalid storage area.');
        $path = rtrim($this->config['storage_path'], '/\\') . '/' . $area;
        if ($create && !is_dir($path) && !mkdir($path, 0700, true) && !is_dir($path)) throw new \RuntimeException('Private storage unavailable.');
        $real = realpath($path); $public = realpath(dirname(__DIR__, 3) . '/public');
        if (!$real || !$public || $real === $public || str_starts_with($real, $public . DIRECTORY_SEPARATOR)) throw new \RuntimeException('Invalid private storage.');
        return $real;
    }

    public function path(string $area, string $key, string $extension = 'bin'): string
    {
        if (!preg_match('/^[a-f0-9]{64}$/', $key) || !in_array($extension, ['bin', 'png'], true)) throw new \RuntimeException('Invalid storage key.');
        $path = $this->directory($area) . '/' . $key . '.' . $extension;
        if (is_link($path)) throw new \RuntimeException('Invalid private file.');
        return $path;
    }
}
