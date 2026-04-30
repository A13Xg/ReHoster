@echo off
setlocal EnableDelayedExpansion
title ReHoster Launcher

:: Change to the directory where this script lives
cd /d "%~dp0"

if not exist "logs" mkdir logs >nul 2>&1
set "LOG_FILE=logs\launcher.log"

echo.
echo  ==========================================
echo   ReHoster - Bootstrap ^& Launch
echo  ==========================================
echo.

set "INSTALLER_HINT=Run PowerShell -ExecutionPolicy Bypass -File .\install-prereqs.ps1 to install prerequisites."
set "INSTALLER_CMD=powershell -ExecutionPolicy Bypass -File .\install-prereqs.ps1"

call :log "Launcher started"

goto :main

:timestamp
for /f "usebackq delims=" %%T in (`powershell -NoProfile -Command "Get-Date -Format 'yyyy-MM-dd HH:mm:ss'"`) do set "STAMP=%%T"
exit /b 0

:log
call :timestamp
>> "%LOG_FILE%" echo [!STAMP!] %~1
exit /b 0

:refresh_docker_context
set "DOCKER_WHERE="
set "FOUND_DOCKER_EXE="

echo        Docker diagnostics: checking command resolution...
call :log "Docker diagnostics: checking command resolution"

if defined DOCKER_CMD (
    echo        DOCKER_CMD is already set: !DOCKER_CMD!
    call :log "DOCKER_CMD pre-set: !DOCKER_CMD!"
)

where docker > .docker_where.tmp 2>nul
if errorlevel 1 (
    echo        docker is not currently discoverable via PATH.
    call :log "where docker: not found in PATH"
) else (
    set /p DOCKER_WHERE=<.docker_where.tmp
    echo        where docker found: !DOCKER_WHERE!
    call :log "where docker returned: !DOCKER_WHERE!"
)
del .docker_where.tmp >nul 2>&1

if exist "C:\Program Files\Docker\Docker\resources\bin\docker.exe" (
    set "FOUND_DOCKER_EXE=C:\Program Files\Docker\Docker\resources\bin\docker.exe"
)
if not defined FOUND_DOCKER_EXE if exist "C:\Program Files\Docker\Docker\resources\docker.exe" (
    set "FOUND_DOCKER_EXE=C:\Program Files\Docker\Docker\resources\docker.exe"
)

if defined FOUND_DOCKER_EXE (
    echo        Known Docker Desktop path found: !FOUND_DOCKER_EXE!
    call :log "Known Docker Desktop path exists: !FOUND_DOCKER_EXE!"
    if not defined DOCKER_CMD (
        set "DOCKER_CMD=!FOUND_DOCKER_EXE!"
        echo        DOCKER_CMD set for this session.
        call :log "DOCKER_CMD set by launcher: !DOCKER_CMD!"
    )
    set "DOCKER_BIN_DIR=C:\Program Files\Docker\Docker\resources\bin"
    echo !PATH! | find /I "!DOCKER_BIN_DIR!" >nul
    if errorlevel 1 (
        set "PATH=!DOCKER_BIN_DIR!;!PATH!"
        echo        Added Docker bin directory to PATH for this session.
        call :log "Docker bin directory added to PATH"
    )
) else (
    call :log "Known Docker Desktop executable paths not found"
)

if defined DOCKER_CMD (
    echo        Launcher will use DOCKER_CMD: !DOCKER_CMD!
    call :log "Launcher using DOCKER_CMD: !DOCKER_CMD!"
)
exit /b 0

:check_docker_info
if defined DOCKER_CMD (
    "!DOCKER_CMD!" info >nul 2>&1
) else (
    call docker info >nul 2>&1
)
exit /b %errorlevel%

:docker_info_diagnostic
if defined DOCKER_CMD (
    "!DOCKER_CMD!" info > .docker_info_diag.tmp 2>&1
) else (
    call docker info > .docker_info_diag.tmp 2>&1
)
set "DOCKER_DIAG_LINE=(no output)"
set /p DOCKER_DIAG_LINE=<.docker_info_diag.tmp
del .docker_info_diag.tmp >nul 2>&1
echo        Docker diagnostic: !DOCKER_DIAG_LINE!
call :log "Docker diagnostic line: !DOCKER_DIAG_LINE!"
exit /b 0

