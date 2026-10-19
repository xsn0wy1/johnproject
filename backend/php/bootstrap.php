<?php
declare(strict_types=1);

require_once __DIR__ . '/autoload.php';
$GLOBALS['request_id'] = bin2hex(random_bytes(12));
ini_set('display_errors', '0');
set_exception_handler(static function (Throwable $error): void {
    if ($error instanceof Hospital\Http\ApiException) {
        Hospital\Http\Response::error($error);
    } else {
        // Do not log SQL parameters, request bodies, credentials, CI or session IDs.
        $diagnostic=get_class($error).' at '.basename($error->getFile()).':'.$error->getLine();
        if ($error instanceof PDOException) {
            $state=$error->errorInfo[0]??'';$number=$error->errorInfo[1]??0;
            if (is_string($state)&&preg_match('/^[A-Z0-9]{5}$/',$state)) $diagnostic.=' SQLSTATE='.$state;
            if (is_int($number)) $diagnostic.=' driver_code='.$number;
        }
        error_log('Hospital request '.$GLOBALS['request_id'].' failed: '.$diagnostic);
        Hospital\Http\Response::error(new Hospital\Http\ApiException(503, 'SERVICE_UNAVAILABLE', \Hospital\I18n::t("errors.el_servicio_no_esta_disponible_revisa_la_configuracion_o_intenta_nuevamente")));
    }
});
if (PHP_SAPI !== 'cli') {
    header('Cache-Control: no-store, private');
    header('Pragma: no-cache');
    header('X-Content-Type-Options: nosniff');
    header('Referrer-Policy: same-origin');
}
$config = Hospital\Config::load();
$db = Hospital\Database::connect($config);

if (PHP_SAPI !== 'cli') {
    ini_set('session.use_strict_mode', '1');
    ini_set('session.use_only_cookies', '1');
    ini_set('session.use_trans_sid', '0');
    ini_set('session.gc_maxlifetime', (string) $config['session_absolute_seconds']);
    session_name('hospital_session');
    session_cache_limiter(''); // Keep the explicit private/no-store headers above.
    session_set_cookie_params(['lifetime' => 0, 'path' => ($config['base_path'] ?: '') . '/', 'secure' => $config['secure_cookies'], 'httponly' => true, 'samesite' => 'Lax']);
    session_set_save_handler(new Hospital\Security\DatabaseSessionHandler($db, $config), true);
    session_start();
    if (!isset($_SESSION['_created_at'])) $_SESSION['_created_at'] = time();
}
$auth = new Hospital\Modules\Auth\AuthService($db, $config);
