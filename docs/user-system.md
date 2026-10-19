# User system: implemented foundation

Implemented 12 October 2026. This is phase 1a of the [roadmap](backend-roadmap.md), based on the [frontend analysis](backend-analysis.md). `AGENTS.md` records these as standing workspace instructions for later work.

## What works

- Staff registration persists a pending account, a bcrypt password hash and its own settings row. Submitted privileges are rejected. Username, email and normalized CI are unique in SQL.
- An administrator approves an application and links it to one shared staff identity. Approval is available through a trusted local CLI and authenticated admin APIs; there is no new administration screen yet.
- Approved staff can log in, navigate private pages, reload and reuse their existing browser session. Anonymous or expired requests for private HTML redirect to login on the server.
- Sessions are stored directly in SQL through PHP's session handler. Different browsers can remain logged in independently. Users can list and revoke only their own sessions through the API; account disabling revokes every session of that account.
- Real logout revokes the SQL session and expires the cookie. Tabs of this application receive a logout broadcast; periodic session checks also detect expiry/revocation.
- `auth/me.php` and `settings/get.php` return the authenticated account, linked staff information, roles, default preferences and session expiry. Home/profile labels and the existing settings screen show this data.
- Settings controls are deliberately read-only for this slice. No UI action claims to save a setting without an implemented write API. Password recovery explicitly says it is not available yet.

No CSS was changed. HTML changes wire the shared scripts, canonical form fields, actual logout and current-user markers, adjust password validation/accessibility, and remove the fake password-recovery promise. Existing feature demonstrations outside identity remain unconnected to SQL.

## Account lifecycle

```text
Registration → pending → administrator verifies/approves → active
                                                        → disabled
```

Registration requires `username`, `email`, `password`, `national_id`. A CI identifies an application; knowing it does not prove hospital employment. The administrator must verify the application before approval. CI normalization removes dots, hyphens and spaces and accepts 6–12 digits; this is format validation, not official identity verification.

Usernames are normalized to lowercase ASCII and contain 3–50 letters/numbers/dots/hyphens/underscores, beginning with a letter or number. Email is normalized to lowercase. Passwords permit spaces, require at least 12 characters, and cannot exceed bcrypt's 72-byte input limit. A long Unicode password can hit the byte limit before the HTML character limit. Passwords are never returned by an API.

Pending accounts have no role and cannot establish an authenticated session. On approval, an existing active `staff` row with the CI is linked, or one is created. Because the existing registration form has no full-name field, the initial display/staff name is the username; profile editing can improve this in the settings slice.

Seeded permission codes are `admin`, `records_manager`, `dispatcher`, `staff`. This slice enforces staff authentication and administrator-only account administration. Permission policies for documents, catalogs and transfers will be implemented with those domains. Navigation to their existing demonstrations does not mean their future APIs already exist.

## Session behavior

Defaults are **30 minutes idle** and **8 hours absolute**, enforced by PHP and SQL. The browser cookie is session-only, HttpOnly and SameSite=Lax; enable Secure with HTTPS. Returning to an open browser tab can restore a still-valid session. There is no persistent “remember me” token.

The shared client checks the session roughly once a minute while the page is visible and when it regains focus/visibility. A heartbeat extends idle expiry only when the page has received recent trusted keyboard/pointer/touch activity. Passive `me.php`, settings and session-list polling never extends idle expiry. Absolute expiry cannot be extended. The future automatic-logout preference cannot remove these mandatory server limits.

Login rotates the cookie ID and CSRF token. SQL stores a SHA-256 digest of each opaque cookie ID, session payload, account link and expiry/revocation metadata. Session payloads and CSRF tokens are private server data; never expose them in admin lists or commit a database dump containing them.

Requests sharing one cookie serialize through a database advisory lock. SQL writes cannot revive a revoked/expired session. Role/status/authentication revision are rechecked against the database rather than trusted from browser claims. Disabling the last active administrator is rejected.

All POST endpoints require CSRF, including login/registration/logout. If the cookie expires, the old CSRF token also becomes invalid: the shared client refreshes CSRF once and retries, after which a protected request returns 401 and the page redirects. Wrong credentials receive a generic message. A pending/disabled explanation is returned only after a valid password has been supplied.

