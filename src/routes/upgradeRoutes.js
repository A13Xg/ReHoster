'use strict';

const express = require('express');
const requireAuth = require('../middleware/requireAuth');
const config = require('../config/env');
const { runCommand } = require('../utils/shell');

const router = express.Router();

router.use(requireAuth);

router.get('/admin/upgrade', (req, res) => {
  res.render('upgrade', {
    title: 'Upgrade',
    currentVersion: config.panelVersion,
    checkResult: null,
  });
});

router.post('/admin/upgrade/check', async (req, res, next) => {
  try {
    const result = await runCommand('git', ['fetch', '--dry-run'], { timeout: 15000 });
    const hasUpdates = result.stdout.includes('->') || result.stderr.includes('->');
    res.render('upgrade', {
      title: 'Upgrade',
      currentVersion: config.panelVersion,
      checkResult: { hasUpdates, message: hasUpdates ? 'Updates available' : 'Already up to date' },
    });
  } catch (err) {
    res.render('upgrade', {
      title: 'Upgrade',
      currentVersion: config.panelVersion,
      checkResult: { hasUpdates: false, message: `Check failed: ${err.message}` },
    });
  }
});

router.post('/admin/upgrade/apply', async (req, res, next) => {
  try {
    await runCommand('git', ['pull', '--ff-only'], { timeout: 60000 });
    await runCommand('npm', ['install', '--production'], { timeout: 120000 }).catch(() => {});
    res.render('upgrade', {
      title: 'Upgrade',
      currentVersion: config.panelVersion,
      checkResult: { hasUpdates: false, message: 'Upgrade applied successfully. Please restart the server.' },
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
