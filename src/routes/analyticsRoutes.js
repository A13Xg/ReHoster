'use strict';

const express = require('express');
const requireAuth = require('../middleware/requireAuth');
const db = require('../config/db');

const router = express.Router();

function getAnalyticsData() {
  const total = db.prepare("SELECT COUNT(*) as count FROM traffic_logs WHERE created_at > datetime('now', '-24 hours')").get();
  const byStatus = db.prepare("SELECT status_code, COUNT(*) as count FROM traffic_logs WHERE created_at > datetime('now', '-24 hours') GROUP BY status_code ORDER BY count DESC").all();
  const byPath = db.prepare("SELECT path, COUNT(*) as count FROM traffic_logs WHERE created_at > datetime('now', '-24 hours') GROUP BY path ORDER BY count DESC LIMIT 20").all();
  const byMethod = db.prepare("SELECT method, COUNT(*) as count FROM traffic_logs WHERE created_at > datetime('now', '-24 hours') GROUP BY method ORDER BY count DESC").all();
  const byUaType = db.prepare("SELECT user_agent_type, COUNT(*) as count FROM traffic_logs WHERE created_at > datetime('now', '-24 hours') GROUP BY user_agent_type ORDER BY count DESC").all();
  const avgResponse = db.prepare("SELECT AVG(response_time_ms) as avg_ms FROM traffic_logs WHERE created_at > datetime('now', '-24 hours')").get();
  const hourly = db.prepare("SELECT strftime('%H', created_at) as hour, COUNT(*) as count FROM traffic_logs WHERE created_at > datetime('now', '-24 hours') GROUP BY hour ORDER BY hour ASC").all();
  return { total: total.count, byStatus, byPath, byMethod, byUaType, avgResponseMs: Math.round(avgResponse.avg_ms || 0), hourly };
}

router.get('/admin/analytics', requireAuth, (req, res, next) => {
  try {
    const data = getAnalyticsData();
    res.render('analytics', { title: 'Analytics', ...data });
  } catch (err) {
    next(err);
  }
});

router.get('/analytics.json', (req, res, next) => {
  try {
    res.json(getAnalyticsData());
  } catch (err) {
    next(err);
  }
});

module.exports = router;
