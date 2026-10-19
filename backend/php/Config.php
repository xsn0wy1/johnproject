<?php
declare(strict_types=1);
namespace Hospital;

final class Config
{
    public static function load(): array
    {
        $local = __DIR__ . '/config/local.php';
        $config = is_file($local) ? require $local : [];
        $env = static function (string $name, $default) {
            $value = getenv('HOSPITAL_' . $name);
            return $value === false ? $default : $value;
        };
        $db = $config['db'] ?? [];
        $config['db'] = [
            'host' => $env('DB_HOST', $db['host'] ?? '127.0.0.1'),
            'port' => (int) $env('DB_PORT', $db['port'] ?? 3306),
            'socket' => $env('DB_SOCKET', $db['socket'] ?? ''),
            'name' => $env('DB_NAME', $db['name'] ?? 'hospital'),
            'user' => $env('DB_USER', $db['user'] ?? 'hospital_app'),
            'password' => $env('DB_PASSWORD', $db['password'] ?? ''),
        ];
        $config['app_key'] = $env('APP_KEY', $config['app_key'] ?? '');
        $config['base_path'] = rtrim((string) $env('BASE_PATH', $config['base_path'] ?? ''), '/');
        $config['secure_cookies'] = filter_var($env('SECURE_COOKIES', $config['secure_cookies'] ?? false), FILTER_VALIDATE_BOOLEAN);
        $config['session_idle_seconds'] = (int) $env('SESSION_IDLE_SECONDS', $config['session_idle_seconds'] ?? 1800);
        $config['session_absolute_seconds'] = (int) $env('SESSION_ABSOLUTE_SECONDS', $config['session_absolute_seconds'] ?? 28800);
        $config['bcrypt_cost'] = (int) $env('BCRYPT_COST', $config['bcrypt_cost'] ?? 12);
        $config['app_url'] = rtrim((string) $env('APP_URL', $config['app_url'] ?? 'http://127.0.0.1:8080' . $config['base_path']), '/') . '/';
        $config['brevo_api_key'] = (string) $env('BREVO_API_KEY', $config['brevo_api_key'] ?? '');
        $config['mail_from_email'] = (string) $env('MAIL_FROM_EMAIL', $config['mail_from_email'] ?? '');
        $config['mail_from_name'] = (string) $env('MAIL_FROM_NAME', $config['mail_from_name'] ?? 'Hospital — Proyecto educativo');
        $config['storage_path'] = (string) $env('STORAGE_PATH', $config['storage_path'] ?? dirname(__DIR__, 2) . '/storage');
        $config['document_scanner'] = (string) $env('DOCUMENT_SCANNER', $config['document_scanner'] ?? '');
        $config['route_mapping_enabled'] = filter_var($env('ROUTE_MAPPING_ENABLED', $config['route_mapping_enabled'] ?? true), FILTER_VALIDATE_BOOLEAN);
        $config['geocoder_url'] = (string) $env('GEOCODER_URL', $config['geocoder_url'] ?? 'https://photon.komoot.io/api/');
        $config['router_url'] = (string) $env('ROUTER_URL', $config['router_url'] ?? 'https://router.project-osrm.org/route/v1/driving');
        $config['unmapped_duration_seconds'] = (int) $env('UNMAPPED_DURATION_SECONDS', $config['unmapped_duration_seconds'] ?? 3600);
        if ($config['unmapped_duration_seconds']<900 || $config['unmapped_duration_seconds']>172800) throw new \RuntimeException('Invalid unmapped booking interval.');
        $config['map_country'] = (string) $env('MAP_COUNTRY', $config['map_country'] ?? 'UY');
        if (strlen($config['app_key']) < 32 || str_starts_with($config['app_key'], 'REPLACE_')) {
            throw new \RuntimeException('Configure HOSPITAL_APP_KEY or backend/php/config/local.php.');
        }
        if (!preg_match('/^[a-zA-Z0-9_]+$/', $config['db']['name']) ||
            !preg_match('#^(?:/[a-zA-Z0-9_-]+)*$#', $config['base_path']) ||
            $config['session_idle_seconds'] < 2 || $config['session_absolute_seconds'] < $config['session_idle_seconds'] ||
            $config['bcrypt_cost'] < 10 || $config['bcrypt_cost'] > 14) {
            throw new \RuntimeException('Invalid application configuration.');
        }
        return $config;
    }
}
