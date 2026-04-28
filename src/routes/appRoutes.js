'use strict';

const express = require('express');
const fs = require('fs');
const path = require('path');
const requireAuth = require('../middleware/requireAuth');
const appService = require('../services/appService');
const logService = require('../services/logService');
const config = require('../config/env');
const { safeJoin } = require('../utils/paths');

const router = express.Router();

router.use(requireAuth);

router.get('/admin/apps/new', (req, res) => {
  const groups = appService.getAllGroups();
  res.render('apps/new', {
    title: 'Deploy New App',
    error: null,
    groups,
  });
});

router.post('/admin/apps', async (req, res, next) => {
  try {
    const app = await appService.createApp(req.body);
    appService.deployApp(app.id).catch((err) => {
      logService.addLog(app.id, 'error', `Background deploy failed: ${err.message}`);
      console.error(`Background deploy error for app ${app.id}:`, err.message);
    });
    res.redirect(`/admin/apps/${app.id}`);
  } catch (err) {
    const groups = appService.getAllGroups();
    res.render('apps/new', {
      title: 'Deploy New App',
      error: err.message,
      groups,
    });
  }
});

router.get('/admin/apps/:id', (req, res, next) => {
  try {
    const app = appService.getApp(Number(req.params.id));
    if (!app) return res.status(404).render('error', { title: 'Not Found', status: 404, message: 'App not found', stack: null });
    const logs = require('../services/logService').getAppLogs(app.id, 50);
    let frameworks = [];
    try { frameworks = app.detected_frameworks ? JSON.parse(app.detected_frameworks) : []; } catch {}
    const groups = appService.getAllGroups();
    const group = groups.find((g) => g.id === app.group_id) || null;
    res.render('apps/show', {
      title: app.name,
      app,
      logs,
      baseHost: config.baseHost,
      frameworks,
      group,
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
    appService.rebuildApp(id).catch((err) => {
      logService.addLog(id, 'error', `Background rebuild failed: ${err.message}`);
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
      logService.addLog(id, 'error', `Background pull+redeploy failed: ${err.message}`);
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
    });
  } catch (err) {
    next(err);
  }
});

// File browser
router.get('/admin/apps/:id/files', (req, res, next) => {
  try {
    const app = appService.getApp(Number(req.params.id));
    if (!app) return res.status(404).render('error', { title: 'Not Found', status: 404, message: 'App not found', stack: null });
    if (!app.local_path || !fs.existsSync(app.local_path)) {
      return res.render('apps/files', { title: `Files — ${app.name}`, app, entries: [], currentRelPath: '' });
    }

    const relPath = String(req.query.path || '').replace(/\\/g, '/').replace(/^\/+/, '');
    let browsePath;
    try {
      browsePath = relPath ? safeJoin(app.local_path, relPath) : app.local_path;
    } catch {
      return res.status(400).render('error', { title: 'Bad Request', status: 400, message: 'Invalid path', stack: null });
    }

    if (!fs.existsSync(browsePath) || !fs.statSync(browsePath).isDirectory()) {
      return res.redirect(`/admin/apps/${app.id}/files`);
    }

    const rawEntries = fs.readdirSync(browsePath);
    const entries = rawEntries
      .filter((e) => !e.startsWith('.') || e === '.env')
      .map((name) => {
        const fullPath = path.join(browsePath, name);
        const stat = fs.statSync(fullPath);
        return {
          name,
          isDir: stat.isDirectory(),
          size: stat.size,
          relPath: relPath ? `${relPath}/${name}` : name,
        };
      })
      .sort((a, b) => (a.isDir === b.isDir ? a.name.localeCompare(b.name) : a.isDir ? -1 : 1));

    res.render('apps/files', { title: `Files — ${app.name}`, app, entries, currentRelPath: relPath });
  } catch (err) {
    next(err);
  }
});

// View file content
router.get('/admin/apps/:id/files/view', (req, res, next) => {
  try {
    const app = appService.getApp(Number(req.params.id));
    if (!app || !app.local_path) return res.status(404).json({ error: 'Not found' });
    const relPath = String(req.query.path || '').replace(/\\/g, '/').replace(/^\/+/, '');
    if (!relPath) return res.status(400).json({ error: 'Path required' });
    let filePath;
    try {
      filePath = safeJoin(app.local_path, relPath);
    } catch {
      return res.status(400).json({ error: 'Invalid path' });
    }
    if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
      return res.status(404).json({ error: 'File not found' });
    }
    const stat = fs.statSync(filePath);
    if (stat.size > 1024 * 1024) return res.status(413).json({ error: 'File too large to view (>1MB)' });
    const content = fs.readFileSync(filePath, 'utf8');
    res.json({ content, path: relPath });
  } catch (err) {
    next(err);
  }
});

// Save file content
router.post('/admin/apps/:id/files/save', express.json(), (req, res, next) => {
  try {
    const app = appService.getApp(Number(req.params.id));
    if (!app || !app.local_path) return res.status(404).json({ error: 'Not found' });
    const relPath = String(req.body.path || '').replace(/\\/g, '/').replace(/^\/+/, '');
    if (!relPath) return res.status(400).json({ error: 'Path required' });
    let filePath;
    try {
      filePath = safeJoin(app.local_path, relPath);
    } catch {
      return res.status(400).json({ error: 'Invalid path' });
    }
    if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
      return res.status(404).json({ error: 'File not found' });
    }
    const content = String(req.body.content || '');
    fs.writeFileSync(filePath, content, 'utf8');
    res.json({ ok: true });
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

router.get('/admin/apps/:id/status', (req, res, next) => {
  try {
    const app = appService.getApp(Number(req.params.id));
    if (!app) return res.status(404).json({ error: 'Not found' });
    return res.json({ id: app.id, status: app.status });
  } catch (err) {
    next(err);
  }
});

router.post('/admin/apps/:id/delete', async (req, res, next) => {
  try {
    await appService.deleteApp(Number(req.params.id));
    res.redirect('/admin/apps');
  } catch (err) {
    next(err);
  }
});

module.exports = router;
