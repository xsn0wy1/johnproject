<?php
declare(strict_types=1);
// Also handles Apache's missing API files without requiring a database connection.
require dirname(__DIR__, 3) . '/autoload.php';
$GLOBALS['request_id'] = bin2hex(random_bytes(12));
header('Cache-Control: no-store, private');
header('X-Content-Type-Options: nosniff');
Hospital\Http\Response::error(new Hospital\Http\ApiException(404, 'NOT_FOUND', 'No se encontró el endpoint.'));
