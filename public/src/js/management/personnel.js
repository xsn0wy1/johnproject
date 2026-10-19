document.addEventListener('DOMContentLoaded', async () => {
    await window.HospitalI18n.ready;
    await window.HospitalAuth.ready;

  const api = window.HospitalApi;
  const pageSize = 6;
  const iconBase = '../../../assets/Icons/';
  const roleCodes = {driver:'driver',copilot:'copilot'};
  const roleLabels={get driver() { return window.HospitalI18n.t("personnel.chofer"); },get copilot() { return window.HospitalI18n.t("personnel.copiloto"); }}, statusLabels={get active() { return window.HospitalI18n.t("destinations.activo"); },get inactive() { return window.HospitalI18n.t("destinations.inactivo"); }};
  const fromApi = p => ({...p,name:p.full_name,document:p.national_id,license:p.driving_license,
    role:p.responsibility,archived:p.status==='archived',
    status:p.availability==='active' && p.staff_status==='active'?'active':'inactive'});
  const rows = document.getElementById('personnel-rows');
  const search = document.getElementById('personnel-search');
  const form = document.getElementById('personnel-form');
  const nameInput = document.getElementById('person-name');
  const roleInput = document.getElementById('person-role');
  const phoneInput = document.getElementById('person-phone');
  const documentInput = document.getElementById('person-document');
  const licenseInput = document.getElementById('person-license');
  const statusInput = document.getElementById('person-status');
  const formTitle = document.getElementById('form-title');
  const formSubtitle = document.getElementById('form-subtitle');
  const feedback = document.getElementById('form-feedback');
  const dialog = document.getElementById('person-dialog');
  if (!api || !rows || !search || !form || !dialog) return;

  let people = [];
  let archived = false, editingVersion = null, busy = false, dirty = false;
  const archiveToggle = document.getElementById("personnel-archive-toggle");
  let activeRole = 'driver';
  let currentPage = 1;
  let editingId = null;

  const report = error => api.report(error,'personnel');
  function upsert(data) {
    const person=fromApi(data);
    if(people.some(p=>p.id===person.id)) people=people.map(p=>p.id===person.id?person:p);
    else people.push(person);
    return person;
  }
  function setBusy(value) {
    busy=value;
    [...form.elements,...rows.querySelectorAll('button'),...document.querySelectorAll('.role-tab'),archiveToggle].forEach(el=>{el.disabled=value;});
  }
  async function refresh() { people=(await api.get('personnel/list.php')).map(fromApi); render(); }

  function normalize(value) {
    return value.toLocaleLowerCase('es').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
  }

  function matchesSearch(person, query) {
    if (!query) return true;
    const content = normalize(`${person.name} ${person.document} ${person.phone} ${person.license}`);
    if (content.includes(query)) return true;
    const compactQuery = query.replace(/[^a-z0-9]/g, '');
    return compactQuery.length > 0 && content.replace(/[^a-z0-9]/g, '').includes(compactQuery);
  }

  function makeIcon(file) {
    const image = document.createElement('img');
    image.src = iconBase + file;
    window.HospitalI18n.bindAttr(image, "alt", () => '');
    image.setAttribute('aria-hidden', 'true');
    return image;
  }

  function makeCell(text) {
    const cell = document.createElement('td');
    window.HospitalI18n.bindText(cell, () => text);
    return cell;
  }

  function makeAction(action, label, icon, person) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'row-action';
    button.dataset.action = action;
    button.dataset.id = person.id;
    window.HospitalI18n.bindAttr(button, "aria-label", () => `${label} ${person.name}`);
    window.HospitalI18n.bindAttr(button, "title", () => `${label} ${person.name}`);
    button.append(makeIcon(icon));
    return button;
  }

  function makeRow(person) {
    const row = document.createElement('tr');
    const nameCell = document.createElement('td');
    const nameContent = document.createElement('span');
    nameContent.className = 'person-name-cell';
    const avatar = document.createElement('span');
    avatar.className = 'person-avatar';
    avatar.append(makeIcon(person.role === 'driver' ? 'steering-wheel.svg' : 'person-icon.svg'));
    const name = document.createElement('span');
    window.HospitalI18n.bindText(name, () => person.name);
    nameContent.append(avatar, name);
    nameCell.append(nameContent);

    const statusCell = document.createElement('td');
    const status = document.createElement('span');
    status.className = 'status-text';
    const dot = document.createElement('span');
    dot.className = 'status-dot' + (person.archived || person.status === 'inactive' ? ' is-inactive' : '');
    dot.setAttribute('aria-hidden', 'true');
    const statusLabel = document.createElement('span');
    window.HospitalI18n.bindText(statusLabel, () => person.archived ? window.HospitalI18n.t("personnel.archivado") : (statusLabels)[person.status]);
    status.append(dot, statusLabel);
    statusCell.append(status);

    const actionsCell = document.createElement('td');
    const actions = document.createElement('div');
    actions.className = 'row-actions';
    actions.append(makeAction('view',window.HospitalI18n.t("personnel.ver"),'eye.svg',person));
    if(person.archived) actions.append(makeAction('restore',window.HospitalI18n.t("personnel.restaurar"),'save-floppy.svg',person));
    else actions.append(makeAction('edit',window.HospitalI18n.t("trace_view.editar"),'pencil-icon.svg',person),makeAction('delete',window.HospitalI18n.t("routes.eliminar"),'trash-icon.svg',person));
    actionsCell.append(actions);

    row.append(nameCell, makeCell(roleLabels[person.role]), makeCell(person.phone),
      makeCell(person.license || person.document || '—'), statusCell, actionsCell);
    return row;
  }

  function render() {
    const rolePeople = people.filter(person => person.role === activeRole && person.archived === archived);
    const query = normalize(search.value);
    const matching = rolePeople.filter(person => matchesSearch(person, query));
    const pageCount = Math.max(1, Math.ceil(matching.length / pageSize));
    currentPage = Math.min(currentPage, pageCount);
    const start = (currentPage - 1) * pageSize;
    const visible = matching.slice(start, start + pageSize);
    const fragment = document.createDocumentFragment();
    visible.forEach(person => fragment.append(makeRow(person)));
    rows.replaceChildren(fragment);

    const plural = activeRole === 'driver' ? window.HospitalI18n.t("personnel.choferes_2") : window.HospitalI18n.t("personnel.copilotos_2");
    window.HospitalI18n.bindText(document.getElementById('list-title'), () => window.HospitalI18n.t("personnel.listado_de_value", {value0: (activeRole === 'driver' ? window.HospitalI18n.t("personnel.choferes_2") : window.HospitalI18n.t("personnel.copilotos_2"))}));
    window.HospitalI18n.bindText(document.getElementById('list-count'), () => window.HospitalI18n.t("personnel.total_de_value_value_value", {value0: rolePeople.length, value1: (activeRole === 'driver' ? window.HospitalI18n.t("personnel.choferes_2") : window.HospitalI18n.t("personnel.copilotos_2")), value2: archived ? window.HospitalI18n.t("personnel.archivados") : window.HospitalI18n.t("personnel.registrados")}));
    document.getElementById('personnel-list').setAttribute('aria-labelledby', activeRole === 'driver' ? 'tab-chofer' : 'tab-copiloto');
    window.HospitalI18n.bindText(document.getElementById('results-summary'), () => matching.length
      ? window.HospitalI18n.t("personnel.mostrando_value_a_value_de_value_resultados", {value0: start + 1, value1: start + visible.length, value2: matching.length})
      : window.HospitalI18n.t("personnel.mostrando_0_resultados"));
    document.getElementById('empty-state').hidden = matching.length > 0;
    window.HospitalI18n.bindText(document.getElementById('page-number'), () => String(currentPage));
    document.getElementById('page-prev').disabled = currentPage === 1;
    document.getElementById('page-next').disabled = currentPage === pageCount;
  }

  function updateRoleIcon() {
    document.getElementById('role-icon').src = iconBase +
      (roleInput.value === 'driver' ? 'steering-wheel.svg' : 'person-icon.svg');
    licenseInput.required = roleInput.value === 'driver';
  }

  function updateStatusDot() {
    document.getElementById('form-status-dot').classList.toggle('is-inactive', statusInput.value === 'inactive');
  }

  function clearForm() {
    form.reset();
    editingId = null;
    editingVersion = null; dirty = false;
    window.HospitalI18n.bindText(formTitle, () => window.HospitalI18n.t("personnel.agregar_personal"));
    window.HospitalI18n.bindText(formSubtitle, () => window.HospitalI18n.t("personnel.completa_la_informacion_del_personal"));
    roleInput.value = activeRole;
    documentInput.required = true;
    window.HospitalI18n.bindText(feedback, () => '');
    window.HospitalI18n.bindValidity(nameInput, () => '');
    window.HospitalI18n.bindValidity(phoneInput, () => '');
    updateRoleIcon();
    updateStatusDot();
  }

  function switchRole(role) {
    activeRole = role;
    currentPage = 1;
    document.querySelectorAll('.role-tab').forEach(tab => {
      const selected = tab.dataset.role === role;
      tab.classList.toggle('is-active', selected);
      tab.setAttribute('aria-selected', String(selected));
      tab.tabIndex = selected ? 0 : -1;
    });
    clearForm();
    render();
  }

  function showPerson(person) {
    const details = document.getElementById('dialog-details');
    details.replaceChildren();
    [
      [window.HospitalI18n.t("settings.nombre"), person.name], [window.HospitalI18n.t("personnel.rol"), roleLabels[person.role]], [window.HospitalI18n.t("destinations.telefono"), person.phone],
      [window.HospitalI18n.t("documents_viewer.documento"), person.document || '—'], [window.HospitalI18n.t("personnel.licencia"), person.license || '—'], [window.HospitalI18n.t("trace_view.estado"), statusLabels[person.status]]
    ].forEach(([label, value]) => {
      const term = document.createElement('dt');
      const description = document.createElement('dd');
      window.HospitalI18n.bindText(term, () => label);
      window.HospitalI18n.bindText(description, () => value);
      details.append(term, description);
    });
    dialog.showModal();
  }

  function editPerson(person) {
    if (person.role !== activeRole) switchRole(person.role);
    clearForm();
    editingId = person.id; editingVersion = person.version;
    window.HospitalI18n.bindText(formTitle, () => window.HospitalI18n.t("personnel.editar_personal"));
    window.HospitalI18n.bindText(formSubtitle, () => window.HospitalI18n.t("personnel.actualiza_la_informacion_del_personal"));
    nameInput.value = person.name;
    roleInput.value = person.role;
    phoneInput.value = person.phone;
    documentInput.value = person.document;
    documentInput.required = true;
    licenseInput.value = person.license;
    statusInput.value = person.status;
    window.HospitalI18n.bindText(feedback, () => '');
    updateRoleIcon();
    updateStatusDot();
    nameInput.focus();
    form.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  document.querySelectorAll('.role-tab').forEach(tab => {
    tab.addEventListener('click', () => switchRole(tab.dataset.role));
    tab.addEventListener('keydown', event => {
      if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
        event.preventDefault();
        const nextRole = activeRole === 'driver' ? 'copilot' : 'driver';
        switchRole(nextRole);
        document.querySelector(`.role-tab[data-role="${nextRole}"]`).focus();
      }
    });
  });

  document.querySelectorAll('[data-add-role]').forEach(button => {
    button.addEventListener('click', () => {
      if (button.dataset.addRole !== activeRole) switchRole(button.dataset.addRole);
      else clearForm();
      nameInput.focus();
    });
  });

  search.addEventListener('input', () => { currentPage = 1; render(); });
  document.getElementById('page-prev').addEventListener('click', () => { currentPage -= 1; render(); });
  document.getElementById('page-next').addEventListener('click', () => { currentPage += 1; render(); });
  document.getElementById('form-cancel').addEventListener('click', clearForm);
  roleInput.addEventListener('change', updateRoleIcon);
  statusInput.addEventListener('change', updateStatusDot);
  nameInput.addEventListener('input', () => window.HospitalI18n.bindValidity(nameInput, () => ''));
  phoneInput.addEventListener('input', () => window.HospitalI18n.bindValidity(phoneInput, () => ''));

  rows.addEventListener('click', async event => {
    const button=event.target.closest('button[data-action]');
    if(!button || busy) return;
    try {
      const person=upsert(await api.get(`personnel/get.php?id=${encodeURIComponent(button.dataset.id)}`));
      if(button.dataset.action==='view') {showPerson(person);return;}
      if(button.dataset.action==='edit') {if(!person.archived)editPerson(person);return;}
      const restore=button.dataset.action==='restore';
      if(!window.confirm(restore ? window.HospitalI18n.t("personnel.restaurar_a_value", {value0: person.name}) : window.HospitalI18n.t("personnel.archivar_a_value_se_conservara_su_historial_y_podras_restaurarlo_desde_ver_archivados", {value0: person.name}))) return;
      setBusy(true);
      upsert(await api.post(`personnel/${restore?'restore':'archive'}.php`,{id:person.id,version:person.version}));
      if(editingId===person.id)clearForm();
      window.HospitalI18n.bindText(feedback, () => restore?window.HospitalI18n.t("personnel.registro_restaurado"):window.HospitalI18n.t("personnel.registro_eliminado_del_listado"));
    } catch(error) {report(error);} finally {setBusy(false);render();}
  });

  form.addEventListener('submit', async event => {
    event.preventDefault();
    if(busy) return;
    window.HospitalI18n.bindText(feedback, () => '');
    const name = nameInput.value.trim();
    const phone = phoneInput.value.trim();
    if (!name) {
      window.HospitalI18n.bindValidity(nameInput, () => window.HospitalI18n.t("personnel.ingresa_un_nombre"));
      nameInput.checkValidity();
      return;
    }
    if (phone.replace(/\D/g, '').length < 8) {
      window.HospitalI18n.bindValidity(phoneInput, () => window.HospitalI18n.t("personnel.ingresa_un_telefono_valido"));
      phoneInput.checkValidity();
      return;
    }
    if(!form.checkValidity()) return;
    const record={full_name:name,national_id:documentInput.value.trim(),phone,responsibility:roleCodes[roleInput.value],
      driving_license:licenseInput.value.trim(),availability:statusInput.value==='active'?'active':'inactive'};
    const wasEditing=Boolean(editingId);
    if(wasEditing)Object.assign(record,{id:editingId,version:editingVersion});
    setBusy(true);
    try {
      const saved=upsert(await api.post(`personnel/${wasEditing?'update':'create'}.php`,record));
      if(saved.role!==activeRole)switchRole(saved.role);else clearForm();
      archived=false; window.HospitalI18n.bindText(archiveToggle, () => window.HospitalI18n.t("personnel.ver_archivados"));archiveToggle.setAttribute('aria-pressed','false');
      search.value='';
      const rolePeople=people.filter(p=>p.role===activeRole && !p.archived);
      currentPage=Math.floor(rolePeople.findIndex(p=>p.id===saved.id)/pageSize)+1;
      window.HospitalI18n.bindText(feedback, () => wasEditing?window.HospitalI18n.t("personnel.registro_actualizado"):window.HospitalI18n.t("personnel.registro_guardado"));
    } catch(error) {report(error);} finally {setBusy(false);render();}

  });

  document.getElementById('dialog-close').addEventListener('click', () => dialog.close());
  dialog.addEventListener('click', event => { if (event.target === dialog) dialog.close(); });
  form.addEventListener('input',()=>{dirty=true;});
  form.addEventListener('change',()=>{dirty=true;});
  archiveToggle.addEventListener('click',()=>{
    archived=!archived;currentPage=1;clearForm();
    window.HospitalI18n.bindText(archiveToggle, () => archived?window.HospitalI18n.t("personnel.ver_activos"):window.HospitalI18n.t("personnel.ver_archivados"));archiveToggle.setAttribute('aria-pressed',String(archived));render();
  });
  window.addEventListener('focus',()=>{if(!busy && !dirty && !editingId && !dialog.open)refresh().catch(report);});
  async function start() {
    setBusy(true);updateRoleIcon();updateStatusDot();
    try {
      const session=await window.HospitalAuth.ready;
      if(!session)return;
      if(!session.user.roles.includes('dispatcher')){location.replace(api.page('src/views/management/management.html'));return;}
      await refresh();setBusy(false);
    } catch(error) {report(error);window.HospitalI18n.bindText(document.getElementById('list-count'), () => '');window.HospitalI18n.bindText(document.getElementById('results-summary'), () => '');}
  }
  start();
  window.addEventListener('hospital:localechange',()=>{render();});

});
