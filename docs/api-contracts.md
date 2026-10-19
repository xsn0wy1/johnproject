# Current API contracts: hospital backend

Base URL: `/api/v1/` (prepend a configured app mount if used). All PHP source is in `backend/php/`; Apache Alias or the development router exposes this URL. Requests are same-origin, cookie-authenticated, with no browser storage token. IDs are decimal **strings**, times are UTC ISO 8601 strings ending in `Z`, booleans are JSON booleans, UI messages default to Spanish, with English available through the explicit `X-Hospital-Locale: en` header.

## Common request and response

POST accepts a JSON object with `Content-Type: application/json`; form bodies are also supported for the declared scalar fields. Staff writes require `X-CSRF-Token`, obtained using `GET auth/csrf.php` with the same cookies. The read-only public survey POST obtains its own anonymous form token; its submission POST requires that token, as described below. Unexpected fields, including registration roles/status, are rejected. Maximum identity request body size is 16 KiB. GET endpoints never mutate account state.

```json
{"success":true,"data":{"user_id":"42","status":"pending"},"meta":{"request_id":"example"}}
```

```json
{"success":false,"error":{"code":"VALIDATION_FAILED","message":"Revisá los campos indicados.","fields":{"email":"Ingresá un email válido."}},"meta":{"request_id":"example"}}
```

Errors use 400 malformed JSON, 401 unauthenticated/invalid credentials/expired session, 403 invalid CSRF/pending/disabled/forbidden, 404 missing resource, 405 wrong method, 409 conflicting state/unique data, 413 oversized body, 415 unsupported content type, 422 field validation, 429 rate limit (with `Retry-After`), or 503 unavailable service. Credential/hash/session payload data is never returned. JSON responses and authenticated HTML are private/no-store. Generic errors/logs omit submitted credentials and identity data.

The frontend's `HospitalApi` validates JSON rather than treating any HTTP 200 as success, supplies cookies and CSRF, refreshes a stale CSRF token once, and dispatches unauthorized events. It also sends `X-Hospital-Locale` (`es-UY` or `en`); the isolated public survey client sends the same header. Missing/unsupported values use Spanish. JSON responses include `Content-Language`; error messages, validation-field messages and registration confirmation are localized without changing statuses, codes, field names or record contents. Browser and PHP helpers share `public/assets/i18n/es.json` and `en.json`, with Spanish fallback. `HospitalAuth` hydrates the current user and handles logout/expiry. Extend these helpers for later modules.

Quick-search suggestions use the current session's explicit roles: patient/doctor management requires `records_manager`; ambulance/personnel/destination/route management and transfer creation require `dispatcher`; account management requires `admin`. The management-hub suggestion requires at least one of those management roles. Document, survey, settings and scoped transfer-list shortcuts remain available to approved staff. Open suggestions refresh with session updates, and activation rechecks the role. The shared PHP page guard also checks `dispatcher` before serving `traces/trace-new.html`; denied signed-in visitors receive a 303 to their scoped transfer list. Admin alone does not imply dispatch permission. API authorization remains independent of the shortcuts.

## Endpoints that exist

| Method and endpoint | Access | Input | Success data/status |
| --- | --- | --- | --- |
| `GET auth/csrf.php` | Public | None | `{csrf_token}`; 200, anonymous CSRF session created when needed |
| `POST auth/register.php` | Anonymous | `username`, `email`, `password`, `national_id` | `{user_id,status:"pending",message}`; 201 |
| `POST auth/login.php` | Public + CSRF | `username`, `password` | Current-user payload below; 200, cookie/token rotated |
| `POST auth/reset-request.php` | Public + CSRF | `email` | `{requested:true,message}`; uniform 202 for eligible, unknown and disabled addresses |
| `POST auth/reset-password.php` | Public + CSRF | `token`, `new_password` | `{changed:true,sign_in_required:true}`; 200; no automatic login |
| `GET auth/me.php` | Active staff | None | Current-user payload; 200; does not extend idle expiry |
| `POST auth/heartbeat.php` | Active staff + CSRF | Empty object | Current-user payload; 200, records activity |
| `POST auth/logout.php` | Cookie + CSRF | Empty object | `{logged_out:true}`; 200, revokes session/expires cookie |
| `GET auth/sessions.php` | Active staff | None | Own live sessions array; 200; no idle extension |
| `POST auth/revoke-session.php` | Active staff + CSRF | `session_id` | `{revoked:true,current_session_revoked:boolean}`; 200; only own session |
| `GET settings/get.php` | Active staff | None | Current-user payload; 200; read-only, no idle extension |
| `GET admin/users/list.php` | Administrator | None | Up to 100 pending applications, ordered by ID; 200 |
| `POST admin/users/approve.php` | Administrator + CSRF | `user_id`, optional `role` (defaults `staff`) | `{user_id,status:"active"}`; 200 |
| `POST admin/users/disable.php` | Administrator + CSRF | `user_id` | `{user_id,status:"disabled"}`; 200, all target sessions revoked |

