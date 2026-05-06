'use strict';

const express = require('express');
const requireAuth = require('../middleware/requireAuth');
const config = require('../config/env');
const updateService = require('../services/updateService');
const { runCommand } = require('../utils/shell');

const router = express.Router();

router.use(requireAuth);

router.get('/admin/upgrade', async (req, res) => {
  const cachedStatus = updateService.getCachedStatus();
  res.render('upgrade', {
    title: 'Upgrade',
    currentVersion: config.panelVersion,
    checkResult: null,
    updateStatus: cachedStatus,
  });
});

router.post('/admin/upgrade/check', async (req, res, next) => {
  try {
    const updateStatus = await updateService.checkForUpdates();
    const gitResult = await runCommand('git', ['fetch', '--dry-run'], { timeout: 15000 });
    const gitHasUpdates = gitResult.stdout.includes('->') || gitResult.stderr.includes('->');
    res.render('upgrade', {
      title: 'Upgrade',
      currentVersion: config.panelVersion,
      checkResult: { hasUpdates: gitHasUpdates, message: gitHasUpdates ? 'Updates available' : 'Already up to date' },
      updateStatus,
    });
  } catch (err) {
    const cachedStatus = updateService.getCachedStatus();
    res.render('upgrade', {
      title: 'Upgrade',
      currentVersion: config.panelVersion,
      checkResult: { hasUpdates: false, message: `Check failed: ${err.message}` },
      updateStatus: cachedStatus,
    });
  }
});

router.post('/admin/upgrade/apply', async (req, res, next) => {
  try {
    await runCommand('git', ['pull', '--ff-only'], { timeout: 60000 });
    await runCommand('npm', ['install', '--production'], { timeout: 120000 }).catch(() => {});
    const updateStatus = updateService.getCachedStatus();
    res.render('upgrade', {
      title: 'Upgrade',
      currentVersion: config.panelVersion,
      checkResult: { hasUpdates: false, message: 'Upgrade applied successfully. Please restart the server.' },
      updateStatus,
    });
  } catch (err) {
    const updateStatus = updateService.getCachedStatus();
    res.render('upgrade', {
      title: 'Upgrade',
      currentVersion: config.panelVersion,
      checkResult: { hasUpdates: false, message: `Upgrade failed: ${err.message}` },
      updateStatus,
    });
  }
});

module.exports = router;
