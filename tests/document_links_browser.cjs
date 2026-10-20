/* Real SQL-backed QR creation and anonymous browser file access. */
'use strict';
const fs=require('fs'),path=require('path'),assert=require('assert');
const {chromium}=require('playwright');
const runtime=path.join(__dirname,'.runtime/document-links');
const fixtures=JSON.parse(fs.readFileSync(path.join(runtime,'browser.json')));
let checks=0;
function check(value,label){assert(value,label);checks++;}
async function ready(page){await page.evaluate(async()=>{await HospitalI18n.ready;await HospitalAuth.ready;});await page.locator('#qr-button').waitFor({state:'visible'});await page.waitForFunction(()=>!document.getElementById('qr-button').disabled);}
(async()=>{
 const browser=await chromium.launch({channel:'chrome',headless:true});
 try{
  for(const mount of ['', '/hospital'])for(const theme of ['dark','light'])for(const mobile of [false,true]){
   const base=mount?'http://127.0.0.1:8885/hospital':'http://127.0.0.1:8884';
   const locale=mobile?'en':'es-UY',context=await browser.newContext({viewport:mobile?{width:390,height:844}:{width:1440,height:900},permissions:['clipboard-read','clipboard-write']});
   const page=await context.newPage(),errors=[],dialogs=[];
   page.on('pageerror',e=>errors.push(e.message));page.on('dialog',async d=>{dialogs.push(d.type());await d.dismiss();});
   await page.goto(base+'/');await page.evaluate(async ({username,password,locale,theme})=>{
    await HospitalApi.post('auth/login.php',{username,password});
    const state=await HospitalApi.get('settings/get.php');
    await HospitalApi.post('settings/preferences-update.php',{version:state.settings.version,locale,theme});
   },{...fixtures,locale,theme});
   await page.goto(base+'/src/views/documents/documents-viewer.html?id='+fixtures.pdf.id);await ready(page);
   if(theme==='light'){
    await page.locator('.sidebar-action').click();
    check(await page.locator('.app-shell').evaluate(el=>el.classList.contains('menu-open')),'QR also works with expanded navigation');
   }
   check(await page.evaluate(()=>HospitalI18n.locale===document.documentElement.lang&&(HospitalTheme.current==='dark'||HospitalTheme.current==='light')),'hydrated locale/theme');
   // Observe the input to the real encoder while still drawing its actual modules.
   await page.evaluate(()=>{const original=window.qrcode;window.qrcode=(...args)=>{const result=original(...args),add=result.addData;result.addData=(value,...rest)=>{window.encodedPatientUrl=value;return add.call(result,value,...rest);};return result;};});
   await page.locator('#qr-button').click();await page.locator('#qr-dialog[open]').waitFor();
   const url=await page.locator('#patient-qr-url').inputValue();
   const parsed=new URL(url);
   check(parsed.origin===new URL(base).origin&&parsed.pathname===mount+'/api/v1/documents/public-file.php'&&parsed.searchParams.get('token').length===64,'QR points directly to mounted file endpoint');
   check(await page.evaluate(url=>encodedPatientUrl===url,url),'canvas encodes the exact patient access URL');
   check(await page.evaluate(()=>{const c=document.getElementById('qr-canvas'),a=c.getContext('2d').getImageData(0,0,c.width,c.height).data;let dark=0;for(let i=0;i<a.length;i+=4)if(a[i]<30)dark++;return dark>1000;}),'QR contains real dark modules');
   check(!(await page.locator('#qr-expiry').textContent()).includes('{')&&(await page.locator('#qr-expiry').textContent()).includes('24'),'expiry and selected version rendered');
   await page.locator('#copy-qr-link').click();
   check(await page.evaluate(()=>navigator.clipboard.readText())===url,'copy action copies patient credential rather than staff viewer URL');
   const anonymous=await browser.newContext();
   const response=await anonymous.request.get(url);
   check(response.status()===200&&response.headers()['content-type']==='application/pdf'&&response.headers()['content-disposition'].startsWith('inline;'),'anonymous browser receives inline PDF');
   check((await response.body()).subarray(0,5).toString()==='%PDF-','response contains file bytes and no custom viewer');
   check((await anonymous.request.get(base+'/api/v1/documents/get.php?id='+fixtures.pdf.id)).status()===401,'capability grants no staff API access');
   const dialog=await page.locator('#qr-dialog').evaluate(el=>({width:el.getBoundingClientRect().width,height:el.getBoundingClientRect().height,overflow:getComputedStyle(el).overflowY,scroll:el.scrollHeight,client:el.clientHeight}));
   check(dialog.width<=(mobile?390:1440)&&dialog.height<=(mobile?844:900),'QR dialog fits viewport with native overflow');
   if(!mount)await page.screenshot({path:path.join(runtime,`qr-${theme}-${mobile?'mobile':'desktop'}.png`)});
   if(!mount&&!mobile&&theme==='dark'){
    // Opening the URL is a real native PDF navigation, independent of the staff page.
    const native=await anonymous.newPage();const nativeResponse=await native.goto(url);
    check(nativeResponse.status()===200&&native.url()===url,'patient opens the file directly without a login redirect');
    await native.waitForTimeout(700);await native.screenshot({path:path.join(runtime,'patient-native-pdf.png')});await native.close();
   }
   await page.locator('#revoke-qr-link').click();await page.locator('#qr-dialog').waitFor({state:'hidden'});
   check((await anonymous.request.get(url)).status()===404,'revoke action immediately blocks anonymous retrieval');
   await page.locator('#qr-button').click();await page.locator('#qr-dialog[open]').waitFor();
   const renewed=await page.locator('#patient-qr-url').inputValue();
   check(renewed!==url&&(await anonymous.request.get(renewed)).status()===200,'reopening after revoke produces a different working token');
   await page.locator('#qr-dialog [data-close-dialog]').click();
   // A failed server write reports to the console without a fabricated QR or popup.
   await page.route('**/documents/patient-link.php',route=>route.fulfill({status:409,contentType:'application/json',body:JSON.stringify({success:false,error:{code:'VERSION_CONFLICT',message:'Focused failure fixture'}})}));
   await page.locator('#qr-button').click();await page.waitForFunction(()=>!document.getElementById('qr-button').disabled);
   check(!(await page.locator('#qr-dialog').evaluate(el=>el.open))&&await page.locator('#patient-qr-url').inputValue()==='','failed issuance leaves no misleading QR or link');
   await page.unroute('**/documents/patient-link.php');
   check(errors.length===0&&dialogs.length===0,'no script errors or native dialogs');
   // The staff header geometry is independent of the patient QR dialog.
   if(!mobile)check(await page.locator('.topbar').evaluate(el=>Math.round(el.getBoundingClientRect().height))===100,'desktop header retains 100px geometry');
   await anonymous.close();await context.close();
  }
  // Native image navigation and DOCX download use the same patient access flow.
  const staff=await browser.newContext(),page=await staff.newPage();await page.goto('http://127.0.0.1:8884/');
  await page.evaluate(async f=>HospitalApi.post('auth/login.php',{username:f.username,password:f.password}),fixtures);
  const anon=await browser.newContext();
  for(const ext of ['png','docx']){
   await page.goto('http://127.0.0.1:8884/src/views/documents/documents-viewer.html?id='+fixtures[ext].id);await ready(page);
   await page.locator('#qr-button').click();await page.locator('#qr-dialog[open]').waitFor();
   const url=await page.locator('#patient-qr-url').inputValue(),native=await anon.newPage();
   if(ext==='docx'){
    const event=native.waitForEvent('download');await native.goto(url).catch(error=>{if(!error.message.includes('Download is starting'))throw error;});
    const download=await event;check(download.suggestedFilename()==='patient.docx','DOCX opens as a browser download');await download.delete();
   }else{
    await native.goto(url);check(await native.locator('img').evaluate(el=>el.naturalWidth===20),'PNG opens directly in the native image document');
   }
   await native.close();
  }
  await anon.close();await staff.close();
  console.log('PASS',checks,'focused browser checks across eight root/mount, language, theme and viewport cases');
 }finally{await browser.close();}
})().catch(error=>{console.error(error.name+': '+error.message.replace(/token=[a-f0-9]+/g,'token=[redacted]'));process.exit(1);});