:is_port_in_use
set "TARGET_PORT=%~1"
set "PORT_BUSY=0"
for /f "usebackq delims=" %%L in (`netstat -ano ^| findstr /R /C:":!TARGET_PORT! .*LISTENING"`) do (
    set "PORT_BUSY=1"
    goto :is_port_in_use_done
)
:is_port_in_use_done
exit /b 0

:check_panel_port_conflict
set "PANEL_PORT=3000"
if exist ".env" (
    for /f "usebackq tokens=1,* delims==" %%A in (".env") do (
        if /I "%%A"=="PORT" (
            if not "%%B"=="" set "PANEL_PORT=%%B"
        )
    )
)
set "PANEL_PORT=!PANEL_PORT: =!"
call :is_port_in_use !PANEL_PORT!
if "!PORT_BUSY!"=="1" (
    echo        WARNING: Port !PANEL_PORT! appears to already be in use.
    echo        ReHoster may fail to start if another service is bound to this port.
    call :log "Panel port conflict detected on !PANEL_PORT!"
) else (
    echo        Panel port !PANEL_PORT! appears available.
    call :log "Panel port available: !PANEL_PORT!"
)
exit /b 0

:check_write_access
set "WRITE_TARGET=%~1"
set "WRITE_LABEL=%~2"
set "WRITE_PROBE=!WRITE_TARGET!\.rehoster_write_test.tmp"
echo probe > "!WRITE_PROBE!" 2>nul
if errorlevel 1 (
    echo.
    echo  ERROR: Cannot write to !WRITE_LABEL! at !WRITE_TARGET!
    echo  Fix filesystem permissions and run launcher again.
    call :log "Write access failed for !WRITE_LABEL! at !WRITE_TARGET!"
    pause
    exit /b 1
)
del "!WRITE_PROBE!" >nul 2>&1
call :log "Write access OK for !WRITE_LABEL! at !WRITE_TARGET!"
exit /b 0

:start_docker_desktop
set "DOCKER_DESKTOP_EXE="
if exist "C:\Program Files\Docker\Docker\Docker Desktop.exe" set "DOCKER_DESKTOP_EXE=C:\Program Files\Docker\Docker\Docker Desktop.exe"
if not defined DOCKER_DESKTOP_EXE if exist "%LocalAppData%\Docker\Docker Desktop.exe" set "DOCKER_DESKTOP_EXE=%LocalAppData%\Docker\Docker Desktop.exe"

if not defined DOCKER_DESKTOP_EXE (
    echo        Docker Desktop executable not found; cannot auto-start Desktop.
    call :log "Docker Desktop executable not found for auto-start"
    exit /b 1
)

tasklist /FI "IMAGENAME eq Docker Desktop.exe" 2>nul | find /I "Docker Desktop.exe" >nul
if errorlevel 1 (
    echo        Attempting to launch Docker Desktop...
    call :log "Attempting Docker Desktop launch: !DOCKER_DESKTOP_EXE!"
    start "Docker Desktop" "!DOCKER_DESKTOP_EXE!" >nul 2>&1
    if errorlevel 1 (
        echo        Failed to launch Docker Desktop automatically.
        call :log "Docker Desktop launch command failed"
        exit /b 1
    )
) else (
    echo        Docker Desktop process is already running.
    call :log "Docker Desktop process already running"
)

exit /b 0

:wait_for_docker_daemon
set "WAIT_SECONDS=%~1"
if "!WAIT_SECONDS!"=="" set "WAIT_SECONDS=45"
set /a WAIT_ITER=0

:wait_for_docker_daemon_loop
call :check_docker_info
if not errorlevel 1 (
    echo        Docker daemon became reachable.
    call :log "Docker daemon reachable after wait"
    exit /b 0
)

set /a WAIT_ITER+=1
if !WAIT_ITER! GEQ !WAIT_SECONDS! (
    call :log "Docker daemon wait timed out after !WAIT_SECONDS! seconds"
    exit /b 1
)

