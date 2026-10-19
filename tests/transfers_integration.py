"""Transfers/simulation integration: only a dedicated disposable *_test database."""
import json
import os
import secrets
import subprocess
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
from pathlib import Path
from auth_integration import Client, PASSWORD, ADMIN_PASSWORD, SUFFIX, PHP, sql

assert os.environ['HOSPITAL_DB_NAME'].endswith('_test')
ROOT=Path(__file__).resolve().parents[1]
checks=0
def check(ok,label):
    global checks
    assert ok,label
    checks+=1
    print('PASS',label,flush=True)
def call(client,name,body=None):
    endpoint,_,query=name.partition('?')
    return client.call('/api/v1/transfers/'+endpoint+'.php'+('?' + query if query else ''),'POST' if body is not None else 'GET',body)
def listing(client,**query): return call(client,'list',query)[1]
def get(client,id): return call(client,'get?id='+id)[1]['data']
def status(client,item,state):return call(client,'status',{'id':item['id'],'version':item['version'],'status':state})
def cli(*args):return subprocess.run([PHP,*args],cwd=ROOT,env=os.environ,capture_output=True,text=True)
def admin_sql(statement):
    program=r'''require 'backend/php/autoload.php';$c=Hospital\Config::load();if(!str_ends_with($c['db']['name'],'_test'))exit(1);$c['db']['user']=getenv('HOSPITAL_SETUP_DB_USER')?:'root';$c['db']['password']=getenv('HOSPITAL_SETUP_DB_PASSWORD')?:'';Hospital\Database::connect($c)->exec(stream_get_contents(STDIN));'''
    subprocess.run([PHP,'-r',program],cwd=ROOT,input=statement,text=True,capture_output=True,check=True)
