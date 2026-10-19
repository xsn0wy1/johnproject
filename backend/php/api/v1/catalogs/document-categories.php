<?php
declare(strict_types=1);
require dirname(__DIR__, 3) . '/bootstrap.php';
Hospital\Http\Request::method('GET'); $auth->requireUser(false);
$rows = $db->query('SELECT id, code, name, requires_patient FROM document_categories ORDER BY id')->fetchAll();
Hospital\Http\Response::json(array_map(static fn(array $row): array => ['id' => (string) $row['id'], 'code' => $row['code'], 'name' => $row['name'], 'requires_patient' => (bool) $row['requires_patient']], $rows));
