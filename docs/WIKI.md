# ReHoster — Wiki

Welcome to the ReHoster documentation wiki. Each section below covers a specific area of the system in depth.

---

## Contents

1. [Installation Deep-Dive](#1-installation-deep-dive)
2. [Environment Variables Reference](#2-environment-variables-reference)
3. [Deployment Pipeline](#3-deployment-pipeline)
4. [Framework & Language Detection](#4-framework--language-detection)
5. [Auto-Generated Dockerfiles](#5-auto-generated-dockerfiles)
6. [Post-Container-Start Commands](#6-post-container-start-commands)
7. [Git Service — Update Checking & Upgrading](#7-git-service--update-checking--upgrading)
8. [Port Allocation](#8-port-allocation)
9. [Log System](#9-log-system)
10. [File Browser](#10-file-browser)
11. [App Lifecycle Reference](#11-app-lifecycle-reference)
12. [Groups & Tags](#12-groups--tags)
13. [Health Checks](#13-health-checks)
14. [Webhooks](#14-webhooks)
15. [CSRF Protection](#15-csrf-protection)
16. [Authentication & Sessions](#16-authentication--sessions)
17. [Database Schema](#17-database-schema)
18. [API Reference (Internal)](#18-api-reference-internal)
19. [Running Behind a Reverse Proxy](#19-running-behind-a-reverse-proxy)
20. [Security Hardening Checklist](#20-security-hardening-checklist)
21. [Troubleshooting Runbook](#21-troubleshooting-runbook)
22. [Contributing](#22-contributing)

---

## 1. Installation Deep-Dive

### 1.1 Automated Installer (`installer.sh`)

`installer.sh` provides a fully guided installation experience for Linux and macOS. Run it immediately after cloning:

```bash
git clone https://github.com/A13Xg/ReHoster.git
cd ReHoster
bash installer.sh
```

**What it does, step by step:**

| Step | Action |
|---|---|
| 1 | Detects OS (Linux / macOS) and architecture |
| 2 | Checks for Node.js ≥ 18; installs via NodeSource/dnf/Homebrew if missing |
| 3 | Checks for npm; errors if missing (Node.js reinstall needed) |
| 4 | Checks for Git; installs via apt-get/dnf/Homebrew if missing |
| 5 | Checks Docker daemon; warns with install instructions if unavailable |
| 6 | Copies files to `/opt/rehoster` (Linux root) or `~/.rehoster` (non-root/macOS) |
| 7 | Generates `.env` with random `SESSION_SECRET` via Node.js `crypto` |
| 8 | Runs `npm install --prefer-offline` |
| 9 | Runs `npm run db:init` to create the SQLite schema and admin user |
| 10 | Registers `systemd` (Linux) or `launchd` (macOS) service |
| 11 | Prompts to delete the original clone |

**Flags:**

```bash
bash installer.sh --install-dir /srv/rehoster   # custom install path
bash installer.sh --no-service                  # skip service registration
bash installer.sh --no-cleanup                  # don't ask to delete clone
```

### 1.2 Bootstrap Launcher (`launch.sh`)

`launch.sh` is a lighter-weight script that checks prerequisites and starts the server. It does **not** copy files to a new location. Use it for:
- Starting ReHoster manually after the installer ran.
- Development runs from the cloned repo.

```bash
bash launch.sh
```

`launch.sh` performs:
1. Node.js version check (≥ 20 preferred, ≥ 18 minimum).
2. npm availability check.
3. `.env` generation if missing.
4. `npm install --prefer-offline` (offline first for speed, falls back to network).
5. Directory creation (`data/`, `logs/`, `managed-apps/`).
6. Write-access checks on all three directories.
7. Git availability check (warns if missing).
8. Docker daemon check with automatic recovery attempt (tries `systemctl start docker` / `service docker start`).
9. Panel port conflict detection (`ss` or `netstat`).
10. `exec node src/server.js`.

### 1.3 Windows (WSL 2)

ReHoster is designed for Linux/macOS. On Windows:

```powershell
# Install prerequisites first:
.\install-prereqs.ps1

# Then launch in WSL 2 (recommended):
wsl bash ./launch.sh

# Or use Docker Compose (runs the panel inside a Linux container):
docker compose up -d
```

### 1.4 Production systemd Service

After `installer.sh` registers the service:

```bash
sudo systemctl status rehoster     # check status
sudo systemctl start rehoster      # start
sudo systemctl stop rehoster       # stop
sudo systemctl restart rehoster    # restart
journalctl -u rehoster -f          # tail logs
```

The service file is at `/etc/systemd/system/rehoster.service`. After editing, run `sudo systemctl daemon-reload`.

---

## 2. Environment Variables Reference

All variables read from `.env` (or real environment variables):

| Variable | Type | Default | Notes |
|---|---|---|---|
| `NODE_ENV` | string | `development` | Set `production` in production — enables secure cookies, disables stack traces in error pages |
| `PORT` | integer | `3000` | Panel listening port |
| `SESSION_SECRET` | string | — | **Required.** Min 32 random characters. Used to sign session cookies with `express-session` |
| `ADMIN_USERNAME` | string | `Admin` | Username for the initial admin user seeded at `db:init` |
| `ADMIN_PASSWORD` | string | `ReHostPassword` | **Change immediately.** Seeded only if the user does not exist yet |
| `DATABASE_PATH` | string | `./data/hosting-panel.sqlite` | Absolute or relative path to SQLite file |
| `MANAGED_APPS_DIR` | string | `./managed-apps` | Root directory under which repos are cloned (`<dir>/<safe-name>/`) |
| `APP_PORT_START` | integer | `4000` | Inclusive lower bound of the auto-assignable host port range |
| `APP_PORT_END` | integer | `4999` | Inclusive upper bound of the auto-assignable host port range |
| `BASE_HOST` | URL | `http://localhost` | Base URL used to construct webhook URLs |
| `DEFAULT_CONTAINER_PORT` | integer | `3000` | Container-internal port used when none is specified |
| `DOCKER_RESTART_POLICY` | string | `unless-stopped` | Docker `--restart` value applied to every managed container |
| `LOCALE` | string | `en-US` | BCP 47 locale for `Intl.DateTimeFormat` in the UI |
| `TIMEZONE` | string | `UTC` | IANA timezone for date display |
| `DOCKER_CMD` | string | — | Override the Docker CLI path (auto-detected otherwise) |

---

## 3. Deployment Pipeline

When you click **Deploy**, ReHoster executes the following steps sequentially. Any step failure stops the pipeline and marks the app `failed`.

```
createApp  →  deployApp
                ├─ 1. Clone repository         (gitService.cloneRepo)
                ├─ 2. Detect frameworks        (frameworkDetectService.detectFrameworks)
                ├─ 3. Log dependency preflight (appService.logDependencyPreflight)
                ├─ 4. Generate Dockerfile      (dockerService.generateDockerfile)
                ├─ 5. Build Docker image       (dockerService.buildImage)
                ├─ 6. Stop old container       (if exists)
                ├─ 7. Remove old container     (if exists)
                ├─ 8. Run new container        (dockerService.runContainer)
                ├─ 9. Update status → running  (db)
                ├─ 10. Health check            (healthService.checkAppHealth)
                └─ 11. Post-start command      (docker exec, async, fire-and-forget)
```

**Redeploy** (pull + rebuild) follows the same pipeline from step 1, using `gitService.pullLatest()` instead of `cloneRepo`.

---

## 4. Framework & Language Detection

The `frameworkDetectService.detectFrameworks(appPath)` function analyses the repository root to determine the primary language and framework(s).

### Primary Language Detection (`detectPrimaryLanguage`)

Checks for indicator files in order:

| File | Language |
|---|---|
| `package.json` | Node.js |
| `requirements.txt`, `pyproject.toml`, `Pipfile`, `manage.py`, `setup.py` | Python |
| `Gemfile` | Ruby |
| `composer.json` | PHP |
| `go.mod` | Go |
| `Cargo.toml` | Rust |
| `pom.xml`, `build.gradle` | Java |
| *(none of the above)* | Static/HTML |

### Node.js Framework Detection

`package.json` → combined `dependencies + devDependencies`:

| Package | Framework |
|---|---|
| `next` | Next.js |
| `nuxt` | Nuxt |
| `gatsby` | Gatsby |
| `remix` / `@remix-run/*` | Remix |
| `react` | React |
| `vue` | Vue.js |
| `@angular/core` | Angular |
| `svelte` | Svelte |
| `@sveltejs/kit` | SvelteKit |
| `vite` | Vite |
| `astro` | Astro |
| `@builder.io/qwik` | Qwik |
| `fastify` | Fastify |
| `express` | Express |
| `@hapi/hapi` | Hapi |
| `@nestjs/core` | NestJS |
| `koa` | Koa |
| `strapi` / `@strapi/strapi` | Strapi |

### Python Framework Detection

Reads `requirements.txt`, `pyproject.toml`, `Pipfile`, and `requirements-dev.txt` (case-insensitive substring match):

| Module name | Framework |
|---|---|
| `django` | Django |
| `flask` | Flask |
| `fastapi` | FastAPI |
| `tornado` | Tornado |
| `aiohttp` | aiohttp |
| `starlette` | Starlette |
| `pyramid` | Pyramid |
| `sanic` | Sanic |
| `streamlit` | Streamlit |
| `gradio` | Gradio |

### Return Value

`detectFrameworks()` returns an array of framework objects, e.g.:

```json
[
  { "key": "fastapi", "label": "FastAPI", "color": "#009688", "language": "python" },
  { "key": "starlette", "label": "Starlette", "color": "#009688" }
]
```

The first element's `language` field is the primary language used by `dockerService` to choose the Dockerfile strategy.

---

## 5. Auto-Generated Dockerfiles

ReHoster writes a Dockerfile only when:
1. The repository has no `Dockerfile`, **or**
2. The existing `Dockerfile` contains the marker `# Generated by ReHoster` (safe to overwrite).

### Node.js Dockerfile

Key logic in `dockerService.js`:

- **Package manager detection:** if `pnpm-lock.yaml` → pnpm; if `yarn.lock` → yarn; otherwise npm.
- **Build script detection:** if `package.json` has a `build` script, include `RUN <buildCmd>`.
- **Static vs. Node:** if service type is `static` or a static-SPA framework (React, Vue, etc. without a server framework), use multi-stage nginx build.
- **Python dev dependencies:** if `requirements.txt` exists alongside `package.json`, a `pip install -r requirements.txt` line is added (for hybrid repos).

### Python Dockerfile

Generated by `dockerService.buildPythonDockerfile()`:

1. `python:3.11-slim` base.
2. Non-root `appuser` for container security.
3. System packages: `gcc`, `g++`, `libpq-dev`, `libffi-dev`, `curl`, `git`.
4. Virtual environment at `/opt/venv`.
5. Dependency install strategy by manifest:
   - `requirements.txt` → `pip install -r requirements.txt`
   - `pyproject.toml` with `poetry.lock` → install Poetry, run `poetry install --only main`
   - `pyproject.toml` without lock → `pip install .`
   - `Pipfile` → install pipenv, run `pipenv install --system --deploy`
6. `gunicorn` + `uvicorn[standard]` installed for the default start command.
7. Non-root user at runtime.

### Static Dockerfile

Pure HTML/CSS/JS with no build step → nginx:alpine COPY only.

Static site with `package.json` → multi-stage: Node build → nginx serve.

---

## 6. Post-Container-Start Commands

The **Post-Start Command** field (`post_start_command`) allows you to specify a command that runs *inside* the container after it is confirmed running.

### Execution Flow

```
deployApp()
    └─ runContainer()  [container started]
    └─ status → 'running'  [DB updated]
    └─ (async, non-blocking) →
           waitForContainerRunning(containerName, 30_000)
               └─ polls docker inspect every 1.5 s
           docker exec <container> sh -c "<post_start_command>"
               └─ success: log 'info'
               └─ failure: log 'warn' (non-fatal)
```

Key points:
- The command is **fire-and-forget** — it does not block the deployment or affect the `running` status.
- Failure of the post-start command does **not** mark the app `failed`.
- Maximum wait for container readiness: **30 seconds**.
- Command timeout: **60 seconds**.
- Output (stdout/stderr, up to 500 chars) is written to the deployment log.

### Examples

| Use case | Command |
|---|---|
| Django migrations | `python manage.py migrate` |
| Database seed | `node scripts/seed.js` |
| Wait for dependency | `./wait-for-it.sh db:5432 -- echo ready` |
| Cache warm-up | `curl -s http://localhost:8000/api/warm` |
| Create superuser (Django) | `python manage.py createsuperuser --no-input` |

---

## 7. Git Service — Update Checking & Upgrading

`gitService.js` is the core of all git operations. All functions are async and return Promises.

### `cloneRepo(repoUrl, branch, targetPath, [options])`

- Validates `repoUrl` format (GitHub HTTPS or SSH).
- Uses `--depth 1` for fast shallow clone.
- Supports `options.onProgress` callback for streaming progress.

### `fetchLatest(targetPath, branch)`

- If `/.git/shallow` exists, runs `git fetch --unshallow origin <branch>` first.
- Retries up to 2 times on transient network errors with exponential back-off.
- Falls back to normal fetch if unshallow fails (already-complete repos return a non-fatal error from Git).

### `hasRemoteChanges(targetPath, branch)`

- Calls `fetchLatest()`.
- Compares `git rev-parse HEAD` vs `git rev-parse origin/<branch>`.
- Returns `{ changed: boolean, local: string, remote: string }`.

### `pullLatest(targetPath, branch, [options])`

The most complex function. Full sequence:

```
1. isShallowRepo?  → git fetch --unshallow origin  (best-effort)
2. isDetachedHead? → git checkout <branch>
                     (or git checkout -b <branch> origin/<branch> if local doesn't exist)
3. hasUncommittedChanges? → git stash push -u -m rehoster-auto-stash
4. git pull origin <branch> --ff-only
     (on "Not possible to fast-forward" → retry without --ff-only)
     (on transient network error → retry up to MAX_RETRIES=2)
5. stashed? → git stash pop
6. if lastErr → throw
```

### Upgrade Route (`POST /admin/upgrade/apply`)

```
1. getCurrentBranch() or fallback to 'main'
2. pullLatest(REPO_ROOT, branch)
3. npm install --prefer-offline (cwd: REPO_ROOT)
4. render upgrade.ejs with step table
```

---

## 8. Port Allocation

`portService.js` manages host-side port assignments.

- Range: `APP_PORT_START` to `APP_PORT_END` (default 4000–4999).
- On deploy, `assignPort(requestedPort)`:
  - If `requestedPort` is provided and not in use, assign it.
  - Otherwise, scan the range and return the first free port.
  - Ports already in the `apps` table are excluded.
  - Throws if the range is exhausted.
- Port is stored in the `apps.port` column and used in `docker run -p <port>:<containerPort>`.
- After app deletion, the port is freed (not tracked separately — absence from DB is "free").

---

## 9. Log System

### Deployment Logs

- Stored in `app_logs` table in SQLite.
- Three levels: `info`, `warn`, `error`.
- Written by `logService.addLog(appId, level, message)`.
- Fetched by `logService.getLogsForApp(appId, [limit])` (default 500).
- Incremental polling: `GET /admin/apps/:id/logs/data?since=<lastLogId>` returns only new logs.

### Container Runtime Logs

- Fetched live from Docker: `docker logs --tail 200 --timestamps <containerName>`.
- ANSI escape codes are stripped in the browser before display.
- Polled every 3 s by the auto-refresh timer on the logs page.

### System Logs

- Written to `system_logs` table for panel-level events.
- Accessible from the panel's metrics/settings pages (upcoming feature).

### Log Viewer UI Features

| Feature | Description |
|---|---|
| **Search** | Real-time text filter on the visible log lines |
| **Level filters** | Toggle INFO / WARN / ERROR visibility independently |
| **Clear** | Clears the visible display (does not delete stored logs) |
| **Copy** | Copies all visible log text to clipboard |
| **Download** | Saves log text as `.txt` via Blob URL |
| **Auto-refresh** | Polls every 3 s; toggle with the ⟳ button |

---

## 10. File Browser

### Path Safety

All file operations validate paths using `safeJoin(baseDir, userPath)`:
- Resolves the joined path.
- Throws if the resolved path is not inside `baseDir`.
- Prevents path traversal attacks (e.g. `../../../etc/passwd`).

### Operations

| Operation | Route | Notes |
|---|---|---|
| List directory | `GET /admin/apps/:id/files?path=<rel>` | Returns `entries[]` with name, size, isDir, canEdit |
| Read file | `GET /admin/apps/:id/files/content?path=<rel>` | Text files ≤ 5 MB |
| Write file | `POST /admin/apps/:id/files/content` | `{ path, content }` |
| Download file | `GET /admin/apps/:id/files/download?path=<rel>` | Streams as attachment |
| **Upload file** | `POST /admin/apps/:id/files/upload` | `Content-Type: application/octet-stream`; `X-File-Name` header; `X-File-Path` header |
| Create file/dir | `POST /admin/apps/:id/files/create` | `{ type, parentPath, name }` |
| Rename | `POST /admin/apps/:id/files/rename` | `{ path, newName }` |
| Copy/Paste | `POST /admin/apps/:id/files/paste` | `{ sourcePath, destinationPath }` |
| Delete | `DELETE /admin/apps/:id/files/delete` | `{ path }` |

### Upload Protocol

The upload uses a non-multipart approach (no extra dependencies required):

```javascript
fetch('/admin/apps/:id/files/upload', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/octet-stream',
    'X-File-Name': file.name,           // filename to save
    'X-File-Path': currentRelPath,      // destination directory
    'X-CSRF-Token': getCsrfToken(),
  },
  body: file,  // File object from <input type="file">
});
```

Max upload size: 100 MB (configurable via `express.raw({ limit: '100mb' })`).

---

## 11. App Lifecycle Reference

| Status | Meaning |
|---|---|
| `creating` | Record inserted, deploy not started yet |
| `cloning` | `git clone` in progress |
| `building` | `docker build` in progress |
| `staging` | `docker run` about to start |
| `running` | Container is up |
| `stopped` | Container is stopped (intentional) |
| `failed` | Last operation failed |
| `missing` | Container was expected but `docker inspect` shows it doesn't exist |
| `restarting` | Restart in progress |

**Transitions:**

```
creating → cloning → building → staging → running
                                         ↓       ↑
                                       stopped ──┘
                                         ↓
                                       failed
                                         ↓
                                      (rebuild → cloning)
```

---

## 12. Groups & Tags

**Groups** provide colour-coded organisational buckets for apps:
- Created at `/admin/groups`.
- Each group has a name, description, and hex colour.
- An app can belong to at most one group.
- Displayed as a coloured dot on the apps list.
- Deleting a group does **not** delete its apps — `group_id` is set to `NULL`.

**Tags** are free-form comma-separated labels on each app:
- Stored as a plain string in `apps.tags`.
- Displayed as small badge pills on the app detail page.
- No filtering or grouping is done on tags in the current UI (future feature).

---

## 13. Health Checks

`healthService.js` performs HTTP-based health checks on running containers:

- Called automatically after deploy and start lifecycle actions.
- Makes a GET request to `http://localhost:<hostPort>/` (or `/health` if that path returns a 4xx).
- Timeout: 5 seconds.
- Updates `apps.health_status` (`healthy` / `unhealthy` / `unknown`) and `apps.last_health_check`.
- Shown in the dashboard as a coloured dot (green pulse = healthy, red = unhealthy).

> Health checks are best-effort. Failure to check does not change the container's `running` status.

---

## 14. Webhooks

Each app gets a unique webhook URL:

```
http://YOUR_PANEL:3000/api/webhooks/deploy/<appId>/<token>
```

- Sending a POST to this URL triggers a full redeploy (`git pull` + rebuild + restart).
- Token is a random 32-byte hex string stored in `apps.webhook_url`.
- Token can be regenerated from the app settings page.
- No authentication header is needed — the token itself serves as the secret.
- CSRF protection is not applied to webhook routes (they use the token as their secret).

---

## 15. CSRF Protection

ReHoster uses a **Synchronizer Token** pattern:

1. On session start, a random token is generated and stored in `req.session.csrfToken`.
2. The token is injected into every rendered page via `res.locals.csrfToken`.
3. The `csrfProtect` middleware (applied to all non-GET routes) validates the token from:
   - `req.body._csrf` (HTML forms — hidden `<input type="hidden" name="_csrf">`)
   - `req.headers['x-csrf-token']` (JavaScript fetch calls)
4. Webhook routes and the logs JSON endpoint are exempt.

Forms always include:
```html
<input type="hidden" name="_csrf" value="<%= csrfToken %>" />
```

JavaScript fetch calls include:
```javascript
headers: { 'X-CSRF-Token': getCsrfToken() }
```

where `getCsrfToken()` reads the `<meta name="csrf-token">` element set in `header.ejs`.

---

## 16. Authentication & Sessions

- **Login:** `POST /login` with `username` and `password` fields.
- Password verified with `bcrypt.compare()` (cost factor 12).
- Successful login sets `req.session.userId` and `req.session.username`.
- `requireAuth` middleware redirects unauthenticated requests to `/login`.
- Sessions stored in memory (express-session default). For production with multiple workers, use a Redis or SQLite session store.
- Session cookie is `HttpOnly` and `SameSite: lax`. In `NODE_ENV=production` with HTTPS, enable `secure: true` in the session config.
- Rate limiting: **20 requests per 15 minutes** per IP on `POST /login`.
- `force_password_change` flag in `admin_users`: if set, the user is redirected to change their password before accessing any admin page.

---

## 17. Database Schema

SQLite database at `DATABASE_PATH`. Opened in WAL mode for concurrency.

### Key Tables

**`apps`** — one row per managed application.

| Column | Type | Notes |
|---|---|---|
| `id` | INTEGER PK | Auto-increment |
| `name` | TEXT | Display name |
| `safe_name` | TEXT UNIQUE | Sanitised identifier (container/path name) |
| `repo_url` | TEXT | GitHub URL |
| `branch` | TEXT | Git branch |
| `local_path` | TEXT | Absolute path to cloned repo |
| `port` | INTEGER | Host-side port |
| `container_port` | INTEGER | Container-internal port |
| `container_name` | TEXT | Docker container name |
| `image_name` | TEXT | Docker image name |
| `build_command` | TEXT | Build command run in Dockerfile |
| `start_command` | TEXT | Container CMD |
| `post_start_command` | TEXT | Command run via `docker exec` after container starts |
| `env_vars` | TEXT | JSON object of env vars |
| `status` | TEXT | Lifecycle status (see §11) |
| `detected_frameworks` | TEXT | JSON array of framework objects |
| `health_status` | TEXT | `healthy` / `unhealthy` / `unknown` |
| `cpu_limit` | TEXT | Docker `--cpus` value |
| `memory_limit` | TEXT | Docker `--memory` value |
| `webhook_url` | TEXT | Full webhook URL |
| `group_id` | INTEGER FK | `groups.id` |

**`app_logs`** — deployment log entries.
**`settings`** — key/value panel configuration.
**`system_logs`** — panel-level event log.
**`system_metrics`** — periodic CPU/memory snapshots.
**`traffic_logs`** — per-request analytics.
**`groups`** — app groups.
**`admin_users`** — admin user accounts.

---

## 18. API Reference (Internal)

All routes require session authentication unless noted.

### Apps

| Method | Path | Description |
|---|---|---|
| GET | `/admin/apps` | List all apps |
| GET | `/admin/apps/new` | Deploy form |
| POST | `/admin/apps` | Create + deploy |
| GET | `/admin/apps/:id` | App detail |
| PATCH | `/admin/apps/:id` | Update app settings |
| DELETE | `/admin/apps/:id` | Delete app + container |
| POST | `/admin/apps/:id/start` | Start container |
| POST | `/admin/apps/:id/stop` | Stop container |
| POST | `/admin/apps/:id/restart` | Restart container |
| POST | `/admin/apps/:id/rebuild` | Pull + rebuild + restart |
| POST | `/admin/apps/:id/deploy` | Full redeploy |
| GET | `/admin/apps/:id/logs` | Logs page |
| GET | `/admin/apps/:id/logs/data` | JSON log data (incremental) |
| GET | `/admin/apps/:id/files` | File browser |
| GET | `/admin/apps/:id/files/content` | Read file |
| POST | `/admin/apps/:id/files/content` | Write file |
| GET | `/admin/apps/:id/files/download` | Download file |
| POST | `/admin/apps/:id/files/upload` | Upload file (binary, no CSRF form needed) |
| POST | `/admin/apps/:id/files/create` | Create file or folder |
| POST | `/admin/apps/:id/files/rename` | Rename |
| POST | `/admin/apps/:id/files/paste` | Copy/paste |
| DELETE | `/admin/apps/:id/files/delete` | Delete |

### System

| Method | Path | Description |
|---|---|---|
| GET | `/status` | Public status page |
| GET | `/admin/metrics` | System metrics |
| GET | `/admin/analytics` | Traffic analytics |
| GET | `/admin/settings` | Panel settings |
| POST | `/admin/settings` | Update settings |
| GET | `/admin/upgrade` | Upgrade page |
| POST | `/admin/upgrade/check` | Check for updates |
| POST | `/admin/upgrade/apply` | Apply upgrade |
| POST | `/api/webhooks/deploy/:id/:token` | Webhook deploy (no auth) |

---

## 19. Running Behind a Reverse Proxy

To use HTTPS and/or subdomain routing, place ReHoster behind Nginx or Caddy.

### Nginx Example

```nginx
server {
    listen 443 ssl;
    server_name panel.example.com;

    ssl_certificate /etc/letsencrypt/live/panel.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/panel.example.com/privkey.pem;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        # Needed for Server-Sent Events / WebSockets if added later:
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
    }
}
```

Set `trust proxy` in Express by adding `app.set('trust proxy', 1)` to `src/app.js` when running behind a proxy.

---

## 20. Security Hardening Checklist

- [ ] Change `ADMIN_PASSWORD` from the default before first use.
- [ ] Set a strong random `SESSION_SECRET` (32+ random bytes, hex encoded).
- [ ] Set `NODE_ENV=production`.
- [ ] Run the panel behind HTTPS (Nginx/Caddy + Let's Encrypt).
- [ ] Restrict panel port (3000) with a firewall — only allow from trusted IPs.
- [ ] Add `app.set('trust proxy', 1)` if behind a reverse proxy (for correct IP logging).
- [ ] Enable `secure: true` on the session cookie for HTTPS (`express-session` config).
- [ ] Rotate the admin password regularly.
- [ ] Review which GitHub repos are deployable — any deployed code runs on your server.
- [ ] Monitor `app_logs` and `system_logs` for unexpected `error` entries.
- [ ] Use `cpu_limit` and `memory_limit` on each app to prevent runaway containers.
- [ ] Keep Docker Engine updated to receive security patches.
- [ ] Keep Node.js and npm updated.
- [ ] Back up `./data/hosting-panel.sqlite` regularly.

---

## 21. Troubleshooting Runbook

### Panel won't start

1. Check Node.js version: `node --version` (needs ≥ 18).
2. Check `.env` exists and has `SESSION_SECRET` set.
3. Check `data/` is writable: `ls -la data/`.
4. Check logs: `journalctl -u rehoster -f` (systemd) or the `logs/launcher.log` file.

### Docker permission denied

```bash
sudo usermod -aG docker $USER
newgrp docker    # apply in current shell without logout
```

### Port conflict on panel start

```bash
ss -tlnp | grep ':3000'   # find what's using port 3000
# Change PORT in .env and restart
```

### App stuck in "building"

- Open the app detail page → Logs → Container Runtime Logs.
- Common causes: npm install failure, missing build script, out-of-disk-space.
- Try a manual build: `docker build -t test ./managed-apps/<safe-name>`.

### App marked "missing" after server restart

- The container was removed outside ReHoster. Click **Rebuild** to recreate it.

### Git update check says "unable to resolve host"

- The server cannot reach `github.com`. Check DNS: `nslookup github.com`.
- Check outbound port 443: `curl -v https://github.com/`.

### CSRF token error (403 on form submit)

- Clear browser cookies and log in again.
- Check the form has `<input type="hidden" name="_csrf" value="...">`.

### Post-start command not running

- Check deployment logs — look for "Running post-start command:" or error messages.
- The container must be fully `running` within 30 seconds.
- Verify the command works manually: `docker exec <container-name> sh -c "<your-command>"`.

---

## 22. Contributing

1. Fork the repository.
2. Create a feature branch: `git checkout -b feature/my-feature`.
3. Make your changes following the code style in existing files.
4. Run `npm run lint` (if configured) and `npm test`.
5. Commit with a descriptive message.
6. Push and open a Pull Request.

**Code conventions:**
- `'use strict'` at the top of every JS file.
- JSDoc comments on all exported functions (with `@param`, `@returns`, `@example`).
- Error handling: use `try/catch` around all async operations; log warnings rather than crashing for non-critical failures.
- No `eval()`, no shell string concatenation with user input.
- Use `execFile`/`spawn` from `child_process` (never `exec` with user-controlled strings).