if !WAIT_ITER! EQU 1 (
    echo        Waiting for Docker daemon to initialise...
    call :log "Waiting for Docker daemon initialisation"
)

timeout /t 1 /nobreak >nul
goto :wait_for_docker_daemon_loop

:recover_docker_daemon
call :start_docker_desktop
call :wait_for_docker_daemon 60
if errorlevel 1 (
    echo        Docker daemon is still unreachable after auto-start attempt.
    call :log "Docker daemon unreachable after auto-start/wait"
    exit /b 1
)
exit /b 0

:prompt_install
set "PROMPT_COMPONENT=%~1"
set "PROMPT_REASON=%~2"
echo.
echo        %~1 is missing or not ready.
echo        %~2
echo        ReHoster can try to install or repair this now.
echo        This will open a separate elevated PowerShell window if admin rights are required.
choice /C YN /N /M "        Run installer now? [Y/N]: "
if errorlevel 2 (
    call :log "Installer declined for %~1"
    exit /b 1
)
call :log "Installer accepted for %~1"
exit /b 0

:run_installer
echo.
echo        Launching prerequisite installer...
echo        An elevated PowerShell window may open for system package installation.
call :log "Launching prerequisite installer"
%INSTALLER_CMD%
if errorlevel 1 (
    call :log "Prerequisite installer failed"
    echo.
    echo  ERROR: Prerequisite installer did not complete successfully.
    echo  !INSTALLER_HINT!
    echo.
    pause
    exit /b 1
)
echo.
echo        Re-checking prerequisites after installer...
call :log "Prerequisite installer completed; re-checking prerequisites"
exit /b 0

:main

:: ── 1. Check Node.js ──────────────────────────────────────────────────────────
echo [1/5] Checking Node.js...
echo        Node.js runs the ReHoster web panel.
call :log "Checking Node.js"
node --version >nul 2>&1
if errorlevel 1 (
    call :prompt_install "Node.js" "The panel cannot start without Node.js 20+."
    if errorlevel 1 (
        echo.
        echo  ERROR: Node.js is required to run ReHoster.
        echo  !INSTALLER_HINT!
        call :log "Node.js missing and installer declined"
        echo.
        pause
        exit /b 1
    )
    call :run_installer
    node --version >nul 2>&1
    if errorlevel 1 (
        echo.
        echo  ERROR: Node.js was not found after running the installer.
        echo  Please install Node.js v20 or later from https://nodejs.org
        echo  !INSTALLER_HINT!
        echo.
        pause
        exit /b 1
    )
)

node -e "process.stdout.write(process.versions.node.split('.')[0])" > .node_major.tmp 2>nul
set /p NODE_MAJOR=<.node_major.tmp
del .node_major.tmp >nul 2>&1

if !NODE_MAJOR! LSS 20 (
    call :prompt_install "Node.js" "Version 20+ is required for the current dependency set."
    if errorlevel 1 (
        node --version > .node_ver.tmp 2>nul
        set /p NODE_FULL=<.node_ver.tmp
        del .node_ver.tmp >nul 2>&1
        echo.
        echo  ERROR: Node.js v20 or later is required.
        echo  Found: !NODE_FULL!
        echo  !INSTALLER_HINT!
        call :log "Outdated Node.js detected and installer declined"
        echo.
        pause
        exit /b 1
    )
    call :run_installer
    node -e "process.stdout.write(process.versions.node.split('.')[0])" > .node_major.tmp 2>nul
    set /p NODE_MAJOR=<.node_major.tmp
    del .node_major.tmp >nul 2>&1
    if !NODE_MAJOR! LSS 20 (
        node --version > .node_ver.tmp 2>nul
        set /p NODE_FULL=<.node_ver.tmp
        del .node_ver.tmp >nul 2>&1
        echo.
        echo  ERROR: Node.js v20 or later is required.
        echo  Found: !NODE_FULL!
        echo  Please upgrade at https://nodejs.org
        echo  !INSTALLER_HINT!
        echo.
        pause
        exit /b 1
    )
)

