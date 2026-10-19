# XAMPP setup: hospital backend

Run commands from the project root. The inspected macOS installation is `/Applications/XAMPP/xamppfiles`, with PHP 8.0.28 and MariaDB 10.4.28. On Windows, use your XAMPP `php/php.exe` in place of the macOS PHP path. MySQL/MariaDB must be running; this project does not start the normal XAMPP services automatically.

Current workspace scope (19 October 2026): identity/account administration, settings, documents, transfers/simulated tracking, all six management catalogs and surveys are implemented, with migrations 001–011. Calendar/appointment management, reports, light theme and email recovery remain deferred. Patient appointment counts are read-only integration, not a scheduling workflow. Older slice notes in the architecture documents are historical; AGENTS.md and api-contracts.md record current behavior. Deployment copies must be updated explicitly.

## 1. Install the database and private configuration

Start XAMPP's MySQL service in its manager, then run:

```sh
cd /Users/snowy/Downloads/johnproject
/Applications/XAMPP/xamppfiles/bin/php backend/php/cli/setup.php
```

The command installs the current `db/sql/schema.sql` snapshot into the default `hospital` database, applies unrecorded numbered migrations through 011, creates a dedicated `hospital_app` SQL account with SELECT/INSERT/UPDATE/DELETE privileges, generates missing database password/application key values, verifies the application connection and writes `backend/php/config/local.php` privately when absent. It also prepares private users/documents/quarantine storage. The runtime account has no schema-management privileges. No application user is automatically created.

The setup connection defaults to local SQL `root` with an empty password, matching an unmodified local XAMPP installation. If yours differs, supply `HOSPITAL_SETUP_DB_USER` and `HOSPITAL_SETUP_DB_PASSWORD` through your environment. `HOSPITAL_DB_HOST`, `HOSPITAL_DB_PORT` or `HOSPITAL_DB_SOCKET` select the actual service; the default is TCP `127.0.0.1:3306`. A socket can be useful on macOS if root is restricted to local socket access; the installed XAMPP socket is normally `/Applications/XAMPP/xamppfiles/var/mysql/mysql.sock`.

`HOSPITAL_DB_NAME` and `HOSPITAL_DB_USER` can select a separate database/account before setup. Never use SQL root as the runtime user. An existing private config is preserved. Setup does not change the password of an existing SQL account; if an earlier installation already created that account, use its matching password or a different dedicated account. CREATE TABLE IF NOT EXISTS does not upgrade existing definitions; the migration runner performs those changes and records them in schema_migrations. Existing installations can run `backend/php/cli/migrate.php` with the same private configuration and administrative SQL environment. Back up the database, private storage and configuration/app_key before an upgrade; preserve the app_key so existing survey links remain retrievable.

The file `config/example.php` documents every setting. Do not copy its placeholder secrets unchanged. Environment values take precedence over `local.php`; `--no-config` is intended for environments supplying all configuration themselves. Never commit `local.php` or place it under `public/`.

## 2. Create the first administrator

Choose your own username/email and a fictional CI for local development:

```sh
/Applications/XAMPP/xamppfiles/bin/php backend/php/cli/users.php create-admin chosen_admin admin@hospital.example 10000001
```

The command prompts for a password of at least 12 characters, hides terminal input on supported terminals, creates and approves the first admin, and refuses to bootstrap another while an active administrator exists. For unattended disposable tests, the password can come from `HOSPITAL_ADMIN_PASSWORD` in the process environment. There is no default password.

Use the normal website registration screen for additional fictional staff. Registration alone creates pending accounts. Approve one using:

```sh
/Applications/XAMPP/xamppfiles/bin/php backend/php/cli/users.php pending
/Applications/XAMPP/xamppfiles/bin/php backend/php/cli/users.php approve chosen_staff staff
```

The approved account can then log in. Use `admin`, `records_manager`, `dispatcher` or `staff` deliberately when approving. The implemented Accounts screen also supports approval, explicit roles, disable/reactivate, session revocation and administrator password reset.

## 3. Launch immediately with XAMPP PHP

This uses XAMPP's PHP and SQL without changing Apache configuration:

