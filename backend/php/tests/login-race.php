<?php
declare(strict_types=1);
// CLI-only synchronization fixture for tests/release_fixes_integration.py.
if (PHP_SAPI !== 'cli') { http_response_code(404); exit; }
require dirname(__DIR__) . '/autoload.php';
$config = Hospital\Config::load();
if (!str_ends_with($config['db']['name'], '_test')) throw new RuntimeException('Use a disposable *_test database.');

final class LoginBarrierPDO extends PDO
{
    public function prepare($query, $options = []): PDOStatement|false
    {
        if (str_starts_with($query, 'SELECT u.*, s.full_name AS staff_name') && str_ends_with($query, ' FOR UPDATE')) {
            // AuthService has verified the supplied password and is about to lock.
            fwrite(STDOUT, "verified\n");
            if (trim((string) fgets(STDIN)) !== 'continue') throw new RuntimeException('Missing test release.');
        }
        return parent::prepare($query, $options);
    }
}

$d = $config['db'];
$dsn = $d['socket'] !== '' ? 'mysql:unix_socket=' . $d['socket'] : 'mysql:host=' . $d['host'] . ';port=' . $d['port'];
$db = new LoginBarrierPDO($dsn . ';dbname=' . $d['name'] . ';charset=utf8mb4', $d['user'], $d['password'], [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION, PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC, PDO::ATTR_EMULATE_PREPARES => false]);
$db->exec("SET time_zone = '+00:00'");
$GLOBALS['request_id'] = 'test-login-race';
session_set_save_handler(new Hospital\Security\DatabaseSessionHandler($db, $config), true);
session_start();
$input = json_decode((string) fgets(STDIN), true, 32, JSON_THROW_ON_ERROR);
try {
    (new Hospital\Modules\Auth\AuthService($db, $config))->login($input);
    $result = ['status' => 200];
} catch (Hospital\Http\ApiException $error) {
    $result = ['status' => $error->status, 'code' => $error->errorCode];
}
$result['authenticated'] = isset($_SESSION['user_id']);
session_destroy();
fwrite(STDOUT, json_encode($result, JSON_THROW_ON_ERROR) . "\n");
