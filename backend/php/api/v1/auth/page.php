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
    throw new Hospital\Http\ApiException(404, 'PAGE_NOT_FOUND', \Hospital\I18n::t("errors.no_se_encontro_la_pagina"));
}
if (in_array($view, ['management/patients.html','management/doctors.html'], true) && !in_array('records_manager', (new Hospital\Modules\Auth\UserRepository($db))->roles((string)$user['id']), true)) {
    header('Location: ' . $config['base_path'] . '/src/views/management/management.html', true, 303);
    exit;
}
if (in_array($view, ['management/ambulances.html','management/personnel.html','management/destinations.html','management/routes.html','traces/trace-new.html'], true) && !(new Hospital\Modules\Transfers\TransferAccess($db,$config))->dispatch((string)$user['id'])) {
    $fallback = $view === 'traces/trace-new.html' ? 'traces/trace.html' : 'management/management.html';
    header('Location: ' . $config['base_path'] . '/src/views/' . $fallback, true, 303);
    exit;
}
if ($view==='management/accounts.html' && !in_array('admin',(new Hospital\Modules\Auth\UserRepository($db))->roles((string)$user['id']),true)) {
    header('Location: '.$config['base_path'].'/src/views/management/management.html',true,303);exit;
}
$root = realpath(dirname(__DIR__, 5) . '/public/src/views');
$file = realpath($root . '/' . $view);
if (!$file || !str_starts_with($file, $root . DIRECTORY_SEPARATOR) || !is_file($file)) {
    throw new Hospital\Http\ApiException(404, 'PAGE_NOT_FOUND', \Hospital\I18n::t("errors.no_se_encontro_la_pagina"));
}
session_write_close();
// OSM requires a web origin referrer. Send no private page paths or record IDs.
if (in_array($view, ['traces/trace-view.html', 'traces/trace-map.html'], true)) {
    header('Referrer-Policy: strict-origin');
}
header('Content-Type: text/html; charset=utf-8');
readfile($file);
