'use strict';

const fs = require('fs');
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

function getAllApps() {
  return db.prepare("SELECT * FROM apps WHERE status != 'deleted' ORDER BY created_at DESC").all();
}

function getApp(id) {
  return db.prepare('SELECT * FROM apps WHERE id = ?').get(id) || null;
}

function updateStatus(id, status) {
  db.prepare('UPDATE apps SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(status, id);
}

async function ensureDockerAvailable() {
  const details = await dockerService.getDockerAvailabilityDetails();
  if (!details.available) {
    const reason = `${details.message} [status=${details.status}, cmd=${details.commandInfo.command}]`;
    const error = new Error(`${DOCKER_UNAVAILABLE_MESSAGE} ${reason}`);
    error.status = 503;
    throw error;
  }
}

async function runDockerLifecycleAction(app, action, targetStatus, successMessage) {
  try {
    await ensureDockerAvailable();
    await action();
    updateStatus(app.id, targetStatus);
    logService.addLog(app.id, 'info', successMessage);
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
    const parsed = {};
    for (const line of String(data.envVars).split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eqIndex = trimmed.indexOf('=');
      if (eqIndex < 1) continue;
      const key = trimmed.slice(0, eqIndex).trim();
      const val = trimmed.slice(eqIndex + 1).trim();
      if (key) parsed[key] = val;
    }
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

  return db.prepare('SELECT * FROM apps WHERE id = ?').get(result.lastInsertRowid);
}

async function deployApp(appId) {
  const app = getApp(appId);
  if (!app) throw new Error(`App ${appId} not found`);

  const log = (level, msg) => logService.addLog(appId, level, msg);

  try {
    updateStatus(appId, 'cloning');
    log('info', `Starting deployment for "${app.name}"`);
    log('info', `Cloning ${app.repo_url} (branch: ${app.branch}) into ${app.local_path}`);

    if (fs.existsSync(app.local_path)) {
      fs.rmSync(app.local_path, { recursive: true, force: true });
    }
    ensureDir(app.local_path);

    await gitService.cloneRepo(app.repo_url, app.branch, app.local_path);
    log('info', 'Repository cloned successfully');

    // Detect frameworks
    const frameworks = frameworkDetectService.detectFrameworks(app.local_path);
    const detectedFrameworksJson = JSON.stringify(frameworks);
    db.prepare('UPDATE apps SET detected_frameworks = ? WHERE id = ?').run(detectedFrameworksJson, appId);
    log('info', `Detected frameworks: ${frameworks.map((f) => f.label).join(', ')}`);

    await ensureDockerAvailable();

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

    const existingContainer = await dockerService.inspect(app.container_name);
    if (existingContainer) {
      log('info', `Removing existing container: ${app.container_name}`);
      await dockerService.removeContainer(app.container_name);
    }

    log('info', `Starting container: ${app.container_name} on port ${app.port}`);
    let envVars = {};
    try { envVars = JSON.parse(app.env_vars || '{}'); } catch { envVars = {}; }

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
    'App restarted'
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
      await gitService.pullLatest(app.local_path);
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
  createApp,
  deployApp,
  startApp,
  stopApp,
  restartApp,
  rebuildApp,
  pullAndRedeploy,
  deleteApp,
  getAppLogs,
  getAllGroups,
};
