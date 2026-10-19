"""Focused doctor CRUD/assignment checks against a disposable *_test database."""
import subprocess
from auth_integration import Client, PASSWORD, SUFFIX, PHP, ROOT, check, sql


def run():
    manager = Client()
    manager.csrf()
    username = 'doctor_manager_' + SUFFIX
    status, payload, _ = manager.call('/api/v1/auth/register.php', 'POST', {
        'username': username, 'email': username + '@hospital.example',
        'national_id': '98001234', 'password': PASSWORD})
    assert status == 201, payload
    subprocess.run([PHP, 'backend/php/cli/users.php', 'approve', username, 'records_manager'], cwd=ROOT, check=True, capture_output=True)
    assert manager.login(username, PASSWORD)[0] == 200
    admin = Client()
    from auth_integration import ADMIN_PASSWORD
    assert admin.login('system_admin', ADMIN_PASSWORD)[0] == 200
    call = lambda action, data=None: manager.call('/api/v1/doctors/' + action, 'POST' if data is not None else 'GET', data)
    check(Client().call('/api/v1/doctors/list.php')[0] == 401 and admin.call('/api/v1/doctors/list.php')[0] == 403, 'doctor records require records_manager access')
    check(call('list.php')[1]['data'] == [], 'directory starts empty without browser sample records')
    record = dict(title='Dra.', full_name='Lucía Prueba', national_id='9.800.123-5', license='MSP-98765',
                  specialty='Cardiología', department='Consultorios Externos', office='Consultorio 12',
                  phone='099 123 456', email='lucia@hospital.example', availability='available',
                  shift='night', days='rotating', start_time='22:00', end_time='06:00', notes='Datos ficticios.\nGuardia nocturna.')
    check(manager.call('/api/v1/doctors/create.php', 'POST', record, csrf=False)[0] == 403, 'doctor writes require CSRF')
    status, payload, _ = call('create.php', record)
    assert status == 201, payload
    doctor = payload['data']; did = doctor['id']
    check(doctor['national_id'] == '98001235' and doctor['start_time'] == '22:00' and doctor['notes'] == record['notes'], 'SQL doctor identity, overnight schedule and notes persist')
    check(sql('SELECT COUNT(*) AS n FROM users WHERE staff_id=' + did)[0]['n'] == 0, 'creating a doctor does not create a login account')
    check(call('create.php', record)[0] == 409 and call('create.php', {**record, 'national_id':'98001236'})[0] == 409, 'duplicate identity and license are rejected')
    check(call('create.php', {**record, 'national_id':'98001237', 'license':'MSP98766', 'email':'invalid'})[0] == 422, 'server validates email')
    edit = {**record, 'id':did, 'version':doctor['version'], 'office':'Consultorio 14'}
    status, payload, _ = call('update.php', edit); assert status == 200, payload
    doctor = payload['data']
    check(call('get.php?id='+did)[1]['data']['office'] == 'Consultorio 14' and call('update.php', edit)[0] == 409, 'edits persist and stale versions cannot overwrite them')
    catalog = manager.call('/api/v1/patients/catalogs.php')[1]['data']
    check(any(d['id'] == did for d in catalog['doctors']), 'new doctor is selectable for patient treatment')
    patient = dict(full_name='Paciente Prueba', national_id='98001238', date_of_birth=None, sex=None, age=34,
                   phone='', blood_group='', allergies='', emergency_name='', emergency_phone='', emergency_relationship='',
                   care_status='outpatient', room='Ambulatorio', department=record['department'], doctor_staff_id=did,
                   doctor_specialty=record['specialty'], admission_date=None, diagnosis='', clinical_state='', create_token=catalog['create_token'])
    status, payload, _ = manager.call('/api/v1/patients/create.php','POST',patient); assert status == 201, payload
    pid = payload['data']['id']
    check(payload['data']['encounter']['doctor_staff_id'] == did, 'patient encounter references the same canonical staff ID')
    status, payload, _ = call('archive.php', {'id':did, 'version':doctor['version']}); assert status == 200, payload
    doctor = payload['data']
    catalog = manager.call('/api/v1/patients/catalogs.php')[1]['data']
    check(all(d['id'] != did for d in catalog['doctors']) and sql('SELECT status FROM staff WHERE id='+did)[0]['status'] == 'active', 'archive removes new assignments without disabling shared staff')
    encounter = manager.call('/api/v1/patients/get.php?id='+pid)[1]['data']['encounter']
    check(encounter['doctor_staff_id'] == did and not encounter['doctor_active'], 'archived doctor remains in patient history')
    check(call('update.php', {**edit, 'version':doctor['version']})[0] == 409, 'archived doctor cannot be edited')
    status, payload, _ = call('restore.php', {'id':did, 'version':doctor['version']}); assert status == 200, payload
    doctor = payload['data']
    check(any(d['id'] == did for d in manager.call('/api/v1/patients/catalogs.php')[1]['data']['doctors']), 'restoring a doctor restores assignment eligibility')
    status, payload, _ = call('update.php',{**edit,'version':doctor['version'],'availability':'inactive'}); assert status == 200,payload
    check(all(d['id'] != did for d in manager.call('/api/v1/patients/catalogs.php')[1]['data']['doctors']), 'inactive availability is excluded from new patient assignments')
    # Leave one available fictional record for the short browser check.
    assert call('update.php',{**edit,'version':payload['data']['version']})[0] == 200
    import json, os
    from pathlib import Path
    proof=Path(os.environ['HOSPITAL_DOCTOR_TEST_DIR'])/'browser.json'
    proof.write_text(json.dumps({'username':username,'password':PASSWORD,'id':did}))
    proof.chmod(0o600)


if __name__ == '__main__':
    run()