Admin list objects contain `id`, `username`, `email`, `national_id`, `status`, `created_at`. Role values are `admin`, `records_manager`, `dispatcher`, `staff`. Registration never accepts a role; approval grants the explicit administrator-selected role. Disabling the last active admin returns `409 LAST_ADMIN`. Administrative identity writes recheck the actor inside the serialized transaction.

`GET auth/page.php?view=main-menu.html` is the server HTML guard used internally by Apache/the router, not a JSON data API. It permits safe existing paths under `public/src/views`, requires an active staff session, and returns HTML. Anonymous requests redirect with 303 to the configured login URL. No arbitrary file path is accepted. Login/register/recovery HTML are public shells; private views are guarded.

## Current-user payload

Example with fictional values (the CSRF value is illustrative):

```json
{
  "user": {
    "id": "42",
    "staff_id": "12",
    "username": "test_staff",
    "email": "staff@hospital.example",
    "full_name": "test_staff",
    "national_id": "99900001",
    "status": "active",
    "roles": ["staff"],
    "version": 2,
    "created_at": "2026-10-12T12:00:00Z",
    "last_login_at": "2026-10-12T13:00:00Z"
  },
  "settings": {
    "locale": "es-UY",
    "theme": "dark",
    "photo_visible_to_staff": false,
    "optional_diagnostics": false,
    "security_notifications": true,
    "automatic_logout": true,
    "avatar_url": null,
    "default_facility_id": null,
    "specialties": [],
    "version": 1
  },
  "csrf_token": "illustrative-token",
  "session": {
    "idle_expires_at": "2026-10-12T13:30:00Z",
    "absolute_expires_at": "2026-10-12T21:00:00Z"
  }
}
```

Avatar/facility/specialty fields reflect the saved private profile; new accounts start with empty name/center/specialties/photo. Profile and preference writes are implemented below. No email delivery is implied; optional diagnostics record only the declared timing metric when enabled. The mandatory session timeout is enforced regardless of stored preference flags.

Session list objects contain `id`, `is_current`, `user_agent`, `created_at`, `last_seen_at`, `expires_at`. `last_seen_at` is the last server observation, which may be a passive poll; `expires_at` reflects actual activity/absolute limits. Revoked/expired sessions are omitted. Neither cookie IDs, their hashes nor CSRF tokens appear in these lists. A missing or another user's session ID returns 404.

Registration conflicts use `409 ACCOUNT_CONFLICT` without identifying which field matched. Wrong login credentials use `401 INVALID_CREDENTIALS`; valid credentials for a pending or disabled account use `403 ACCOUNT_PENDING` / `ACCOUNT_DISABLED`. Login throttles by IP (60/15 minutes) and normalized username (10/15 minutes); registration throttles by IP (10/hour). Counters currently include successful attempts, a conservative local policy that can be refined later.

## Extension rules

Use the same bootstrap, request/response helpers, actor/session checks, CSRF and database factory for later APIs. Mutable settings use partial fields plus an opaque record version. Staff identity data belongs to `staff`; account credentials/admission belong to `users`. Do not create another profile JSON database or reintroduce old `/api/users`, `/api/settings_get.php` or `/src/api-connection` paths into new code.

The modules below, including surveys and email password recovery, are implemented. Calendar/appointment management and reports remain deferred. Unavailable Reports/Calendar navigation entries are omitted. The patient appointment count reads existing scheduled rows only; there is no workflow to create, edit or cancel appointments. Recovery uses Brevo; this checkout requires private sender configuration before real delivery.

