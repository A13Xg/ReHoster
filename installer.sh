#!/usr/bin/env bash
# =============================================================================
# ReHoster Installer
#
# Usage:
#   bash installer.sh [--install-dir /custom/path] [--no-service] [--no-cleanup]
#
# This script:
#   1. Detects the host OS and platform.
#   2. Installs missing system prerequisites (Node.js, npm, git, Docker).
#   3. Copies the cloned repo to the recommended install location.
#   4. Creates and seeds the .env configuration file.
#   5. Initialises the SQLite database.
#   6. Registers a systemd (Linux) or launchd (macOS) service for auto-start.
#   7. Optionally removes the original cloned directory (cleanup).
# =============================================================================

set -euo pipefail

# ── Colour helpers ────────────────────────────────────────────────────────────
if [ -t 1 ]; then
    C_RESET='\033[0m'; C_GREEN='\033[0;32m'; C_YELLOW='\033[1;33m'
    C_RED='\033[0;31m'; C_BOLD='\033[1m'; C_CYAN='\033[0;36m'
else
    C_RESET=''; C_GREEN=''; C_YELLOW=''; C_RED=''; C_BOLD=''; C_CYAN=''
fi

info()    { echo -e "  ${C_GREEN}✔${C_RESET}  $*"; }
warn()    { echo -e "  ${C_YELLOW}⚠${C_RESET}  WARNING: $*"; }
error()   { echo -e "\n  ${C_RED}✖${C_RESET}  ERROR: $*\n" >&2; exit 1; }
heading() { echo -e "\n${C_BOLD}${C_CYAN}══ $* ══${C_RESET}"; }
step()    { echo -e "  ${C_CYAN}→${C_RESET} $*"; }

# ── Parse arguments ───────────────────────────────────────────────────────────
CUSTOM_INSTALL_DIR=""
CREATE_SERVICE=true
DO_CLEANUP_PROMPT=true

while [[ $# -gt 0 ]]; do
    case "$1" in
        --install-dir) CUSTOM_INSTALL_DIR="${2:-}"; shift 2 ;;
        --no-service)  CREATE_SERVICE=false; shift ;;
        --no-cleanup)  DO_CLEANUP_PROMPT=false; shift ;;
        *) warn "Unknown argument: $1"; shift ;;
    esac
done

# ── Detect OS ─────────────────────────────────────────────────────────────────
OS_TYPE=""
if [[ "$(uname -s)" == "Linux" ]]; then
    OS_TYPE="linux"
elif [[ "$(uname -s)" == "Darwin" ]]; then
    OS_TYPE="macos"
else
    error "Unsupported operating system: $(uname -s). Use installer.bat on Windows."
fi

info "Detected OS: ${OS_TYPE}"

# ── Resolve paths ─────────────────────────────────────────────────────────────
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if [[ -n "$CUSTOM_INSTALL_DIR" ]]; then
    INSTALL_DIR="$CUSTOM_INSTALL_DIR"
elif [[ "$OS_TYPE" == "linux" ]]; then
    # Use /opt/rehoster for system-wide install; fall back to ~/.rehoster for
    # non-root users.
    if [[ $EUID -eq 0 ]]; then
        INSTALL_DIR="/opt/rehoster"
    else
        INSTALL_DIR="${HOME}/.rehoster"
    fi
else
    # macOS
    INSTALL_DIR="${HOME}/.rehoster"
fi

# ── Banner ────────────────────────────────────────────────────────────────────
echo ""
echo -e "${C_BOLD}╔══════════════════════════════════════════╗${C_RESET}"
echo -e "${C_BOLD}║         ReHoster Installer               ║${C_RESET}"
echo -e "${C_BOLD}╚══════════════════════════════════════════╝${C_RESET}"
echo ""
echo -e "  Source:  ${C_CYAN}${SCRIPT_DIR}${C_RESET}"
echo -e "  Target:  ${C_CYAN}${INSTALL_DIR}${C_RESET}"
echo ""

# ── Check prerequisites ───────────────────────────────────────────────────────
heading "Step 1/6 — Checking prerequisites"

check_command() {
    local cmd="$1" label="$2"
    if command -v "$cmd" >/dev/null 2>&1; then
        info "$label is available ($(${cmd} --version 2>&1 | head -1))"
        return 0
    fi
    return 1
}

# Node.js
if ! check_command node "Node.js"; then
    warn "Node.js not found. Attempting to install via NodeSource..."
    if [[ "$OS_TYPE" == "linux" ]] && command -v apt-get >/dev/null 2>&1; then
        step "Installing Node.js LTS via NodeSource"
        curl -fsSL https://deb.nodesource.com/setup_lts.x | sudo -E bash - || true
        sudo apt-get install -y nodejs || error "Failed to install Node.js. Install it manually: https://nodejs.org"
    elif [[ "$OS_TYPE" == "linux" ]] && command -v dnf >/dev/null 2>&1; then
        sudo dnf install -y nodejs || error "Failed to install Node.js via dnf."
    elif [[ "$OS_TYPE" == "macos" ]]; then
        if command -v brew >/dev/null 2>&1; then
            brew install node || error "Failed to install Node.js via Homebrew."
        else
            error "Homebrew not found. Install Node.js from https://nodejs.org or install Homebrew first."
        fi
    else
        error "Cannot auto-install Node.js on this system. Install it manually: https://nodejs.org"
    fi
