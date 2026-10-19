"""Focused real-SQL theme preference checks in a disposable *_test environment."""
import os,json,secrets
from pathlib import Path
os.environ.update(json.loads((Path(__file__).parent/'.runtime/theme/env.json').read_text()))
from auth_integration import Client,ADMIN_PASSWORD,sql
assert os.environ['HOSPITAL_DB_NAME'].endswith('_test')
checks=0
def check(value,label):
 global checks
 assert value,label
 checks+=1;print('PASS',label)
def data(c):return c.call('/api/v1/settings/get.php')[1]['data']
def save(c,theme,version=None,csrf=True):return c.call('/api/v1/settings/preferences-update.php','POST',{'version':data(c)['settings']['version'] if version is None else version,'theme':theme},csrf=csrf)
a=Client();b=Client();assert a.login('system_admin',ADMIN_PASSWORD)[0]==b.login('system_admin',ADMIN_PASSWORD)[0]==200
check(save(a,'light')[0]==200 and data(b)['settings']['theme']=='light','light persists through another SQL-backed session')
uid=data(a)['user']['id'];check(sql('SELECT theme FROM user_settings WHERE user_id='+uid)[0]['theme']=='light','SQL stores the canonical light value')
suffix=secrets.token_hex(4);other=Client();other.csrf();password=secrets.token_urlsafe(24)
r=other.call('/api/v1/auth/register.php','POST',{'username':'theme_'+suffix,'email':'theme_'+suffix+'@hospital.example','national_id':str(82000000+secrets.randbelow(999999)),'password':password})
assert r[0]==201,r[1];assert a.call('/api/v1/admin/users/approve.php','POST',{'user_id':r[1]['data']['user_id'],'role':'staff'})[0]==200;assert other.login('theme_'+suffix,password)[0]==200
record=Path(__file__).parent/'.runtime/theme/other.json';record.write_text(json.dumps({'username':'theme_'+suffix,'password':password}));record.chmod(0o600)
check(data(other)['settings']['theme']=='dark','new accounts retain the dark default')
check(save(other,'light')[0]==200 and save(a,'dark')[0]==200 and data(other)['settings']['theme']=='light','theme preferences remain account-private')
version=data(a)['settings']['version']
for value in ['system','LIGHT','',None,True,{},['light']]:check(save(a,value)[0]==422 and data(a)['settings']['version']==version and data(a)['settings']['theme']=='dark','invalid theme preserves preference and revision: '+repr(value))
check(save(a,'light',csrf=False)[0]==403 and data(a)['settings']['theme']=='dark','theme writes retain CSRF enforcement')
check(save(a,'light',version)[0]==200 and save(b,'dark',version)[0]==409 and data(b)['settings']['theme']=='light','stale theme revision cannot overwrite a committed choice')
anon=Client();anon.csrf()
check(anon.call('/api/v1/settings/preferences-update.php','POST',{'version':version,'theme':'light'})[0]==401,'anonymous visitors cannot save account themes')
check(save(a,'dark')[0]==200 and data(b)['settings']['theme']=='dark','dark can be restored')
print('TOTAL',checks,'focused theme API checks')
