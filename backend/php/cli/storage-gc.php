<?php
declare(strict_types=1);
if (PHP_SAPI !== 'cli') { http_response_code(404); exit; }
require dirname(__DIR__) . '/autoload.php';
try {
    $config = Hospital\Config::load(); $db = Hospital\Database::connect($config);
    $storage = new Hospital\Storage\PrivateStorage($config);
    $count = 0;
    foreach (['users' => 'png', 'documents' => 'bin', 'quarantine' => 'bin'] as $area => $extension) {
      if (!is_dir(rtrim($config['storage_path'], '/\\') . '/' . $area)) continue;
      foreach (glob($storage->directory($area) . '/*.' . $extension) as $file) {
        $key = basename($file, '.' . $extension);
        if (!preg_match('/^[a-f0-9]{64}$/', $key) || is_link($file) || filemtime($file) > time() - 86400) continue;
        $stmt = $db->prepare('SELECT state FROM stored_files WHERE storage_key = ?'); $stmt->execute([$key]); $state = $stmt->fetchColumn();
        if ($state === 'ready') continue;
        if (!unlink($file)) throw new RuntimeException('Private cleanup failed.');
        $count++;
      }
    }
    echo 'Private storage cleanup removed ' . $count . " unreferenced/retired files.\n";
} catch (Throwable $error) { fwrite(STDERR, "Private storage cleanup failed. Check database/storage access.\n"); exit(1); }
