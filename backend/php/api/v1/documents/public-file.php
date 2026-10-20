<?php
declare(strict_types=1);
require dirname(__DIR__, 3) . '/bootstrap.php';
use Hospital\Http\Request;
// This URL is a patient bearer credential. Never log its query or forward it as a referrer.
header('Referrer-Policy: no-referrer');
Request::method('GET', 'HEAD');
if (array_diff(array_keys($_GET), ['token', 'download'])) throw new Hospital\Http\ApiException(422, 'UNEXPECTED_FIELDS', Hospital\I18n::t("errors.parametro_no_permitido"));
$token = $_GET['token'] ?? '';
$download = $_GET['download'] ?? '0';
if (!is_string($token) || !in_array($download, ['0', '1'], true)) throw new Hospital\Http\ApiException(422, 'VALIDATION_FAILED', Hospital\I18n::t("errors.parametro_invalido"));
$file = (new Hospital\Modules\Documents\DocumentService($db, $config))->patientContent($token);
Hospital\Http\FileResponse::send($file, $download === '1');
