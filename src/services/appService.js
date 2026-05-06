'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const dotenv = require('dotenv');
const db = require('../config/db');
const config = require('../config/env');
const { sanitizeAppName, validateAppInput } = require('../utils/validation');
const { getAppDir, ensureDir } = require('../utils/paths');
const portService = require('./portService');
const gitService = require('./gitService');
const dockerService = require('./dockerService');
const logService = require('./logService');
const frameworkDetectService = require('./frameworkDetectService');

const DOCKER_UNAVAILABLE_MESSAGE = 'Docker is not available in the ReHoster server environment. Ensure the Docker CLI is installed and the Docker daemon is running.';
let dockerAutoRepairAttempted = false;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getPanelBaseUrl() {
  try {
    const url = new URL(config.baseHost);
    if (!url.port) {
      const shouldAddPort = (url.protocol === 'http:' && String(config.port) !== '80')
        || (url.protocol === 'https:' && String(config.port) !== '443');
      if (shouldAddPort) {
        url.port = String(config.port);
      }
    }
    return url.toString().replace(/\/$/, '');
  } catch {
    return `http://localhost:${config.port}`;
  }
}

function buildWebhookUrl(appId, token) {
  return `${getPanelBaseUrl()}/api/webhooks/deploy/${appId}/${token}`;
}

function extractWebhookToken(webhookUrl) {
  if (!webhookUrl) return null;
  try {
    const parsed = new URL(String(webhookUrl));
    const parts = parsed.pathname.split('/').filter(Boolean);
    return parts.length ? parts[parts.length - 1] : null;
  } catch {
    return null;
  }
}

