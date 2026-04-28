param(
    [switch]$ElevatedRun
)

$ErrorActionPreference = 'Stop'

$LogDir = Join-Path (Get-Location) 'logs'
if (-not (Test-Path $LogDir)) {
    New-Item -ItemType Directory -Path $LogDir | Out-Null
}
$LogFile = Join-Path $LogDir 'install-prereqs.log'

function Write-Log($message) {
    $stamp = Get-Date -Format 'yyyy-MM-dd HH:mm:ss'
    Add-Content -Path $LogFile -Value "[$stamp] $message"
}

function Write-Section($message) {
    Write-Host ""
    Write-Host "== $message ==" -ForegroundColor Cyan
    Write-Log $message
}

function Write-Info($message) {
    Write-Host "   $message" -ForegroundColor Green
}

function Write-WarnLine($message) {
    Write-Host "   WARNING: $message" -ForegroundColor Yellow
}

function Write-ErrorLine($message) {
    Write-Host "   ERROR: $message" -ForegroundColor Red
}

function Finish-Installer($code) {
    if ($ElevatedRun) {
        Write-Host ''
        Read-Host 'Press Enter to close this installer window' | Out-Null
    }
    exit $code
}

function Get-CommandVersion($commandName, $versionArgs) {
    try {
        return (& $commandName @versionArgs 2>$null | Select-Object -First 1).ToString().Trim()
    } catch {
        return $null
    }
}

function Test-Admin {
    $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
    $principal = New-Object Security.Principal.WindowsPrincipal($identity)
    return $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

function Restart-Elevated {
    $scriptPath = $MyInvocation.ScriptName
    if (-not $scriptPath) {
        $scriptPath = $PSCommandPath
    }

    Write-WarnLine 'Administrative privileges are required for package installation.'
    Write-Host '   Opening a new elevated PowerShell window for the installer...' -ForegroundColor Yellow
    Write-Log 'Attempting to relaunch installer as administrator'

    try {
        $process = Start-Process -FilePath 'powershell.exe' `
            -Verb RunAs `
            -WorkingDirectory (Get-Location).Path `
            -ArgumentList @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', $scriptPath, '-ElevatedRun') `
            -Wait `
            -PassThru

        Write-Log "Elevated installer exited with code $($process.ExitCode)"
        Finish-Installer $process.ExitCode
    } catch {
        Write-ErrorLine 'Elevation was cancelled or failed.'
        Write-Log "Elevation failed: $($_.Exception.Message)"
        Finish-Installer 1
    }
}

function Test-Winget {
    return $null -ne (Get-Command winget -ErrorAction SilentlyContinue)
}

function Install-WithWinget($id, $name) {
    Write-Info "Installing $name via winget..."
    winget install --id $id --exact --accept-source-agreements --accept-package-agreements --scope machine
}

Write-Host "ReHoster prerequisite installer" -ForegroundColor White
Write-Host "This script installs or verifies Node.js 20+, Git, and Docker Desktop on Windows." -ForegroundColor White
Write-Host "Log file: $LogFile" -ForegroundColor DarkGray
Write-Log 'Installer started'

if (-not (Test-Admin)) {
    Write-Log 'Not running as administrator'
    Restart-Elevated
}

if (-not (Test-Winget)) {
    Write-ErrorLine 'winget was not found. Install App Installer from the Microsoft Store or install prerequisites manually.'
    Write-Log 'winget not found'
    Finish-Installer 1
}

Write-Section 'Checking Node.js'
$nodeVersion = Get-CommandVersion 'node' @('--version')
if ($nodeVersion) {
    $major = [int](($nodeVersion -replace '^v', '').Split('.')[0])
    if ($major -ge 20) {
        Write-Info "Node.js $nodeVersion already installed"
        Write-Log "Node.js already installed: $nodeVersion"
    } else {
        Write-WarnLine "Node.js $nodeVersion found; upgrading to Node.js 20 LTS"
        Write-Log "Upgrading Node.js from $nodeVersion"
        Install-WithWinget 'OpenJS.NodeJS.LTS' 'Node.js LTS'
    }
} else {
    Write-Log 'Installing Node.js LTS'
    Install-WithWinget 'OpenJS.NodeJS.LTS' 'Node.js LTS'
}

Write-Section 'Checking Git'
$gitVersion = Get-CommandVersion 'git' @('--version')
if ($gitVersion) {
    Write-Info "$gitVersion already installed"
    Write-Log "Git already installed: $gitVersion"
} else {
    Write-Log 'Installing Git'
    Install-WithWinget 'Git.Git' 'Git'
}

Write-Section 'Checking Docker Desktop'
$dockerVersion = Get-CommandVersion 'docker' @('--version')
if ($dockerVersion) {
    Write-Info "$dockerVersion already installed"
    Write-Log "Docker already installed: $dockerVersion"
} else {
    Write-Log 'Installing Docker Desktop'
    Install-WithWinget 'Docker.DockerDesktop' 'Docker Desktop'
}

Write-Section 'Checking Docker daemon'
try {
    docker info *> $null
    Write-Info 'Docker daemon is reachable'
    Write-Log 'Docker daemon reachable'
} catch {
    Write-WarnLine 'Docker CLI is installed, but the daemon is not reachable yet.'
    Write-WarnLine 'Start Docker Desktop and wait for it to finish initialising.'
    Write-Log 'Docker daemon not reachable'
}

Write-Section 'Checking npm'
$npmVersion = Get-CommandVersion 'npm' @('--version')
if ($npmVersion) {
    Write-Info "npm v$npmVersion available"
    Write-Log "npm available: $npmVersion"
} else {
    Write-WarnLine 'npm is not available yet. Open a new PowerShell window after Node.js installation completes.'
    Write-Log 'npm not yet available in current shell'
}

Write-Section 'Done'
Write-Host 'Run .\launch.bat after reopening your terminal.' -ForegroundColor White
Write-Log 'Installer completed'
Finish-Installer 0