node --version > .node_ver.tmp 2>nul
set /p NODE_FULL=<.node_ver.tmp
del .node_ver.tmp >nul 2>&1
echo        Node.js !NODE_FULL! - OK
call :log "Node.js OK: !NODE_FULL!"

:: ── 2. Check npm ──────────────────────────────────────────────────────────────
echo [2/5] Checking npm...
echo        npm installs and updates ReHoster's packages.
call :log "Checking npm"
call npm --version >nul 2>&1
if errorlevel 1 (
    call :prompt_install "npm" "npm is required to install this project's dependencies."
    if errorlevel 1 (
        echo.
        echo  ERROR: npm is required to install ReHoster dependencies.
        echo  !INSTALLER_HINT!
        call :log "npm missing and installer declined"
        echo.
        pause
        exit /b 1
    )
    call :run_installer
    call npm --version >nul 2>&1
    if errorlevel 1 (
        echo.
        echo  ERROR: npm was not found after running the installer.
        echo  Please reinstall Node.js.
        echo  !INSTALLER_HINT!
        echo.
        pause
        exit /b 1
    )
)
call npm --version > .npm_ver.tmp 2>nul
set /p NPM_VER=<.npm_ver.tmp
del .npm_ver.tmp >nul 2>&1
echo        npm v!NPM_VER! - OK
call :log "npm OK: !NPM_VER!"

:: ── 3. Bootstrap .env ─────────────────────────────────────────────────────────
echo [3/5] Checking environment configuration...
echo        This creates local settings if they do not exist yet.
call :log "Checking environment configuration"
if not exist ".env" (
    echo        .env not found - generating from template...
    call :log ".env missing; generating from template"

    :: Use Node.js (already verified) to generate a cryptographically random secret
    node -e "process.stdout.write(require('crypto').randomBytes(32).toString('hex'))" > .rehoster_secret.tmp 2>nul
    set /p GEN_SECRET=<.rehoster_secret.tmp
    del .rehoster_secret.tmp >nul 2>&1

    if "!GEN_SECRET!"=="" (
        set GEN_SECRET=please-replace-with-a-long-random-secret
        echo        WARNING: Could not auto-generate secret. Set SESSION_SECRET manually in .env
    )

    (
        echo NODE_ENV=development
        echo PORT=3000
        echo SESSION_SECRET=!GEN_SECRET!
        echo.
        echo ADMIN_USERNAME=admin
        echo ADMIN_PASSWORD=change-me-immediately
        echo.
        echo DATABASE_PATH=./data/hosting-panel.sqlite
        echo MANAGED_APPS_DIR=./managed-apps
        echo.
        echo APP_PORT_START=4000
        echo APP_PORT_END=4999
        echo BASE_HOST=http://localhost
        echo.
        echo DEFAULT_CONTAINER_PORT=3000
        echo DOCKER_RESTART_POLICY=unless-stopped
    ) > .env

    echo        .env created with a random SESSION_SECRET.
    call :log ".env created"
    echo.
    echo  *** ACTION REQUIRED ***
    echo  Edit .env and change ADMIN_PASSWORD before first use.
    echo  Press any key to continue...
    echo.
    pause >nul
) else (
    echo        .env found - OK
    call :log ".env found"
)

:: ── 4. Install / verify npm packages ─────────────────────────────────────────
echo [4/5] Checking npm dependencies...
echo        This makes sure the panel's Node packages are installed.
call :log "Checking npm dependencies"
if not exist "node_modules" (
    echo        node_modules not found - running npm install...
    call :log "node_modules missing; running npm install"
    call npm install
    if errorlevel 1 (
        call :log "npm install failed"
        echo.
        echo  ERROR: npm install failed. Check the output above.
        echo  A detailed command transcript is in %LOG_FILE%
        echo.
        pause
        exit /b 1
    )
    echo        Dependencies installed.
    call :log "Dependencies installed"
) else (
    :: Sync any missing/updated packages quietly
    call :log "node_modules present; attempting quiet npm sync"
    call npm install --prefer-offline >nul 2>&1
    if errorlevel 1 (
        echo        Offline sync failed - retrying with network...
        call :log "Offline npm sync failed; retrying with network"
        call npm install
        if errorlevel 1 (
            call :log "npm install failed after retry"
            echo.
            echo  ERROR: npm install failed. Check the output above.
            echo  A detailed command transcript is in %LOG_FILE%
            echo.
            pause
            exit /b 1
        )
    )
    echo        Dependencies up to date - OK
    call :log "Dependencies OK"
)

