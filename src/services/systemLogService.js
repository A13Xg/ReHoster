'use strict';

const db = require('../config/db');

function log(level, source, message) {
  setImmediate(() => {
    try {
      db.prepare('INSERT INTO system_logs (level, source, message) VALUES (?, ?, ?)').run(level, source, String(message).slice(0, 2000));
    } catch {}
  });
}

function info(source, message) { log('info', source, message); }
function warn(source, message) { log('warn', source, message); }
function error(source, message) { log('error', source, message); }
function debug(source, message) { log('debug', source, message); }

function getRecentLogs(limit, since) {
  if (since) {
    return db.prepare('SELECT * FROM system_logs WHERE created_at > ? ORDER BY created_at DESC LIMIT ?').all(since, limit);
  }
  return db.prepare('SELECT * FROM system_logs ORDER BY created_at DESC LIMIT ?').all(limit);
}

function pruneOldLogs(retentionDays) {
  db.prepare("DELETE FROM system_logs WHERE created_at < datetime('now', ? || ' days')").run('-' + retentionDays);
}

module.exports = { log, info, warn, error, debug, getRecentLogs, pruneOldLogs };
