document.addEventListener("DOMContentLoaded", async () => {
    "use strict";
    await window.HospitalI18n.ready;
    await window.HospitalAuth.ready;

  const $ = id => document.getElementById(id);
  const api = window.DocumentApi;
  const report = error => window.HospitalApi.report(error, "document-viewer");
  const params = new URLSearchParams(location.search);
  const id = params.get("id");
  let data, file, pdf, pdfjs, image, renderTask, thumbnailObserver, thumbnailBusy = false;
  let thumbnailNext = 1, thumbnailQueue = [], renderRevision = 0, resizeTimer, toastTimer;
  let passwordUpdate, loadingTask;
  const state = { page: 1, pages: 0, zoom: 100, rotation: 0, thumbnails: true };
  const tools = ["page-input", "toggle-thumbnails", "zoom-out", "zoom-in", "zoom-reset", "rotate-button", "fullscreen-button"];
  const actions = ["download-button", "share-button", "more-button", "print-button", "qr-button", "delete-button"];
  [...tools, ...actions].forEach(name => { $(name).disabled = true; });

  function contentUrl(download = false) { return api.content(id, file.version, download); }
  function shareUrl() {
    const url = new URL("documents-viewer.html", location.href);
    url.search = new URLSearchParams({ id, file_version: file.version });
    return url.href;
  }
  function toast(text) {
    window.HospitalI18n.bindText($("toast"), () => window.HospitalI18n.resolve(text)); $("toast").hidden = false; clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { $("toast").hidden = true; }, 2600);
  }
  async function bytes(download = false) {
    const response = await fetch(contentUrl(download), { headers:{'X-Hospital-Locale':window.HospitalI18n.locale}, credentials: "same-origin", cache: "no-store" });
    if (!response.ok || response.headers.get("Content-Type")?.includes("application/json")) {
      let payload; try { payload = await response.json(); } catch (_) { /* Structured errors are optional here. */ }
      const error = new window.HospitalApi.ApiError(payload?.error?.message || window.HospitalI18n.t("documents_viewer.no_se_pudo_abrir_el_archivo"), response.status, payload?.error?.code || "DOCUMENT_READ_FAILED");
      if (response.status === 401) window.dispatchEvent(new CustomEvent("hospital:unauthorized", { detail: error }));
      throw error;
    }
    return new Uint8Array(await response.arrayBuffer());
  }
  function metadata() {
    window.HospitalI18n.bindText($("document-title"), () => data.title);
    window.HospitalI18n.bindText($("patient-name"), () => data.patient ? data.patient.full_name : window.HospitalI18n.t("documents_viewer.sin_paciente_asociado"));
    window.HospitalI18n.bindText($("document-id"), () => data.id);
    window.HospitalI18n.bindText($("document-kind"), () => window.HospitalI18n.category(data.category));
    window.HospitalI18n.bindText($("document-format"), () => file.extension.toUpperCase());
    window.HospitalI18n.bindText($("document-size"), () => api.size(file.byte_size));
    window.HospitalI18n.bindText($("document-author"), () => data.uploader.name);
    window.HospitalI18n.bindText($("document-uploaded"), () => api.date(data.created_at));
    window.HospitalI18n.bindText($("document-updated"), () => `${api.date(data.updated_at)} · ${api.time(data.updated_at)}`);
    window.HospitalI18n.bindText($("document-description"), () => data.description);
    $("document-description").hidden = !data.description;
    window.HospitalI18n.bindText($("document-date"), () => api.date(data.document_date));
    window.HospitalI18n.bindText($("qr-document-id"), () => data.id);
    window.HospitalI18n.bindText($("delete-button").querySelector("span"), () => data.archived_at ? window.HospitalI18n.t("documents_viewer.restaurar_documento") : window.HospitalI18n.t("documents_viewer.eliminar_documento"));
    $("edit-document-menu").disabled = Boolean(data.archived_at);
    document.documentElement.dataset.documentTitle = window.HospitalI18n.t("documents_viewer.value_visor_de_documentos", {value0: data.title});
    window.HospitalI18n.bindTitle(() => document.documentElement.dataset.documentTitle);
    $("share-url").value = shareUrl();
  }
  function pageState() {
    $("page-input").max = Math.max(1, state.pages); $("page-input").value = state.pages ? state.page : '';
    window.HospitalI18n.bindText($("total-pages"), () => state.pages || '—');
    window.HospitalI18n.bindText($("zoom-reset"), () => `${state.zoom}%`);
    $("zoom-out").disabled = !state.pages || state.zoom <= 50; $("zoom-in").disabled = !state.pages || state.zoom >= 200;
    const status = state.pages ? window.HospitalI18n.t("documents_viewer.pagina_value_de_value_zoom_value", {value0: state.page, value1: state.pages, value2: state.zoom}) : data?.archived_at ? window.HospitalI18n.t("documents_viewer.documento_archivado") : file?.extension === 'docx' ? window.HospitalI18n.t("documents_viewer.archivo_docx_descarga_el_archivo_para_abrirlo_en_tu_dispositivo") : '';
    window.HospitalI18n.bindAttr($("document-sheet"), "aria-label", () => (state.pages ? window.HospitalI18n.t("documents_viewer.pagina_value_de_value_zoom_value", {value0: state.page, value1: state.pages, value2: state.zoom}) : data?.archived_at ? window.HospitalI18n.t("documents_viewer.documento_archivado") : file?.extension === 'docx' ? window.HospitalI18n.t("documents_viewer.archivo_docx_descarga_el_archivo_para_abrirlo_en_tu_dispositivo") : '') || window.HospitalI18n.t("documents_viewer.vista_previa_del_documento"));
    window.HospitalI18n.bindText($("viewer-status"), () => (state.pages ? window.HospitalI18n.t("documents_viewer.pagina_value_de_value_zoom_value", {value0: state.page, value1: state.pages, value2: state.zoom}) : data?.archived_at ? window.HospitalI18n.t("documents_viewer.documento_archivado") : file?.extension === 'docx' ? window.HospitalI18n.t("documents_viewer.archivo_docx_descarga_el_archivo_para_abrirlo_en_tu_dispositivo") : ''));
    $("thumbnail-list").querySelectorAll("button").forEach(button => {
      if (Number(button.dataset.page) === state.page) button.setAttribute("aria-current", "page");
      else button.removeAttribute("aria-current");
    });
  }
  async function renderPage() {
    if (!pdf && !image) {
      if (file?.extension === 'docx' && !data.archived_at) {
        $("page-frame").style.width = `${Math.max(1, $("document-viewport").clientWidth - 24)}px`;
        $("page-frame").style.height = `${Math.max(240, $("document-viewport").clientHeight - 24)}px`;
      }
      return;
    }
    const revision = ++renderRevision; pageState();
    if (renderTask) { renderTask.cancel(); try { await renderTask.promise; } catch (_) { /* A newer view replaces it. */ } }
    const viewport = $("document-viewport");
    const width = Math.max(1, viewport.clientWidth - 24), height = Math.max(1, viewport.clientHeight - 24);
    try {
      if (pdf) {
        const page = await pdf.getPage(state.page);
        if (revision !== renderRevision) return;
        const rotation = (page.rotate + state.rotation) % 360;
        const natural = page.getViewport({ scale: 1, rotation });
        const scale = Math.min(width / natural.width, height / natural.height) * state.zoom / 100;
        const view = page.getViewport({ scale, rotation });
        const pixelRatio = Math.min(window.devicePixelRatio || 1, 2, Math.sqrt(16000000 / (view.width * view.height)));
        const canvas = $("document-canvas");
        canvas.width = Math.ceil(view.width * pixelRatio); canvas.height = Math.ceil(view.height * pixelRatio);
        $("page-frame").style.width = `${view.width}px`; $("page-frame").style.height = `${view.height}px`;
        $("document-sheet").style.width = `${view.width}px`; $("document-sheet").style.height = `${view.height}px`;
        $("document-sheet").style.transform = `translate(-50%, -50%)`;
        canvas.hidden = false; canvas.style.width = `${view.width}px`; canvas.style.height = `${view.height}px`;
        renderTask = page.render({ canvasContext: canvas.getContext("2d"), viewport: view, transform: [pixelRatio, 0, 0, pixelRatio, 0, 0] });
        await renderTask.promise;
        if (revision !== renderRevision) return;
        const text = await page.getTextContent();
        if (revision !== renderRevision) return;
        window.HospitalI18n.bindAttr($("document-sheet"), "aria-label", () => window.HospitalI18n.t("documents_viewer.pagina_value_value", {value0: state.page, value1: text.items.map(item => item.str || "").join(" ").slice(0, 6000)}));
      } else {
        const rotated = state.rotation % 180 !== 0;
        const w = rotated ? image.naturalHeight : image.naturalWidth, h = rotated ? image.naturalWidth : image.naturalHeight;
        const scale = Math.min(width / w, height / h) * state.zoom / 100;
        $("page-frame").style.width = `${w * scale}px`; $("page-frame").style.height = `${h * scale}px`;
        $("document-sheet").style.width = `${image.naturalWidth}px`; $("document-sheet").style.height = `${image.naturalHeight}px`;
        $("document-sheet").style.transform = `translate(-50%, -50%) rotate(${state.rotation}deg) scale(${scale})`;
      }
    } catch (error) { if (error.name !== "RenderingCancelledException") report(error); }
  }
  function setPage(value) {
    const next = Number.parseInt(value, 10);
    if (!Number.isFinite(next) || !state.pages) return;
    state.page = Math.max(1, Math.min(state.pages, next));
    if (state.page >= thumbnailNext) appendThumbnails(Math.max(state.page - 20, thumbnailNext));
    renderPage(); $("document-viewport").scrollTop = 0;
    $("thumbnail-list").querySelector(`[data-page="${state.page}"]`)?.scrollIntoView({ block: "nearest" });
  }
  async function processThumbnails() {
    if (thumbnailBusy) return; thumbnailBusy = true;
    try {
      while (thumbnailQueue.length) {
        const button = thumbnailQueue.shift(), number = Number(button.dataset.page), canvas = button.querySelector("canvas");
        try {
          if (pdf) {
            const page = await pdf.getPage(number), base = page.getViewport({ scale: 1 });
            const view = page.getViewport({ scale: Math.min(82 / base.width, 110 / base.height) });
            canvas.width = Math.ceil(view.width); canvas.height = Math.ceil(view.height);
            await page.render({ canvasContext: canvas.getContext("2d"), viewport: view }).promise;
          } else if (image) {
            const scale = Math.min(82 / image.naturalWidth, 110 / image.naturalHeight);
            canvas.width = Math.ceil(image.naturalWidth * scale); canvas.height = Math.ceil(image.naturalHeight * scale);
            canvas.getContext("2d").drawImage(image, 0, 0, canvas.width, canvas.height);
          }
          button.dataset.rendered = "true";
        } catch (error) { report(error); }
      }
    } finally { thumbnailBusy = false; }
  }
  function appendThumbnails(start = thumbnailNext) {
    // Large PDFs allocate thumbnail canvases only as pages enter the rail.
    const end = Math.min(state.pages, start + 99);
    for (let number = start; number <= end; number++) {
      if ($("thumbnail-list").querySelector(`[data-page="${number}"]`)) continue;
      const button = document.createElement("button"); button.type = "button"; button.className = "thumbnail-button";
      button.dataset.page = number; window.HospitalI18n.bindAttr(button, "aria-label", () => window.HospitalI18n.t("trace.ir_a_la_pagina_value", {value0: number}));
      const canvas = document.createElement("canvas"); canvas.className = "thumbnail-page"; canvas.setAttribute("aria-hidden", "true");
      const label = document.createElement("span"); label.className = "thumbnail-number"; window.HospitalI18n.bindText(label, () => number);
      button.append(canvas, label); button.addEventListener("click", () => setPage(number)); $("thumbnail-list").append(button);
      thumbnailObserver.observe(button);
    }
    thumbnailNext = end + 1; pageState();
  }
  function thumbnails() {
    thumbnailObserver?.disconnect(); $("thumbnail-list").replaceChildren(); thumbnailQueue = []; thumbnailNext = 1;
    thumbnailObserver = new IntersectionObserver(entries => {
      entries.forEach(entry => {
        if (entry.isIntersecting && !entry.target.dataset.queued) {
          entry.target.dataset.queued = "true"; thumbnailQueue.push(entry.target); thumbnailObserver.unobserve(entry.target);
        }
      }); processThumbnails();
    }, { root: $("thumbnail-list"), rootMargin: "180px" });
    appendThumbnails();
  }
  async function openFile() {
    [...tools].forEach(name => { $(name).disabled = true; });
    $("document-canvas").hidden = true; $("document-image").hidden = true; $("unavailable-preview").hidden = true;
    $("thumbnail-list").replaceChildren(); thumbnailObserver?.disconnect(); ++renderRevision;
    if (renderTask) { renderTask.cancel(); try { await renderTask.promise; } catch (_) { /* Switching versions. */ } renderTask = null; }
    pdf = null;
    if (loadingTask) { const previous = loadingTask; loadingTask = null; await previous.destroy(); }
    if (image?.src) URL.revokeObjectURL(image.src); image = null;
    state.page = 1; state.pages = 0; state.zoom = 100; state.rotation = 0; metadata(); pageState();
    if (data.archived_at) { pageState(); return; }
    if (file.extension === "docx") {
      $("unavailable-preview").hidden = false;
      $("document-sheet").style.width = "100%"; $("document-sheet").style.height = "100%";
      $("document-sheet").style.transform = `translate(-50%, -50%)`;
      $("thumbnail-rail").hidden = true; $("viewer-body").classList.add("thumbnails-hidden");
      $("print-button").disabled = true; pageState(); renderPage(); return;
    }
    try {
      const content = await bytes();
      if (file.extension === "pdf") {
        pdfjs ||= await import(window.HospitalApi.page("assets/vendor/pdfjs/pdf.mjs"));
        pdfjs.GlobalWorkerOptions.workerSrc = window.HospitalApi.page("assets/vendor/pdfjs/pdf.worker.mjs");
        loadingTask = pdfjs.getDocument({ data: content, isEvalSupported: false, enableXfa: false,
          cMapUrl: window.HospitalApi.page("assets/vendor/pdfjs/cmaps/"), cMapPacked: true,
          standardFontDataUrl: window.HospitalApi.page("assets/vendor/pdfjs/standard_fonts/"),
          wasmUrl: window.HospitalApi.page("assets/vendor/pdfjs/wasm/") });
        loadingTask.onPassword = (update, reason) => {
          if (reason === pdfjs.PasswordResponses.INCORRECT_PASSWORD) report(new Error(window.HospitalI18n.t("documents_viewer.contrasena_de_pdf_incorrecta")));
          passwordUpdate = update; $("pdf-password").value = ""; if (!$("pdf-password-dialog").open) $("pdf-password-dialog").showModal();
        };
        pdf = await loadingTask.promise; state.pages = pdf.numPages;
      } else {
        image = $("document-image"); image.src = URL.createObjectURL(new Blob([content], { type: file.mime_type }));
        await image.decode(); image.hidden = false; state.pages = 1;
      }
      [...tools].forEach(name => { $(name).disabled = false; });
      $("thumbnail-rail").hidden = !state.thumbnails; $("viewer-body").classList.toggle("thumbnails-hidden", !state.thumbnails);
      $("print-button").disabled = false; thumbnails(); await renderPage();
    } catch (error) { report(error); $("print-button").disabled = true; }
  }
  async function download() {
    $("download-button").disabled = true;
    const selected = file;
    try {
      const content = await bytes(true), url = URL.createObjectURL(new Blob([content], { type: selected.mime_type }));
      const link = document.createElement("a"); link.href = url; link.download = selected.original_name; document.body.append(link); link.click(); link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    } catch (error) { report(error); }
    finally { $("download-button").disabled = false; }
  }
  async function printDocument() {
    $("print-button").disabled = true; $("file-version").disabled = true; let frame;
    try {
      await bytes(); // Recheck current authentication/access before printing loaded pages.
      frame = document.createElement("iframe"); frame.className = "document-print-frame"; window.HospitalI18n.bindAttr(frame, "title", () => window.HospitalI18n.t("documents_viewer.imprimir_documento"));
      document.body.append(frame);
      const doc = frame.contentDocument, style = doc.createElement("style");
      window.HospitalI18n.bindText(style, () => "@page{margin:0}body{margin:0}img{display:block;width:100%;height:auto;break-after:page;page-break-after:always}img:last-child{break-after:auto;page-break-after:auto}");
      doc.head.append(style); doc.title = data.title;
      for (let number = 1; number <= state.pages; number++) {
        const printImage = doc.createElement("img");
        if (pdf) {
          const page = await pdf.getPage(number), base = page.getViewport({ scale: 1 });
          const view = page.getViewport({ scale: Math.min(2, 4096 / Math.max(base.width, base.height)) });
          const canvas = document.createElement("canvas"); canvas.width = Math.ceil(view.width); canvas.height = Math.ceil(view.height);
          await page.render({ canvasContext: canvas.getContext("2d"), viewport: view }).promise;
          printImage.src = canvas.toDataURL("image/png"); canvas.width = 0; canvas.height = 0;
        } else printImage.src = image.src;
        doc.body.append(printImage); await printImage.decode();
      }
      frame.contentWindow.addEventListener("afterprint", () => frame.remove(), { once: true });
      frame.contentWindow.focus(); frame.contentWindow.print();
    } catch (error) { report(error); frame?.remove(); }
    finally { $("print-button").disabled = false; $("file-version").disabled = false; }
  }
  async function copyLink() {
    try { await navigator.clipboard.writeText(shareUrl()); toast(() => window.HospitalI18n.t("documents_viewer.enlace_copiado")); }
    catch (error) { report(error); $("share-url").value = shareUrl(); if (!$("share-dialog").open) $("share-dialog").showModal(); $("share-url").select(); }
  }
  function closeMenu() { $("more-menu").hidden = true; $("more-button").setAttribute("aria-expanded", "false"); }
  $("toggle-thumbnails").addEventListener("click", () => {
    state.thumbnails = !state.thumbnails; $("thumbnail-rail").hidden = !state.thumbnails;
    $("viewer-body").classList.toggle("thumbnails-hidden", !state.thumbnails);
    $("toggle-thumbnails").setAttribute("aria-pressed", String(state.thumbnails)); renderPage();
  });
  $("page-input").addEventListener("change", event => setPage(event.target.value));
  $("page-input").addEventListener("keydown", event => { if (event.key === "Enter") { setPage(event.target.value); event.target.blur(); } });
  $("thumbnail-list").addEventListener("scroll", () => {
    const rail = $("thumbnail-list");
    if (rail.scrollTop + rail.clientHeight >= rail.scrollHeight - 250 && thumbnailNext <= state.pages) appendThumbnails();
  });
  $("zoom-out").addEventListener("click", () => { state.zoom = Math.max(50, state.zoom - 10); renderPage(); });
  $("zoom-in").addEventListener("click", () => { state.zoom = Math.min(200, state.zoom + 10); renderPage(); });
  $("zoom-reset").addEventListener("click", () => { state.zoom = 100; renderPage(); });
  $("rotate-button").addEventListener("click", () => { state.rotation = (state.rotation + 90) % 360; renderPage(); });
  $("fullscreen-button").addEventListener("click", async () => {
    try { if (document.fullscreenElement) await document.exitFullscreen(); else await $("viewer-container").requestFullscreen(); }
    catch (error) { report(error); }
  });
  $("download-button").addEventListener("click", download);
  $("print-button").addEventListener("click", printDocument);
  $("share-button").addEventListener("click", () => { $("share-url").value = shareUrl(); $("share-dialog").showModal(); });
  $("more-button").addEventListener("click", event => {
    event.stopPropagation(); const open = $("more-menu").hidden; $("more-menu").hidden = !open; $("more-button").setAttribute("aria-expanded", String(open));
  });
  $("copy-link-menu").addEventListener("click", () => { closeMenu(); copyLink(); });
  $("edit-document-menu").addEventListener("click", () => { location.assign(`documents-edit.html?id=${encodeURIComponent(id)}`); });
  $("reset-view-menu").addEventListener("click", () => { closeMenu(); state.zoom = 100; state.rotation = 0; setPage(1); });
  $("qr-button").addEventListener("click", () => {
    try {
      const qr = window.qrcode(0, "M"); qr.addData(shareUrl(), "Byte"); qr.make();
      const canvas = $("qr-canvas"), context = canvas.getContext("2d"), count = qr.getModuleCount(), cell = Math.floor(264 / (count + 8));
      canvas.width = canvas.height = (count + 8) * cell;
      context.fillStyle = "#fff"; context.fillRect(0, 0, canvas.width, canvas.height); context.fillStyle = "#111827";
      for (let y = 0; y < count; y++) for (let x = 0; x < count; x++) if (qr.isDark(y, x)) context.fillRect((x + 4) * cell, (y + 4) * cell, cell, cell);
      $("qr-dialog").showModal();
    } catch (error) { report(error); }
  });
  $("delete-button").addEventListener("click", async () => {
    const restore = Boolean(data.archived_at);
    if (!restore && !confirm(window.HospitalI18n.t("documents_viewer.archivar_value_se_conservaran_el_archivo_y_su_historial", {value0: data.title}))) return;
    $("delete-button").disabled = true;
    try { await (restore ? api.restore(id, data.version) : api.archive(id, data.version)); location.assign("documents.html"); }
    catch (error) { report(error); $("delete-button").disabled = false; }
  });
  $("file-version").addEventListener("change", async event => {
    event.target.disabled = true;
    file = data.file_versions.find(item => item.version === Number(event.target.value));
    try { await openFile(); } catch (error) { report(error); } finally { event.target.disabled = false; }
  });
  $("copy-share-link").addEventListener("click", copyLink); $("copy-qr-link").addEventListener("click", copyLink);
  $("pdf-password-form").addEventListener("submit", event => {
    event.preventDefault(); const password = $("pdf-password").value; $("pdf-password").value = ""; $("pdf-password-dialog").close(); passwordUpdate?.(password);
  });
  $("pdf-password-dialog").addEventListener("cancel", () => { loadingTask?.destroy(); });
  $("cancel-pdf-password").addEventListener("click", () => { $("pdf-password-dialog").close(); loadingTask?.destroy(); });
  document.querySelectorAll("[data-close-dialog]").forEach(button => button.addEventListener("click", () => button.closest("dialog").close()));
  document.addEventListener("click", event => { if (!event.target.closest(".more-wrap")) closeMenu(); });
  document.addEventListener("keydown", event => {
    if (event.key === "Escape") closeMenu();
    if (event.target.closest("input,textarea,select,button,dialog") || !state.pages) return;
    if (event.key === "ArrowLeft") { event.preventDefault(); setPage(state.page - 1); }
    if (event.key === "ArrowRight") { event.preventDefault(); setPage(state.page + 1); }
  });
  new ResizeObserver(() => { clearTimeout(resizeTimer); resizeTimer = setTimeout(renderPage, 80); }).observe($("document-viewport"));
  window.addEventListener("pagehide", () => { thumbnailObserver?.disconnect(); if (image?.src) URL.revokeObjectURL(image.src); });
  async function init() {
    try {
      if (!await window.HospitalAuth.ready) return;
      if (!/^[1-9][0-9]*$/.test(id || "")) throw new Error(window.HospitalI18n.t("documents_viewer.selecciona_un_documento_desde_la_lista"));
      data = await api.get(id);
      const requested = params.get("file_version");
      file = requested ? data.file_versions.find(item => String(item.version) === requested) : data.file;
      if (!file) throw new Error(window.HospitalI18n.t("documents_viewer.no_se_encontro_esa_version_del_archivo"));
      $("file-version").replaceChildren(...data.file_versions.map(item => window.HospitalI18n.option(() => window.HospitalI18n.t("documents_viewer.version_value_value", {value0: item.version, value1: api.date(item.created_at)}), item.version)));
      $("file-version").value = file.version; $("file-version").disabled = true;
      actions.forEach(name => { $(name).disabled = false; });
      if (data.archived_at) ["download-button", "print-button"].forEach(name => { $(name).disabled = true; });
      await openFile();
      $("file-version").disabled = Boolean(data.archived_at);
    } catch (error) { report(error); if (!file) window.HospitalI18n.bindText($("document-title"), () => ''); }
  }
  init();
  window.addEventListener('hospital:localechange',()=>{if(data){metadata();pageState();}});

});
