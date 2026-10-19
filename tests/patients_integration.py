"""Patient management integration; requires a dedicated disposable *_test DB."""
import os
import secrets
import subprocess
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo
from pathlib import Path
from auth_integration import Client, PASSWORD, ADMIN_PASSWORD, SUFFIX, PHP, sql
from documents_integration import upload, fields as document_fields, pdf_bytes, detail as document_detail, admin_sql

assert os.environ['HOSPITAL_DB_NAME'].endswith('_test')
ROOT = Path(__file__).resolve().parents[1]
checks = 0

def check(ok, label):
    global checks
    assert ok, label
    checks += 1
    print('PASS', label, flush=True)

def call(client, endpoint, body=None):
    return client.call('/api/v1/patients/' + endpoint, 'POST' if body is not None else 'GET', body)

def get(client, id):
    return call(client, 'get.php?id=' + id)[1]['data']

def fields(client, **changes):
    token = call(client, 'catalogs.php')[1]['data']['create_token']
    return dict(full_name='Paciente ficticio ' + secrets.token_hex(3), national_id=str(70000000+secrets.randbelow(9999999)),
                date_of_birth=None, sex=None, age=34, phone='099 123 456', blood_group='O+', allergies='',
                emergency_name='Contacto ficticio', emergency_phone='098 123 456', emergency_relationship='Hermano',
                care_status='inpatient', room='Habitación de prueba', department='Servicio de prueba', doctor_staff_id=None,
                doctor_specialty='', admission_date=datetime.now(ZoneInfo('America/Montevideo')).date().isoformat(),
                diagnosis='Diagnóstico ficticio\nSegunda línea', clinical_state='Estado de prueba', create_token=token, **changes)

def edit(p, **changes):
    e=p['encounter'] or {}; c=p['emergency_contact']
    body=dict(id=p['id'], version=p['version'], full_name=p['full_name'], national_id=p['national_id'], date_of_birth=p['date_of_birth'],
              sex=p['sex'], age=p['age'], phone=p['phone'], blood_group=p['blood_group'] or '', allergies=p['allergies'],
              emergency_name=c['full_name'], emergency_phone=c['phone'], emergency_relationship=c['relationship'],
              care_status=e.get('care_status'), room=e.get('room',''), department=e.get('department',''), doctor_staff_id=e.get('doctor_staff_id'),
              doctor_specialty=e.get('doctor_specialty',''), admission_date=e.get('admission_date'), diagnosis=e.get('diagnosis',''), clinical_state=e.get('clinical_state',''))
    return {**body, **changes}

def cli(*args):
    return subprocess.run([PHP,*args],cwd=ROOT,env=os.environ,capture_output=True,text=True)

