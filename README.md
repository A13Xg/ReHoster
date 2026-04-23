# ReHoster

A self-hosted Node.js deployment control panel — a mini-PaaS / mini-Heroku-style admin portal that runs on a Linux VPS and lets you deploy and manage multiple Node.js websites from a single web console.

> ⚠️ **Security Warning:** Anyone with admin access to this panel effectively controls the server. The panel can execute Docker commands, clone code, and run arbitrary workloads. Keep the admin credentials secure, use a strong `SESSION_SECRET`, and restrict network access to the panel port.

---

## What Problem It Solves

Managing Node.js apps on a VPS typically requires SSH access, manual `git clone`, Dockerfile authoring, and `docker run` commands for every deployment. ReHoster automates all of that through a browser-based admin UI:

- Submit a GitHub repo URL
- The system clones, builds a Docker image, starts a container, and assigns a port — automatically
- Manage the entire lifecycle (start/stop/restart/rebuild/delete) from the dashboard
- View logs (both deployment logs and live Docker container logs)

---

## Architecture Overview

```
[ Admin Browser UI ]
        ↓
[ Express Admin API  (port 3000) ]
        ↓
[ Service Layer ]
   ├── appService        — orchestrates full deployment lifecycle
   ├── gitService        — clone / pull (via simple-git)
   ├── dockerService     — build image / run / stop / restart / remove / logs
   ├── portService       — port allocation in configurable range
   ├── logService        — per-app deployment logs in SQLite
   ├── authService       — bcrypt + sessions
   ├── reverseProxyService  — placeholder for Nginx/Caddy routing
   └── schedulerService     — placeholder for cron / webhooks
        ↓
[ Linux Host ]
   ├── Git
   ├── Docker Engine
   ├── SQLite database  (./data/hosting-panel.sqlite)
   └── managed-apps/
        ├── app-one/
        ├── app-two/
        └── app-three/
```

---

## Docker's Role

Every deployed app runs in its own Docker container:

- **Process isolation** — crashed app cannot affect others or the panel
- **Dependency isolation** — each app gets its own Node version and packages
- **Separate filesystem** — mounted from `managed-apps/{safe-name}/`
- **Port mapping** — host port assigned by portService, mapped to container port 3000
- **Lifecycle management** — start / stop / restart / rebuild via Docker CLI
- **Logs** — `docker logs` tailed on demand

If a cloned repository has no `Dockerfile`, ReHoster generates a sensible default:

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

---

## Linux VPS Requirements

- Ubuntu 20.04+ (or compatible Debian-based distro)
- Node.js 18+
- npm 8+
- Docker Engine 24+
- Git 2.x
- At least 1 GB RAM (more for multiple containers)

---

## Installation

### 1. Install system dependencies

```bash
sudo apt update
sudo apt install docker.io git nodejs npm -y
sudo usermod -aG docker $USER
```

> **Important:** Log out and back in (or run `newgrp docker`) after adding yourself to the `docker` group, so the group membership takes effect.

### 2. Clone and install

```bash
git clone https://github.com/A13Xg/ReHoster.git
cd ReHoster
npm install
```

### 3. Configure environment

```bash
cp .env.example .env
# Edit .env — at minimum change SESSION_SECRET, ADMIN_PASSWORD
nano .env
```

### 4. Initialise database

```bash
npm run db:init
```

This creates the SQLite schema and seeds the initial admin user from `ADMIN_USERNAME` / `ADMIN_PASSWORD` in your `.env`.

---

## Running

### Development (with auto-restart)

```bash
npm run dev
```

### Production

```bash
npm start
```

The panel is available at **http://localhost:3000** (or your VPS IP).

---

## Environment Variables

