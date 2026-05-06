'use strict';

const express = require('express');
const requireAuth = require('../middleware/requireAuth');
const appService = require('../services/appService');

const router = express.Router();

router.use(requireAuth);

router.get('/admin', (req, res) => {
  res.redirect('/admin/apps');
});

router.get('/admin/apps', async (req, res, next) => {
  try {
    const apps = await appService.syncAllAppStatusesWithDocker();
    const groups = appService.getAllGroups();
    const stats = {
      total: apps.length,
      running: apps.filter((a) => a.status === 'running').length,
      stopped: apps.filter((a) => a.status === 'stopped').length,
      missing: apps.filter((a) => a.status === 'missing').length,
      failed: apps.filter((a) => a.status === 'failed').length,
      building: apps.filter((a) => ['building', 'cloning'].includes(a.status)).length,
    };

    // Attach group info and parse frameworks for each app
    const groupMap = {};
    for (const g of groups) groupMap[g.id] = g;

    const appsWithMeta = apps.map((app) => {
      let frameworks = [];
      try { frameworks = app.detected_frameworks ? JSON.parse(app.detected_frameworks) : []; } catch {}
      return { ...app, frameworks, group: groupMap[app.group_id] || null };
    });

    res.render('apps/index', {
      title: 'Apps',
      apps: appsWithMeta,
      groups,
      stats,
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
