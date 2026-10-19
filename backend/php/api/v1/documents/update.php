<?php
declare(strict_types=1);
require dirname(__DIR__, 3) . '/bootstrap.php';
use Hospital\Http\Request;
use Hospital\Http\Response;
$service = new Hospital\Modules\Documents\DocumentService($db, $config);
Request::method('POST'); Hospital\Security\Csrf::verify(); $user = $auth->requireUser();
$body = Request::body(['id', 'version', 'title', 'description', 'patient_id', 'category_id', 'document_date']);
if ($_FILES) throw new Hospital\Http\ApiException(422, 'UNEXPECTED_FIELDS', \Hospital\I18n::t("errors.usa_el_reemplazo_de_archivo"));
Response::json($service->update((string) $user['id'], Request::id($body['id'] ?? null), $body));

