<?php
declare(strict_types=1);
require dirname(__DIR__, 3) . '/bootstrap.php';
use Hospital\Http\Request;
use Hospital\Http\Response;
use Hospital\Security\Csrf;
use Hospital\Modules\Settings\SettingsService;

Request::method('GET');
$auth->requireUser(false);
$rows = $db->query("SELECT id, name, address, locality FROM facilities WHERE status = 'active' AND availability = 'active' ORDER BY name LIMIT 500")->fetchAll();
$counts = array_count_values(array_map(static fn(array $row): string => mb_strtolower($row['name']), $rows));
Response::json(array_map(static fn(array $row): array => ['id' => (string) $row['id'],
    'name' => $counts[mb_strtolower($row['name'])] > 1 ? implode(' · ', array_filter([$row['name'],$row['address'],$row['locality']])) : $row['name']], $rows));
