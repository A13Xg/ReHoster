'use strict';

const express = require('express');
const requireAuth = require('../middleware/requireAuth');
const metricsService = require('../services/metricsService');

const router = express.Router();

router.get('/admin/metrics', requireAuth, async (req, res, next) => {
  try {
    const summary = metricsService.getMetricsSummary();
    res.render('metrics', {
      title: 'System Metrics',
      systemMetrics: summary.systemMetrics,
      appMetrics: summary.appMetrics,
    });
  } catch (err) {
    next(err);
  }
});

router.get('/metrics.json', async (req, res, next) => {
  try {
    const summary = metricsService.getMetricsSummary();
    res.json(summary);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
