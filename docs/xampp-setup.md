# XAMPP setup: user system

Run commands from the project root. The inspected macOS installation is `/Applications/XAMPP/xamppfiles`, with PHP 8.0.28 and MariaDB 10.4.28. On Windows, use your XAMPP `php/php.exe` in place of the macOS PHP path. MySQL/MariaDB must be running; this project does not start the normal XAMPP services automatically.

## 1. Install the database and private configuration

Start XAMPP's MySQL service in its manager, then run:

```sh
cd /Users/snowy/Downloads/johnproject
/Applications/XAMPP/xamppfiles/bin/php backend/php/cli/setup.php
```

The command installs `db/sql/schema.sql` into the default `hospital` database, records schema 001, creates a dedicated `hospital_app` SQL account with SELECT/INSERT/UPDATE/DELETE privileges, generates a random database password/application key, verifies the application connection and writes `backend/php/config/local.php` privately. The runtime account has no schema-management privileges. No application user is automatically created.

The setup connection defaults to local SQL `root` with an empty password, matching an unmodified local XAMPP installation. If yours differs, supply `HOSPITAL_SETUP_DB_USER` and `HOSPITAL_SETUP_DB_PASSWORD` through your environment. `HOSPITAL_DB_HOST`, `HOSPITAL_DB_PORT` or `HOSPITAL_DB_SOCKET` select the actual service; the default is TCP `127.0.0.1:3306`. A socket can be useful on macOS if root is restricted to local socket access; the installed XAMPP socket is normally `/Applications/XAMPP/xamppfiles/var/mysql/mysql.sock`.

`HOSPITAL_DB_NAME` and `HOSPITAL_DB_USER` can select a separate database/account before setup. Never use SQL root as the runtime user. An existing private config is preserved. Setup does not change the password of an existing SQL account; if an earlier installation already created that account, use its matching password or a different dedicated account. This command installs a fresh schema and can safely repeat that initial DDL; it does not upgrade existing table definitions.

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

The approved account can then log in. Use `admin`, `records_manager`, `dispatcher` or `staff` deliberately when approving. A future screen can call the same admin APIs.

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

`public/.htaccess` routes private view HTML through the authenticated PHP page guard. The API Location block supplies JSON 404 errors for missing endpoints. Only the API entry directory is aliased, so bootstrap/config/SQL/CLI code cannot be downloaded. Test anonymous direct navigation to `/src/views/main-menu.html`: it must redirect to login. If it serves the page without authenticating, the configuration is incomplete.

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
| `app_key` | Random secret, at least 32 characters; used to key rate-limit identifiers |

After setup: log in as admin, register/approve another fictional staff account, log in with that account, reload, check settings name/email, and log out. Reopen a private URL and confirm it redirects. APIs must return JSON, with pending/forbidden/validation states clearly handled. Saved profile data and preferences exist; editing settings, recovery email delivery and document/transfer persistence remain later slices.

The implementation was verified using isolated XAMPP SQL/Apache instances, not your normal database service. You still need to perform steps 1–3 (or the Apache alternative) for your persistent local installation.