function ensureAppWebhookUrl(app) {
  if (!app) throw new Error('App not found');
  const existingToken = extractWebhookToken(app.webhook_url);
  if (existingToken) return app.webhook_url;

  const token = crypto.randomBytes(24).toString('hex');
  const webhookUrl = buildWebhookUrl(app.id, token);
  db.prepare('UPDATE apps SET webhook_url = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
    .run(webhookUrl, app.id);
  return webhookUrl;
}

function validateWebhookToken(app, token) {
  const expected = extractWebhookToken(app && app.webhook_url);
  return !!expected && expected === String(token || '');
}

function parseEnvVarsInput(rawEnvText) {
  const text = String(rawEnvText || '');
  if (!text.trim()) return {};

  const normalizedText = text
    .split(/\r?\n/)
    .map((line) => line.replace(/^\s*export\s+/, ''))
    .join('\n');

  try {
    return dotenv.parse(normalizedText);
  } catch {
    const fallback = {};
    for (const line of normalizedText.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eqIndex = trimmed.indexOf('=');
      if (eqIndex < 1) continue;
      const key = trimmed.slice(0, eqIndex).trim();
      const val = trimmed.slice(eqIndex + 1).trim();
      if (key) fallback[key] = val;
    }
    return fallback;
  }
}

function normalizeEnvVarsForDocker(envVars) {
  if (!envVars || typeof envVars !== 'object') return {};
  const normalized = {};

  for (const [rawKey, rawVal] of Object.entries(envVars)) {
    const key = String(rawKey || '').trim();
    if (!key) continue;

    let val = rawVal == null ? '' : String(rawVal);
    const hasWrappedDoubleQuotes = val.length >= 2 && val.startsWith('"') && val.endsWith('"');
    const hasWrappedSingleQuotes = val.length >= 2 && val.startsWith("'") && val.endsWith("'");
    if (hasWrappedDoubleQuotes || hasWrappedSingleQuotes) {
      val = val.slice(1, -1);
    }

    normalized[key] = val;
  }

  return normalized;
}

function appUsesIronSession(appLocalPath) {
  if (!appLocalPath) return false;
  const pkgPath = path.join(appLocalPath, 'package.json');
  if (!fs.existsSync(pkgPath)) return false;

  try {
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
    const dependencySets = [pkg.dependencies, pkg.devDependencies, pkg.peerDependencies];
    return dependencySets.some((depSet) => depSet && typeof depSet === 'object' && depSet['iron-session']);
  } catch {
    return false;
  }
}

function ensureDefaultRuntimeSecrets(app, envVarsFromDb, log) {
  const updated = { ...(envVarsFromDb || {}) };
  let changed = false;

  if (appUsesIronSession(app.local_path) && (!updated.SESSION_SECRET || String(updated.SESSION_SECRET).trim().length < 32)) {
    updated.SESSION_SECRET = crypto.randomBytes(32).toString('hex');
    changed = true;
    log('warn', 'SESSION_SECRET was missing for an iron-session app. A secure value was generated automatically.');
  }

  if (changed) {
    db.prepare('UPDATE apps SET env_vars = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
      .run(JSON.stringify(updated), app.id);
  }

  return updated;
}

function loadEnvVarsFromAppFile(appLocalPath, nodeEnv = 'production') {
  if (!appLocalPath) return {};
  const candidates = [
    '.env',
    '.env.local',
    `.env.${nodeEnv}`,
    `.env.${nodeEnv}.local`,
  ];

  const merged = {};
  for (const fileName of candidates) {
    const envPath = path.join(appLocalPath, fileName);
    if (!fs.existsSync(envPath)) continue;

    try {
      const fileContent = fs.readFileSync(envPath, 'utf8');
      const normalizedText = fileContent
        .split(/\r?\n/)
        .map((line) => line.replace(/^\s*export\s+/, ''))
        .join('\n');
      Object.assign(merged, dotenv.parse(normalizedText));
    } catch {
      // Ignore malformed env files and continue with other candidates.
    }
  }

  return merged;
}

function getAllApps() {
  return db.prepare("SELECT * FROM apps WHERE status != 'deleted' ORDER BY created_at DESC").all();
}

function getApp(id) {
  return db.prepare('SELECT * FROM apps WHERE id = ?').get(id) || null;
}

function getEnvVarsTextForApp(app) {
  if (!app) return '';
  let envObj = {};
  try {
    envObj = JSON.parse(app.env_vars || '{}');
  } catch {
    envObj = {};
  }

  return Object.entries(envObj)
    .map(([key, value]) => `${key}=${value == null ? '' : String(value)}`)
    .join('\n');
}

function getWebhookUrlForApp(app) {
  if (!app) return null;
  return ensureAppWebhookUrl(app);
}

function updateAppEnvVars(id, rawEnvText) {
  const app = getApp(id);
  if (!app) throw new Error(`App ${id} not found`);

  const parsed = parseEnvVarsInput(rawEnvText);
  db.prepare('UPDATE apps SET env_vars = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
    .run(JSON.stringify(parsed), id);
  logService.addLog(id, 'info', `Updated app environment variables (${Object.keys(parsed).length} entries)`);
  return parsed;
}

function updateStatus(id, status) {
  db.prepare('UPDATE apps SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(status, id);
}

async function ensureDockerAvailable() {
  const maxAttempts = 3;
  let lastDetails = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const details = await dockerService.getDockerAvailabilityDetails();
    if (details.available) return;
    lastDetails = details;

    const recoverable = ['cli_not_found', 'daemon_unreachable', 'permission_denied'].includes(details.status);
    if (recoverable && !dockerAutoRepairAttempted) {
      dockerAutoRepairAttempted = true;
      try {
        await dockerService.attemptDockerAutoRepair();
      } catch {
        // Best effort fallback only.
      }
    }

    if (attempt < maxAttempts) {
      await sleep(attempt * 1500);
    }
  }

  const reason = `${lastDetails ? lastDetails.message : 'Unknown Docker availability error'} [status=${lastDetails ? lastDetails.status : 'unknown'}, cmd=${lastDetails && lastDetails.commandInfo ? lastDetails.commandInfo.command : 'docker'}]`;
  const error = new Error(`${DOCKER_UNAVAILABLE_MESSAGE} ${reason}`);
  error.status = 503;
  throw error;
}

function logDependencyPreflight(log, appPath) {
  const report = dockerService.analyzeDependencyManifests(appPath);
  const nodeSummary = report.hasPackageJson
    ? `node package manager: ${report.packageManager || 'npm'}${report.hasLockfile ? ' (lockfile found)' : ' (no lockfile)'}`
    : 'node package.json not found';
  const pythonSummary = report.hasPythonManifest
    ? `python manifest detected (${report.hasRequirementsTxt ? 'requirements.txt' : report.hasPyproject ? 'pyproject.toml' : 'Pipfile'})`
    : 'no python manifest detected';

  log('info', `Dependency preflight: ${nodeSummary}; ${pythonSummary}`);
  if (report.hasPackageJson && !report.hasLockfile) {
    log('warn', 'No lockfile detected. Dependency versions may drift between deployments.');
  }
}

async function runDockerLifecycleAction(app, action, targetStatus, successMessage, inProgressStatus = null) {
  try {
    await ensureDockerAvailable();
    if (inProgressStatus) {
      updateStatus(app.id, inProgressStatus);
    }
    await action();
    updateStatus(app.id, targetStatus);
    logService.addLog(app.id, 'info', successMessage);

    if (targetStatus === 'running') {
      try {
        const healthService = require('./healthService');
        await healthService.checkAppHealth(getApp(app.id));
      } catch (err) {
        logService.addLog(app.id, 'warn', `Post-start health check failed: ${err.message}`);
      }
    }
  } catch (err) {
    if (targetStatus === 'running') {
      updateStatus(app.id, 'failed');
    }
    logService.addLog(app.id, 'error', err.message);
    throw err;
  }
}

async function createApp(data) {
  const { valid, errors } = validateAppInput(data);
  if (!valid) throw new Error(errors.join('; '));

  const name = String(data.name).trim();
  const safeName = sanitizeAppName(name);
  if (!safeName) throw new Error('App name produces an empty safe name after sanitization');

  const existing = db.prepare('SELECT id FROM apps WHERE safe_name = ?').get(safeName);
  if (existing) throw new Error(`An app with safe name "${safeName}" already exists`);

  const port = portService.assignPort(data.port || null);
  const containerPort = parseInt(data.containerPort, 10) || config.defaultContainerPort;
  const branch = (data.branch || 'main').trim();
  const localPath = getAppDir(safeName);
  const containerName = `rehoster-${safeName}`;
  const imageName = `rehoster-img-${safeName}`;

  let envVarsJson = '{}';
  if (data.envVars && String(data.envVars).trim().length > 0) {
    const parsed = parseEnvVarsInput(data.envVars);
    envVarsJson = JSON.stringify(parsed);
  }

  const description = data.description ? String(data.description).trim().slice(0, 500) : null;
  const groupId = data.group_id ? parseInt(data.group_id, 10) || null : null;
  const publicHostname = data.public_hostname ? String(data.public_hostname).trim().slice(0, 500) : null;
  const serviceType = data.service_type ? String(data.service_type).trim() : 'auto';
  const tags = data.tags ? String(data.tags).trim().slice(0, 500) : null;
  const cpuLimit = data.cpu_limit ? String(data.cpu_limit).trim() : null;
  const memoryLimit = data.memory_limit ? String(data.memory_limit).trim() : null;
  const webhookUrl = data.webhook_url ? String(data.webhook_url).trim().slice(0, 500) : null;
  const restartSchedule = data.restart_schedule ? String(data.restart_schedule).trim().slice(0, 200) : null;

  const result = db
    .prepare(
      `INSERT INTO apps
        (name, safe_name, repo_url, branch, local_path, port, container_port,
         container_name, image_name, build_command, start_command, env_vars, status,
         description, group_id, public_hostname, service_type, tags, cpu_limit,
         memory_limit, webhook_url, restart_schedule)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'creating', ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      name, safeName, String(data.repoUrl).trim(), branch, localPath, port, containerPort,
      containerName, imageName,
      data.buildCommand || 'npm install && npm run build',
      data.startCommand || 'npm start',
      envVarsJson,
      description, groupId, publicHostname, serviceType, tags, cpuLimit,
      memoryLimit, webhookUrl, restartSchedule
    );

  const createdApp = db.prepare('SELECT * FROM apps WHERE id = ?').get(result.lastInsertRowid);
  ensureAppWebhookUrl(createdApp);
  return getApp(result.lastInsertRowid);
}

async function deployApp(appId) {
  const app = getApp(appId);
  if (!app) throw new Error(`App ${appId} not found`);

  const log = (level, msg) => logService.addLog(appId, level, msg);

  try {
    await ensureDockerAvailable();

    updateStatus(appId, 'cloning');
    log('info', `Starting deployment for "${app.name}"`);
    log('info', `Cloning ${app.repo_url} (branch: ${app.branch}) into ${app.local_path}`);

    if (fs.existsSync(app.local_path)) {
      fs.rmSync(app.local_path, { recursive: true, force: true });
    }
    ensureDir(app.local_path);

    await gitService.cloneRepo(app.repo_url, app.branch, app.local_path);
    log('info', 'Repository cloned successfully');
    logDependencyPreflight(log, app.local_path);

    // Detect frameworks
    const frameworks = frameworkDetectService.detectFrameworks(app.local_path);
    const detectedFrameworksJson = JSON.stringify(frameworks);
    db.prepare('UPDATE apps SET detected_frameworks = ? WHERE id = ?').run(detectedFrameworksJson, appId);
    log('info', `Detected frameworks: ${frameworks.map((f) => f.label).join(', ')}`);

    updateStatus(appId, 'building');
    log('info', 'Preparing Dockerfile');
    await dockerService.generateDockerfile(
      app.local_path,
      app.service_type,
      detectedFrameworksJson,
      app.build_command,
      app.start_command,
      app.container_port
    );

    log('info', `Building Docker image: ${app.image_name}`);
    const buildResult = await dockerService.buildImage(app.local_path, app.image_name);
    log('info', 'Docker image built successfully');
    if (buildResult.stdout) log('info', buildResult.stdout.slice(0, 2000));

    updateStatus(appId, 'staging');
    const existingContainer = await dockerService.inspect(app.container_name);
    if (existingContainer) {
      log('info', `Removing existing container: ${app.container_name}`);
      await dockerService.removeContainer(app.container_name);
    }

    log('info', `Starting container: ${app.container_name} on port ${app.port}`);
    let envVarsFromDb = {};
    try { envVarsFromDb = JSON.parse(app.env_vars || '{}'); } catch { envVarsFromDb = {}; }
    envVarsFromDb = ensureDefaultRuntimeSecrets(app, envVarsFromDb, log);
    const envVarsFromFile = loadEnvVarsFromAppFile(app.local_path, config.nodeEnv || 'production');
    const envVars = normalizeEnvVarsForDocker({
      ...envVarsFromFile,
      ...envVarsFromDb,
    });

    if (Object.keys(envVarsFromFile).length > 0) {
      log('info', `Loaded ${Object.keys(envVarsFromFile).length} env var(s) from .env file`);
    }
    if (Object.keys(envVarsFromDb).length > 0) {
      log('info', `Loaded ${Object.keys(envVarsFromDb).length} env var(s) from panel configuration`);
    }

    await dockerService.runContainer({
      imageName: app.image_name,
      containerName: app.container_name,
      hostPort: app.port,
      containerPort: app.container_port,
      envVars,
      restartPolicy: config.dockerRestartPolicy,
      cpuLimit: app.cpu_limit || null,
      memoryLimit: app.memory_limit || null,
    });

    db.prepare(
      'UPDATE apps SET status = ?, last_deployed_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = ?'
    ).run('running', appId);

    try {
      const healthService = require('./healthService');
      await healthService.checkAppHealth(getApp(appId));
    } catch (err) {
      log('warn', `Post-deploy health check failed: ${err.message}`);
    }

    log('info', `App "${app.name}" deployed successfully and running on port ${app.port}`);
  } catch (err) {
    updateStatus(appId, 'failed');
    log('error', `Deployment failed: ${err.message}`);
    throw err;
  }
}

async function startApp(id) {
  const app = getApp(id);
  if (!app) throw new Error(`App ${id} not found`);
  await runDockerLifecycleAction(
    app,
    () => dockerService.startContainer(app.container_name),
    'running',
    'App started'
  );
}

async function stopApp(id) {
  const app = getApp(id);
  if (!app) throw new Error(`App ${id} not found`);
  await runDockerLifecycleAction(
    app,
    () => dockerService.stopContainer(app.container_name),
    'stopped',
    'App stopped'
  );
}

async function restartApp(id) {
  const app = getApp(id);
  if (!app) throw new Error(`App ${id} not found`);
  await runDockerLifecycleAction(
    app,
    () => dockerService.restartContainer(app.container_name),
    'running',
    'App restarted',
    'restarting'
  );
}

async function rebuildApp(id) {
  const app = getApp(id);
  if (!app) throw new Error(`App ${id} not found`);
  try {
    await ensureDockerAvailable();
    logService.addLog(id, 'info', 'Rebuild triggered — stopping and removing old container/image');
    await dockerService.stopContainer(app.container_name).catch(() => {});
    await dockerService.removeContainer(app.container_name).catch(() => {});
    await dockerService.removeImage(app.image_name).catch(() => {});
    await deployApp(id);
  } catch (err) {
    updateStatus(id, 'failed');
    logService.addLog(id, 'error', err.message);
    throw err;
  }
}

async function pullAndRedeploy(id) {
  const app = getApp(id);
  if (!app) throw new Error(`App ${id} not found`);
  try {
    await ensureDockerAvailable();
    logService.addLog(id, 'info', 'Pull & redeploy triggered');
    if (app.local_path && fs.existsSync(app.local_path)) {
      await gitService.pullLatest(app.local_path, app.branch);
      logService.addLog(id, 'info', 'git pull completed');
    }
    await dockerService.stopContainer(app.container_name).catch(() => {});
    await dockerService.removeContainer(app.container_name).catch(() => {});
    await dockerService.removeImage(app.image_name).catch(() => {});
    await deployApp(id);
  } catch (err) {
    updateStatus(id, 'failed');
    logService.addLog(id, 'error', err.message);
    throw err;
  }
}

let autoUpdateCheckRunning = false;

async function checkForRepoUpdates() {
  if (autoUpdateCheckRunning) return [];
  autoUpdateCheckRunning = true;

  try {
    const apps = db.prepare("SELECT * FROM apps WHERE status != 'deleted' ORDER BY id ASC").all();
    const results = [];

    for (const app of apps) {
      try {
        if (!app.repo_url || !app.local_path || !fs.existsSync(app.local_path)) {
          results.push({ appId: app.id, status: 'skipped', reason: 'missing_local_repo' });
          continue;
        }

        if (['creating', 'cloning', 'building', 'staging', 'restarting'].includes(app.status)) {
          results.push({ appId: app.id, status: 'skipped', reason: 'deployment_in_progress' });
          continue;
        }

        const remoteState = await gitService.hasRemoteChanges(app.local_path, app.branch || 'main');
        if (!remoteState.changed) {
          results.push({ appId: app.id, status: 'up_to_date', local: remoteState.local, remote: remoteState.remote });
          continue;
        }

        logService.addLog(app.id, 'info', `Auto-update detected new commit (${remoteState.local.slice(0, 7)} -> ${remoteState.remote.slice(0, 7)}). Starting pull & redeploy.`);
        await pullAndRedeploy(app.id);
        results.push({ appId: app.id, status: 'updated', local: remoteState.local, remote: remoteState.remote });
      } catch (err) {
        logService.addLog(app.id, 'warn', `Auto-update check failed: ${err.message}`);
        results.push({ appId: app.id, status: 'error', error: err.message });
      }
    }

    return results;
  } finally {
    autoUpdateCheckRunning = false;
  }
}

async function deleteApp(id) {
  const app = getApp(id);
  if (!app) throw new Error(`App ${id} not found`);

  // Deletion should still work even if Docker CLI/daemon is unavailable.
  try {
    await ensureDockerAvailable();
    await dockerService.stopContainer(app.container_name).catch(() => {});
    await dockerService.removeContainer(app.container_name).catch(() => {});
    await dockerService.removeImage(app.image_name).catch(() => {});
  } catch (err) {
    logService.addLog(id, 'warn', `Docker cleanup skipped during delete: ${err.message}`);
  }

  if (app.local_path && fs.existsSync(app.local_path)) {
    fs.rmSync(app.local_path, { recursive: true, force: true });
  }

  db.prepare('DELETE FROM app_logs WHERE app_id = ?').run(id);
  db.prepare('DELETE FROM apps WHERE id = ?').run(id);
}

async function getAppLogs(id) {
  const app = getApp(id);
  if (!app) throw new Error(`App ${id} not found`);

  const dbLogs = logService.getAppLogs(id, 200);
  let dockerLogs = '';
  try {
    await ensureDockerAvailable();
    dockerLogs = await dockerService.getLogs(app.container_name, 200);
  } catch {
    dockerLogs = '(Docker logs unavailable)';
  }

  return { dbLogs, dockerLogs };
}

function getAllGroups() {
  return db.prepare('SELECT * FROM groups ORDER BY name ASC').all();
}

module.exports = {
  getAllApps,
  getApp,
  getEnvVarsTextForApp,
  getWebhookUrlForApp,
  validateWebhookToken,
  updateAppEnvVars,
  createApp,
  deployApp,
  startApp,
  stopApp,
  restartApp,
  rebuildApp,
  pullAndRedeploy,
  checkForRepoUpdates,
  deleteApp,
  getAppLogs,
  getAllGroups,
};
