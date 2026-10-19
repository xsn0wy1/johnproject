<?php
declare(strict_types=1);
require dirname(__DIR__, 3) . '/bootstrap.php';
use Hospital\Http\Request;
use Hospital\Http\Response;
$service = new Hospital\Modules\Documents\DocumentService($db, $config);
Request::method('POST'); Hospital\Security\Csrf::verify(); $user = $auth->requireUser();
$body = Request::body(['documents'], ['documents']); $items = $body['documents'] ?? null;
if (!is_array($items) || array_keys($items) !== range(0, count($items) - 1) || count($items) > 100) throw new Hospital\Http\ApiException(422, 'VALIDATION_FAILED', 'Seleccioná entre 1 y 100 documentos.');
$seen = []; $targets = [];
foreach ($items as $item) {
    if (!is_array($item) || array_diff(array_keys($item), ['id', 'version'])) throw new Hospital\Http\ApiException(422, 'VALIDATION_FAILED', 'Selección inválida.');
    $id = Request::id($item['id'] ?? null);
    if (isset($seen[$id])) throw new Hospital\Http\ApiException(422, 'VALIDATION_FAILED', 'Selección duplicada.');
    $seen[$id] = true; $targets[] = ['id' => $id, 'version' => $item['version'] ?? null];
}
$results = [];
foreach ($targets as $item) {
    try { $service->archive((string) $user['id'], $item['id'], $item['version']); $results[] = ['id' => $item['id'], 'success' => true]; }
    catch (Hospital\Http\ApiException $error) { $results[] = ['id' => $item['id'], 'success' => false, 'error' => ['code' => $error->errorCode, 'status' => $error->status, 'message' => $error->getMessage()]]; }
}
Response::json($results);

