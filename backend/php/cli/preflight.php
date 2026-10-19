<?php
declare(strict_types=1);
if (PHP_SAPI!=='cli') { http_response_code(404);exit; }
require dirname(__DIR__).'/autoload.php';
try {
    $options=getopt('',['prepare-storage','web-user:','recover-from:']);$config=Hospital\Config::load();$db=Hospital\Database::connect($config);
    $maintenance=new Hospital\Storage\StorageMaintenance($db,$config);
    if (isset($options['prepare-storage'])) $maintenance->prepare($options['web-user']??null);
    $recovery=isset($options['recover-from'])?$maintenance->recover($options['recover-from']):null;
    if ($recovery!==null&&isset($options['web-user'])) $maintenance->prepare($options['web-user']);
    $applied=$db->query('SELECT version FROM schema_migrations ORDER BY version')->fetchAll(PDO::FETCH_COLUMN);
    $expected=['001_user_system'];foreach (glob(dirname(__DIR__,3).'/db/sql/migrations/*.sql') as $path) $expected[]=basename($path,'.sql');
    $extensions=[];foreach (['pdo_mysql','mbstring','gd','zip','dom','curl','fileinfo'] as $extension) $extensions[$extension]=extension_loaded($extension);
    $storage=$maintenance->check();$missing=array_values(array_diff($expected,$applied));
    $healthy=PHP_VERSION_ID>=80000&&!in_array(false,$extensions,true)&&!$missing&&!$storage['missing']&&!$storage['mismatched'];
    foreach ($storage['areas'] as $area) $healthy=$healthy&&$area['exists']&&$area['readable']&&$area['writable'];
    echo json_encode(['healthy'=>$healthy,'php'=>PHP_VERSION,'database_version'=>$db->query('SELECT VERSION()')->fetchColumn(),'base_path'=>$config['base_path'],'extensions'=>$extensions,'missing_migrations'=>$missing,'storage'=>$storage,'recovery'=>$recovery,'note'=>'Access checks apply only to checked_as. Verify Apache under its actual user and verify the configured API Alias separately.'],JSON_PRETTY_PRINT|JSON_THROW_ON_ERROR)."\n";
    exit($healthy?0:1);
} catch (Throwable $e) { fwrite(STDERR,'Preflight failed: '.($e instanceof PDOException?'Database unavailable; verify configuration and migrations.':$e->getMessage())."\n");exit(1); }