def main():
    tables=['transfer_latest_positions','transfer_positions','resource_reservations','transfer_events','transfer_crew','transfers','transfer_drafts','simulation_state','simulation_runs']
    admin_sql('SET FOREIGN_KEY_CHECKS=0;'+''.join('TRUNCATE TABLE '+table+';' for table in tables)+'SET FOREIGN_KEY_CHECKS=1;INSERT INTO simulation_state(id) VALUES(1);')
    assert cli('backend/php/cli/transfers.php','seed-demo').returncode==0
    sql('DELETE FROM auth_rate_limits')
    admin=Client();assert admin.login('system_admin',ADMIN_PASSWORD)[0]==200
    actors=[]
    for index,role in enumerate(['dispatcher','dispatcher','staff','staff','records_manager']):
        c=Client();c.csrf();name=f'transfer_{SUFFIX}_{index}'
        result=c.call('/api/v1/auth/register.php','POST',{'username':name,'email':name+'@hospital.example','national_id':str(87000000+secrets.randbelow(999999)),'password':PASSWORD})
        assert result[0]==201,result[1];uid=result[1]['data']['user_id']
        assert admin.call('/api/v1/admin/users/approve.php','POST',{'user_id':uid,'role':role})[0]==200
        assert c.login(name,PASSWORD)[0]==200
        actors.append((c,uid,name))
    first,uid,name=actors[0];second=actors[1][0];assigned,assigned_uid,_=actors[2];unrelated=actors[3][0];records=actors[4][0]
    catalog=call(first,'catalogs')[1]['data']
    vehicles=catalog['ambulances'];routes=catalog['routes'];route=routes[0]
    staffid=str(sql('SELECT staff_id FROM users WHERE id='+assigned_uid)[0]['staff_id'])
    sql("INSERT INTO staff_roles (staff_id,role_code) VALUES ("+staffid+",'driver')")
    crew=[str(x['id']) for x in sql("SELECT staff_id AS id FROM staff_roles WHERE role_code='driver' AND staff_id<>"+staffid+" ORDER BY staff_id")]
    copilot=next(x['id'] for x in catalog['crew'] if x['role_code']=='copilot')
    national=str(78000000+secrets.randbelow(999999));sql("INSERT INTO patients (national_id,full_name,date_of_birth,sex) VALUES ('"+national+"','Paciente ficticio de traslado','1990-01-02','female')")
    patient=str(sql("SELECT id FROM patients WHERE national_id='"+national+"'")[0]['id'])
    def fields(vehicle=0,driver=staffid,offset=3600,**overrides):
        when=(datetime.now(timezone(timedelta(hours=-3)))+timedelta(seconds=offset)).replace(microsecond=0).isoformat()
        token=call(first,'create-token')[1]['data']['create_token']
        return {'ambulance_id':vehicles[vehicle]['id'],'driver_id':driver,'companion_id':None,'patient_id':patient,'origin_facility_id':route['origin_facility_id'],'destination_facility_id':route['destination_facility_id'],'scheduled_at':when,'cargo_type':'patient','priority':'normal','reason':'estudio','notes':'Ficción\nSin datos reales','special_equipment':False,'with_family':False,'interdepartmental':False,'critical_patient':False,'create_token':token,**overrides}
    def edit(item,**overrides):
        return {'id':item['id'],'version':item['version'],'ambulance_id':item['ambulance']['id'],'driver_id':item['crew']['driver']['id'],'companion_id':item['crew'].get('companion',{}).get('id'),'patient_id':item['patient']['id'] if item['patient'] else None,'origin_facility_id':item['origin']['id'],'destination_facility_id':item['destination']['id'],'scheduled_at':datetime.fromisoformat(item['scheduled_at'].replace('Z','+00:00')).astimezone(timezone(timedelta(hours=-3))).isoformat(),'cargo_type':item['cargo_type'],'priority':item['priority'],'reason':item['reason'],'notes':item['notes'],**{key:item[key] for key in ['special_equipment','with_family','interdepartmental','critical_patient']},**overrides}
    check(Client().call('/api/v1/tracking/snapshot.php')[0]==401,'tracking requires a live approved session')
    check(Client().call('/api/v1/transfers/list.php','POST',{})[0] in [401,403],'transfer list requires authentication and CSRF')
    check(call(unrelated,'catalogs')[0]==403 and call(admin,'catalogs')[0]==403 and call(records,'catalogs')[0]==403,'staff, admin and records roles do not implicitly gain dispatch catalogs')
    check(first.call('/api/v1/transfers/list.php','POST',{},csrf=False)[0]==403,'private transfer searches require CSRF')
    check(first.call('/api/v1/transfers/list.php')[0]==405,'transfer searches keep names out of GET URLs')
    check(listing(unrelated)['data']==[],'unassigned staff see no placeholder or other transfers')
    check(call(first,'patients',{'q':national})[1]['data'][0]['id']==patient,'patient selector reuses the canonical hospital catalog')
    check(call(unrelated,'patients',{'q':national})[0]==403,'transfer patient lookups require dispatch permission')
    check(call(first,'patients',{'q':'x'})[1]['data']==[],'patient suggestions require at least two characters')
    base=fields()
    check(first.call('/api/v1/transfers/create.php','POST',base,csrf=False)[0]==403,'creation requires CSRF')
    check(call(unrelated,'create',base)[0]==403,'staff cannot create transfers or self-assign access')
    for changes,label in [({'created_by':uid},'client actor fields are rejected'),({'patient_id':None},'patient cargo requires a managed patient'),({'patient_id':'99999999'},'nonexistent patients are rejected'),({'driver_id':copilot},'a copilot responsibility cannot substitute for a driver'),({'companion_id':staffid},'the same staff member cannot fill both duties'),({'destination_facility_id':route['origin_facility_id']},'endpoints must differ'),({'scheduled_at':'2026-02-30T09:00:00-03:00'},'invalid calendar dates are rejected'),({'scheduled_at':'2026-10-13T09:00:00Z'},'ambiguous or wrong-zone schedules are rejected'),({'special_equipment':'yes'},'options require JSON booleans')]:
        check(call(first,'create',{**base,**changes})[0]==422,label)
    s,p,_=call(first,'create',base);check(s==201,'a valid patient transfer commits successfully');item=p['data'];id=item['id']
    check(item['patient']['id']==patient and item['notes']==base['notes'] and item['status']=='scheduled','patient relationship and multiline metadata persist')
    check(item['position']['progress']==0 and item['position']['source']=='simulated','a new transfer has a persisted synthetic origin position')
    check(item['events'][0]['event_type']=='created' and len(sql('SELECT * FROM resource_reservations WHERE transfer_id='+id))==2,'creation writes activity and both resource reservations')
    check(call(first,'create',base)[1]['data']['id']==id,'identical creation retries return the same transfer')
    check(call(first,'create',{**base,'notes':'Different retry'})[0]==409,'retry keys cannot be reused for different data')
    check(call(assigned,'get?id='+id)[0]==200 and listing(assigned)['meta']['total']==1,'assigned staff can read their transfer and scoped count')
    check(call(unrelated,'get?id='+id)[0]==404 and call(records,'get?id='+id)[0]==404 and call(admin,'get?id='+id)[0]==404,'unrelated roles cannot retrieve transfer details by guessing IDs')
    snap=assigned.call('/api/v1/tracking/snapshot.php')[1]['data']
    check([x['id'] for x in snap['transfers']]==[id] and 'patient' not in snap['transfers'][0] and 'crew' not in snap['transfers'][0] and 'notes' not in snap['transfers'][0],'fleet snapshots are scoped and omit patient, crew and notes')
    check(unrelated.call('/api/v1/tracking/history.php?transfer_id='+id)[0]==404,'position history uses identical assignment permissions')
    check(assigned.call('/api/v1/tracking/history.php?transfer_id='+id)[0]==200,'assigned crew can retrieve position history')
    check(call(first,'create',fields(driver=crew[0]))[0]==409,'overlapping reservations reject a competing vehicle assignment')
    check(call(first,'create',fields(vehicle=1))[0]==409,'overlapping reservations reject a competing crew assignment')
    other=fields(vehicle=1,driver=crew[0]);s,p,_=call(second,'create',other);check(s==201,'independent resources can be scheduled concurrently');other_item=p['data']
    check(call(first,'update',edit(other_item,ambulance_id=vehicles[0]['id']))[0]==409,'reassignment rechecks overlapping vehicle reservations')
    updated=call(first,'update',edit(item,notes='Editado de forma persistente'))[1]['data'];check(updated['version']==2 and get(second,id)['notes']==updated['notes'],'metadata edits persist across independent dispatch sessions')
    check(call(first,'update',edit(item,notes='Stale'))[0]==409,'stale revisions cannot overwrite committed transfer edits')
    with ThreadPoolExecutor(2) as pool:responses=list(pool.map(lambda c:call(c,'update',edit(updated,priority='high')),[first,second]))
    check(sorted(r[0] for r in responses)==[200,409],'concurrent edits serialize with exactly one successful writer')
    current=get(first,id);old_geometry=current['geometry'];old_origin=current['origin']['name']
    sql('UPDATE route_templates SET geometry=geometry,duration_seconds=duration_seconds+10 WHERE id='+current['route_template_id'])
    sql("UPDATE facilities SET name='Centro renombrado de prueba' WHERE id="+current['origin']['id'])
    check(get(first,id)['geometry']==old_geometry and get(first,id)['origin']['name']==old_origin,'historical route geometry and endpoint names remain snapshots')
    sql('UPDATE patients SET status=\'archived\' WHERE id='+patient)
    check(call(first,'update',edit(current,notes='Preservar relación histórica'))[0]==200,'existing archived patient associations can be retained on metadata edits')
    check(call(first,'create',fields(vehicle=2,driver=crew[1]))[0]==422,'archived patients cannot be newly assigned')
    check(status(first,get(first,id),'in_progress')[0]==422,'starting rechecks patient operational eligibility')
    sql('UPDATE patients SET status=\'active\' WHERE id='+patient)
    sql("UPDATE facilities SET name='"+old_origin+"' WHERE id="+current['origin']['id'])
    # Release the second transfer and test nonpatient cargo without clinical data.
    cancelled=status(first,get(first,other_item['id']),'cancelled')[1]['data']
    check(cancelled['status']=='cancelled' and not sql('SELECT * FROM resource_reservations WHERE transfer_id='+cancelled['id']),'cancellation atomically releases reservations')
    check(status(first,cancelled,'in_progress')[0]==409 and call(first,'update',edit(cancelled))[0]==409,'terminal transfers cannot restart or change casually')
    equipment=fields(vehicle=2,driver=crew[1],cargo_type='equipment',patient_id=None,companion_id=copilot)
    check(call(first,'create',{**equipment,'with_family':True})[0]==422,'patient-only flags cannot be applied to equipment cargo')
    s,p,_=call(first,'create',equipment);check(s==201 and p['data']['patient'] is None,'equipment transfers do not invent a patient');equipment_item=p['data']
    check(status(first,equipment_item,'completed')[0]==409,'scheduled transfers cannot skip lifecycle states')
    # Draft revisions persist across tabs, remain private, and survive failed creation.
    draft=call(first,'draft')[1]['data'];d=call(first,'draft',{'version':draft['version'],'payload':{'notes':'Borrador privado','transferType':'equipment'}})[1]['data']
    check(call(first,'draft')[1]['data']['payload']['notes']=='Borrador privado' and call(second,'draft')[1]['data']['payload']=={},'server drafts persist and are private to their account')
    check(call(first,'draft',{'version':draft['version'],'payload':{}})[0]==409,'stale draft writes do not erase another tab')
    cleared=call(first,'draft',{'version':d['version'],'clear':True})[1]['data'];check(cleared['version']>d['version'] and cleared['payload']=={},'draft clearing retains a monotonic revision')
    check(call(first,'draft',{'version':d['version'],'payload':{'notes':'Old'}})[0]==409,'old drafts cannot overwrite a cleared revision')
    check(call(first,'list',{'sort':'DROP TABLE'})[0]==422 and call(first,'list',{'page_size':101})[0]==422,'SQL sorts and page sizes are allowlisted and bounded')
    check(listing(first,state='all',type='equipment')['meta']['total']==1 and listing(first,q='%')['data']==[],'real SQL type filtering and literal wildcard search work')
    # Two simultaneous creations for the same resources have one winner.
    free=fields(vehicle=1,driver=crew[0],offset=7200)
    with ThreadPoolExecutor(2) as pool:responses=list(pool.map(lambda c:call(c,'create',{**free,'create_token':secrets.token_hex(32)}),[first,second]))
    check(sorted(r[0] for r in responses)==[201,409],'simultaneous dispatchers cannot double-book the same resources')
    trigger='transfer_fault_'+SUFFIX;before=sql('SELECT COUNT(*) AS n FROM transfers')[0]['n']
    admin_sql(f"CREATE TRIGGER {trigger} BEFORE INSERT ON resource_reservations FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='Disposable assignment failure'")
    try:check(call(first,'create',fields(vehicle=1,driver=crew[0],offset=10800))[0]==503 and sql('SELECT COUNT(*) AS n FROM transfers')[0]['n']==before,'reservation SQL failures roll back transfer creation')
    finally:admin_sql('DROP TRIGGER '+trigger)
    started=status(first,get(first,id),'in_progress')[1]['data'];check(started['status']=='in_progress' and started['started_at'] is not None,'starting records the actual server start time')
    check(call(first,'update',edit(started))[0]==409,'active transfer assignments cannot be rewritten mid-route')
    check(first.call('/api/v1/tracking/control.php')[0]==403,'dispatchers cannot control the administrator simulation')
    sim=admin.call('/api/v1/tracking/control.php')[1]['data']
    check(admin.call('/api/v1/tracking/control.php','POST',{'command':'start','version':sim['version']},csrf=False)[0]==403,'simulation changes require CSRF')
    sim=admin.call('/api/v1/tracking/control.php','POST',{'command':'start','version':sim['version'],'speed':100})[1]['data'];check(sim['status']=='running','administrator explicitly starts the shared synthetic clock')
    worker=subprocess.Popen([PHP,'backend/php/cli/simulate-transfers.php','worker','45'],cwd=ROOT,env=os.environ,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True)
    try:
        deadline=time.monotonic()+8
        while time.monotonic()<deadline:
            snapshot=first.call('/api/v1/tracking/snapshot.php?transfer_id='+id)[1]['data']
            if snapshot['simulation']['heartbeat_at']:break
            time.sleep(.2)
        check(snapshot['simulation']['heartbeat_at'] is not None,'the worker persists a shared heartbeat')
        check(cli('backend/php/cli/simulate-transfers.php','worker','1').returncode!=0,'a second worker cannot own the same database')
        sim=admin.call('/api/v1/tracking/control.php','POST',{'command':'pause','version':sim['version']})[1]['data'];before=get(first,id)['position'];time.sleep(3.2)
        check(get(first,id)['position']['id']==before['id'],'paused simulation updates heartbeat without moving vehicles')
        reset=admin.call('/api/v1/tracking/control.php','POST',{'command':'reset','version':sim['version']})[1]['data'];check(reset['generation']==sim['generation']+1 and get(first,id)['position']['progress']==0,'reset creates a new simulation generation at the route origin')
        check(admin.call('/api/v1/tracking/control.php','POST',{'command':'resume','version':sim['version']})[0]==409,'stale simulation controls cannot overwrite newer state')
        sim=admin.call('/api/v1/tracking/control.php','POST',{'command':'resume','version':reset['version']})[1]['data']
        deadline=time.monotonic()+15
        while time.monotonic()<deadline:
            current=get(first,id)
            if current['status']=='arrived':break
            time.sleep(.4)
        check(current['status']=='arrived' and current['position']['progress']==1,'worker reaches the destination and records arrival atomically')
        one=first.call('/api/v1/tracking/snapshot.php?transfer_id='+id)[1]['data']['transfers'][0]['position'];two=assigned.call('/api/v1/tracking/snapshot.php?transfer_id='+id)[1]['data']['transfers'][0]['position']
        check(one==two,'independent staff sessions observe the same stored position and timestamp')
        history=assigned.call('/api/v1/tracking/history.php?transfer_id='+id+'&limit=1')[1]['data'];check(len(history['positions'])==1 and history['next_cursor'] is not None,'position history is cursor-paginated')
        check(len(sql('SELECT * FROM resource_reservations WHERE transfer_id='+id))==2,'arrival retains vehicle and crew reservations until completion')
        completed=status(first,current,'completed')[1]['data'];check(completed['finished_at'] is not None and not sql('SELECT * FROM resource_reservations WHERE transfer_id='+id),'completion releases resources and records its event')
        check(status(first,completed,'in_progress')[0]==409,'completed transfers cannot be restarted')
    finally:
        worker.terminate();worker.communicate(timeout=10)
    sql("UPDATE simulation_runs SET heartbeat_at=UTC_TIMESTAMP()-INTERVAL 20 SECOND WHERE id="+sim['run_id'])
    check(first.call('/api/v1/tracking/snapshot.php')[1]['data']['simulation']['stale'],'a stopped worker is observable as stale rather than fake live motion')
    check(admin.call('/api/v1/tracking/control.php','POST',{'command':'stop','version':sim['version']})[0]==200,'administrator can stop the simulation explicitly')
    history=assigned.call('/api/v1/tracking/history.php?transfer_id='+id)[1]['data']['positions'];old=history[0]['id'];latest=get(first,id)['position']['id']
    sql('UPDATE transfer_positions SET recorded_at=UTC_TIMESTAMP()-INTERVAL 8 DAY WHERE transfer_id='+id)
    assert cli('-r',r'require "backend/php/autoload.php";$c=Hospital\Config::load();(new Hospital\Modules\Transfers\TrackingService(Hospital\Database::connect($c),$c))->prune();').returncode==0
    check(not sql('SELECT id FROM transfer_positions WHERE id='+old) and sql('SELECT id FROM transfer_positions WHERE id='+latest),'history retention removes old samples while preserving latest pointers')
    check(sql("SELECT id FROM audit_events WHERE resource_type='transfer' AND resource_id="+id) and get(first,id)['events'][-1]['to_status']=='completed','transfer actions and final activity are audited by IDs')
    assert admin.call('/api/v1/admin/users/disable.php','POST',{'user_id':assigned_uid})[0]==200
    check(assigned.call('/api/v1/tracking/snapshot.php')[0]==401,'account revocation also revokes assigned fleet access')
    print(f'Completed {checks} transfer and tracking checks.',flush=True)
if __name__=='__main__':main()
