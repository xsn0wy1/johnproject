"""Focused fleet CRUD/transfer integration in a disposable *_test database."""
import json
import os
import subprocess
from datetime import datetime, timedelta, timezone
from pathlib import Path
from auth_integration import Client, PASSWORD, ADMIN_PASSWORD, SUFFIX, PHP, ROOT, check, sql


def run():
    dispatcher = Client(); dispatcher.csrf()
    username = 'fleet_' + SUFFIX
    status, payload, _ = dispatcher.call('/api/v1/auth/register.php', 'POST', {
        'username':username, 'email':username+'@hospital.example', 'national_id':'98002234', 'password':PASSWORD})
    assert status == 201, payload
    subprocess.run([PHP,'backend/php/cli/users.php','approve',username,'dispatcher'], cwd=ROOT, capture_output=True, check=True)
    assert dispatcher.login(username,PASSWORD)[0] == 200
    admin = Client(); assert admin.login('system_admin',ADMIN_PASSWORD)[0] == 200
    call = lambda action, data=None: dispatcher.call('/api/v1/ambulances/'+action, 'POST' if data is not None else 'GET', data)
    catalog = lambda: dispatcher.call('/api/v1/transfers/catalogs.php')[1]['data']
    check(Client().call('/api/v1/ambulances/list.php')[0] == 401 and admin.call('/api/v1/ambulances/list.php')[0] == 403, 'fleet management requires explicit dispatcher access')
    check(call('list.php')[1]['data'] == [], 'SQL fleet starts empty without mock vehicles')
    record = dict(plate='sAB-901', model='Mercedes-Benz Sprinter', capacity=4, operational_status='available')
    check(dispatcher.call('/api/v1/ambulances/create.php','POST',record,csrf=False)[0] == 403, 'fleet writes require CSRF')
    status, payload, _ = call('create.php',record); assert status == 201, payload
    vehicle = payload['data']; vid = vehicle['id']
    check(vehicle['plate'] == 'SAB901' and vehicle['capacity'] == 4 and vehicle['version'] == 1, 'vehicle fields persist with normalized plate and canonical ID')
    check(any(v['id'] == vid and v['plate'] == 'SAB901' for v in catalog()['ambulances']), 'created vehicle is immediately available to trace selection')
    check(call('create.php',{**record,'plate':'SAB 901'})[0] == 409, 'formatted duplicate plates are rejected')
    check(all(call('create.php',{**record,'capacity':v})[0] == 422 for v in [0,100,True]), 'PHP validates the 1–99 capacity range and rejects booleans')
    edit = {**record,'id':vid,'version':vehicle['version'],'plate':'SAB902','model':'Renault Master','capacity':5}
    status, payload, _ = call('update.php',edit); assert status == 200, payload
    vehicle = payload['data']
    check(call('get.php?id='+vid)[1]['data']['model'] == 'Renault Master' and vehicle['code'].startswith('AMB-') and call('update.php',edit)[0] == 409, 'edits persist, unit codes stay stable and stale writes conflict')
    status, payload, _ = call('update.php',{**edit,'version':vehicle['version'],'operational_status':'maintenance'}); assert status == 200, payload
    vehicle = payload['data']
    check(all(v['id'] != vid for v in catalog()['ambulances']), 'maintenance vehicles are excluded from trace selection')
    status, payload, _ = call('update.php',{**edit,'version':vehicle['version']}); assert status == 200, payload
    vehicle = payload['data']
    # Explicit fictional route/crew fixtures, only in this disposable database.
    subprocess.run([PHP,'backend/php/cli/transfers.php','seed-demo'], cwd=ROOT, capture_output=True, check=True)
    options = catalog(); route = options['routes'][0]
    driver = next(c['id'] for c in options['crew'] if c['role_code'] == 'driver')
    transfer = dict(ambulance_id=vid, driver_id=driver, companion_id=None, patient_id=None,
        origin_facility_id=route['origin_facility_id'], destination_facility_id=route['destination_facility_id'],
        scheduled_at=(datetime.now(timezone(timedelta(hours=-3)))+timedelta(hours=1)).replace(microsecond=0).isoformat(),
        cargo_type='equipment', priority='normal', reason='insumos', notes='', special_equipment=False,
        with_family=False, interdepartmental=False, critical_patient=False,
        create_token=dispatcher.call('/api/v1/transfers/create-token.php')[1]['data']['create_token'])
    status, payload, _ = dispatcher.call('/api/v1/transfers/create.php','POST',transfer); assert status == 201,payload
    trace = payload['data']
    check(trace['ambulance']['id'] == vid and trace['ambulance']['plate'] == 'SAB902', 'real transfer references the managed vehicle and plate snapshot')
    check(call('archive.php',{'id':vid,'version':vehicle['version']})[1]['error']['code'] == 'AMBULANCE_IN_USE' and call('update.php',{**edit,'version':vehicle['version'],'operational_status':'out_of_service'})[0] == 409, 'pending transfers block vehicle archival and taking it out of service')
    status, payload, _ = dispatcher.call('/api/v1/transfers/status.php','POST',{'id':trace['id'],'version':trace['version'],'status':'cancelled'}); assert status == 200,payload
    status, payload, _ = call('archive.php',{'id':vid,'version':vehicle['version']}); assert status == 200,payload
    vehicle = payload['data']
    check(vehicle['status'] == 'archived' and vehicle['archived_at'] and all(v['id'] != vid for v in catalog()['ambulances']), 'archived vehicles are retained but unavailable to new traces')
    check(call('update.php',{**edit,'version':vehicle['version']})[0] == 409 and call('create.php',{**record,'plate':'SAB902'})[0] == 409, 'archive protects edits and retains plate uniqueness')
    check(dispatcher.call('/api/v1/transfers/get.php?id='+trace['id'])[1]['data']['ambulance']['id'] == vid and sql('SELECT ambulance_plate FROM transfers WHERE id='+trace['id'])[0]['ambulance_plate'] == 'SAB902', 'removal preserves the existing trace and its vehicle history')
    status, payload, _ = call('restore.php',{'id':vid,'version':vehicle['version']}); assert status == 200,payload
    check(any(v['id'] == vid for v in catalog()['ambulances']), 'restoring an operational vehicle restores selection eligibility')
    proof = Path(os.environ['HOSPITAL_FLEET_TEST_DIR'])/'browser.json'
    proof.write_text(json.dumps({'username':username,'password':PASSWORD,'id':vid})); proof.chmod(0o600)


if __name__ == '__main__':
    run()
