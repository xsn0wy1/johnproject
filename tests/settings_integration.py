"""Settings integration against the same disposable *_test database as auth tests."""
import base64
import json
import os
from pathlib import Path
import secrets
import subprocess
from concurrent.futures import ThreadPoolExecutor
import urllib.error
import urllib.request
from auth_integration import Client, PHP, ROOT, ADMIN_PASSWORD, sql

assert os.environ.get('HOSPITAL_DB_NAME', '').endswith('_test')
checks = 0
PASSWORD = secrets.token_urlsafe(24)
SUFFIX = secrets.token_hex(4)


def check(condition, label):
    global checks
    assert condition, label
    checks += 1
    print('PASS', label, flush=True)


def data(client):
    status, payload, _ = client.call('/api/v1/settings/get.php')
    assert status == 200, payload
    return payload['data']


def post(client, endpoint, fields):
    return client.call('/api/v1/settings/' + endpoint + '.php', 'POST', {'version': data(client)['settings']['version'], **fields})


def register(admin, index):
    username = 'settings_' + SUFFIX + str(index)
    client = Client(); client.csrf()
    body = {'username':username,'email':username+'@hospital.example','password':PASSWORD,'national_id':str(80000000+secrets.randbelow(9999999))}
    status, payload, _ = client.call('/api/v1/auth/register.php','POST',body)
    assert status == 201, payload
    uid = payload['data']['user_id']
    assert admin.call('/api/v1/admin/users/approve.php','POST',{'user_id':uid,'role':'staff'})[0] == 200
    assert client.login(username,PASSWORD)[0] == 200
    return client, username, uid


def upload(client, content, version=None, filename='../untrusted.php', csrf=True):
    boundary = 'Hospital' + secrets.token_hex(16)
    version = data(client)['settings']['version'] if version is None else version
    body = (f'--{boundary}\r\nContent-Disposition: form-data; name="version"\r\n\r\n{version}\r\n'
            f'--{boundary}\r\nContent-Disposition: form-data; name="photo"; filename="{filename}"\r\nContent-Type: image/png\r\n\r\n').encode() + content + f'\r\n--{boundary}--\r\n'.encode()
    headers = {'Content-Type':'multipart/form-data; boundary='+boundary,'Accept':'application/json'}
    if csrf: headers['X-CSRF-Token'] = client.token
    request = urllib.request.Request(client.base+'/api/v1/settings/photo.php',data=body,headers=headers,method='POST')
    try: response = client.opener.open(request)
    except urllib.error.HTTPError as error: response = error
    payload = json.load(response)
    if response.status == 200: client.token = payload['data']['csrf_token']
    return response.status, payload


def image(client, target):
    request=urllib.request.Request(client.base+'/api/v1/settings/photo.php?user_id='+target)
    try: response=client.opener.open(request)
    except urllib.error.HTTPError as error: response=error
    return response.status,response.read(),response.headers


