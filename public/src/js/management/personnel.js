document.addEventListener('DOMContentLoaded', () => {
  const api = window.HospitalApi;
  const pageSize = 6;
  const iconBase = '../../../assets/Icons/';
  const roleCodes = {Chofer:'driver',Copiloto:'copilot'};
  const fromApi = p => ({...p,name:p.full_name,document:p.national_id,license:p.driving_license,
    role:p.responsibility==='driver'?'Chofer':'Copiloto',archived:p.status==='archived',
    status:p.availability==='active' && p.staff_status==='active'?'Activo':'Inactivo'});
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
  let activeRole = 'Chofer';
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
    image.alt = '';
    image.setAttribute('aria-hidden', 'true');
    return image;
  }

  function makeCell(text) {
    const cell = document.createElement('td');
    cell.textContent = text;
    return cell;
  }

  function makeAction(action, label, icon, person) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'row-action';
    button.dataset.action = action;
    button.dataset.id = person.id;
    button.setAttribute('aria-label', `${label} ${person.name}`);
    button.title = `${label} ${person.name}`;
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
    avatar.append(makeIcon(person.role === 'Chofer' ? 'steering-wheel.svg' : 'person-icon.svg'));
    const name = document.createElement('span');
    name.textContent = person.name;
    nameContent.append(avatar, name);
    nameCell.append(nameContent);

    const statusCell = document.createElement('td');
    const status = document.createElement('span');
    status.className = 'status-text';
    const dot = document.createElement('span');
    dot.className = 'status-dot' + (person.archived || person.status === 'Inactivo' ? ' is-inactive' : '');
    dot.setAttribute('aria-hidden', 'true');
    const statusLabel = document.createElement('span');
    statusLabel.textContent = person.archived ? 'Archivado' : person.status;
    status.append(dot, statusLabel);
    statusCell.append(status);

    const actionsCell = document.createElement('td');
    const actions = document.createElement('div');
    actions.className = 'row-actions';
    actions.append(makeAction('view','Ver','eye.svg',person));
    if(person.archived) actions.append(makeAction('restore','Restaurar','save-floppy.svg',person));
    else actions.append(makeAction('edit','Editar','pencil-icon.svg',person),makeAction('delete','Eliminar','trash-icon.svg',person));
    actionsCell.append(actions);

    row.append(nameCell, makeCell(person.role), makeCell(person.phone),
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

    const plural = activeRole === 'Chofer' ? 'choferes' : 'copilotos';
    document.getElementById('list-title').textContent = `Listado de ${plural}`;
    document.getElementById('list-count').textContent = `Total de ${rolePeople.length} ${plural} ${archived ? "archivados" : "registrados"}.`;
    document.getElementById('personnel-list').setAttribute('aria-labelledby', activeRole === 'Chofer' ? 'tab-chofer' : 'tab-copiloto');
    document.getElementById('results-summary').textContent = matching.length
      ? `Mostrando ${start + 1} a ${start + visible.length} de ${matching.length} resultados`
      : 'Mostrando 0 resultados';
    document.getElementById('empty-state').hidden = matching.length > 0;
    document.getElementById('page-number').textContent = String(currentPage);
    document.getElementById('page-prev').disabled = currentPage === 1;
    document.getElementById('page-next').disabled = currentPage === pageCount;
  }

  function updateRoleIcon() {
    document.getElementById('role-icon').src = iconBase +
      (roleInput.value === 'Chofer' ? 'steering-wheel.svg' : 'person-icon.svg');
    licenseInput.required = roleInput.value === 'Chofer';
  }

  function updateStatusDot() {
    document.getElementById('form-status-dot').classList.toggle('is-inactive', statusInput.value === 'Inactivo');
  }

  function clearForm() {
    form.reset();
    editingId = null;
    editingVersion = null; dirty = false;
    formTitle.textContent = 'Agregar personal';
    formSubtitle.textContent = 'Completa la información del personal.';
    roleInput.value = activeRole;
    documentInput.required = true;
    feedback.textContent = '';
    nameInput.setCustomValidity('');
    phoneInput.setCustomValidity('');
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
      ['Nombre', person.name], ['Rol', person.role], ['Teléfono', person.phone],
      ['Documento', person.document || '—'], ['Licencia', person.license || '—'], ['Estado', person.status]
    ].forEach(([label, value]) => {
      const term = document.createElement('dt');
      const description = document.createElement('dd');
      term.textContent = label;
      description.textContent = value;
      details.append(term, description);
    });
    dialog.showModal();
  }

  function editPerson(person) {
    if (person.role !== activeRole) switchRole(person.role);
    clearForm();
    editingId = person.id; editingVersion = person.version;
    formTitle.textContent = 'Editar personal';
    formSubtitle.textContent = 'Actualiza la información del personal.';
    nameInput.value = person.name;
    roleInput.value = person.role;
    phoneInput.value = person.phone;
    documentInput.value = person.document;
    documentInput.required = true;
    licenseInput.value = person.license;
    statusInput.value = person.status;
    feedback.textContent = '';
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
        const nextRole = activeRole === 'Chofer' ? 'Copiloto' : 'Chofer';
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
  nameInput.addEventListener('input', () => nameInput.setCustomValidity(''));
  phoneInput.addEventListener('input', () => phoneInput.setCustomValidity(''));

  rows.addEventListener('click', async event => {
    const button=event.target.closest('button[data-action]');
    if(!button || busy) return;
    try {
      const person=upsert(await api.get(`personnel/get.php?id=${encodeURIComponent(button.dataset.id)}`));
      if(button.dataset.action==='view') {showPerson(person);return;}
      if(button.dataset.action==='edit') {if(!person.archived)editPerson(person);return;}
      const restore=button.dataset.action==='restore';
      if(!window.confirm(restore ? `¿Restaurar a ${person.name}?` : `¿Archivar a ${person.name}? Se conservará su historial y podrás restaurarlo desde Ver archivados.`)) return;
      setBusy(true);
      upsert(await api.post(`personnel/${restore?'restore':'archive'}.php`,{id:person.id,version:person.version}));
      if(editingId===person.id)clearForm();
      feedback.textContent=restore?'Registro restaurado.':'Registro eliminado del listado.';
    } catch(error) {report(error);} finally {setBusy(false);render();}
  });

  form.addEventListener('submit', async event => {
    event.preventDefault();
    if(busy) return;
    feedback.textContent='';
    const name = nameInput.value.trim();
    const phone = phoneInput.value.trim();
    if (!name) {
      nameInput.setCustomValidity('Ingresa un nombre.');
      nameInput.checkValidity();
      return;
    }
    if (phone.replace(/\D/g, '').length < 8) {
      phoneInput.setCustomValidity('Ingresa un teléfono válido.');
      phoneInput.checkValidity();
      return;
    }
    if(!form.checkValidity()) return;
    const record={full_name:name,national_id:documentInput.value.trim(),phone,responsibility:roleCodes[roleInput.value],
      driving_license:licenseInput.value.trim(),availability:statusInput.value==='Activo'?'active':'inactive'};
    const wasEditing=Boolean(editingId);
    if(wasEditing)Object.assign(record,{id:editingId,version:editingVersion});
    setBusy(true);
    try {
      const saved=upsert(await api.post(`personnel/${wasEditing?'update':'create'}.php`,record));
      if(saved.role!==activeRole)switchRole(saved.role);else clearForm();
      archived=false; archiveToggle.textContent='Ver archivados';archiveToggle.setAttribute('aria-pressed','false');
      search.value='';
      const rolePeople=people.filter(p=>p.role===activeRole && !p.archived);
      currentPage=Math.floor(rolePeople.findIndex(p=>p.id===saved.id)/pageSize)+1;
      feedback.textContent=wasEditing?'Registro actualizado.':'Registro guardado.';
    } catch(error) {report(error);} finally {setBusy(false);render();}

  });

  document.getElementById('dialog-close').addEventListener('click', () => dialog.close());
  dialog.addEventListener('click', event => { if (event.target === dialog) dialog.close(); });
  form.addEventListener('input',()=>{dirty=true;});
  form.addEventListener('change',()=>{dirty=true;});
  archiveToggle.addEventListener('click',()=>{
    archived=!archived;currentPage=1;clearForm();
    archiveToggle.textContent=archived?'Ver activos':'Ver archivados';archiveToggle.setAttribute('aria-pressed',String(archived));render();
  });
  window.addEventListener('focus',()=>{if(!busy && !dirty && !editingId && !dialog.open)refresh().catch(report);});
  async function start() {
    setBusy(true);updateRoleIcon();updateStatusDot();
    try {
      const session=await window.HospitalAuth.ready;
      if(!session)return;
      if(!session.user.roles.includes('dispatcher')){location.replace(api.page('src/views/management/management.html'));return;}
      await refresh();setBusy(false);
    } catch(error) {report(error);document.getElementById('list-count').textContent='';document.getElementById('results-summary').textContent='';}
  }
  start();
});