| Variable | Default | Description |
|---|---|---|
| `NODE_ENV` | `development` | Set to `production` for production |
| `PORT` | `3000` | Port the panel listens on |
| `SESSION_SECRET` | — | **Required** — long random string for signing sessions |
| `ADMIN_USERNAME` | `admin` | Initial admin username |
| `ADMIN_PASSWORD` | `change-me-immediately` | **Change this** |
| `DATABASE_PATH` | `./data/hosting-panel.sqlite` | SQLite file path |
| `MANAGED_APPS_DIR` | `./managed-apps` | Where repos are cloned |
| `APP_PORT_START` | `4000` | Start of assignable port range |
| `APP_PORT_END` | `4999` | End of assignable port range |
| `BASE_HOST` | `http://localhost` | Base URL shown in dashboard |
| `DEFAULT_CONTAINER_PORT` | `3000` | Internal container port |
| `DOCKER_RESTART_POLICY` | `unless-stopped` | Docker restart policy |

---

## Deploying Your First App

1. Open the panel at `http://localhost:3000` and log in
2. Click **Deploy New App**
3. Fill in:
   - **App Name** — e.g. `my-api`
   - **Repository URL** — e.g. `https://github.com/username/my-node-app`
   - **Branch** — default `main`
   - **Environment Variables** — one `KEY=value` per line (optional)
4. Click **🚀 Deploy App**
5. The panel clones the repo, builds a Docker image, and starts the container
6. The app is accessible at `http://YOUR_SERVER_IP:ASSIGNED_PORT`

---

## How Ports Work

- Port range defaults to `4000–4999` (configurable via env vars)
- Each app gets a unique host port from the range
- Ports already in the database are excluded from allocation
- You can request a specific port; if taken, an error is returned
- The assigned port is stored in SQLite and shown in the dashboard

---

## How Containers Work

- Container name: `rehoster-{safe-name}`
- Image name: `rehoster-img-{safe-name}`
- Containers are started with `--restart unless-stopped` by default
- `docker stop` / `docker start` / `docker restart` / `docker rm -f` are used for lifecycle
- Rebuild: stops old container, removes image, re-clones (or re-uses existing), rebuilds, restarts

---

## How Logs Work

Two layers of logs:

1. **Deployment logs** — stored in SQLite `app_logs` table; written during clone, build, start
2. **Container runtime logs** — fetched live from Docker via `docker logs --tail 200`

Both are shown on the **Logs** page for each app.

---

## Running the Panel in Docker (optional)

A `docker-compose.yml` is provided to run ReHoster itself in a container.  
The compose file mounts the Docker socket (`/var/run/docker.sock`) so the panel can manage sibling containers.

> ⚠️ Mounting the Docker socket grants the container root-equivalent access to the host. Only do this in a trusted, controlled environment.

```bash
docker compose up -d
```

---

## Troubleshooting Docker Permissions

If you see `permission denied while trying to connect to the Docker daemon socket`:

```bash
sudo usermod -aG docker $USER
# then log out and back in, OR:
newgrp docker
```

If running the panel inside Docker (via compose), the socket mount handles this automatically.

---

## Security Model

- All admin routes require session authentication (`requireAuth` middleware)
- Passwords hashed with bcrypt (cost factor 12)
- Sessions signed with `SESSION_SECRET` from environment
- CSRF tokens on all state-changing POST/DELETE routes
- Rate limiting on the login endpoint (20 req / 15 min)
- App names sanitised to safe identifiers before use in paths/container names
- `simple-git` used for Git operations (no shell string interpolation)
- Docker commands use `execFile`/`spawn` — user input is never concatenated into shell strings
- `MANAGED_APPS_DIR` is the only directory apps are cloned into; path traversal is rejected
- `.env` is in `.gitignore` and never served

---

## Future Roadmap

- **Reverse proxy** — automatic Nginx/Caddy routing with subdomains and HTTPS (placeholder in `reverseProxyService.js`)
- **Scheduler** — webhook-triggered deploys, cron-based health checks (placeholder in `schedulerService.js`)
- **Multi-user support** — role-based access control
- **Build hooks** — custom pre/post-build scripts
- **Metrics** — CPU/memory per container
- **GitHub webhooks** — auto-deploy on push
