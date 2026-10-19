# Unified hospital backend audit — 2026-10-14

## Purpose and limits

This is a quick, evidence-based audit to guide future implementation prompts. It covers the current SQL model, PHP services/APIs, JavaScript integrations, missing user workflows, and the known XAMPP deployment. It is a school-project completion plan, not a proposal to rebuild the application as production hospital software.

**Source of truth:** `/Users/snowy/Downloads/johnproject`. **Deployment inspected read-only:** `/Applications/XAMPP/xamppfiles/htdocs/johnproject3`, using its configured `hospital` database. These copies are separate; future source work should remain in the workspace unless deployment work is explicitly requested.

Methods: source inspection across all implemented backend modules; schema/table/column inventory; read-only live database checks; filesystem permissions and binary-existence checks; local HTML link scan; and one database-free PHP validation reproduction. The live SQL inspection ran inside a read-only transaction and rolled back. No application records, permissions, passwords, uploads, migrations or feature code were changed during this audit. Full historical test suites and every browser workflow were **not** rerun. Prior successful feature checks remain historical evidence, not a fresh comprehensive test result.

Evidence labels:

- **Live confirmed:** directly observed in the current deployment/database/filesystem.
- **Source confirmed:** the relevant code path or missing implementation was inspected; a full user scenario was not necessarily reproduced.
- **Reproduced:** a focused execution demonstrated the behavior.
- **Intentional limitation:** a documented decision rather than a defect.

## Overall assessment

The database foundation is coherent: canonical patient/staff/vehicle/facility/route IDs, server authentication, scoped permissions, foreign keys, transactional changes, archive/restore, file versions, transfer snapshots and shared simulated tracking are implemented. **A database redesign is not the next task.**

The most immediate problems are deployment storage, incomplete account-administration workflows, shared-staff revision handling, and mapping work that can block the simulation worker. Several visible parts of the website remain placeholders. Fix and complete these in small slices, retaining the existing design and console-only errors.

## Live database snapshot

| Check | Observation |
| --- | --- |
| Recorded schema | All migrations `001_user_system` through `010_routes` |
| Tables | 39; all expected tables present |
| Expected columns | No missing columns in the checked schema inventory |
| Foreign-key relationships inspected | 51; no orphaned references found |
| Accounts / staff / patients | 2 / 2 / 1 |
| Clinical doctor profiles / personnel profiles / ambulances | 0 / 0 / 0 |
| Centers / route templates / transfers / appointments | 0 / 0 / 0 / 0 |
| Documents / document versions | 3 / 3 |
| Ready-file records with missing binaries | **4: three documents and one avatar** |
| Existing ready binaries with a detected size mismatch | 0; missing files were counted separately |
| Simulation | Stopped, no current run or heartbeat |
| Static deployment checks | Login HTML returned 200; direct private SQL URL returned 403 |

Additional live checks found no active users without active staff or roles, invalid account statuses, documents without a current ready-version **record**, transfers without drivers, invalid checked lifecycle timestamps, terminal-transfer reservations, active profiles missing their operational duty, or blank route/transfer endpoint names. Most transfer/profile checks are presently vacuous because those catalogs and transfers are empty.

**A valid SQL file record does not prove that its binary exists.** That distinction explains why the relational checks pass while the three current documents cannot be opened from this deployment. This audit did not compare every index/type/default or run concurrent writes; do not interpret the checks as proof of every database invariant.

## Model inventory and ownership