def run():
    admin=Client(); assert admin.login('system_admin',ADMIN_PASSWORD)[0] == 200
    first, username, uid = register(admin,1)
    second, _, other_uid = register(admin,2)
    initial=data(first)
    check(initial['user']['full_name']=='' and initial['settings']['default_facility_id'] is None and initial['settings']['specialties']==[] and initial['settings']['avatar_url'] is None,'uncollected fields are empty for a new user')
    centers=first.call('/api/v1/catalogs/facilities.php')[1]['data']
    assert len(centers)>=2
    center=centers[0]['id']; archived=centers[1]['id']
    check(all(isinstance(item['id'],str) for item in centers),'centers come from the shared managed catalog with string IDs')
    check(Client().call('/api/v1/catalogs/facilities.php')[0]==401,'center catalog requires authentication')
    check(Client().call('/api/v1/settings/get.php')[0]==401,'settings requires authentication')
    response=post(first,'profile-update',{'full_name':'Personal de prueba','email':'changed_'+SUFFIX+'@hospital.example','default_facility_id':center,'specialties':['Cirugía','Pediatría']})
    check(response[0]==200,'profile, email, catalog center and specialties persist together')
    current=data(first)
    check(current['user']['full_name']=='Personal de prueba' and current['settings']['default_facility_id']==center and len(current['settings']['specialties'])==2,'reload reads committed profile relationships')
    check(data(second)['user']['full_name']=='' and data(second)['settings']['specialties']==[] and data(second)['settings']['default_facility_id'] is None,'another account keeps its own empty profile')
    check(current['user']['roles']==['staff'],'self-declared specialties never grant privileges')
    restored=Client(); assert restored.login(username,PASSWORD)[0]==200
    check(data(restored)['user']['full_name']=='Personal de prueba','another browser restores the same saved profile')
    check(first.call('/api/v1/settings/profile-update.php','POST',{'version':initial['settings']['version'],'full_name':'Stale'})[0]==409,'stale profile version is rejected')
    version=data(first)['settings']['version']
    with ThreadPoolExecutor(max_workers=2) as executor:
        first_write=executor.submit(first.call,'/api/v1/settings/profile-update.php','POST',{'version':version,'full_name':'Concurrent first'})
        second_write=executor.submit(restored.call,'/api/v1/settings/profile-update.php','POST',{'version':version,'full_name':'Concurrent second'})
        check(sorted([first_write.result()[0],second_write.result()[0]])==[200,409],'simultaneous edits allow exactly one version to commit')
    assert post(first,'profile-update',{'full_name':'Personal de prueba'})[0]==200
    check(post(first,'profile-update',{'user_id':other_uid,'full_name':'Forbidden'})[0]==422,'profile cannot target another user')
    check(post(first,'profile-update',{'role':'admin'})[0]==422,'profile cannot grant a role')
    check(post(first,'profile-update',{'email':data(second)['user']['email'],'full_name':'Rolled back'})[0]==409 and data(first)['user']['full_name']=='Personal de prueba','duplicate email rolls back all profile changes')
    check(post(first,'profile-update',{'email':'bad-email'})[0]==422,'server rejects invalid email')
    check(post(first,'profile-update',{'default_facility_id':'999999999'})[0]==422,'unknown center cannot be selected')
    sql("UPDATE facilities SET status='archived' WHERE id="+archived)
    check(post(first,'profile-update',{'default_facility_id':archived})[0]==422,'archived center cannot be newly selected')
    check(all(item['id']!=archived for item in first.call('/api/v1/catalogs/facilities.php')[1]['data']),'archived centers disappear from available choices')
    sql("UPDATE facilities SET status='active' WHERE id="+archived)
    check(post(first,'profile-update',{'specialties':['Pediatría','pediatría']})[0]==200 and len(data(first)['settings']['specialties'])==1,'duplicate specialty labels normalize to one relationship')
    check(post(first,'profile-update',{'specialties':['x']*11})[0]==422,'specialty count limit is enforced')
    check(post(first,'profile-update',{'specialties':[{'role':'admin'}]})[0]==422,'nested specialty objects are rejected')
    check(post(first,'profile-update',{'specialties':[],'default_facility_id':None,'full_name':''})[0]==200 and data(first)['settings']['specialties']==[] and data(first)['user']['full_name']=='','optional profile fields can be cleared')
    check(post(first,'preferences-update',{'locale':'en'})[0]==200 and data(restored)['settings']['locale']=='en','language preference persists across browsers')
    check(post(first,'preferences-update',{'theme':'light'})[0]==422 and data(first)['settings']['theme']=='dark','light theme remains deferred')
    check(post(first,'preferences-update',{'automatic_logout':False})[0]==200 and data(first)['session']['idle_timeout_seconds']==1800,'turning off shorter logout retains mandatory idle policy')
    check(post(first,'preferences-update',{'automatic_logout':True})[0]==200 and data(first)['session']['idle_timeout_seconds']==300,'automatic logout applies the stricter idle policy')
    check(post(first,'preferences-update',{'automatic_logout':'false'})[0]==422,'boolean preference strings are rejected')
    check(post(first,'preferences-update',{'session_idle_seconds':999999})[0]==422,'settings cannot bypass server session policy')
    check(first.call('/api/v1/settings/preferences-update.php','POST',{'version':data(first)['settings']['version'],'locale':'es-UY'},csrf=False)[0]==403,'settings writes require CSRF')
    notifications=first.call('/api/v1/settings/notifications.php')[1]['data']
    check(len(notifications)>=2 and all(item['kind']=='new_login' for item in notifications),'security preference produces private sign-in notifications')
    maximum=notifications[0]['id']
    assert first.call('/api/v1/settings/notifications-read.php','POST',{'through_id':maximum})[0]==200
    check(all(item['read_at'] is not None for item in first.call('/api/v1/settings/notifications.php')[1]['data']),'notification reading is persisted')
    check(any(item['read_at'] is None for item in second.call('/api/v1/settings/notifications.php')[1]['data']),'reading notifications does not affect another user')
    before=int(sql('SELECT COUNT(*) AS n FROM user_notifications WHERE user_id='+uid)[0]['n'])
    assert post(first,'preferences-update',{'security_notifications':False})[0]==200
    assert Client().login(username,PASSWORD)[0]==200
    check(first.call('/api/v1/settings/notifications.php')[1]['data']==[] and int(sql('SELECT COUNT(*) AS n FROM user_notifications WHERE user_id='+uid)[0]['n'])==before,'turning off security notifications prevents new optional notifications')
    check(first.call('/api/v1/settings/diagnostics.php','POST',{'load_ms':120})[0]==403,'diagnostics requires opt-in')
    assert post(first,'preferences-update',{'optional_diagnostics':True})[0]==200
    check(first.call('/api/v1/settings/diagnostics.php','POST',{'load_ms':120})[0]==200 and int(sql('SELECT sample_count FROM user_diagnostics WHERE user_id='+uid)[0]['sample_count'])==1,'opt-in stores only a load-time aggregate')
    assert post(first,'preferences-update',{'optional_diagnostics':False})[0]==200
    check(sql('SELECT user_id FROM user_diagnostics WHERE user_id='+uid)==[],'opting out deletes the optional aggregate')
    directory=Path(os.environ['HOSPITAL_STORAGE_PATH'])/'users'
    baseline_files=set(directory.glob('*.png'))
    png=subprocess.run([PHP,'-r','$i=imagecreatetruecolor(80,50); imagepng($i);'],capture_output=True,check=True).stdout
    check(upload(first,png,csrf=False)[0]==403,'photo upload requires CSRF')
    check(upload(first,b'<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>')[0]==415,'SVG disguised as PNG is rejected')
    check(upload(first,png)[0]==200,'validated photo is normalized and stored privately')
    check(image(first,uid)[0]==200 and image(first,uid)[1].startswith(b'\x89PNG\r\n\x1a\n'),'own authorized photo returns real PNG bytes')
    check(image(second,uid)[0]==404 and image(Client(),uid)[0]==401,'private photo denies other staff and anonymous browsers')
    check(first.call('/storage/users/test.png')[0]==404,'avatar files are outside the public root')
    check(post(first,'profile-update',{'avatar_file_id':'1'})[0]==422,'client cannot attach a different account file')
    assert post(first,'preferences-update',{'photo_visible_to_staff':True})[0]==200
    check(image(second,uid)[0]==200,'photo visibility allows authenticated staff access')
    before_files=set(directory.glob('*.png'))
    check(upload(first,png,version=1)[0]==409 and set(directory.glob('*.png'))==before_files,'failed photo version leaves no orphan file')
    assert upload(first,png)[0]==200
    after_files=set(directory.glob('*.png'))
    check(len(after_files)==len(before_files) and not (before_files-baseline_files).intersection(after_files) and baseline_files.issubset(after_files),'replacement removes only the previous owned avatar')
    assert post(first,'photo-delete',{})[0]==200
    check(data(first)['settings']['avatar_url'] is None and image(first,uid)[0]==404,'photo deletion clears profile reference and read access')
    check(set(directory.glob('*.png'))==baseline_files,'photo deletion removes its private file and preserves other accounts')
    print(f'Completed {checks} settings integration checks.')

if __name__=='__main__': run()