```sh
/Applications/XAMPP/xamppfiles/bin/php -S 127.0.0.1:8080 -t public backend/php/dev-router.php
```

Open [the local login](http://127.0.0.1:8080/index.html). Keep the command running; Ctrl+C stops it. The router handles `/api/v1/`, static assets and protected HTML consistently. PHP's built-in server is for local development. Other generic static servers do not execute PHP or enforce the private-page guard.

## 4. Use XAMPP Apache when ready

`backend/apache/hospital.conf.example` is a complete virtual-host template to include in XAMPP's Apache configuration. Replace `/ABSOLUTE/PATH/johnproject` with the absolute deployment folder and adjust the port/hostname if needed. Ensure `mod_alias`, `mod_rewrite`, PHP handling and authorization modules are loaded. XAMPP's inspected defaults already load them. Validate with `httpd -t` before restarting Apache.

The important mapping is:

```text
DocumentRoot → project/public
/api/v1/     → project/backend/php/api/v1/ (Alias)
```

`public/.htaccess` routes private view HTML through the authenticated PHP page guard; only the isolated patient survey HTML has a public exception. The API Location block supplies JSON 404 errors for missing endpoints. Only the API entry directory is aliased, so bootstrap/config/SQL/CLI code cannot be downloaded. Test anonymous direct navigation to `/src/views/main-menu.html`: it must redirect to login. If it serves the page without authenticating, the configuration is incomplete.

The current `/Users/snowy/Downloads` directory is mode 0700, and `/Users/snowy` is 0750. XAMPP's default Apache worker runs as `daemon`, so it cannot traverse this checkout. Use the PHP development launch above, or place an Apache deployment in a directory the worker can traverse, such as a specifically prepared `/Users/Shared/hospital-project`. Give the worker read/traverse access only to the deployment and read access to its private configuration; keep configuration non-public (for example owner read/write, worker group read, mode 0640). Do not grant broad access to the home directory or use world-writable permissions. Apache/macOS privacy permissions can also restrict Downloads access.

Keep the deployment outside any other server's public document root. Copying the entire repository into a default publicly served `htdocs` folder could expose private files through that default host even if the new virtual host is configured correctly. Use `hospital.localhost` with the template after hostname resolution is configured locally if needed. This work did not modify global Apache or hosts files.

For a subdirectory mount, set `base_path` to `/hospital`, expose **both** `/hospital/` → `public/` and `/hospital/api/v1/` → `backend/php/api/v1/`, with the longer API Alias first. Prefix the ErrorDocument URL and Location block with `/hospital`. Keep the same public Directory/AllowOverride rules. The shared JS client derives its API base from its script location; cookie paths and redirects use `base_path`. This arrangement was verified with XAMPP Apache.

## Configuration and checks

| Setting | Default / effect |
| --- | --- |
| `base_path` / `HOSPITAL_BASE_PATH` | Empty at site root; `/hospital` for a mounted app |
| `secure_cookies` / `HOSPITAL_SECURE_COOKIES` | False for explicit local HTTP; set true when served through HTTPS |
| `session_idle_seconds` | 1800; passive polling does not extend this |
| `session_absolute_seconds` | 28800; activity cannot extend this |
| `bcrypt_cost` | 12; supported range 10–14 on the target PHP build |
| `app_key` | Random secret, at least 32 characters; keys rate-limit identifiers and survey access/submission tokens; preserve with backups |

After setup: log in as admin, register/approve another fictional staff account, log in with that account, save/reload settings and log out. Reopen a private URL and confirm it redirects. APIs must return JSON with proper pending/forbidden/validation statuses; interface errors remain console-only. Settings, private document uploads, transfers, catalogs and survey authoring/submission persist in SQL/private storage. Use the declared module permissions; admin alone does not grant clinical document or dispatch permissions. Run `backend/php/cli/preflight.php` to check migrations and ready file integrity; check storage access as the actual Apache worker. Missing deployed file bytes require a matching backup and cannot be recreated from SQL/source.

Feature verification uses disposable databases and temporary servers. It does not establish the state of a separate deployment: update that copy, apply its missing migrations and verify its storage/configuration explicitly. This workspace work does not change the separate XAMPP copy or normal hospital database.
