# Frontend analysis for the unified hospital backend

Reviewed: 12 October 2026. This is a requirements and integration analysis of the existing frontend, not an audit of an existing database implementation.

## Confirmed scope

- Accounts are for hospital staff only. Patients are managed records, not login accounts.
- The application will run with PHP and MySQL through XAMPP.
- Ambulance movement must use test data only. The deliverable is a shared, simulated tracking system; real GPS collection and fleet integrations are outside this scope.
- Required workflows: staff registration/login, server document uploads and retrieval, ambulance transfers and map tracking, persistent user settings, and in-app management of hospital data.
- Existing HTML/CSS and usable interaction code should be retained while their data sources are replaced systematically.

The frontend is detailed enough to derive most of the backend requirements. The central engineering challenge is making every screen use the same identities, records, permissions, and state transitions.

## Review coverage and verification

The workspace contains 23 HTML, 23 JavaScript, and 23 CSS files. The analysis covered the active forms, JavaScript data structures, browser persistence, network references, navigation, map integration, and empty feature placeholders. The prepared `backend/`, `db/`, `storage/`, and `logs/` directories establish useful boundaries for the implementation.

Verification included a static check of local HTML links/scripts/form actions, resolving JavaScript API URLs against their page or script locations, read-only HTTP requests to a temporary PHP server with `public/` as its document root, and browser inspection of the upload and document list pages. No application records were created, deleted, or uploaded during this analysis.

The local command-line PHP is Homebrew PHP 8.5.8 with `pdo_mysql` available. This does **not** establish the PHP or database version bundled with the user's XAMPP installation. Database queries, XAMPP Apache behavior, actual persistence, and concurrent writes remain untested until implementation.

## What each frontend area requires

| Frontend area | What exists now | Backend responsibilities derived from the screen |
| --- | --- | --- |
| Login | Username/password form, AJAX submission, success redirect | Verify staff account and password, reject pending/disabled accounts, establish session, rate limit attempts, return current user and permissions |
| Registration | Username, password, email, CI fields | Validate and normalize identity fields, enforce uniqueness, hash password, create pending staff application, require administrator approval before hospital access |
| Password recovery | Email form that redirects to login | Real reset request, controlled email delivery for development, expiring single-use token, password reset and session revocation |
| Home/navigation | Welcome text, profile menu, links, quick navigation search | Shared current-user endpoint, role-aware navigation, real session logout, optional authorized summary counts |
| Settings | Profile, avatar, center, language, privacy/security toggles, specialties, theme controls | Persistent settings per account, validated partial updates, private avatar storage, catalog-backed specialties/center, enforce security policy independently of optional preferences |
| Document list | Demo cards, view modes, local filters, edit and bulk delete controls | Authorized searchable/paginated list, canonical document IDs, metadata, delete/archive policy, per-item bulk results |
| Document upload/edit | Metadata form, patient text, date, category, file selection | Resolve patient relationship, validate multipart upload, private file storage, document metadata/version transaction, permission checks and audit records |
| Document viewer | Metadata, PDF/image embedding hooks, mock pages/download/QR, share controls | Authorized binary preview/download, authoritative metadata, actual file versions, restricted internal sharing, real QR encoding if retained |
| Patients | Directory, detail panel, emergency contact, admission fields, edit/delete dialogs | Patient identity records, contacts, current encounter/admission, doctor/department relationships, validated CRUD and conflict handling |
| Doctors | Directory, specialties, service/office, license, availability, shifts | Staff identity plus doctor profile, specialty catalog relationships, active status and display schedule, validated CRUD |
| Personnel | Driver/copilot directory, license, status, edit/delete | Crew-capable staff records, personnel roles, license fields, active/inactive state and transfer assignment checks |
| Ambulances | Plate/model/capacity/operational status, CRUD dialogs | Shared vehicle catalog, unique normalized plate, operational eligibility, active assignment checks, archival policy |
| Destinations | Name/address/locality/type/phone/notes/status | Facility/destination catalog, coordinates for map use, active state, references from routes and transfers |
| Routes | Origin/destination, ordered stops, type, direction, distance/duration | Reusable route templates with stable IDs, ordered stops, geometry, estimated distance/duration, active state |
| Transfer list | HTML cards, local search/filter/sort | Authorized transfer queries, pagination, canonical lifecycle values, links carrying the actual transfer ID |
| New transfer | Vehicle selector, crew, schedule, patient, endpoints, cargo type, priority, flags | Transactional transfer creation, shared catalog lookups, patient conditionality, scheduling/assignment validation, server-generated ID |
| Transfer detail | Editable fields, timeline, state changes, cancellation, map preview | Fetch by ID, authorized updates, lifecycle validation, event history, shared map geometry and latest simulated position |
| Fleet map | Leaflet, basemap selection, demo routes and local motion, update hook | Shared tracking snapshot, simulated position history, freshness timestamps, lifecycle updates, filterable authorized fleet data |
| Management hub | Links to six management areas | Permission-aware entry points; a data management UI built on domain APIs |
| Reports/calendar/surveys | Empty HTML/JS files | Separate future product requirements; they have no backend specification sufficient for implementation yet |

