<?php
declare(strict_types=1);
require dirname(__DIR__, 3) . '/bootstrap.php';

try {
    $user = $auth->requireUser(false);
} catch (Hospital\Http\ApiException $error) {
    if ($error->status !== 401) throw $error;
    header('Location: ' . $config['base_path'] . '/index.html?reason=session_expired', true, 303);
    exit;
}
$view = $_GET['view'] ?? '';
if (!is_string($view) || !preg_match('#^(?:[a-z0-9-]+/)*[a-z0-9-]+\.html$#', $view)) {
    throw new Hospital\Http\ApiException(404, 'PAGE_NOT_FOUND', 'No se encontró la página.');
}
if (in_array($view, ['management/patients.html','management/doctors.html'], true) && !in_array('records_manager', (new Hospital\Modules\Auth\UserRepository($db))->roles((string)$user['id']), true)) {
    header('Location: ' . $config['base_path'] . '/src/views/management/management.html', true, 303);
    exit;
}
if (in_array($view, ['management/ambulances.html','management/personnel.html','management/destinations.html','management/routes.html'], true) && !(new Hospital\Modules\Transfers\TransferAccess($db,$config))->dispatch((string)$user['id'])) {
    header('Location: ' . $config['base_path'] . '/src/views/management/management.html', true, 303);
    exit;
}
if ($view==='management/accounts.html' && !in_array('admin',(new Hospital\Modules\Auth\UserRepository($db))->roles((string)$user['id']),true)) {
    header('Location: '.$config['base_path'].'/src/views/management/management.html',true,303);exit;
}
$root = realpath(dirname(__DIR__, 5) . '/public/src/views');
$file = realpath($root . '/' . $view);
if (!$file || !str_starts_with($file, $root . DIRECTORY_SEPARATOR) || !is_file($file)) {
    throw new Hospital\Http\ApiException(404, 'PAGE_NOT_FOUND', 'No se encontró la página.');
}
session_write_close();
// OSM requires a web origin referrer. Send no private page paths or record IDs.
if (in_array($view, ['traces/trace-view.html', 'traces/trace-map.html'], true)) {
    header('Referrer-Policy: strict-origin');
}
header('Content-Type: text/html; charset=utf-8');
readfile($file);
