'use strict';

const http = require('http');
const https = require('https');
const db = require('../config/db');
const dockerService = require('./dockerService');

function httpGet(url, timeoutMs) {
  return new Promise((resolve) => {
    let parsed;
    try { parsed = new URL(url); } catch { return resolve({ ok: false, status: 0 }); }
    const client = parsed.protocol === 'https:' ? https : http;
    const req = client.get(url, { timeout: timeoutMs }, (res) => {
      res.resume();
      const status = res.statusCode || 0;
      resolve({ ok: status >= 200 && status < 500, status });
    });
    req.on('error', () => resolve({ ok: false, status: 0 }));
    req.on('timeout', () => { req.destroy(); resolve({ ok: false, status: 0 }); });
    setTimeout(() => { req.destroy(); resolve({ ok: false, status: 0 }); }, timeoutMs + 500);
  });
}

async function probeFirstHealthy(baseUrl, paths, timeoutMs) {
  for (const p of paths) {
    const normalizedPath = p.startsWith('/') ? p : `/${p}`;
    const target = new URL(normalizedPath, baseUrl).toString();
    const result = await httpGet(target, timeoutMs);
    if (result.ok) return { ...result, url: target };
  }
  return { ok: false, status: 0, url: baseUrl };
}

async function checkAppHealth(app) {
  const probePaths = ['/health', '/api/health', '/status', '/'];
  const internalUrl = `http://localhost:${app.port}`;
  const internal = await probeFirstHealthy(internalUrl, probePaths, 3000);

  let containerRunning = false;
  try {
    const inspectData = await dockerService.inspect(app.container_name);
    containerRunning = !!(inspectData && inspectData.State && inspectData.State.Running);
  } catch {
    containerRunning = false;
  }

  let external = null;
  if (app.public_hostname) {
    external = await probeFirstHealthy(app.public_hostname, probePaths, 3000);
  }

  let healthStatus = 'unknown';
  if (!containerRunning) {
    healthStatus = 'unhealthy';
  } else if (internal.ok && (!external || external.ok)) {
    healthStatus = 'healthy';
  } else if (internal.ok && external && !external.ok) {
    healthStatus = 'degraded';
  } else {
    healthStatus = 'unhealthy';
  }

  db.prepare('UPDATE apps SET last_health_check = CURRENT_TIMESTAMP, health_status = ? WHERE id = ?').run(healthStatus, app.id);
  return { internal, external, containerRunning, healthStatus };
}

async function checkAllApps() {
  const apps = db.prepare("SELECT * FROM apps WHERE status = 'running'").all();
  const results = await Promise.all(
    apps.map((app) => checkAppHealth(app).catch(() => ({ internal: { ok: false }, external: null, healthStatus: 'unknown' })))
  );
  return apps.map((app, i) => ({ app, ...results[i] }));
}

module.exports = { checkAppHealth, checkAllApps };