def main():
    sql('DELETE FROM auth_rate_limits')
    admin=Client(); assert admin.login('system_admin',ADMIN_PASSWORD)[0]==200
    actors=[]
    for index,role in enumerate(['records_manager','records_manager','staff','dispatcher']):
        c=Client(); c.csrf(); name=f'patient_{SUFFIX}_{index}'
        code,body,_=c.call('/api/v1/auth/register.php','POST',dict(username=name,email=name+'@hospital.example',national_id=str(80000000+secrets.randbelow(9999999)),password=PASSWORD))
        assert code==201,body
        assert admin.call('/api/v1/admin/users/approve.php','POST',{'user_id':body['data']['user_id'],'role':role})[0]==200
        assert c.login(name,PASSWORD)[0]==200
        actors.append(c)
    first,second,staff,dispatcher=actors
    check(call(Client(),'catalogs.php')[0]==401,'patient catalogs require authentication')
    check(all(call(c,'list.php',{})[0]==403 for c in [admin,staff,dispatcher]),'full clinical records require explicit records_manager, including for admins')
    check(staff.call('/src/views/management/patients.html')[0]==303 and first.call('/src/views/management/patients.html')[0]==200,'patient HTML is guarded by records permissions')
    check(call(first,'list.php')[0]==405,'patient search terms never use GET')
    check(first.call('/api/v1/patients/list.php','POST',{},csrf=False)[0]==403,'private patient searches require CSRF')
    base=fields(first)
    check(first.call('/api/v1/patients/create.php','POST',base,csrf=False)[0]==403,'creation requires CSRF')
    code,payload,_=call(first,'create.php',base); assert code==201,payload
    patient=payload['data']; id=patient['id']
    check(isinstance(id,str) and patient['version']==1 and patient['status']=='active','created patient is a canonical SQL entity with a revision')
    check(patient['encounter']['doctor_staff_id'] is None and patient['emergency_contact']['full_name']==base['emergency_name'],'unassigned doctor and emergency contact are persisted')
    check(patient['age']==34 and patient['age_is_estimate'] and patient['date_of_birth'] is None and patient['age_recorded_on'],'observed age has a reference date and no invented DOB')
    check(patient['allergies']=='' and patient['encounter']['diagnosis']==base['diagnosis'],'unknown allergies stay unknown and diagnosis paragraphs survive')
    check(call(first,'create.php',base)[1]['data']['id']==id,'identical creation retry returns the same patient')
    check(call(first,'create.php',{**base,'full_name':'Changed'})[0]==409,'changed retry payload is rejected')
    duplicate=fields(first);duplicate['national_id']=base['national_id']
    check(call(first,'create.php',duplicate)[0]==409,'duplicate national identity cannot create another patient')
    for change,label in [({'age':True},'boolean age rejected'),({'age':121},'age bounds enforced'),({'blood_group':'ZZ'},'blood group allowlist enforced'),({'date_of_birth':'2026-02-30'},'invalid DOB rejected'),({'date_of_birth':'2099-01-01'},'future DOB rejected'),({'national_id':'123'},'invalid identity rejected'),({'phone':'not a phone'},'invalid phone rejected'),({'sex':'invented'},'invalid sex rejected'),({'doctor_staff_id':'9999999'},'unknown doctor rejected'),({'care_status':'discharged'},'cannot invent a new discharge'),({'diagnosis':'x'*1001},'diagnosis bound enforced'),({'actor_user_id':'1'},'client privilege/actor fields rejected')]:
        check(call(first,'create.php',{**fields(first),**change})[0]==422,label)
    found=staff.call('/api/v1/catalogs/patients.php','POST',{'q':base['national_id']})[1]['data']
    check(found[0]['id']==id and set(found[0])=={'id','full_name','national_id'},'documents selector sees the same ID without clinical/contact data')
    found=dispatcher.call('/api/v1/transfers/patients.php','POST',{'q':base['national_id']})[1]['data']
    check(found[0]['id']==id and found[0]['age']==34 and found[0]['age_is_estimate'],'transfer selector uses canonical patient and recorded age')
    check(call(second,'get.php?id='+id)[1]['data']['phone']==base['phone'],'another records manager reads the committed data')
    check(call(staff,'get.php?id='+id)[0]==403 and call(admin,'get.php?id='+id)[0]==403,'knowing an ID does not grant full patient access')
    check(call(first,'get.php?id=9999999')[0]==404,'missing patient returns 404')
    check(call(first,'list.php',{'q':'%'})[1]['meta']['total']==0,'SQL wildcard search is escaped')
    check(call(first,'list.php',{'q':base['national_id'],'care_status':'inpatient'})[1]['meta']['total']==1,'search and clinical-state filters use SQL')
    check(call(first,'list.php',{'q':'099123456'})[1]['meta']['total']==1,'phone search ignores display separators')
    check(call(first,'list.php',{'page_size':51})[0]==422,'pagination is bounded')
    changed=call(first,'update.php',edit(patient,phone='097 111 222'))
    check(changed[0]==200 and changed[1]['data']['version']==2,'aggregate edits advance the patient revision')
    check(call(second,'update.php',edit(patient,phone='096 111 222'))[0]==409,'stale editor cannot overwrite a newer edit')
    patient=changed[1]['data']; recorded=patient['age_recorded_on']
    patient=call(first,'update.php',edit(patient,allergies='Dato ficticio'))[1]['data']
    check(patient['age_recorded_on']==recorded,'metadata edits do not pretend the observed age was remeasured')
    patient=call(first,'update.php',edit(patient,date_of_birth='1990-01-02',sex='female',age=99))[1]['data']
    check(patient['age']==datetime.now(ZoneInfo('America/Montevideo')).year-1990 and not patient['age_is_estimate'] and patient['age_recorded_on'] is None,'DOB determines age and clears the unrelated estimate')
    assert cli('backend/php/cli/transfers.php','seed-demo').returncode==0
    doctor_ci=str(60000000+secrets.randbelow(9999999))
    sql("INSERT INTO staff (national_id,full_name) VALUES ('"+doctor_ci+"','Médico ficticio de prueba')")
    doctor=str(sql("SELECT id FROM staff WHERE national_id='"+doctor_ci+"'")[0]['id'])
    sql("INSERT INTO staff_roles (staff_id,role_code) VALUES ("+doctor+",'doctor')")
    catalogs=call(first,'catalogs.php')[1]['data']; assert any(d['id']==doctor for d in catalogs['doctors'])
    patient=call(first,'update.php',edit(patient,doctor_staff_id=doctor,doctor_specialty='Área ficticia'))[1]['data']
    check(patient['encounter']['doctor_staff_id']==doctor,'assigned doctor references shared staff with doctor responsibility')
    bad=sql("SELECT staff_id FROM users WHERE username='system_admin'")[0]['staff_id']
    check(call(first,'update.php',edit(patient,doctor_staff_id=str(bad)))[0]==422,'ordinary account/profile does not imply doctor eligibility')
    sql("UPDATE staff SET status='inactive' WHERE id="+doctor)
    check(call(first,'update.php',edit(patient,allergies='Corrección ficticia'))[0]==200,'existing doctor history can be retained when staff becomes inactive')
    patient=get(first,id)
    patient=call(first,'update.php',edit(patient,care_status='discharged'))[1]['data']; old_encounter=patient['encounter']['id']
    check(patient['encounter']['discharged_at'] is not None and call(first,'list.php',{})[1]['meta']['stats']['discharged_today']==1,'discharge persists server time and updates the actual daily count')
    check(call(first,'update.php',edit(patient,care_status='outpatient'))[0]==422,'a new encounter cannot reassign an inactive doctor from history')
    patient=call(first,'update.php',edit(patient,care_status='outpatient',doctor_staff_id=None))[1]['data']
    check(patient['encounter']['id']!=old_encounter and len(sql('SELECT id FROM patient_encounters WHERE patient_id='+id))==2,'new care after discharge preserves the prior encounter')
    doc_code,doc=upload(first,document_fields(first,'1',id),pdf_bytes())
    assert doc_code==201,doc
    doc_id=doc['data']['id']
    check(document_detail(first,doc_id)['patient']['id']==id,'uploaded document references the patient created through management')
    # Real transfer creation must use this same identity and block an unsafe archive.
    cat=dispatcher.call('/api/v1/transfers/catalogs.php')[1]['data']; route=cat['routes'][0]
    driver=next(item['id'] for item in cat['crew'] if item['role_code']=='driver')
    schedule=(datetime.now(ZoneInfo('America/Montevideo'))+timedelta(hours=1)).replace(microsecond=0).isoformat()
    transfer=dict(ambulance_id=cat['ambulances'][0]['id'],driver_id=driver,companion_id=None,patient_id=id,origin_facility_id=route['origin_facility_id'],destination_facility_id=route['destination_facility_id'],scheduled_at=schedule,cargo_type='patient',priority='normal',reason='estudio',notes='',special_equipment=False,with_family=False,interdepartmental=False,critical_patient=False,create_token=dispatcher.call('/api/v1/transfers/create-token.php')[1]['data']['create_token'])
    code,result,_=dispatcher.call('/api/v1/transfers/create.php','POST',transfer);assert code==201,result
    trip=result['data'];check(trip['patient']['id']==id,'transfer creation uses the managed patient ID and DOB/sex')
    check(call(first,'archive.php',{'id':id,'version':patient['version']})[1]['error']['code']=='PATIENT_IN_USE','scheduled/active transfers prevent archiving their patient')
    assert dispatcher.call('/api/v1/transfers/status.php','POST',{'id':trip['id'],'version':trip['version'],'status':'cancelled'})[0]==200
    result=call(first,'archive.php',{'id':id,'version':patient['version']})
    check(result[0]==200 and result[1]['data']['status']=='archived','remove action archives the patient')
    archived=result[1]['data']
    check(document_detail(first,doc_id)['patient']['id']==id,'archiving preserves authorized document/patient history')
    check(staff.call('/api/v1/catalogs/patients.php','POST',{'q':base['national_id']})[1]['data']==[] and dispatcher.call('/api/v1/transfers/patients.php','POST',{'q':base['national_id']})[1]['data']==[],'archived patients disappear from both active selectors')
    check(call(first,'update.php',edit(archived))[0]==409,'archived patient cannot be edited before restoration')
    check(call(first,'restore.php',{'id':id,'version':patient['version']})[0]==409,'restoration also protects the revision')
    patient=call(first,'restore.php',{'id':id,'version':archived['version']})[1]['data']
    check(patient['status']=='active' and patient['encounter']['care_status']=='outpatient','restore keeps all patient, contact and encounter data')
    midnight=datetime.now(ZoneInfo('America/Montevideo')).replace(hour=0,minute=0,second=0,microsecond=0)
    later=(midnight+timedelta(hours=23)).astimezone(timezone.utc).strftime('%Y-%m-%d %H:%M:%S')
    tomorrow=(midnight+timedelta(days=1,hours=1)).astimezone(timezone.utc).strftime('%Y-%m-%d %H:%M:%S')
    sql("INSERT INTO patient_appointments (patient_id,scheduled_at) VALUES ("+id+",'"+later+"'),("+id+",'"+tomorrow+"')")
    check(call(first,'list.php',{})[1]['meta']['stats']['appointments_today']==1,'appointment metric uses Montevideo day boundaries')
    check(call(first,'archive.php',{'id':id,'version':patient['version']})[1]['error']['code']=='PATIENT_IN_USE','pending appointments prevent archiving the patient')
    sql("UPDATE patient_appointments SET status='cancelled' WHERE patient_id="+id)
    # Two independent managers compete over the same aggregate revision.
    payload1=edit(patient,allergies='Edición uno');payload2=edit(patient,allergies='Edición dos')
    with ThreadPoolExecutor(2) as pool:
        results=list(pool.map(lambda pair:call(*pair)[0],[(first,'update.php',payload1),(second,'update.php',payload2)]))
    check(sorted(results)==[200,409],'competing edits commit once and reject the stale revision')
    # SQL faults must roll back identities, contacts, encounters and audit writes.
    failing=fields(first)
    admin_sql("CREATE TRIGGER patient_fault BEFORE INSERT ON patient_contacts FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='test fault'")
    try:
        check(call(first,'create.php',failing)[0]==503,'SQL failure returns structured failure')
        check(sql("SELECT id FROM patients WHERE national_id='"+failing['national_id']+"'")==[],'failed related write leaves no partial patient entity')
    finally: admin_sql('DROP TRIGGER patient_fault')
    check(call(first,'create.php',failing)[0]==201,'creation retry after rollback succeeds')
    retry=fields(first)
    other=first.copy_session()  # Same actor, independent request streams.
    with ThreadPoolExecutor(2) as pool:
        replies=list(pool.map(lambda c:call(c,'create.php',retry),[first,other]))
    check(all(r[0]==201 for r in replies) and replies[0][1]['data']['id']==replies[1][1]['data']['id'],'concurrent retries create one patient identity')
    # Build enough entries to exercise real list pages, never a browser-only array.
    for _ in range(6): assert call(first,'create.php',fields(first))[0]==201
    one=call(first,'list.php',{'page':1})[1];two=call(first,'list.php',{'page':2})[1]
    check(len(one['data'])==5 and len(two['data'])>=3 and not ({p['id'] for p in one['data']} & {p['id'] for p in two['data']}),'SQL pages have stable distinct IDs beyond the first five rows')
    check(call(first,'list.php',{'page':999999})[1]['meta']['page']==2,'out-of-range list page is clamped after mutations')
    check(sql("SELECT version FROM schema_migrations WHERE version='005_patients'")!=[],'fresh setup records patient schema 005')
    # Identity-only legacy/CLI records gain no invented clinical defaults.
    ci=str(90000000+secrets.randbelow(9999999));assert cli('backend/php/cli/patients.php','add',ci,'Paciente legado ficticio').returncode==0
    legacy=call(first,'list.php',{'q':ci})[1]['data'][0]
    check(legacy['encounter'] is None and legacy['age'] is None and legacy['allergies']=='','legacy identities remain editable without fabricated health details')
    raced=call(first,'create.php',fields(first))[1]['data']
    race_trip={**transfer,'patient_id':raced['id'],'create_token':dispatcher.call('/api/v1/transfers/create-token.php')[1]['data']['create_token']}
    with ThreadPoolExecutor(2) as pool:
        a=pool.submit(call,first,'archive.php',{'id':raced['id'],'version':raced['version']})
        b=pool.submit(dispatcher.call,'/api/v1/transfers/create.php','POST',race_trip)
        archived_result,trip_result=a.result(),b.result()
    check((archived_result[0],trip_result[0]) in [(200,422),(409,201)],'patient archive and transfer booking share one lock and cannot leave an archived new assignment')
    if trip_result[0]==201:
        item=trip_result[1]['data']
        assert dispatcher.call('/api/v1/transfers/status.php','POST',{'id':item['id'],'version':item['version'],'status':'cancelled'})[0]==200
    uid=second.call('/api/v1/auth/me.php')[1]['data']['user']['id']
    assert admin.call('/api/v1/admin/users/disable.php','POST',{'user_id':uid})[0]==200
    check(call(second,'get.php?id='+id)[0]==401 and call(second,'archive.php',{'id':id,'version':1})[0] in [401,403],'revocation removes patient reads and writes immediately')
    print(f'{checks} patient checks passed.',flush=True)

if __name__=='__main__': main()