## Existing data islands and their replacement

| Current source | Location/evidence | Required replacement |
| --- | --- | --- |
| Patient browser records | `public/src/js/management/patients.js:18`, load/save at lines 68–90 | Patient/encounter API; browser storage must stop being the record of authority |
| Doctor browser records | `public/src/js/management/doctors.js:19`, load/save at lines 56–80 | Staff/doctor API backed by the same staff identities used elsewhere |
| Personnel browser records | `public/src/js/management/personnel.js:2`, load/save at lines 34–58 | Crew staff API |
| Destination browser records | `public/src/js/management/destinations.js:3`, load/save at lines 42–68 | Facility API |
| Route browser records | `public/src/js/management/routes.js:4`, persistence at lines 56–74 | Route template/stop API |
| Ambulance in-memory array | `public/src/js/management/ambulances.js:4` | Vehicle API; mutations currently disappear on reload |
| Transfer form draft | `public/src/js/traces/trace.js:284`, save at line 323 | Prefer an authenticated server draft if this feature is retained; clear obsolete browser drafts during migration |
| Transfer detail for a single sample | `public/src/js/traces/trace-view.js:11`, persistence at line 67 | Transfer API keyed by the selected transfer's ID |
| Map's independent demonstration fleet | `public/src/js/traces/trace-map-shared.js:7` | One seeded fleet/route/transfer dataset served by the backend |
| Local theme preference | `public/src/js/main-menu.js:5` | Server setting with an optional harmless local cache to prevent a theme flash |
| HTML document examples and viewer defaults | `documents.js:37`; `documents-viewer.js:7` | Explicit demonstration fixtures, or empty/loading/error states in the connected application |

These browser keys are not scoped to an authenticated account. After login is added, leaving them as operational storage would make records dependent on the computer/browser and potentially visible to the next staff member using it. Importing test fixtures should be an explicit seed operation, not an automatic import of arbitrary localStorage content.

## Concrete integration findings

### 1. API addresses need one source of truth

These are provisional frontend contracts, not implementation constraints to preserve:

| Caller | Current request and effective path under `public/` | Action |
| --- | --- | --- |
| Login | `public/index.html:16` → `/api/users/login.php` | Replace through shared API client |
| Registration | `register.html:18` → `/api/users/register.php` | Same authentication contract family |
| Settings page | `settings.js:36` → `/api/settings_get.php` and other settings scripts | Consolidate in versioned settings module |
| Shared profile header | `main-menu.js:24` → `/src/api/settings_get.php` | Resolve from a shared client/base URL; current address differs from settings page |
| Document create | `documents-upload.html:108` → `/api/documents/create.php` | Use canonical document module |
| Document list/read/delete/update | `documents.js:471`, `document-form.js:38`, `documents-edit.html:108` → `/src/api-connection/documents/...` | Remove alternate API namespace |

The HTTP check confirmed `/src/api/settings_get.php` and `/src/api-connection/documents/list.php` return 404. The temporary PHP built-in server returned HTTP 200 **HTML** for some missing `/api/...` URLs because it fell back to the ancestor `index.html`. An HTTP 200 alone is therefore insufficient verification: APIs must also return the expected JSON content type and schema. XAMPP's Apache configuration must be checked separately.

### 2. Upload page references the wrong helper script

`public/src/views/documents/documents-upload.html:18` loads `../../js/api/document-api.js`; the actual helper is `public/src/js/documents/document-api.js`. The former returned 404 and the latter returned 200 in the local check. `document-form.js:173` relies on `window.DocumentApi.submit`, so the create workflow needs this integration fixed when connecting its API.

### 3. Relationships are currently display strings

