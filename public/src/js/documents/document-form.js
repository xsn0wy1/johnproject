document.addEventListener("DOMContentLoaded", async () => {
    "use strict";
    await window.HospitalI18n.ready;
    await window.HospitalAuth.ready;

  const form = document.getElementById("documentForm");
  if (!form) return;
  const api = window.DocumentApi;
  const fileInput = document.getElementById("archivo");
  const uploadArea = document.getElementById("uploadArea");
  const fileSummary = document.getElementById("fileSummary");
  const currentFile = document.getElementById("currentFile");
  const message = document.getElementById("formMessage");
  const submit = form.querySelector("[type=submit]");
  const patientInput = document.getElementById("paciente");
  const patientOptions = document.getElementById("patient-options");
  const categoryInput = document.getElementById("categoria");
  const categoryButton = document.getElementById("category-button");
  const categoryMenu = document.getElementById("category-menu");
  const categoryRoot = categoryButton.parentElement;
  const panel = document.querySelector(".document-form-panel");
  const editing = form.dataset.mode === "update";
  const id = new URLSearchParams(location.search).get("id");
  let current = null, createToken = null, categories = [], patient = null, options = [], busy = true;
  let patientTimer, searchRevision = 0;
  const report = error => window.HospitalApi.report(error, "documents");
  const validation = text => report(new window.HospitalApi.ApiError(text, 422, "VALIDATION_FAILED"));
  const patientLabel = item => `${item.full_name} · ${item.national_id}`;
  const setBusy = value => {
    busy = value;
    if (value) closeCategory();
    form.querySelectorAll('input,select,textarea,button').forEach(control => { control.disabled = value; });
    form.setAttribute("aria-busy", String(value));
  };
  const clearFile = () => { fileInput.value = ""; fileSummary.hidden = true; if (currentFile) currentFile.hidden = !current; };
  function showFile() {
    const file = fileInput.files[0];
    if (!file) { clearFile(); return true; }
    const extension = file.name.split(".").pop().toLowerCase();
    if (!["pdf", "docx", "jpg", "jpeg", "png"].includes(extension) || !file.size || file.size > 10 * 1048576) {
      validation(window.HospitalI18n.t("document_form.usa_un_archivo_pdf_docx_jpg_o_png_con_contenido_de_hasta_10_mib"));
      clearFile(); return false;
    }
    window.HospitalI18n.bindText(document.getElementById("selectedFileName"), () => file.name);
    window.HospitalI18n.bindText(document.getElementById("selectedFileMeta"), () => `${extension.toUpperCase()} · ${api.size(file.size)}`);
    fileSummary.hidden = false; if (currentFile) currentFile.hidden = true;
    return true;
  }
  function patientRequirement() {
    patientInput.required = Boolean(categories.find(item => item.id === categoryInput.value)?.requires_patient);
  }
  const categoryLabel = value => value ? window.HospitalI18n.category(categories.find(item => item.id === value)) : window.HospitalI18n.t("documents_edit.selecciona_una_categoria");
  function syncCategory() {
    window.HospitalI18n.bindText(document.getElementById("category-label"), () => categoryLabel(categoryInput.value));
    categoryMenu.querySelectorAll("button").forEach(choice => choice.setAttribute("aria-pressed", String(choice.dataset.value === categoryInput.value)));
  }
  function closeCategory() {
    categoryMenu.hidden = true;
    categoryButton.setAttribute("aria-expanded", "false");
  }
  function openCategory() {
    if (busy) return;
    // Respect the existing scroll panel and open upward when it has more room.
    const trigger = categoryButton.getBoundingClientRect(), bounds = panel.getBoundingClientRect();
    const clipped = getComputedStyle(panel).overflowY !== "visible";
    const below = Math.min(innerHeight - 12, clipped ? bounds.bottom - 12 : innerHeight - 12) - trigger.bottom - 7;
    const above = trigger.top - Math.max(12, clipped ? bounds.top + 12 : 12) - 7;
    const upwards = below < 200 && above > below;
    categoryRoot.classList.toggle("opens-up", upwards);
    categoryRoot.style.setProperty("--category-menu-height", `${Math.max(0, upwards ? above : below)}px`);
    categoryMenu.hidden = false;
    categoryButton.setAttribute("aria-expanded", "true");
  }
  categoryButton.addEventListener("click", () => { if (categoryMenu.hidden) openCategory(); else closeCategory(); });
  categoryButton.addEventListener("keydown", event => {
    if (["ArrowDown", "ArrowUp"].includes(event.key)) {
      event.preventDefault(); openCategory();
      (event.key === "ArrowUp" ? categoryMenu.lastElementChild : categoryMenu.querySelector('[aria-pressed="true"]'))?.focus();
    } else if (event.key === "Escape") { event.preventDefault(); closeCategory(); }
  });
  categoryMenu.addEventListener("click", event => {
    const choice = event.target.closest("button"); if (!choice || busy) return;
    const changed = categoryInput.value !== choice.dataset.value;
    categoryInput.value = choice.dataset.value;
    if (changed) categoryInput.dispatchEvent(new Event("change", { bubbles: true }));
    closeCategory(); categoryButton.focus();
  });
  categoryMenu.addEventListener("keydown", event => {
    if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
      event.preventDefault(); const choices = [...categoryMenu.children], index = choices.indexOf(document.activeElement);
      const next = event.key === "Home" ? 0 : event.key === "End" ? choices.length - 1 : (index + (event.key === "ArrowDown" ? 1 : -1) + choices.length) % choices.length;
      choices[next]?.focus();
    } else if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); closeCategory(); categoryButton.focus(); }
  });
  document.addEventListener("click", event => { if (!categoryRoot.contains(event.target)) closeCategory(); });
  document.addEventListener("focusin", event => { if (!categoryRoot.contains(event.target)) closeCategory(); });
  window.addEventListener("resize", closeCategory);
  function selectPatient() {
    patient = options.find(item => patientLabel(item) === patientInput.value) ||
      (current?.patient && patientLabel(current.patient) === patientInput.value ? current.patient : null);
  }
  patientInput.addEventListener("input", () => {
    selectPatient(); clearTimeout(patientTimer); const revision = ++searchRevision;
    if (patient || patientInput.value.trim().length < 2) { patientOptions.replaceChildren(); return; }
    patientTimer = setTimeout(async () => {
      try {
        const found = await api.patients(patientInput.value.trim());
        if (revision !== searchRevision) return;
        options = found;
        patientOptions.replaceChildren(...found.map(item => {
          const option = document.createElement("option"); option.value = patientLabel(item); return option;
        }));
        selectPatient();
      } catch (error) { report(error); }
    }, 220);
  });
  patientInput.addEventListener("change", selectPatient);
  categoryInput.addEventListener("change", () => { patientRequirement(); syncCategory(); });
  fileInput.addEventListener("change", showFile);
  document.getElementById("clearFile").addEventListener("click", clearFile);
  ["dragenter", "dragover", "dragleave", "drop"].forEach(name => uploadArea.addEventListener(name, event => {
    event.preventDefault(); uploadArea.classList.toggle("is-dragging", ["dragenter", "dragover"].includes(name));
  }));
  uploadArea.addEventListener("drop", event => {
    const files = event.dataTransfer?.files; if (!files?.length || busy) return;
    if (files.length !== 1) { validation(window.HospitalI18n.t("document_form.selecciona_un_solo_archivo")); return; }
    const transfer = new DataTransfer(); transfer.items.add(files[0]); fileInput.files = transfer.files; showFile();
  });
  form.addEventListener("submit", async event => {
    event.preventDefault(); if (busy || !form.checkValidity()) return;
    selectPatient();
    if (patientInput.value.trim() && !patient) { validation(window.HospitalI18n.t("document_form.selecciona_un_paciente_del_catalogo_con_su_nombre_y_cedula")); return; }
    if (patientInput.required && !patient) { validation(window.HospitalI18n.t("document_form.selecciona_un_paciente_del_hospital")); return; }
    if (!showFile()) return;
    const fields = { title: form.elements.nombre.value, description: form.elements.descripcion.value,
      document_date: form.elements.fecha.value, category_id: categoryInput.value, patient_id: patient?.id ?? null };
    if (editing) Object.assign(fields, { id: current.id, version: current.version });
    else fields.create_token = createToken;
    setBusy(true); window.HospitalI18n.bindText(message, () => window.HospitalI18n.t("document_form.guardando_documento"));
    try {
      const saved = await api.save(fields, fileInput.files[0], !editing);
      window.HospitalI18n.bindText(message, () => editing ? window.HospitalI18n.t("document_form.cambios_guardados_correctamente") : window.HospitalI18n.t("document_form.documento_cargado_correctamente"));
      location.assign(`documents.html?document_id=${encodeURIComponent(saved.id)}`);
    } catch (error) {
      // Keep both selected bytes and typed fields; a stale revision requires reopening.
      report(error); window.HospitalI18n.bindText(message, () => ""); setBusy(false);
    }
  });
  async function init() {
    setBusy(true);
    try {
      if (!await window.HospitalAuth.ready) return;
      categories = await api.categories();
      categoryInput.replaceChildren(window.HospitalI18n.option(() => window.HospitalI18n.t("documents_edit.selecciona_una_categoria"), ""), ...categories.map(item => window.HospitalI18n.option(() => window.HospitalI18n.category(item), item.id)));
      categoryMenu.replaceChildren(...[...categoryInput.options].map(option => {
        const choice = document.createElement("button"); choice.type = "button"; choice.dataset.value = option.value;
        window.HospitalI18n.bindText(choice, () => categoryLabel(option.value)); return choice;
      }));
      if (editing) {
        if (!/^[1-9][0-9]*$/.test(id || "")) throw new Error(window.HospitalI18n.t("documents_viewer.selecciona_un_documento_desde_la_lista"));
        current = await api.get(id);
        if (current.archived_at) throw new Error(window.HospitalI18n.t("document_form.restaura_el_documento_antes_de_editarlo"));
        form.elements.nombre.value = current.title;
        form.elements.descripcion.value = current.description;
        form.elements.fecha.value = current.document_date;
        categoryInput.value = current.category.id; patient = current.patient;
        patientInput.value = patient ? patientLabel(patient) : "";
        window.HospitalI18n.bindText(currentFile.querySelector("strong"), () => current.file.original_name);
        currentFile.hidden = false;
      } else {
        createToken = (await api.createToken()).create_token;
        form.elements.fecha.value = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Montevideo", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
      }
      patientRequirement(); syncCategory(); setBusy(false);
    } catch (error) { report(error); if (currentFile) currentFile.hidden = true; }
  }
  init();
});
