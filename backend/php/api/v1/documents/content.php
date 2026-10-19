<?php
declare(strict_types=1);
require dirname(__DIR__, 3) . '/bootstrap.php';
use Hospital\Http\Request;
use Hospital\Http\ApiException;
Request::method('GET', 'HEAD'); $user = $auth->requireUser(false);
if (array_diff(array_keys($_GET), ['id', 'version', 'download'])) throw new ApiException(422, 'UNEXPECTED_FIELDS', 'Parámetro no permitido.');
$download = $_GET['download'] ?? '0';
if (!in_array($download, ['0', '1'], true)) throw new ApiException(422, 'VALIDATION_FAILED', 'Parámetro inválido.');
$service = new Hospital\Modules\Documents\DocumentService($db, $config);
$file = $service->content((string) $user['id'], Request::id($_GET['id'] ?? null), isset($_GET['version']) ? Request::id($_GET['version']) : null, $download === '1');
$start = 0; $end = $file['size'] - 1; $partial = false;
// One byte range, including suffix ranges. Multipart ranges are unnecessary here.
if (isset($_SERVER['HTTP_RANGE'])) {
    $range = $_SERVER['HTTP_RANGE'];
    if (!preg_match('/^bytes=([0-9]{0,18})-([0-9]{0,18})$/', $range, $parts) || ($parts[1] === '' && $parts[2] === '')) {
        header('Content-Range: bytes */' . $file['size']); throw new ApiException(416, 'INVALID_RANGE', 'Rango inválido.');
    }
    if ($parts[1] === '') { $start = max(0, $file['size'] - (int) $parts[2]); if ((int) $parts[2] === 0) $start = $file['size']; }
    else { $start = (int) $parts[1]; if ($parts[2] !== '') $end = min($end, (int) $parts[2]); }
    if ($start > $end || $start >= $file['size']) { header('Content-Range: bytes */' . $file['size']); throw new ApiException(416, 'INVALID_RANGE', 'Rango fuera del archivo.'); }
    $partial = true;
}
$handle = fopen($file['path'], 'rb');
if (!$handle) throw new ApiException(404, 'DOCUMENT_NOT_FOUND', 'No se encontró el archivo.');
session_write_close();
ini_set('zlib.output_compression', '0');
header('Accept-Ranges: bytes');
header('Content-Type: ' . $file['mime']);
header('Content-Security-Policy: sandbox; default-src \'none\'; frame-ancestors \'self\'');
header('Cross-Origin-Resource-Policy: same-origin');
$disposition = $download === '1' || $file['extension'] === 'docx' ? 'attachment' : 'inline';
header('Content-Disposition: ' . $disposition . '; filename="document.' . $file['extension'] . '"; filename*=UTF-8\'\'' . rawurlencode($file['name']));
header('Content-Length: ' . ($end - $start + 1));
if ($partial) { http_response_code(206); header("Content-Range: bytes $start-$end/" . $file['size']); }
try {
    if ($_SERVER['REQUEST_METHOD'] !== 'HEAD') {
        fseek($handle, $start); $remaining = $end - $start + 1;
        while ($remaining > 0 && !feof($handle) && !connection_aborted()) {
            $bytes = fread($handle, min(65536, $remaining));
            if ($bytes === false || $bytes === '') break;
            echo $bytes; $remaining -= strlen($bytes);
        }
    }
} finally { fclose($handle); }
