<?php
declare(strict_types=1);
require dirname(__DIR__, 3) . '/bootstrap.php';
use Hospital\Http\Request;
use Hospital\Http\Response;
$service = new Hospital\Modules\Documents\DocumentService($db, $config);
Request::method('POST'); Hospital\Security\Csrf::verify(); $user = $auth->requireUser();
$body = Request::body(['title', 'description', 'patient_id', 'category_id', 'document_date', 'create_token'], [], 11 * 1024 * 1024);
if (array_keys($_FILES) !== ['file'] || !is_array($_FILES['file'])) throw new Hospital\Http\ApiException(422, 'INVALID_UPLOAD', 'Se requiere un archivo.');
(new Hospital\Security\RateLimiter($db, $config['app_key']))->consume('document-upload:' . $user['id'], 60, 3600);
Response::json($service->create((string) $user['id'], $body, $_FILES['file']), 201);

