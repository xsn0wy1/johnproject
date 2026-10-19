(async () => {
  'use strict';
    const i18nSourceUrl = document.currentScript.src;
    await window.HospitalI18n.ready;
    await window.HospitalAuth.ready;


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
  const labels = { get OPERATIVA() { return window.HospitalI18n.t("ambulances.operativa"); }, get MANTENIMIENTO() { return window.HospitalI18n.t("ambulances.mantenimiento"); }, get FUERA_SERVICIO() { return window.HospitalI18n.t("ambulances.fuera_de_servicio"); } };
  const statusClasses = { OPERATIVA: 'operational', MANTENIMIENTO: 'maintenance', FUERA_SERVICIO: 'unavailable' };
  const pageSize = 5;
  let activeFilter = 'ALL', currentPage = 1, selectedId = null, editingId = null, deletingId = null;
  let editingVersion = null, deletingVersion = null, busy = false, toastTimer;

  const escapeHtml = value => String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
  const normalize = value => String(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('es').trim();
  const plateKey = value => value.toUpperCase().replace(/[ -]/g, '');
  const icon = (file, className = '') => `<img src="../../../assets/Icons/${file}" alt="" aria-hidden="true"${className ? ` class="${className}"` : ''}>`;
  const pill = ambulance => `<span class="status-pill status-pill--${statusClasses[ambulance.status]}">${ambulance.archived ? window.HospitalI18n.t("ambulances.archivada") : labels[ambulance.status]}</span>`;

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
    window.HospitalI18n.setHTML(list, shown.map(ambulance => `<article class="ambulance-row${selectedId === ambulance.id ? ' is-selected' : ''}">
      <div class="ambulance-identity"><span class="ambulance-avatar">${icon('ambulance-icon.png')}</span><span><strong>${escapeHtml(ambulance.plate)}</strong><small>${window.HospitalI18n.mark("ambulances.unidad_value", {value0: String(ambulance.id).padStart(3, '0')})}</small></span></div>
      <div class="ambulance-info">${icon('brand-icon.svg')}<span><b>${escapeHtml(ambulance.model)}</b><small>${window.HospitalI18n.mark("ambulances.modelo_del_vehiculo")}</small></span></div>
      <div class="ambulance-info">${icon('seats-icon.svg')}<span><b>${window.HospitalI18n.mark("ambulances.value_plazas", {value0: ambulance.capacity})}</b><small>${window.HospitalI18n.mark("ambulances.capacidad_total")}</small></span></div>
      ${pill(ambulance)}
      <button type="button" class="row-action" data-select-id="${ambulance.id}" aria-label="${window.HospitalI18n.html("ambulances.ver_detalle_de_value", {value0: ambulance.plate})}" data-i18n-aria-label="ambulances.ver_detalle_de_value" data-i18n-aria-label-params="${window.HospitalI18n.escape(JSON.stringify({value0: ambulance.plate}))}" aria-controls="detail-panel" aria-expanded="${selectedId === ambulance.id}">${icon('arrow-left.svg', 'chevron-icon')}</button>
    </article>`).join(''));
    $('ambulance-empty').hidden = matches.length > 0;
    window.HospitalI18n.bindText($('empty-description'), () => ambulances.length ? window.HospitalI18n.t("ambulances.no_se_encontraron_ambulancias_con_estos_criterios") : window.HospitalI18n.t("ambulances.no_hay_ambulancias_registradas_agrega_una_para_comenzar"));
    $('clear-filters').hidden = ambulances.length === 0;
    window.HospitalI18n.bindText($('results-summary'), () => matches.length ? window.HospitalI18n.t("ambulances.mostrando_value_a_value_de_value_value", {value0: start + 1, value1: start + shown.length, value2: matches.length, value3: matches.length === 1 ? window.HospitalI18n.t("shared.ambulancia") : window.HospitalI18n.t("shared.ambulancias")}) : window.HospitalI18n.t("ambulances.mostrando_0_ambulancias"));
    let pages = '';
    for (let page = 1; page <= pageCount; page++) {
      pages += `<button type="button" data-page="${page}" class="${page === currentPage ? 'is-active' : ''}" aria-label="${window.HospitalI18n.html("ambulances.pagina_value", {value0: page})}" data-i18n-aria-label="ambulances.pagina_value" data-i18n-aria-label-params="${window.HospitalI18n.escape(JSON.stringify({value0: page}))}"${page === currentPage ? ' aria-current="page"' : ''}>${page}</button>`;
    }
    window.HospitalI18n.setHTML($('ambulance-pagination'), `<button type="button" data-page="${currentPage - 1}" aria-label="${window.HospitalI18n.html("trace.pagina_anterior")}" data-i18n-aria-label="trace.pagina_anterior"${currentPage === 1 ? ' disabled' : ''}>‹</button>${pages}<button type="button" data-page="${currentPage + 1}" aria-label="${window.HospitalI18n.html("trace.pagina_siguiente")}" data-i18n-aria-label="trace.pagina_siguiente"${currentPage === pageCount ? ' disabled' : ''}>›</button>`);
    filters.forEach(button => {
      const selected = button.dataset.filter === activeFilter;
      button.classList.toggle('is-active', selected);
      button.setAttribute('aria-pressed', String(selected));
    });
    window.HospitalI18n.bindText($('metric-total'), () => String(ambulances.filter(a=>!a.archived).length));
    [['operational', 'OPERATIVA'], ['maintenance', 'MANTENIMIENTO'], ['unavailable', 'FUERA_SERVICIO']].forEach(([id, status]) => {
      window.HospitalI18n.bindText($(`metric-${id}`), () => String(ambulances.filter(ambulance => !ambulance.archived && ambulance.status === status).length));
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
    window.HospitalI18n.setHTML($('delete-from-detail'), icon(ambulance.archived?'save-floppy.svg':'trash-icon.svg')+(ambulance.archived?window.HospitalI18n.t("personnel.restaurar"):window.HospitalI18n.t("routes.eliminar")));
    window.HospitalI18n.setHTML($('detail-content'), `<div class="detail-hero"><span class="ambulance-avatar">${icon('ambulance-icon.png')}</span><div class="detail-hero-text"><strong>${escapeHtml(ambulance.plate)}</strong><p>${escapeHtml(ambulance.model)}</p><p>${window.HospitalI18n.mark("ambulances.unidad_value", {value0: String(ambulance.id).padStart(3, '0')})}</p></div>${pill(ambulance)}</div>
      <div class="detail-grid"><section class="detail-card"><h3>${window.HospitalI18n.mark("routes.informacion_general")}</h3><dl>
        <dt>${icon('id-badge.svg')}${window.HospitalI18n.mark("ambulances.matricula")}</dt><dd>${escapeHtml(ambulance.plate)}</dd>
        <dt>${icon('brand-icon.svg')}${window.HospitalI18n.mark("ambulances.modelo")}</dt><dd>${escapeHtml(ambulance.model)}</dd>
        <dt>${icon('seats-icon.svg')}${window.HospitalI18n.mark("ambulances.capacidad")}</dt><dd>${window.HospitalI18n.mark("ambulances.value_plazas", {value0: ambulance.capacity})}</dd>
        <dt>${icon('information-icon.svg')}${window.HospitalI18n.mark("ambulances.estado_operativo")}</dt><dd>${labels[ambulance.status]}</dd>
      </dl></section></div>`);
    detailPanel.inert = false;
    detailPanel.setAttribute('aria-hidden', 'false');
    workspace.classList.add('has-selection');
    render();
    $('close-detail').focus();
    directory.inert = true;
  }

  function clearError() {
    $('form-error').hidden = true;
    [...form.elements].filter(element => element.setCustomValidity).forEach(element => window.HospitalI18n.bindValidity(element, () => ''));
  }

  function openForm(ambulance = null) {
    closeDetail();
    form.reset(); clearError();
    editingId = ambulance?.id ?? null;
    editingVersion = ambulance?.version ?? null;
    window.HospitalI18n.bindText($('ambulance-form-title'), () => ambulance ? window.HospitalI18n.t("ambulances.editar_ambulancia") : window.HospitalI18n.t("ambulances.nueva_ambulancia"));
    window.HospitalI18n.bindText($('form-subtitle'), () => ambulance ? window.HospitalI18n.t("ambulances.actualiza_los_datos_de_la_unidad_value", {value0: ambulance.plate}) : window.HospitalI18n.t("ambulances.completa_los_datos_del_vehiculo"));
    window.HospitalI18n.bindText($('save-label'), () => ambulance ? window.HospitalI18n.t("trace_view.guardar_cambios") : window.HospitalI18n.t("ambulances.guardar_ambulancia"));
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
    window.HospitalI18n.bindText($('ambulance-toast'), () => window.HospitalI18n.resolve(message));
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
    if (!ambulance.model) window.HospitalI18n.bindValidity(form.elements.modelo, () => window.HospitalI18n.t("ambulances.ingresa_el_modelo_del_vehiculo"));
    if (!/^[A-Z0-9]+$/.test(ambulance.plate)) window.HospitalI18n.bindValidity(form.elements.matricula, () => window.HospitalI18n.t("ambulances.ingresa_una_matricula_valida"));
    if (!Number.isInteger(ambulance.capacity) || ambulance.capacity < 1 || ambulance.capacity > 99) window.HospitalI18n.bindValidity(form.elements.capacidad, () => window.HospitalI18n.t("ambulances.ingresa_una_capacidad_de_1_a_99_plazas"));
    if (ambulances.some(item => item.id !== editingId && plateKey(item.plate) === ambulance.plate)) {
      window.HospitalI18n.bindValidity(form.elements.matricula, () => window.HospitalI18n.t("ambulances.ya_existe_una_ambulancia_con_esa_matricula"));
      console.error(window.HospitalI18n.t("ambulances.ya_existe_una_ambulancia_con_esa_matricula"));
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
      toast(() => wasEditing?window.HospitalI18n.t("ambulances.ambulancia_value_actualizada", {value0: saved.plate}):window.HospitalI18n.t("ambulances.ambulancia_value_agregada", {value0: saved.plate}));
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
    window.HospitalI18n.bindText($('delete-title'), () => ambulance.archived?window.HospitalI18n.t("ambulances.restaurar_esta_ambulancia"):window.HospitalI18n.t("ambulances.eliminar_esta_ambulancia"));
    window.HospitalI18n.bindText($('confirm-delete'), () => ambulance.archived?window.HospitalI18n.t("ambulances.restaurar_ambulancia"):window.HospitalI18n.t("ambulances.eliminar_ambulancia"));
    window.HospitalI18n.bindText($('delete-description'), () => ambulance.archived ? window.HospitalI18n.t("ambulances.la_unidad_value_volvera_al_listado_con_su_estado_operativo_anterior_deseas_continuar", {value0: ambulance.plate}) : window.HospitalI18n.t("ambulances.se_archivara_la_unidad_value_value_se_conservara_su_historial_y_podras_restaurarla_desde_f", {value0: ambulance.plate, value1: ambulance.model}));
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
      toast(() => window.HospitalI18n.t("ambulances.ambulancia_value_value", {value0: ambulance.plate, value1: ambulance.archived?window.HospitalI18n.t("ambulances.restaurada"):window.HospitalI18n.t("ambulances.eliminada_del_listado")}));
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
    window.HospitalI18n.bindText($('results-summary'), () => window.HospitalI18n.t("ambulances.cargando_ambulancias"));
    try {
      const session=await window.HospitalAuth.ready;
      if (!session) return;
      if (!session.user.roles.includes('dispatcher')) {location.replace(api.page('src/views/management/management.html'));return;}
      await refresh(); $('new-ambulance').disabled=false;
    } catch(error) { report(error); window.HospitalI18n.bindText($('results-summary'), () => ''); }
  }
  window.addEventListener('focus',()=>{if(!busy && !dialog.open && !deleteDialog.open && !selectedId && !$('new-ambulance').disabled)refresh().catch(report);});
  start();
  window.addEventListener('hospital:localechange',()=>{render(); if(selectedId)selectAmbulance(selectedId);});

})();