## Account administration and passwords

All administrator endpoints require the explicit admin role. POST requires CSRF and takes actor identity from the session. The original pending list/approve/disable endpoints remain compatible; use the directory/manage operations for the complete versioned workflow.

| Endpoint | Request | Result |
| --- | --- | --- |
| GET admin/users/directory.php | No filters | All accounts: id, username, email, status, roles, version, created_at; no hashes or credentials |
| POST admin/users/manage.php | user_id, version, action, roles array | action approve/roles/disable/reactivate/revoke_sessions; saved:true |
| POST admin/users/reset-password.php | user_id, version, new_password | changed:true; target sessions revoked; self-reset uses own settings instead |
| POST auth/change-password.php | current_password, new_password | changed:true, sign_in_required:true; every old session revoked |

Approval can grant several of admin/staff/records_manager/dispatcher. Existing active accounts can change roles; disabled accounts can reactivate with their preserved roles and active staff identity. Pending/disabled accounts cannot use the role-edit action. All management writes recheck actor/session and target revision in a transaction. Disabling/removing admin from the last active administrator returns LAST_ADMIN. Role changes/disable/reset/session-revoke advance auth_version and invalidate existing sessions. Passwords require 12 characters through 72 UTF-8 bytes; invalid current passwords return 422 so the settings page retains input.

### Email password recovery (schema 012)

Request trims/lowercases email and matches `users.email`. Pending applications and active accounts with active linked staff are eligible; disabled accounts and inactive staff receive no mail. Recovery never changes approval, roles, staff links or `email_verified_at`. Separate registration/email-change verification remains deferred; recovery proves possession of the currently saved mailbox through a single-use credential.

`password_reset_tokens` holds one SHA-256 token hash per user, issuing `auth_version`, creation time and 30-minute expiry. Links use 32 random bytes encoded as lowercase hex, in `#token=...`, with optional `?lang=en`. Only POST carries the raw token to the API; it is never returned by the request endpoint or stored in browser persistence/logs. New requests replace previous tokens. Changing email removes outstanding tokens; all password-change paths remove them. Redemption locks the account then token, rechecks current eligibility/revision/expiry, and atomically updates the password, increments user/auth revisions, consumes the token, revokes all target sessions and writes an ID-only audit. The current browser session is cleared after success. Invalid, expired, replaced or consumed credentials return `422 RESET_TOKEN_INVALID`; invalid passwords preserve the token.

The shared SQL limiter applies 3 requests/email/15 minutes, 20 requests/IP/hour, and 20 redemption attempts/IP/15 minutes; exceeded limits return 429. Missing/invalid sender or application-URL configuration returns `503 RECOVERY_UNAVAILABLE` before email lookup. Brevo delivery runs outside transactions, using one PHP/cURL request with bounded timeouts and normal TLS verification. Provider rejection/timeout removes only that attempted token and logs a sanitized server diagnostic; the HTTP request still returns the same generic 202, meaning requested rather than delivered. No queue, webhook or retry worker is required.

Private configuration/environment: `brevo_api_key`/`HOSPITAL_BREVO_API_KEY`, `mail_from_email`/`HOSPITAL_MAIL_FROM_EMAIL`, optional `mail_from_name`/`HOSPITAL_MAIL_FROM_NAME`, and `app_url`/`HOSPITAL_APP_URL` (absolute application root including mount). Default root is `http://127.0.0.1:8080/`, incorporating configured `base_path` when no explicit URL is supplied; the HTTP Host header never builds links. The sender must be verified/activated in Brevo. Plain-text email uses the request language and identifies this as a school project. Localhost links open on the computer serving the website. This user's Brevo signup/key/sender and real inbox verification are deliberately deferred until they configure the provider.

The existing public recovery page switches between request and password/confirmation forms, remains accessible when signed in, and uses the existing translations/themes/styles. Generic confirmation is visible; all errors remain console-only and preserve fields. Success clears the fragment/password fields and returns to the localized login page.

Login checks that the locked account still has the password hash and auth_version originally verified. A concurrent password reset/change or authentication revision change returns INVALID_CREDENTIALS rather than establishing a session with stale credentials.

## Settings and shared revisions

