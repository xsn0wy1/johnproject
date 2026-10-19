<?php
declare(strict_types=1);
namespace Hospital;

final class Database
{
    public static function connect(array $config, bool $selectDatabase = true): \PDO
    {
        $db = $config['db'];
        $dsn = $db['socket'] !== '' ? 'mysql:unix_socket=' . $db['socket'] : 'mysql:host=' . $db['host'] . ';port=' . $db['port'];
        if ($selectDatabase) $dsn .= ';dbname=' . $db['name'];
        $pdo = new \PDO($dsn . ';charset=utf8mb4', $db['user'], $db['password'], [
            \PDO::ATTR_ERRMODE => \PDO::ERRMODE_EXCEPTION,
            \PDO::ATTR_DEFAULT_FETCH_MODE => \PDO::FETCH_ASSOC,
            \PDO::ATTR_EMULATE_PREPARES => false,
        ]);
        $pdo->exec("SET time_zone = '+00:00'");
        $pdo->exec("SET SESSION sql_mode = 'STRICT_TRANS_TABLES,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION'");
        return $pdo;
    }
}
