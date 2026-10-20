"""Patient file capabilities, using disposable SQL/storage and the actual PHP runtime."""
import hashlib
import json
import os
import secrets
import shutil
import subprocess
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
RUNTIME = ROOT / 'tests/.runtime/document-links'
PHP = os.environ.get('HOSPITAL_TEST_PHP', '/Applications/XAMPP/xamppfiles/bin/php')
NODE = os.environ.get('HOSPITAL_TEST_NODE', str(Path.home() / '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node'))
os.environ.update(HOSPITAL_DB_NAME='hospital_doclinks_' + secrets.token_hex(4) + '_test',
    HOSPITAL_DB_USER='doclinks_' + secrets.token_hex(4), HOSPITAL_DB_PASSWORD=secrets.token_hex(24),
    HOSPITAL_DB_SOCKET='/Applications/XAMPP/xamppfiles/var/mysql/mysql.sock', HOSPITAL_APP_KEY=secrets.token_hex(32),
    HOSPITAL_STORAGE_PATH=str(RUNTIME / 'storage'), HOSPITAL_BASE_PATH='', HOSPITAL_SECURE_COOKIES='false',
    HOSPITAL_BCRYPT_COST='10', HOSPITAL_ADMIN_PASSWORD=secrets.token_urlsafe(24), HOSPITAL_AUTH_TEST_URL='http://127.0.0.1:8884')
os.environ.setdefault('NODE_PATH', str(Path.home() / '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules'))
from auth_integration import Client, PASSWORD, ADMIN_PASSWORD, sql
from documents_integration import upload, fields, pdf_bytes, docx_bytes, binary, detail

checks = 0
servers = []
tokens = set()

def check(value, label):
    global checks
    assert value, label
    checks += 1
    print('PASS', label, flush=True)

def cli(*args):
    subprocess.run([PHP, 'backend/php/cli/' + args[0], *args[1:]], cwd=ROOT, check=True, stdout=subprocess.DEVNULL)

def administrative(statement):
    code = '''require 'backend/php/autoload.php';$c=Hospital\\Config::load();if(!preg_match('/^hospital_doclinks_[a-f0-9]{8}_test$/',$c['db']['name']))exit(2);$c['db']['user']=getenv('HOSPITAL_SETUP_DB_USER')?:'root';$c['db']['password']=getenv('HOSPITAL_SETUP_DB_PASSWORD')?:'';$db=Hospital\\Database::connect($c,false);$db->exec(stream_get_contents(STDIN));'''
    subprocess.run([PHP, '-r', code], input=statement, text=True, cwd=ROOT, capture_output=True, check=True)

def serve(port, mount=''):
    env = dict(os.environ, HOSPITAL_BASE_PATH=mount)
    log = (RUNTIME / f'server-{port}.log').open('w')
    process = subprocess.Popen([PHP, '-S', f'127.0.0.1:{port}', '-t', 'public', 'backend/php/dev-router.php'], cwd=ROOT, env=env, stdout=log, stderr=log)
    servers.append((process, log))
    for _ in range(60):
        try:
            urllib.request.urlopen(f'http://127.0.0.1:{port}{mount}/index.html', timeout=1).close()
            return
        except OSError:
            if process.poll() is not None: raise RuntimeError('Disposable PHP server failed.')
            time.sleep(.05)
    raise RuntimeError('Disposable PHP server timed out.')

def link(client, item, version=1, token=None, **overrides):
    body = dict(id=item['id'], version=item['version'], file_version=version, action='revoke' if token else 'create', **overrides)
    if token: body['token'] = token
    result = client.call('/api/v1/documents/patient-link.php', 'POST', body)
    if result[0] == 200 and result[1]['data'].get('token'): tokens.add(result[1]['data']['token'])
    return result

def public(token='', suffix='', method='GET', headers=None, base='http://127.0.0.1:8884'):
    request = urllib.request.Request(base + '/api/v1/documents/public-file.php?token=' + token + suffix, method=method, headers=headers or {})
    try: response = urllib.request.urlopen(request, timeout=15)
    except urllib.error.HTTPError as error: response = error
    return response.status, response.read(), response.headers

