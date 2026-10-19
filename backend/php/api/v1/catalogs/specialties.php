<?php
declare(strict_types=1);
require dirname(__DIR__, 3) . '/bootstrap.php';
use Hospital\Http\Request;
use Hospital\Http\Response;
use Hospital\Security\Csrf;
use Hospital\Modules\Settings\SettingsService;

Request::method('GET');
$auth->requireUser(false);
$rows = $db->query("SELECT id, name FROM specialties WHERE status = 'active' ORDER BY name LIMIT 500")->fetchAll();
Response::json(array_map(static fn(array $row): array => ['id' => (string) $row['id'], 'name' => $row['name']], $rows));
