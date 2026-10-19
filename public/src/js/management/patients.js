(async () => {
  'use strict';
    const i18nSourceUrl = document.currentScript.src;
    await window.HospitalI18n.ready;
    await window.HospitalAuth.ready;

  const api = window.HospitalApi;
  const workspace = document.getElementById('patient-workspace');
  const list = document.getElementById('patient-list');
  const detailPanel = document.getElementById('detail-panel');
  const detailContent = document.getElementById('detail-content');
  const emptyState = document.getElementById('patient-empty');
  const summary = document.getElementById('results-summary');
  const pagination = document.getElementById('patient-pagination');
  const search = document.getElementById('patient-search');
  const filters = document.querySelectorAll('[data-filter]');
  const dialog = document.getElementById('patient-dialog');
  const deleteDialog = document.getElementById('delete-dialog');
  const form = document.getElementById('patient-form');
  const newButton = document.getElementById('new-patient-button');
  const archiveToggle = document.getElementById('patient-archive-toggle');
  const archiveButton = document.getElementById('delete-from-detail');
  const editButton = document.getElementById('edit-from-detail');
  if (!api || !form || !workspace) return;
  const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
  const labels = {get inpatient() { return window.HospitalI18n.t("patients.internado"); },get outpatient() { return window.HospitalI18n.t("patients.ambulatorio"); },get emergency() { return window.HospitalI18n.t("patients.urgencias"); },get discharged() { return window.HospitalI18n.t("patients.status_discharged"); }};
  const codes = Object.fromEntries(Object.keys(labels).map(code => [code,code]));
  const statusStyle = {inpatient:'internado',outpatient:'ambulatorio',emergency:'urgencias'};
  let patients = [], selected = null, editing = null, deleting = null;
  let currentPage = 1, total = 0, activeFilter = 'all', state = 'active';
  let requestId = 0, selectionId = 0, busy = false, token = null, searchTimer, toastTimer;
  let refreshPending = false, channel;
  try {
    localStorage.removeItem('hospital.patientDirectory.v1');
    localStorage.removeItem('hospital.patientDirectory.v2');
    channel = new BroadcastChannel(`hospital-patients:${api.page('')}`);
  } catch (_) { /* Server persistence does not depend on browser storage. */ }
  const dateLabel = value => value ? new Intl.DateTimeFormat(window.HospitalI18n.locale,{day:'numeric',month:'short',year:'numeric',timeZone:'UTC'}).format(new Date(value+'T12:00:00Z')) : '';
  function viewModel(p) {
    const e = p.encounter || {}, c = p.emergency_contact;
    const ageLabel = p.age === null ? window.HospitalI18n.t("patients.edad_no_indicada") : window.HospitalI18n.t("patients.value_anosvalue", {value0: p.age, value1: p.age_is_estimate ? window.HospitalI18n.t("shared.estimada") : ''});
    return {...p,name:p.full_name,dni:p.national_id,ageLabel,ageDetail:ageLabel+(p.age_is_estimate && p.age_recorded_on ? window.HospitalI18n.t("patients.registrada_el_value", {value0: dateLabel(p.age_recorded_on)}) : ''),
      dateOfBirthLabel:dateLabel(p.date_of_birth),sexLabel:({female:window.HospitalI18n.t("trace_new.femenino"),male:window.HospitalI18n.t("trace_new.masculino"),other:window.HospitalI18n.t("trace_new.otro"),unspecified:window.HospitalI18n.t("patients.desconocido")})[p.sex] || '',
      status:p.status==='archived'?'archived':e.care_status || 'none',room:e.room || window.HospitalI18n.t("patients.sin_area_asignada"),department:e.department || '',
      doctor:e.doctor_name || window.HospitalI18n.t("patients.sin_medico_asignado"),doctorSpecialty:e.doctor_specialty || '',bloodType:p.blood_group || '',
      admissionDate:dateLabel(e.admission_date),clinicalState:e.clinical_state || '',diagnosis:e.diagnosis || '',
      emergencyContact:{name:c.full_name,phone:c.phone,relationship:c.relationship}};
  }
  const report = error => api.report(error,'patients');
  const get = id => api.get('patients/get.php?id='+encodeURIComponent(id));
  function setBusy(value) {
    busy=value;
    form.querySelectorAll('button').forEach(button => {button.disabled=value;});
    deleteDialog.querySelectorAll('button').forEach(button => {button.disabled=value;});
    newButton.disabled=value;
    form.inert=value;
  }
  function toast(message) {
    const node=document.getElementById('patient-toast');
    clearTimeout(toastTimer); window.HospitalI18n.bindText(node, () => window.HospitalI18n.resolve(message)); node.hidden=false;
    toastTimer=setTimeout(()=>{node.hidden=true;},4000);
  }
  function changed() { channel?.postMessage('changed'); }
  function pill(patient) { return `<span class="status-pill${statusStyle[patient.status] ? ' status-pill--'+statusStyle[patient.status] : ''}">${escapeHtml(patient.status==='archived'?window.HospitalI18n.t("personnel.archivado"):labels[patient.status] || window.HospitalI18n.t("patients.sin_registro"))}</span>`; }
  const iconFiles = {
    search: "search-icon.svg",
    users: "people-svgrepo-com.svg",
    user: "person-icon.svg",
    doctor: "doctor-icon.svg",
    bed: "bed-icon.svg",
    ambulatory: "ambulatory-icon.svg",
    file: "document-icon.svg",
    calendar: "calendar-icon.svg",
    plus: "plus-icon.svg",
    chevron: "arrow-left.svg",
    phone: "phone-icon.svg",
    drop: "bloodtype-icon.svg",
    alert: "alert-icon.svg",
    ambulance: "emergency-icon.svg",
    heart: "hrate-icon.svg"
  };
  const icon = (name) => `<img src="${iconFiles[name] ? `../../../assets/Icons/${iconFiles[name]}` : "#"}" alt="" aria-hidden="true"${name === "chevron" ? ' class="chevron-icon"' : ""}>`;
  function row(patient) {
    const locationIcon = patient.status === "inpatient" ? "bed" : patient.status === "emergency" ? "ambulance" : "ambulatory";
    return `<article class="patient-row${selected?.id === patient.id ? " is-selected" : ""}" data-patient-id="${escapeHtml(patient.id)}">
      <div class="patient-identity"><span class="patient-avatar">${icon("user")}</span><span><strong>${escapeHtml(patient.name)}</strong><small>${escapeHtml(patient.ageLabel)} <span aria-hidden="true">|</span> ${window.HospitalI18n.mark("patients.ci_value", {value0: patient.dni})}</small></span></div>
      <div class="patient-info location-info">${icon(locationIcon)}<span><b>${escapeHtml(patient.room)}</b><small>${escapeHtml(patient.department)}</small></span></div>
      <div class="patient-info doctor-info">${icon("doctor")}<span><b>${escapeHtml(patient.doctor)}</b><small>${escapeHtml(patient.doctorSpecialty)}</small></span></div>
      ${pill(patient)}
      <button type="button" class="row-action" data-select-id="${escapeHtml(patient.id)}" aria-label="${window.HospitalI18n.html("ambulances.ver_detalle_de_value", {value0: patient.name})}" data-i18n-aria-label="ambulances.ver_detalle_de_value" data-i18n-aria-label-params="${window.HospitalI18n.escape(JSON.stringify({value0: patient.name}))}" aria-controls="detail-panel" aria-expanded="${selected?.id === patient.id}">${icon("chevron")}</button>
    </article>`;
  }

  function renderPagination(pageCount) {
    const visible = new Set([1, pageCount, currentPage - 1, currentPage, currentPage + 1]);
    const pages = [...visible].filter(page => page >= 1 && page <= pageCount).sort((a, b) => a - b);
    let numbers = "";
    let previous = 0;
    for (const page of pages) {
      if (previous && page - previous > 1) numbers += `<span aria-hidden="true">…</span>`;
      numbers += `<button type="button" data-page="${page}" class="${page === currentPage ? "is-active" : ""}" ${page === currentPage ? 'aria-current="page"' : ""} aria-label="${window.HospitalI18n.html("ambulances.pagina_value", {value0: page})}" data-i18n-aria-label="ambulances.pagina_value" data-i18n-aria-label-params="${window.HospitalI18n.escape(JSON.stringify({value0: page}))}">${page}</button>`;
      previous = page;
    }
    window.HospitalI18n.setHTML(pagination, `<button type="button" data-page="${currentPage - 1}" aria-label="${window.HospitalI18n.html("trace.pagina_anterior")}" data-i18n-aria-label="trace.pagina_anterior" ${currentPage === 1 ? "disabled" : ""}>‹</button>${numbers}<button type="button" data-page="${currentPage + 1}" aria-label="${window.HospitalI18n.html("trace.pagina_siguiente")}" data-i18n-aria-label="trace.pagina_siguiente" ${currentPage === pageCount ? "disabled" : ""}>›</button>`);
  }

  function detailItem(iconName, label, value, className = "") {
    return `<dt>${icon(iconName)}${label}</dt><dd class="${className}">${escapeHtml(value || window.HospitalI18n.t("doctors.no_indicado"))}</dd>`;
  }

  function renderDetail(patient) {
    const emergency = patient.emergencyContact || {};
    window.HospitalI18n.setHTML(detailContent, `<div class="detail-hero">
      <span class="patient-avatar">${icon("user")}</span>
      <div class="detail-hero-text"><strong>${escapeHtml(patient.name)}</strong><p>${window.HospitalI18n.mark("patients.value_ci_value", {value0: patient.ageLabel, value1: patient.dni})}</p><p>${escapeHtml(patient.room)} · ${escapeHtml(patient.department)}</p></div>
      ${pill(patient)}
    </div>
    <div class="detail-grid">
      <section class="detail-card"><h3>${window.HospitalI18n.mark("routes.informacion_general")}</h3><dl>
        ${detailItem("calendar", window.HospitalI18n.t("trace_view.edad"), patient.ageDetail)}
        ${detailItem("calendar", window.HospitalI18n.t("patients.fecha_de_nacimiento"), patient.dateOfBirthLabel)}
        ${detailItem("user", window.HospitalI18n.t("trace_view.sexo"), patient.sexLabel)}
        ${detailItem("file", window.HospitalI18n.t("documents_viewer.documento"), window.HospitalI18n.t("patients.ci_value", {value0: patient.dni}))}
        ${detailItem("phone", window.HospitalI18n.t("destinations.telefono"), patient.phone)}
        ${detailItem("drop", window.HospitalI18n.t("patients.grupo_sanguineo"), patient.bloodType)}
        ${detailItem("alert", window.HospitalI18n.t("patients.alergias"), patient.allergies)}
        ${detailItem("doctor", window.HospitalI18n.t("patients.doctor_asignado"), patient.doctor)}
        ${detailItem(patient.status === "outpatient" ? "ambulatory" : "bed", window.HospitalI18n.t("patients.habitacion_area"), `${patient.room} · ${patient.department}`)}
      </dl></section>
      <section class="detail-card"><h3>${window.HospitalI18n.mark("patients.contacto_de_emergencia")}</h3><dl>
        ${detailItem("user", window.HospitalI18n.t("settings.nombre"), emergency.name)}
        ${detailItem("phone", window.HospitalI18n.t("destinations.telefono"), emergency.phone)}
        ${detailItem("users", window.HospitalI18n.t("patients.parentesco"), emergency.relationship)}
      </dl></section>
      <section class="detail-card"><h3>${window.HospitalI18n.mark("patients.estado_clinico")}</h3><dl>
        ${detailItem("heart", window.HospitalI18n.t("patients.estado_actual"), patient.clinicalState || window.HospitalI18n.t("patients.sin_datos"), patient.clinicalState === "Estable" ? "stable" : "")}
        ${detailItem("file", window.HospitalI18n.t("patients.diagnostico"), patient.diagnosis)}
        ${detailItem("calendar", window.HospitalI18n.t("patients.fecha_de_ingreso"), patient.admissionDate)}
      </dl></section>
    </div>`);
  }


  function renderList() {
    window.HospitalI18n.setHTML(list, patients.map(p=>row(viewModel(p))).join(''));
    emptyState.hidden=total!==0;
    const start=(currentPage-1)*5;
    window.HospitalI18n.bindText(summary, () => total ? window.HospitalI18n.t("patients.mostrando_value_a_value_de_value_pacientes", {value0: start+1, value1: start+patients.length, value2: total}) : window.HospitalI18n.t("patients.mostrando_0_pacientes"));
    renderPagination(Math.max(1,Math.ceil(total/5)));
  }
  async function loadList() {
    const sequence=++requestId;
    window.HospitalI18n.bindText(summary, () => window.HospitalI18n.t("patients.cargando_pacientes"));
    emptyState.hidden=true;
    try {
      const result=await api.request('patients/list.php',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({q:search.value,care_status:codes[activeFilter] || '',state,page:currentPage,page_size:5})},true,true);
      if (sequence!==requestId) return;
      patients=result.data; total=result.meta.total; currentPage=result.meta.page;
      document.querySelectorAll('[data-patient-stat]').forEach(node=>{window.HospitalI18n.bindText(node, () => String(result.meta.stats[node.dataset.patientStat]));});
      renderList();
    } catch(error) { if (sequence===requestId) window.HospitalI18n.bindText(summary, () => ''); report(error); }
  }
  function closeDetail(restoreFocus=false) {
    const old=selected?.id;
    selectionId++; selected=null;
    workspace.classList.remove('has-selection'); detailPanel.setAttribute('aria-hidden','true'); detailPanel.inert=true;
    list.querySelectorAll('.patient-row').forEach(node=>node.classList.remove('is-selected'));
    list.querySelectorAll('[data-select-id]').forEach(node=>node.setAttribute('aria-expanded','false'));
    if (restoreFocus) (list.querySelector(`[data-select-id="${CSS.escape(old || '')}"]`) || newButton).focus();
  }
  async function selectPatient(id, focus=true) {
    const sequence=++selectionId;
    try {
      const patient=await get(id);
      if (sequence!==selectionId) return;
      selected=patient; renderDetail(viewModel(patient));
      window.HospitalI18n.bindText(archiveButton.lastChild, () => patient.status==='archived'?window.HospitalI18n.t("personnel.restaurar"):window.HospitalI18n.t("patients.archivar"));
      editButton.disabled=patient.status!=='active';
      detailPanel.inert=false; detailPanel.setAttribute('aria-hidden','false'); workspace.classList.add('has-selection');
      renderList();
      if (focus) { detailPanel.scrollTop=0; document.getElementById('close-detail').focus({preventScroll:true}); }
    } catch(error) {report(error);}
  }
  search.addEventListener('input',()=>{clearTimeout(searchTimer); currentPage=1; closeDetail(); searchTimer=setTimeout(loadList,250);});
  filters.forEach(button=>button.addEventListener('click',()=>{
    activeFilter=button.dataset.filter; currentPage=1; closeDetail();
    filters.forEach(node=>{const active=node===button;node.classList.toggle('is-active',active);node.setAttribute('aria-pressed',String(active));});
    loadList();
  }));
  archiveToggle.addEventListener('click',()=>{
    state=state==='active'?'archived':'active'; currentPage=1; closeDetail();
    window.HospitalI18n.bindText(archiveToggle, () => state==='active'?window.HospitalI18n.t("personnel.ver_archivados"):window.HospitalI18n.t("personnel.ver_activos")); archiveToggle.setAttribute('aria-pressed',String(state==='archived'));
    loadList();
  });
  list.addEventListener('click',event=>{const button=event.target.closest('[data-select-id]');if(button) selectPatient(button.dataset.selectId);});
  pagination.addEventListener('click',event=>{const button=event.target.closest('[data-page]');if(!button || button.disabled)return;currentPage=Number(button.dataset.page);closeDetail();loadList();});
  document.getElementById('close-detail').addEventListener('click',()=>closeDetail(true));
  document.addEventListener('keydown',event=>{if(event.key==='Escape' && selected && !dialog.open && !deleteDialog.open)closeDetail(true);});
  const careFields=['room','department','doctor','doctorSpecialty','admissionDate','diagnosis','clinicalState'];
  function clinicalControls() {
    const enabled=Boolean(form.elements.status.value);
    careFields.forEach(key=>{form.elements[key].disabled=!enabled;});
    form.elements.room.required=enabled;form.elements.department.required=enabled;
  }
  function birthControls() {
    const birth=form.elements.dateOfBirth.value;
    form.elements.age.readOnly=Boolean(birth);
    if (birth) {
      const now=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Montevideo',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
      const parts=now.split('-'), dob=birth.split('-');
      form.elements.age.value=Number(parts[0])-Number(dob[0])-(parts.slice(1).join('-')<dob.slice(1).join('-') ? 1 : 0);
    }
  }
  form.elements.status.addEventListener('change',clinicalControls);
  form.elements.dateOfBirth.addEventListener('change',birthControls);
  async function openForm(id=null) {
    if (busy) return;
    setBusy(true);
    try {
      const [catalog,patient]=await Promise.all([api.get('patients/catalogs.php'),id?get(id):Promise.resolve(null)]);
      editing=patient; token=catalog.create_token;
      form.reset();
      window.HospitalI18n.bindText(document.getElementById('new-patient-title'), () => patient?window.HospitalI18n.t("patients.editar_datos_del_paciente"):window.HospitalI18n.t("patients.nuevo_paciente"));
      window.HospitalI18n.bindText(document.getElementById('form-subtitle'), () => patient?window.HospitalI18n.t("patients.actualiza_los_datos_de_value", {value0: patient.full_name}):window.HospitalI18n.t("patients.completa_los_datos_para_registrar_un_paciente_del_hospital"));
      window.HospitalI18n.bindText(document.getElementById('save-label'), () => patient?window.HospitalI18n.t("trace_view.guardar_cambios"):window.HospitalI18n.t("patients.guardar_paciente"));
      window.HospitalI18n.setHTML(form.elements.doctor, `<option value="" data-i18n="patients.sin_medico_asignado">${window.HospitalI18n.html("patients.sin_medico_asignado")}</option>`+catalog.doctors.map(d=>`<option value="${escapeHtml(d.id)}">${escapeHtml(d.full_name)}</option>`).join(''));
      window.HospitalI18n.setHTML(document.getElementById('patient-departments'), catalog.departments.map(d=>`<option value="${escapeHtml(d.name)}"></option>`).join(''));
      const e=patient?.encounter || {}, c=patient?.emergency_contact || {};
      if(e.doctor_staff_id && !catalog.doctors.some(d=>d.id===e.doctor_staff_id)) form.elements.doctor.add(window.HospitalI18n.option(() => (e.doctor_name || window.HospitalI18n.t("patients.medico"))+window.HospitalI18n.t("shared.inactivo"), e.doctor_staff_id));
      const values={name:patient?.full_name,dni:patient?.national_id,age:patient?.age,dateOfBirth:patient?.date_of_birth,sex:patient?.sex,phone:patient?.phone,bloodType:patient?.blood_group,allergies:patient?.allergies,
        emergencyName:c.full_name,emergencyPhone:c.phone,emergencyRelationship:c.relationship,status:patient?(e.care_status || ''):'outpatient',room:e.room,department:e.department,doctor:e.doctor_staff_id,doctorSpecialty:e.doctor_specialty,admissionDate:e.admission_date,diagnosis:e.diagnosis,clinicalState:e.clinical_state};
      Object.entries(values).forEach(([key,value])=>{form.elements[key].value=value ?? '';});
      form.elements.status.querySelector('[value="discharged"]').disabled=!patient?.encounter;
      clinicalControls();birthControls(); closeDetail();
      dialog.querySelector('.dialog-fields').scrollTop=0; dialog.showModal();
    } catch(error) {report(error);} finally {setBusy(false);if(dialog.open)form.elements.name.focus();}
  }
  newButton.addEventListener('click',()=>openForm());
  editButton.addEventListener('click',()=>{if(selected)openForm(selected.id);});
  const closeDialog=()=>{if(!busy)dialog.close();};
  document.getElementById('close-patient-dialog').addEventListener('click',closeDialog);
  document.getElementById('cancel-patient').addEventListener('click',closeDialog);
  dialog.addEventListener('click',event=>{if(event.target===dialog)closeDialog();});
  dialog.addEventListener('cancel',event=>{if(busy)event.preventDefault();});
  dialog.addEventListener('close',()=>{editing=null;if(!selected)newButton.focus();if(refreshPending){refreshPending=false;loadList();}});
  form.addEventListener('submit',async event=>{
    event.preventDefault(); if(busy || !form.checkValidity())return;
    const f=Object.fromEntries(new FormData(form));
    const body={full_name:f.name,national_id:f.dni,age:f.age || null,date_of_birth:f.dateOfBirth || null,sex:f.sex || null,phone:f.phone,blood_group:f.bloodType,allergies:f.allergies,
      emergency_name:f.emergencyName,emergency_phone:f.emergencyPhone,emergency_relationship:f.emergencyRelationship,care_status:codes[f.status] || null,room:f.room || '',department:f.department || '',doctor_staff_id:f.doctor || null,doctor_specialty:f.doctorSpecialty || '',admission_date:f.admissionDate || null,diagnosis:f.diagnosis || '',clinical_state:f.clinicalState || ''};
    const wasEditing=Boolean(editing);
    if(editing){body.id=editing.id;body.version=editing.version;}else body.create_token=token;
    setBusy(true);
    try {
      const patient=await api.post('patients/'+(wasEditing?'update':'create')+'.php',body);
      setBusy(false);dialog.close();search.value='';state='active';activeFilter='all';currentPage=1;
      window.HospitalI18n.bindText(archiveToggle, () => window.HospitalI18n.t("personnel.ver_archivados"));archiveToggle.setAttribute('aria-pressed','false');
      filters.forEach(node=>{const active=node.dataset.filter==='all';node.classList.toggle('is-active',active);node.setAttribute('aria-pressed',String(active));});
      changed();await loadList();await selectPatient(patient.id);
      toast(() => wasEditing?window.HospitalI18n.t("patients.datos_del_paciente_actualizados"):window.HospitalI18n.t("patients.paciente_registrado"));
    } catch(error){report(error);}finally{setBusy(false);}
  });
  archiveButton.addEventListener('click',()=>{
    if(!selected || busy)return; deleting={...selected};
    const restore=deleting.status==='archived';
    window.HospitalI18n.bindText(document.getElementById('delete-title'), () => restore?window.HospitalI18n.t("patients.restaurar_este_paciente"):window.HospitalI18n.t("patients.archivar_este_paciente"));
    window.HospitalI18n.bindText(document.getElementById('delete-description'), () => restore?window.HospitalI18n.t("patients.el_registro_de_value_volvera_a_estar_disponible_en_los_selectores_del_hospital", {value0: deleting.full_name}):window.HospitalI18n.t("patients.el_registro_de_value_saldra_del_listado_activo_sus_documentos_y_antecedentes_se_conservara", {value0: deleting.full_name}));
    window.HospitalI18n.bindText(document.getElementById('confirm-delete'), () => restore?window.HospitalI18n.t("patients.restaurar_paciente"):window.HospitalI18n.t("patients.archivar_paciente"));deleteDialog.showModal();
  });
  document.querySelectorAll('[data-close-delete]').forEach(node=>node.addEventListener('click',()=>{if(!busy)deleteDialog.close();}));
  deleteDialog.addEventListener('cancel',event=>{if(busy)event.preventDefault();});
  deleteDialog.addEventListener('close',()=>{deleting=null;if(refreshPending){refreshPending=false;loadList();}});
  document.getElementById('confirm-delete').addEventListener('click',async()=>{
    if(!deleting || busy)return;
    const restore=deleting.status==='archived';setBusy(true);
    try {
      await api.post('patients/'+(restore?'restore':'archive')+'.php',{id:deleting.id,version:deleting.version});
      deleteDialog.close();closeDetail();changed();await loadList();toast(() => restore?window.HospitalI18n.t("patients.paciente_restaurado"):window.HospitalI18n.t("patients.paciente_archivado"));
    }catch(error){report(error);}finally{setBusy(false);}
  });
  function refresh() {if(dialog.open || deleteDialog.open || busy){refreshPending=true;return;}loadList();if(selected)selectPatient(selected.id,false);}
  if(channel)channel.onmessage=event=>{if(event.data==='changed')refresh();};
  document.addEventListener('visibilitychange',()=>{if(!document.hidden)refresh();});
  newButton.disabled=true;
  window.HospitalAuth.ready.then(payload=>{
    if(!payload)return;
    if(!payload.user.roles.includes('records_manager')){report(new api.ApiError(window.HospitalI18n.t("patients.se_requiere_permiso_de_gestion_de_registros"),403,'FORBIDDEN'));return;}
    newButton.disabled=false;loadList();
  });
  window.addEventListener('hospital:localechange',()=>{renderList();if(selected)renderDetail(viewModel(selected));});

})();
