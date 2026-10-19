document.addEventListener("DOMContentLoaded", async () => {
    "use strict";
    await window.HospitalI18n.ready;
    await window.HospitalAuth.ready;

  const grid = document.getElementById("documentsGrid");
  const searchInput = document.getElementById("documentSearchInput");
  const searchButton = document.getElementById("documentSearchButton");
  const listFilters = document.getElementById("documentListFilters");
  const listSearch = document.getElementById("documentListSearch");
  const resultsStatus = document.getElementById("documentResultsStatus");
  const typeButton = document.getElementById("documentTypeButton");
  const typeMenu = document.getElementById("documentTypeMenu");
  const dateButton = document.getElementById("documentDateButton");
  const dateMenu = document.getElementById("documentDateMenu");
  const prevButton = document.getElementById("prevDocs");
  const nextButton = document.getElementById("nextDocs");
  const gridViewButton = document.getElementById("gridView");
  const listViewButton = document.getElementById("listView");
  const pagination = document.querySelector(".documents-pagination");
  const editDocumentButton = document.getElementById("editDocumentButton");
  const selectionBar = document.getElementById("documentSelectionBar");
  const selectionTitle = document.getElementById("documentSelectionTitle");
  const selectionStatus = document.getElementById("documentSelectionStatus");
  const selectAllButton = document.getElementById("selectAllDocuments");
  const editSelectedButton = document.getElementById("editSelectedDocument");
  const deleteSelectedButton = document.getElementById("deleteSelectedDocuments");
  const cancelSelectionButton = document.getElementById("cancelDocumentSelection");
  const actionStatus = document.getElementById("documentActionStatus");
  const selectedDocumentIds = new Set();
  let total = 0, loaded = false, loading = false, requestRevision = 0, listState = "active", searchTimer;
  const api = window.DocumentApi;
  const archiveToggle = document.getElementById("documentsArchiveToggle");
  const pageSize = () => viewMode === "grid" ? 4 : 20;
  let currentPage = 1;
  let viewMode = "grid";
  let selectedType = "";
  let selectedDateOrder = "";
  let selectionMode = null;
  let selectionOriginId = null;
  let isDeleting = false;
  if (!grid) return;
  let documents = [];

  function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>"']/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]);
  }

  const fileType = item => item.file.extension;
  const matches = () => documents;
  async function load(append=false) {
    if(append&&(loading||viewMode!=='list'||documents.length>=total||isDeleting))return;
    if(!append&&viewMode==='list')currentPage=1;
    const revision=++requestRevision,nextPage=append?currentPage+1:currentPage;
    loading=true;
    if(!append){loaded=false;documents=[];selectedDocumentIds.clear();selectionMode=null;render();}
    try{
      if(!await window.HospitalAuth.ready)return;
      const result=await api.list({page:nextPage,page_size:pageSize(),q:searchInput.value.trim(),type:selectedType,sort:selectedDateOrder||'recent',state:listState});
      if(revision!==requestRevision)return;
      total=result.meta.total;
      if(!append&&currentPage>1&&!result.data.length&&total){currentPage=Math.ceil(total/pageSize());return load();}
      currentPage=nextPage;
      documents=append?[...new Map([...documents,...result.data].map(item=>[item.id,item])).values()]:result.data;
      loaded=true;
    }catch(error){window.HospitalApi.report(error,'documents');}
    finally{if(revision===requestRevision){loading=false;const top=grid.scrollTop;render();if(append)grid.scrollTop=top;
      if(loaded&&viewMode==='list'&&documents.length<total&&grid.scrollHeight<=grid.clientHeight+2)requestAnimationFrame(()=>load(true));}}
  }

  function render() {
    const filtered = matches();
    const pageCount = Math.max(1, Math.ceil(total / pageSize()));
    const visible = filtered;

    const cards = visible.map((item) => `
      <${selectionMode ? 'div role="button" tabindex="0"' : `a href="documents-viewer.html?id=${encodeURIComponent(item.id)}"`} class="document-link" aria-label="${window.HospitalI18n.html("documents.abrir_value", {value0: item.title})}" data-i18n-aria-label="documents.abrir_value" data-i18n-aria-label-params="${window.HospitalI18n.escape(JSON.stringify({value0: item.title}))}" data-document-id="${escapeHtml(item.id)}" data-file-type="${escapeHtml(fileType(item))}"${selectionMode ? ' aria-describedby="documentSelectionStatus"' : ''}>
        <article class="document-folder-card">
          ${selectionMode ? `<span class="document-selection-check" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${selectionMode === "edit" ? "1.8" : "2.5"}" stroke-linecap="round" stroke-linejoin="round"><path d="${selectionMode === "edit" ? "m16 3 5 5-12 12-6 1 1-6L16 3ZM14 5l5 5" : "m5 12 4 4L19 6"}"/></svg></span>` : `
          <button type="button" class="more-options" aria-label="${window.HospitalI18n.html("documents.opciones_de_value", {value0: item.title})}" data-i18n-aria-label="documents.opciones_de_value" data-i18n-aria-label-params="${window.HospitalI18n.escape(JSON.stringify({value0: item.title}))}" aria-haspopup="true" aria-expanded="false">⋮</button>
          <div class="document-dropdown-menu"><ul>
            ${listState === "archived" ? `<li><button type="button" class="restore-btn">${window.HospitalI18n.mark("personnel.restaurar")}</button></li>` : `<li><button type="button" class="edit-btn">${window.HospitalI18n.mark("trace_view.editar")}</button></li><li><button type="button" class="select-btn">${window.HospitalI18n.mark("documents.seleccionar")}</button></li><li><button type="button" class="delete-btn">${window.HospitalI18n.mark("routes.eliminar")}</button></li>`}
          </ul></div>`}
          <img src="../../../assets/Icons/folder-icon.svg" alt="">
          <p class="document-date">${escapeHtml(api.date(item.document_date))}</p>
          <p class="document-name">${escapeHtml(item.title)}</p>
          <p class="document-size">${escapeHtml(api.size(item.file.byte_size))}</p>
          <p class="document-time">${escapeHtml(api.time(item.created_at))}</p>
        </article>
      </${selectionMode ? 'div' : 'a'}>`).join("");
    const emptySlots = viewMode === "grid" ? Array.from(
      { length: Math.max(0, pageSize() - visible.length) },
      () => '<div class="document-placeholder" aria-hidden="true"></div>'
    ).join("") : "";

    window.HospitalI18n.setHTML(grid, cards + emptySlots);
    if (!visible.length) {
      window.HospitalI18n.setHTML(grid, `<div class="document-placeholder has-message">${loading ? `<p class="documents-empty">${window.HospitalI18n.mark("documents.cargando_documentos")}</p>` : loaded ? `<p class="documents-empty">${window.HospitalI18n.mark("documents.no_se_encontraron_documentos")}</p>` : ''}</div>`);
    }
    grid.classList.toggle("list-view", viewMode === "list");
    grid.setAttribute("aria-busy", String(loading));
    pagination.hidden = viewMode !== "grid";
    prevButton.disabled = loading || currentPage === 1;
    nextButton.disabled = loading || currentPage >= pageCount;
    if (resultsStatus) window.HospitalI18n.bindText(resultsStatus, () => loaded ? (viewMode==='list'?window.HospitalI18n.t("documents.value_de_value_documentos", {value0: documents.length, value1: total}):window.HospitalI18n.t("documents.grid_result_summary", {count:total, result:total===1?window.HospitalI18n.t("documents.documento_encontrado"):window.HospitalI18n.t("documents.documentos_encontrados"),page:currentPage,pages:pageCount})) : "");
    updateSelection();
  }

  function updateSelection() {
    const validIds = new Set(documents.map((item) => String(item.id)));
    for (const id of selectedDocumentIds) {
      if (!validIds.has(id)) selectedDocumentIds.delete(id);
    }
    const links = [...grid.querySelectorAll(".document-link")];
    links.forEach((link) => {
      const selected = selectedDocumentIds.has(link.dataset.documentId);
      link.querySelector(".document-folder-card").classList.toggle("selected", selected);
      if (selectionMode) {
        const name = link.querySelector(".document-name").textContent.trim();
        window.HospitalI18n.bindAttr(link, "aria-label", () => `${selectionMode === "edit" ? window.HospitalI18n.t("trace_view.editar") : window.HospitalI18n.t("documents.seleccionar")} ${name}`);
        link.setAttribute("aria-disabled", String(isDeleting));
        if (selectionMode === "bulk") link.setAttribute("aria-pressed", String(selected));
      }
    });
    grid.classList.toggle("selection-mode", Boolean(selectionMode));
    grid.classList.toggle("edit-selection-mode", selectionMode === "edit");
    editDocumentButton.setAttribute("aria-pressed", String(selectionMode === "edit"));
    editDocumentButton.disabled = isDeleting || loading || listState === "archived";
    selectionBar.hidden = !selectionMode;
    selectionBar.setAttribute("aria-busy", String(isDeleting));
    if (!selectionMode) return;

    const bulk = selectionMode === "bulk";
    const count = selectedDocumentIds.size;
    const scope = matches();
    const allSelected = scope.length > 0 && scope.every((item) => selectedDocumentIds.has(String(item.id)));
    window.HospitalI18n.bindText(selectionTitle, () => bulk ? window.HospitalI18n.t("documents.seleccionar_documentos") : window.HospitalI18n.t("documents.elegi_un_documento_para_editar"));
    if (isDeleting) {
      window.HospitalI18n.bindText(selectionStatus, () => window.HospitalI18n.t("documents.eliminando_documentos"));
    } else if (!bulk) {
      window.HospitalI18n.bindText(selectionStatus, () => scope.length ? window.HospitalI18n.t("documents.hace_clic_en_una_tarjeta_para_abrir_su_edicion") : window.HospitalI18n.t("documents.no_hay_documentos_en_esta_vista_cambia_los_filtros_o_cancela"));
    } else if (!count) {
      window.HospitalI18n.bindText(selectionStatus, () => window.HospitalI18n.t("documents.hace_clic_en_las_tarjetas_para_seleccionarlas"));
    } else {
      const visibleIds = new Set(links.map((link) => link.dataset.documentId));
      const outsideView = [...selectedDocumentIds].filter((id) => !visibleIds.has(id)).length;
      window.HospitalI18n.bindText(selectionStatus, () => `${count} ${count === 1 ? window.HospitalI18n.t("documents.documento_seleccionado") : window.HospitalI18n.t("documents.documentos_seleccionados")}${outsideView ? window.HospitalI18n.t("documents.value_fuera_de_esta_vista", {value0: outsideView}) : ""}.`);
    }
    selectAllButton.hidden = !bulk;
    selectAllButton.disabled = isDeleting || !scope.length;
    window.HospitalI18n.bindText(selectAllButton, () => allSelected ? window.HospitalI18n.t("documents.deseleccionar_todos") : window.HospitalI18n.t("documents.seleccionar_todos"));
    window.HospitalI18n.bindAttr(selectAllButton, "title", () => window.HospitalI18n.t("documents.seleccionar_o_deseleccionar_los_documentos_de_esta_pagina"));
    editSelectedButton.hidden = !bulk || count > 1;
    editSelectedButton.disabled = isDeleting || count !== 1;
    deleteSelectedButton.hidden = !bulk;
    deleteSelectedButton.disabled = isDeleting || !count;
    cancelSelectionButton.disabled = isDeleting;
  }

  function focusDocument(id) {
    const links = [...grid.querySelectorAll(".document-link")];
    const link = links.find((item) => item.dataset.documentId === id) || links[0];
    (selectionMode ? link : link?.querySelector(".more-options"))?.focus({ preventScroll: true });
  }

  function startSelection(mode, id = null) {
    if (isDeleting) return;
    closeMenus();
    closeFilterMenus();
    selectedDocumentIds.clear();
    selectionMode = mode;
    selectionOriginId = id;
    if (mode === "bulk" && id) selectedDocumentIds.add(id);
    actionStatus.hidden = true;
    render();
    focusDocument(id);
  }

  function cancelSelection() {
    if (!selectionMode || isDeleting) return;
    const wasEdit = selectionMode === "edit";
    selectionMode = null;
    selectedDocumentIds.clear();
    render();
    if (wasEdit) editDocumentButton.focus({ preventScroll: true });
    else focusDocument(selectionOriginId);
    selectionOriginId = null;
  }

  function editDocument(id) {
    if (!isDeleting && listState === "active" && documents.some((item) => String(item.id) === id)) {
      window.location.href = `documents-edit.html?id=${encodeURIComponent(id)}`;
    }
  }

  function activateCard(link) {
    if (isDeleting) return;
    const id = link.dataset.documentId;
    if (selectionMode === "edit") {
      editDocument(id);
    } else if (selectionMode === "bulk") {
      if (selectedDocumentIds.has(id)) selectedDocumentIds.delete(id);
      else selectedDocumentIds.add(id);
      updateSelection();
    }
  }

  async function deleteDocuments(ids) {
    if (isDeleting) return;
    const items = documents.filter((item) => ids.includes(String(item.id)));
    if (!items.length) return;
    const question = items.length === 1
      ? window.HospitalI18n.t("documents.archivar_value", {value0: items[0].title})
      : window.HospitalI18n.t("documents.archivar_los_value_documentos_seleccionados_se_conservaran_los_archivos_y_su_historial", {value0: items.length});
    if (!confirm(question)) return;

    closeMenus();
    isDeleting = true;
    updateSelection();
    grid.setAttribute("aria-busy", "true");
    actionStatus.hidden = false;
    actionStatus.classList.remove("error");
    window.HospitalI18n.bindText(actionStatus, () => window.HospitalI18n.t("documents.eliminando_documentos"));
    try {
      const results = [];
      for (let offset = 0; offset < items.length; offset += 100) {
        results.push(...await api.bulkArchive(items.slice(offset, offset + 100).map(item => ({ id: item.id, version: item.version }))));
      }
      const failures = results.filter(item => !item.success);
      failures.forEach(item => window.HospitalApi.report(new window.HospitalApi.ApiError(item.error.message, item.error.status, item.error.code), "documents"));
      const count = results.length - failures.length;
      window.HospitalI18n.bindText(actionStatus, () => count ? `${count} ${count === 1 ? window.HospitalI18n.t("documents.documento_archivado") : window.HospitalI18n.t("documents.documentos_archivados")}.` : "");
      actionStatus.hidden = !count;
    } catch (error) { window.HospitalApi.report(error, "documents"); window.HospitalI18n.bindText(actionStatus, () => ""); actionStatus.hidden = true; }
    finally { isDeleting = false; grid.setAttribute("aria-busy", "false"); await load(); }
  }

  function setViewMode(mode) {
    closeFilterMenus();
    viewMode = mode;
    currentPage = 1;
    gridViewButton.classList.toggle("active", mode === "grid");
    listViewButton.classList.toggle("active", mode === "list");
    gridViewButton.setAttribute("aria-pressed", String(mode === "grid"));
    listViewButton.setAttribute("aria-pressed", String(mode === "list"));
    listFilters.hidden = mode !== "list";
    listSearch.hidden = mode !== "list";
    load();
  }

  function closeFilterMenus() {
    for (const [button, menu] of [[typeButton, typeMenu], [dateButton, dateMenu]]) {
      button.setAttribute("aria-expanded", "false");
      menu.hidden = true;
    }
  }

  function setupFilter(button, menu, key, onSelect) {
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      const shouldOpen = menu.hidden;
      closeFilterMenus();
      if (shouldOpen) {
        menu.hidden = false;
        button.setAttribute("aria-expanded", "true");
      }
    });
    button.addEventListener("keydown", (event) => {
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        closeFilterMenus();
        menu.hidden = false;
        button.setAttribute("aria-expanded", "true");
        const options = menu.querySelectorAll("button");
        options[event.key === "ArrowDown" ? 0 : options.length - 1].focus();
      } else if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        closeFilterMenus();
      }
    });
    menu.addEventListener("click", (event) => {
      const option = event.target.closest(`button[data-${key}]`);
      if (!option) return;
      event.stopPropagation();
      menu.querySelectorAll("button").forEach((item) => {
        item.setAttribute("aria-pressed", String(item === option));
      });
      onSelect(option.dataset[key], option.textContent.trim());
      closeFilterMenus();
      button.focus();
      grid.scrollTop = 0;
      currentPage = 1; load();
    });
    menu.addEventListener("keydown", (event) => {
      const options = [...menu.querySelectorAll("button")];
      const index = options.indexOf(document.activeElement);
      if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
        event.preventDefault();
        const next = event.key === "Home" ? 0 : event.key === "End" ? options.length - 1
          : (index + (event.key === "ArrowDown" ? 1 : -1) + options.length) % options.length;
        options[next].focus();
      } else if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        closeFilterMenus();
        button.focus();
      }
    });
  }

  setupFilter(typeButton, typeMenu, "type", (value, label) => {
    selectedType = value;
    window.HospitalI18n.bindText(document.getElementById("documentTypeLabel"), () => window.HospitalI18n.t("documents.tipo_value", {value0: label}));
  });
  setupFilter(dateButton, dateMenu, "date", (value, label) => {
    selectedDateOrder = value;
    window.HospitalI18n.bindText(document.getElementById("documentDateLabel"), () => value ? label : window.HospitalI18n.t("documents.fecha"));
  });

  function closeMenus() {
    document.querySelectorAll(".document-dropdown-menu.active").forEach((menu) => {
      menu.classList.remove("active");
      menu.closest(".document-link")?.classList.remove("menu-open");
    });
    document.querySelectorAll('.more-options[aria-expanded="true"]').forEach((button) => {
      button.setAttribute("aria-expanded", "false");
    });
  }

  grid.addEventListener("click", async (event) => {
    const link = event.target.closest(".document-link");
    if (!link) return;
    if (selectionMode || isDeleting) {
      event.preventDefault();
      event.stopPropagation();
      activateCard(link);
      return;
    }
    const button = event.target.closest("button");
    if (!button) return;
    event.preventDefault();
    event.stopPropagation();
    const card = button.closest(".document-folder-card");

    if (button.classList.contains("more-options")) {
      const menu = card.querySelector(".document-dropdown-menu");
      const open = !menu.classList.contains("active");
      closeMenus();
      menu.classList.toggle("active", open);
      card.closest(".document-link").classList.toggle("menu-open", open);
      button.setAttribute("aria-expanded", String(open));
    } else if (button.classList.contains("restore-btn")) {
      const item = documents.find(item => item.id === link.dataset.documentId);
      button.disabled = true;
      try { await api.restore(item.id, item.version); await load(); }
      catch (error) { window.HospitalApi.report(error, "documents"); button.disabled = false; }
    } else if (button.classList.contains("edit-btn")) {
      editDocument(link.dataset.documentId);
    } else if (button.classList.contains("select-btn")) {
      startSelection("bulk", link.dataset.documentId);
    } else if (button.classList.contains("delete-btn")) {
      await deleteDocuments([link.dataset.documentId]);
    }
  });

  grid.addEventListener("keydown", (event) => {
    const link = event.target.closest(".document-link");
    if (!selectionMode || !link || !["Enter", " "].includes(event.key)) return;
    event.preventDefault();
    activateCard(link);
  });
  editDocumentButton.addEventListener("click", () => {
    if (selectionMode === "edit") cancelSelection();
    else startSelection("edit");
  });
  cancelSelectionButton.addEventListener("click", cancelSelection);
  selectAllButton.addEventListener("click", () => {
    if (selectionMode !== "bulk" || isDeleting) return;
    const ids = matches().map((item) => String(item.id));
    const allSelected = ids.length > 0 && ids.every((id) => selectedDocumentIds.has(id));
    ids.forEach((id) => {
      if (allSelected) selectedDocumentIds.delete(id);
      else selectedDocumentIds.add(id);
    });
    updateSelection();
  });
  editSelectedButton.addEventListener("click", () => {
    if (selectionMode === "bulk" && selectedDocumentIds.size === 1) editDocument([...selectedDocumentIds][0]);
  });
  deleteSelectedButton.addEventListener("click", () => {
    if (selectionMode === "bulk") deleteDocuments([...selectedDocumentIds]);
  });
  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    const openFilterButton = [typeButton, dateButton].find((button) => button.getAttribute("aria-expanded") === "true");
    if (openFilterButton) {
      closeFilterMenus();
      openFilterButton.focus();
    } else if (selectionMode) {
      cancelSelection();
    } else {
      const openMenuButton = grid.querySelector('.more-options[aria-expanded="true"]');
      closeMenus();
      openMenuButton?.focus();
    }
  });
  document.addEventListener("click", () => { closeMenus(); closeFilterMenus(); });
  searchInput?.addEventListener("input", () => { clearTimeout(searchTimer); searchTimer = setTimeout(() => { currentPage = 1; grid.scrollTop = 0; load(); }, 220); });
  searchButton?.addEventListener("click", () => searchInput.focus());
  prevButton?.addEventListener("click", () => { currentPage -= 1; load(); });
  nextButton?.addEventListener("click", () => { currentPage += 1; load(); });
  gridViewButton?.addEventListener("click", () => setViewMode("grid"));
  listViewButton?.addEventListener("click", () => setViewMode("list"));

  archiveToggle.addEventListener("click", () => {
    listState = listState === "active" ? "archived" : "active";
    archiveToggle.setAttribute("aria-pressed", String(listState === "archived"));
    window.HospitalI18n.bindText(archiveToggle, () => listState === "archived" ? window.HospitalI18n.t("personnel.ver_activos") : window.HospitalI18n.t("personnel.ver_archivados"));
    currentPage = 1; load();
  });
  window.addEventListener("pageshow", event => { if (event.persisted) load(); });
  grid.addEventListener('scroll',()=>{if(grid.scrollTop+grid.clientHeight>=grid.scrollHeight-100)load(true);});
  load();
  window.addEventListener('hospital:localechange',()=>{render();});

});