GET settings/get.php returns the current-user payload. POST settings/profile-update.php accepts version plus any changed full_name/email/default_facility_id/specialties; specialties is an array of labels. POST settings/preferences-update.php accepts version plus locale (es-UY/en), theme (dark/light) or boolean privacy/security preferences. The language selector previews its choice immediately, serializes saves through the existing revision queue and restores the latest confirmed SQL preference after failure; pending newer choices take precedence over older acknowledgements. Other staff tabs refresh through the existing settings broadcast. The theme selector follows the same immediate-preview/versioned-queue rules as language: newer pending choices win over older acknowledgements, and failed saves restore the latest confirmed SQL theme. New accounts keep the dark default. Public authentication and participant pages offer manual dark/light controls, default to dark and remember only an appearance string in a mount-scoped browser cache (`hospital-theme:<application-root-path>`). Staff SQL settings override that cache once loaded; public choices never write account settings. Storage failure retains an in-memory choice. Appearance changes do not modify language, form data, participant credentials or application records. Public authentication pages start in Spanish and support explicit `?lang=en` navigation; the existing patient-survey selector updates that URL parameter without touching its token fragment or answers. Photo POST settings/photo.php uses multipart photo/version; photo-delete.php uses version. notifications.php GET, notifications-read.php POST through_id and diagnostics.php POST load_ms are account-private.

full_name permits an empty initial profile and up to 150 characters for staff without an operational profile. If the shared identity has a doctor/personnel profile (including archived profiles) or a legacy driver/copilot role, it requires a nonblank name of at most 100 characters, matching those editors. This check runs under the shared staff lock; rejected updates leave the profile and revisions unchanged.

**Versions are opaque monotonic numbers, not counters clients should increment.** Settings versions combine user_settings.version with the linked staff.version. Doctor/personnel versions combine their profile revision with staff.version (legacy personnel without a profile use staff.version). This makes another section's shared staff changes invalidate an open editor without adding duplicate identity fields. Always submit the last returned version and reload/reopen after 409. Patients, routes, vehicles, transfers and accounts retain their own version contracts.

## Management catalogs

| Module | Read APIs | Writes | Role |
| --- | --- | --- | --- |
| Patients | POST patients/list.php (q, care_status, state, page, page_size); GET get.php?id, catalogs.php | create/update/archive/restore | records_manager |
| Doctors | GET doctors/list.php, get.php?id, catalogs.php | create/update/archive/restore | records_manager |
| Ambulances | GET ambulances/list.php, get.php?id | create/update/archive/restore | dispatcher |
| Personnel | GET personnel/list.php, get.php?id | create/update/archive/restore | dispatcher |
| Destinations | GET destinations/list.php, get.php?id | create/update/archive/restore | dispatcher |
| Routes | GET routes/list.php, get.php?id | create/update/archive/restore | dispatcher |

Writes are POST. Update requires id/version plus the complete module form; archive/restore requires id/version. Create input fields are the allowlists in PatientInput, DoctorInput, AmbulanceService, PersonnelService, DestinationService and RouteService; these source constants are authoritative. Patient creation also uses a create_token from catalogs. IDs are reused across management, document patient selectors and trace catalogs. Directory listing for the five small nonpatient catalogs is filtered/paginated in the existing frontend. Archived records remain in their management directory, leave new selectors and retain existing history. Nonterminal assignments restrict removing resources currently in use.

Limited patient search uses POST catalogs/patients.php or transfers/patients.php with q; names/identity search terms are not URL parameters. Facility/specialty/document-category lookups use GET catalogs/facilities.php, specialties.php and document-categories.php. Specialty labels are self-declared profile data, not app permissions.

## Documents

GET documents/list.php accepts page/page_size/q/type/sort/state; its endpoint returns the normal data/meta envelope. GET get.php?id supplies metadata/version history; GET create-token.php supplies a retry token. POST create.php and update.php accept multipart metadata plus optional replacement file (creation requires file/create_token; update requires id/version). POST archive.php/restore.php accepts id/version; bulk-archive.php accepts an array of documents with revisions and returns per-record results. Approved staff manage their own uploads; records_manager can manage all.

