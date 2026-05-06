'use strict';

const express = require('express');
const requireAuth = require('../middleware/requireAuth');
const settingsService = require('../services/settingsService');
const timeService = require('../services/timeService');

const router = express.Router();

router.use(requireAuth);

router.get('/admin/settings', async (req, res, next) => {
  try {
    const settings = settingsService.getAllSettings();
    let networkTime = null;
    let networkTimeSource = null;
    let timeError = null;

    try {
      const serverTime = await timeService.getTimeFromServer();
      networkTime = serverTime.utcIso;
      networkTimeSource = serverTime.source;
    } catch (err) {
      timeError = err.message;
    }

    res.render('settings', {
      title: 'Settings',
      settings,
      saved: req.query.saved === '1',
      networkTime,
      networkTimeSource,
      timeError,
    });
  } catch (err) {
    next(err);
  }
});

router.post('/admin/settings', (req, res, next) => {
  try {
    const allowed = [
      'theme', 'panel_name', 'locale', 'auto_update_check', 'auto_update_interval',
      'port_range_start', 'port_range_end', 'docker_restart_policy',
      'analytics_retention_days', 'log_retention_days',
    ];
    const updates = {};
    for (const key of allowed) {
      if (req.body[key] !== undefined) {
        updates[key] = String(req.body[key]).trim();
      }
    }
    settingsService.setMany(updates);
    res.redirect('/admin/settings?saved=1');
  } catch (err) {
    next(err);
  }
});

router.get('/admin/settings/export', (req, res, next) => {
  try {
    const settings = settingsService.getAllSettings();
    const json = JSON.stringify(settings, null, 2);
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', 'attachment; filename="rehoster-settings.json"');
    res.send(json);
  } catch (err) {
    next(err);
  }
});

router.post('/admin/settings/import', express.json(), (req, res, next) => {
  try {
    const body = req.body;
    if (!body || typeof body !== 'object') throw new Error('Invalid JSON');
    const allowed = [
      'theme', 'panel_name', 'locale', 'auto_update_check', 'auto_update_interval',
      'port_range_start', 'port_range_end', 'docker_restart_policy',
      'analytics_retention_days', 'log_retention_days',
    ];
    const updates = {};
    for (const key of allowed) {
      if (body[key] !== undefined) updates[key] = String(body[key]);
    }
    settingsService.setMany(updates);
    res.redirect('/admin/settings?saved=1');
  } catch (err) {
    next(err);
  }
});

module.exports = router;
