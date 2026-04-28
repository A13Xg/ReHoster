#!/usr/bin/env bash
set -euo pipefail

mkdir -p logs
LOG_FILE="logs/install-prereqs.log"

if [ "${EUID:-$(id -u)}" -ne 0 ]; then
  SUDO="sudo"
else
  SUDO=""
fi

section() {
  printf '\n== %s ==\n' "$1"
}

info() {
  printf '   %s\n' "$1"
}

warn() {
  printf '   WARNING: %s\n' "$1" >&2
}

log() {
  printf '[%s] %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*" >> "$LOG_FILE"
}

detect_pkg_manager() {
  if command -v apt-get >/dev/null 2>&1; then
    echo apt
    return
  fi
  if command -v dnf >/dev/null 2>&1; then
    echo dnf
    return
  fi
  if command -v yum >/dev/null 2>&1; then
    echo yum
    return
  fi
  echo unknown
}

install_node_apt() {
  curl -fsSL https://deb.nodesource.com/setup_20.x | $SUDO bash -
  $SUDO apt-get install -y nodejs git docker.io
}

install_node_dnf() {
  $SUDO dnf install -y nodejs git docker
}

install_node_yum() {
  curl -fsSL https://rpm.nodesource.com/setup_20.x | $SUDO bash -
  $SUDO yum install -y nodejs git docker
}

section 'Installing ReHoster prerequisites'
echo "Log file: ${LOG_FILE}"
log 'Installer started'

PKG_MANAGER=$(detect_pkg_manager)
case "$PKG_MANAGER" in
  apt)
    section 'Using apt'
    log 'Using apt package manager'
    $SUDO apt-get update
    install_node_apt
    ;;
  dnf)
    section 'Using dnf'
    log 'Using dnf package manager'
    install_node_dnf
    ;;
  yum)
    section 'Using yum'
    log 'Using yum package manager'
    install_node_yum
    ;;
  *)
    warn 'Unsupported package manager. Install Node.js 20+, npm, Git, and Docker manually.'
    log 'Unsupported package manager'
    exit 1
    ;;
esac

section 'Enabling Docker'
if command -v systemctl >/dev/null 2>&1; then
  $SUDO systemctl enable --now docker || true
  log 'Attempted to enable/start Docker service'
fi

if [ -n "$SUDO" ]; then
  $SUDO usermod -aG docker "$USER" || true
  warn 'If docker still requires sudo, log out and back in so docker group membership takes effect.'
  log 'Attempted to add current user to docker group'
fi

section 'Summary'
info "Node: $(node --version 2>/dev/null || echo missing)"
info "npm: $(npm --version 2>/dev/null || echo missing)"
info "Git: $(git --version 2>/dev/null || echo missing)"
log "Summary Node=$(node --version 2>/dev/null || echo missing) npm=$(npm --version 2>/dev/null || echo missing) Git=$(git --version 2>/dev/null || echo missing)"
if docker info >/dev/null 2>&1; then
  info 'Docker daemon is reachable'
  log 'Docker daemon reachable'
else
  warn 'Docker daemon is not reachable yet. Start/enable Docker and re-run the launcher.'
  log 'Docker daemon not reachable'
fi

info 'Run ./launch.sh next.'
log 'Installer completed'