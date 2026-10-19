(() => {
  "use strict";

  const api = window.HospitalApi;
  const statusLabels = {available:"Disponible", consulting:"En consulta", on_call:"De guardia", inactive:"Inactivo"};
  const shiftLabels = {morning:"Mañana", afternoon:"Tarde", night:"Noche", rotating:"Rotativo"};
  const dayLabels = {weekdays:"Lunes a viernes", mon_wed_fri:"Lunes, miércoles y viernes", tue_thu:"Martes y jueves", weekends:"Fines de semana", rotating:"Rotativo"};
  const code = (labels, value) => Object.keys(labels).find(key => labels[key] === value);
  const fromApi = d => ({...d, name:d.full_name, document:d.national_id, service:d.department,
    archived:d.status === "archived", status:d.status === "archived" || d.staff_status !== "active" ? "Inactivo" : statusLabels[d.availability],
    shift:shiftLabels[d.shift], days:dayLabels[d.days], startTime:d.start_time || "", endTime:d.end_time || ""});
  const toApi = d => ({title:d.title, full_name:d.name, national_id:d.document, license:d.license,
    specialty:d.specialty, department:d.service, office:d.office, phone:d.phone, email:d.email,
    availability:code(statusLabels,d.status), shift:code(shiftLabels,d.shift), days:code(dayLabels,d.days),
    start_time:d.startTime || null, end_time:d.endTime || null, notes:d.notes});
  const pageSize = 5;
  const statusStyles = { Disponible: "available", "En consulta": "consulting", "De guardia": "on-call", Inactivo: "inactive" };
  const fields = ["title", "name", "document", "license", "specialty", "service", "office", "phone", "email", "status", "shift", "days", "startTime", "endTime", "notes"];
  const rows = document.getElementById("doctor-rows");
  const directory = document.querySelector(".doctor-directory");
  const search = document.getElementById("doctor-search");
  const specialtyFilter = document.getElementById("specialty-filter");
  const filters = [...document.querySelectorAll("[data-status]")];
  const pagination = document.getElementById("doctor-pagination");
  const detail = document.getElementById("doctor-detail");
  const scrim = document.getElementById("detail-scrim");
  const form = document.getElementById("doctor-form");
  const dialog = document.getElementById("doctor-dialog");
  const deleteDialog = document.getElementById("delete-dialog");
  const formError = document.getElementById("form-error");
  const newButton = document.getElementById("new-doctor-button");
  if (!api || !rows || !form || !dialog || !detail) return;

  const escapeHtml = value => String(value ?? "").replace(/[&<>"']/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]);
  const normalize = value => String(value ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("es").trim();
  const identifier = value => normalize(value).replace(/[^a-z0-9]/g, "");
  const fullName = doctor => `${doctor.title} ${doctor.name}`;
  const icon = file => `<img src="../../../assets/Icons/${file}" alt="" aria-hidden="true">`;
  const pill = doctor => `<span class="status-pill status-pill--${statusStyles[doctor.status]}">${escapeHtml(doctor.archived ? "Archivado" : doctor.status)}</span>`;
  const hours = doctor => doctor.startTime && doctor.endTime ? `${doctor.startTime} – ${doctor.endTime}` : "Horario no indicado";
  let doctors = [];
  let catalogs = {specialties:[], departments:[]};
  let busy = false, editingVersion = null, deletingVersion = null;
  let activeStatus = "Todos";
  let currentPage = 1;
  let selectedId = null;
  let editingId = null;
  let deletingId = null;
  let lastAction = null;
  let formReturnFocus = null;
  let deleteReturnFocus = null;
  let toastTimer;

  const report = error => api.report(error, "doctors");
  const upsert = record => { const d=fromApi(record); doctors=[d, ...doctors.filter(item => item.id !== d.id)]; return d; };
  function setBusy(value) {
    busy=value;
    [...form.elements, ...deleteDialog.querySelectorAll("button")].forEach(el => { el.disabled=value; });
    newButton.disabled=value;
  }
  async function refresh() {
    const [data, suggestions]=await Promise.all([api.get("doctors/list.php"),api.get("doctors/catalogs.php")]);
    doctors=data.map(fromApi); catalogs=suggestions; updateCatalogs(); renderList();
  }
  async function openCurrent(id, edit=false) {
    try {
      const d=upsert(await api.get(`doctors/get.php?id=${encodeURIComponent(id)}`));
      if (edit) { if (!d.archived) openForm(d); } else showDetail(d);
    } catch(error) { report(error); }
  }

  function toast(message) {
    const notification = document.getElementById("doctor-toast");
    clearTimeout(toastTimer);
    notification.textContent = message;
    notification.hidden = false;
    toastTimer = setTimeout(() => { notification.hidden = true; }, 5000);
  }

  function updateCatalogs() {
    const current = specialtyFilter.value;
    // Group spelling and accent variants as the same specialty.
    const unique = key => [...new Map(doctors.filter(d => !d.archived).map(doctor => [normalize(doctor[key]), doctor[key]])).values()].sort((a, b) => a.localeCompare(b, "es"));
    const specialties = [...new Map(doctors.map(d => [normalize(d.specialty),d.specialty])).values()].sort((a,b)=>a.localeCompare(b,"es"));
    specialtyFilter.innerHTML = '<option value="">Todas las especialidades</option>' + specialties.map(value => `<option value="${escapeHtml(normalize(value))}">${escapeHtml(value)}</option>`).join("");
    specialtyFilter.value = specialties.some(value => normalize(value) === current) ? current : "";
    document.getElementById("specialty-options").innerHTML = [...new Set([...catalogs.specialties,...specialties])].map(value => `<option value="${escapeHtml(value)}"></option>`).join("");
    document.getElementById("service-options").innerHTML = [...new Set([...catalogs.departments,...unique("service")])].map(value => `<option value="${escapeHtml(value)}"></option>`).join("");
    document.getElementById("metric-total").textContent = doctors.filter(d => !d.archived).length;
    document.getElementById("metric-available").textContent = doctors.filter(doctor => doctor.status === "Disponible").length;
    document.getElementById("metric-on-call").textContent = doctors.filter(doctor => doctor.status === "De guardia").length;
    document.getElementById("metric-specialties").textContent = unique("specialty").length;
  }

  function matchingDoctors() {
    const query = normalize(search.value);
    const compactQuery = identifier(query);
    return doctors.filter(doctor => {
      const matchesStatus = (activeStatus === "Todos" ? !doctor.archived : doctor.status === activeStatus);
      const matchesSpecialty = !specialtyFilter.value || normalize(doctor.specialty) === specialtyFilter.value;
      const values = [fullName(doctor), doctor.document, doctor.license, doctor.phone, doctor.specialty, doctor.service, doctor.email];
      const matchesQuery = !query || values.some(value => normalize(value).includes(query) || (compactQuery && identifier(value).includes(compactQuery)));
      return matchesStatus && matchesSpecialty && matchesQuery;
    });
  }

  function actionButton(doctor, action, label, file) {
    return `<button type="button" class="row-action" data-action="${action}" data-id="${escapeHtml(doctor.id)}" aria-label="${label} ${escapeHtml(fullName(doctor))}" title="${label} ${escapeHtml(fullName(doctor))}">${icon(file)}</button>`;
  }

  function row(doctor) {
    return `<tr${selectedId === doctor.id ? ' class="is-selected"' : ""}>
      <td><div class="doctor-identity"><span class="doctor-avatar">${icon("doctor-icon.svg")}</span><div><strong title="${escapeHtml(fullName(doctor))}">${escapeHtml(fullName(doctor))}</strong><small>${escapeHtml(doctor.license)}</small></div></div></td>
      <td><div class="doctor-info">${icon("specialty-icon.svg")}<div><b title="${escapeHtml(doctor.specialty)}">${escapeHtml(doctor.specialty)}</b><small title="${escapeHtml(doctor.service)}">${escapeHtml(doctor.service)}</small></div></div></td>
      <td><div class="doctor-info">${icon("time-icon.svg")}<div><b>${escapeHtml(doctor.shift)} <span class="shift-hours">· ${escapeHtml(hours(doctor))}</span></b><small>${escapeHtml(doctor.phone)}</small></div></div></td>
      <td>${pill(doctor)}</td>
      <td><div class="row-actions">${actionButton(doctor, "view", "Ver detalle de", "arrow-left.svg")}</div></td>
    </tr>`;
  }

  function renderList() {
    const matches = matchingDoctors();
    const pageCount = Math.max(1, Math.ceil(matches.length / pageSize));
    currentPage = Math.max(1, Math.min(currentPage, pageCount));
    const start = (currentPage - 1) * pageSize;
    const visible = matches.slice(start, start + pageSize);
    rows.innerHTML = visible.map(row).join("");
    document.querySelector(".doctor-table-container").classList.toggle("is-empty", matches.length === 0);
    document.getElementById("doctor-empty").hidden = matches.length > 0;
    document.getElementById("empty-description").textContent = doctors.length ? "Prueba con otro nombre o ajusta los filtros." : "Agrega el primer médico para comenzar el directorio.";
    document.getElementById("clear-filters").hidden = doctors.length === 0;
    document.getElementById("results-summary").textContent = matches.length ? `Mostrando ${start + 1} a ${start + visible.length} de ${matches.length} ${matches.length === 1 ? "médico" : "médicos"}` : "Mostrando 0 médicos";
    const pages = new Set([1, pageCount, currentPage - 1, currentPage, currentPage + 1]);
    let previous = 0;
    const numbers = [...pages].filter(page => page >= 1 && page <= pageCount).sort((a, b) => a - b).map(page => {
      const gap = previous && page - previous > 1 ? '<span aria-hidden="true">…</span>' : "";
      previous = page;
      return `${gap}<button type="button" data-page="${page}" aria-label="Página ${page}"${page === currentPage ? ' class="is-active" aria-current="page"' : ""}>${page}</button>`;
    }).join("");
    pagination.innerHTML = `<button type="button" data-page="${currentPage - 1}" aria-label="Página anterior"${currentPage === 1 ? " disabled" : ""}>‹</button>${numbers}<button type="button" data-page="${currentPage + 1}" aria-label="Página siguiente"${currentPage === pageCount ? " disabled" : ""}>›</button>`;
  }

  function detailItem(label, value) { return `<dt>${label}</dt><dd>${escapeHtml(value || "No indicado")}</dd>`; }

  function renderDetail(doctor) {
    document.getElementById("edit-from-detail").hidden=doctor.archived;
    document.getElementById("delete-from-detail").innerHTML=icon(doctor.archived ? "save-floppy.svg" : "trash-icon.svg")+(doctor.archived ? "Restaurar" : "Eliminar");
    document.getElementById("detail-content").innerHTML = `<section class="detail-profile">
      <div class="detail-identity"><span class="doctor-avatar">${icon("doctor-icon.svg")}</span><div><h3>${escapeHtml(fullName(doctor))}</h3><p>${escapeHtml(doctor.specialty)}</p></div></div>
      <div class="detail-profile-footer"><span class="registration-label">Registro ${escapeHtml(doctor.license)}</span>${pill(doctor)}</div>
    </section>
    <section class="detail-card"><h3>${icon("person-icon.svg")}Datos de contacto</h3><dl>${detailItem("Documento (C.I.)", doctor.document)}${detailItem("Teléfono", doctor.phone)}${detailItem("Correo electrónico", doctor.email)}</dl></section>
    <section class="detail-card"><h3>${icon("specialty-icon.svg")}Información profesional</h3><dl>${detailItem("Registro MSP", doctor.license)}${detailItem("Especialidad", doctor.specialty)}${detailItem("Servicio", doctor.service)}${detailItem("Consultorio / Área", doctor.office)}</dl></section>
    <section class="detail-card"><h3>${icon("calendar-icon.svg")}Turno y atención</h3><dl>${detailItem("Disponibilidad", doctor.status)}${detailItem("Turno", doctor.shift)}${detailItem("Días de atención", doctor.days)}${detailItem("Horario", hours(doctor))}</dl></section>
    <section class="detail-card"><h3>${icon("document-icon.svg")}Observaciones</h3><p>${escapeHtml(doctor.notes || "Sin observaciones registradas.")}</p></section>`;
  }

  function setBackgroundInert(value) {
    [directory, document.querySelector(".topbar"), document.querySelector(".sidebar"), document.querySelector(".doctor-summary-row")].forEach(element => { element.inert = value; });
  }

  function restoreFocus(target) {
    if (target?.isConnected && !target.closest("[inert]")) { target.focus(); return; }
    const button = lastAction && [...rows.querySelectorAll("[data-action]")].find(item => item.dataset.id === lastAction.id && item.dataset.action === lastAction.action);
    (button || newButton).focus();
  }

  function showDetail(doctor) {
    selectedId = doctor.id;
    renderDetail(doctor);
    renderList();
    setBackgroundInert(true);
    scrim.hidden = false;
    detail.inert = false;
    detail.setAttribute("aria-hidden", "false");
    detail.classList.add("is-open");
    document.getElementById("detail-content").scrollTop = 0;
    requestAnimationFrame(() => {
      if (selectedId === doctor.id && !dialog.open && !deleteDialog.open) document.getElementById("close-detail").focus();
    });
  }

  function closeDetail(restore = true) {
    selectedId = null;
    detail.classList.remove("is-open");
    detail.setAttribute("aria-hidden", "true");
    detail.inert = true;
    scrim.hidden = true;
    setBackgroundInert(false);
    renderList();
    if (restore) restoreFocus();
  }

  function openForm(doctor = null) {
    formReturnFocus = document.activeElement;
    editingId = doctor?.id || null;
    editingVersion = doctor?.version || null;
    form.reset();
    formError.hidden = true;
    document.getElementById("form-title").textContent = doctor ? "Editar médico" : "Nuevo médico";
    document.getElementById("form-subtitle").textContent = doctor ? `Actualiza la información de ${fullName(doctor)}.` : "Completa la información para agregar un médico al directorio.";
    document.getElementById("save-label").textContent = doctor ? "Guardar cambios" : "Guardar médico";
    if (doctor) fields.forEach(key => { form.elements[key].value = doctor[key]; });
    document.getElementById("form-status-dot").dataset.status = form.elements.status.value;
    dialog.showModal();
    document.querySelector(".doctor-form-fields").scrollTop = 0;
    form.elements.name.focus();
  }

  function openDelete(doctor) {
    deletingId = doctor.id;
    deletingVersion = doctor.version;
    deleteReturnFocus = document.activeElement;
    document.querySelector(".delete-note").textContent=doctor.archived ? "Volverá al directorio con sus datos y disponibilidad anteriores." : "Se conservará en Inactivos y en el historial de los pacientes.";
    document.getElementById("delete-title").textContent=doctor.archived ? "¿Restaurar este médico?" : "¿Eliminar este médico?";
    document.getElementById("confirm-delete").textContent=doctor.archived ? "Restaurar médico" : "Eliminar médico";
    document.getElementById("delete-description").textContent = `Se ${doctor.archived ? "restaurará" : "archivará"} a ${fullName(doctor)} (${doctor.license}). ¿Deseas continuar?`;
    deleteDialog.showModal();
  }

  function resetFilters() {
    search.value = "";
    specialtyFilter.value = "";
    activeStatus = "Todos";
    currentPage = 1;
    filters.forEach(button => { const active = button.dataset.status === activeStatus; button.classList.toggle("is-active", active); button.setAttribute("aria-pressed", String(active)); });
  }

  rows.addEventListener("click", event => {
    const button = event.target.closest("button[data-action]");
    if (!button) return;
    const doctor = doctors.find(item => item.id === button.dataset.id);
    if (!doctor) return;
    lastAction = { id: doctor.id, action: button.dataset.action };
    if (button.dataset.action === "view") openCurrent(doctor.id);
  });
  search.addEventListener("input", () => { currentPage = 1; renderList(); });
  specialtyFilter.addEventListener("change", () => { currentPage = 1; renderList(); });
  filters.forEach(button => button.addEventListener("click", () => {
    activeStatus = button.dataset.status;
    currentPage = 1;
    filters.forEach(item => { const active = item === button; item.classList.toggle("is-active", active); item.setAttribute("aria-pressed", String(active)); });
    renderList();
  }));
  document.getElementById("clear-filters").addEventListener("click", () => { resetFilters(); renderList(); search.focus(); });
  pagination.addEventListener("click", event => {
    const button = event.target.closest("button[data-page]");
    if (!button || button.disabled) return;
    currentPage = Number(button.dataset.page);
    renderList();
    pagination.querySelector('[aria-current="page"]').focus();
  });
  newButton.addEventListener("click", () => openForm());
  document.getElementById("close-detail").addEventListener("click", () => closeDetail());
  scrim.addEventListener("click", () => closeDetail());
  document.getElementById("edit-from-detail").addEventListener("click", () => openCurrent(selectedId,true));
  document.getElementById("delete-from-detail").addEventListener("click", () => openDelete(doctors.find(doctor => doctor.id === selectedId)));
  document.addEventListener("keydown", event => {
    if (!selectedId || dialog.open || deleteDialog.open) return;
    if (event.key === "Escape") { event.preventDefault(); closeDetail(); }
    if (event.key === "Tab") {
      const buttons = [...detail.querySelectorAll("button")];
      if (event.shiftKey && document.activeElement === buttons[0]) { event.preventDefault(); buttons.at(-1).focus(); }
      else if (!event.shiftKey && document.activeElement === buttons.at(-1)) { event.preventDefault(); buttons[0].focus(); }
    }
  });

  document.querySelectorAll("[data-close-form]").forEach(button => button.addEventListener("click", () => dialog.close()));
  dialog.addEventListener("click", event => { if (event.target === dialog && !busy) dialog.close(); });
  dialog.addEventListener("cancel", event => { if (busy) event.preventDefault(); });
  dialog.addEventListener("close", () => { editingId = null; if (formReturnFocus) restoreFocus(formReturnFocus); formReturnFocus = null; });
  form.addEventListener("input", () => { formError.hidden = true; });
  form.addEventListener("change", () => { formError.hidden = true; document.getElementById("form-status-dot").dataset.status = form.elements.status.value; });
  form.addEventListener("submit", async event => {
    event.preventDefault();
    if (busy) return;
    formError.hidden = true;
    const record = Object.fromEntries(fields.map(key => [key, form.elements[key].value.trim()]));
    const fail = (key, message) => { console.error(message); form.elements[key].focus(); };
    const missing = ["name", "document", "license", "specialty", "service", "phone"].find(key => !record[key]);
    if (missing) { fail(missing, "Completa los campos obligatorios con información válida."); return; }
    if (record.phone.replace(/\D/g, "").length < 8) { fail("phone", "Ingresa un teléfono con al menos 8 dígitos."); return; }
    for (const [key, label] of [["document", "documento"], ["license", "registro MSP"]]) {
      if (!identifier(record[key])) { fail(key, `Ingresa un ${label} válido.`); return; }
      if (doctors.some(doctor => doctor.id !== editingId && identifier(doctor[key]) === identifier(record[key]))) { fail(key, `Ya existe un médico con ese ${label}.`); return; }
    }
    if (Boolean(record.startTime) !== Boolean(record.endTime)) { fail(record.startTime ? "endTime" : "startTime", "Completa ambas horas o deja el horario sin indicar."); return; }
    const wasEditing = Boolean(editingId);
    const payload=toApi(record);
    if (wasEditing) Object.assign(payload,{id:editingId,version:editingVersion});
    setBusy(true);
    try {
      const saved=upsert(await api.post(`doctors/${wasEditing ? "update" : "create"}.php`,payload));
      resetFilters(); updateCatalogs();
      currentPage=Math.floor(matchingDoctors().findIndex(d=>d.id===saved.id)/pageSize)+1;
      formReturnFocus=null; dialog.close(); showDetail(saved);
      toast(wasEditing ? `Datos de ${fullName(saved)} actualizados.` : `${fullName(saved)} agregado al directorio.`);
    } catch(error) { report(error); } finally { setBusy(false); }

  });

  document.querySelectorAll("[data-close-delete]").forEach(button => button.addEventListener("click", () => deleteDialog.close()));
  deleteDialog.addEventListener("click", event => { if (event.target === deleteDialog && !busy) deleteDialog.close(); });
  deleteDialog.addEventListener("cancel", event => { if (busy) event.preventDefault(); });
  deleteDialog.addEventListener("close", () => { deletingId = null; if (deleteReturnFocus) restoreFocus(deleteReturnFocus); deleteReturnFocus = null; });
  document.getElementById("confirm-delete").addEventListener("click", async () => {
    const doctor = doctors.find(item => item.id === deletingId);
    if (!doctor) return;
    if (busy) return;
    setBusy(true);
    try {
      await api.post(`doctors/${doctor.archived ? "restore" : "archive"}.php`,{id:doctor.id,version:deletingVersion}).then(upsert);
      deleteReturnFocus=null; deleteDialog.close(); updateCatalogs();
      closeDetail(false); newButton.focus();
      toast(`${fullName(doctor)} ${doctor.archived ? "restaurado" : "eliminado del directorio"}.`);
    } catch(error) { report(error); } finally { setBusy(false); }

  });

  async function start() {
    newButton.disabled=true; updateCatalogs();
    document.getElementById("results-summary").textContent="Cargando médicos…";
    try {
      const session=await window.HospitalAuth.ready;
      if (!session) return;
      if (!session.user.roles.includes("records_manager")) {
        location.replace(api.page("src/views/management/management.html")); return;
      }
      await refresh(); newButton.disabled=false;
    } catch(error) { report(error); document.getElementById("results-summary").textContent=""; }
  }
  window.addEventListener("focus", () => { if (!busy && !dialog.open && !deleteDialog.open && !selectedId && !newButton.disabled) refresh().catch(report); });
  start();
})();
