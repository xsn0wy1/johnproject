"""Focused login/reset and shared-name regressions on a disposable *_test DB."""
import json
import os
import secrets
import select
import subprocess
from concurrent.futures import ThreadPoolExecutor
from auth_integration import Client, PASSWORD, ADMIN_PASSWORD, PHP, ROOT, SUFFIX, check, sql


def post(client, path, body, expected=200):
    code, payload, _ = client.call('/api/v1/' + path, 'POST', body)
    assert code == expected, payload
    return payload.get('data', payload.get('error'))


def me(client):
    code, payload, _ = client.call('/api/v1/auth/me.php')
    assert code == 200, payload
    return payload['data']


def account(admin, index):
    username = 'release_' + SUFFIX + str(index)
    ci = str(70000000 + secrets.randbelow(9999999))
    client = Client(); client.csrf()
    row = post(client, 'auth/register.php', dict(username=username, email=username+'@hospital.example', national_id=ci, password=PASSWORD), 201)
    post(admin, 'admin/users/approve.php', dict(user_id=row['user_id'], role='staff'))
    assert client.login(username, PASSWORD)[0] == 200
    return client, username, ci


def profile(client, name, expected=200, **extra):
    return post(client, 'settings/profile-update.php', dict(version=me(client)['settings']['version'], full_name=name, **extra), expected)


