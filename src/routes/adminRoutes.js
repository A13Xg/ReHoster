'use strict';

const express = require('express');
const requireAuth = require('../middleware/requireAuth');
const appService = require('../services/appService');

const router = express.Router();

router.use(requireAuth);

router.get('/admin', (req, res) => {
  res.redirect('/admin/apps');
});

router.get('/admin/apps', (req, res, next) => {
  try {
    const apps = appService.getAllApps();
    const stats = {
      total: apps.length,
      running: apps.filter((a) => a.status === 'running').length,
      stopped: apps.filter((a) => a.status === 'stopped').length,
      failed: apps.filter((a) => a.status === 'failed').length,
      building: apps.filter((a) => ['building', 'cloning'].includes(a.status)).length,
    };
    res.render('apps/index', {
      title: 'Apps',
      apps,
      stats,
      username: req.session.username,
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