The new transfer form accepts a typed driver, patient name/CI, origin, and destination. Its ambulance values (`A-12`, `B-27`, `C-08`) differ from the ambulance management catalog's `SAB001`-style plates. The map has another fleet (`A-12`, `B-07`, `C-03`, etc.). Routes embed independent names/addresses instead of referring to the destinations catalog. Patient records store doctor names and specialty strings.

The backend needs stable foreign keys; forms need catalog selectors that show names but submit IDs. Keep an address/name snapshot for historical transfers so later catalog edits do not rewrite past journeys. A label such as `A-12` should be a vehicle's display code, separate from its primary key and registration plate.

### 4. Transfer creation reports success without persistence

`public/src/js/traces/trace.js:387–404` validates, clears the draft, resets the form, and displays “Traslado creado correctamente.” It does not send a request or add a record to a shared store. The connected form must retain input until a successful API response, then redirect to the returned transfer ID.

### 5. List, detail, and map do not refer to one transfer model

Transfer cards link to `trace-view.html` without an ID (`public/src/views/traces/trace.html:200`, and subsequent cards). Detail edits always use `hospitalTransfer1View` (`trace-view.js:12`). The map accepts a `transfer` query parameter, but reads its own seeded array. Every view must resolve a canonical ID through the same transfer API.

Current status vocabularies also disagree:

| View | Current values | Canonical treatment |
| --- | --- | --- |
| List | `active`, `completed` | Derived filters over lifecycle states |
| Detail | `in-progress`, `arrived`, `completed`, `cancelled` | Canonical lifecycle values with Spanish display labels |
| Map | `EN CURSO`, `PROGRAMADO`, `DEMORADO` | Lifecycle plus an independent delay indicator |

“Delayed” is a condition of an active transfer, not a replacement for its lifecycle. Priority, cargo type, operational vehicle state, and staff availability also need separate fields.

### 6. Map movement is useful demo code, but its clock is local

`trace-map.js:359–387` interpolates movement every 2.5 seconds and pauses in background tabs. Each viewer therefore has a different simulation. `TraceMap.updateTransfer` at line 610 is a useful rendering integration point, but only updates an existing demo transfer and supports three map statuses. It needs a snapshot loading path, create/remove support, and canonical status mapping.

For the confirmed test-only scope, no phone location permission or real GPS ingestion endpoint is needed. A PHP simulation worker should persist synthetic positions and expose one shared timeline to all clients.

### 7. Documents need a complete file lifecycle

- The upload form accepts PDF/DOCX/JPG/JPEG/PNG up to 10 MiB (`document-form.js:16–17`). The viewer/list also advertises PPTX. Pick one supported list; the recommended first version follows the upload allowlist and removes unsupported PPTX examples.
- Patient lookup is free text. Edit hydration restores title/date/category/description but does not populate the required patient field (`document-form.js:42–53`). The API and form need an explicit patient ID and label.
- The viewer's API callback updates some metadata but never assigns an authorized file source (`documents-viewer.js:340–351`). It does not become a real viewer merely by adding `get.php`.
- Without a source, download creates a demo file (`documents-viewer.js:202–248`). Viewer deletion only navigates away (`line 324`). The QR drawing is decorative pseudorandom output (`line 251`), not a QR encoder.
- `safeSource` permits arbitrary HTTP/HTTPS/file URLs from query parameters (`line 25`). Replace this with an authenticated same-origin content endpoint resolved from a document ID.
- Sharing copies the full current URL (`line 172`), which may contain user-supplied patient/title/source parameters. Use ID-only internal links, with authentication and authorization on every read.
- The document list keeps demo cards when loading fails and logs the error only (`documents.js:484`). Connected screens need visible error states and must not present fixtures as successful database results.
- Bulk deletion currently sends one request per item. Preserve explicit per-item results or define an atomic batch contract; never show full success after partial failure.