def race(username, password, mutation):
    process = subprocess.Popen([PHP, 'backend/php/tests/login-race.php'], cwd=ROOT, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    try:
        process.stdin.write(json.dumps(dict(username=username, password=password))+'\n'); process.stdin.flush()
        assert select.select([process.stdout], [], [], 10)[0], 'Login did not reach the lock barrier.'
        assert process.stdout.readline().strip() == 'verified', 'Login stopped before verifying the password.'
        mutation()
        process.stdin.write('continue\n'); process.stdin.flush()
        output, errors = process.communicate(timeout=10)
        assert process.returncode == 0 and not errors, errors
        return json.loads(output)
    finally:
        if process.poll() is None:
            process.kill(); process.wait()


def run():
    admin = Client(); assert admin.login('system_admin', ADMIN_PASSWORD)[0] == 200
    client, username, ci = account(admin, 0)
    original = me(client)
    check(original['user']['full_name'] == '', 'new approved accounts retain an empty initial profile')
    profile(client, 'Á'*150); profile(client, '')
    check(me(client)['user']['full_name'] == '', 'ordinary profiles retain the existing 150-character and blank-name rules')
    profile(client, 'A'*151, 422)
    new_password = secrets.token_urlsafe(24)
    def reset():
        subprocess.run([PHP, 'backend/php/cli/users.php', 'reset-password', username], cwd=ROOT, env={**os.environ, 'HOSPITAL_NEW_PASSWORD':new_password}, check=True, capture_output=True)
    result = race(username, PASSWORD, reset)
    check(result == dict(status=401, code='INVALID_CREDENTIALS', authenticated=False), 'password reset between verification and account lock rejects the old-password login')
    check(client.call('/api/v1/auth/me.php')[0] == 401 and client.login(username, PASSWORD)[0] == 401 and client.login(username, new_password)[0] == 200, 'concurrent reset revokes old sessions and only the new password can sign in')
    uid = me(client)['user']['id']
    result = race(username, new_password, lambda: sql('UPDATE users SET auth_version=auth_version+1 WHERE id='+uid))
    check(result == dict(status=401, code='INVALID_CREDENTIALS', authenticated=False), 'authentication revision changes alone cannot be adopted by an in-flight login')
    assert client.login(username, new_password)[0] == 200
    next_password = secrets.token_urlsafe(24)
    # Hash-only change exercises the independent hash comparison as well.
    def replace_hash():
        program = "require 'backend/php/autoload.php';$db=Hospital\\Database::connect(Hospital\\Config::load());$i=json_decode(stream_get_contents(STDIN),true);$s=$db->prepare('UPDATE users SET password_hash=? WHERE id=?');$s->execute([password_hash($i['password'],PASSWORD_BCRYPT,['cost'=>10]),$i['id']]);"
        subprocess.run([PHP, '-r', program], cwd=ROOT, input=json.dumps(dict(id=uid, password=next_password)), text=True, check=True, capture_output=True)
    result = race(username, new_password, replace_hash)
    check(result == dict(status=401, code='INVALID_CREDENTIALS', authenticated=False), 'a changed password hash is rejected even when the auth revision did not change')
    check(Client().login(username, next_password)[0] == 200, 'unchanged current credentials still establish a normal session')

    for index, kind in enumerate(['doctor', 'personnel', 'legacy'], 1):
        staff, _, national_id = account(admin, index)
        staff_id = me(staff)['user']['staff_id']
        if kind == 'doctor':
            fields = dict(title='Dra.', full_name='Doctora ficticia', national_id=national_id, license='MSP'+SUFFIX, specialty='Cardiología', department='Consultorios Externos', office='', phone='099 111 222', email='', availability='available', shift='morning', days='weekdays', start_time='08:00', end_time='12:00', notes='')
            saved = post(admin, 'doctors/create.php', fields, 201)
        elif kind == 'personnel':
            fields = dict(full_name='Tripulante ficticio', national_id=national_id, phone='099 111 222', responsibility='copilot', driving_license='', availability='active')
            saved = post(admin, 'personnel/create.php', fields, 201)
        else:
            sql("INSERT INTO staff_roles (staff_id,role_code) VALUES ("+staff_id+",'driver')")
            profile(staff, 'Chofer ficticio')
        before = me(staff)
        for name in ['', '   ', 'Á'*101]:
            error = profile(staff, name, 422, email='rejected_'+SUFFIX+'@hospital.example')
            check(error['code'] == 'VALIDATION_FAILED' and 'full_name' in error['fields'], kind+' identities reject blank/overlong names through settings')
        after = me(staff)
        check(after['user']['full_name'] == before['user']['full_name'] and after['user']['email'] == before['user']['email'] and after['settings']['version'] == before['settings']['version'], kind+' name validation leaves shared identity, email and revision unchanged')
        profile(staff, 'Á'*100)
        check(me(staff)['user']['full_name'] == 'Á'*100, kind+' accepts exactly 100 Unicode characters')
        if kind != 'legacy':
            path = 'doctors' if kind == 'doctor' else 'personnel'
            current = admin.call('/api/v1/'+path+'/get.php?id='+staff_id)[1]['data']
            post(admin, path+'/update.php', {**fields, 'id':staff_id, 'version':current['version'], 'full_name':'Á'*100})
            check(True, kind+' editor can reopen and save the name accepted by settings')
            current = admin.call('/api/v1/'+path+'/get.php?id='+staff_id)[1]['data']
            post(admin, path+'/archive.php', dict(id=staff_id, version=current['version']))
            profile(staff, '', 422)
            check(me(staff)['user']['full_name'] == 'Á'*100, 'archived '+kind+' profiles retain compatible name rules')
    # Independent connections contend on one existing bucket, as anonymous
    # survey submissions do. No retries may hide database lock failures.
    bucket = 'release-limiter-' + SUFFIX
    program = "require 'backend/php/autoload.php';$c=Hospital\\Config::load();$db=Hospital\\Database::connect($c);try{(new Hospital\\Security\\RateLimiter($db,$c['app_key']))->consume(trim(stream_get_contents(STDIN)),4,60);echo 200;}catch(Hospital\\Http\\ApiException $e){echo $e->status;}"
    def consume(_):
        result = subprocess.run([PHP, '-r', program], cwd=ROOT, input=bucket, text=True, capture_output=True, check=True)
        assert not result.stderr, result.stderr
        return int(result.stdout)
    assert consume(0) == 200
    with ThreadPoolExecutor(8) as pool:
        codes = list(pool.map(consume, range(7)))
    check(sorted(codes) == [200]*3+[429]*4, 'concurrent rate limiting serializes one bucket without deadlocks or exceeding its cap')
    print('Release fix integration checks completed.')


if __name__ == '__main__':
    run()
