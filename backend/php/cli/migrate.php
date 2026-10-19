<?php
declare(strict_types=1);
if (PHP_SAPI !== 'cli') { http_response_code(404); exit; }
require dirname(__DIR__) . '/autoload.php';
try {
    $config = Hospital\Config::load();
    $config['db']['user'] = getenv('HOSPITAL_SETUP_DB_USER') ?: 'root';
    $config['db']['password'] = getenv('HOSPITAL_SETUP_DB_PASSWORD') ?: '';
    Hospital\Migrations::apply(Hospital\Database::connect($config), $config['db']['name']);
    echo "Migrations applied.\n";
} catch (Throwable $error) { fwrite(STDERR, "Migration failed. Check SQL administrative credentials and schema state.\n"); exit(1); }
