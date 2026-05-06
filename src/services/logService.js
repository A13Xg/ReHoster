'use strict';

const db = require('../config/db');

function addLog(appId, level, message) {
  db.prepare(
    'INSERT INTO app_logs (app_id, level, message) VALUES (?, ?, ?)'
  ).run(appId, level || 'info', String(message));
}

function getAppLogs(appId, limit = 200) {
  return db
    .prepare(
      'SELECT id, level, message, created_at FROM app_logs WHERE app_id = ? ORDER BY created_at DESC LIMIT ?'
    )
    .all(appId, limit);
}

function getAppLogsSince(appId, sinceId = 0, limit = 200) {
  return db
    .prepare(
      'SELECT id, level, message, created_at FROM app_logs WHERE app_id = ? AND id > ? ORDER BY id ASC LIMIT ?'
    )
    .all(appId, sinceId, limit);
}

function clearAppLogs(appId) {
  db.prepare('DELETE FROM app_logs WHERE app_id = ?').run(appId);
}

module.exports = { addLog, getAppLogs, getAppLogsSince, clearAppLogs };