Binary content and metadata must be handled separately: SQL owns metadata, relationships, versions, and permissions; private disk storage owns the bytes. Downloads must pass through authorization. These choices align with [OWASP file upload guidance](https://cheatsheetseries.owasp.org/cheatsheets/File_Upload_Cheat_Sheet.html).

### 8. Account and settings screens need server-enforced behavior

The registration password field has a 16-character maximum (`register.html:33`); remove that small upper bound when defining the server password policy. Staff registration must not grant a role merely because someone supplies a CI or hospital email.

Password recovery redirects without issuing a reset (`restore-password.html:19`). Logout redirects without destroying a session (`main-menu.html:142`). The welcome loader silently keeps placeholders on failure (`main-menu.js:29–49`). Define one authentication bootstrap, explicit 401 handling, and real logout.

Settings currently autosave complete profile objects when individual fields change (`settings.js:195–235`). Once backed by SQL, overlapping requests can overwrite newer values. Use partial field updates and a record version. Specialty labels, default center, and privacy controls must not grant roles, qualifications, or broader data access. Theme buttons have markup but `settings.js:490–498` explicitly leaves their behavior unimplemented.

### 9. Data management needs domain rules beyond CRUD

The six management pages already provide a useful UI, so they should become the database management system. Do not expose arbitrary SQL execution in the browser. Add server validation, searchable/paginated lists, permissions, referential checks, archival/restoration where appropriate, and audit history.

Specific modeling requirements:

- **Patients:** age changes over time; prefer date of birth, or explicitly retain an estimated age plus its observation date when exact birthdate is unknown. Admission date/room/department/attending doctor belong to an encounter rather than the patient's permanent identity. Do not expand this project into a full electronic health record.
- **Doctors/personnel/users:** one staff identity can have a login, a doctor profile, and/or crew responsibilities. These should not become unrelated people tables with independent names and identity numbers. Job roles and application permissions are different concepts.
- **Personnel:** the page currently supports only drivers/copilots, despite the management hub's broader description. Implement those supported roles first; avoid promising an entire HR system.
- **Routes/destinations:** an ordered route references destination records and includes map geometry; names/addresses alone cannot place points on a map. Existing distance/duration are estimates, not traffic-based ETA calculations.
- **Vehicles/crew:** two dispatchers can assign the same resource at once unless the server serializes the conflicting writes. A client-side availability check cannot enforce this.
- **Deletion:** deleting a patient, vehicle, staff member, or route must not destroy referenced transfers/documents or their historical meaning. Define archive/restrict rules before connecting delete buttons.
- **Settings:** automatically logging out a user is server session policy. A preference must not disable the minimum timeout policy.

## Priority assessment

| Priority | Work | Why it precedes later features |
| --- | --- | --- |
| Foundation | Freeze IDs, naming, SQL dialect/runtime, API base and common response contract | Prevents each module from inventing incompatible conventions |
| Foundation | Staff authentication, approval, roles, record-level access, sessions and CSRF | Every hospital data workflow depends on a trusted actor |
| Foundation | Staff/patient/facility/vehicle relationships and shared catalogs | Documents and transfers depend on these records |
| Core | Persistent settings and private avatar handling | First small authenticated read/write workflow |
| Core | Server document upload, list, metadata, content and archive | Completes the document workflow end to end |
| Core | Transactional transfers, assignments and lifecycle events | Establishes the data that list/detail/map must share |
| Core | Shared simulated tracking, freshness and reconnection | Completes the requested map behavior using test data |
| Completion | Concurrency, cross-role tests, restore checks, error states and XAMPP setup guide | Makes the modules work together reliably |
| Later | Reports, calendar, surveys, real GPS, external fleet APIs | Requires separate scope; unnecessary for the confirmed deliverable |

## Boundaries of this analysis

Security items above are implementation requirements for staff and hospital records, not claims of exploitable backend flaws in code that has not been written. No real patient data or real location collection is required for this project. Production deployment and jurisdiction-specific medical-data compliance need a separate deployment review if the project later moves beyond test data.

The implementation architecture, proposed tables/contracts, phased work, and acceptance criteria are in [backend-roadmap.md](backend-roadmap.md).

## Implementation follow-up: identity slice

This document preserves the original frontend audit as a baseline. Registration, login, approval, server-guarded private pages, SQL-backed sessions, real logout and read-only account/settings hydration have since been implemented. Their current behavior, remaining work and verification are in [user-system.md](user-system.md). The user's required PHP source location is `backend/php/`; `/api/v1/` is the HTTP route exposed by Apache Alias, rather than a directory of PHP files under `public/`.

## Survey follow-up (15 October 2026)

The later survey frontend and the user’s explicit scope now supply the previously missing product requirements. Survey authoring/publication, unnamed shared/single-use access, isolated patient submission and protected results use the existing PHP/session/PDO architecture with migration 011. Staff manage their own surveys, administrators manage all; patient records are not linked. Current contracts and decisions are in api-contracts.md and AGENTS.md; the original empty-survey observations above remain historical.
