"use strict";

/* Run with the disposable environment and records prepared by i18n_integration.py --prepare-browser. */
const fs = require('fs'),
  assert = require('assert');
const {
  chromium
} = require('playwright');
(async () => {
  assert((process.env.HOSPITAL_DB_NAME || '').endsWith('_test'), 'Use a disposable *_test environment.');
  const fixture = {
      env: process.env
    },
    r = JSON.parse(fs.readFileSync(process.env.HOSPITAL_I18N_TEST_RECORDS || 'tests/.runtime/i18n-records.json')),
    base = fixture.env.HOSPITAL_AUTH_TEST_URL;
  const browser = await chromium.launch({
      channel: 'chrome',
      headless: true
    }),
    context = await browser.newContext({
      viewport: {
        width: 1440,
        height: 900
      }
    }),
    p = await context.newPage();
  let errors = [];
  let checks = 0;
  const results = [];
  p.on('pageerror', e => errors.push(e.stack));
  function check(value, label) {
    assert(value, label);
    checks++;
    results.push(label);
    console.log('PASS', label);
  }
  async function ready() {
    await p.evaluate(async () => {
      await HospitalI18n.ready;
      if (window.HospitalAuth) await HospitalAuth.ready;
    });
    await p.waitForTimeout(150);
  }
  async function go(file) {
    await p.goto(base + '/src/views/' + file);
    await ready();
    if (file === 'settings.html') await p.locator('#privacy-tab').click();
  }
  await p.goto(base + '/index.html?lang=en');
  await ready();
  await p.evaluate(async password => {
    await HospitalApi.post('auth/login.php', {
      username: 'system_admin',
      password
    });
  }, fixture.env.HOSPITAL_ADMIN_PASSWORD);
  await go('settings.html');
  await p.selectOption('#settings-language', 'en');
  await p.waitForTimeout(250);
  check((await p.locator('h1').innerText()) === 'Settings', 'existing settings selector updates language');
  for (const file of ['documents/documents.html', 'documents/documents-edit.html?id=' + r.document.id, 'documents/documents-viewer.html?id=' + r.document.id, 'management/patients.html', 'management/doctors.html', 'management/personnel.html', 'management/ambulances.html', 'management/destinations.html', 'management/routes.html', 'traces/trace.html', 'traces/trace-view.html?id=' + r.transfer.id, 'traces/trace-map.html?transfer=' + r.transfer.id, 'surveys/survey.html', 'surveys/survey-new.html?id=' + r.survey.id, 'surveys/survey-view.html?id=' + r.survey.id]) {
    errors = [];
    await go(file);
    await p.waitForTimeout(150);
    await p.evaluate(() => {
      HospitalI18n.apply('es-UY');
      HospitalI18n.apply('en');
    });
    await p.waitForTimeout(80);
    check(!errors.length, file + ' populated switching has no script errors: ' + errors.join('\n'));
    check(!(await p.locator('body').innerText()).includes('<img'), file + ' preserves icon markup');
    if (file.includes('documents-viewer')) {
      check((await p.locator('#document-title').innerText()) === r.document.title, 'document title stays original data and HTML is escaped');
      check((await p.locator('#document-kind').innerText()) === 'Administrative Document', 'fixed document category label translated');
    }
    if (file === 'management/patients.html') check((await p.locator('body').innerText()).includes('Inicio Guardar'), 'record words matching interface labels are never translated');
    if (file === 'management/routes.html') {
      check((await p.locator('body').innerText()).includes('Discharge'), 'route discharge uses context-specific translation');
    }
  }
  const forms = [['management/doctors.html', '#doctor-rows [data-action="view"][data-id="' + r.doctor.id + '"]', '#doctor-form'], ['management/personnel.html', '#personnel-rows [data-action="edit"][data-id="' + r.crew.id + '"]', '#personnel-form'], ['management/destinations.html', '#destinations-rows [data-action="edit"][data-id="' + r.destination.id + '"]', '#destinations-form']];
  for (const [file, button, form] of forms) {
    errors = [];
    await go(file);
    await p.locator(button).click();
    if (file === 'management/doctors.html') await p.locator('#edit-from-detail').click();
    await p.locator(form).waitFor({
      state: 'visible'
    });
    await p.waitForFunction(selector => document.querySelector(selector + ' input[type=text]')?.value.length > 0, form);
    const input = p.locator(form + ' input[type=text]').first();
    const value = await input.inputValue();
    await input.fill('Borrador sin traducir');
    await input.focus();
    await p.evaluate(() => HospitalI18n.apply('es-UY'));
    check((await input.inputValue()) === 'Borrador sin traducir', file + ' preserves unsaved input when switching');
    await p.evaluate(() => HospitalI18n.apply('en'));
    await input.fill(value);
    const response = p.waitForResponse(res => res.url().includes('/update.php') && res.request().method() === 'POST');
    await p.locator(form + ' [type=submit]').click();
    const res = await response;
    check(res.status() === 200, file + ' saves canonical enum values in English');
    check(!errors.length, file + ' edit flow has no script errors');
  }
  await go('surveys/survey-new.html?template=patient_care');
  await p.waitForTimeout(100);
  check((await p.locator('[data-info=title]').inputValue()).includes('patient satisfaction'), 'English template inserts English editable content');
  const title = await p.locator('[data-info=title]').inputValue();
  await p.locator('[data-step="2"]').first().click();
  await p.locator('#form-title').fill('Texto propio');
  await p.evaluate(() => HospitalI18n.apply('es-UY'));
  check((await p.locator('[data-info=title]').inputValue()) === title && (await p.locator('#form-title').inputValue()) === 'Texto propio', 'language switching never rewrites template or draft content');
  // SQL persistence, cross-tab propagation and isolated save failure.
  await go('settings.html');
  const second = await context.newPage();
  await second.goto(base + '/src/views/main-menu.html');
  await second.evaluate(async () => {
    await HospitalI18n.ready;
    await HospitalAuth.ready;
  });
  await p.selectOption('#settings-language', 'en');
  await p.waitForTimeout(200);
  await p.selectOption('#settings-language', 'es-UY');
  await second.waitForFunction(() => HospitalI18n.locale === 'es-UY');
  check(true, 'saved SQL preference propagates to an already-open tab');
  await p.reload();
  await ready();
  await p.locator('#privacy-tab').click();
  check((await p.evaluate(() => HospitalI18n.locale)) === 'es-UY', 'SQL preference persists after refresh');
  await p.route('**/api/v1/settings/preferences-update.php', route => route.fulfill({
    status: 503,
    contentType: 'application/json',
    body: JSON.stringify({
      success: false,
      error: {
        code: 'SERVICE_UNAVAILABLE',
        message: 'Service unavailable.'
      },
      meta: {}
    })
  }));
  await p.selectOption('#settings-language', 'en');
  await p.waitForTimeout(250);
  check((await p.evaluate(() => HospitalI18n.locale)) === 'es-UY', 'failed language save restores confirmed preference');
  await p.unroute('**/api/v1/settings/preferences-update.php');
  let release;
  let first = true;
  await p.route('**/api/v1/settings/preferences-update.php', async route => {
    if (first) {
      first = false;
      await new Promise(resolve => release = resolve);
    }
    await route.continue();
  });
  await p.selectOption('#settings-language', 'en');
  await p.waitForTimeout(40);
  await p.selectOption('#settings-language', 'es-UY');
  await p.selectOption('#settings-language', 'en');
  check((await p.evaluate(() => HospitalI18n.locale)) === 'en', 'rapid selections preview the newest choice immediately');
  release();
  await p.waitForTimeout(600);
  check((await p.evaluate(() => HospitalI18n.locale)) === 'en' && (await p.locator('#settings-language').inputValue()) === 'en', 'queued responses preserve the newest selected language');
  await p.unroute('**/api/v1/settings/preferences-update.php');
  const publicContext = await browser.newContext(),
    patient = await publicContext.newPage();
  let patientErrors = [];
  patient.on('pageerror', e => patientErrors.push(e.message));
  await patient.goto(base + '/src/views/surveys/user-view/survey-user.html?lang=en#token=' + r.token);
  await patient.evaluate(() => HospitalI18n.ready);
  await patient.waitForTimeout(250);
  check((await patient.locator('#patient-survey-title').innerText()) === r.survey.form_title, 'public survey preserves original question/form record text');
  await patient.locator('[data-answer-rating]').first().check();
  const tokenBefore = await patient.evaluate(() => location.hash);
  await patient.selectOption('[data-language-select]', 'es-UY');
  check((await patient.locator('[data-answer-rating]:checked').count()) === 1 && (await patient.evaluate(() => location.hash)) === tokenBefore, 'public selector preserves selected answer and fragment credentials');
  await patient.selectOption('[data-language-select]', 'en');
  await patient.locator('#next-question').click();
  await patient.locator('#submit-answers').click();
  await patient.waitForTimeout(200);
  check((await patient.locator('#question-stage').innerText()).includes('Responses submitted'), 'patient submission commits with translated completion interface');
  check(!patientErrors.length, 'public survey switch/review/submit has no script errors');
  await patient.goto(base + '/index.html');
  await patient.evaluate(() => HospitalI18n.ready);
  check((await patient.locator('h1').innerText()) === 'Inicio de Sesion', 'anonymous public pages default to Spanish');
  await patient.goto(base + '/index.html?lang=en');
  await patient.evaluate(() => HospitalI18n.ready);
  await patient.locator('a[href*="register.html"]').click();
  await patient.evaluate(() => HospitalI18n.ready);
  check(patient.url().includes('lang=en') && (await patient.locator('h1').innerText()) === 'Registration', 'explicit English links carry language through public navigation');
  await patient.goto(base + '/index.html?lang=invalid');
  await patient.evaluate(() => HospitalI18n.ready);
  check((await patient.evaluate(() => HospitalI18n.locale)) === 'es-UY', 'invalid public language safely defaults to Spanish');
  fs.writeFileSync('tests/.runtime/i18n-deep-results.json', JSON.stringify({
    checks,
    results
  }, null, 2));
  await browser.close();
  console.log('TOTAL', checks);
})().catch(e => {
  console.error(e.stack);
  process.exit(1);
});

