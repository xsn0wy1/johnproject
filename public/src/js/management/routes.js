(async () => {
  "use strict";
    const i18nSourceUrl = document.currentScript.src;
    await window.HospitalI18n.ready;
    await window.HospitalAuth.ready;


  const api=window.HospitalApi;
  const categoryLabels={get interhospital() { return window.HospitalI18n.t("routes.interhospitalario"); },get consultation() { return window.HospitalI18n.t("routes.consulta"); },get treatment() { return window.HospitalI18n.t("routes.tratamiento"); },get discharge() { return window.HospitalI18n.t("routes.category_discharge"); }};
  const directionLabels={get one_way() { return window.HospitalI18n.t("routes.solo_ida"); },get round_trip() { return window.HospitalI18n.t("routes.ida_y_vuelta"); }};
  const keyFor=(labels,value)=>value;
  const statusLabels={get active() { return window.HospitalI18n.t("routes.activa"); },get inactive() { return window.HospitalI18n.t("routes.inactiva"); }};
  const adapt=row=>({...row,origin:{name:row.origin_name,address:row.origin_address},destination:{name:row.destination_name,address:row.destination_address},category:row.category,direction:row.direction,archived:row.status==='archived',status:row.status==='active'&&row.availability==='active'?'active':'inactive',distance:row.distance_meters/1000,duration:row.duration_seconds/60});
  async function reload(){routes=(await api.get('routes/list.php')).map(adapt);}
  function setBusy(value){busy=value;[...form.elements,...deleteDialog.querySelectorAll('button')].forEach(control=>control.disabled=value);if(!value)byId('add-stop').disabled=draftStops.length>=6;}
  const byId = id => document.getElementById(id);
  const list = byId("route-list");
  const search = byId("route-search");
  const sort = byId("route-sort");
  const detail = byId("route-detail-content");
  const form = byId("route-form");
  const formDialog = byId("route-dialog");
  const deleteDialog = byId("delete-dialog");
  const stopEditor = byId("stop-editor");
  const formError = byId("form-error");
  const filters = [...document.querySelectorAll("[data-filter]")];
  const pagination = byId("route-pagination");
  let pageSize = 3;
  let routes = [];
  let busy=true, editVersion=null, deleteVersion=null;
  let selectedId = null;
  let currentPage = 1;
  let activeFilter = "all";
  let editingId = null;
  let pendingDeleteId = null;
  let draftStops = [];
  let toastTimer;
  let dialogTrigger;

  const normalize = value => String(value).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("es").trim();
  const escapeHtml = value => String(value ?? "").replace(/[&<>"']/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[character]));
  const formatDistance = value => new Intl.NumberFormat(window.HospitalI18n.locale, { maximumFractionDigits: 1 }).format(value);
  const icon = name => `<img src="../../../assets/Icons/${name}.svg" alt="">`;
  const validPlace = place => place && typeof place.name === "string" && place.name.trim().length > 0 && place.name.length <= 100 && typeof place.address === "string" && place.address.trim().length > 0 && place.address.length <= 160;

  function notify(message) {
    const toast = byId("route-toast");
    clearTimeout(toastTimer);
    window.HospitalI18n.bindText(toast, () => window.HospitalI18n.resolve(message));
    toast.hidden = false;
    toastTimer = setTimeout(() => { toast.hidden = true; }, 5000);
  }

  function filteredRoutes() {
    const query = normalize(search.value);
    return routes.filter(route => {
      const terms = [route.code, route.name, categoryLabels[route.category], route.origin.name, route.origin.address, route.destination.name, route.destination.address, ...route.stops.flatMap(stop => [stop.name, stop.address])].join(" ");
      return (activeFilter === "all" || route.status === activeFilter) && normalize(terms).includes(query);
    }).sort((a, b) => {
      if (sort.value === "name") return a.name.localeCompare(b.name, window.HospitalI18n.locale, { sensitivity: "base" }) || a.code.localeCompare(b.code);
      if (sort.value === "duration") return a.duration - b.duration || a.name.localeCompare(b.name, window.HospitalI18n.locale);
      return a.code.localeCompare(b.code,window.HospitalI18n.locale,{numeric:true});
    });
  }

  function statusPill(route) {
    return `<span class="status-pill${route.status === "inactive" ? " is-inactive" : ""}">${escapeHtml(statusLabels[route.status])}</span>`;
  }

  function renderPagination(pages) {
    let pageNumbers;
    if (pages <= 5) pageNumbers = Array.from({ length: pages }, (_, index) => index + 1);
    else if (currentPage <= 3) pageNumbers = [1, 2, 3, "…", pages];
    else if (currentPage >= pages - 2) pageNumbers = [1, "…", pages - 2, pages - 1, pages];
    else pageNumbers = [1, "…", currentPage, "…", pages];
    window.HospitalI18n.setHTML(pagination, `<button type="button" id="page-prev" data-page="${currentPage - 1}" aria-label="${window.HospitalI18n.html("trace.pagina_anterior")}" data-i18n-aria-label="trace.pagina_anterior" ${currentPage === 1 ? "disabled" : ""}>‹</button>
      ${pageNumbers.map(page => typeof page === "number" ? `<button type="button" data-page="${page}" class="${page === currentPage ? "is-active" : ""}" aria-label="${window.HospitalI18n.html("ambulances.pagina_value", {value0: page})}" data-i18n-aria-label="ambulances.pagina_value" data-i18n-aria-label-params="${window.HospitalI18n.escape(JSON.stringify({value0: page}))}" ${page === currentPage ? 'aria-current="page"' : ""}>${page}</button>` : '<span class="pagination-ellipsis" aria-hidden="true">…</span>').join("")}
      <button type="button" id="page-next" data-page="${currentPage + 1}" aria-label="${window.HospitalI18n.html("trace.pagina_siguiente")}" data-i18n-aria-label="trace.pagina_siguiente" ${currentPage === pages ? "disabled" : ""}>›</button>`);
  }

  function fitCatalogPage() {
    let capacity = 3;
    if (!window.matchMedia("(max-width: 770px)").matches) {
      if (!list.clientHeight) return;
      const style = getComputedStyle(list);
      const availableHeight = list.clientHeight - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom);
      const cardHeight = parseFloat(style.getPropertyValue("--route-card-height"));
      const gap = parseFloat(style.rowGap);
      capacity = Math.max(1, Math.min(6, Math.floor((availableHeight + gap) / (cardHeight + gap))));
    }
    if (capacity === pageSize) return;
    pageSize = capacity;
    const selectedIndex = filteredRoutes().findIndex(route => route.id === selectedId);
    if (selectedIndex >= 0) currentPage = Math.floor(selectedIndex / pageSize) + 1;
    const focusedRoute = document.activeElement?.dataset.routeId;
    const focusedPage = document.activeElement?.dataset.page;
    renderCatalog();
    if (focusedRoute) list.querySelector(`[data-route-id="${CSS.escape(focusedRoute)}"]`)?.focus({ preventScroll: true });
    else if (focusedPage) pagination.querySelector('[aria-current="page"]')?.focus({ preventScroll: true });
  }

  function renderCatalog() {
    const matching = filteredRoutes();
    const pages = Math.max(1, Math.ceil(matching.length / pageSize));
    currentPage = Math.min(currentPage, pages);
    const start = (currentPage - 1) * pageSize;
    const visible = matching.slice(start, start + pageSize);
    if (!visible.some(route => route.id === selectedId)) selectedId = visible[0]?.id ?? null;
    window.HospitalI18n.setHTML(list, visible.map(route => `<button type="button" class="route-card${route.id === selectedId ? " is-selected" : ""}" data-route-id="${escapeHtml(route.id)}" aria-pressed="${route.id === selectedId}" aria-controls="route-detail-content" aria-label="${window.HospitalI18n.html("routes.ver_ruta_value", {value0: route.name})}" data-i18n-aria-label="routes.ver_ruta_value" data-i18n-aria-label-params="${window.HospitalI18n.escape(JSON.stringify({value0: route.name}))}">
      <span class="route-card-top"><span class="route-code">${escapeHtml(route.code)}</span><span class="route-category">${escapeHtml(categoryLabels[route.category])}</span>${statusPill(route)}</span>
      <span class="route-card-name" title="${escapeHtml(route.name)}">${escapeHtml(route.name)}</span>
      <span class="route-corridor"><span title="${escapeHtml(route.origin.name)}">${escapeHtml(route.origin.name)}</span><span class="corridor-line" aria-hidden="true"></span><span title="${escapeHtml(route.destination.name)}">${escapeHtml(route.destination.name)}</span></span>
      <span class="route-card-meta"><span>${(icon("time-icon") + window.HospitalI18n.mark("trace_view.value_min", {value0: route.duration}))}</span><span>${(icon("location-icon") + window.HospitalI18n.mark("trace_view.value_km", {value0: formatDistance(route.distance)}))}</span><span>${route.stops.length ? `${route.stops.length} ${route.stops.length === 1 ? window.HospitalI18n.t("routes.parada") : window.HospitalI18n.t("routes.paradas")}` : window.HospitalI18n.t("routes.directa")}</span><span class="selection-arrow" aria-hidden="true">↗</span></span>
    </button>`).join(""));
    list.hidden = !matching.length;
    byId("catalog-empty").hidden = Boolean(matching.length);
    window.HospitalI18n.bindText(byId("empty-description"), () => routes.length ? window.HospitalI18n.t("routes.prueba_con_otra_busqueda_o_cambia_el_filtro") : window.HospitalI18n.t("routes.crea_tu_primera_ruta_para_empezar_a_organizar_tus_recorridos"));
    byId("clear-filters").hidden = !routes.length;
    window.HospitalI18n.bindText(byId("results-summary"), () => matching.length ? window.HospitalI18n.t("routes.value_value_de_value_rutas", {value0: start + 1, value1: start + visible.length, value2: matching.length}) : window.HospitalI18n.t("routes.0_rutas"));
    renderPagination(pages);
    window.HospitalI18n.bindText(byId("total-routes"), () => routes.length);
    window.HospitalI18n.bindText(byId("active-routes"), () => routes.filter(route => route.status === "active").length);
    window.HospitalI18n.bindText(byId("inactive-routes"), () => routes.filter(route => route.status === "inactive").length);
    renderDetail();
  }

  function schematic(route) {
    const positions = Array.from({ length: route.stops.length + 2 }, (_, index) => 32 + index * (296 / (route.stops.length + 1)));
    return `<div class="route-schematic"><div class="schematic-heading"><span>${icon("map-icon")}${window.HospitalI18n.mark("routes.esquema_del_recorrido")}</span><span>${window.HospitalI18n.mark("routes.sin_escala")}</span></div>
      <svg viewBox="0 0 360 90" role="img" aria-label="${window.HospitalI18n.html("routes.recorrido_desde_el_origen_hasta_el_destino_con_value_paradas_intermedias", {value0: route.stops.length})}" data-i18n-aria-label="routes.recorrido_desde_el_origen_hasta_el_destino_con_value_paradas_intermedias" data-i18n-aria-label-params="${window.HospitalI18n.escape(JSON.stringify({value0: route.stops.length}))}">
        <path d="M32 45 H328" fill="none" stroke="var(--route-line, rgba(169, 188, 229, .14))" stroke-width="12" stroke-linecap="round"/>
        <path d="M32 45 H328" fill="none" stroke="var(--route-accent, #a9bcf6)" stroke-width="2" stroke-dasharray="5 5"/>
        ${positions.map((x, index) => `<circle cx="${x}" cy="45" r="${index === 0 || index === positions.length - 1 ? 13 : 10}" fill="var(--schematic-surface, #101a33)" stroke="${index === positions.length - 1 ? "var(--route-green, #57c879)" : "var(--route-accent, #a9bcf6)"}" stroke-width="2"/><text x="${x}" y="49" text-anchor="middle" fill="${index === positions.length - 1 ? "var(--route-green, #57c879)" : "var(--route-text, #f2f3f7)"}" font-size="10" font-family="Inclusive Sans, sans-serif">${index === 0 ? window.HospitalI18n.t("routes.a") : index === positions.length - 1 ? window.HospitalI18n.t("routes.b") : index}</text>`).join("")}
      </svg><div class="schematic-labels"><span>${window.HospitalI18n.mark("trace_view.origen")}</span><span>${escapeHtml(directionLabels[route.direction])}</span><span>${window.HospitalI18n.mark("trace_view.destino")}</span></div></div>`;
  }

  function renderDetail() {
    const route = routes.find(item => item.id === selectedId);
    byId("detail-actions").hidden = !route;
    byId('edit-route').disabled=Boolean(route?.archived);
    window.HospitalI18n.bindText(byId('delete-route'), () => route?.archived?window.HospitalI18n.t("personnel.restaurar"):window.HospitalI18n.t("routes.eliminar"));
    if (!route) {
      window.HospitalI18n.setHTML(detail, `<div class="detail-placeholder"><span class="empty-icon">${icon("map-icon")}</span><h2>${window.HospitalI18n.mark("routes.tu_proximo_recorrido")}</h2><p>${routes.length ? window.HospitalI18n.t("routes.selecciona_una_ruta_del_catalogo_para_consultar_su_itinerario") : window.HospitalI18n.t("routes.anade_una_ruta_para_ver_aqui_su_itinerario_y_sus_caracteristicas")}</p></div>`);
      return;
    }
    const points = [route.origin, ...route.stops, route.destination];
    window.HospitalI18n.setHTML(detail, `<div class="detail-title-row"><span class="route-code">${escapeHtml(route.code)}</span>${statusPill(route)}</div>
      <h2>${escapeHtml(route.name)}</h2><p class="detail-category">${escapeHtml(categoryLabels[route.category])} · ${escapeHtml(directionLabels[route.direction])}</p>
      ${schematic(route)}
      <div class="route-estimates"><div><strong>${formatDistance(route.distance)} <small>${window.HospitalI18n.mark("trace_map.km")}</small></strong><span>${window.HospitalI18n.mark("routes.distancia_estimada")}</span></div><div><strong>${route.duration} <small>${window.HospitalI18n.mark("routes.min")}</small></strong><span>${window.HospitalI18n.mark("routes.duracion_estimada")}</span></div><div><strong>${route.stops.length}</strong><span>${window.HospitalI18n.mark("routes.paradas_intermedias")}</span></div></div>
      <h3 class="section-label">${window.HospitalI18n.mark("routes.itinerario")}<span>${window.HospitalI18n.mark("routes.tramo_de_ida")}</span></h3>
      <ol class="itinerary">${points.map((point, index) => {
        const last = index === points.length - 1;
        return `<li class="${last ? "destination" : index ? "intermediate" : "origin"}"><span class="stop-marker" aria-hidden="true">${last ? window.HospitalI18n.t("routes.b") : index || window.HospitalI18n.t("routes.a")}</span><div class="itinerary-copy"><span>${last ? window.HospitalI18n.t("routes.destino") : index ? window.HospitalI18n.t("routes.parada_value", {value0: index}) : window.HospitalI18n.t("routes.origen")}</span><strong>${escapeHtml(point.name)}</strong><p>${escapeHtml(point.address)}</p></div></li>`;
      }).join("")}</ol>
      ${route.notes ? `<section class="route-notes"><h3>${window.HospitalI18n.mark("routes.indicaciones_para_el_equipo")}</h3><p>${escapeHtml(route.notes)}</p></section>` : ""}`);
  }

  function selectRoute(id) {
    if (!routes.some(route => route.id === id)) return;
    selectedId = id;
    list.querySelectorAll("[data-route-id]").forEach(button => {
      const selected = button.dataset.routeId === id;
      button.classList.toggle("is-selected", selected);
      button.setAttribute("aria-pressed", String(selected));
    });
    renderDetail();
    detail.scrollTop = 0;
    if (window.matchMedia("(max-width: 770px)").matches) {
      document.querySelector(".route-detail").scrollIntoView({ behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth", block: "start" });
      const heading = detail.querySelector("h2");
      heading.tabIndex = -1;
      heading.focus({ preventScroll: true });
    }
  }

  function resetFilters() {
    search.value = "";
    activeFilter = "all";
    currentPage = 1;
    filters.forEach(button => {
      const active = button.dataset.filter === activeFilter;
      button.classList.toggle("is-active", active);
      button.setAttribute("aria-pressed", String(active));
    });
  }

  function renderStops() {
    window.HospitalI18n.setHTML(stopEditor, draftStops.map((stop, index) => `<div class="stop-editor-row" data-stop-index="${index}">
      <div class="stop-editor-heading"><span>${window.HospitalI18n.mark("routes.parada_value", {value0: index + 1})}</span><div class="stop-editor-actions">
        <button type="button" class="icon-button" data-stop-action="up" aria-label="${window.HospitalI18n.html("routes.subir_parada_value", {value0: index + 1})}" data-i18n-aria-label="routes.subir_parada_value" data-i18n-aria-label-params="${window.HospitalI18n.escape(JSON.stringify({value0: index + 1}))}" ${index === 0 ? "disabled" : ""}>↑</button>
        <button type="button" class="icon-button" data-stop-action="down" aria-label="${window.HospitalI18n.html("routes.bajar_parada_value", {value0: index + 1})}" data-i18n-aria-label="routes.bajar_parada_value" data-i18n-aria-label-params="${window.HospitalI18n.escape(JSON.stringify({value0: index + 1}))}" ${index === draftStops.length - 1 ? "disabled" : ""}>↓</button>
        <button type="button" class="icon-button" data-stop-action="remove" aria-label="${window.HospitalI18n.html("routes.quitar_parada_value", {value0: index + 1})}" data-i18n-aria-label="routes.quitar_parada_value" data-i18n-aria-label-params="${window.HospitalI18n.escape(JSON.stringify({value0: index + 1}))}">${icon("trash-icon")}</button>
      </div></div>
      <div class="form-grid"><label>${window.HospitalI18n.mark("routes.punto_de_parada")}<input type="text" data-stop-field="name" value="${escapeHtml(stop.name)}" placeholder="${window.HospitalI18n.html("routes.institucion_o_punto_de_encuentro")}" data-i18n-placeholder="routes.institucion_o_punto_de_encuentro" maxlength="100" required></label><label>${window.HospitalI18n.mark("routes.direccion_de_la_parada")}<input type="text" data-stop-field="address" value="${escapeHtml(stop.address)}" placeholder="${window.HospitalI18n.html("routes.calle_y_numero")}" data-i18n-placeholder="routes.calle_y_numero" maxlength="160" required></label></div>
    </div>`).join(""));
    byId("add-stop").disabled = draftStops.length >= 6;
    window.HospitalI18n.bindText(byId("stop-limit"), () => `${draftStops.length} / 6`);
  }

  function openForm(id = null) {
    const route = id ? routes.find(item => item.id === id) : null;
    if (busy || (id && (!route || route.archived))) return;
    editVersion=route?.version??null;
    dialogTrigger = document.activeElement;
    editingId = route?.id ?? null;
    form.reset();
    formError.hidden = true;
    window.HospitalI18n.bindText(formError, () => "");
    window.HospitalI18n.bindText(byId("form-title"), () => route ? window.HospitalI18n.t("routes.editar_ruta") : window.HospitalI18n.t("routes.nueva_ruta"));
    window.HospitalI18n.bindText(byId("form-description"), () => route ? window.HospitalI18n.t("routes.actualiza_el_recorrido_value_y_sus_caracteristicas", {value0: route.code}) : window.HospitalI18n.t("routes.define_un_recorrido_para_reutilizarlo_en_tus_traslados"));
    window.HospitalI18n.bindText(byId("save-label"), () => route ? window.HospitalI18n.t("trace_view.guardar_cambios") : window.HospitalI18n.t("routes.guardar_ruta"));
    if (route) {
      const values = { name: route.name, category: route.category, direction: route.direction, status: route.status, originName: route.origin.name, originAddress: route.origin.address, destinationName: route.destination.name, destinationAddress: route.destination.address, distance: route.distance, duration: route.duration, notes: route.notes };
      Object.entries(values).forEach(([name, value]) => { form.elements.namedItem(name).value = value; });
    }
    draftStops = structuredClone(route?.stops ?? []);
    renderStops();
    formDialog.showModal();
    document.querySelector(".form-scroll").scrollTop = 0;
    byId("route-name").focus();
  }

  function restoreDialogFocus() {
    if (dialogTrigger?.isConnected) dialogTrigger.focus({ preventScroll: true });
    else byId("new-route").focus({ preventScroll: true });
  }

  function showError(message, target) {
    console.error(window.HospitalI18n.resolve(message));
    target?.focus();
  }

  search.addEventListener("input", () => { currentPage = 1; renderCatalog(); detail.scrollTop = 0; });
  sort.addEventListener("change", () => { currentPage = 1; renderCatalog(); detail.scrollTop = 0; });
  filters.forEach(button => button.addEventListener("click", () => {
    activeFilter = button.dataset.filter;
    currentPage = 1;
    filters.forEach(item => { item.classList.toggle("is-active", item === button); item.setAttribute("aria-pressed", String(item === button)); });
    renderCatalog();
    detail.scrollTop = 0;
  }));
  byId("clear-filters").addEventListener("click", () => { resetFilters(); renderCatalog(); search.focus(); });
  pagination.addEventListener("click", event => {
    const button = event.target.closest("[data-page]");
    if (!button || button.disabled) return;
    const nextPage = Number(button.dataset.page);
    if (nextPage === currentPage) return;
    currentPage = nextPage;
    renderCatalog();
    detail.scrollTop = 0;
    pagination.querySelector('[aria-current="page"]')?.focus({ preventScroll: true });
  });
  list.addEventListener("click", event => {
    const button = event.target.closest("[data-route-id]");
    if (button) selectRoute(button.dataset.routeId);
  });
  byId("new-route").addEventListener("click", () => openForm());
  byId("edit-route").addEventListener("click", () => openForm(selectedId));
  document.querySelectorAll("[data-close-form]").forEach(button => button.addEventListener("click", () => {if(!busy)formDialog.close();}));
  formDialog.addEventListener("close", () => { editingId = null; restoreDialogFocus(); });
  form.addEventListener("input", () => { formError.hidden = true; });

  byId("add-stop").addEventListener("click", () => {
    if (draftStops.length >= 6) return;
    draftStops.push({ name: "", address: "" });
    renderStops();
    stopEditor.lastElementChild.querySelector("input").focus();
  });
  stopEditor.addEventListener("input", event => {
    const field = event.target.dataset.stopField;
    if (!field) return;
    const index = Number(event.target.closest("[data-stop-index]").dataset.stopIndex);
    draftStops[index][field] = event.target.value;
  });
  stopEditor.addEventListener("click", event => {
    const button = event.target.closest("[data-stop-action]");
    if (!button || button.disabled) return;
    const index = Number(button.closest("[data-stop-index]").dataset.stopIndex);
    const action = button.dataset.stopAction;
    let focusIndex = index;
    if (action === "remove") draftStops.splice(index, 1);
    else {
      const target = index + (action === "up" ? -1 : 1);
      [draftStops[index], draftStops[target]] = [draftStops[target], draftStops[index]];
      focusIndex = target;
    }
    renderStops();
    const row = stopEditor.children[Math.min(focusIndex, draftStops.length - 1)];
    (row?.querySelector("input") || byId("add-stop")).focus();
  });

  form.addEventListener("submit", async event => {
    event.preventDefault();
    if(busy)return;
    if(!form.checkValidity()){showError(() => window.HospitalI18n.t("routes.revisa_los_campos_obligatorios_y_las_estimaciones"), form.querySelector(":invalid"));return;}
    const data = new FormData(form);
    const field = name => String(data.get(name) ?? "").trim();
    const requiredFields = ["name", "originName", "originAddress", "destinationName", "destinationAddress"];
    const blankField = requiredFields.find(name => !field(name));
    if (blankField) { showError(() => window.HospitalI18n.t("routes.completa_los_campos_obligatorios_con_un_nombre_o_direccion_validos"), form.elements.namedItem(blankField)); return; }
    if (routes.some(route => route.id !== editingId && normalize(route.name) === normalize(field("name")))) {
      showError(() => window.HospitalI18n.t("routes.ya_existe_una_ruta_con_ese_nombre_elige_un_nombre_diferente"), byId("route-name"));
      return;
    }
    const stops = draftStops.map(stop => ({ name: stop.name.trim(), address: stop.address.trim() }));
    const blankStop = stops.findIndex(stop => !validPlace(stop));
    if (blankStop >= 0) {
      showError(() => window.HospitalI18n.t("routes.completa_el_nombre_y_la_direccion_de_cada_parada_o_quitala_del_recorrido"), stopEditor.children[blankStop].querySelector("input"));
      return;
    }
    const origin = { name: field("originName"), address: field("originAddress") };
    const destination = { name: field("destinationName"), address: field("destinationAddress") };
    const samePlace = (a, b) => normalize(a.name) === normalize(b.name) && normalize(a.address) === normalize(b.address);
    if (samePlace(origin, destination)) { showError(() => window.HospitalI18n.t("routes.el_origen_y_el_destino_deben_ser_diferentes"), byId("route-destination")); return; }
    const points = [origin, ...stops, destination];
    if (points.some((point, index) => index > 0 && samePlace(point, points[index - 1]))) {
      showError(() => window.HospitalI18n.t("routes.dos_puntos_consecutivos_del_itinerario_no_pueden_ser_iguales"), byId("route-origin"));
      return;
    }
    const previous = routes.find(route => route.id === editingId);
    const body={name:field('name'),category:keyFor(categoryLabels,field('category')),direction:keyFor(directionLabels,field('direction')),availability:field('status')==='active'?'active':'inactive',origin_name:origin.name,origin_address:origin.address,destination_name:destination.name,destination_address:destination.address,stops,distance_meters:Math.round(Number(field('distance'))*1000),duration_seconds:Number(field('duration'))*60,notes:field('notes')};
    if(editingId)Object.assign(body,{id:editingId,version:editVersion});
    setBusy(true);
    try{
      const route=adapt(await api.post(`routes/${editingId?'update':'create'}.php`,body));
      routes=routes.filter(item=>item.id!==route.id);routes.push(route);
      resetFilters();selectedId=route.id;currentPage=Math.floor(filteredRoutes().findIndex(item=>item.id===route.id)/pageSize)+1;
      renderCatalog();detail.scrollTop=0;formDialog.close();
      notify(() => previous?window.HospitalI18n.t("trace_view.cambios_guardados"):window.HospitalI18n.t("routes.ruta_creada"));
      if(!route.geometry.length)console.warn(window.HospitalI18n.t("shared.hospital_routes_ruta_guardada_con_mapa_pendiente_revisa_las_direcciones_o_la_conexion"));
    }catch(error){api.report(error,'routes');}finally{setBusy(false);}

  });

  byId("delete-route").addEventListener("click", () => {
    const route = routes.find(item => item.id === selectedId);
    if (busy || !route) return;
    deleteVersion=route.version;
    window.HospitalI18n.bindText(byId("delete-title"), () => route.archived?window.HospitalI18n.t("routes.restaurar_esta_ruta"):window.HospitalI18n.t("routes.archivar_esta_ruta"));
    window.HospitalI18n.bindText(byId("confirm-delete"), () => route.archived?window.HospitalI18n.t("routes.restaurar_ruta"):window.HospitalI18n.t("routes.eliminar_ruta"));
    window.HospitalI18n.bindText(deleteDialog.querySelector('.delete-warning'), () => route.archived?window.HospitalI18n.t("routes.volvera_al_catalogo_con_su_estado_de_disponibilidad_anterior"):window.HospitalI18n.t("routes.se_quitara_del_catalogo_de_rutas_los_traslados_existentes_conservaran_su_recorrido_podes_r"));
    dialogTrigger = document.activeElement;
    pendingDeleteId = route.id;
    window.HospitalI18n.bindText(byId("delete-description"), () => `${route.code} · ${route.name}`);
    deleteDialog.showModal();
  });
  document.querySelectorAll("[data-close-delete]").forEach(button => button.addEventListener("click", () => {if(!busy)deleteDialog.close();}));
  deleteDialog.addEventListener("close", () => { pendingDeleteId = null; restoreDialogFocus(); });
  byId("confirm-delete").addEventListener("click", async () => {
    const route=routes.find(item=>item.id===pendingDeleteId);if(busy||!route)return;
    setBusy(true);
    try{
      const changed=adapt(await api.post(`routes/${route.archived?'restore':'archive'}.php`,{id:route.id,version:deleteVersion}));
      routes=routes.map(item=>item.id===changed.id?changed:item);renderCatalog();detail.scrollTop=0;deleteDialog.close();notify(() => route.archived?window.HospitalI18n.t("routes.ruta_restaurada"):window.HospitalI18n.t("routes.ruta_archivada"));
    }catch(error){api.report(error,'routes');}finally{setBusy(false);}
  });

  [formDialog, deleteDialog].forEach(dialog => dialog.addEventListener("click", event => {
    if (busy || event.target !== dialog) return;
    const bounds = dialog.getBoundingClientRect();
    if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) dialog.close();
  }));

  [formDialog,deleteDialog].forEach(dialog=>dialog.addEventListener('cancel',event=>{if(busy)event.preventDefault();}));
  async function start(){
    try{if(!await window.HospitalAuth.ready)return;await reload();selectedId=routes[0]?.id??null;renderCatalog();fitCatalogPage();setBusy(false);try{localStorage.removeItem('hospital.presetRoutes.v1');}catch(_){} }
    catch(error){api.report(error,'routes');}
  }
  start();
  const catalogObserver = new ResizeObserver(fitCatalogPage);
  catalogObserver.observe(list);
  window.addEventListener('hospital:localechange',()=>{renderCatalog();});

})();