| Domain | Canonical tables | Current integration |
| --- | --- | --- |
| Identity/access | `users`, `staff`, `roles`, `user_roles` | Registration, approval, login, account disabling, shared staff identity |
| Sessions/security | `user_sessions`, `auth_rate_limits`, `audit_events` | SQL sessions, revocation, expiry, login limits and ID-based audit events |
| Settings/catalogs | `user_settings`, `specialties`, `staff_specialties`, `facilities`, `user_notifications`, `user_diagnostics` | Profile/preferences/avatar metadata, centers, specialties, own notifications/diagnostics |
| Patients | `patients`, `patient_contacts`, `patient_encounters`, `patient_appointments`, `departments` | Patient CRUD and current encounter/contact; appointment table exists without a scheduling workflow |
| Clinical doctors | `doctor_profiles`, `staff_roles` | Shared staff ID, clinical directory, treatment/companion selection |
| Fleet/crew | `ambulances`, `personnel_profiles` | Managed vehicle and driver/copilot catalogs |
| Routes | `route_templates`, `route_stops`, `route_map_cache` | Optional presets, ordered itinerary, mapped geometry and cached lookups |
| Documents | `documents`, `document_categories`, `document_versions`, `stored_files` | Scoped metadata, private uploads, versioned replacement, archive/restore and content delivery |
| Transfers | `transfers`, `transfer_crew`, `resource_reservations`, `transfer_events`, `transfer_drafts` | Assignment, lifecycle, snapshots, booking intervals and private drafts |
| Tracking | `simulation_runs`, `simulation_state`, `transfer_positions`, `transfer_latest_positions` | One server simulation and shared position history |
| Schema history | `schema_migrations` | Numbered upgrades alongside the current full schema snapshot |

Do not introduce duplicate patient, doctor, personnel, facility or route stores. A clinical doctor/personnel record is not automatically a website account. Application roles and operational duties are intentionally different.

## Findings and priorities

P1 means a direct blocker or a credible data-loss/service-interruption path. P2 means a functional gap or inconsistency to address before calling the website complete. Priorities are for this project's scale.

### F01 — P1: SQL upload records survived, but their files did not

**Live confirmed.** `hospital.stored_files` has three ready document binaries and one ready avatar binary absent from the configured `johnproject3/storage` paths. The document/version rows are present. `DocumentService::content()` checks the physical file and will reject missing content; avatars likewise cannot load.

Sources: `backend/php/Modules/Documents/DocumentService.php::content`, `backend/php/Modules/Settings/AvatarService.php`, `backend/php/Storage/PrivateStorage.php`.

**Next action:** locate the original private storage or a backup and restore files using their existing opaque keys and expected extensions. Verify size and SHA-256 against SQL. Preserve ownership/version references. Do not delete valid metadata, mark records ready without files, invent replacements, or copy unrelated files into matching paths. If originals are unavailable, record that fact and use an explicit replacement/re-upload process.

**Completion check:** each ready document/avatar has its expected file; authorized content requests and the avatar load successfully. Backups/deployment copies must include both SQL and private storage, not SQL alone.

### F02 — P1: Apache cannot write the deployed upload storage

**Live confirmed by permissions inspection.** `johnproject3/storage` and `storage/users` are owned by `snowy:staff`, mode 0775, with no displayed named ACL granting Apache write access. Apache runs as `daemon:daemon`; the inspected daemon group list excludes `staff`. `storage/documents` and `storage/quarantine` do not exist.

Consequences: creating staging/publication directories or writing an avatar can fail with 503 despite valid authentication and a healthy database. Running checks as the source owner does not verify Apache's filesystem permissions.

Sources: `PrivateStorage::directory`, `DocumentFiles::stage/publish`, `backend/php/cli/setup.php`. Setup creates SQL/configuration but does not prepare or validate writable storage.

**Next action:** prepare the three private areas with narrowly scoped Apache access, keeping them outside public access. Add a small deployment preflight that reports directory existence/read/write capability under the actual web-server identity. Do not use world-writable permissions or move uploads into `public/`.

**Completion check:** one upload and one avatar change work through actual XAMPP Apache; direct private URLs remain forbidden. This requires authorized deployment work, separate from workspace-only source changes.

### F03 — P1: Account administration is incomplete for ordinary administrators

**Source confirmed.** Admin APIs can list pending registrations, approve one selected role and disable an account. There is no implemented account-management UI, general account directory, multi-role grant/revoke workflow, or disabled-account reactivation flow. `approve()` requires `pending`, so approving an already active/disabled account is not a way to edit roles or reactivate it. The current CLI has the same approval limitation.

Sources: `backend/php/api/v1/admin/users/`, `AccountAdministration.php`, `backend/php/cli/users.php`; no frontend callers of the admin-user endpoints were found.

An `admin` role alone deliberately does not grant patient/dispatch access. The full test account was granted all four roles through a trusted local operation; that is not yet a repeatable website administration workflow.

