# Changelog

All notable changes to ReHoster are documented in this file.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).
Versioning follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [Unreleased]

### Added

#### Git Update Robustness
- `gitService.js`: Full rewrite of `pullLatest()` and `fetchLatest()` with comprehensive safety measures:
  - **Shallow clone support** — automatically runs `git fetch --unshallow` when a `.git/shallow` file is detected, so pull always has the full commit graph available.
  - **Dirty working tree handling** — automatically stashes uncommitted changes with `git stash push -u` before pulling and restores them with `git stash pop` afterwards, preventing conflicts.
  - **Detached HEAD recovery** — if HEAD is detached, the named branch is checked out before pull so fast-forward works correctly.
  - **Transient network retry** — fetch and pull operations are retried up to 2 times with exponential back-off on recognised network errors (DNS failure, connection reset, TLS timeout, etc.).
  - `hasRemoteChanges()` — new function that compares local HEAD SHA vs. `origin/<branch>` SHA after a safe fetch, returning detailed revision state.
  - `getCurrentBranch()` — returns the currently checked-out branch name, or `null` in detached HEAD state.
  - `getLatestCommitInfo()` — returns hash, date, message, and author for the current HEAD commit.
  - `isTransientGitError()` — helper to classify network-related git errors for retry decisions.
  - Full JSDoc comments with `@example` blocks on all exported functions.

#### Improved Upgrade Route (`upgradeRoutes.js`)
- `checkGitUpdates()` — new internal helper that uses the full `gitService` safety stack for reliable update detection even on shallow repos.
- `POST /admin/upgrade/apply` — now shows a step-by-step result table in the UI with per-step OK/warn/error status.
- Proper handling when the panel is not running from a git checkout (e.g. zip install).
- CSRF tokens added to both upgrade form buttons.
- Upgrade view now shows the current git branch and commit hash.

#### Upgrade UI (`upgrade.ejs`)
- Step table showing `git pull` and `npm install` results with colour-coded status (OK/Warning/Error).
- Shows current git branch and short commit hash in the panel version card.
- Link to GitHub Releases page for non-git installs.
- Up-to-date/Update-available badge next to the latest release version.

#### Python & Multi-language Framework Detection (`frameworkDetectService.js`)
- `detectPrimaryLanguage()` — detects Node.js, Python, Ruby, PHP, Go, Rust, Java, or static project by inspecting known indicator files (`package.json`, `requirements.txt`, `pyproject.toml`, `Pipfile`, `manage.py`, `Gemfile`, `go.mod`, etc.).
- Python framework detection: Django, Flask, FastAPI, Tornado, aiohttp, Starlette, Pyramid, Sanic, Streamlit, Gradio — detected from `requirements.txt`, `pyproject.toml`, or `Pipfile` content.
- Extended Node.js framework coverage: NestJS, Hapi, Koa, Strapi, SvelteKit, Astro, Qwik, Remix.
- `getPrimaryLanguage()` — convenience helper used by downstream services.
- All detection arrays documented with inline comments.

#### Python Dockerfile Generation (`dockerService.js`)
- `buildPythonDockerfile()` — generates a production-ready Dockerfile for pure Python applications:
  - Uses `python:3.11-slim` base image.
  - Creates non-root `appuser` for container security.
  - Installs common system packages (`gcc`, `libpq-dev`, `libffi-dev`, etc.) needed by compiled Python packages.
  - Creates an isolated `/opt/venv` virtual environment.
  - Detects dependency manifest format: `requirements.txt`, `pyproject.toml` (with optional Poetry), or `Pipfile` and installs accordingly.
  - Installs `gunicorn` + `uvicorn[standard]` as the default ASGI/WSGI server.
  - Falls back to user-supplied start command if provided.
- `generateDockerfile()` updated to detect Python projects and delegate to the new Python path when no `package.json` is present.
- `waitForContainerRunning()` — polls `docker inspect` until the container enters the `running` state or times out; used by the post-start command feature.
- Both new functions fully documented with JSDoc.

#### Post-Container-Start Command
- New `post_start_command TEXT` column in the `apps` table (schema + `init.js` migration).
- `deployApp()` in `appService.js`: after the container is deployed and marked `running`, an async background task waits up to 30 seconds for the container to be healthy, then executes the user-specified command via `docker exec`.  Success and failure are written to the app deployment log.
- `updateAppDetails()` in `appService.js`: persists `post_start_command` when app details are updated from the panel.
- `createApp()` in `appService.js`: stores `post_start_command` from the deploy form.
- **Deploy form (`new.ejs`)**: new "Post-Start Command" input field with helpful hint text.
- **App details form (`show.ejs`)**: new "Post-Start Command" editable field.
- **App detail view (`show.ejs`)**: displays post-start command in the detail list when set.

