# ReHoster

> A self-hosted, browser-based deployment panel — a mini-PaaS that runs on a Linux/macOS server and lets you clone, build, run, and manage multiple containerised applications from a single web console.

<p align="center">
  <img src="src/public/media/Re-HosterLogo.png" alt="ReHoster Logo" width="120" />
</p>

---

> ⚠️ **Security Warning:** Admin access to this panel is equivalent to root access on the host. It can execute Docker commands, clone repositories, and run arbitrary workloads. Protect the admin credentials, use a strong `SESSION_SECRET`, and restrict network access to the panel port.

---

## Table of Contents

1. [What It Does](#what-it-does)
2. [Architecture](#architecture)
3. [Requirements](#requirements)
4. [Quick Start](#quick-start)
5. [Automated Installer](#automated-installer)
6. [Manual Installation](#manual-installation)
7. [Configuration](#configuration)
8. [Deploying Your First App](#deploying-your-first-app)
9. [Supported Languages & Frameworks](#supported-languages--frameworks)
10. [Auto-Generated Dockerfiles](#auto-generated-dockerfiles)
11. [Post-Container-Start Command](#post-container-start-command)
12. [File Browser](#file-browser)
13. [Upgrade & Update Checking](#upgrade--update-checking)
14. [How Ports Work](#how-ports-work)
15. [Running ReHoster in Docker](#running-rehoster-in-docker)
16. [Security Model](#security-model)
17. [Troubleshooting](#troubleshooting)
18. [Future Roadmap](#future-roadmap)
19. [Changelog](#changelog)

---

## What It Does

Managing apps on a VPS traditionally requires SSH, manual `git clone`, authoring Dockerfiles, and running `docker run` for each deployment. ReHoster automates all of that:

| Feature | Details |
|---|---|
| **Deploy from GitHub** | Paste a repo URL, choose a branch, hit Deploy. |
| **Auto-Dockerfile** | Generates a sensible Dockerfile if the repo doesn't have one — supports Node.js, Python, and static HTML. |
| **Lifecycle control** | Start / stop / restart / rebuild / pull+redeploy from the dashboard. |
| **Environment variables** | Per-app env vars stored in the database and injected at container start. |
| **Logs** | Deployment logs (SQLite) + live container logs with search, filter, copy, and download. |
| **File browser** | Browse, view, edit, rename, copy/paste, upload, and download files inside managed app directories. |
| **Post-start command** | Run a command inside the container after it fully starts (e.g. database migrations). |
| **Groups & tags** | Organise apps into colour-coded groups with optional tags. |
| **Self-upgrade** | Pull the latest panel version via the Upgrade page with automatic stash/unshallow/retry. |
| **Webhook deploys** | Trigger redeploys via a per-app webhook URL. |

---

## Architecture

```
[ Admin Browser UI ]
        ↓
[ Express Admin API  (default: port 3000) ]
        ↓
[ Service Layer ]
   ├── appService            — orchestrates the full deployment lifecycle
   ├── gitService            — clone / pull (via simple-git, with retry + stash)
   ├── dockerService         — build / run / stop / restart / remove / logs
   ├── frameworkDetectService — detect Node.js/Python/Ruby/Go/… language & framework
   ├── portService           — port allocation in a configurable range
   ├── logService            — per-app deployment logs in SQLite
   ├── authService           — bcrypt + sessions
   ├── updateService         — GitHub Releases API version check
   ├── healthService         — container health check polling
   ├── reverseProxyService   — placeholder for Nginx/Caddy routing
   └── schedulerService      — placeholder for cron / webhooks
        ↓
[ Linux / macOS Host ]
   ├── Git
   ├── Docker Engine
   ├── SQLite  (./data/hosting-panel.sqlite)
   └── managed-apps/
        ├── app-one/
        ├── app-two/
        └── app-three/
```

---

## Requirements

| Dependency | Minimum Version | Purpose |
|---|---|---|
| Node.js | 18 LTS (20+ recommended) | Runs the panel |
| npm | 8+ | Installs panel dependencies |
| Docker Engine | 24+ | Builds and runs managed apps |
| Git | 2.x | Clones and updates app repos |
| OS | Ubuntu 20.04+ / Debian 11+ / macOS 12+ | Host platform |
| RAM | 512 MB minimum, 1 GB+ recommended | Docker + panel |

> **Windows:** ReHoster is designed for Linux/macOS. On Windows, run it inside WSL 2 or the provided `docker-compose.yml`.

---

## Quick Start

```bash
git clone https://github.com/A13Xg/ReHoster.git
cd ReHoster
bash launcher.sh          # checks prereqs, generates .env, starts panel
```

The panel starts at **http://localhost:3000** — log in with the credentials set in `.env`.

---

## Automated Installer

The `installer.sh` script installs ReHoster to the recommended system location and optionally configures auto-start:

```bash
git clone https://github.com/A13Xg/ReHoster.git
cd ReHoster
bash installer.sh
```

The installer will:

1. Detect your OS (Linux or macOS).
2. Check for and install missing prerequisites (Node.js, npm, Git) via apt-get / dnf / Homebrew.
3. Copy files to `/opt/rehoster` (Linux root) or `~/.rehoster` (non-root / macOS).
4. Generate a `.env` file with a cryptographically random `SESSION_SECRET`.
5. Run `npm install` and `npm run db:init`.
6. Register a **systemd** service on Linux (`sudo systemctl start rehoster`) or a **launchd** agent on macOS.
7. Offer to delete the original cloned directory.

### Installer flags

| Flag | Description |
|---|---|
| `--install-dir /path` | Override the default install location. |
| `--no-service` | Skip service registration (manual start only). |
| `--no-cleanup` | Skip the prompt to delete the original clone. |

---

## Manual Installation

### 1. Install system dependencies

**Ubuntu / Debian**
```bash
sudo apt update
sudo apt install -y docker.io git
sudo usermod -aG docker $USER   # log out and back in (or run: newgrp docker)
# Node.js 20 LTS via NodeSource:
curl -fsSL https://deb.nodesource.com/setup_lts.x | sudo -E bash -
sudo apt install -y nodejs
```

**macOS**
```bash
brew install node git
# Install Docker Desktop from https://www.docker.com/products/docker-desktop
```

### 2. Clone and install

```bash
git clone https://github.com/A13Xg/ReHoster.git
cd ReHoster
npm install
```

### 3. Configure environment

```bash
cp .env.example .env
# Edit .env — set SESSION_SECRET and ADMIN_PASSWORD at minimum
nano .env
```

### 4. Initialise database

```bash
npm run db:init
```

### 5. Start

```bash
bash launch.sh      # bootstrap + launch (recommended)
# or:
npm start           # production
npm run dev         # development (nodemon auto-restart)
```

---

## Configuration

All configuration is read from environment variables (`.env` file):

| Variable | Default | Description |
|---|---|---|
| `NODE_ENV` | `development` | Set to `production` in production |
| `PORT` | `3000` | Port the panel listens on |
| `SESSION_SECRET` | — | **Required** — long random string for signing sessions |
| `ADMIN_USERNAME` | `Admin` | Initial admin username |
| `ADMIN_PASSWORD` | `ReHostPassword` | **Change before first use** |
| `DATABASE_PATH` | `./data/hosting-panel.sqlite` | SQLite file path |
| `MANAGED_APPS_DIR` | `./managed-apps` | Directory where repos are cloned |
| `APP_PORT_START` | `4000` | Start of auto-assignable port range |
| `APP_PORT_END` | `4999` | End of auto-assignable port range |
| `BASE_HOST` | `http://localhost` | Base URL shown in the dashboard |
| `DEFAULT_CONTAINER_PORT` | `3000` | Default port inside the container |
| `DOCKER_RESTART_POLICY` | `unless-stopped` | Docker restart policy applied to all containers |
| `LOCALE` | `en-US` | Panel locale for date/time formatting |
| `TIMEZONE` | `UTC` | Panel timezone |

---

## Deploying Your First App

1. Open **http://localhost:3000** and log in.
2. Click **🚀 Deploy New** in the sidebar.
3. Fill in:
   - **App Name** — e.g. `my-api`
   - **Repository URL** — e.g. `https://github.com/username/my-node-app`
   - **Branch** — default `main`
   - **Service Type** — `Auto-detect` (recommended), `Node.js`, or `Static/HTML`
   - **Build Command** / **Start Command** — sensible defaults are pre-filled
   - **Post-Start Command** *(optional)* — shell command to run inside the container after it starts (e.g. `python manage.py migrate`)
   - **Environment Variables** — one `KEY=value` per line
   - **Internal Container Port** — the port your app binds to inside the container
4. Click **🚀 Deploy App**.

The panel will:
- Clone the repository.
- Run framework detection to choose the right Dockerfile strategy.
- Generate a Dockerfile if the repo doesn't have one.
- Build the Docker image.
- Start the container with the port mapped from the host range.
- Run the post-start command (if set) once the container is confirmed running.

---

## Supported Languages & Frameworks

ReHoster auto-detects the primary language and framework at deploy time:

| Language | Detection | Auto-Dockerfile |
|---|---|---|
| Node.js | `package.json` | ✅ (npm / yarn / pnpm) |
| Python | `requirements.txt`, `pyproject.toml`, `Pipfile`, `manage.py`, `setup.py` | ✅ (`python:3.11-slim` + venv + gunicorn) |
| Ruby | `Gemfile` | ⚠️ Detected, BYO Dockerfile |
| PHP | `composer.json` | ⚠️ Detected, BYO Dockerfile |
| Go | `go.mod` | ⚠️ Detected, BYO Dockerfile |
| Rust | `Cargo.toml` | ⚠️ Detected, BYO Dockerfile |
| Java | `pom.xml`, `build.gradle` | ⚠️ Detected, BYO Dockerfile |
| Static/HTML | All other | ✅ (nginx) |

**Detected Node.js frameworks:** Next.js, Nuxt, Gatsby, Remix, React, Vue, Angular, Svelte, SvelteKit, Vite, Astro, Qwik, Fastify, Express, Hapi, NestJS, Koa, Strapi.

**Detected Python frameworks:** Django, Flask, FastAPI, Tornado, aiohttp, Starlette, Pyramid, Sanic, Streamlit, Gradio.

---

## Auto-Generated Dockerfiles

When a repository has no `Dockerfile`, ReHoster generates one automatically.

### Node.js (default)
```dockerfile
FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm install --omit=dev
COPY . .
RUN npm run build || true
ENV PORT=3000
EXPOSE 3000
CMD ["npm", "start"]
```

### Python
```dockerfile
FROM python:3.11-slim
RUN groupadd -r appuser && useradd -r -g appuser appuser
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends gcc g++ libpq-dev libffi-dev curl git ...
RUN python -m venv /opt/venv
ENV VIRTUAL_ENV=/opt/venv PATH="/opt/venv/bin:$PATH" PYTHONUNBUFFERED=1
COPY requirements*.txt ./
RUN /opt/venv/bin/pip install --no-cache-dir -r requirements.txt
RUN /opt/venv/bin/pip install --no-cache-dir gunicorn uvicorn[standard] || true
COPY --chown=appuser:appuser . .
USER appuser
CMD ["sh", "-c", "gunicorn app:app --bind 0.0.0.0:8000 --workers 2 --timeout 120"]
```

### Static / HTML (nginx)
```dockerfile
FROM nginx:alpine
COPY . /usr/share/nginx/html
EXPOSE 80
```

ReHoster only writes a Dockerfile if one does not already exist, or if the existing one was previously generated by ReHoster (identified by a marker comment).

---

## Post-Container-Start Command

The **Post-Start Command** field lets you specify a shell command that runs *inside* the container after it is confirmed running:

- ReHoster waits up to **30 seconds** for the container to enter the `running` state.
- The command is executed via `docker exec <container> sh -c "<command>"`.
- Output and errors are written to the app's deployment log.
- Useful for: database migrations (`python manage.py migrate`), seed scripts, cache warming, etc.

Example values:
```
python manage.py migrate
node scripts/seed.js
./bin/wait-for-it db:5432 -- echo "db ready"
```

---

## File Browser

Each app has a built-in file browser at `/admin/apps/:id/files`.

| Operation | How |
|---|---|
| **Browse** | Click directories to navigate; breadcrumb trail for orientation |
| **View / Edit** | Click a text file; edit in-browser; Save |
| **Download** | Download button or context menu → Download |
| **Upload** | ⬆ Upload button → select one or more files from your computer |
| **Rename** | Context menu (right-click) → Rename |
| **Copy / Paste** | Context menu → Copy, then Paste in target directory |
| **New file/folder** | + New File / + New Folder buttons |
| **Delete** | Context menu → Delete |

> Editable files: all text-based formats up to 50 MB. Binary files (images, archives, etc.) can be downloaded but not edited in-browser.

---

## Upgrade & Update Checking

Navigate to **🔄 Upgrade** in the sidebar.

**Check for updates** — fetches the latest commit from `origin/<branch>` and compares it to the local HEAD SHA. Handles:
- Shallow clones (automatically runs `--unshallow` if needed).
- Network failures (retries up to 2 times with back-off).
- Dirty working trees (stashes changes, pulls, pops stash).
- Detached HEAD (checks out the named branch first).

**Apply Upgrade** — runs `git pull` followed by `npm install --prefer-offline`. The UI shows a step table with per-step OK/warning/error status. A server restart is required after upgrading.

> If the panel was **not** installed via `git clone` (e.g. downloaded as a zip), upgrade is unavailable. Download the latest release from [GitHub Releases](https://github.com/A13Xg/ReHoster/releases).

---

## How Ports Work

- Port range defaults to `4000–4999` (configurable via `APP_PORT_START` / `APP_PORT_END`).
- Each app gets a unique host port from this range, automatically assigned.
- You can override with a specific port on the deploy form; the panel rejects conflicts.
- Ports are stored in SQLite and shown in the dashboard.
- The app is accessible at `http://YOUR_SERVER_IP:ASSIGNED_PORT`.

---

## Running ReHoster in Docker

A `docker-compose.yml` is provided to run the panel itself in a container:

```bash
docker compose up -d
```

The compose file mounts the Docker socket (`/var/run/docker.sock`) so the panel can manage sibling containers (Docker-outside-Docker pattern).

> ⚠️ Mounting the Docker socket grants the container root-equivalent access to the host. Only use this in trusted, controlled environments.

---

## Security Model

| Mechanism | Details |
|---|---|
| Authentication | Session-based; bcrypt-hashed passwords (cost 12) |
| Session signing | `SESSION_SECRET` from environment |
| CSRF protection | Synchronizer token in session, validated from `req.body._csrf` or `x-csrf-token` header |
| Rate limiting | 20 requests / 15 min on the login endpoint |
| Path traversal | `safeJoin()` utility rejects any path outside the app's `local_path` |
| Docker command injection | `execFile`/`spawn` used — user input is never concatenated into shell strings |
| App name sanitisation | Names reduced to `[a-z0-9-]` before use in paths and container names |
| Git operations | `simple-git` used — no shell string interpolation |
| `.env` protection | `.gitignore`d and never served via HTTP |

---

## Troubleshooting

### Docker permission denied
```bash
sudo usermod -aG docker $USER
# Then log out and back in, or run:
newgrp docker
```

### Port already in use
Check which process is using the port:
```bash
ss -tlnp | grep :3000
```
Change `PORT` in `.env` and restart.

### Container stuck in "building"
Check the deployment logs on the app detail page. Common causes:
- `npm install` failing (private registry, missing package).
- Build script error (check `RUN npm run build || true` output).
- Docker build context too large (add a `.dockerignore`).

### Git update check fails
```
Git update check failed: unable to connect to github.com
```
Verify network access from the server. The panel retries twice with back-off before giving up.

### Python app not starting
- Verify your `requirements.txt` is at the repo root.
- Check the container logs for the actual error: deployment logs tab → Container Runtime Logs.
- Try specifying an explicit **Start Command** (e.g. `gunicorn myapp.wsgi:application --bind 0.0.0.0:8000`).

---

## Future Roadmap

- **Reverse proxy** — automatic Nginx/Caddy routing with subdomains and HTTPS.
- **Scheduler** — cron-based health checks and restart schedules.
- **GitHub webhooks** — auto-deploy on `git push`.
- **Multi-user support** — role-based access control.
- **Metrics** — per-container CPU / memory graphs.
- **Go / Rust / Ruby auto-Dockerfiles** — extend beyond Node.js and Python.
- **Windows WSL 2 installer** — native Windows support via WSL.

---

## Changelog

See [CHANGELOG.md](CHANGELOG.md) for a full history of changes.

---

## License

MIT — see `LICENSE` file (if present) or the repository root.
