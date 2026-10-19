(() => {
  'use strict';
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
  const labels = {inpatient:'Internado',outpatient:'Ambulatorio',emergency:'Urgencias',discharged:'Alta'};
  const codes = Object.fromEntries(Object.entries(labels).map(([code,label]) => [label,code]));
  const statusStyle = {Internado:'internado',Ambulatorio:'ambulatorio',Urgencias:'urgencias'};
  let patients = [], selected = null, editing = null, deleting = null;
  let currentPage = 1, total = 0, activeFilter = 'Todos', state = 'active';
  let requestId = 0, selectionId = 0, busy = false, token = null, searchTimer, toastTimer;
  let refreshPending = false, channel;
  try {
    localStorage.removeItem('hospital.patientDirectory.v1');
    localStorage.removeItem('hospital.patientDirectory.v2');
    channel = new BroadcastChannel(`hospital-patients:${api.page('')}`);
  } catch (_) { /* Server persistence does not depend on browser storage. */ }
  const dateLabel = value => value ? new Intl.DateTimeFormat('es-UY',{day:'numeric',month:'short',year:'numeric',timeZone:'UTC'}).format(new Date(value+'T12:00:00Z')) : '';
  function viewModel(p) {
    const e = p.encounter || {}, c = p.emergency_contact;
    const ageLabel = p.age === null ? 'Edad no indicada' : `${p.age} años${p.age_is_estimate ? ' (estimada)' : ''}`;
    return {...p,name:p.full_name,dni:p.national_id,ageLabel,ageDetail:ageLabel+(p.age_is_estimate && p.age_recorded_on ? ` · registrada el ${dateLabel(p.age_recorded_on)}` : ''),
      dateOfBirthLabel:dateLabel(p.date_of_birth),sexLabel:({female:'Femenino',male:'Masculino',other:'Otro',unspecified:'Desconocido'})[p.sex] || '',
      status:p.status==='archived'?'Archivado':labels[e.care_status] || 'Sin registro',room:e.room || 'Sin área asignada',department:e.department || '',
      doctor:e.doctor_name || 'Sin médico asignado',doctorSpecialty:e.doctor_specialty || '',bloodType:p.blood_group || '',
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
    clearTimeout(toastTimer); node.textContent=message; node.hidden=false;
    toastTimer=setTimeout(()=>{node.hidden=true;},4000);
  }
  function changed() { channel?.postMessage('changed'); }
  function pill(patient) { return `<span class="status-pill${statusStyle[patient.status] ? ' status-pill--'+statusStyle[patient.status] : ''}">${escapeHtml(patient.status)}</span>`; }
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
    const locationIcon = patient.status === "Internado" ? "bed" : patient.status === "Urgencias" ? "ambulance" : "ambulatory";
    return `<article class="patient-row${selected?.id === patient.id ? " is-selected" : ""}" data-patient-id="${escapeHtml(patient.id)}">
      <div class="patient-identity"><span class="patient-avatar">${icon("user")}</span><span><strong>${escapeHtml(patient.name)}</strong><small>${escapeHtml(patient.ageLabel)} <span aria-hidden="true">|</span> CI ${escapeHtml(patient.dni)}</small></span></div>
      <div class="patient-info location-info">${icon(locationIcon)}<span><b>${escapeHtml(patient.room)}</b><small>${escapeHtml(patient.department)}</small></span></div>
      <div class="patient-info doctor-info">${icon("doctor")}<span><b>${escapeHtml(patient.doctor)}</b><small>${escapeHtml(patient.doctorSpecialty)}</small></span></div>
      ${pill(patient)}
      <button type="button" class="row-action" data-select-id="${escapeHtml(patient.id)}" aria-label="Ver detalle de ${escapeHtml(patient.name)}" aria-controls="detail-panel" aria-expanded="${selected?.id === patient.id}">${icon("chevron")}</button>
    </article>`;
  }

  function renderPagination(pageCount) {
    const visible = new Set([1, pageCount, currentPage - 1, currentPage, currentPage + 1]);
    const pages = [...visible].filter(page => page >= 1 && page <= pageCount).sort((a, b) => a - b);
    let numbers = "";
    let previous = 0;
    for (const page of pages) {
      if (previous && page - previous > 1) numbers += `<span aria-hidden="true">…</span>`;
      numbers += `<button type="button" data-page="${page}" class="${page === currentPage ? "is-active" : ""}" ${page === currentPage ? 'aria-current="page"' : ""} aria-label="Página ${page}">${page}</button>`;
      previous = page;
    }
    pagination.innerHTML = `<button type="button" data-page="${currentPage - 1}" aria-label="Página anterior" ${currentPage === 1 ? "disabled" : ""}>‹</button>${numbers}<button type="button" data-page="${currentPage + 1}" aria-label="Página siguiente" ${currentPage === pageCount ? "disabled" : ""}>›</button>`;
  }

  function detailItem(iconName, label, value, className = "") {
    return `<dt>${icon(iconName)}${label}</dt><dd class="${className}">${escapeHtml(value || "No indicado")}</dd>`;
  }

  function renderDetail(patient) {
    const emergency = patient.emergencyContact || {};
    detailContent.innerHTML = `<div class="detail-hero">
      <span class="patient-avatar">${icon("user")}</span>
      <div class="detail-hero-text"><strong>${escapeHtml(patient.name)}</strong><p>${escapeHtml(patient.ageLabel)} &nbsp; | &nbsp; CI ${escapeHtml(patient.dni)}</p><p>${escapeHtml(patient.room)} · ${escapeHtml(patient.department)}</p></div>
      ${pill(patient)}
    </div>
    <div class="detail-grid">
      <section class="detail-card"><h3>Información general</h3><dl>
        ${detailItem("calendar", "Edad", patient.ageDetail)}
        ${detailItem("calendar", "Fecha de nacimiento", patient.dateOfBirthLabel)}
        ${detailItem("user", "Sexo", patient.sexLabel)}
        ${detailItem("file", "Documento", `CI ${patient.dni}`)}
        ${detailItem("phone", "Teléfono", patient.phone)}
        ${detailItem("drop", "Grupo sanguíneo", patient.bloodType)}
        ${detailItem("alert", "Alergias", patient.allergies)}
        ${detailItem("doctor", "Doctor asignado", patient.doctor)}
        ${detailItem(patient.status === "Ambulatorio" ? "ambulatory" : "bed", "Habitación / Área", `${patient.room} · ${patient.department}`)}
      </dl></section>
      <section class="detail-card"><h3>Contacto de emergencia</h3><dl>
        ${detailItem("user", "Nombre", emergency.name)}
        ${detailItem("phone", "Teléfono", emergency.phone)}
        ${detailItem("users", "Parentesco", emergency.relationship)}
      </dl></section>
      <section class="detail-card"><h3>Estado clínico</h3><dl>
        ${detailItem("heart", "Estado actual", patient.clinicalState || "Sin datos", patient.clinicalState === "Estable" ? "stable" : "")}
        ${detailItem("file", "Diagnóstico", patient.diagnosis)}
        ${detailItem("calendar", "Fecha de ingreso", patient.admissionDate)}
      </dl></section>
    </div>`;
  }


  function renderList() {
    list.innerHTML=patients.map(p=>row(viewModel(p))).join('');
    emptyState.hidden=total!==0;
    const start=(currentPage-1)*5;
    summary.textContent=total ? `Mostrando ${start+1} a ${start+patients.length} de ${total} pacientes` : 'Mostrando 0 pacientes';
    renderPagination(Math.max(1,Math.ceil(total/5)));
  }
  async function loadList() {
    const sequence=++requestId;
    summary.textContent='Cargando pacientes...';
    emptyState.hidden=true;
    try {
      const result=await api.request('patients/list.php',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({q:search.value,care_status:codes[activeFilter] || '',state,page:currentPage,page_size:5})},true,true);
      if (sequence!==requestId) return;
      patients=result.data; total=result.meta.total; currentPage=result.meta.page;
      document.querySelectorAll('[data-patient-stat]').forEach(node=>{node.textContent=String(result.meta.stats[node.dataset.patientStat]);});
      renderList();
    } catch(error) { if (sequence===requestId) summary.textContent=''; report(error); }
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
      archiveButton.lastChild.textContent=patient.status==='archived'?'Restaurar':'Archivar';
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
    archiveToggle.textContent=state==='active'?'Ver archivados':'Ver activos'; archiveToggle.setAttribute('aria-pressed',String(state==='archived'));
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
      document.getElementById('new-patient-title').textContent=patient?'Editar datos del paciente':'Nuevo paciente';
      document.getElementById('form-subtitle').textContent=patient?`Actualiza los datos de ${patient.full_name}.`:'Completa los datos para registrar un paciente del hospital.';
      document.getElementById('save-label').textContent=patient?'Guardar cambios':'Guardar paciente';
      form.elements.doctor.innerHTML='<option value="">Sin médico asignado</option>'+catalog.doctors.map(d=>`<option value="${escapeHtml(d.id)}">${escapeHtml(d.full_name)}</option>`).join('');
      document.getElementById('patient-departments').innerHTML=catalog.departments.map(d=>`<option value="${escapeHtml(d.name)}"></option>`).join('');
      const e=patient?.encounter || {}, c=patient?.emergency_contact || {};
      if(e.doctor_staff_id && !catalog.doctors.some(d=>d.id===e.doctor_staff_id)) form.elements.doctor.add(new Option((e.doctor_name || 'Médico')+' (inactivo)',e.doctor_staff_id));
      const values={name:patient?.full_name,dni:patient?.national_id,age:patient?.age,dateOfBirth:patient?.date_of_birth,sex:patient?.sex,phone:patient?.phone,bloodType:patient?.blood_group,allergies:patient?.allergies,
        emergencyName:c.full_name,emergencyPhone:c.phone,emergencyRelationship:c.relationship,status:patient?(labels[e.care_status] || ''):'Ambulatorio',room:e.room,department:e.department,doctor:e.doctor_staff_id,doctorSpecialty:e.doctor_specialty,admissionDate:e.admission_date,diagnosis:e.diagnosis,clinicalState:e.clinical_state};
      Object.entries(values).forEach(([key,value])=>{form.elements[key].value=value ?? '';});
      form.elements.status.querySelector('[value="Alta"]').disabled=!patient?.encounter;
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
      setBusy(false);dialog.close();search.value='';state='active';activeFilter='Todos';currentPage=1;
      archiveToggle.textContent='Ver archivados';archiveToggle.setAttribute('aria-pressed','false');
      filters.forEach(node=>{const active=node.dataset.filter==='Todos';node.classList.toggle('is-active',active);node.setAttribute('aria-pressed',String(active));});
      changed();await loadList();await selectPatient(patient.id);
      toast(wasEditing?'Datos del paciente actualizados.':'Paciente registrado.');
    } catch(error){report(error);}finally{setBusy(false);}
  });
  archiveButton.addEventListener('click',()=>{
    if(!selected || busy)return; deleting={...selected};
    const restore=deleting.status==='archived';
    document.getElementById('delete-title').textContent=restore?'¿Restaurar este paciente?':'¿Archivar este paciente?';
    document.getElementById('delete-description').textContent=restore?`El registro de ${deleting.full_name} volverá a estar disponible en los selectores del hospital.`:`El registro de ${deleting.full_name} saldrá del listado activo. Sus documentos y antecedentes se conservarán.`;
    document.getElementById('confirm-delete').textContent=restore?'Restaurar paciente':'Archivar paciente';deleteDialog.showModal();
  });
  document.querySelectorAll('[data-close-delete]').forEach(node=>node.addEventListener('click',()=>{if(!busy)deleteDialog.close();}));
  deleteDialog.addEventListener('cancel',event=>{if(busy)event.preventDefault();});
  deleteDialog.addEventListener('close',()=>{deleting=null;if(refreshPending){refreshPending=false;loadList();}});
  document.getElementById('confirm-delete').addEventListener('click',async()=>{
    if(!deleting || busy)return;
    const restore=deleting.status==='archived';setBusy(true);
    try {
      await api.post('patients/'+(restore?'restore':'archive')+'.php',{id:deleting.id,version:deleting.version});
      deleteDialog.close();closeDetail();changed();await loadList();toast(restore?'Paciente restaurado.':'Paciente archivado.');
    }catch(error){report(error);}finally{setBusy(false);}
  });
  function refresh() {if(dialog.open || deleteDialog.open || busy){refreshPending=true;return;}loadList();if(selected)selectPatient(selected.id,false);}
  if(channel)channel.onmessage=event=>{if(event.data==='changed')refresh();};
  document.addEventListener('visibilitychange',()=>{if(!document.hidden)refresh();});
  newButton.disabled=true;
  window.HospitalAuth.ready.then(payload=>{
    if(!payload)return;
    if(!payload.user.roles.includes('records_manager')){report(new api.ApiError('Se requiere permiso de gestión de registros.',403,'FORBIDDEN'));return;}
    newButton.disabled=false;loadList();
  });
})();
