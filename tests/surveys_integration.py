"""Focused survey flows. Requires only a dedicated disposable *_test database."""
import copy,json,os,secrets,subprocess
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime,timedelta
from auth_integration import Client,PASSWORD,ADMIN_PASSWORD,SUFFIX,PHP,ROOT,check,sql


def item(key,kind,**fields):
    return dict(id=key,type=kind,title='Pregunta '+key,required=True,options=['Primera','Segunda'],other=False,description='',placeholder='',scale_min=0,scale_max=10,scale_start='Inicio',scale_end='Fin',rating_max=5,**fields)


def record():
    items=[item('intro','section'),item('short','short_text'),item('long','long_text'),item('single','single_choice'),item('multi','multiple_choice'),item('rating','rating'),item('scale','linear_scale'),item('date','date'),item('line','divider')]
    items[2]['required']=False;items[3]['other']=True;items[4]['other']=True
    return dict(title='Encuesta de prueba',description='DESCRIPCIÓN INTERNA PRIVADA',category='patient_care',area='Servicio ficticio',notes='NOTAS INTERNAS PRIVADAS',form_title='Tu experiencia de prueba',form_description='Introducción pública.',color='cyan',items=items,config=dict(audience='patients',access='shared_link',identity='optional_name',limit_enabled=False,response_limit=100,opens_enabled=False,opens_at='',closes_enabled=False,closes_at='',completion_message='Gracias por responder.'))


