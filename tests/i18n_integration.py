"""Focused localization API checks. Requires the existing disposable *_test environment."""
import json,os,secrets,subprocess,sys
from auth_integration import Client,ADMIN_PASSWORD,PHP,ROOT
assert os.environ.get('HOSPITAL_DB_NAME','').endswith('_test'),'Use disposable data only.'
checks=0
def check(value,label):
 global checks
 assert value,label
 checks+=1;print('PASS',label,flush=True)
def language(client,locale):client.opener.addheaders=[('X-Hospital-Locale',locale)];return client
spanish=language(Client(),'es-UY');english=language(Client(),'en')
a=spanish.call('/api/v1/auth/me.php');b=english.call('/api/v1/auth/me.php')
check(a[0]==b[0]==401 and a[1]['error']['code']==b[1]['error']['code']=='UNAUTHENTICATED','localization preserves anonymous authentication status/code')
check(a[1]['error']['message']=='Iniciá sesión para continuar.' and b[1]['error']['message']=='Sign in to continue.','API errors use the explicit request language')
check(a[2].get('Content-Language')=='es-UY' and b[2].get('Content-Language')=='en','responses identify their message language')
invalid=language(Client(),'invalid').call('/api/v1/auth/me.php');check(invalid[1]['error']['message']==a[1]['error']['message'],'unsupported request language falls back to Spanish')
for c in [spanish,english]:check(c.login('system_admin',ADMIN_PASSWORD)[0]==200,'sign-in still establishes a SQL session')
def profile(c):return c.call('/api/v1/auth/me.php')[1]['data']
def save(c,path,fields):return c.call('/api/v1/'+path,'POST',{'version':profile(c)['settings']['version'],**fields})
original=profile(spanish);saved=save(spanish,'settings/profile-update.php',{'full_name':'Inicio Guardar'})
check(saved[0]==200 and profile(english)['user']['full_name']=='Inicio Guardar','interface-like record text is never automatically translated')
check(save(english,'settings/preferences-update.php',{'locale':'en'})[0]==200 and profile(spanish)['settings']['locale']=='en','language preference persists in shared SQL settings')
version=profile(english)['settings']['version'];bad=save(english,'settings/preferences-update.php',{'locale':'fr'})
check(bad[0]==422 and bad[1]['error']['message']=='Invalid preference.' and profile(english)['settings']['version']==version,'invalid locale preserves SQL preference/revision')
bad=save(english,'settings/profile-update.php',{'email':'invalid'})
check(bad[0]==422 and bad[1]['error']['fields']['email']=='Enter a valid email.','structured validation field messages are translated')
bad=english.call('/api/v1/settings/preferences-update.php','POST',{'version':version,'locale':'es-UY'},csrf=False)
check(bad[0]==403 and bad[1]['error']['code']=='CSRF_INVALID','language headers do not bypass CSRF')
for locale,expected in [('es-UY','Usá entre 3 y 50 letras sin tildes, números, puntos, guiones o guiones bajos.'),('en','Use 3 to 50 unaccented letters, numbers, periods, hyphens or underscores.')]:
 c=language(Client(),locale);c.csrf();bad=c.call('/api/v1/auth/register.php','POST',{'username':'!','email':'invalid','password':'short','national_id':'x'})
 check(bad[0]==422 and bad[1]['error']['fields']['username']==expected,'registration field validation in '+locale)
for locale in ['es-UY','en']:
 c=language(Client(),locale);c.csrf();bad=c.call('/api/v1/auth/register.php','POST',raw='{invalid')
 check(bad[0]==400 and bad[1]['error']['code']=='INVALID_JSON','malformed JSON retains status/code in '+locale)
code="""require 'backend/php/autoload.php';$_SERVER['HTTP_X_HOSPITAL_LOCALE']='en';$p=new ReflectionProperty(Hospital\\I18n::class,'dictionaries');$p->setAccessible(true);$p->setValue(null,['es'=>['missing'=>'Español','plural'=>['one'=>'Uno','other'=>'Varios']],'en'=>[]]);echo json_encode([Hospital\\I18n::t('missing'),Hospital\\I18n::t('plural',['count'=>1]),Hospital\\I18n::t('plural',['count'=>2]),Hospital\\I18n::t('unknown')]);"""
values=json.loads(subprocess.check_output([PHP,'-r',code],cwd=ROOT,text=True));check(values==['Español','Uno','Varios',''],'PHP missing-key/plural fallback is safe without changing dictionary files')
check(save(spanish,'settings/profile-update.php',{'full_name':original['user']['full_name']})[0]==200,'temporary profile name restored')
# A second approved account must retain its own SQL preference.
suffix=secrets.token_hex(4);password=secrets.token_urlsafe(20)
new=language(Client(),'en');new.csrf()
status,body,_=new.call('/api/v1/auth/register.php','POST',{'username':'i18n_'+suffix,'email':'i18n_'+suffix+'@hospital.example','password':password,'national_id':str(81000000+secrets.randbelow(8999999))})
check(status==201 and body['data']['status']=='pending','English registration still creates a pending account')
check(english.call('/api/v1/admin/users/approve.php','POST',{'user_id':body['data']['user_id'],'role':'staff'})[0]==200,'existing administrator approval still works')
check(new.login('i18n_'+suffix,password)[0]==200 and profile(new)['settings']['locale']=='es-UY','new accounts begin with the Spanish SQL default')
check(save(new,'settings/preferences-update.php',{'locale':'en'})[0]==200 and save(spanish,'settings/preferences-update.php',{'locale':'es-UY'})[0]==200 and profile(new)['settings']['locale']=='en','separate account preferences do not overwrite one another')
check(new.call('/api/v1/auth/logout.php','POST',{})[0]==200 and new.call('/api/v1/auth/me.php')[0]==401,'localized accounts retain the existing logout/session boundary')
print('TOTAL',checks,'focused API checks')

if '--prepare-browser' in sys.argv:
 import i18n_browser_fixtures