**Next action:** add a small administrator account screen and matching service operations for pending approval, existing-account role changes, disable/reactivate and session revocation. Protect the last active administrator; validate the actor inside the transaction; invalidate sessions appropriately when permissions change. Never accept role/status fields during public registration. Never use a noncanonical account status such as `approved`; successful approval produces `active` plus a staff link and explicit roles.

**Completion check:** an admin can approve a new staff member, grant the necessary combination of roles, revoke access and reactivate a disabled account without phpMyAdmin edits. A user cannot grant themselves privileges.

### F04 — P1: Shared staff edits can overwrite changes from another section

**Source-confirmed revision gap; concurrent browser reproduction not performed.** Settings, doctors and personnel can all change `staff.full_name`. Doctor mutations check `doctor_profiles.version`; personnel mutations check their profile version once a profile exists; settings check `user_settings.version`. Although staff revisions are advanced, those independent forms do not consistently validate a captured `staff.version`.

Example: open a personnel form, change the same person's name in doctor management/settings, then save the old personnel form while changing its phone. Its unchanged profile revision can allow the old name to overwrite the newer shared name. The domain lock serializes writes, but cannot detect stale form data by itself.

Sources: `DoctorService::lock/save`, `PersonnelService::lock/save/serialize`, `SettingsService::lock/profile`.

**Next action:** expose/capture a shared staff revision and validate it whenever shared identity/contact fields are written, or centralize those writes behind one consistent revision contract. Update related response hydration so settings/directories use the current canonical name. Keep module-specific revision checks for module-specific fields.

**Completion check:** one focused test uses the same staff ID across two editors; a stale update returns 409 and preserves the newer shared values.

### F05 — P1: Slow manual mapping can stop the simulation worker

**Source-confirmed failure path; timing/concurrency scenario not executed.** `TransferService::create/update` takes the shared transfer-domain lock and begins a transaction before resolving locations. For a new/changed manual route, `TransferLocations::resolve` calls `RouteMapper`, which can spend roughly twelve seconds doing network lookup. Other domain mutations and simulation ticks wait only five seconds for that lock.

`simulate-transfers.php` has an outer exception handler, but no per-tick handling of `RESOURCE_BUSY`. A tick that times out behind mapping can exit the worker, leaving a running simulation with a stale heartbeat until someone restarts it.

Sources: `TransferService::transaction/catalog`, `TransferLocations::resolve`, `RouteMapper::path`, `TransferAccess::serialized`, `backend/php/cli/simulate-transfers.php`.

**Next action:** calculate external mapping outside the domain transaction; recheck resource/template revisions and save atomically afterward. Make the worker tolerate transient lock contention with bounded retry/skip behavior. Keep the single-worker lock and booking checks.

**Completion check:** simulate a slow lookup locally; the worker remains alive and resumes ticks, and a concurrent booking still cannot double-assign resources. Do not depend on public API latency to reproduce the test.

### F06 — P2: Document list pagination violates the agreed list-view behavior

**Source confirmed.** `public/src/js/documents/documents.js::render` sets `pagination.hidden = false` in both views. Card pages contain four records; list pages contain twenty, and the list has no scroll-based next-batch loader. This directly explains the previously reported persistent arrows; it is not caused by running without XAMPP.

**Next action:** keep arrows for cards only and implement list scrolling/load-more in the existing container. Merely hiding the arrows would make records after the first twenty inaccessible.

**Completion check:** with more than twenty matching documents, the list reaches every record without arrows; card pagination, filters, archive view and selection still work.

### F07 — P2: An empty route ID bypasses manual endpoint validation

**Reproduced without a database.** Calling `TransferInput::fields` with `route_template_id: ""` and blank manual endpoint names succeeds, returning a normalized NULL route ID and two empty names. Validation decides whether a preset exists using the original input value, while ID normalization treats the empty string as NULL.

Source: `backend/php/Modules/Transfers/TransferInput.php::fields`.

The current creation UI normally sends NULL, so this is an API correctness hole rather than evidence that the normal form already creates blank traces.

**Next action:** normalize the selected route ID once, then use that normalized value for all required-location and identical-endpoint checks.