fi

NODE_MAJOR=$(node -e "process.stdout.write(process.versions.node.split('.')[0])" 2>/dev/null || echo "0")
if [[ "$NODE_MAJOR" -lt 18 ]]; then
    error "Node.js v18 or later is required. Installed: $(node --version). Upgrade at https://nodejs.org"
fi
info "Node.js $(node --version) — OK"

# npm
if ! check_command npm "npm"; then
    error "npm is not available. Re-install Node.js from https://nodejs.org"
fi
info "npm v$(npm --version) — OK"

# Git
if ! check_command git "Git"; then
    warn "Git not found. Attempting to install..."
    if [[ "$OS_TYPE" == "linux" ]] && command -v apt-get >/dev/null 2>&1; then
        sudo apt-get install -y git || warn "Could not auto-install git."
    elif [[ "$OS_TYPE" == "linux" ]] && command -v dnf >/dev/null 2>&1; then
        sudo dnf install -y git || warn "Could not auto-install git."
    elif [[ "$OS_TYPE" == "macos" ]] && command -v brew >/dev/null 2>&1; then
        brew install git || warn "Could not install git via Homebrew."
    fi
    if ! command -v git >/dev/null 2>&1; then
        warn "Git is still unavailable. Clone/pull operations will not work."
    fi
fi

# Docker
if ! docker info >/dev/null 2>&1; then
    warn "Docker daemon is not available. ReHoster can install and run, but app builds will fail until Docker is running."
    if [[ "$OS_TYPE" == "linux" ]]; then
        step "You can install Docker with: sudo apt-get install -y docker.io && sudo usermod -aG docker \$USER"
    elif [[ "$OS_TYPE" == "macos" ]]; then
        step "Install Docker Desktop from https://www.docker.com/products/docker-desktop"
    fi
fi

# ── Copy files to install directory ──────────────────────────────────────────
heading "Step 2/6 — Installing to ${INSTALL_DIR}"

if [[ "$SCRIPT_DIR" == "$INSTALL_DIR" ]]; then
    info "Already running from install directory — skipping copy."
else
    if [[ -d "$INSTALL_DIR" ]]; then
        warn "Install directory already exists: ${INSTALL_DIR}"
        read -rp "  Overwrite? [y/N]: " overwrite_reply
        if [[ "$overwrite_reply" =~ ^[Yy]$ ]]; then
            step "Removing old install..."
            rm -rf "$INSTALL_DIR"
        else
            error "Installation cancelled. Remove ${INSTALL_DIR} manually and re-run."
        fi
    fi

    step "Copying files to ${INSTALL_DIR}..."
    mkdir -p "$INSTALL_DIR"
    # Copy all files except the data, logs, and node_modules directories (fresh install).
    rsync -a --exclude 'data/' --exclude 'logs/' --exclude 'node_modules/' --exclude '.git/' \
        "${SCRIPT_DIR}/" "${INSTALL_DIR}/" 2>/dev/null \
        || cp -r "${SCRIPT_DIR}/." "${INSTALL_DIR}"

    # Ensure the install owns data, logs, managed-apps directories.
    mkdir -p "${INSTALL_DIR}/data" "${INSTALL_DIR}/logs" "${INSTALL_DIR}/managed-apps"
    info "Files copied to ${INSTALL_DIR}"
fi

cd "$INSTALL_DIR"

# ── Configure .env ────────────────────────────────────────────────────────────
heading "Step 3/6 — Configuring environment"

if [[ ! -f ".env" ]]; then
    step "Generating .env from template..."
    if [[ -f ".env.example" ]]; then
      GEN_SECRET=$(node -e "process.stdout.write(require('crypto').randomBytes(32).toString('hex'))" 2>/dev/null || "")
      if [[ -z "$GEN_SECRET" ]]; then
        error "Failed to generate SESSION_SECRET — Node.js crypto unavailable. Generate one manually with: openssl rand -hex 32"
      fi
      sed "s|replace-this-with-a-long-random-secret|${GEN_SECRET}|" .env.example > .env
      info ".env created with a randomly generated SESSION_SECRET"
      echo ""
      echo -e "  ${C_YELLOW}*** ACTION REQUIRED ***${C_RESET}"
      echo -e "  Edit ${INSTALL_DIR}/.env and set a secure ADMIN_PASSWORD before first use."
      echo ""
      read -rp "  Press Enter to continue..." _
    else
      warn ".env.example not found — cannot create .env automatically. Copy it manually."
    fi
else
    info ".env already exists — skipping"
fi

# ── Install npm dependencies ──────────────────────────────────────────────────
heading "Step 4/6 — Installing npm dependencies"

