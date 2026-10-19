<?php
declare(strict_types=1);
require dirname(__DIR__, 3) . '/bootstrap.php';
use Hospital\Http\ApiException;
// Search terms may contain patient identity. Keep them out of URLs/access logs.
Hospital\Http\Request::method('POST'); $auth->requireUser(false); Hospital\Security\Csrf::verify();
if ($_GET) throw new ApiException(422, 'UNEXPECTED_FIELDS', 'Filtro no permitido.');
$body = Hospital\Http\Request::body(['q']);
$q = Hospital\Modules\Settings\SettingsService::text($body['q'] ?? '', 'q', 150, true);
if (mb_strlen($q) < 2) { Hospital\Http\Response::json([]); return; }
$pattern = '%' . str_replace(['!', '%', '_'], ['!!', '!%', '!_'], $q) . '%';
$ci = preg_replace('/[.\s-]/', '', $q);
$stmt = $db->prepare("SELECT id, full_name, national_id FROM patients WHERE status = 'active' AND (full_name LIKE ? ESCAPE '!' OR national_id LIKE ? ESCAPE '!') ORDER BY full_name, id LIMIT 20");
$stmt->execute([$pattern, '%' . str_replace(['!', '%', '_'], ['!!', '!%', '!_'], $ci) . '%']);
Hospital\Http\Response::json(array_map(static fn(array $row): array => ['id' => (string) $row['id'], 'full_name' => $row['full_name'], 'national_id' => $row['national_id']], $stmt->fetchAll()));
