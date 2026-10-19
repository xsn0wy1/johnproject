document.addEventListener('DOMContentLoaded', () => {
  const api=window.HospitalApi;
  const pageSize=6;
  const iconBase='../../../assets/Icons/';
  const typeCodes={Hospital:'hospital',Sanatorio:'sanatorium','Centro de salud':'health_center',Otro:'other'};
  const fromApi=d=>({...d,type:Object.keys(typeCodes).find(k=>typeCodes[k]===d.facility_type),archived:d.status==='archived',
    status:d.status==='active' && d.availability==='active'?'Activo':'Inactivo'});
  const rows = document.getElementById('destinations-rows');
  const search = document.getElementById('destinations-search');
  const form = document.getElementById('destinations-form');
  const nameInput = document.getElementById('destination-name');
  const addressInput = document.getElementById('destination-address');
  const localityInput = document.getElementById('destination-locality');
  const typeInput = document.getElementById('destination-type');
  const phoneInput = document.getElementById('destination-phone');
  const notesInput = document.getElementById('destination-notes');
  const statusInput = document.getElementById('destination-status');
  const feedback = document.getElementById('form-feedback');
  const detailDialog = document.getElementById('destination-dialog');
  const deleteDialog = document.getElementById('delete-dialog');
  const filterButtons = [...document.querySelectorAll('[data-filter]')];
  if (!api || !rows || !search || !form || !detailDialog || !deleteDialog) return;

  let destinations = [];
  let busy=false,dirty=false,editingVersion=null,deletingVersion=null;
  let activeFilter = 'Activo';
  let currentPage = 1;
  let editingId = null;
  let detailId = null;
  let deletingId = null;

  const report=error=>api.report(error,'destinations');
  function upsert(data) {
    const item=fromApi(data);
    if(destinations.some(d=>d.id===item.id))destinations=destinations.map(d=>d.id===item.id?item:d);
    else destinations.push(item);
    return item;
  }
  function setBusy(value) {
    busy=value;
    [...form.elements,...rows.querySelectorAll('button'),...filterButtons,...deleteDialog.querySelectorAll('button')].forEach(el=>{el.disabled=value;});
  }
  async function refresh(){destinations=(await api.get('destinations/list.php')).map(fromApi);render();}
  async function current(id,action) {
    if(busy)return;
    try {
      const item=upsert(await api.get(`destinations/get.php?id=${encodeURIComponent(id)}`));
      if(action==='view')showDestination(item);
      else if(action==='edit' && !item.archived)editDestination(item);
      else if(action==='delete' || action==='restore')confirmDeletion(item);
    } catch(error){report(error);}
  }

  function normalize(value) {
    return value.toLocaleLowerCase('es').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .replace(/\s+/g, ' ').trim();
  }

  function getMatchingDestinations() {
    const words = normalize(search.value).split(' ').filter(Boolean);
    return destinations.filter(destination => {
      const content = normalize(`${destination.name} ${destination.address} ${destination.locality} ${destination.type} ${destination.phone}`);
      return destination.status === activeFilter &&
        words.every(word => content.includes(word));
    });
  }

  function makeIcon(file) {
    const icon = document.createElement('img');
    icon.src = iconBase + file;
    icon.alt = '';
    icon.setAttribute('aria-hidden', 'true');
    return icon;
  }

  function makeCell(text) {
    const cell = document.createElement('td');
    cell.textContent = text;
    cell.title = text;
    return cell;
  }

  function makeAction(action, label, icon, destination) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'row-action';
    button.dataset.action = action;
    button.dataset.id = destination.id;
    button.setAttribute('aria-label', `${label} ${destination.name}`);
    button.title = `${label} ${destination.name}`;
    button.append(makeIcon(icon));
    return button;
  }

  function makeRow(destination) {
    const row = document.createElement('tr');
    row.classList.toggle('is-editing', destination.id === editingId);
    const nameCell = document.createElement('td');
    const nameContent = document.createElement('span');
    nameContent.className = 'destination-name-cell';
    const avatar = document.createElement('span');
    avatar.className = 'destination-avatar';
    avatar.append(makeIcon('location-icon.svg'));
    const copy = document.createElement('span');
    copy.className = 'destination-copy';
    const name = document.createElement('strong');
    name.textContent = destination.name;
    name.title = destination.name;
    const type = document.createElement('small');
    type.textContent = destination.type;
    copy.append(name, type);
    nameContent.append(avatar, copy);
    nameCell.append(nameContent);

    const statusCell = document.createElement('td');
    const status = document.createElement('span');
    status.className = 'status-text';
    const dot = document.createElement('span');
    dot.className = 'status-dot' + (destination.status === 'Inactivo' ? ' is-inactive' : '');
    dot.setAttribute('aria-hidden', 'true');
    status.append(dot, document.createTextNode(destination.archived?'Archivado':destination.status));
    statusCell.append(status);

    const actionsCell = document.createElement('td');
    const actions = document.createElement('div');
    actions.className = 'row-actions';
    actions.append(makeAction('view','Ver','eye.svg',destination));
    if(destination.archived)actions.append(makeAction('restore','Restaurar','save-floppy.svg',destination));
    else actions.append(makeAction('edit','Editar','pencil-icon.svg',destination),makeAction('delete','Eliminar','trash-icon.svg',destination));
    actionsCell.append(actions);
    row.append(nameCell, makeCell(destination.address), makeCell(destination.locality), statusCell, actionsCell);
    return row;
  }

  function render() {
    const matching = getMatchingDestinations();
    const pageCount = Math.max(1, Math.ceil(matching.length / pageSize));
    currentPage = Math.max(1, Math.min(currentPage, pageCount));
    const start = (currentPage - 1) * pageSize;
    const visible = matching.slice(start, start + pageSize);
    rows.replaceChildren(...visible.map(makeRow));

    const statusCount = destinations.filter(destination => destination.status === activeFilter).length;
    document.getElementById('list-title').textContent = `Destinos ${activeFilter === 'Activo' ? 'activos' : 'inactivos'}`;
    document.getElementById('list-count').textContent =
      `Total de ${statusCount} ${statusCount === 1 ? 'destino registrado' : 'destinos registrados'}.`;
    document.getElementById('results-summary').textContent = matching.length
      ? `Mostrando ${start + 1} a ${start + visible.length} de ${matching.length} resultados`
      : 'Mostrando 0 resultados';
    document.getElementById('page-number').textContent = String(currentPage);
    document.getElementById('page-prev').disabled = currentPage === 1;
    document.getElementById('page-next').disabled = currentPage === pageCount;

    const noRecords = destinations.length === 0;
    document.getElementById('empty-state').hidden = matching.length > 0;
    document.getElementById('empty-title').textContent = noRecords ? 'Aún no hay destinos' : 'No se encontraron destinos';
    document.getElementById('empty-description').textContent = noRecords
      ? 'Agrega el primer destino desde el formulario.' : 'Prueba con otro nombre, dirección, localidad o estado.';
    document.getElementById('empty-action').textContent = noRecords ? 'Agregar destino' : 'Limpiar búsqueda';
  }

  function showFeedback(message, tone = '') {
    if (tone === 'error') { console.error(message); feedback.textContent = ''; return; }
    feedback.textContent = message;
    feedback.className = 'form-feedback' + (tone ? ` is-${tone}` : '');
  }

  function updateStatus() {
    const inactive = statusInput.value === 'Inactivo';
    document.getElementById('form-status-dot').classList.toggle('is-inactive', inactive);
  }

  function clearForm() {
    form.reset();
    editingId = null; editingVersion=null;dirty=false;
    document.getElementById('form-title').textContent = 'Agregar destino';
    document.getElementById('form-subtitle').textContent = 'Completa la información del destino.';
    document.getElementById('save-label').textContent = 'Guardar';
    [nameInput, addressInput, localityInput, phoneInput].forEach(input => input.setCustomValidity(''));
    showFeedback('');
    updateStatus();
  }

  function setFilter(filter) {
    activeFilter = filter;
    currentPage = 1;
    filterButtons.forEach(button => {
      const selected = button.dataset.filter === filter;
      button.classList.toggle('is-active', selected);
      button.setAttribute('aria-pressed', String(selected));
    });
    render();
  }

  function editDestination(destination) {
    clearForm();
    editingId = destination.id; editingVersion=destination.version;
    document.getElementById('form-title').textContent = 'Editar destino';
    document.getElementById('form-subtitle').textContent = 'Actualiza la información del destino.';
    document.getElementById('save-label').textContent = 'Actualizar';
    nameInput.value = destination.name;
    addressInput.value = destination.address;
    localityInput.value = destination.locality;
    typeInput.value = destination.type;
    phoneInput.value = destination.phone;
    notesInput.value = destination.notes;
    statusInput.value = destination.status;
    updateStatus();
    render();
    nameInput.focus();
  }

  function showDestination(destination) {
    detailId = destination.id;
    document.getElementById('detail-edit').hidden=destination.archived;
    const details = document.getElementById('dialog-details');
    details.replaceChildren();
    [
      ['Nombre', destination.name], ['Tipo', destination.type], ['Dirección', destination.address],
      ['Localidad', destination.locality], ['Teléfono', destination.phone || 'Sin teléfono registrado'],
      ['Estado', destination.archived?'Archivado':destination.status], ['Acceso', destination.notes || 'Sin referencia de acceso']
    ].forEach(([label, value]) => {
      const term = document.createElement('dt');
      const description = document.createElement('dd');
      term.textContent = label;
      description.textContent = value;
      details.append(term, description);
    });
    detailDialog.showModal();
  }

  function confirmDeletion(destination) {
    deletingId = destination.id;deletingVersion=destination.version;
    document.getElementById('delete-title').textContent=destination.archived?'Restaurar destino':'Eliminar destino';
    document.getElementById('delete-confirm').querySelector('span').textContent=destination.archived?'Restaurar destino':'Eliminar destino';
    document.getElementById('delete-description').textContent =
      destination.archived?`¿Restaurar “${destination.name}” con su estado anterior?`:`¿Archivar “${destination.name}”? Se conservará el historial y podrás restaurarlo desde Inactivos.`;
    deleteDialog.showModal();
  }

  filterButtons.forEach(button => button.addEventListener('click', () => setFilter(button.dataset.filter)));
  search.addEventListener('input', () => { currentPage = 1; render(); });
  document.getElementById('page-prev').addEventListener('click', () => { currentPage -= 1; render(); });
  document.getElementById('page-next').addEventListener('click', () => { currentPage += 1; render(); });
  document.getElementById('form-cancel').addEventListener('click', () => { clearForm(); render(); });
  statusInput.addEventListener('change', updateStatus);
  [nameInput, addressInput, localityInput, phoneInput].forEach(input => {
    input.addEventListener('input', () => { input.setCustomValidity(''); showFeedback(''); });
  });
  document.getElementById('empty-action').addEventListener('click', () => {
    search.value = '';
    currentPage = 1;
    render();
    if (destinations.length === 0) { clearForm(); nameInput.focus(); }
    else search.focus();
  });

  rows.addEventListener('click',event=>{
    const button=event.target.closest('button[data-action]');
    if(button)current(button.dataset.id,button.dataset.action);
  });

  form.addEventListener('submit', async event => {
    event.preventDefault();if(busy)return;showFeedback('');
    const requiredInputs = [
      [nameInput, 'Ingresa el nombre del destino.'],
      [addressInput, 'Ingresa la dirección del destino.'],
      [localityInput, 'Ingresa la localidad del destino.']
    ];
    for (const [input, message] of requiredInputs) {
      if (!input.value.trim()) {
        input.setCustomValidity(message);
        input.checkValidity();
        showFeedback(message, 'error');
        return;
      }
    }
    const phone = phoneInput.value.trim();
    if (phone && (!/^\+?[\d\s().-]+$/.test(phone) || phone.replace(/\D/g, '').length < 8 || phone.replace(/\D/g, '').length > 15)) {
      phoneInput.setCustomValidity('Ingresa un teléfono de 8 a 15 dígitos o deja el campo vacío.');
      phoneInput.checkValidity();
      showFeedback('Revisa el teléfono de contacto.', 'error');
      return;
    }
    if(!form.checkValidity())return;
    const record={name:nameInput.value.trim(),address:addressInput.value.trim(),locality:localityInput.value.trim(),
      facility_type:typeCodes[typeInput.value],phone,notes:notesInput.value.trim(),availability:statusInput.value==='Activo'?'active':'inactive'};
    const wasEditing=editingId!==null;
    if(wasEditing)Object.assign(record,{id:editingId,version:editingVersion});
    setBusy(true);
    try {
      const saved=upsert(await api.post(`destinations/${wasEditing?'update':'create'}.php`,record));
      clearForm();search.value='';setFilter(saved.status);
      currentPage=Math.floor(getMatchingDestinations().findIndex(d=>d.id===saved.id)/pageSize)+1;
      showFeedback(wasEditing?'Destino actualizado.':'Destino guardado.');
    } catch(error){report(error);}finally{setBusy(false);render();}

  });

  document.getElementById('detail-close').addEventListener('click', () => detailDialog.close());
  document.getElementById('detail-edit').addEventListener('click',()=>{detailDialog.close();current(detailId,'edit');});
  ['delete-close', 'delete-cancel'].forEach(id => {
    document.getElementById(id).addEventListener('click', () => deleteDialog.close());
  });
  document.getElementById('delete-confirm').addEventListener('click', async () => {
    const destination = destinations.find(item => item.id === deletingId);
    if (!destination) { deleteDialog.close(); return; }
    if(busy)return;
    setBusy(true);
    try {
      upsert(await api.post(`destinations/${destination.archived?'restore':'archive'}.php`,{id:destination.id,version:deletingVersion}));
      if(editingId===destination.id)clearForm();
      deleteDialog.close();showFeedback(destination.archived?'Destino restaurado.':'Destino eliminado del listado.');
    } catch(error){report(error);}finally{setBusy(false);render();}

  });
  deleteDialog.addEventListener('close', () => { deletingId = null; });
  [detailDialog, deleteDialog].forEach(dialog => {
    dialog.addEventListener('click', event => {
      if (event.target !== dialog || busy) return;
      const bounds = dialog.getBoundingClientRect();
      if (event.clientX < bounds.left || event.clientX > bounds.right ||
          event.clientY < bounds.top || event.clientY > bounds.bottom) dialog.close();
    });
  });

  form.addEventListener('input',()=>{dirty=true;});form.addEventListener('change',()=>{dirty=true;});
  deleteDialog.addEventListener('cancel',event=>{if(busy)event.preventDefault();});
  window.addEventListener('focus',()=>{if(!busy && !dirty && !editingId && !detailDialog.open && !deleteDialog.open)refresh().catch(report);});
  async function start(){
    setBusy(true);updateStatus();document.getElementById('list-count').textContent='Cargando destinos…';
    try {
      const session=await window.HospitalAuth.ready;if(!session)return;
      if(!session.user.roles.includes('dispatcher')){location.replace(api.page('src/views/management/management.html'));return;}
      await refresh();setBusy(false);
    } catch(error){report(error);document.getElementById('list-count').textContent='';}
  }
  start();
});
