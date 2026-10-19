"""Checks initial-schema upgrades using a dedicated temporary *_test database."""
import os
import re
import secrets
import subprocess
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
PHP=os.environ.get('HOSPITAL_TEST_PHP','/Applications/XAMPP/xamppfiles/bin/php')
assert os.environ.get('HOSPITAL_DB_NAME','').endswith('_test')
name='hospital_upgrade_'+secrets.token_hex(5)+'_test'
old=(ROOT/'db/sql/schema.sql').read_text()
for table in ['facilities','specialties','staff_specialties','stored_files','user_notifications','user_diagnostics','patients','document_categories','documents','document_versions','staff_roles','ambulances','route_templates','route_stops','route_map_cache','transfers','transfer_crew','resource_reservations','transfer_events','transfer_drafts','simulation_runs','simulation_state','transfer_positions','transfer_latest_positions','doctor_profiles','personnel_profiles','departments','patient_contacts','patient_encounters','patient_appointments']:
    old,count=re.subn(r'CREATE TABLE IF NOT EXISTS '+table+r' \([\s\S]*?\) ENGINE=InnoDB;\n','',old)
    assert count==1,table
old=re.sub(r"INSERT INTO document_categories[\s\S]*?;\n", '', old)
old=re.sub(r"INSERT IGNORE INTO simulation_state[^;]*;\n", '', old)
old=re.sub(r'^.*(?:email_verified_at|default_facility_id|avatar_file_id|fk_settings_facility|fk_settings_avatar).*\n','',old,flags=re.M)
old=old.replace('CREATE DATABASE IF NOT EXISTS hospital ', 'CREATE DATABASE '+name+' ').replace('USE hospital;', 'USE '+name+';')
program=r'''
require 'backend/php/autoload.php';
$config=Hospital\Config::load();
$config['db']['user']=getenv('HOSPITAL_SETUP_DB_USER') ?: 'root';
$config['db']['password']=getenv('HOSPITAL_SETUP_DB_PASSWORD') ?: '';
$db=Hospital\Database::connect($config,false);
$name=getenv('HOSPITAL_UPGRADE_TEST_NAME');
if (!preg_match('/^hospital_upgrade_[a-f0-9]+_test$/',$name)) exit(1);
try {
    $db->exec(stream_get_contents(STDIN));
    $users=new Hospital\Modules\Auth\UserRepository($db);
    $db->beginTransaction();
    $id=$users->createPending(['username'=>'upgrade_staff','email'=>'upgrade@hospital.example','national_id'=>'98880001'],password_hash('Upgrade-Test-2026!',PASSWORD_BCRYPT,['cost'=>10]));
    $db->commit();
    (new Hospital\Modules\Auth\AccountAdministration($db))->approve($id,'staff',null,'test-upgrade');
    $db->exec("UPDATE staff SET full_name='Existing profile' WHERE id=1");
    $db->exec("UPDATE user_settings SET security_notifications=0 WHERE user_id=1");
    $before=$db->query('SELECT u.id,u.username,u.email,u.password_hash,u.staff_id,s.full_name,p.security_notifications FROM users u JOIN staff s ON s.id=u.staff_id JOIN user_settings p ON p.user_id=u.id')->fetchAll();
    // Simulate an interrupted DDL run: one added column exists, version not recorded.
    $db->exec('ALTER TABLE user_settings ADD COLUMN default_facility_id BIGINT UNSIGNED NULL');
    // First stop at schema 002, then exercise the real 002 -> 003 upgrade.
    $db->exec("INSERT INTO schema_migrations (version) VALUES ('003_documents')");
    $db->exec("INSERT INTO schema_migrations (version) VALUES ('004_transfers')");
    $db->exec("INSERT INTO schema_migrations (version) VALUES ('005_patients')");
    $db->exec("INSERT INTO schema_migrations (version) VALUES ('006_doctors')");
    $db->exec("INSERT INTO schema_migrations (version) VALUES ('007_ambulances')");
    $db->exec("INSERT INTO schema_migrations (version) VALUES ('008_personnel')");
    $db->exec("INSERT INTO schema_migrations (version) VALUES ('009_destinations')");
    $db->exec("INSERT INTO schema_migrations (version) VALUES ('010_routes')");
    Hospital\Migrations::apply($db,$name);
    $after=$db->query('SELECT u.id,u.username,u.email,u.password_hash,u.staff_id,s.full_name,p.security_notifications FROM users u JOIN staff s ON s.id=u.staff_id JOIN user_settings p ON p.user_id=u.id')->fetchAll();
    if ($before!==$after) throw new RuntimeException('Existing account data changed.');
    $settings=$users->settings($id);
    if ($settings['avatar_url']!==null || $settings['default_facility_id']!==null || $settings['specialties']!==[]) throw new RuntimeException('Optional fields are not empty.');
    $key=str_repeat('a',64); $hash=str_repeat('b',64);
    $stmt=$db->prepare("INSERT INTO stored_files (owner_user_id,storage_key,mime_type,byte_size,sha256) VALUES (?,?,'image/png',10,?)"); $stmt->execute([$id,$key,$hash]);
    $file=$db->lastInsertId(); $db->exec('UPDATE user_settings SET avatar_file_id='.$file.' WHERE user_id='.$id);
    $db->exec("DELETE FROM schema_migrations WHERE version='003_documents'");
    // A partially applied document migration must also resume safely.
    $db->exec("ALTER TABLE stored_files ADD COLUMN purpose VARCHAR(16) NOT NULL DEFAULT 'avatar'");
    Hospital\Migrations::apply($db,$name);
    $avatar=$db->query('SELECT storage_key,sha256,purpose,scan_status FROM stored_files WHERE id='.$file)->fetch();
    if ($avatar!==['storage_key'=>$key,'sha256'=>$hash,'purpose'=>'avatar','scan_status'=>'image_normalized'] || $users->settings($id)['avatar_url']===null) throw new RuntimeException('Existing avatar changed during document upgrade.');
    Hospital\Migrations::apply($db,$name);
    if ((int)$db->query("SELECT COUNT(*) FROM schema_migrations WHERE version='002_settings'")->fetchColumn()!==1) throw new RuntimeException('Migration not idempotent.');
    if ((int)$db->query("SELECT COUNT(*) FROM schema_migrations WHERE version='003_documents'")->fetchColumn()!==1 || (int)$db->query('SELECT COUNT(*) FROM document_categories')->fetchColumn()!==3) throw new RuntimeException('Document migration/catalog not idempotent.');
    $db->exec("INSERT INTO facilities (name) VALUES ('Centro de migración ficticio')");$facility=$db->lastInsertId();
    $db->exec('UPDATE user_settings SET default_facility_id='.$facility.' WHERE user_id='.$id);
    $db->exec("INSERT INTO patients (national_id,full_name) VALUES ('98880002','Paciente de migración ficticio')");$patient=$db->lastInsertId();
    $stmt=$db->prepare("INSERT INTO documents (uploader_user_id,patient_id,category_id,title,document_date,create_key,create_fingerprint) VALUES (?,?,1,'Documento existente','2026-10-12',?,?)");$stmt->execute([$id,$patient,str_repeat('c',64),str_repeat('d',64)]);$document=$db->lastInsertId();
    $db->exec("INSERT INTO document_versions (document_id,version_number,stored_file_id,uploaded_by,original_name,extension) VALUES ($document,1,$file,$id,'prueba.png','png')");
    $existing=$db->query('SELECT d.*,v.stored_file_id,f.storage_key,f.sha256 FROM documents d JOIN document_versions v ON v.document_id=d.id JOIN stored_files f ON f.id=v.stored_file_id')->fetchAll();
    $db->exec("DELETE FROM schema_migrations WHERE version='004_transfers'");
    $db->exec("ALTER TABLE facilities ADD COLUMN address VARCHAR(255) NOT NULL DEFAULT ''");
    Hospital\Migrations::apply($db,$name);
    if($existing!==$db->query('SELECT d.*,v.stored_file_id,f.storage_key,f.sha256 FROM documents d JOIN document_versions v ON v.document_id=d.id JOIN stored_files f ON f.id=v.stored_file_id')->fetchAll() || $users->settings($id)['default_facility_id']!==(string)$facility) throw new RuntimeException('Transfer migration changed existing document or settings relationships.');
    Hospital\Migrations::apply($db,$name);
    if((int)$db->query("SELECT COUNT(*) FROM schema_migrations WHERE version='004_transfers'")->fetchColumn()!==1 || (int)$db->query('SELECT COUNT(*) FROM simulation_state')->fetchColumn()!==1) throw new RuntimeException('Transfer migration is not idempotent.');
    if((int)$db->query('SELECT COUNT(*) FROM transfers')->fetchColumn() || (int)$db->query('SELECT COUNT(*) FROM ambulances')->fetchColumn() || (int)$db->query('SELECT COUNT(*) FROM route_templates')->fetchColumn()) throw new RuntimeException('Unexpected seeded transfer data.');
    $beforePatients=$db->query('SELECT id,national_id,full_name,status,version,date_of_birth,sex FROM patients')->fetchAll();
    $db->exec("DELETE FROM schema_migrations WHERE version='005_patients'");
    $db->exec("ALTER TABLE patients ADD COLUMN phone VARCHAR(25) NOT NULL DEFAULT ''");
    Hospital\Migrations::apply($db,$name);
    Hospital\Migrations::apply($db,$name);
    if ($beforePatients!==$db->query('SELECT id,national_id,full_name,status,version,date_of_birth,sex FROM patients')->fetchAll() || $existing!==$db->query('SELECT d.*,v.stored_file_id,f.storage_key,f.sha256 FROM documents d JOIN document_versions v ON v.document_id=d.id JOIN stored_files f ON f.id=v.stored_file_id')->fetchAll()) throw new RuntimeException('Patient migration changed identities or document references.');
    if ((int)$db->query("SELECT COUNT(*) FROM schema_migrations WHERE version='005_patients'")->fetchColumn()!==1 || (int)$db->query('SELECT COUNT(*) FROM patient_encounters')->fetchColumn() || (int)$db->query('SELECT COUNT(*) FROM patient_contacts')->fetchColumn()) throw new RuntimeException('Patient migration fabricated clinical records or duplicated its version.');
    $db->exec("DELETE FROM schema_migrations WHERE version='006_doctors'");
    Hospital\Migrations::apply($db,$name);
    if ((int)$db->query('SELECT COUNT(*) FROM doctor_profiles')->fetchColumn()!==0) throw new RuntimeException('Doctor migration fabricated records.');
    $db->exec("INSERT INTO ambulances (code,plate,model,capacity) VALUES ('LEGACY-01','SQL001','Modelo existente',4)");
    $vehicle=$db->query('SELECT id,code,plate,model,capacity,version FROM ambulances')->fetchAll();
    $db->exec("DELETE FROM schema_migrations WHERE version='007_ambulances'");
    Hospital\Migrations::apply($db,$name);
    Hospital\Migrations::apply($db,$name);
    if ($vehicle!==$db->query('SELECT id,code,plate,model,capacity,version FROM ambulances')->fetchAll() || $db->query('SELECT archived_at FROM ambulances LIMIT 1')->fetchColumn()!==null) throw new RuntimeException('Ambulance upgrade changed existing vehicles.');
    $db->exec("INSERT INTO staff_roles (staff_id,role_code) SELECT id,'driver' FROM staff LIMIT 1");
    $crew=$db->query('SELECT staff_id,role_code FROM staff_roles ORDER BY staff_id,role_code')->fetchAll();
    $db->exec("DELETE FROM schema_migrations WHERE version='008_personnel'");
    Hospital\Migrations::apply($db,$name); Hospital\Migrations::apply($db,$name);
    if ($crew!==$db->query('SELECT staff_id,role_code FROM staff_roles ORDER BY staff_id,role_code')->fetchAll() || (int)$db->query('SELECT COUNT(*) FROM personnel_profiles')->fetchColumn()!==0) throw new RuntimeException('Personnel upgrade changed staff roles or seeded profiles.');
    $centers=$db->query('SELECT id,name,address,latitude,longitude,status,version FROM facilities ORDER BY id')->fetchAll();
    $db->exec("DELETE FROM schema_migrations WHERE version='009_destinations'");
    Hospital\Migrations::apply($db,$name); Hospital\Migrations::apply($db,$name);
    if ($centers!==$db->query('SELECT id,name,address,latitude,longitude,status,version FROM facilities ORDER BY id')->fetchAll()) throw new RuntimeException('Destination upgrade changed existing center identities.');
    $db->exec("INSERT INTO facilities (name) VALUES ('Destino de migración ficticio')");$second=$db->lastInsertId();
    $geometry='[{"latitude":-34.88,"longitude":-56.16},{"latitude":-34.89,"longitude":-56.17}]';
    $s=$db->prepare("INSERT INTO route_templates (code,name,origin_facility_id,destination_facility_id,geometry,distance_meters,duration_seconds) VALUES ('OLD-01','Ruta existente',?,?,?,1400,600)");$s->execute([$facility,$second,$geometry]);$route=$db->lastInsertId();
    $db->exec("INSERT INTO route_stops (route_id,stop_number,facility_id) VALUES ($route,1,$second)");
    $before=$db->query('SELECT id,code,geometry,distance_meters,duration_seconds,version FROM route_templates')->fetchAll();
    $db->exec("DELETE FROM schema_migrations WHERE version='010_routes'");
    Hospital\Migrations::apply($db,$name);Hospital\Migrations::apply($db,$name);
    if ($before!==$db->query('SELECT id,code,geometry,distance_meters,duration_seconds,version FROM route_templates')->fetchAll() || $db->query('SELECT origin_name FROM route_templates LIMIT 1')->fetchColumn()!=='Centro de migración ficticio' || $db->query('SELECT name FROM route_stops LIMIT 1')->fetchColumn()!=='Destino de migración ficticio') throw new RuntimeException('Route upgrade changed existing paths or did not backfill itinerary snapshots.');
    echo "PASS schema 009 upgrades optional route templates/stops, preserving legacy IDs, geometry and estimates.\n";
    echo "PASS schema 008 upgrades optional destinations while preserving centers and existing references.\n";
    echo "PASS schema 007 upgrades personnel profiles without changing existing crew identities/responsibilities.\n";
    echo "PASS schema 006 upgrades ambulance archival without changing existing vehicle identities.\n";
    echo "PASS schema 005 upgrades to doctor profiles without seeding accounts or doctors.\n";
    echo "PASS schema 004 upgrades to patient management, preserving identities and document links.\n";
    echo "PASS interrupted patient DDL resumes and repeated migration is idempotent without fake contacts/encounters.\n";
    echo "PASS schema 001 upgrades without losing identities, hashes, staff data or preferences.\n";
    echo "PASS interrupted DDL resumes; repeated migration preserves data and one version record.\n";
    echo "PASS upgraded optional profile fields remain empty.\n";
    echo "PASS schema 002 upgrades to documents while preserving existing avatar metadata/references.\n";
    echo "PASS interrupted document DDL resumes and category/version records remain unique.\n";
    echo "PASS schema 003 upgrades to transfers without changing document, patient, center or avatar references.\n";
    echo "PASS interrupted transfer DDL resumes and repeated migration preserves one simulation state/version.\n";
    echo "PASS transfer migration does not silently seed fictional vehicles, routes or transfers.\n";
} finally { $db->exec('DROP DATABASE IF EXISTS `'.$name.'`'); }
'''
result=subprocess.run([PHP,'-r',program],cwd=ROOT,input=old,text=True,capture_output=True,env={**os.environ,'HOSPITAL_UPGRADE_TEST_NAME':name})
print(result.stdout,end='')
if result.returncode:
    print(result.stderr)
    raise SystemExit(result.returncode)