#### Enhanced Log Viewer (`logs.ejs` + `styles.css`)
- Search/filter bar on both deployment and container log panels with real-time text filtering.
- Level filter toggles (INFO / WARN / ERROR) for deployment logs.
- **Clear** button — wipes the visible log display without deleting stored logs.
- **Copy** button — copies all visible log text to the clipboard.
- **Download** button — saves log text as a `.txt` file via Blob URL.
- ANSI escape code stripping applied to docker container logs for clean display.
- Deployment log entries now include a `data-level` attribute enabling CSS and JS filtering.
- Max-height increased to 480 px (deploy) / 420 px (docker) with `scroll-behavior: smooth`.
- Docker log lines rendered with a distinct colour (`#a5b4fc`) for visual separation.
- CSS: `.log-search`, `.log-lvl-btn`, `.log-card-header`, `.log-toolbar`, `.docker-log-line` classes added.
- Auto-refresh button shows ON/OFF state via `btn-active` class.

#### File Upload (`appRoutes.js` + `files.ejs`)
- `POST /admin/apps/:id/files/upload` — accepts binary uploads via `express.raw()` with `application/octet-stream` content type; destination filename from `X-File-Name` header; destination directory from `X-File-Path` header.  Validates path safety via `safeJoin`.
- **Upload button** added to the file browser toolbar.
- Hidden `<input type="file" multiple>` element triggers uploads; JavaScript reads selected files and POSTs each one sequentially.
- Progress feedback: reload after all uploads complete; error messages for individual failures.

#### Cross-Platform Installer (`installer.sh`)
- Detects OS (Linux / macOS).
- Auto-installs Node.js (via NodeSource on Debian/Ubuntu, dnf on Fedora, Homebrew on macOS) if missing.
- Auto-installs Git if missing (apt-get / dnf / Homebrew).
- Warns about missing Docker with actionable install instructions.
- Copies repository to `/opt/rehoster` (root on Linux) or `~/.rehoster` (non-root / macOS), or a custom `--install-dir` path.
- Generates a `.env` with a cryptographically random `SESSION_SECRET` from Node.js `crypto`.
- Runs `npm install` and `npm run db:init`.
- Registers a `systemd` service on Linux with `Restart=on-failure`.
- Registers a `launchd` plist on macOS with `RunAtLoad=true` + `KeepAlive=true`.
- Prompts to delete the original clone after install.
- Supports `--no-service` and `--no-cleanup` flags for automation.

### Changed

- `frameworkDetectService.js`: `detectFrameworks()` now returns a `language` field on the first entry; downstream code can call `getPrimaryLanguage(frameworks)` to get the primary runtime without re-inspecting the filesystem.
- `dockerService.js`: `generateDockerfile()` no longer throws for Python projects without `package.json`; it generates a Python-appropriate Dockerfile instead.
- `upgradeRoutes.js`: removed unsafe `git fetch --dry-run` shell command; replaced with the full `gitService` stack.

### Fixed

- Upgrade page forms were missing CSRF tokens — added `_csrf` hidden inputs.
- `frameworkDetectService.js`: `detectedFrameworks` with an empty/undefined `devDependencies` no longer throws when spread.
- `dockerService.js`: `generateDockerfile()` no longer reads `detected_frameworks` twice from different code paths.
- Log viewer `lastDeployLogId` seeded correctly from server-rendered HTML on initial page load so incremental polling does not re-render already-seen entries.
- `appService.js`: `updateAppDetails()` now stores empty string as `''` rather than `null` for `buildCommand`/`startCommand`, preventing unexpected resets.

---

## [1.0.0] — Initial Release

### Added

- Express-based admin panel for deploying and managing Docker-containerised applications from GitHub repositories.
- App lifecycle management: create, deploy, start, stop, restart, rebuild, delete.
- Git-based deployment: clone on first deploy, pull-and-redeploy for updates.
- Auto-generated Dockerfiles for Node.js (npm/yarn/pnpm), static (nginx), and multi-stage builds.
- Automatic package manager detection: npm, yarn, pnpm.
- Framework detection: Next.js, Nuxt, Gatsby, React, Vue, Angular, Svelte, Vite, Fastify, Express.
- Per-app environment variable management (stored encrypted in SQLite).
- Port allocation service with configurable range and conflict detection.
- Deployment logs (SQLite) and live container logs (docker logs).
- File browser with view, edit, rename, copy/paste, create, download, and delete.
- App grouping with colour labels.
- Basic health check service.
- System metrics page.
- Analytics page.
- Webhook support for external deploy triggers.
- CSRF protection on all state-changing routes.
- Rate-limited login (20 req / 15 min).
- bcrypt password hashing (cost factor 12).
- Session-based authentication with signed cookies.
- SQLite database with WAL mode.
- `launch.sh` — bootstrap & launch script with prerequisite checks, env generation, and Docker recovery.
- `install-prereqs.sh` — system-level prerequisite installer (Linux).
- `install-prereqs.ps1` — prerequisite installer for Windows (PowerShell + winget).
- `docker-compose.yml` for running the panel itself inside Docker.
- Light / dark theme toggle.
- Upgrade page with GitHub release check.