:: ── 5. Ensure required directories exist and check system tools ─────────────
echo [5/5] Verifying required directories and system tools...
echo        Git is used to clone repos. Docker builds and runs managed apps.
call :log "Checking directories, Git, and Docker"
if not exist "data"         mkdir data
if not exist "logs"         mkdir logs
if not exist "managed-apps" mkdir managed-apps
echo        data, logs, managed-apps - OK
call :log "Required directories verified"
call :check_write_access "%cd%\data" "data directory"
if errorlevel 1 exit /b 1
call :check_write_access "%cd%\logs" "logs directory"
if errorlevel 1 exit /b 1
call :check_write_access "%cd%\managed-apps" "managed-apps directory"
if errorlevel 1 exit /b 1
git --version >nul 2>&1
if errorlevel 1 (
    echo        WARNING: Git is not available from this shell.
    echo        ReHoster will start, but clone, pull, and upgrade actions will fail.
    call :log "Git missing"
    call :prompt_install "Git" "Git is needed for clone, pull, and self-upgrade operations."
    if not errorlevel 1 call :run_installer
    git --version >nul 2>&1
    if errorlevel 1 (
        echo        !INSTALLER_HINT!
        call :log "Git still unavailable after prompt/install path"
    ) else (
        git --version > .git_ver.tmp 2>nul
        set /p GIT_VER=<.git_ver.tmp
        del .git_ver.tmp >nul 2>&1
        echo        !GIT_VER! - OK
        call :log "Git OK: !GIT_VER!"
    )
) else (
    git --version > .git_ver.tmp 2>nul
    set /p GIT_VER=<.git_ver.tmp
    del .git_ver.tmp >nul 2>&1
    echo        !GIT_VER! - OK
    call :log "Git OK: !GIT_VER!"
)
call :refresh_docker_context
call :check_docker_info
if errorlevel 1 (
    echo        WARNING: Docker is not available from this shell.
    echo        ReHoster will start, but app build/deploy actions will fail until Docker Desktop/Engine is installed and running.
    call :log "Docker unavailable"
    call :docker_info_diagnostic
    call :recover_docker_daemon
    if not errorlevel 1 (
        echo        Docker daemon recovered via launcher auto-start.
        call :log "Docker daemon recovered by launcher"
        goto :docker_ready
    )
    call :prompt_install "Docker" "Docker is needed to build and run managed applications."
    if not errorlevel 1 call :run_installer
    call :refresh_docker_context
    call :check_docker_info
    if errorlevel 1 (
        call :recover_docker_daemon
    )
    call :check_docker_info
    if errorlevel 1 (
        echo        !INSTALLER_HINT!
        echo        Tip: you can set DOCKER_CMD in .env to the full docker.exe path if your shell is isolated.
        echo        Also ensure Docker Desktop is running and fully initialised.
        call :log "Docker still unavailable after prompt/install path"
        call :docker_info_diagnostic
    ) else (
        echo        Docker - OK
        call :log "Docker OK"
    )
) else (
    echo        Docker - OK
    call :log "Docker OK"
)

:docker_ready
call :check_panel_port_conflict

:: ── Launch ────────────────────────────────────────────────────────────────────
echo.
echo  ==========================================
echo   Starting ReHoster...
echo  ==========================================
echo.
echo        Starting the Express server on the configured panel port.
echo        Launcher log: %LOG_FILE%
call :log "Starting server"

node src/server.js
if errorlevel 1 (
    call :log "Server exited with an error"
    echo.
    echo  Server exited with an error. Check the output above.
    echo  Launcher log: %LOG_FILE%
    pause
)

if not errorlevel 1 (
    call :log "Server process exited normally"
)

endlocal
