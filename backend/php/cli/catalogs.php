<?php
declare(strict_types=1);
if (PHP_SAPI !== 'cli') { http_response_code(404); exit; }
require dirname(__DIR__) . '/autoload.php';
try {
    $config = Hospital\Config::load(); $db = Hospital\Database::connect($config);
    $command = $argv[1] ?? '';
    if ($command === 'facilities') {
        $rows = $db->query('SELECT id, name, status, version FROM facilities ORDER BY name')->fetchAll();
        echo json_encode($rows, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR) . "\n";
    } elseif (in_array($command, ['facility-add', 'facility-rename', 'facility-archive', 'facility-restore'], true)) {
        $db->beginTransaction();
        $id = null;
        if ($command === 'facility-add') {
            $name = Hospital\Modules\Settings\SettingsService::text($argv[2] ?? null, 'name', 150, false);
            $stmt = $db->prepare('INSERT INTO facilities (name) VALUES (?)'); $stmt->execute([$name]); $id = $db->lastInsertId();
        } else {
            $id = Hospital\Http\Request::id($argv[2] ?? null);
            $stmt = $db->prepare('SELECT id FROM facilities WHERE id = ? FOR UPDATE'); $stmt->execute([$id]);
            if (!$stmt->fetchColumn()) throw new RuntimeException('Facility not found.');
            if ($command === 'facility-rename') {
                $name = Hospital\Modules\Settings\SettingsService::text($argv[3] ?? null, 'name', 150, false);
                $stmt = $db->prepare('UPDATE facilities SET name = ?, version = version + 1 WHERE id = ?'); $stmt->execute([$name, $id]);
            } else {
                $stmt = $db->prepare('UPDATE facilities SET status = ?, version = version + 1 WHERE id = ?'); $stmt->execute([$command === 'facility-archive' ? 'archived' : 'active', $id]);
            }
        }
        $stmt = $db->prepare("INSERT INTO audit_events (action, resource_type, resource_id, request_id) VALUES (?, 'facility', ?, ?)"); $stmt->execute([$command, $id, 'cli-' . bin2hex(random_bytes(8))]);
        $db->commit(); echo 'Facility operation completed, ID ' . $id . ".\n";
    } else echo "Commands: facilities | facility-add NAME | facility-rename ID NAME | facility-archive ID | facility-restore ID\n";
} catch (Throwable $error) {
    if (isset($db) && $db->inTransaction()) $db->rollBack();
    fwrite(STDERR, $error instanceof PDOException ? "Catalog operation failed. Check duplicate names and database setup.\n" : $error->getMessage() . "\n"); exit(1);
}
