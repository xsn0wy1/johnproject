"""Focused personnel/trace checks against a disposable *_test database."""
import json
import os
import subprocess
from datetime import datetime, timedelta, timezone
from pathlib import Path
from auth_integration import Client, PASSWORD, ADMIN_PASSWORD, SUFFIX, PHP, ROOT, check, sql


def run():
    dispatcher=Client(); dispatcher.csrf(); username='crew_'+SUFFIX
    code,payload,_=dispatcher.call('/api/v1/auth/register.php','POST',dict(username=username,email=username+'@hospital.example',national_id='98003234',password=PASSWORD))
    assert code==201,payload
    subprocess.run([PHP,'backend/php/cli/users.php','approve',username,'dispatcher'],cwd=ROOT,capture_output=True,check=True)
    code,payload,_=dispatcher.login(username,PASSWORD); assert code==200,payload
    uid=payload['data']['user']['id']
    admin=Client(); assert admin.login('system_admin',ADMIN_PASSWORD)[0]==200
    call=lambda action,data=None:dispatcher.call('/api/v1/personnel/'+action,'POST' if data is not None else 'GET',data)
    catalog=lambda:dispatcher.call('/api/v1/transfers/catalogs.php')[1]['data']
    check(Client().call('/api/v1/personnel/list.php')[0]==401 and admin.call('/api/v1/personnel/list.php')[0]==403,'personnel management requires dispatcher access')
    check(call('list.php')[1]['data']==[],'personnel starts empty without browser samples')
    record=dict(full_name='Chofer Ficticio',national_id='9.800.323-5',phone='099 123 456',responsibility='driver',driving_license='A-1234567',availability='active')
    check(dispatcher.call('/api/v1/personnel/create.php','POST',record,csrf=False)[0]==403,'personnel writes require CSRF')
    check(call('create.php',{**record,'driving_license':''})[0]==422,'drivers require a license in PHP')
    code,payload,_=call('create.php',record); assert code==201,payload
    driver=payload['data']; did=driver['id']
    check(driver['national_id']=='98003235' and driver['driving_license']=='A1234567' and sql('SELECT COUNT(*) AS n FROM users WHERE staff_id='+did)[0]['n']==0,'driver is a canonical SQL staff entity without a new login account')
    check(call('create.php',record)[0]==409 and call('create.php',{**record,'national_id':'98003236','full_name':'Duplicate license'})[0]==409 and call('get.php?id='+did)[1]['data']['full_name']==record['full_name'],'duplicate identity/license cannot overwrite another record')
    copilot_record={**record,'full_name':'Copiloto Ficticio','national_id':'98003234','responsibility':'copilot','driving_license':''}
    code,payload,_=call('create.php',copilot_record); assert code==201,payload
    copilot=payload['data']; cid=copilot['id']
    check(str(sql('SELECT staff_id FROM users WHERE id='+uid)[0]['staff_id'])==cid and copilot['driving_license']=='','copilot can omit a license and reuse an existing account identity')
    check(any(p['id']==did and p['role_code']=='driver' for p in catalog()['crew']) and any(p['id']==cid and p['role_code']=='copilot' for p in catalog()['crew']),'both managed responsibilities appear in trace selection')
    edit={**record,'id':did,'version':driver['version'],'phone':'099 555 666'}
    code,payload,_=call('update.php',edit); assert code==200,payload
    driver=payload['data']
    check(call('get.php?id='+did)[1]['data']['phone']=='099 555 666' and call('update.php',edit)[0]==409,'edits persist and stale revisions conflict')
    subprocess.run([PHP,'backend/php/cli/transfers.php','seed-demo'],cwd=ROOT,capture_output=True,check=True)
    options=catalog(); route=options['routes'][0]
    transfer=dict(ambulance_id=options['ambulances'][0]['id'],driver_id=did,companion_id=cid,patient_id=None,
        origin_facility_id=route['origin_facility_id'],destination_facility_id=route['destination_facility_id'],
        scheduled_at=(datetime.now(timezone(timedelta(hours=-3)))+timedelta(hours=1)).replace(microsecond=0).isoformat(),
        cargo_type='equipment',priority='normal',reason='insumos',notes='',special_equipment=False,with_family=False,
        interdepartmental=False,critical_patient=False,create_token=dispatcher.call('/api/v1/transfers/create-token.php')[1]['data']['create_token'])
    code,payload,_=dispatcher.call('/api/v1/transfers/create.php','POST',transfer); assert code==201,payload
    trace=payload['data']
    check(trace['crew']['driver']['id']==did and trace['crew']['companion']['id']==cid and trace['crew']['companion']['responsibility']=='copilot','actual trace uses the registered driver/copilot staff IDs')
    check(call('archive.php',{'id':did,'version':driver['version']})[0]==409 and call('archive.php',{'id':cid,'version':copilot['version']})[0]==409 and call('update.php',{**edit,'version':driver['version'],'responsibility':'copilot'})[0]==409 and call('update.php',{**edit,'version':driver['version'],'availability':'inactive'})[0]==409,'pending assignments block crew archival, role removal and inactivation')
    code,payload,_=dispatcher.call('/api/v1/transfers/status.php','POST',dict(id=trace['id'],version=trace['version'],status='cancelled')); assert code==200,payload
    code,payload,_=call('update.php',{**edit,'version':driver['version'],'responsibility':'copilot'}); assert code==200,payload
    driver=payload['data']
    check(any(p['id']==did and p['role_code']=='copilot' for p in catalog()['crew']) and all(not(p['id']==did and p['role_code']=='driver') for p in catalog()['crew']),'role changes update canonical trace responsibilities')
    code,payload,_=call('update.php',{**edit,'version':driver['version'],'availability':'inactive'}); assert code==200,payload
    driver=payload['data']
    attempt={**transfer,'create_token':dispatcher.call('/api/v1/transfers/create-token.php')[1]['data']['create_token']}
    check(all(p['id']!=did for p in catalog()['crew']) and dispatcher.call('/api/v1/transfers/create.php','POST',attempt)[1]['error']['code']=='CREW_UNAVAILABLE','inactive crew are excluded from selectors and rejected by booking validation')
    assert call('update.php',{**edit,'version':driver['version']})[0]==200
    # A separate doctor responsibility must survive personnel removal.
    sql("INSERT INTO staff_roles (staff_id,role_code) VALUES ("+cid+",'doctor')")
    code,payload,_=call('archive.php',{'id':cid,'version':copilot['version']}); assert code==200,payload
    copilot=payload['data']; crew=catalog()['crew']
    check(copilot['status']=='archived' and all(not(p['id']==cid and p['role_code']=='copilot') for p in crew) and any(p['id']==cid and p['role_code']=='doctor' for p in crew) and dispatcher.call('/api/v1/auth/me.php')[0]==200,'personnel archive excludes crew duty without disabling login or doctor responsibilities')
    check(dispatcher.call('/api/v1/transfers/get.php?id='+trace['id'])[1]['data']['crew']['companion']['id']==cid,'archival preserves historical crew references')
    code,payload,_=call('restore.php',{'id':cid,'version':copilot['version']}); assert code==200,payload
    check(any(p['id']==cid and p['role_code']=='copilot' for p in catalog()['crew']),'restoration restores active crew eligibility')
    legacy=next(p for p in call('list.php')[1]['data'] if p['id'] not in [did,cid] and p['responsibility']=='driver')
    code,payload,_=call('update.php',dict(id=legacy['id'],version=legacy['version'],full_name=legacy['full_name'],national_id=legacy['national_id'],phone='099 222 333',responsibility='driver',driving_license='LEGACY123',availability='active')); assert code==200,payload
    check(payload['data']['id']==legacy['id'] and payload['data']['driving_license']=='LEGACY123','legacy trace staff can be completed without duplicate identities')
    proof=Path(os.environ['HOSPITAL_PERSONNEL_TEST_DIR'])/'browser.json'
    proof.write_text(json.dumps(dict(username=username,password=PASSWORD,id=did)));proof.chmod(0o600)


if __name__=='__main__':
    run()
