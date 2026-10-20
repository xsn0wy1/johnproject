<?php
declare(strict_types=1);
require dirname(__DIR__, 3) . '/bootstrap.php';
use Hospital\Http\Request;
use Hospital\Http\ApiException;
Request::method('GET', 'HEAD'); $user = $auth->requireUser(false);
if (array_diff(array_keys($_GET), ['id', 'version', 'download'])) throw new ApiException(422, 'UNEXPECTED_FIELDS', \Hospital\I18n::t("errors.parametro_no_permitido"));
$download = $_GET['download'] ?? '0';
if (!in_array($download, ['0', '1'], true)) throw new ApiException(422, 'VALIDATION_FAILED', \Hospital\I18n::t("errors.parametro_invalido"));
$service = new Hospital\Modules\Documents\DocumentService($db, $config);
$file = $service->content((string) $user['id'], Request::id($_GET['id'] ?? null), isset($_GET['version']) ? Request::id($_GET['version']) : null, $download === '1');
Hospital\Http\FileResponse::send($file, $download === '1');
