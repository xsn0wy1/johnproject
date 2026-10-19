"""API integration tests against a disposable *_test database and a running site.

Requires HOSPITAL_APP_KEY, HOSPITAL_DB_*, HOSPITAL_ADMIN_PASSWORD and an installed
system_admin fixture. These tests intentionally modify only the named test DB.
"""
import http.cookiejar
import json
import os
import secrets
import subprocess
import time
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
BASE = os.environ.get('HOSPITAL_AUTH_TEST_URL', 'http://127.0.0.1:8871').rstrip('/')
PHP = os.environ.get('HOSPITAL_TEST_PHP', '/Applications/XAMPP/xamppfiles/bin/php')
assert os.environ.get('HOSPITAL_DB_NAME', '').endswith('_test'), 'Use a disposable *_test database.'
PASSWORD = secrets.token_urlsafe(20)
SUFFIX = secrets.token_hex(4)
USERNAME = 'staff_' + SUFFIX
CI = str(90000000 + secrets.randbelow(9999999))
ADMIN_PASSWORD = os.environ['HOSPITAL_ADMIN_PASSWORD']
checks = 0


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


class Client:
    def __init__(self, base=BASE):
        self.base = base
        self.jar = http.cookiejar.CookieJar()
        self.opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(self.jar), NoRedirect())
        self.token = None

    def cookie(self):
        return next((c.value for c in self.jar if c.name == 'hospital_session'), None)

    def copy_session(self):
        other = Client(self.base)
        for cookie in self.jar:
            other.jar.set_cookie(cookie)
        other.token = self.token
        return other

    def call(self, path, method='GET', body=None, csrf=True, raw=None):
        headers = {'Accept': 'application/json', 'User-Agent': 'Hospital disposable integration test'}
        data = None
        if body is not None or raw is not None:
            data = (json.dumps(body).encode() if raw is None else raw.encode())
            headers['Content-Type'] = 'application/json'
        if method == 'POST' and csrf and self.token:
            headers['X-CSRF-Token'] = self.token
        req = urllib.request.Request(self.base + path, data=data, headers=headers, method=method)
        try:
            response = self.opener.open(req, timeout=15)
        except urllib.error.HTTPError as error:
            response = error
        raw_body = response.read()
        payload = json.loads(raw_body) if 'application/json' in response.headers.get('Content-Type', '') else raw_body.decode(errors='replace')
        data_object = payload.get('data') if isinstance(payload, dict) else None
        if isinstance(data_object, dict) and data_object.get('csrf_token'):
            self.token = data_object['csrf_token']
        return response.status, payload, response.headers

    def csrf(self):
        status, payload, _ = self.call('/api/v1/auth/csrf.php')
        assert status == 200, payload
        self.token = payload['data']['csrf_token']

    def login(self, username=USERNAME, password=PASSWORD):
        self.csrf()
        return self.call('/api/v1/auth/login.php', 'POST', {'username': username, 'password': password})


def check(condition, label):
    global checks
    assert condition, label
    checks += 1
    print('PASS', label, flush=True)


def sql(statement):
    # The SQL comes from this test, never an HTTP request. Credentials stay in env.
    program = '''require 'backend/php/autoload.php'; $db=Hospital\\Database::connect(Hospital\\Config::load());
    $sql=stream_get_contents(STDIN); $stmt=$db->query($sql); echo json_encode($stmt->columnCount() ? $stmt->fetchAll() : []);'''
    result = subprocess.run([PHP, '-r', program], input=statement, text=True, cwd=ROOT, capture_output=True, check=True)
    return json.loads(result.stdout)


