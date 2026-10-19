<?php
declare(strict_types=1);
if (PHP_SAPI !== 'cli') { http_response_code(404); exit; }
require dirname(__DIR__) . '/autoload.php';

try {
    $local = dirname(__DIR__) . '/config/local.php';
    $existing = is_file($local) ? require $local : [];
    if (getenv('HOSPITAL_APP_KEY') === false && empty($existing['app_key'])) putenv('HOSPITAL_APP_KEY=' . bin2hex(random_bytes(32)));
    if (getenv('HOSPITAL_DB_PASSWORD') === false && empty($existing['db']['password'])) putenv('HOSPITAL_DB_PASSWORD=' . bin2hex(random_bytes(24)));
    $config = Hospital\Config::load();
    if (!preg_match('/^[a-zA-Z0-9_]{1,32}$/', $config['db']['user']) || $config['db']['user'] === 'root') throw new RuntimeException('Choose a dedicated HOSPITAL_DB_USER, not root.');
    $admin = $config;
    $admin['db']['user'] = getenv('HOSPITAL_SETUP_DB_USER') ?: 'root';
    $admin['db']['password'] = getenv('HOSPITAL_SETUP_DB_PASSWORD') ?: '';
    $db = Hospital\Database::connect($admin, false);
    $schema = file_get_contents(dirname(__DIR__, 3) . '/db/sql/schema.sql');
    $name = $config['db']['name'];
    $schema = str_replace(['CREATE DATABASE IF NOT EXISTS hospital ', 'USE hospital;'], ['CREATE DATABASE IF NOT EXISTS `' . $name . '` ', 'USE `' . $name . '`;'], $schema);
    $db->exec($schema);
    Hospital\Migrations::apply($db, $name);
    foreach (['localhost', '127.0.0.1'] as $host) {
        $account = $db->quote($config['db']['user']) . '@' . $db->quote($host);
        $db->exec('CREATE USER IF NOT EXISTS ' . $account . ' IDENTIFIED BY ' . $db->quote($config['db']['password']));
        $db->exec('GRANT SELECT, INSERT, UPDATE, DELETE ON `' . $name . '`.* TO ' . $account);
    }
    Hospital\Database::connect($config); // Verify application credentials before saving.
    if (!in_array('--no-config', $argv, true) && !is_file($local)) {
        $old = umask(0077);
        $handle = fopen($local, 'x');
        if (!$handle) throw new RuntimeException('Could not create local configuration.');
        fwrite($handle, "<?php\nreturn " . var_export($config, true) . ";\n"); fclose($handle); umask($old);
    }
    $storage=new Hospital\Storage\PrivateStorage($config);
    foreach (['users','documents','quarantine'] as $area) $storage->directory($area,true);
    foreach ($argv as $argument) if (str_starts_with($argument,'--web-user=')) (new Hospital\Storage\StorageMaintenance(Hospital\Database::connect($config),$config))->prepare(substr($argument,11));
    echo "Schema installed and migrations applied. Application DB connection verified.\n";
    echo in_array('--no-config', $argv, true) ? "Configuration supplied by environment; no file written.\n" : "Private configuration: backend/php/config/local.php (existing file preserved).\n";
} catch (Throwable $error) {
    fwrite(STDERR, 'Setup failed: ' . ($error instanceof PDOException ? 'Check the database service, administrative credentials and application account password.' : $error->getMessage()) . "\n"); exit(1);
}