def run():
    owner=Client();username='survey_'+SUFFIX;owner.csrf()
    status,payload,_=owner.call('/api/v1/auth/register.php','POST',dict(username=username,email=username+'@hospital.example',national_id=str(90000000+secrets.randbelow(9999999)),password=PASSWORD));assert status==201,payload
    subprocess.run([PHP,'backend/php/cli/users.php','approve',username,'staff'],cwd=ROOT,check=True,capture_output=True)
    assert owner.login(username,PASSWORD)[0]==200
    other=Client();other.csrf();second='survey_other_'+SUFFIX
    assert other.call('/api/v1/auth/register.php','POST',dict(username=second,email=second+'@hospital.example',national_id=str(90000000+secrets.randbelow(9999999)),password=PASSWORD))[0]==201
    subprocess.run([PHP,'backend/php/cli/users.php','approve',second,'staff'],cwd=ROOT,check=True,capture_output=True)
    assert other.login(second,PASSWORD)[0]==200
    admin=Client();assert admin.login('system_admin',ADMIN_PASSWORD)[0]==200
    def call(action,body=None,client=owner):return client.call('/api/v1/surveys/'+action,'POST' if body is not None else 'GET',body)
    check(Client().call('/src/views/surveys/user-view/survey-user.html')[0]==200 and Client().call('/src/views/surveys/survey.html')[0]==303,'only isolated patient HTML is anonymously accessible')
    check(call('list.php',client=Client())[0]==401,'staff survey endpoints require a live session')
    check(call('list.php')[1]['data']==[],'survey directory starts empty without seeded records')
    body=record();check(owner.call('/api/v1/surveys/create.php','POST',body,csrf=False)[0]==403,'staff mutations require CSRF')
    status,payload,_=call('create.php',body);assert status==201,payload;s=payload['data'];sid=s['id']
    check(len(s['questions'])==9 and s['form_title']==body['form_title'] and s['response_count']==0 and s['config']['identity']=='optional_name','all editor fields, types and separate public/internal text persist')
    check(call('get.php?id='+sid,client=other)[0]==404 and call('list.php',client=other)[1]['data']==[] and call('get.php?id='+sid,client=admin)[0]==200,'owners are scoped and administrators can read all surveys')
    edit={**body,'id':sid,'version':s['version'],'notes':'Nuevo texto interno'}
    status,payload,_=call('update.php',edit);assert status==200,payload;s=payload['data']
    check(call('update.php',edit)[0]==409,'stale survey edits are rejected')
    invalid=copy.deepcopy(body);invalid['items'][4]['id']='single';check(call('create.php',invalid)[0]==422,'duplicate question keys are rejected')
    check(call('create.php',{**body,'owner_id':s['owner_id']})[0]==422,'client cannot select an owner')
    draft=copy.deepcopy(body);draft['items'][1]['title']='';status,payload,_=call('create.php',draft);assert status==201,payload;d=payload['data']
    check(call('transition.php',dict(id=d['id'],version=d['version'],action='publish'))[0]==422,'partial drafts save but incomplete forms cannot publish')
    status,payload,_=call('transition.php',dict(id=sid,version=s['version'],action='publish'));assert status==200,payload;s=payload['data']
    links=call('links.php?id='+sid)[1]['data'];token=links[0]['token']
    check(len(links)==1 and len(token)==64 and not links[0]['single_use'],'publication creates a retrievable opaque shared link')
    check(call('links.php?id='+sid,client=other)[0]==404,'access links are visible only to authorized staff')
    patient=Client();status,payload,_=call('public/get.php',dict(token=token),patient);assert status==200,payload;public=payload['data']
    check(public['title']==body['form_title'] and all(secret not in json.dumps(public) for secret in ['DESCRIPCIÓN INTERNA','NOTAS INTERNAS','owner_name','owner_id','participant_name']) and 'results' not in public,'public payload has participant fields only')
    frozen={**body,'notes':'Corrección interna','id':sid,'version':s['version']};status,payload,_=call('update.php',frozen);assert status==200,payload;s=payload['data']
    altered=copy.deepcopy(frozen);altered['version']=s['version'];altered['items'][1]['title']='Otra pregunta'
    check(call('update.php',altered)[0]==409,'published structure cannot rewrite historical answer meanings')
    answers=[dict(question_id='short',value='Respuesta corta <script>'),dict(question_id='single',value='other',other_text='Otra opción'),dict(question_id='multi',value=['0','other'],other_text='Alternativa'),dict(question_id='rating',value=4),dict(question_id='scale',value=0),dict(question_id='date',value='2026-10-15')]
    submission=dict(token=token,version=public['version'],submit_token=public['submit_token'],answers=answers,participant_name='Nombre voluntario')
    check(s['version']>public['version'],'internal metadata edits advance only the staff editing precondition')
    check(call('public/submit.php',{**submission,'version':s['version']},patient)[1]['error']['code']=='INVALID_SUBMISSION','signed public snapshot versions cannot be substituted')
    check(patient.call('/api/v1/surveys/public/submit.php','POST',submission,csrf=False)[0]==403,'patient submission requires its own form CSRF token')
    check(call('public/submit.php',{**submission,'answers':answers[1:]},patient)[0]==422,'required questions are checked server-side')
    check(call('public/submit.php',{**submission,'answers':answers+[answers[0]]},patient)[0]==422,'duplicate answers cannot inflate counts')
    invalid_answers=copy.deepcopy(answers);invalid_answers[-1]['value']='2026-02-30'
    check(call('public/submit.php',{**submission,'answers':invalid_answers},patient)[0]==422,'dates are validated as calendar dates')
    invalid_answers=copy.deepcopy(answers);invalid_answers[4]['value']=11
    check(call('public/submit.php',{**submission,'answers':invalid_answers},patient)[0]==422,'rating and scale ranges are enforced')
    invalid_answers=copy.deepcopy(answers);invalid_answers[2]['value']=['0','0']
    check(call('public/submit.php',{**submission,'answers':invalid_answers},patient)[0]==422,'repeated checkbox choices are rejected')
    status,payload,_=call('public/submit.php',submission,patient);assert status==201,payload
    check(payload['data']['accepted'] and payload['data']['completion_message']==body['config']['completion_message'],'an open patient response commits after internal metadata edits without refreshing or discarding answers')
    check(call('public/submit.php',submission,patient)[1]['data']['replayed'],'identical retries are idempotent')
    changed=copy.deepcopy(submission);changed['answers'][0]['value']='Modificado'
    check(call('public/submit.php',changed,patient)[0]==409,'retry tokens cannot replace an already submitted response')
    s=call('get.php?id='+sid)[1]['data'];r=s['results']
    check(s['response_count']==1 and r['long']['answer_count']==0 and r['long']['skipped_count']==1 and r['multi']['answer_count']==1 and s['average_rating']==4 and s['activity'][0]['count']==1,'SQL results, optional skips, rating and local-date activity are accurate')
    entries=call('answers.php?id='+sid+'&question_id=short')[1]['data'];other_entries=call('answers.php?id='+sid+'&question_id=multi')[1]['data']
    check(entries[0]['value']=='Respuesta corta <script>' and entries[0]['participant_name']=='Nombre voluntario' and other_entries[0]['value']=='Alternativa','authorized written/Other results include voluntary name without patient linkage')
    check(call('answers.php?id='+sid+'&question_id=short',client=other)[0]==404,'written answer searches preserve owner scope')
    pending=call('public/get.php',dict(token=token),patient)[1]['data'];pending_submission={**submission,'version':pending['version'],'submit_token':pending['submit_token']}
    status,payload,_=call('link-update.php',dict(id=sid,version=s['version'],link_id=links[0]['id']));assert status==200,payload;s=payload['data']['survey'];new_token=payload['data']['links'][0]['token']
    check(call('public/get.php',dict(token=token),patient)[0]==404 and new_token!=token,'revoking shared link rotates it without deleting responses')
    check(call('public/submit.php',pending_submission,patient)[0]==404,'revocation rejects previously issued unsent credentials')
    pending=call('public/get.php',dict(token=new_token),patient)[1]['data'];pending_submission={**submission,'token':new_token,'version':pending['version'],'submit_token':pending['submit_token']}
    status,payload,_=call('transition.php',dict(id=sid,version=s['version'],action='close'));assert status==200,payload;s=payload['data']
    check(call('public/get.php',dict(token=new_token),patient)[0]==409,'closed surveys reject public access')
    check(call('public/submit.php',pending_submission,patient)[0]==409,'closing rejects previously issued unsent credentials')
    s=call('transition.php',dict(id=sid,version=s['version'],action='reopen'))[1]['data']
    s=call('transition.php',dict(id=sid,version=s['version'],action='archive'))[1]['data']
    check(call('public/get.php',dict(token=new_token),patient)[0]==404 and call('get.php?id='+sid)[1]['data']['response_count']==1,'archive blocks public access while preserving all results')
    check(call('public/submit.php',pending_submission,patient)[0]==404,'archiving rejects previously issued unsent credentials')
    s=call('transition.php',dict(id=sid,version=s['version'],action='restore'))[1]['data']
    check(call('public/get.php',dict(token=new_token),patient)[0]==200,'restoration returns the original form/link')
    def publish(data):
        status,payload,_=call('create.php',data);assert status==201,payload;obj=payload['data'];status,payload,_=call('transition.php',dict(id=obj['id'],version=obj['version'],action='publish'));assert status==200,payload;return payload['data']
    simple=record();simple['items']=[item('rating','rating')];simple['config']['identity']='anonymous';simple['config']['access']='individual_link'
    single=publish(simple);status,payload,_=call('link-update.php',dict(id=single['id'],version=single['version']));assert status==200,payload;single=payload['data']['survey'];individual=payload['data']['links'][0]['token']
    people=[Client(),Client()];forms=[call('public/get.php',dict(token=individual),p)[1]['data'] for p in people]
    status,payload,_=call('link-update.php',dict(id=single['id'],version=single['version']));assert status==200,payload;single=payload['data']['survey']
    check(single['version']>forms[0]['version'],'creating another invitation changes the admin revision after patient access')
    requests=[dict(token=individual,version=f['version'],submit_token=f['submit_token'],answers=[dict(question_id='rating',value=5)],participant_name='') for f in forms]
    with ThreadPoolExecutor(2) as pool:codes=list(pool.map(lambda n:call('public/submit.php',requests[n],people[n])[0],range(2)))
    check(sorted(codes)==[201,409] and call('get.php?id='+single['id'])[1]['data']['response_count']==1,'open single-use invitations survive another invitation creation and still serialize concurrent responses')
    check(call('public/get.php',dict(token=individual),Client())[0]==409,'consumed invitations cannot be reopened')
    cap=copy.deepcopy(simple);cap['config'].update(access='shared_link',limit_enabled=True,response_limit=1);capped=publish(cap);ct=call('links.php?id='+capped['id'])[1]['data'][0]['token']
    people=[Client(),Client()];forms=[call('public/get.php',dict(token=ct),p)[1]['data'] for p in people]
    requests=[dict(token=ct,version=f['version'],submit_token=f['submit_token'],answers=[dict(question_id='rating',value=3)],participant_name='') for f in forms]
    check(call('public/submit.php',{**requests[0],'participant_name':'No permitido'},people[0])[0]==422,'anonymous forms reject submitted identifying names')
    with ThreadPoolExecutor(2) as pool:codes=list(pool.map(lambda n:call('public/submit.php',requests[n],people[n])[0],range(2)))
    check(sorted(codes)==[201,409] and call('get.php?id='+capped['id'])[1]['data']['status']=='closed','response caps are atomic and reflected in staff status')
    timed=copy.deepcopy(simple);timed['config'].update(access='shared_link',opens_enabled=True,opens_at='2099-01-01T10:00');scheduled=publish(timed);st=call('links.php?id='+scheduled['id'])[1]['data'][0]['token']
    check(call('public/get.php',dict(token=st),Client())[0]==409,'future opening dates are enforced without a scheduled worker')
    sql("UPDATE surveys SET opens_at=NULL,closes_at=DATE_SUB(UTC_TIMESTAMP(),INTERVAL 1 MINUTE) WHERE id="+scheduled['id'])
    check(call('public/get.php',dict(token=st),Client())[0]==409,'expired closing dates are enforced at access time')
    sql('UPDATE surveys SET closes_at=NULL WHERE id='+scheduled['id']);timed_patient=Client();opened=call('public/get.php',dict(token=st),timed_patient)[1]['data']
    timed_submission=dict(token=st,version=opened['version'],submit_token=opened['submit_token'],answers=[dict(question_id='rating',value=5)],participant_name='')
    sql("UPDATE surveys SET closes_at=DATE_SUB(UTC_TIMESTAMP(),INTERVAL 1 MINUTE),version=version+1 WHERE id="+scheduled['id'])
    check(call('public/submit.php',timed_submission,timed_patient)[0]==409,'current deadlines still reject open responses with older signed versions')
    sql("UPDATE surveys SET closes_at=NULL,opens_at='2099-01-01 13:00:00',version=version+1 WHERE id="+scheduled['id'])
    check(call('public/submit.php',timed_submission,timed_patient)[0]==409,'a postponed opening still rejects previously issued credentials')
    staff=copy.deepcopy(simple);staff['config'].update(access='shared_link',audience='staff');staff_survey=publish(staff);staff_token=call('links.php?id='+staff_survey['id'])[1]['data'][0]['token']
    check(call('public/get.php',dict(token=staff_token),Client())[0]==401 and call('public/get.php',dict(token=staff_token),owner)[0]==200,'staff-only audience requires an approved live staff session')
    bad=call('public/get.php',dict(token='a'*64),Client());check(bad[0]==404,'unknown capability tokens return generic missing-record responses')
    check(sql('SELECT COUNT(*) AS n FROM schema_migrations WHERE version=\'011_surveys\'')[0]['n']==1,'numbered survey migration is recorded on the actual MariaDB runtime')
    directory=call('list.php?archived=1')[1]['data'];check(directory==[],'restored records do not leak into the archived-only directory')
    private=Path(os.environ['HOSPITAL_SURVEY_TEST_DIR']);browser=private/'browser.json';browser.write_text(json.dumps(dict(username=username,password=PASSWORD,survey_id=sid,token=new_token,admin_password=ADMIN_PASSWORD)));browser.chmod(0o600)
    print('Survey integration checks completed.')


if __name__=='__main__':run()
