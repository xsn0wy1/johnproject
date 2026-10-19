<?php
declare(strict_types=1);
if (PHP_SAPI !== 'cli') { http_response_code(404); exit; }
require dirname(__DIR__) . '/autoload.php';
try {
    $config = Hospital\Config::load(); $db = Hospital\Database::connect($config); $command = $argv[1] ?? '';
    if ($command === 'list') {
        echo json_encode($db->query('SELECT id, full_name, national_id, status, version FROM patients ORDER BY full_name')->fetchAll(), JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR) . "\n";
    } elseif (in_array($command, ['add', 'archive', 'restore'], true)) {
        $service = new Hospital\Modules\Patients\PatientService($db, $config);
        if ($command === 'add') {
            $id = $service->addIdentity($argv[2] ?? '', $argv[3] ?? '');
        } else {
            $id = Hospital\Http\Request::id($argv[2] ?? null);
            $stmt=$db->prepare('SELECT version FROM patients WHERE id=?'); $stmt->execute([$id]); $version=$stmt->fetchColumn();
            if (!$version) throw new RuntimeException('Patient not found.');
            $service->archive(null,$id,(int)$version,$command==='restore');
        }
        echo 'Patient catalog updated: ' . $id . "\n";
    } else { fwrite(STDERR, "Commands: list | add CI NAME | archive ID | restore ID\n"); exit(1); }
} catch (Throwable $error) {
    if (isset($db) && $db->inTransaction()) $db->rollBack();
    fwrite(STDERR, "Patient catalog operation failed. Check input, duplicates and database access.\n"); exit(1);
}