## File and data owners

| Location/table | Responsibility |
| --- | --- |
| `backend/php/config/`, `Config.php`, `Database.php`, `bootstrap.php` | Private configuration, one PDO factory, error/session bootstrap |
| `backend/php/Http/`, `Security/` | Request/response contracts, CSRF, rate limiting, SQL session storage |
| `backend/php/Modules/Auth/` | User/session repositories, authentication and approval/disable transactions |
| `backend/php/api/v1/` | Thin HTTP entry points, exposed by Apache Alias |
| `backend/php/cli/` | Trusted local setup and account administration |
| `db/sql/schema.sql` | Fresh installation schema 001; nine related tables and role seeds |
| `public/src/js/api-client.js`, `auth-session.js` | One API base, cookies, JSON/CSRF/error handling, profile hydration and session lifecycle |
| `users` / `staff` | Account credentials/admission versus shared staff identity |
| `roles` / `user_roles` | Application permissions; separate from future clinical/crew responsibilities |
| `user_settings` | One persistent preference row per account |
| `user_sessions`, `auth_rate_limits`, `audit_events` | Authentication state, abuse throttling and account/session mutation history |
| `schema_migrations` | Records initial version; a general upgrade runner is still future work |

Every PHP file is under `backend/php/`. Serve only `public/`, with the explicit API Alias. Opening HTML with `file://`, using a generic static live server, or serving the whole repository does not provide this authentication boundary.

## Using it locally

Follow [xampp-setup.md](xampp-setup.md) to install the schema, generate private configuration and create the first administrator with a password you choose. No default production account or password is committed.

After registering fictional staff in the existing page, use the trusted terminal:

```sh
/Applications/XAMPP/xamppfiles/bin/php backend/php/cli/users.php pending
/Applications/XAMPP/xamppfiles/bin/php backend/php/cli/users.php approve chosen_username staff
/Applications/XAMPP/xamppfiles/bin/php backend/php/cli/users.php sessions chosen_username
/Applications/XAMPP/xamppfiles/bin/php backend/php/cli/users.php disable chosen_username
```

Run from the project root. CLI commands intentionally rely on operating-system access to private configuration; they are not HTTP endpoints. HTTP account operations require an active administrator and CSRF. See [api-contracts.md](api-contracts.md) for the implemented methods and payloads.

## Verification and remaining scope

Verified with the installed **XAMPP PHP 8.0.28 and MariaDB 10.4.28**, using a separate temporary database; the normal XAMPP database/configuration was not altered. PHP syntax checks passed for all 32 files and JS syntax checks for all 25 scripts. The API suite completed 48 checks through XAMPP Apache, including registration conflicts, pending/disabled access, approval, privilege rejection, session rotation, independent browsers, ownership, concurrent logout, replay, idle/absolute expiry, CSRF, rate limiting and private-file/page boundaries. The built-in router also passed the original 46-flow suite before the additional concurrency checks.

Apache root and `/hospital/` mounting were checked, including nested private pages, cookie scope, API JSON 404s and logout. Browser checks confirmed login, reload/session restoration, current profile values and cross-tab logout. The [profile screenshot](verification/user-profile.jpg) uses a fictional test account.

`tests/auth_integration.py` requires a running application, a disposable `*_test` database, matching `HOSPITAL_*` environment variables, Python 3, and a `system_admin` fixture created through `users.php create-admin` with `HOSPITAL_ADMIN_PASSWORD` supplied in the environment. It writes test accounts and changes session expiry/status; never point it at useful records. It starts its own short-timeout PHP server on port 8873. Set `HOSPITAL_AUTH_TEST_URL` and `HOSPITAL_TEST_PHP` for other local paths/ports. Repeated runs may need the disposable database's rate counters reset or a fresh test database.

Next scope remains settings partial writes/version conflicts and profile policy; avatar/private-file services; email verification/password recovery/change; an administration/session-management UI; progressive numbered migrations; then catalogs, documents, transfers and shared synthetic tracking. No real patient data, uploaded medical documents or real ambulance locations were used or implemented in this slice.
