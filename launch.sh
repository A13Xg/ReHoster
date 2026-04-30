#!/usr/bin/env bash
# ReHoster - Bootstrap & Launch
set -euo pipefail

# Change to the directory where this script lives
cd "$(dirname "$(realpath "$0" 2>/dev/null || readlink -f "$0" 2>/dev/null || echo "$0")")"

mkdir -p logs
LOG_FILE="logs/launcher.log"

# ── Colour helpers (disabled if not a TTY) ────────────────────────────────────
if [ -t 1 ]; then
    C_RESET='\033[0m'; C_GREEN='\033[0;32m'; C_YELLOW='\033[1;33m'; C_RED='\033[0;31m'; C_BOLD='\033[1m'
else
    C_RESET=''; C_GREEN=''; C_YELLOW=''; C_RED=''; C_BOLD=''
fi

info()    { echo -e "       ${C_GREEN}$*${C_RESET}"; }
warn()    { echo -e "       ${C_YELLOW}WARNING: $*${C_RESET}"; }
error()   { echo -e "\n  ${C_RED}ERROR: $*${C_RESET}\n" >&2; exit 1; }
heading() { echo -e "${C_BOLD}[$1/5] $2${C_RESET}"; }
log()     { printf '[%s] %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*" >> "$LOG_FILE"; }

echo ""
echo -e "${C_BOLD} =========================================="
echo -e "  ReHoster - Bootstrap & Launch"
echo -e " ==========================================${C_RESET}"
echo ""

INSTALLER_HINT='Run ./install-prereqs.sh to install prerequisites.'
INSTALLER_CMD='bash ./install-prereqs.sh'

log "Launcher started"

check_write_access() {
    local target="$1"
    local label="$2"
    local probe="${target}/.rehoster_write_test.tmp"
    if ! (echo probe > "$probe") 2>/dev/null; then
        echo ""
        error "Cannot write to ${label} at ${target}. Fix filesystem permissions and run launcher again."
    fi
    rm -f "$probe" >/dev/null 2>&1 || true
    log "Write access OK for ${label} at ${target}"
}

check_panel_port_conflict() {
    local panel_port=3000
    if [ -f ".env" ]; then
        local env_port
        env_port=$(grep -E '^PORT=' .env | tail -n 1 | cut -d'=' -f2- | tr -d '[:space:]') || true
        if [ -n "${env_port:-}" ]; then
            panel_port="$env_port"
        fi
    fi

    if command -v ss >/dev/null 2>&1; then
        if ss -ltn "( sport = :${panel_port} )" 2>/dev/null | grep -q LISTEN; then
            warn "Port ${panel_port} appears to already be in use. ReHoster may fail to start if another service is bound to this port."
            log "Panel port conflict detected on ${panel_port}"
            return
        fi
    elif command -v netstat >/dev/null 2>&1; then
        if netstat -ltn 2>/dev/null | grep -q ":${panel_port} "; then
            warn "Port ${panel_port} appears to already be in use. ReHoster may fail to start if another service is bound to this port."
            log "Panel port conflict detected on ${panel_port}"
            return
        fi
    fi

    info "Panel port ${panel_port} appears available."
    log "Panel port available: ${panel_port}"
}

recover_docker_daemon() {
    if docker info >/dev/null 2>&1; then
        return 0
    fi

    warn "Docker daemon is unreachable; attempting automatic recovery..."
    log "Attempting Docker daemon recovery"

    if command -v systemctl >/dev/null 2>&1; then
        if systemctl start docker >/dev/null 2>&1; then
            log "Started docker service via systemctl"
        elif command -v sudo >/dev/null 2>&1 && sudo -n true 2>/dev/null; then
            sudo systemctl start docker >/dev/null 2>&1 || true
            log "Attempted sudo systemctl start docker"
        else
            log "systemctl start docker not permitted without sudo password"
        fi
    elif command -v service >/dev/null 2>&1; then
        service docker start >/dev/null 2>&1 || true
        log "Attempted service docker start"
    fi

    for _ in $(seq 1 45); do
        if docker info >/dev/null 2>&1; then
            info "Docker daemon became reachable."
            log "Docker daemon reachable after recovery attempt"
            return 0
        fi
        sleep 1
    done

    log "Docker daemon recovery timed out"
    return 1
}

run_installer() {
    echo ""
    echo "       Launching prerequisite installer..."
    log "Launching prerequisite installer"
    ${INSTALLER_CMD}
    echo ""
    echo "       Re-checking prerequisites after installer..."
    log "Prerequisite installer completed; re-checking prerequisites"
}

prompt_install() {
    local component="$1"
    local reason="$2"
    echo ""
    echo "       ${component} is missing or not ready."
    echo "       ${reason}"
    echo "       ReHoster can try to install or repair this now."
    read -r -p "       Run installer now? [y/N]: " reply
    case "$reply" in
        y|Y|yes|YES)
            log "Installer accepted for ${component}"
            return 0
            ;;
        *)
            log "Installer declined for ${component}"
            return 1
            ;;
    esac
}