**Completion check:** NULL/empty-string manual IDs both require nonblank distinct endpoints; valid selected preset IDs can still omit client-supplied endpoint text.

### F08 — P2: A trace saved without geometry has no clear mapping retry action

**Source confirmed.** Manual traces with unchanged endpoints preserve their existing route snapshot, even if its geometry is empty. A trace retaining the same selected preset also preserves its snapshot before looking at the template again. That correctly protects history, but means later Internet recovery or a newly mapped preset does not fill an already saved unmapped trace.

Sources: `TransferLocations::resolve`, `RouteService::save`, `public/src/js/traces/trace-view.js`.

**Next action:** provide an explicit map-retry/apply-current-route action for scheduled transfers, with version checks and reservation recalculation. Retain the original snapshot automatically; never silently rewrite in-progress/completed traces when a template changes.

**Completion check:** save without a mapping provider, restore provider availability and deliberately map the scheduled trace without altering unrelated historical transfers.

### F09 — P2: Unknown-duration bookings need a deliberate demo policy

**Intentional provisional limitation.** An unmapped manual trace has no duration, so `TransferService::reserve` reserves only the existing 900-second buffer. This is not a journey estimate. It can accept another future assignment too soon; start-time occupancy checks then reject the later start if the first trip remains active.

**Next action:** choose a simple fallback: accept a staff-entered estimated duration when mapping fails, or use a clearly defined conservative demo interval. Preserve the ability to save without geometry and keep active-occupancy checks.

**Completion check:** two fictional unmapped bookings cannot be accepted based on an accidentally assumed fifteen-minute journey.

### F10 — P2: Password recovery/change is still unimplemented

**Source confirmed and intentionally unfinished.** Recovery HTML has a disabled submit control; the settings reset control is disabled; no reset/change API exists. A staff member who forgets their password cannot complete that visible workflow. A new test account does not solve password recovery for other users.

Sources: `public/src/views/register-restore/restore-password.html`, `public/src/views/settings.html`, `backend/php/api/v1/auth/`.

**Next action:** for the school project, implement an administrator-assisted reset and/or authenticated password change first. An email-token workflow is optional unless explicitly required. Hash passwords and revoke other sessions; keep credentials out of logs. Do not implement a placeholder success message.

**Completion check:** change/reset a fictional account password and confirm the old password and revoked sessions stop working.

### F11 — P2: Visible sections and summary data are not all functional

**Source/live confirmed.** Calendar and surveys scripts are empty, with no corresponding domain API implementation. `patient_appointments` exists and supplies patient summary counts, but there is no scheduling CRUD workflow. Reports navigation resolves to a nonexistent `analytics/analytics.html`: the local anchor scan found sixteen references to that missing target. These are completion gaps outside the six implemented management catalogs.

**Next action:** decide which are required for the final school demonstration. Implement a small appointment/calendar slice if required; derive summaries from canonical SQL. Otherwise keep unfinished sections clearly unavailable instead of linking to a 404 or displaying demonstration data as real. Build surveys/reports only if they remain in the agreed scope.

**Completion check:** every visible navigation action leads to a working page or an explicitly unavailable state; no summary claims appointments that users cannot manage.

### F12 — P2: Ordinary DOCX files with hyperlinks are rejected

**Source-confirmed compatibility restriction.** `DocumentFiles::office` rejects every relationship with `TargetMode="external"`, including standard hyperlinks. A valid Word document containing a harmless website link can fail upload even though DOCX is an allowed format.

**Next action:** decide whether this restriction is acceptable for the demonstration. If normal linked DOCX files should work, distinguish hyperlink relationships from embedded/external executable or active content; do not fetch linked resources on the server. The current DOCX detail behavior is download-to-open, not a Word rendering engine; retain that simple behavior unless an inline preview is explicitly requested.

**Completion check:** one representative DOCX with a normal hyperlink follows the chosen policy, while rejected embedded/active content remains rejected.

### F13 — P2: Maintenance context and deployment verification are fragmented

**Source/live confirmed.** `docs/api-contracts.md` still says settings writes, uploads, transfers and catalog CRUD are unimplemented, although they exist. `docs/README.md` links it as implemented contracts. Newer contracts live in a long AGENTS history. This workspace is not a Git repository. Setup verifies SQL connectivity but not Apache routing/private storage/runtime dependencies. Unexpected exceptions are logged with request ID and exception class only, often too little to distinguish SQL migration failures from filesystem or provider failures.

