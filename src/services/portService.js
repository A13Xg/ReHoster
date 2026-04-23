'use strict';

const db = require('../config/db');
const config = require('../config/env');

function getUsedPorts() {
  const rows = db
    .prepare("SELECT port FROM apps WHERE status != 'deleted' AND port IS NOT NULL")
    .all();
  return new Set(rows.map((r) => r.port));
}

function assignPort(requestedPort) {
  const used = getUsedPorts();
  const { appPortStart, appPortEnd } = config;

  if (requestedPort !== undefined && requestedPort !== null && requestedPort !== '') {
    const p = parseInt(requestedPort, 10);
    if (Number.isInteger(p) && p >= appPortStart && p <= appPortEnd && !used.has(p)) {
      return p;
    }
    throw new Error(
      `Requested port ${requestedPort} is unavailable or out of range (${appPortStart}-${appPortEnd})`
    );
  }

  for (let p = appPortStart; p <= appPortEnd; p++) {
    if (!used.has(p)) return p;
  }
  throw new Error(`No available ports in range ${appPortStart}-${appPortEnd}`);
}

function releasePort(_port) {
  // No-op: ports are freed automatically when the app row is deleted or status set to 'deleted'
}

module.exports = { getUsedPorts, assignPort, releasePort };
