/* Real local PHP/SQL recovery flow with the CLI-only offline email transport. */
'use strict';
const assert=require('assert'),fs=require('fs'),path=require('path'),{spawnSync}=require('child_process'),{chromium}=require('playwright');
const root=path.resolve(__dirname,'..'),runtime=path.join(__dirname,'.runtime/password-recovery');
const fixture=JSON.parse(fs.readFileSync(path.join(runtime,'browser.json')));
Object.assign(process.env,fixture.env);
assert(/^hospital_recovery_[a-f0-9]{8}_test$/.test(process.env.HOSPITAL_DB_NAME));
const php=process.env.HOSPITAL_TEST_PHP||'/Applications/XAMPP/xamppfiles/bin/php';
const check=(v,s)=>{assert(v,s);checks++;console.log('PASS',s)};let checks=0;
function clearLimits(){const p=spawnSync(php,['-r','require "backend/php/autoload.php";Hospital\\Database::connect(Hospital\\Config::load())->exec("DELETE FROM auth_rate_limits");'],{cwd:root,env:process.env,encoding:'utf8'});assert.strictEqual(p.status,0)}
function mint(base,locale){
 clearLimits();const url=new URL(base),p=spawnSync(php,['backend/php/tests/password-recovery.php'],{cwd:root,env:{...process.env,HOSPITAL_APP_URL:base+'/',HOSPITAL_BASE_PATH:url.pathname==='/'?'':url.pathname},input:JSON.stringify({action:'request',email:'active@hospital.example',locale}),encoding:'utf8'});
 assert.strictEqual(p.status,0);const response=JSON.parse(p.stdout);assert.strictEqual(response.status,200);return response.mails[0].textContent.match(/#token=([a-f0-9]{64})/)[1];
}
const ready=p=>p.evaluate(()=>HospitalI18n.ready);
(async()=>{
 const browser=await chromium.launch({channel:'chrome',headless:true});
 try {
  for(const base of ['http://127.0.0.1:8881','http://127.0.0.1:8882/hospital'])for(const locale of ['es-UY','en'])for(const theme of ['dark','light'])for(const viewport of [{width:1440,height:900},{width:390,height:844}]){
   clearLimits();const c=await browser.newContext({viewport}),p=await c.newPage(),errors=[],dialogs=[];
   p.on('pageerror',e=>errors.push(e.message));p.on('dialog',async d=>{dialogs.push(d.type());await d.dismiss()});
   const label=`${base.includes('/hospital')?'mounted':'root'} ${locale} ${theme} ${viewport.width}`;
   const pathname=base+'/src/views/register-restore/restore-password.html'+(locale==='en'?'?lang=en':'');
   await p.goto(pathname);await ready(p);await p.locator(`[data-public-theme=${theme}]`).click();
   check(await p.locator('#recovery-request-form').isVisible()&&!await p.locator('#recovery-password-form').isVisible(),label+' request mode');
   const email=p.locator('#recovery-email');await email.fill('unknown@hospital.example');
   const endpoint='**/api/v1/auth/reset-request.php';
   await p.route(endpoint,r=>r.fulfill({status:503,contentType:'application/json',body:JSON.stringify({success:false,error:{code:'RECOVERY_UNAVAILABLE',message:'Offline sender fixture'}})}));
   let response=p.waitForResponse(r=>r.url().endsWith('/reset-request.php'));await p.locator('#recovery-request-form button').click();await response;await p.waitForFunction(()=>!document.querySelector('#recovery-request-form button').disabled);
   check(await email.inputValue()==='unknown@hospital.example'&&!await p.locator('#recovery-status').isVisible(),label+' failure preserves input without inline errors');
   await p.unroute(endpoint);response=p.waitForResponse(r=>r.url().endsWith('/reset-request.php'));await p.locator('#recovery-request-form button').click();await response;await p.locator('#recovery-status').waitFor();
   check((await p.locator('#recovery-status').textContent()).includes(locale==='en'?'eligible account':'cuenta habilitada'),label+' localized neutral confirmation');
   const raw=mint(base,locale);await p.goto(pathname+'#token='+raw);await ready(p);await p.locator('#recovery-password-form').waitFor();
   check(await p.locator('#recovery-password-form').isVisible()&&!await p.locator('#recovery-request-form').isVisible()&&await p.locator('html').getAttribute('data-theme')===theme,label+' reset mode retains appearance');
   const password=p.locator('#recovery-password'),confirmation=p.locator('#recovery-confirmation');
   await password.fill(fixture.password);await confirmation.fill('different fictional password');
   let submits=0;p.on('request',r=>{if(r.url().endsWith('/reset-password.php'))submits++});
   await p.locator('#recovery-password-form button').click();await p.waitForTimeout(50);
   check(submits===0&&await password.inputValue()===fixture.password&&await confirmation.inputValue()==='different fictional password',label+' mismatch preserves both inputs without submitting');
   await confirmation.fill(fixture.password);
   await p.evaluate(()=>HospitalI18n.setPublicLocale(HospitalI18n.locale==='en'?'es-UY':'en'));
   await p.evaluate(locale=>HospitalI18n.setPublicLocale(locale),locale);
   await p.locator(`[data-public-theme=${theme==='dark'?'light':'dark'}]`).click();await p.locator(`[data-public-theme=${theme}]`).click();
   check(await password.inputValue()===fixture.password&&await p.evaluate(()=>location.hash)==='#token='+raw,label+' language/theme switching retains password and token');
   if(viewport.width===1440&&base.endsWith('8881'))await p.screenshot({path:path.join(runtime,`reset-${locale}-${theme}.png`)});
   response=p.waitForResponse(r=>r.url().endsWith('/reset-password.php'));await p.locator('#recovery-password-form button').click();const res=await response;assert.strictEqual(res.status(),200);await p.waitForURL('**/index.html*');await ready(p);
   check(await p.evaluate(()=>location.hash)===''&&new URL(p.url()).searchParams.get('lang')===(locale==='en'?'en':null),label+' real reset returns to localized login without token');
   check(!errors.length&&!dialogs.length,label+' no script errors or dialogs');
   await c.close();
  }
  const c=await browser.newContext(),p=await c.newPage();clearLimits();await p.goto('http://127.0.0.1:8881/src/views/register-restore/restore-password.html#token='+'a'.repeat(64));await ready(p);
  await p.locator('#recovery-password').fill(fixture.password);await p.locator('#recovery-confirmation').fill(fixture.password);
  const res=p.waitForResponse(r=>r.url().endsWith('/reset-password.php'));await p.locator('#recovery-password-form button').click();assert.strictEqual((await res).status(),422);await p.waitForFunction(()=>!document.querySelector('#recovery-password-form button').disabled);
  check(await p.locator('#recovery-password').inputValue()===fixture.password&&!await p.locator('#recovery-status').isVisible(),'invalid token preserves password fields and reports only in console');
  await p.goto('http://127.0.0.1:8881/');await ready(p);await p.evaluate(async password=>HospitalApi.post('auth/login.php',{username:'active_fixture',password}),fixture.password);
  await p.goto('http://127.0.0.1:8881/src/views/register-restore/restore-password.html');await ready(p);
  check(await p.locator('#recovery-request-form').isVisible()&&p.url().includes('restore-password.html'),'signed-in visitors can use recovery without a dashboard redirect');await c.close();
  console.log('TOTAL',checks,'focused recovery browser checks');
 } finally {await browser.close()}
})().catch(error=>{console.error(error);process.exitCode=1});
