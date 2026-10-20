(() => {
  "use strict";
  const api = window.HospitalApi;
  const path = name => `documents/${name}.php`;
  const idQuery = id => new URLSearchParams({ id });
  const size = bytes => bytes < 1024 ? window.HospitalI18n.t("document_api.value_b", {value0: bytes}) : bytes < 1048576 ? window.HospitalI18n.t("document_api.value_kb", {value0: (bytes / 1024).toFixed(1)}) : window.HospitalI18n.t("document_api.value_mb", {value0: (bytes / 1048576).toFixed(1)});
  const date = value => value ? new Intl.DateTimeFormat(window.HospitalI18n.locale, { timeZone: "America/Montevideo", dateStyle: "short" }).format(new Date(value.includes("T") ? value : value + "T12:00:00Z")) : "";
  const time = value => new Intl.DateTimeFormat(window.HospitalI18n.locale, { timeZone: "America/Montevideo", hour: "2-digit", minute: "2-digit" }).format(new Date(value));
  async function save(fields, file, create = false) {
    if (!file) return api.post(path("update"), fields);
    const body = new FormData();
    Object.entries(fields).forEach(([key, value]) => body.append(key, value ?? ""));
    body.append("file", file);
    return api.request(path(create ? "create" : "replace-file"), { method: "POST", body });
  }
  window.DocumentApi = Object.freeze({
    size, date, time, save,
    get: id => api.get(`${path("get")}?${idQuery(id)}`),
    list: query => api.getPage(`${path("list")}?${new URLSearchParams(query)}`),
    createToken: () => api.get(path("create-token")),
    categories: () => api.get("catalogs/document-categories.php"),
    patients: q => api.post('catalogs/patients.php', { q }),
    archive: (id, version) => api.post(path("archive"), { id, version }),
    restore: (id, version) => api.post(path("restore"), { id, version }),
    bulkArchive: documents => api.post(path("bulk-archive"), { documents }),
    patientLink: (id, version, file_version) => api.post(path("patient-link"), { id, version, file_version, action: "create" }),
    revokePatientLink: (id, version, file_version, token) => api.post(path("patient-link"), { id, version, file_version, action: "revoke", token }),
    patientFile: token => api.page(`api/v1/${path("public-file")}?${new URLSearchParams({ token })}`),
    content: (id, version, download = false) => api.page(`api/v1/${path("content")}?${new URLSearchParams({ id, version, download: download ? "1" : "0" })}`)
  });
})();