def run():
    cli('setup.php', '--no-config')
    check(sql('SELECT VERSION() AS version')[0]['version'].startswith('10.4.'), 'real MariaDB 10.4 runtime')
    check(sql("SELECT version FROM schema_migrations WHERE version='013_document_access_links'") != [], 'fresh schema installs migration 013')
    administrative('USE `' + os.environ['HOSPITAL_DB_NAME'] + '`; DROP TABLE document_access_links; DELETE FROM schema_migrations WHERE version="013_document_access_links";')
    cli('migrate.php'); cli('migrate.php')
    check(sql('SELECT COUNT(*) AS n FROM document_access_links')[0]['n'] == 0, 'upgrade and repeat migration are safe')
    cli('users.php', 'create-admin', 'system_admin', 'admin@hospital.example', '99500111')
    serve(8884); serve(8885, '/hospital')
    admin = Client(); assert admin.login('system_admin', ADMIN_PASSWORD)[0] == 200
    people = []
    for index, role in enumerate(['staff', 'staff', 'records_manager']):
        client = Client(); client.csrf(); username = 'file_staff_' + str(index)
        result = client.call('/api/v1/auth/register.php', 'POST', dict(username=username, password=PASSWORD, email=username+'@hospital.example', national_id=str(99500200+index)))
        uid = result[1]['data']['user_id']
        assert admin.call('/api/v1/admin/users/approve.php', 'POST', dict(user_id=uid, role=role))[0] == 200
        assert client.login(username, PASSWORD)[0] == 200
        people.append(client)
    owner, other, manager = people
    category = next(x['id'] for x in owner.call('/api/v1/catalogs/document-categories.php')[1]['data'] if x['code'] == 'administrative')
    original = pdf_bytes('Patient attachment', 2)
    status, payload = upload(owner, fields(owner, category), original, 'Informe paciente.pdf')
    assert status == 201
    item = payload['data']
    body = dict(id=item['id'], version=item['version'], file_version=1, action='create')
    anonymous = Client(); anonymous.csrf()
    check(anonymous.call('/api/v1/documents/patient-link.php', 'POST', body)[0] == 401, 'issuing links requires a staff session')
    check(owner.call('/api/v1/documents/patient-link.php', 'POST', body, csrf=False)[0] == 403, 'issuing links requires CSRF')
    check(owner.call('/api/v1/documents/patient-link.php')[0] == 405, 'GET never creates links')
    check(link(other, item)[0] == link(admin, item)[0] == 404, 'unrelated staff and account-only administrators cannot share a document')
    check(owner.call('/api/v1/documents/patient-link.php', 'POST', dict(body, source='/etc/passwd'))[0] == 422, 'issuance rejects arbitrary source fields')
    check(owner.call('/api/v1/documents/patient-link.php', 'POST', dict(body, version=999))[0] == 409, 'stale document revisions cannot issue links')
    check(link(owner, item, version=99)[0] == 404, 'only an existing attached file version can be shared')
    status, result, _ = link(owner, item); raw = result['data']['token']
    row = sql('SELECT * FROM document_access_links')[0]
    check(status == 200 and row['token_hash'] == hashlib.sha256(raw.encode()).hexdigest() and raw not in json.dumps(row), 'SQL stores a nonce and hash, never the raw capability')
    check(sql('SELECT TIMESTAMPDIFF(SECOND,created_at,expires_at) AS seconds FROM document_access_links')[0]['seconds'] == 86400, 'patient links expire after 24 hours')
    check(link(owner, item)[1]['data'] == result['data'] == link(manager, item)[1]['data'], 'reopening QR reuses its link without extending expiry')
    status, data, headers = public(raw)
    check(status == 200 and data == original and headers['Content-Type'] == 'application/pdf', 'anonymous scan returns exact PDF bytes without login or viewer HTML')
    check(headers['Content-Disposition'].startswith('inline;') and 'Informe%20paciente.pdf' in headers['Content-Disposition'], 'PDF opens inline with its original filename')
    check(headers['Cache-Control'] == 'no-store, private' and headers['Referrer-Policy'] == 'no-referrer' and headers['X-Content-Type-Options'] == 'nosniff', 'patient response prevents caching and referrer leakage')
    status, data, headers = public(raw, method='HEAD')
    check(status == 200 and not data and int(headers['Content-Length']) == len(original), 'anonymous HEAD returns headers without consuming the link')
    for value, expected in [('bytes=0-8', original[:9]), ('bytes=-10', original[-10:]), ('bytes=9-', original[9:])]:
        status, data, headers = public(raw, headers={'Range': value})
        check(status == 206 and data == expected and headers['Accept-Ranges'] == 'bytes', 'native PDF byte range ' + value)
    check(public(raw, headers={'Range': 'bytes=999999-'})[0] == public(raw, headers={'Range': 'bytes=0-1,4-6'})[0] == 416, 'invalid and multipart ranges are rejected')
    check(public(raw, '&download=1')[2]['Content-Disposition'].startswith('attachment;'), 'explicit download remains available')
    check(binary(owner, item['id'], method='HEAD')[2]['Content-Length'] == str(len(original)), 'shared binary helper preserves staff HEAD responses')
    check(binary(owner, item['id'], range='bytes=0-8')[1] == original[:9], 'shared binary helper preserves authenticated staff byte ranges')
    check(binary(owner, item['id'], extra='&download=1')[1] == original, 'shared binary helper preserves exact staff download bytes')
    check(public(raw, base='http://127.0.0.1:8885/hospital')[1] == original, 'actual hospital mount streams the same authorized file')
    check(public('a'*64)[0] == public('bad')[0] == public()[0] == 404, 'missing, guessed and malformed credentials fail closed')
    check(public(raw, '&id='+item['id'])[0] == public(raw, '&source=/etc/passwd')[0] == 422, 'patient endpoint rejects IDs and filesystem paths')
    check(public(raw, method='POST')[0] == 405, 'patient binary endpoint accepts only GET and HEAD')
    check(binary(Client(), item['id'])[0] == 401 and anonymous.call('/api/v1/documents/get.php?id='+item['id'])[0] == 401, 'patient capability grants no metadata, list or staff-viewer access')
    replacement = pdf_bytes('New attachment', 1)
    status, payload = upload(owner, dict(id=item['id'], version=item['version']), replacement, 'new.pdf', 'replace-file')
    assert status == 200; item = payload['data']
    fresh = link(owner, item, version=2)[1]['data']['token']
    check(raw != fresh and public(raw)[1] == original and public(fresh)[1] == replacement, 'each QR stays pinned to its immutable selected file version')
    check(link(other, item, token=raw)[0] == 404 and owner.call('/api/v1/documents/patient-link.php', 'POST', dict(body, action='revoke', token=raw), csrf=False)[0] == 403, 'revocation independently enforces ownership and CSRF')
    check(link(owner, item, token=raw)[0] == 200 and public(raw)[0] == 404 and public(fresh)[0] == 200, 'revoking one version blocks its token without affecting another version')
    new_old = link(owner, item)[1]['data']['token']
    check(new_old != raw and link(owner, item, token=raw)[0] == 409 and public(new_old)[0] == 200, 'reissue replaces revoked credentials and stale dialogs cannot revoke the replacement')
    sql('UPDATE document_access_links SET expires_at=UTC_TIMESTAMP()-INTERVAL 1 SECOND')
    check(public(fresh)[0] == public(new_old)[0] == 404, 'expiry is enforced by SQL on every request')
    fresh = link(owner, item, version=2)[1]['data']['token']
    check(public(fresh)[1] == replacement, 'opening an expired QR creates a fresh 24-hour capability')
    assert owner.call('/api/v1/documents/archive.php', 'POST', dict(id=item['id'], version=item['version']))[0] == 200
    check(public(fresh)[0] == 404 and link(owner, detail(owner,item['id']), version=2)[0] == 404, 'archive disables all patient reads and further issuance')
    item = detail(owner, item['id'])
    assert owner.call('/api/v1/documents/restore.php', 'POST', dict(id=item['id'], version=item['version']))[0] == 200
    check(public(fresh)[0] == 404, 'restoring a document never revives old QRs')
    item = detail(owner, item['id']); fresh = link(owner, item, version=2)[1]['data']['token']
    # Ready-state and physical-file checks remain shared with ordinary document reads.
    file = sql('SELECT f.id,f.storage_key FROM document_versions v JOIN stored_files f ON f.id=v.stored_file_id WHERE v.document_id='+item['id']+' AND v.version_number=2')[0]
    physical = RUNTIME / 'storage/documents' / (file['storage_key']+'.bin')
    physical.rename(physical.with_suffix('.missing'))
    try:
        check(public(fresh)[0] == 404, 'a missing private binary is never reported as successful content')
        check(link(owner, item, version=2, token=fresh)[0] == 200, 'staff can revoke a link even while its physical file is missing')
    finally: physical.with_suffix('.missing').rename(physical)
    fresh = link(owner, item, version=2)[1]['data']['token']
    sql("UPDATE stored_files SET state='quarantined' WHERE id="+str(file['id']))
    check(public(fresh)[0] == 404, 'a non-ready stored file cannot be shared')
    sql("UPDATE stored_files SET state='ready' WHERE id="+str(file['id']))
    fixtures = {}
    for extension, data in [('png', b''), ('jpg', b''), ('docx', docx_bytes())]:
        if extension in ['png', 'jpg']:
            function = 'imagepng' if extension == 'png' else 'imagejpeg'
            image = subprocess.run([PHP, '-r', '$i=imagecreatetruecolor(20,20);'+function+'($i);'], capture_output=True, check=True)
            data = image.stdout
        status, payload = upload(owner, fields(owner, category), data, 'patient.'+extension)
        assert status == 201
        fixtures[extension] = payload['data']; token = link(owner, payload['data'])[1]['data']['token']
        status, received, headers = public(token)
        check(status == 200 and received == data and headers['Content-Disposition'].startswith('attachment;' if extension == 'docx' else 'inline;'), extension.upper() + ' uses the browser-appropriate content disposition')
    check(all(raw not in json.dumps(sql('SELECT * FROM audit_events')) for raw in tokens), 'audits contain IDs and actions without capabilities')
    fixtures.update(pdf=item, username='file_staff_0', password=PASSWORD)
    private = RUNTIME / 'browser.json'; private.write_text(json.dumps(fixtures)); private.chmod(0o600)
    if '--browser' in sys.argv: subprocess.run([NODE, 'tests/document_links_browser.cjs'], cwd=ROOT, check=True)
    for _, log in servers: log.flush()
    check(all(token not in log.read_text() for token in tokens for log in RUNTIME.glob('server-*.log')), 'development server logs contain no file capabilities')
    print('TOTAL', checks, 'focused document-link SQL/API checks', flush=True)

if __name__ == '__main__':
    RUNTIME.mkdir(parents=True, exist_ok=True)
    original_config = hashlib.sha256((ROOT/'backend/php/config/local.php').read_bytes()).digest()
    try: run()
    finally:
        for process, log in servers:
            process.terminate(); process.wait(timeout=10); log.close()
        name, user = os.environ['HOSPITAL_DB_NAME'], os.environ['HOSPITAL_DB_USER']
        administrative('DROP DATABASE IF EXISTS `' + name + "`; DROP USER IF EXISTS '" + user + "'@'localhost'; DROP USER IF EXISTS '" + user + "'@'127.0.0.1';")
        shutil.rmtree(RUNTIME/'storage', ignore_errors=True)
        (RUNTIME/'browser.json').unlink(missing_ok=True)
        assert hashlib.sha256((ROOT/'backend/php/config/local.php').read_bytes()).digest() == original_config