def run():
    anon = Client()
    check(anon.call('/api/v1/auth/me.php')[0] == 401, 'anonymous current-user access denied')
    code, _, headers = anon.call('/src/views/main-menu.html')
    check(code == 303 and 'index.html' in headers['Location'], 'private HTML is guarded on the server')
    check(anon.call('/backend/php/config/example.php')[0] == 404 and anon.call('/db/sql/schema.sql')[0] == 404, 'private code and SQL are outside the web root')
    code, body, _ = anon.call('/api/v1/auth/missing.php')
    check(code == 404 and body['success'] is False, 'unknown API returns JSON 404 rather than login HTML')
    anon.csrf()
    cookie = next(c for c in anon.jar if c.name == 'hospital_session')
    check('HttpOnly' in cookie._rest and cookie._rest.get('SameSite') == 'Lax', 'session cookie has HttpOnly and SameSite protections')
    check(anon.call('/api/v1/auth/login.php', 'POST', {}, csrf=False)[0] == 403, 'login rejects missing CSRF token')
    check(anon.call('/api/v1/auth/login.php', 'POST', raw='{')[0] == 400, 'malformed JSON rejected')
    check(anon.call('/api/v1/auth/login.php', 'POST', raw='[]')[0] == 400, 'JSON arrays are not accepted as account objects')
    data = {'username': USERNAME, 'email': USERNAME + '@hospital.example', 'password': PASSWORD, 'national_id': CI}
    check(anon.call('/api/v1/auth/register.php', 'POST', {**data, 'role': 'admin'})[0] == 422, 'client cannot submit account privileges')
    check(anon.call('/api/v1/auth/register.php', 'POST', {**data, 'password': 'short'})[0] == 422, 'password minimum enforced by PHP')
    check(anon.call('/api/v1/auth/register.php', 'POST', {**data, 'password': 'é' * 40})[0] == 422, 'bcrypt byte limit rejects truncating Unicode passwords')
    code, body, _ = anon.call('/api/v1/auth/register.php', 'POST', data)
    check(code == 201 and body['data']['status'] == 'pending', 'registration persists a pending staff application')
    user_id = body['data']['user_id']
    check(isinstance(user_id, str), 'API user IDs use canonical strings')
    check(anon.call('/api/v1/auth/register.php', 'POST', {**data, 'username': USERNAME.upper()})[0] == 409, 'normalized duplicate username is rejected')
    check(anon.call('/api/v1/auth/register.php', 'POST', {**data, 'username': USERNAME + '_other', 'email': 'other_' + SUFFIX + '@hospital.example', 'national_id': CI[:2] + '.' + CI[2:-1] + '-' + CI[-1]})[0] == 409, 'formatted duplicate CI is rejected atomically')
    check(anon.login()[0] == 403 and anon.call('/api/v1/auth/me.php')[0] == 401, 'pending account cannot establish an authenticated session')
    stored = sql('SELECT u.status, u.staff_id, u.password_hash, s.locale, s.theme, (SELECT COUNT(*) FROM user_roles ur WHERE ur.user_id=u.id) AS roles FROM users u JOIN user_settings s ON s.user_id=u.id WHERE u.id=' + user_id)[0]
    check(stored['status'] == 'pending' and stored['staff_id'] is None and int(stored['roles']) == 0 and stored['password_hash'] != PASSWORD and stored['password_hash'].startswith('$2y$'), 'registration stores a hash/settings and no unapproved role')

    admin = Client()
    check(admin.login('system_admin', ADMIN_PASSWORD)[0] == 200, 'bootstrapped administrator can log in')
    pending = admin.call('/api/v1/admin/users/list.php')[1]['data']
    check(any(u['id'] == user_id for u in pending) and all(isinstance(u['id'], str) for u in pending), 'administrator can find pending applications with canonical IDs')
    check(admin.call('/api/v1/admin/users/approve.php', 'POST', {'user_id': user_id, 'role': 'staff'})[0] == 200, 'approval links staff and grants an explicit role')
    staff = Client(); staff.csrf(); old_cookie = staff.cookie(); old_token = staff.token
    code, body, _ = staff.call('/api/v1/auth/login.php', 'POST', {'username': USERNAME, 'password': PASSWORD})
    check(code == 200 and staff.cookie() != old_cookie and staff.token != old_token, 'login rotates session ID and CSRF token')
    check(body['data']['user']['roles'] == ['staff'] and body['data']['user']['national_id'] == CI and body['data']['settings']['locale'] == 'es-UY', 'current-user contract provides safe profile/settings data')
    check('password_hash' not in json.dumps(body) and 'session_hash' not in json.dumps(body), 'account responses omit credential/session hashes')
    check(staff.call('/src/views/main-menu.html')[0] == 200 and staff.call('/api/v1/auth/me.php')[0] == 200, 'authenticated navigation and session restoration work')
    code, _, map_headers = staff.call('/src/views/traces/trace-map.html')
    check(code == 200 and map_headers.get('Referrer-Policy') == 'strict-origin', 'protected maps identify the site origin to tiles without exposing private paths')
    check(staff.call('/src/views/documents/documents.html')[2].get('Referrer-Policy') == 'same-origin', 'other protected pages retain their existing referrer policy')
    check(staff.call('/api/v1/settings/get.php')[1]['data']['user']['id'] == user_id, 'future settings reads the same authenticated account')
    check(staff.call('/api/v1/admin/users/list.php')[0] == 403, 'ordinary staff cannot access account administration')
    check(staff.call('/api/v1/auth/login.php')[0] == 405, 'GET cannot invoke login')

    second = Client(); check(second.login()[0] == 200, 'same staff account can have a second browser session')
    sessions = staff.call('/api/v1/auth/sessions.php')[1]['data']
    check(len(sessions) == 2 and sum(s['is_current'] for s in sessions) == 1 and all(isinstance(s['id'], str) for s in sessions), 'live sessions list is scoped and identifies the current session')
    check('session_hash' not in json.dumps(sessions), 'session list does not expose cookie secrets')
    admin_session = admin.call('/api/v1/auth/sessions.php')[1]['data'][0]['id']
    check(staff.call('/api/v1/auth/revoke-session.php', 'POST', {'session_id': admin_session})[0] == 404, 'staff cannot revoke another account session')
    other_id = next(s['id'] for s in sessions if not s['is_current'])
    check(staff.call('/api/v1/auth/revoke-session.php', 'POST', {'session_id': other_id})[0] == 200 and second.call('/api/v1/auth/me.php')[0] == 401, 'revoking a browser session invalidates it immediately')
    before = sql('SELECT expires_at FROM user_sessions WHERE user_id=' + user_id + ' AND revoked_at IS NULL')[0]['expires_at']
    staff.call('/api/v1/auth/me.php')
    after = sql('SELECT expires_at FROM user_sessions WHERE user_id=' + user_id + ' AND revoked_at IS NULL')[0]['expires_at']
    check(before == after, 'passive session polling does not extend idle timeout')
    cookie_before_logout = staff.cookie()
    in_flight = staff.copy_session()
    with ThreadPoolExecutor(max_workers=2) as executor:
        heartbeat = executor.submit(in_flight.call, '/api/v1/auth/heartbeat.php', 'POST', {})
        logout = executor.submit(staff.call, '/api/v1/auth/logout.php', 'POST', {})
        check(logout.result()[0] == 200 and heartbeat.result()[0] in (200, 401, 403), 'concurrent activity and logout complete safely')
    check(staff.call('/api/v1/auth/me.php')[0] == 401, 'logout destroys authenticated access')
    check(in_flight.call('/api/v1/auth/me.php')[0] == 401, 'in-flight activity cannot resurrect a logged-out session')
    replay = Client()
    replay.jar.set_cookie(http.cookiejar.Cookie(0, 'hospital_session', cookie_before_logout, None, False, '127.0.0.1', False, False, '/', True, False, None, True, None, None, {}))
    check(replay.call('/api/v1/auth/me.php')[0] == 401, 'replaying a logged-out cookie cannot restore access')

    active = Client(); check(active.login()[0] == 200, 'fresh login works after logout')
    sql('UPDATE user_sessions SET expires_at=UTC_TIMESTAMP()-INTERVAL 1 SECOND WHERE user_id=' + user_id + ' AND revoked_at IS NULL')
    check(active.call('/api/v1/auth/me.php')[0] == 401, 'expired SQL session is rejected')
    active = Client(); check(active.login()[0] == 200, 'account remains usable after session expiry')
    check(admin.call('/api/v1/admin/users/disable.php', 'POST', {'user_id': user_id})[0] == 200 and active.call('/api/v1/auth/me.php')[0] == 401, 'disabling account revokes its existing sessions')
    check(Client().login(USERNAME, PASSWORD)[0] == 403, 'disabled account cannot log in again')
    check(admin.call('/api/v1/admin/users/disable.php', 'POST', {'user_id': '1'})[0] == 409, 'last active administrator cannot be disabled')
    bad = Client(); bad.csrf()
    responses = [bad.call('/api/v1/auth/login.php', 'POST', {'username': 'unknown_' + SUFFIX, 'password': 'incorrect-password'})[0] for _ in range(11)]
    check(responses[:10] == [401] * 10 and responses[-1] == 429, 'repeated login attempts are rate limited')

    # Separate low-timeout server verifies the clock behavior, not just DB deletion.
    short_env = {**os.environ, 'HOSPITAL_SESSION_IDLE_SECONDS': '3', 'HOSPITAL_SESSION_ABSOLUTE_SECONDS': '6'}
    with open(os.devnull, 'w') as log:
        process = subprocess.Popen([PHP, '-S', '127.0.0.1:8873', '-t', 'public', 'backend/php/dev-router.php'], cwd=ROOT, env=short_env, stdout=log, stderr=log)
        try:
            for _ in range(30):
                try:
                    urllib.request.urlopen('http://127.0.0.1:8873/index.html', timeout=1); break
                except OSError: time.sleep(.1)
            idle = Client('http://127.0.0.1:8873'); check(idle.login('system_admin', ADMIN_PASSWORD)[0] == 200, 'short-timeout test session starts')
            time.sleep(3.2)
            check(idle.call('/api/v1/auth/me.php')[0] == 401, 'server enforces actual idle expiry')
            absolute = Client('http://127.0.0.1:8873')
            check(absolute.login('system_admin', ADMIN_PASSWORD)[0] == 200, 'absolute-timeout test session starts')
            statuses = []
            for _ in range(14):
                time.sleep(.5)
                code, body, _ = absolute.call('/api/v1/auth/heartbeat.php', 'POST', {})
                if code == 403 and body['error']['code'] == 'CSRF_INVALID':
                    # Match api-client.js: an expired cookie also expires its CSRF token.
                    absolute.csrf()
                    code = absolute.call('/api/v1/auth/heartbeat.php', 'POST', {})[0]
                statuses.append(code)
            check(statuses[0] == 200 and 401 in statuses, f'activity cannot extend absolute session lifetime ({statuses})')
        finally:
            process.terminate(); process.wait(timeout=5)
    print(f'Completed {checks} integration checks against the disposable test database.')


if __name__ == '__main__':
    run()