**Next action:** update the existing API reference and README rather than producing another installation guide per feature. Establish a version-control/checkpoint workflow when authorized. Add one small CLI preflight for migration state, required PHP extensions, API mount assumptions and private-storage access. Improve diagnostics using safe operation names, SQLSTATE/numeric error codes and request IDs; never dump SQL parameters, passwords, patient data or session payloads. Keep frontend errors in the console, as requested.

**Completion check:** a future maintainer can identify current endpoints, required request methods/units/roles and the deployed source revision, and diagnose a 503 without guessing. A copied database plus copied binaries can be checked together.

## Operational prerequisites that are not defects

- The live fleet/crew catalogs are empty. Create at least one available ambulance and one active driver with a valid license through management before testing trace creation. A companion and route preset are optional. Use the existing patient for patient cargo, or create another fictional patient.
- Simulation is currently stopped. Starting a trace creates a route position, but continuous movement requires a started simulation run **and** its CLI worker. XAMPP Apache alone does not run that worker. There is no website simulation-control panel; add a minimal admin control only if needed, and remember HTTP cannot replace the worker process.
- Most approved ordinary staff can manage their own uploads. Full clinical patient/doctor records require `records_manager`; fleet/crew/destination/route management requires `dispatcher`. `admin` does not automatically inherit these roles. Preserve this policy while completing role administration.
- Centers/routes are optional templates, not required master records for every location. Typed trace locations must not auto-create hospital centers.
- Archive/restore is intentional. Do not replace it with destructive deletion that breaks document/transfer history.
- Synthetic tracking, outbound-leg route estimates, download-only DOCX viewing, approximate online address matches and Internet-dependent basemaps are demo limitations. Do not promise real GPS, traffic-aware arrival times, automatic return trips or a full electronic health-record system.
- Light theme remains explicitly deferred. Partial English translation is not complete site localization; expand it only if required.

## Recommended next prompts, in order

| Slice | Scope for a future prompt | Minimal acceptance evidence |
| --- | --- | --- |
| 1. Repair deployment storage | F01–F02: recover the three document binaries/avatar if possible, fix private directory access and verify Apache uploads. Explicitly authorize work on `johnproject3`; preserve records. | Actual deployed upload/download/avatar, missing-file reconciliation, private URL still 403 |
| 2. Finish account administration | F03 and F10: admin account screen, multi-role changes, disable/reactivate and a simple password-change/reset workflow | One fictional account completes its lifecycle; last-admin protection and session revocation checked |
| 3. Fix shared staff revisions | F04 across settings/doctor/personnel editors | One stale cross-section edit is rejected without losing data |
| 4. Stabilize routing and simulation | F05, F07–F09: mapping outside locks, worker contention handling, normalized route IDs, explicit scheduled-map retry and fallback duration | Focused slow-provider/offline cases, ongoing worker and no conflicting bookings |
| 5. Finish document usability | F06 and chosen F12 policy | More-than-twenty-record list navigation and representative allowed files |
| 6. Resolve remaining visible scope | F11: appointments/calendar and optional surveys/reports, or clearly unavailable navigation | Navigation scan and one required scheduling flow; real SQL-derived counts |
| 7. Consolidate maintenance | F13: update existing contracts, add a small preflight, establish authorized version control and paired database/storage backups | Current reference plus a short preflight/restore demonstration |

Storage repair is the first practical testing blocker. For workspace-only code work, start with the account workflows or shared revisions; do not silently modify the XAMPP copy while implementing those features.

## Constraints to include in future prompts

> Work in `/Users/snowy/Downloads/johnproject` unless I explicitly authorize deployment work. Follow AGENTS.md and this audit. Keep this a simple functioning school project. Reuse the existing PHP/bootstrap/PDO/session/CSRF architecture, canonical SQL entities and Spanish UI. Put PHP under backend/php and SQL under db/sql, with a new numbered migration plus matching main schema changes when needed. Preserve the existing design; change HTML/CSS only where the selected feature requires it. Errors stay console-only; preserve dirty forms after failures. Keep archived references and immutable trace snapshots. Perform focused checks for the changed slice, update AGENTS.md, and do not create another installation guide. Fix the named findings rather than refactoring unrelated modules.

