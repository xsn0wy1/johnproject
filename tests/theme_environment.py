"""Prepare/clean the disposable fixtures used by the focused theme checks. No normal config is written."""
import json,os,secrets,signal,subprocess,sys,shutil,time,urllib.request
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
RUNTIME=ROOT/'tests/.runtime/theme'
PHP=os.environ.get('HOSPITAL_TEST_PHP','/Applications/XAMPP/xamppfiles/bin/php')

def prepare():
 RUNTIME.mkdir(parents=True,exist_ok=True)
 if (RUNTIME/'env.json').exists():raise RuntimeError('A theme test environment already exists; clean it first.')
 env=dict(os.environ)
 env.update(HOSPITAL_DB_NAME='hospital_theme_'+secrets.token_hex(4)+'_test',HOSPITAL_DB_USER='theme_'+secrets.token_hex(4),HOSPITAL_DB_PASSWORD=secrets.token_hex(24),HOSPITAL_DB_SOCKET='/Applications/XAMPP/xamppfiles/var/mysql/mysql.sock',HOSPITAL_APP_KEY=secrets.token_hex(32),HOSPITAL_STORAGE_PATH=str(RUNTIME/'storage'),HOSPITAL_BASE_PATH='',HOSPITAL_SECURE_COOKIES='false',HOSPITAL_BCRYPT_COST='10',HOSPITAL_ADMIN_PASSWORD=secrets.token_urlsafe(24),HOSPITAL_AUTH_TEST_URL='http://127.0.0.1:8879',HOSPITAL_TEST_PHP=PHP,HOSPITAL_ROUTE_MAPPING_ENABLED='false',HOSPITAL_I18N_TEST_RECORDS=str(RUNTIME/'records.json'))
 saved={k:v for k,v in env.items() if k.startswith('HOSPITAL_')}
 (RUNTIME/'env.json').write_text(json.dumps(saved));(RUNTIME/'env.json').chmod(0o600)
 for args in [['setup.php','--no-config'],['users.php','create-admin','system_admin','theme@hospital.example','77009999'],['users.php','roles','system_admin','admin,records_manager,dispatcher'],['transfers.php','seed-demo']]:
  subprocess.run([PHP,str(ROOT/'backend/php/cli'/args[0]),*args[1:]],env=env,cwd=ROOT,check=True,stdout=subprocess.DEVNULL)
 for port,mount,prefix in [(8879,'',''),(8880,'/hospital','mounted-')]:
  serving=dict(env,HOSPITAL_BASE_PATH=mount)
  with (RUNTIME/(prefix+'server.log')).open('w') as log:
   server=subprocess.Popen([PHP,'-S','127.0.0.1:'+str(port),'-t','public','backend/php/dev-router.php'],cwd=ROOT,env=serving,stdout=log,stderr=log,start_new_session=True)
  (RUNTIME/(prefix+'server.pid')).write_text(str(server.pid))
  for attempt in range(50):
   try:
    with urllib.request.urlopen('http://127.0.0.1:'+str(port)+mount+'/index.html',timeout=1):break
   except OSError:
    if server.poll() is not None or attempt==49:raise RuntimeError('Disposable server failed to start.')
    time.sleep(.05)
 subprocess.run([sys.executable,'-c',"import sys;sys.path.insert(0,'tests');import i18n_browser_fixtures"],cwd=ROOT,env=env,check=True)
 print('Disposable theme servers, records and private environment prepared.')

def cleanup():
 env=dict(os.environ);env.update(json.loads((RUNTIME/'env.json').read_text()))
 assert env['HOSPITAL_DB_NAME'].startswith('hospital_theme_') and env['HOSPITAL_DB_NAME'].endswith('_test')
 assert env['HOSPITAL_DB_USER'].startswith('theme_')
 for prefix in ['', 'mounted-']:
  pidfile=RUNTIME/(prefix+'server.pid')
  if pidfile.exists():
   try:os.kill(int(pidfile.read_text()),signal.SIGTERM)
   except ProcessLookupError:pass
   pidfile.unlink()
 code=r'''require 'backend/php/autoload.php';$c=Hospital\Config::load();$name=$c['db']['name'];$user=$c['db']['user'];if(!preg_match('/^hospital_theme_[a-f0-9]{8}_test$/',$name)||!preg_match('/^theme_[a-f0-9]{8}$/',$user))exit(2);$c['db']['user']=getenv('HOSPITAL_SETUP_DB_USER')?:'root';$c['db']['password']=getenv('HOSPITAL_SETUP_DB_PASSWORD')?:'';$db=Hospital\Database::connect($c,false);$db->exec('DROP DATABASE `'.$name.'`');foreach(['localhost','127.0.0.1'] as $h)$db->exec('DROP USER IF EXISTS '.$db->quote($user).'@'.$db->quote($h));'''
 subprocess.run([env.get('HOSPITAL_TEST_PHP',PHP),'-r',code],cwd=ROOT,env=env,check=True)
 shutil.rmtree(RUNTIME/'storage',ignore_errors=True)
 for name in ['env.json','other.json','auth.json','records.json']:(RUNTIME/name).unlink(missing_ok=True)
 print('Disposable SQL database/account, servers, storage and credential fixtures removed. Screenshot proof retained.')

if __name__=='__main__':
 if sys.argv[1:]==['prepare']:prepare()
 elif sys.argv[1:]==['cleanup']:cleanup()
 else:raise SystemExit('Use prepare or cleanup.')
