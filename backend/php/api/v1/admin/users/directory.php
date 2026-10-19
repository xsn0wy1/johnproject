<?php
declare(strict_types=1);
require dirname(__DIR__,4).'/bootstrap.php';
Hospital\Http\Request::method('GET');$auth->requireAdmin();
if ($_GET) throw new Hospital\Http\ApiException(422,'UNEXPECTED_FIELDS','Filtro no permitido.');
Hospital\Http\Response::json((new Hospital\Modules\Auth\AccountAdministration($db))->listing());
