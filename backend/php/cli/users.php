<?php
declare(strict_types=1);
if (PHP_SAPI !== 'cli') { http_response_code(404); exit; }
require dirname(__DIR__) . '/autoload.php';

try {
    $config = Hospital\Config::load(); $db = Hospital\Database::connect($config);
    $users = new Hospital\Modules\Auth\UserRepository($db);
    $admin = new Hospital\Modules\Auth\AccountAdministration($db);
    $request = 'cli-' . bin2hex(random_bytes(8));
    $command = $argv[1] ?? '';
    if ($command === 'create-admin') {
        if (count($argv) !== 5) throw new RuntimeException('Usage: users.php create-admin USERNAME EMAIL FICTIONAL_CI');
        $password = getenv('HOSPITAL_ADMIN_PASSWORD');
        if ($password === false) {
            fwrite(STDOUT, 'New administrator password (at least 12 characters): ');
            $tty = function_exists('stream_isatty') && stream_isatty(STDIN);
            if ($tty) shell_exec('stty -echo');
            try { $password = rtrim((string) fgets(STDIN), "\r\n"); }
            finally { if ($tty) shell_exec('stty echo'); fwrite(STDOUT, "\n"); }
        }
        $id = $admin->createFirstAdmin(['username' => $argv[2], 'email' => $argv[3], 'national_id' => $argv[4], 'password' => $password], $config['bcrypt_cost'], $request);
        echo 'First administrator created, ID ' . $id . ". No default password is stored in source.\n";
    } elseif ($command === 'list') {
        echo json_encode($admin->listing(),JSON_PRETTY_PRINT|JSON_THROW_ON_ERROR)."\n";
    } elseif ($command === 'pending') {
        echo json_encode($users->pending(), JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR) . "\n";
    } elseif (in_array($command, ['approve','disable','sessions','roles','reactivate','revoke-sessions','reset-password'], true)) {
        $user = $users->byUsername(strtolower($argv[2] ?? ''));
        if (!$user) throw new RuntimeException('Account not found.');
        $id = (string) $user['id'];
        if ($command === 'approve') $admin->approve($id, $argv[3] ?? 'staff', null, $request);
        if ($command === 'disable') $admin->disable($id, null, $request);
        if (in_array($command,['roles','reactivate','revoke-sessions'],true)) $admin->manage($id,(int)$user['version'],$command==='revoke-sessions'?'revoke_sessions':$command,$command==='roles'?explode(',',$argv[3]??''):[],null,$request);
        if ($command==='reset-password') (new Hospital\Modules\Auth\PasswordService($db,$config))->change(null,$id,['version'=>(int)$user['version'],'new_password'=>getenv('HOSPITAL_NEW_PASSWORD')],true);
        if ($command === 'sessions') echo json_encode((new Hospital\Modules\Auth\SessionRepository($db))->listOwn($id, ''), JSON_PRETTY_PRINT | JSON_THROW_ON_ERROR) . "\n";
        else echo 'Account ' . $command . " completed.\n";
    } else {
        echo "Commands: create-admin USER EMAIL FICTIONAL_CI | list | pending | approve USER [ROLE] | roles USER ROLE,ROLE | disable USER | reactivate USER | revoke-sessions USER | reset-password USER (HOSPITAL_NEW_PASSWORD) | sessions USER\n";
    }
} catch (Throwable $error) {
    fwrite(STDERR, ($error instanceof PDOException ? 'Database operation failed. Check setup and duplicate account data.' : $error->getMessage()) . "\n"); exit(1);
}
