'use strict';

const express = require('express');
const requireAuth = require('../middleware/requireAuth');
const systemLogService = require('../services/systemLogService');
const appService = require('../services/appService');

const router = express.Router();

router.post('/api/webhooks/deploy/:id/:token', express.json({ type: '*/*' }), async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const token = String(req.params.token || '');
    const app = appService.getApp(id);
    if (!app) return res.status(404).json({ error: 'Not found' });
    if (!appService.validateWebhookToken(app, token)) {
      return res.status(403).json({ error: 'Invalid webhook token' });
    }

    const event = String(req.headers['x-github-event'] || req.headers['x-gitlab-event'] || 'push').toLowerCase();
    if (event.includes('ping')) {
      return res.json({ ok: true, message: 'Webhook reachable' });
    }

    const ref = req.body && typeof req.body.ref === 'string' ? req.body.ref : null;
    const branchFromPayload = ref && ref.startsWith('refs/heads/') ? ref.replace('refs/heads/', '') : null;
    if (branchFromPayload && app.branch && branchFromPayload !== app.branch) {
      return res.json({ ok: true, skipped: true, reason: `branch_mismatch:${branchFromPayload}` });
    }

    appService.pullAndRedeploy(id).catch((err) => {
      console.error(`Webhook redeploy error for app ${id}:`, err.message);
    });

    return res.json({ ok: true, queued: true });
  } catch (err) {
    next(err);
  }
});

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

module.exports = router;
