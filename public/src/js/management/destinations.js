document.addEventListener('DOMContentLoaded', async () => {
    await window.HospitalI18n.ready;
    await window.HospitalAuth.ready;

  const api=window.HospitalApi;
  const pageSize=6;
  const iconBase='../../../assets/Icons/';
  const typeCodes={hospital:'hospital',sanatorium:'sanatorium',health_center:'health_center',other:'other'};
  const typeLabels={get hospital() { return window.HospitalI18n.t("destinations.hospital"); },get sanatorium() { return window.HospitalI18n.t("destinations.sanatorio"); },get health_center() { return window.HospitalI18n.t("destinations.centro_de_salud"); },get other() { return window.HospitalI18n.t("trace_new.otro"); }},statusLabels={get active() { return window.HospitalI18n.t("destinations.activo"); },get inactive() { return window.HospitalI18n.t("destinations.inactivo"); }};
  const fromApi=d=>({...d,type:d.facility_type,archived:d.status==='archived',
    status:d.status==='active' && d.availability==='active'?'active':'inactive'});
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
  let activeFilter = 'active';
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
      const content = normalize(`${destination.name} ${destination.address} ${destination.locality} ${typeLabels[destination.type]} ${destination.phone}`);
      return destination.status === activeFilter &&
        words.every(word => content.includes(word));
    });
  }

  function makeIcon(file) {
    const icon = document.createElement('img');
    icon.src = iconBase + file;
    window.HospitalI18n.bindAttr(icon, "alt", () => '');
    icon.setAttribute('aria-hidden', 'true');
    return icon;
  }

  function makeCell(text) {
    const cell = document.createElement('td');
    window.HospitalI18n.bindText(cell, () => text);
    window.HospitalI18n.bindAttr(cell, "title", () => text);
    return cell;
  }

  function makeAction(action, label, icon, destination) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'row-action';
    button.dataset.action = action;
    button.dataset.id = destination.id;
    window.HospitalI18n.bindAttr(button, "aria-label", () => `${label} ${destination.name}`);
    window.HospitalI18n.bindAttr(button, "title", () => `${label} ${destination.name}`);
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
    window.HospitalI18n.bindText(name, () => destination.name);
    window.HospitalI18n.bindAttr(name, "title", () => destination.name);
    const type = document.createElement('small');
    window.HospitalI18n.bindText(type, () => (typeLabels)[destination.type]);
    copy.append(name, type);
    nameContent.append(avatar, copy);
    nameCell.append(nameContent);

    const statusCell = document.createElement('td');
    const status = document.createElement('span');
    status.className = 'status-text';
    const dot = document.createElement('span');
    dot.className = 'status-dot' + (destination.status === 'inactive' ? ' is-inactive' : '');
    dot.setAttribute('aria-hidden', 'true');
    status.append(dot, window.HospitalI18n.textNode(() => destination.archived?window.HospitalI18n.t("personnel.archivado"):statusLabels[destination.status]));
    statusCell.append(status);

    const actionsCell = document.createElement('td');
    const actions = document.createElement('div');
    actions.className = 'row-actions';
    actions.append(makeAction('view',window.HospitalI18n.t("personnel.ver"),'eye.svg',destination));
    if(destination.archived)actions.append(makeAction('restore',window.HospitalI18n.t("personnel.restaurar"),'save-floppy.svg',destination));
    else actions.append(makeAction('edit',window.HospitalI18n.t("trace_view.editar"),'pencil-icon.svg',destination),makeAction('delete',window.HospitalI18n.t("routes.eliminar"),'trash-icon.svg',destination));
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
    window.HospitalI18n.bindText(document.getElementById('list-title'), () => window.HospitalI18n.t("destinations.destinos_value", {value0: activeFilter === 'active' ? window.HospitalI18n.t("shared.activos") : window.HospitalI18n.t("shared.inactivos")}));
    window.HospitalI18n.bindText(document.getElementById('list-count'), () => window.HospitalI18n.t("destinations.total_de_value_value", {value0: statusCount, value1: statusCount === 1 ? window.HospitalI18n.t("destinations.destino_registrado") : window.HospitalI18n.t("destinations.destinos_registrados")}));
    window.HospitalI18n.bindText(document.getElementById('results-summary'), () => matching.length
      ? window.HospitalI18n.t("personnel.mostrando_value_a_value_de_value_resultados", {value0: start + 1, value1: start + visible.length, value2: matching.length})
      : window.HospitalI18n.t("personnel.mostrando_0_resultados"));
    window.HospitalI18n.bindText(document.getElementById('page-number'), () => String(currentPage));
    document.getElementById('page-prev').disabled = currentPage === 1;
    document.getElementById('page-next').disabled = currentPage === pageCount;

    const noRecords = destinations.length === 0;
    document.getElementById('empty-state').hidden = matching.length > 0;
    window.HospitalI18n.bindText(document.getElementById('empty-title'), () => noRecords ? window.HospitalI18n.t("destinations.aun_no_hay_destinos") : window.HospitalI18n.t("destinations.no_se_encontraron_destinos"));
    window.HospitalI18n.bindText(document.getElementById('empty-description'), () => noRecords
      ? window.HospitalI18n.t("destinations.agrega_el_primer_destino_desde_el_formulario") : window.HospitalI18n.t("destinations.prueba_con_otro_nombre_direccion_localidad_o_estado"));
    window.HospitalI18n.bindText(document.getElementById('empty-action'), () => noRecords ? window.HospitalI18n.t("destinations.agregar_destino") : window.HospitalI18n.t("destinations.limpiar_busqueda"));
  }

  function showFeedback(message, tone = '') {
    if (tone === 'error') { console.error(window.HospitalI18n.resolve(message)); window.HospitalI18n.bindText(feedback, () => ''); return; }
    window.HospitalI18n.bindText(feedback, () => window.HospitalI18n.resolve(message));
    feedback.className = 'form-feedback' + (tone ? ` is-${tone}` : '');
  }

  function updateStatus() {
    const inactive = statusInput.value === 'inactive';
    document.getElementById('form-status-dot').classList.toggle('is-inactive', inactive);
  }

  function clearForm() {
    form.reset();
    editingId = null; editingVersion=null;dirty=false;
    window.HospitalI18n.bindText(document.getElementById('form-title'), () => window.HospitalI18n.t("destinations.agregar_destino"));
    window.HospitalI18n.bindText(document.getElementById('form-subtitle'), () => window.HospitalI18n.t("destinations.completa_la_informacion_del_destino"));
    window.HospitalI18n.bindText(document.getElementById('save-label'), () => window.HospitalI18n.t("accounts.guardar"));
    [nameInput, addressInput, localityInput, phoneInput].forEach(input => window.HospitalI18n.bindValidity(input, () => ''));
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
    window.HospitalI18n.bindText(document.getElementById('form-title'), () => window.HospitalI18n.t("destinations.editar_destino"));
    window.HospitalI18n.bindText(document.getElementById('form-subtitle'), () => window.HospitalI18n.t("destinations.actualiza_la_informacion_del_destino"));
    window.HospitalI18n.bindText(document.getElementById('save-label'), () => window.HospitalI18n.t("destinations.actualizar"));
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
      [window.HospitalI18n.t("settings.nombre"), destination.name], [window.HospitalI18n.t("shared.tipo"), typeLabels[destination.type]], [window.HospitalI18n.t("destinations.direccion"), destination.address],
      [window.HospitalI18n.t("destinations.localidad"), destination.locality], [window.HospitalI18n.t("destinations.telefono"), destination.phone || window.HospitalI18n.t("destinations.sin_telefono_registrado")],
      [window.HospitalI18n.t("trace_view.estado"), destination.archived?window.HospitalI18n.t("personnel.archivado"):statusLabels[destination.status]], [window.HospitalI18n.t("shared.acceso"), destination.notes || window.HospitalI18n.t("destinations.sin_referencia_de_acceso")]
    ].forEach(([label, value]) => {
      const term = document.createElement('dt');
      const description = document.createElement('dd');
      window.HospitalI18n.bindText(term, () => label);
      window.HospitalI18n.bindText(description, () => value);
      details.append(term, description);
    });
    detailDialog.showModal();
  }

  function confirmDeletion(destination) {
    deletingId = destination.id;deletingVersion=destination.version;
    window.HospitalI18n.bindText(document.getElementById('delete-title'), () => destination.archived?window.HospitalI18n.t("destinations.restaurar_destino"):window.HospitalI18n.t("destinations.eliminar_destino"));
    window.HospitalI18n.bindText(document.getElementById('delete-confirm').querySelector('span'), () => destination.archived?window.HospitalI18n.t("destinations.restaurar_destino"):window.HospitalI18n.t("destinations.eliminar_destino"));
    window.HospitalI18n.bindText(document.getElementById('delete-description'), () => destination.archived?window.HospitalI18n.t("destinations.restaurar_value_con_su_estado_anterior", {value0: destination.name}):window.HospitalI18n.t("destinations.archivar_value_se_conservara_el_historial_y_podras_restaurarlo_desde_inactivos", {value0: destination.name}));
    deleteDialog.showModal();
  }

  filterButtons.forEach(button => button.addEventListener('click', () => setFilter(button.dataset.filter)));
  search.addEventListener('input', () => { currentPage = 1; render(); });
  document.getElementById('page-prev').addEventListener('click', () => { currentPage -= 1; render(); });
  document.getElementById('page-next').addEventListener('click', () => { currentPage += 1; render(); });
  document.getElementById('form-cancel').addEventListener('click', () => { clearForm(); render(); });
  statusInput.addEventListener('change', updateStatus);
  [nameInput, addressInput, localityInput, phoneInput].forEach(input => {
    input.addEventListener('input', () => { window.HospitalI18n.bindValidity(input, () => ''); showFeedback(''); });
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
      [nameInput, () => window.HospitalI18n.t("destinations.ingresa_el_nombre_del_destino")],
      [addressInput, () => window.HospitalI18n.t("destinations.ingresa_la_direccion_del_destino")],
      [localityInput, () => window.HospitalI18n.t("destinations.ingresa_la_localidad_del_destino")]
    ];
    for (const [input, message] of requiredInputs) {
      if (!input.value.trim()) {
        window.HospitalI18n.bindValidity(input, message);
        input.checkValidity();
        showFeedback(message, 'error');
        return;
      }
    }
    const phone = phoneInput.value.trim();
    if (phone && (!/^\+?[\d\s().-]+$/.test(phone) || phone.replace(/\D/g, '').length < 8 || phone.replace(/\D/g, '').length > 15)) {
      window.HospitalI18n.bindValidity(phoneInput, () => window.HospitalI18n.t("destinations.ingresa_un_telefono_de_8_a_15_digitos_o_deja_el_campo_vacio"));
      phoneInput.checkValidity();
      showFeedback(() => window.HospitalI18n.t("destinations.revisa_el_telefono_de_contacto"), 'error');
      return;
    }
    if(!form.checkValidity())return;
    const record={name:nameInput.value.trim(),address:addressInput.value.trim(),locality:localityInput.value.trim(),
      facility_type:typeCodes[typeInput.value],phone,notes:notesInput.value.trim(),availability:statusInput.value==='active'?'active':'inactive'};
    const wasEditing=editingId!==null;
    if(wasEditing)Object.assign(record,{id:editingId,version:editingVersion});
    setBusy(true);
    try {
      const saved=upsert(await api.post(`destinations/${wasEditing?'update':'create'}.php`,record));
      clearForm();search.value='';setFilter(saved.status);
      currentPage=Math.floor(getMatchingDestinations().findIndex(d=>d.id===saved.id)/pageSize)+1;
      showFeedback(() => wasEditing?window.HospitalI18n.t("destinations.destino_actualizado"):window.HospitalI18n.t("destinations.destino_guardado"));
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
      deleteDialog.close();showFeedback(() => destination.archived?window.HospitalI18n.t("destinations.destino_restaurado"):window.HospitalI18n.t("destinations.destino_eliminado_del_listado"));
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
    setBusy(true);updateStatus();window.HospitalI18n.bindText(document.getElementById('list-count'), () => window.HospitalI18n.t("destinations.cargando_destinos"));
    try {
      const session=await window.HospitalAuth.ready;if(!session)return;
      if(!session.user.roles.includes('dispatcher')){location.replace(api.page('src/views/management/management.html'));return;}
      await refresh();setBusy(false);
    } catch(error){report(error);window.HospitalI18n.bindText(document.getElementById('list-count'), () => '');}
  }
  start();
  window.addEventListener('hospital:localechange',()=>{render();if(detailDialog.open){const item=destinations.find(d=>d.id===detailId);if(item)showDestination(item);}});

});