GET/HEAD documents/content.php?id=...&version=...&download=0|1 checks scope and the physical ready binary, supports a single byte range, and never reveals a filesystem path. PDF/JPG/PNG preview; DOCX downloads for opening on the device. Allowed DOCX hyperlinks use HTTP/HTTPS/mailto; external images/objects, executable/active content and unsafe relationships remain rejected without fetching targets. Binaries remain private and versioned. List view loads 20-row batches by scrolling; only four-card grid mode uses page arrows. Archive preserves versions rather than deleting files.

## Transfers, mapping and simulation

GET transfers/catalogs.php supplies available vehicles/crew, optional facilities and optional route presets. POST transfers/list.php supplies scoped pages/counts; GET get.php?id supplies complete detail. POST create.php uses TransferInput.FIELDS plus create_token and optional draft_version. POST update.php uses those form fields plus id/version and optional boolean refresh_route. POST status.php uses id/version/status; lifecycle scheduled → in_progress → arrived → completed, or cancellation. Private draft GET/POST transfers/draft.php uses version and payload/clear.

Optional route_template_id is a decimal ID or NULL/empty string for manual entry. Normalize it before endpoint validation: manual locations need nonblank distinct names; a selected active preset supplies canonical endpoint/itinerary snapshots. Optional route_version protects newly selected/refreshed presets. No custom location implicitly creates a facility. Geometry, estimates, route stops and crew/vehicle identity are copied to each transfer.

External mapping runs **before** acquiring the booking/domain lock. The transaction re-resolves and fingerprints canonical locations/templates before accepting that result, then performs revision/resource checks and reserves resources atomically. Normal edits preserve immutable snapshots. Explicit refresh_route:true is scheduled-only and deliberately retries/applies the current route; lookup failure retains the original transfer and returns MAP_UNAVAILABLE. Historical/in-progress transfers cannot be silently remapped.

If no duration resolves, distance/duration/ETA stay NULL. Reservations use UNMAPPED_DURATION_SECONDS (default 3600, configurable 900–172800) plus the existing 900-second buffer. This is a conservative booking policy, not a fabricated journey ETA.

GET tracking/snapshot.php and history.php are scoped; GET/POST tracking/control.php is admin-only. Simulation still needs a started run plus one CLI worker, uses no GPS, and never advances because a page is read. The worker skips transient RESOURCE_BUSY ticks and continues, retaining the single-worker lock. Snapshot freshness identifies a missing/stale worker.

## Maintenance interfaces