# ── 1. Check Node.js ──────────────────────────────────────────────────────────
heading 1 "Checking Node.js..."
echo "       Node.js runs the ReHoster web panel."
log "Checking Node.js"

if ! command -v node &>/dev/null; then
    echo ""
    echo "  Node.js is not installed. Install it using one of:"
    echo ""
    echo "    # Ubuntu / Debian (via NodeSource):"
    echo "    curl -fsSL https://deb.nodesource.com/setup_lts.x | sudo -E bash -"
    echo "    sudo apt-get install -y nodejs"
    echo ""
    echo "    # Fedora / RHEL:"
    echo "    sudo dnf install nodejs"
    echo ""
    echo "    # Or use nvm: https://github.com/nvm-sh/nvm"
    echo ""
    if prompt_install "Node.js" "The panel cannot start without Node.js 20+."; then
        run_installer
    fi
    if ! command -v node &>/dev/null; then
        echo "  ${INSTALLER_HINT}"
        log "Node.js missing after prompt/install path"
        error "Node.js not found."
    fi
fi

NODE_MAJOR=$(node -e "process.stdout.write(process.versions.node.split('.')[0])")
if [ "$NODE_MAJOR" -lt 20 ]; then
    if prompt_install "Node.js" "Version 20+ is required for the current dependency set."; then
        run_installer
    fi
    NODE_MAJOR=$(node -e "process.stdout.write(process.versions.node.split('.')[0])")
    if [ "$NODE_MAJOR" -lt 20 ]; then
        echo "  ${INSTALLER_HINT}"
        log "Outdated Node.js detected after prompt/install path"
        error "Node.js v20 or later is required. Found: $(node --version). Please upgrade at https://nodejs.org"
    fi
fi
info "Node.js $(node --version) - OK"
log "Node.js OK: $(node --version)"

# ── 2. Check npm ──────────────────────────────────────────────────────────────
heading 2 "Checking npm..."
echo "       npm installs and updates ReHoster's packages."
log "Checking npm"

if ! command -v npm &>/dev/null; then
    if prompt_install "npm" "npm is required to install this project's dependencies."; then
        run_installer
    fi
    if ! command -v npm &>/dev/null; then
        echo "  ${INSTALLER_HINT}"
        log "npm missing after prompt/install path"
        error "npm was not found. Please reinstall Node.js."
    fi
fi
info "npm v$(npm --version) - OK"
log "npm OK: $(npm --version)"

# ── 3. Bootstrap .env ─────────────────────────────────────────────────────────
heading 3 "Checking environment configuration..."
echo "       This creates local settings if they do not exist yet."
log "Checking environment configuration"

