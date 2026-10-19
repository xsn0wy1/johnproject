document.addEventListener("DOMContentLoaded", () => {
  "use strict";
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
  const editing = form.dataset.mode === "update";
  const id = new URLSearchParams(location.search).get("id");
  let current = null, createToken = null, categories = [], patient = null, options = [], busy = true;
  let patientTimer, searchRevision = 0;
  const report = error => window.HospitalApi.report(error, "documents");
  const validation = text => report(new window.HospitalApi.ApiError(text, 422, "VALIDATION_FAILED"));
  const patientLabel = item => `${item.full_name} · ${item.national_id}`;
  const setBusy = value => {
    busy = value;
    form.querySelectorAll('input,select,textarea,button').forEach(control => { control.disabled = value; });
    form.setAttribute("aria-busy", String(value));
  };
  const clearFile = () => { fileInput.value = ""; fileSummary.hidden = true; if (currentFile) currentFile.hidden = !current; };
  function showFile() {
    const file = fileInput.files[0];
    if (!file) { clearFile(); return true; }
    const extension = file.name.split(".").pop().toLowerCase();
    if (!["pdf", "docx", "jpg", "jpeg", "png"].includes(extension) || !file.size || file.size > 10 * 1048576) {
      validation("Usá un archivo PDF, DOCX, JPG o PNG con contenido, de hasta 10 MiB.");
      clearFile(); return false;
    }
    document.getElementById("selectedFileName").textContent = file.name;
    document.getElementById("selectedFileMeta").textContent = `${extension.toUpperCase()} · ${api.size(file.size)}`;
    fileSummary.hidden = false; if (currentFile) currentFile.hidden = true;
    return true;
  }
  function patientRequirement() {
    patientInput.required = Boolean(categories.find(item => item.id === categoryInput.value)?.requires_patient);
  }
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
  categoryInput.addEventListener("change", patientRequirement);
  fileInput.addEventListener("change", showFile);
  document.getElementById("clearFile").addEventListener("click", clearFile);
  ["dragenter", "dragover", "dragleave", "drop"].forEach(name => uploadArea.addEventListener(name, event => {
    event.preventDefault(); uploadArea.classList.toggle("is-dragging", ["dragenter", "dragover"].includes(name));
  }));
  uploadArea.addEventListener("drop", event => {
    const files = event.dataTransfer?.files; if (!files?.length || busy) return;
    if (files.length !== 1) { validation("Seleccioná un solo archivo."); return; }
    const transfer = new DataTransfer(); transfer.items.add(files[0]); fileInput.files = transfer.files; showFile();
  });
  form.addEventListener("submit", async event => {
    event.preventDefault(); if (busy || !form.checkValidity()) return;
    selectPatient();
    if (patientInput.value.trim() && !patient) { validation("Seleccioná un paciente del catálogo, con su nombre y cédula."); return; }
    if (patientInput.required && !patient) { validation("Seleccioná un paciente del hospital."); return; }
    if (!showFile()) return;
    const fields = { title: form.elements.nombre.value, description: form.elements.descripcion.value,
      document_date: form.elements.fecha.value, category_id: categoryInput.value, patient_id: patient?.id ?? null };
    if (editing) Object.assign(fields, { id: current.id, version: current.version });
    else fields.create_token = createToken;
    setBusy(true); message.textContent = "Guardando documento...";
    try {
      const saved = await api.save(fields, fileInput.files[0], !editing);
      message.textContent = editing ? "Cambios guardados correctamente." : "Documento cargado correctamente.";
      location.assign(`documents.html?document_id=${encodeURIComponent(saved.id)}`);
    } catch (error) {
      // Keep both selected bytes and typed fields; a stale revision requires reopening.
      report(error); message.textContent = ""; setBusy(false);
    }
  });
  async function init() {
    setBusy(true);
    try {
      if (!await window.HospitalAuth.ready) return;
      categories = await api.categories();
      categoryInput.replaceChildren(new Option("Seleccioná una categoría", ""), ...categories.map(item => new Option(item.name, item.id)));
      if (editing) {
        if (!/^[1-9][0-9]*$/.test(id || "")) throw new Error("Seleccioná un documento desde la lista.");
        current = await api.get(id);
        if (current.archived_at) throw new Error("Restaurá el documento antes de editarlo.");
        form.elements.nombre.value = current.title;
        form.elements.descripcion.value = current.description;
        form.elements.fecha.value = current.document_date;
        categoryInput.value = current.category.id; patient = current.patient;
        patientInput.value = patient ? patientLabel(patient) : "";
        currentFile.querySelector("strong").textContent = current.file.original_name;
        currentFile.hidden = false;
      } else {
        createToken = (await api.createToken()).create_token;
        form.elements.fecha.value = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Montevideo", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
      }
      patientRequirement(); setBusy(false);
    } catch (error) { report(error); if (currentFile) currentFile.hidden = true; }
  }
  init();
});