This report is a snapshot, not an instruction to implement every finding at once. Mark each finding resolved with evidence as later slices are completed, and keep unresolved items visible.


## Correction status — 2026-10-14

The findings above preserve the original audit snapshot. The user subsequently authorized corrections in this workspace. This section supersedes the original next-prompt inventory where marked complete; it does not claim the separate XAMPP deployment was repaired.

| Finding | Current status and evidence |
| --- | --- |
| F01 missing upload bytes | **Deployment recovery pending.** Added CLI missing/size/hash inspection and recovery of verified bytes from an explicit backup. Disposable recovery check passed; absent originals cannot be recreated. No deployed files or SQL metadata were replaced. |
| F02 storage permissions | **Source preparation implemented; deployment pending.** Setup/preflight can prepare private users/documents/quarantine directories and explicit web-user access. Actual Apache identity/access and upload/download still require deployment verification. |
| F03 account administration | **Implemented.** Admin-only accounts screen and API support multi-role approval/edits, disable/reactivate and session revocation, with revision checks and last-admin protection. |
| F04 shared staff overwrites | **Fixed.** Settings/doctor/personnel versions include canonical staff revision, rejecting stale cross-section edits. |
| F05 mapping contention | **Fixed.** Online lookup runs outside the booking lock; canonical inputs are rechecked before commit. A busy simulation tick is skipped without terminating its worker. |
| F06 document navigation | **Fixed.** List mode scrolls through successive batches with no pagination arrows; card mode retains arrows. Browser reached 26/26 records. Bulk archival respects the 100-item endpoint limit. |
| F07 empty route ID | **Fixed.** NULL/empty route choices normalize before manual endpoint validation. Invalid empty-endpoint request is rejected. |
| F08 map retry | **Implemented.** Scheduled trace edit has explicit refresh_route; failed lookup preserves existing data, successful retry snapshots current route/map. |
| F09 unknown duration | **Fixed conservatively.** Unknown duration reserves configurable one hour plus 15-minute buffer. Duration/ETA remain unknown; no fabricated travel estimate. |
| F10 passwords | **Implemented.** Current-password authenticated own change plus versioned administrator reset, session revocation and trusted CLI reset. Recovery is administrator-assisted; email delivery remains absent. |
| F11 remaining screens | **Navigation corrected; features deferred.** Reports resolves and reports/calendar/surveys show matching pending pages. Full scheduling/surveys/reporting require a separate scope; no invented implementation or metrics. |
| F12 DOCX hyperlinks | **Fixed.** Ordinary HTTP/HTTPS/mailto hyperlinks upload successfully; external image/active relationships remain rejected. Server does not follow links. |
| F13 maintenance | **Source portions implemented.** Current API reference/README, safe exception diagnostics and private runtime/storage preflight/recovery command added. Git/checkpoint and paired DB+binary backup workflow remain operator decisions. Preflight reports invoking-user access and base_path; it does not impersonate Apache or prove its Alias configuration. |

Validation: 21 existing route checks and 25 focused audit correction checks passed on PHP 8.0.28 / MariaDB 10.4.28 in an isolated disposable database, plus PHP/JS syntax and browser checks. No new migration is needed; schema remains 001–010. Context/contracts are recorded in AGENTS.md and docs/api-contracts.md. Test fixture records and credentials are disposable, not demonstration seed data.

Next practical work: explicitly authorized johnproject3 deployment update and storage reconciliation using an available backup, then end-to-end testing under Apache. Calendar/appointments, surveys/reports, email recovery, light theme and broader localization remain separate requested slices. Preserve current private configuration, uploads and records when deploying source changes.

Survey follow-up, 2026-10-15: the user separately authorized and completed F11’s survey portion with schema 011, staff authoring/publication, anonymous bearer invitations, isolated patient submission and protected results. Calendar/appointments and reporting remain deferred; the original audit/deployment storage findings remain historical and are not implied repaired. Current contracts/verification are in AGENTS.md and api-contracts.md.
