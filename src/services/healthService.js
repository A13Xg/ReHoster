'use strict';

const http = require('http');
const https = require('https');
const db = require('../config/db');

function httpGet(url, timeoutMs) {
  return new Promise((resolve) => {
    let parsed;
    try { parsed = new URL(url); } catch { return resolve({ ok: false, status: 0 }); }
    const client = parsed.protocol === 'https:' ? https : http;
    const req = client.get(url, { timeout: timeoutMs }, (res) => {
      res.resume();
      resolve({ ok: true, status: res.statusCode });
    });
    req.on('error', () => resolve({ ok: false, status: 0 }));
    req.on('timeout', () => { req.destroy(); resolve({ ok: false, status: 0 }); });
    setTimeout(() => { req.destroy(); resolve({ ok: false, status: 0 }); }, timeoutMs + 500);
  });
}

async function checkAppHealth(app) {
  const internalUrl = `http://localhost:${app.port}`;
  const internal = await httpGet(internalUrl, 3000);
  let external = null;
  if (app.public_hostname) {
    external = await httpGet(app.public_hostname, 3000);
  }
  const healthStatus = internal.ok ? 'healthy' : 'unhealthy';
  db.prepare('UPDATE apps SET last_health_check = CURRENT_TIMESTAMP, health_status = ? WHERE id = ?').run(healthStatus, app.id);
  return { internal, external, healthStatus };
}

async function checkAllApps() {
  const apps = db.prepare("SELECT * FROM apps WHERE status = 'running'").all();
  const results = await Promise.all(
    apps.map((app) => checkAppHealth(app).catch(() => ({ internal: { ok: false }, external: null, healthStatus: 'unknown' })))
  );
  return apps.map((app, i) => ({ app, ...results[i] }));
}

module.exports = { checkAppHealth, checkAllApps };