step "Running npm install..."
npm install --prefer-offline 2>&1 | tail -5 || npm install
info "npm dependencies installed"

# ── Initialise database ───────────────────────────────────────────────────────
heading "Step 5/6 — Initialising database"

step "Running npm run db:init..."
npm run db:init
info "Database initialised"

# ── Register auto-start service ───────────────────────────────────────────────
heading "Step 6/6 — Configuring auto-start"

if [[ "$CREATE_SERVICE" == "false" ]]; then
    info "Skipping service registration (--no-service)"
elif [[ "$OS_TYPE" == "linux" ]] && command -v systemctl >/dev/null 2>&1; then
    SERVICE_FILE="/etc/systemd/system/rehoster.service"
    NODE_PATH=$(command -v node)
    CURRENT_USER=$(whoami)

    step "Creating systemd service at ${SERVICE_FILE}..."
    sudo tee "$SERVICE_FILE" > /dev/null << EOF
[Unit]
Description=ReHoster — Self-hosted deployment panel
After=network.target docker.service
Wants=docker.service

[Service]
Type=simple
User=${CURRENT_USER}
WorkingDirectory=${INSTALL_DIR}
ExecStart=${NODE_PATH} src/server.js
Restart=on-failure
RestartSec=5
StandardOutput=journal
StandardError=journal
SyslogIdentifier=rehoster
EnvironmentFile=${INSTALL_DIR}/.env

[Install]
WantedBy=multi-user.target
EOF

    sudo systemctl daemon-reload
    sudo systemctl enable rehoster
    info "systemd service 'rehoster' registered and enabled for auto-start"
    echo ""
    echo -e "  ${C_CYAN}To start now:${C_RESET} sudo systemctl start rehoster"
    echo -e "  ${C_CYAN}To view logs:${C_RESET} journalctl -u rehoster -f"

elif [[ "$OS_TYPE" == "macos" ]]; then
    PLIST_DIR="${HOME}/Library/LaunchAgents"
    PLIST_FILE="${PLIST_DIR}/com.rehoster.panel.plist"
    NODE_PATH=$(command -v node)

    mkdir -p "$PLIST_DIR"
    step "Creating launchd plist at ${PLIST_FILE}..."
    cat > "$PLIST_FILE" << EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.rehoster.panel</string>
    <key>ProgramArguments</key>
    <array>
        <string>${NODE_PATH}</string>
        <string>${INSTALL_DIR}/src/server.js</string>
    </array>
    <key>WorkingDirectory</key>
    <string>${INSTALL_DIR}</string>
    <key>EnvironmentVariables</key>
    <dict>
        <key>NODE_ENV</key>
        <string>production</string>
    </dict>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>StandardOutPath</key>
    <string>${INSTALL_DIR}/logs/launchd-stdout.log</string>
    <key>StandardErrorPath</key>
    <string>${INSTALL_DIR}/logs/launchd-stderr.log</string>
</dict>
</plist>
EOF
    launchctl load "$PLIST_FILE" 2>/dev/null || true
    info "launchd service registered at ${PLIST_FILE}"
    echo -e "  ${C_CYAN}To start now:${C_RESET} launchctl start com.rehoster.panel"
else
    warn "Could not register auto-start service (systemd/launchd not found)."
    echo "  Start ReHoster manually with: cd ${INSTALL_DIR} && node src/server.js"
fi

# ── Cleanup prompt ────────────────────────────────────────────────────────────
if [[ "$DO_CLEANUP_PROMPT" == "true" ]] && [[ "$SCRIPT_DIR" != "$INSTALL_DIR" ]]; then
    echo ""
    echo -e "  ${C_BOLD}Cleanup${C_RESET}"
    echo -e "  ReHoster has been installed to: ${C_CYAN}${INSTALL_DIR}${C_RESET}"
    echo -e "  The original clone at ${C_CYAN}${SCRIPT_DIR}${C_RESET} is no longer needed."
    read -rp "  Delete the original clone directory? [y/N]: " cleanup_reply
    if [[ "$cleanup_reply" =~ ^[Yy]$ ]]; then
        rm -rf "$SCRIPT_DIR"
        info "Original clone directory removed"
    else
        info "Original clone directory kept at ${SCRIPT_DIR}"
    fi
fi

# ── Summary ───────────────────────────────────────────────────────────────────
echo ""
echo -e "${C_BOLD}╔══════════════════════════════════════════╗${C_RESET}"
echo -e "${C_BOLD}║     ReHoster installation complete!      ║${C_RESET}"
echo -e "${C_BOLD}╚══════════════════════════════════════════╝${C_RESET}"
echo ""
echo -e "  Install location : ${C_CYAN}${INSTALL_DIR}${C_RESET}"
echo -e "  Panel URL        : ${C_CYAN}http://localhost:3000${C_RESET} (default)"
echo -e "  Launcher script  : ${C_CYAN}${INSTALL_DIR}/launch.sh${C_RESET}"
echo ""
echo -e "  ${C_YELLOW}Remember to update ADMIN_PASSWORD in .env before first use!${C_RESET}"
echo ""
