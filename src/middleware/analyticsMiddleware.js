'use strict';

const crypto = require('crypto');
const db = require('../config/db');

const STATIC_EXT = /\.(css|js|png|jpg|jpeg|gif|svg|ico|woff|woff2|ttf|eot|map)$/i;

function categorizeUserAgent(ua) {
  if (!ua) return 'unknown';
  if (/bot|crawler|spider|slurp|facebookexternalhit|twitterbot|linkedinbot/i.test(ua)) return 'bot';
  if (/mozilla|chrome|safari|firefox|opera|edge/i.test(ua)) return 'browser';
  if (/curl|wget|httpie|python|java|go-http|node-fetch|axios/i.test(ua)) return 'api';
  return 'unknown';
}

const insertTraffic = db.prepare(
  'INSERT INTO traffic_logs (app_id, path, method, status_code, response_time_ms, ip_hash, user_agent_type) VALUES (?, ?, ?, ?, ?, ?, ?)'
);

const pruneTraffic = db.prepare(
  "DELETE FROM traffic_logs WHERE created_at < datetime('now', ? || ' days')"
);

function analyticsMiddleware(req, res, next) {
  if (STATIC_EXT.test(req.path)) return next();
  const startTime = Date.now();
  res.on('finish', () => {
    setImmediate(() => {
      try {
        const responseTimeMs = Date.now() - startTime;
        const ip = req.ip || (req.connection && req.connection.remoteAddress) || '';
        const ipHash = crypto.createHash('sha256').update(ip).digest('hex').slice(0, 16);
        const uaType = categorizeUserAgent(req.headers['user-agent']);
        insertTraffic.run(null, req.path.slice(0, 200), req.method, res.statusCode, responseTimeMs, ipHash, uaType);
      } catch {}
    });
  });
  next();
}

function pruneOldTraffic(retentionDays) {
  pruneTraffic.run('-' + retentionDays);
}

module.exports = { analyticsMiddleware, pruneOldTraffic };
