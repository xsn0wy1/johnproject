(() => {
  'use strict';

  const api = window.HospitalApi;
  let ambulances = [];
  const statusCodes = {OPERATIVA:'available', MANTENIMIENTO:'maintenance', FUERA_SERVICIO:'out_of_service'};
  const fromApi = a => ({...a, archived:a.status === 'archived',
    status:a.status === 'archived' ? 'FUERA_SERVICIO' : Object.keys(statusCodes).find(key=>statusCodes[key]===a.operational_status)});
  const $ = id => document.getElementById(id);
  const list = $('ambulance-list');
  const form = $('ambulance-form');
  if (!api || !list || !form) return;
  const workspace = $('ambulance-workspace');
  const directory = $('directory-panel');
  const detailPanel = $('detail-panel');
  const dialog = $('ambulance-dialog');
  const deleteDialog = $('delete-dialog');
  const filters = [...document.querySelectorAll('[data-filter]')];
  const labels = { OPERATIVA: 'Operativa', MANTENIMIENTO: 'Mantenimiento', FUERA_SERVICIO: 'Fuera de servicio' };
  const statusClasses = { OPERATIVA: 'operational', MANTENIMIENTO: 'maintenance', FUERA_SERVICIO: 'unavailable' };
  const pageSize = 5;
  let activeFilter = 'ALL', currentPage = 1, selectedId = null, editingId = null, deletingId = null;
  let editingVersion = null, deletingVersion = null, busy = false, toastTimer;

  const escapeHtml = value => String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
  const normalize = value => String(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('es').trim();
  const plateKey = value => value.toUpperCase().replace(/[ -]/g, '');
  const icon = (file, className = '') => `<img src="../../../assets/Icons/${file}" alt="" aria-hidden="true"${className ? ` class="${className}"` : ''}>`;
  const pill = ambulance => `<span class="status-pill status-pill--${statusClasses[ambulance.status]}">${ambulance.archived ? 'Archivada' : labels[ambulance.status]}</span>`;

  const report = error => api.report(error,'ambulances');
  function upsert(data) {
    const item=fromApi(data);
    if (ambulances.some(a=>a.id===item.id)) ambulances=ambulances.map(a=>a.id===item.id?item:a);
    else ambulances.unshift(item);
    return item;
  }
  function setBusy(value) {
    busy=value;
    [...form.elements, $('close-ambulance-dialog'), ...deleteDialog.querySelectorAll('button')].forEach(el=>{el.disabled=value;});
    $('new-ambulance').disabled=value;
  }
  async function refresh() {
    ambulances=(await api.get('ambulances/list.php')).map(fromApi); render();
  }
  async function openCurrent(id,edit=false) {
    try {
      const item=upsert(await api.get(`ambulances/get.php?id=${encodeURIComponent(id)}`));
      if (edit) { if (!item.archived) openForm(item); } else selectAmbulance(item.id);
    } catch(error) { report(error); }
  }

  function matchingAmbulances() {
    const query = normalize($('ambulance-search').value);
    const compact = query.replace(/[ -]/g, '');
    return ambulances.filter(ambulance => (activeFilter === 'ALL' ? !ambulance.archived : ambulance.status === activeFilter) &&
      (!query || normalize(ambulance.model).includes(query) || normalize(plateKey(ambulance.plate)).includes(compact)));
  }

  function render() {
    const matches = matchingAmbulances();
    const pageCount = Math.max(1, Math.ceil(matches.length / pageSize));
    currentPage = Math.min(currentPage, pageCount);
    const start = (currentPage - 1) * pageSize;
    const shown = matches.slice(start, start + pageSize);
    list.innerHTML = shown.map(ambulance => `<article class="ambulance-row${selectedId === ambulance.id ? ' is-selected' : ''}">
      <div class="ambulance-identity"><span class="ambulance-avatar">${icon('ambulance-icon.png')}</span><span><strong>${escapeHtml(ambulance.plate)}</strong><small>Unidad #${String(ambulance.id).padStart(3, '0')}</small></span></div>
      <div class="ambulance-info">${icon('brand-icon.svg')}<span><b>${escapeHtml(ambulance.model)}</b><small>Modelo del vehículo</small></span></div>
      <div class="ambulance-info">${icon('seats-icon.svg')}<span><b>${ambulance.capacity} plazas</b><small>Capacidad total</small></span></div>
      ${pill(ambulance)}
      <button type="button" class="row-action" data-select-id="${ambulance.id}" aria-label="Ver detalle de ${escapeHtml(ambulance.plate)}" aria-controls="detail-panel" aria-expanded="${selectedId === ambulance.id}">${icon('arrow-left.svg', 'chevron-icon')}</button>
    </article>`).join('');
    $('ambulance-empty').hidden = matches.length > 0;
    $('empty-description').textContent = ambulances.length ? 'No se encontraron ambulancias con estos criterios.' : 'No hay ambulancias registradas. Agrega una para comenzar.';
    $('clear-filters').hidden = ambulances.length === 0;
    $('results-summary').textContent = matches.length ? `Mostrando ${start + 1} a ${start + shown.length} de ${matches.length} ${matches.length === 1 ? 'ambulancia' : 'ambulancias'}` : 'Mostrando 0 ambulancias';
    let pages = '';
    for (let page = 1; page <= pageCount; page++) {
      pages += `<button type="button" data-page="${page}" class="${page === currentPage ? 'is-active' : ''}" aria-label="Página ${page}"${page === currentPage ? ' aria-current="page"' : ''}>${page}</button>`;
    }
    $('ambulance-pagination').innerHTML = `<button type="button" data-page="${currentPage - 1}" aria-label="Página anterior"${currentPage === 1 ? ' disabled' : ''}>‹</button>${pages}<button type="button" data-page="${currentPage + 1}" aria-label="Página siguiente"${currentPage === pageCount ? ' disabled' : ''}>›</button>`;
    filters.forEach(button => {
      const selected = button.dataset.filter === activeFilter;
      button.classList.toggle('is-active', selected);
      button.setAttribute('aria-pressed', String(selected));
    });
    $('metric-total').textContent = String(ambulances.filter(a=>!a.archived).length);
    [['operational', 'OPERATIVA'], ['maintenance', 'MANTENIMIENTO'], ['unavailable', 'FUERA_SERVICIO']].forEach(([id, status]) => {
      $(`metric-${id}`).textContent = String(ambulances.filter(ambulance => !ambulance.archived && ambulance.status === status).length);
    });
  }

  function closeDetail(restoreFocus = false) {
    const previousId = selectedId;
    selectedId = null;
    workspace.classList.remove('has-selection');
    detailPanel.inert = true;
    detailPanel.setAttribute('aria-hidden', 'true');
    directory.inert = false;
    render();
    if (restoreFocus) (list.querySelector(`[data-select-id="${previousId}"]`) || $('new-ambulance')).focus();
  }

  function selectAmbulance(id) {
    const ambulance = ambulances.find(item => item.id === id);
    if (!ambulance) return;
    selectedId = id;
    $('edit-from-detail').hidden=ambulance.archived;
    $('delete-from-detail').innerHTML=icon(ambulance.archived?'save-floppy.svg':'trash-icon.svg')+(ambulance.archived?'Restaurar':'Eliminar');
    $('detail-content').innerHTML = `<div class="detail-hero"><span class="ambulance-avatar">${icon('ambulance-icon.png')}</span><div class="detail-hero-text"><strong>${escapeHtml(ambulance.plate)}</strong><p>${escapeHtml(ambulance.model)}</p><p>Unidad #${String(ambulance.id).padStart(3, '0')}</p></div>${pill(ambulance)}</div>
      <div class="detail-grid"><section class="detail-card"><h3>Información general</h3><dl>
        <dt>${icon('id-badge.svg')}Matrícula</dt><dd>${escapeHtml(ambulance.plate)}</dd>
        <dt>${icon('brand-icon.svg')}Modelo</dt><dd>${escapeHtml(ambulance.model)}</dd>
        <dt>${icon('seats-icon.svg')}Capacidad</dt><dd>${ambulance.capacity} plazas</dd>
        <dt>${icon('information-icon.svg')}Estado operativo</dt><dd>${labels[ambulance.status]}</dd>
      </dl></section></div>`;
    detailPanel.inert = false;
    detailPanel.setAttribute('aria-hidden', 'false');
    workspace.classList.add('has-selection');
    render();
    $('close-detail').focus();
    directory.inert = true;
  }

  function clearError() {
    $('form-error').hidden = true;
    [...form.elements].forEach(element => element.setCustomValidity?.(''));
  }

  function openForm(ambulance = null) {
    closeDetail();
    form.reset(); clearError();
    editingId = ambulance?.id ?? null;
    editingVersion = ambulance?.version ?? null;
    $('ambulance-form-title').textContent = ambulance ? 'Editar ambulancia' : 'Nueva ambulancia';
    $('form-subtitle').textContent = ambulance ? `Actualiza los datos de la unidad ${ambulance.plate}.` : 'Completa los datos del vehículo.';
    $('save-label').textContent = ambulance ? 'Guardar cambios' : 'Guardar ambulancia';
    if (ambulance) {
      form.elements.matricula.value = ambulance.plate;
      form.elements.modelo.value = ambulance.model;
      form.elements.capacidad.value = ambulance.capacity;
      form.elements.estado_operativo.value = ambulance.status;
    }
    dialog.showModal();
    $('ambulance-plate').focus();
  }

  function toast(message) {
    clearTimeout(toastTimer);
    $('ambulance-toast').textContent = message;
    $('ambulance-toast').hidden = false;
    toastTimer = setTimeout(() => { $('ambulance-toast').hidden = true; }, 4000);
  }

  form.addEventListener('input', clearError);
  form.addEventListener('change', clearError);
  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (busy) return;
    clearError();
    const ambulance = {
      plate: plateKey(form.elements.matricula.value.trim()),
      model: form.elements.modelo.value.trim(),
      capacity: Number(form.elements.capacidad.value),
      status: form.elements.estado_operativo.value
    };
    if (!ambulance.model) form.elements.modelo.setCustomValidity('Ingresa el modelo del vehículo.');
    if (!/^[A-Z0-9]+$/.test(ambulance.plate)) form.elements.matricula.setCustomValidity('Ingresa una matrícula válida.');
    if (!Number.isInteger(ambulance.capacity) || ambulance.capacity < 1 || ambulance.capacity > 99) form.elements.capacidad.setCustomValidity('Ingresa una capacidad de 1 a 99 plazas.');
    if (ambulances.some(item => item.id !== editingId && plateKey(item.plate) === ambulance.plate)) {
      form.elements.matricula.setCustomValidity('Ya existe una ambulancia con esa matrícula.');
      console.error('Ya existe una ambulancia con esa matrícula.');
    }
    if (!form.checkValidity()) return;
    const wasEditing = editingId !== null;
    const payload={plate:ambulance.plate,model:ambulance.model,capacity:ambulance.capacity,operational_status:statusCodes[ambulance.status]};
    if (wasEditing) Object.assign(payload,{id:editingId,version:editingVersion});
    setBusy(true);
    try {
      const saved=upsert(await api.post(`ambulances/${wasEditing?'update':'create'}.php`,payload));
      activeFilter='ALL'; $('ambulance-search').value='';
      currentPage=Math.floor(matchingAmbulances().findIndex(item=>item.id===saved.id)/pageSize)+1;
      dialog.close(); render();
      toast(wasEditing?`Ambulancia ${saved.plate} actualizada.`:`Ambulancia ${saved.plate} agregada.`);
    } catch(error) { report(error); } finally { setBusy(false); }

  });

  $('new-ambulance').addEventListener('click', () => openForm());
  $('close-ambulance-dialog').addEventListener('click', () => dialog.close());
  $('cancel-ambulance').addEventListener('click', () => dialog.close());
  dialog.addEventListener('close', () => { editingId = null; $('new-ambulance').focus(); });
  $('edit-from-detail').addEventListener('click', () => openCurrent(selectedId,true));
  $('delete-from-detail').addEventListener('click', () => {
    const ambulance = ambulances.find(item => item.id === selectedId);
    if (!ambulance) return;
    deletingId = ambulance.id;
    deletingVersion = ambulance.version;
    $('delete-title').textContent=ambulance.archived?'¿Restaurar esta ambulancia?':'¿Eliminar esta ambulancia?';
    $('confirm-delete').textContent=ambulance.archived?'Restaurar ambulancia':'Eliminar ambulancia';
    $('delete-description').textContent = ambulance.archived ? `La unidad ${ambulance.plate} volverá al listado con su estado operativo anterior. ¿Deseas continuar?` : `Se archivará la unidad ${ambulance.plate} (${ambulance.model}). Se conservará su historial y podrás restaurarla desde Fuera de servicio. ¿Deseas continuar?`;
    deleteDialog.showModal();
  });
  document.querySelectorAll('[data-close-delete]').forEach(button => button.addEventListener('click', () => deleteDialog.close()));
  deleteDialog.addEventListener('close', () => { deletingId = null; });
  $('confirm-delete').addEventListener('click', async () => {
    const ambulance = ambulances.find(item => item.id === deletingId);
    if (!ambulance) return;
    if (busy) return;
    setBusy(true);
    try {
      upsert(await api.post(`ambulances/${ambulance.archived?'restore':'archive'}.php`,{id:ambulance.id,version:deletingVersion}));
      closeDetail(); deleteDialog.close(); render();
      toast(`Ambulancia ${ambulance.plate} ${ambulance.archived?'restaurada':'eliminada del listado'}.`);
    } catch(error) { report(error); } finally { setBusy(false); $('new-ambulance').focus(); }

  });
  list.addEventListener('click', event => {
    const button = event.target.closest('[data-select-id]');
    if (button) openCurrent(button.dataset.selectId);
  });
  $('close-detail').addEventListener('click', () => closeDetail(true));
  workspace.addEventListener('click', event => { if (event.target === workspace && selectedId !== null) closeDetail(true); });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && selectedId !== null && !dialog.open && !deleteDialog.open) closeDetail(true);
  });
  $('ambulance-search').addEventListener('input', () => { currentPage = 1; render(); });
  filters.forEach(button => button.addEventListener('click', () => { activeFilter = button.dataset.filter; currentPage = 1; render(); }));
  $('clear-filters').addEventListener('click', () => { activeFilter = 'ALL'; currentPage = 1; $('ambulance-search').value = ''; render(); });
  $('ambulance-pagination').addEventListener('click', event => {
    const button = event.target.closest('[data-page]');
    if (button && !button.disabled) { currentPage = Number(button.dataset.page); render(); }
  });
  [dialog,deleteDialog].forEach(modal=>modal.addEventListener('cancel',event=>{if(busy)event.preventDefault();}));
  async function start() {
    $('new-ambulance').disabled=true; render(); $('ambulance-empty').hidden=true;
    $('results-summary').textContent='Cargando ambulancias…';
    try {
      const session=await window.HospitalAuth.ready;
      if (!session) return;
      if (!session.user.roles.includes('dispatcher')) {location.replace(api.page('src/views/management/management.html'));return;}
      await refresh(); $('new-ambulance').disabled=false;
    } catch(error) { report(error); $('results-summary').textContent=''; }
  }
  window.addEventListener('focus',()=>{if(!busy && !dialog.open && !deleteDialog.open && !selectedId && !$('new-ambulance').disabled)refresh().catch(report);});
  start();
})();
