'use strict';

const express = require('express');
const requireAuth = require('../middleware/requireAuth');
const systemLogService = require('../services/systemLogService');
const appService = require('../services/appService');
const settingsService = require('../services/settingsService');
const maintenanceService = require('../services/maintenanceService');

const router = express.Router();

router.get('/api/system-logs', requireAuth, (req, res, next) => {
  try {
    const since = req.query.since ? String(req.query.since) : null;
    const limit = Math.min(parseInt(req.query.limit, 10) || 50, 200);
    const logs = systemLogService.getRecentLogs(limit, since);
    res.json({ logs });
  } catch (err) {
    next(err);
  }
});

router.post('/admin/apps/:id/bulk-action', requireAuth, async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const action = String(req.body.action || '');
    if (action === 'start') await appService.startApp(id);
    else if (action === 'stop') await appService.stopApp(id);
    else if (action === 'restart') await appService.restartApp(id);
    else throw new Error(`Unknown action: ${action}`);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

router.get('/admin/maintenance-preview', requireAuth, (req, res, next) => {
  try {
    const settings = settingsService.getAllSettings();
    const html = maintenanceService.getMaintenanceHtml(settings);
    res.render('maintenance-preview', { title: 'Maintenance Preview', previewHtml: html });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