CLI setup.php creates the private storage areas along with schema/config; optional --web-user=NAME prepares narrowly scoped OS access. CLI preflight.php reports PHP/extensions, database/migration state, actual checked_as storage access, and missing/size/hash-mismatched ready files. It exits nonzero when checks fail. It never claims a source-owner access check proves Apache access. --prepare-storage with optional --web-user=NAME is an explicit administrative filesystem operation. --recover-from=/ABSOLUTE/BACKUP restores only missing, hash/size-matching users/*.png or documents/*.bin, retains SQL metadata and reports unavailable IDs; it does not invent file bytes or overwrite existing files. Apply preparation to recovered files under the intended web user when needed.

CLI users.php adds list, roles USER ROLE,ROLE, reactivate USER, revoke-sessions USER and reset-password USER. Password reset reads HOSPITAL_NEW_PASSWORD, never a password command argument. Existing create-admin/pending/approve/disable/sessions remain available. Pair database backups with private storage; deployment copies/configuration are not synchronized automatically. Unexpected server exceptions retain request IDs and add only safe source location/SQLSTATE/numeric driver codes, excluding query parameters, bodies and secrets.


## Surveys (schema 011)

Every approved staff account manages its own surveys; administrators manage all. No clinical/dispatcher role is required. The owner comes from the authenticated session. Staff writes require shared CSRF and a current survey revision. Public endpoints never expose internal title/description/notes, owner/account data, results or other invitations. Patient records/accounts are not created or linked by survey participation.

| Method | Path under /api/v1/surveys/ | Contract |
| --- | --- | --- |
| GET | list.php | page, page_size ≤100, archived=0/1; scoped array with pagination meta |
| GET | get.php?id | Editor data, question aggregates, rating average/count and recent local-date activity |
| POST | create.php | title, description, category, area, notes, form_title, form_description, color, config object, items array |
| POST | update.php | Same fields plus id/version |
| POST | transition.php | id/version/action: publish, close, reopen, archive, restore |
| GET | links.php?id | Authorized link IDs, token, single_use, created_at/used_at/revoked_at |
| POST | link-update.php | id/version; omit link_id to create one individual invitation, or supply link_id to revoke it (shared revocation also generates a replacement) |
| GET | answers.php | id, question_id (item key), q, page, page_size ≤50; paginated written/date/Other answers with optional voluntary name |
| POST | public/get.php | token; returns participant form, version, signed submit_token and anonymous form csrf_token |
| POST | public/submit.php | token/version/submit_token, answers array, optional participant_name; requires returned X-CSRF-Token and same-origin form session |

Survey authoring/submission bodies allow up to 256 KiB so valid Unicode text within the field limits is accepted. Editor config fields follow the existing frontend: audience (patients/staff/everyone), access (shared_link/individual_link), identity (anonymous/optional_name), limit_enabled/response_limit (1–10000 when enabled), opens_enabled/opens_at, closes_enabled/closes_at, completion_message. Local date/time strings YYYY-MM-DDTHH:mm use America/Montevideo and persist UTC. Disabled limits/dates persist NULL. Category: patient_care/transfers/emergency/staff/other; color: blue/green/cyan/amber/rose/slate.

Each ordered item has a unique string id (item key), type, title, required, options, other, description, placeholder, scale_min/scale_max/scale_start/scale_end, rating_max. Up to 20 items; seven answer types short_text/long_text/single_choice/multiple_choice/linear_scale/rating/date plus section/divider. Choices have 2–10 options; publication requires distinct nonempty labels and at least one titled question. Drafts can retain incomplete question text. Scale min 0/1, max 2–10; ratings 3/5/10. Published form content, appearance, audience, identity and access mode are frozen; internal metadata, limits, dates and completion message remain editable. Duplicate into a new draft for a different questionnaire. Archive preserves links/results and blocks new participation; restore is reversible. Response cap/deadline can derive closed display status while lifecycle remains published; edit cap/deadline to resume that form, or use explicit close/reopen.

Answer entries: {question_id, value, other_text?}. Text/date values are strings; rating/scale values integers; choice values are zero-based option indices encoded as strings or the literal other; checkbox values are unique arrays of those values. Other requires enabled other plus nonempty other_text (≤120). Omit skipped optional questions. Text bounds match the patient UI (short 250, long 1000); optional name ≤100 and forbidden for anonymous forms. Server validates everything against the saved form. Successful identical retries return accepted:true/replayed:true without another response; changing an already submitted payload returns 409. First commits return accepted:true, completion_message and replayed:false. Database transactions serialize cap and invitation consumption.

The public version is the survey snapshot at credential issuance, signed into submit_token and retained as survey_responses.survey_version. It is not the staff editor's current-version precondition: published participant fields/items are immutable, so later invitation creation or internal metadata edits do not invalidate an open response. Signatures still bind the submitted version and link; current availability, deadlines, caps, revocation and single-use checks run under locks before a new commit. Staff editing/link operations continue to require the current administrative version.

Shared links accept multiple independent submissions; no one-response-per-person/device guarantee is claimed. Individual links are unnamed, revocable, single-use bearer invitations; possessing the link grants access while open. They do not prove a patient's identity. patients/everyone describe the intended distribution; staff audience additionally requires a live approved staff session, without attaching account identity to the response. Links are distributed manually, with real local QR encoding; no email/SMS delivery exists. Tokens travel in the URL fragment and POST JSON, not query strings. SQL stores a random link nonce and token hash; the existing private app_key derives retrievable capability tokens. Preserve app_key with configuration backups. Raw invitation/session/submission tokens and response bodies must never enter logs.

Only src/views/surveys/user-view/survey-user.html is exempted from the staff HTML guard in public/.htaccess and dev-router.php. Its CSS/JS remain isolated; it calls only the public survey endpoints, uses no browser response persistence and clears page-memory answers after committed success. Staff detail refreshes visible results every 15 seconds without extending idle login. Written results use server pagination/search; checkbox percentages count answered questions, and generic rating averages normalize stars to five points. They are not invitation response rates or a clinical satisfaction score. Public read/submit requests use the existing rate-limit infrastructure. PHP remains entirely under backend/php; migration/main SQL remain under db/sql.
