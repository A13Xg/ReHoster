'use strict';

const express = require('express');
const requireAuth = require('../middleware/requireAuth');
const appService = require('../services/appService');
const config = require('../config/env');

const router = express.Router();

router.use(requireAuth);

router.get('/admin/apps/new', (req, res) => {
  res.render('apps/new', {
    title: 'Deploy New App',
    error: null,
    username: req.session.username,
  });
});

router.post('/admin/apps', async (req, res, next) => {
  try {
    const app = await appService.createApp(req.body);
    // Deploy runs in background — do not await
    appService.deployApp(app.id).catch((err) => {
      console.error(`Background deploy error for app ${app.id}:`, err.message);
    });
    res.redirect(`/admin/apps/${app.id}`);
  } catch (err) {
    res.render('apps/new', {
      title: 'Deploy New App',
      error: err.message,
      username: req.session.username,
    });
  }
});

router.get('/admin/apps/:id', (req, res, next) => {
  try {
    const app = appService.getApp(Number(req.params.id));
    if (!app) return res.status(404).render('error', { title: 'Not Found', status: 404, message: 'App not found', stack: null });
    const logs = require('../services/logService').getAppLogs(app.id, 50);
    res.render('apps/show', {
      title: app.name,
      app,
      logs,
      baseHost: config.baseHost,
      username: req.session.username,
    });
  } catch (err) {
    next(err);
  }
});

router.post('/admin/apps/:id/start', async (req, res, next) => {
  try {
    await appService.startApp(Number(req.params.id));
    res.redirect(`/admin/apps/${req.params.id}`);
  } catch (err) {
    next(err);
  }
});

router.post('/admin/apps/:id/stop', async (req, res, next) => {
  try {
    await appService.stopApp(Number(req.params.id));
    res.redirect(`/admin/apps/${req.params.id}`);
  } catch (err) {
    next(err);
  }
});

router.post('/admin/apps/:id/restart', async (req, res, next) => {
  try {
    await appService.restartApp(Number(req.params.id));
    res.redirect(`/admin/apps/${req.params.id}`);
  } catch (err) {
    next(err);
  }
});

router.post('/admin/apps/:id/rebuild', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    // Run rebuild in background
    appService.rebuildApp(id).catch((err) => {
      console.error(`Background rebuild error for app ${id}:`, err.message);
    });
    res.redirect(`/admin/apps/${id}`);
  } catch (err) {
    next(err);
  }
});

router.post('/admin/apps/:id/pull', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    appService.pullAndRedeploy(id).catch((err) => {
      console.error(`Background pull+redeploy error for app ${id}:`, err.message);
    });
    res.redirect(`/admin/apps/${id}`);
  } catch (err) {
    next(err);
  }
});

router.get('/admin/apps/:id/logs', async (req, res, next) => {
  try {
    const app = appService.getApp(Number(req.params.id));
    if (!app) return res.status(404).render('error', { title: 'Not Found', status: 404, message: 'App not found', stack: null });
    const { dbLogs, dockerLogs } = await appService.getAppLogs(app.id);
    res.render('apps/logs', {
      title: `Logs — ${app.name}`,
      app,
      dbLogs,
      dockerLogs,
      username: req.session.username,
    });
  } catch (err) {
    next(err);
  }
});

router.delete('/admin/apps/:id', async (req, res, next) => {
  try {
    await appService.deleteApp(Number(req.params.id));
    res.redirect('/admin/apps');
  } catch (err) {
    next(err);
  }
});

// JSON status endpoint for client-side polling
router.get('/admin/apps/:id/status', (req, res, next) => {
  try {
    const app = appService.getApp(Number(req.params.id));
    if (!app) return res.status(404).json({ error: 'Not found' });
    return res.json({ id: app.id, status: app.status });
  } catch (err) {
    next(err);
  }
});

// POST fallback for delete (HTML forms don't support DELETE)
router.post('/admin/apps/:id/delete', async (req, res, next) => {
  try {
    await appService.deleteApp(Number(req.params.id));
    res.redirect('/admin/apps');
  } catch (err) {
    next(err);
  }
});

module.exports = router;