if [ ! -f ".env" ]; then
    echo "       .env not found - generating from template..."
    log ".env missing; generating from template"

    # Use Node.js (already verified) to generate a cryptographically random secret
    if GEN_SECRET=$(node -e "process.stdout.write(require('crypto').randomBytes(32).toString('hex'))" 2>/dev/null); then
        : # success
    else
        GEN_SECRET="please-replace-with-a-long-random-secret"
        warn "Could not auto-generate secret. Set SESSION_SECRET manually in .env"
    fi

    sed "s|replace-this-with-a-long-random-secret|${GEN_SECRET}|" .env.example > .env

    info ".env created with a random SESSION_SECRET."
    log ".env created"
    echo ""
    echo -e "  ${C_YELLOW}*** ACTION REQUIRED ***${C_RESET}"
    echo "  Edit .env and change ADMIN_PASSWORD before first use."
    echo ""
    read -rp "  Press Enter to continue..." _
    echo ""
else
    info ".env found - OK"
    log ".env found"
fi

# ── 4. Install / verify npm packages ─────────────────────────────────────────
heading 4 "Checking npm dependencies..."
echo "       This makes sure the panel's Node packages are installed."
log "Checking npm dependencies"

if [ ! -d "node_modules" ]; then
    echo "       node_modules not found - running npm install..."
    log "node_modules missing; running npm install"
    npm install
    info "Dependencies installed."
    log "Dependencies installed"
else
    # Sync any missing/updated packages; try offline first for speed
    log "node_modules present; attempting quiet npm sync"
    if npm install --prefer-offline --silent 2>/dev/null; then
        info "Dependencies up to date - OK"
        log "Dependencies OK"
    else
        echo "       Offline sync failed - retrying with network..."
        log "Offline npm sync failed; retrying with network"
        npm install
        info "Dependencies updated."
        log "Dependencies updated"
    fi
fi

# ── 5. Ensure required directories exist and check system tools ──────────────
heading 5 "Verifying required directories and system tools..."
echo "       Git is used to clone repos. Docker builds and runs managed apps."
log "Checking directories, Git, and Docker"
mkdir -p data logs managed-apps
info "data, logs, managed-apps - OK"
log "Required directories verified"
check_write_access "$(pwd)/data" "data directory"
check_write_access "$(pwd)/logs" "logs directory"
check_write_access "$(pwd)/managed-apps" "managed-apps directory"
if command -v git >/dev/null 2>&1; then
    info "$(git --version) - OK"
    log "Git OK: $(git --version)"
else
    warn "Git is not available from this shell. Clone, pull, and upgrade actions will fail."
    log "Git missing"
    if prompt_install "Git" "Git is needed for clone, pull, and self-upgrade operations."; then
        run_installer
    fi
    if command -v git >/dev/null 2>&1; then
        info "$(git --version) - OK"
        log "Git OK: $(git --version)"
    else
        warn "$INSTALLER_HINT"
        log "Git still unavailable after prompt/install path"
    fi
fi
if docker info >/dev/null 2>&1; then
    info "Docker - OK"
    log "Docker OK"
else
    warn "Docker is not available from this shell. ReHoster will start, but app build/deploy actions will fail until Docker is installed and running."
    log "Docker unavailable"
    if recover_docker_daemon; then
        info "Docker daemon recovered by launcher - OK"
        log "Docker daemon recovered by launcher"
    else
        if prompt_install "Docker" "Docker is needed to build and run managed applications."; then
            run_installer
        fi
        if docker info >/dev/null 2>&1; then
            info "Docker - OK"
            log "Docker OK"
        else
            if recover_docker_daemon; then
                info "Docker daemon recovered by launcher - OK"
                log "Docker daemon recovered by launcher after installer"
            else
                warn "$INSTALLER_HINT"
                warn "Ensure Docker service/Desktop is running and fully initialised."
                log "Docker still unavailable after prompt/install path"
            fi
        fi
    fi
fi

check_panel_port_conflict

# ── Launch ────────────────────────────────────────────────────────────────────
echo ""
echo -e "${C_BOLD} =========================================="
echo -e "  Starting ReHoster..."
echo -e " ==========================================${C_RESET}"
echo ""
echo "       Starting the Express server on the configured panel port."
echo "       Launcher log: ${LOG_FILE}"
log "Starting server"

exec node src/server.js
