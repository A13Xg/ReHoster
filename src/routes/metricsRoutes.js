'use strict';

const express = require('express');
const requireAuth = require('../middleware/requireAuth');
const metricsService = require('../services/metricsService');

const router = express.Router();

router.get('/admin/metrics', requireAuth, async (req, res, next) => {
  try {
    const summary = metricsService.getMetricsSummary();
    const lastDay = metricsService.getMetricsTimeseries(24 * 60 * 60);
    const lastHour = metricsService.getMetricsTimeseries(60 * 60);
    res.render('metrics', {
      title: 'System Metrics',
      systemMetrics: summary.systemMetrics,
      appMetrics: summary.appMetrics,
      chartsData: {
        lastDay: JSON.stringify(lastDay),
        lastHour: JSON.stringify(lastHour),
      },
    });
  } catch (err) {
    next(err);
  }
});

router.get('/metrics.json', async (req, res, next) => {
  try {
    const range = parseInt(req.query.range || '3600', 10);
    const summary = metricsService.getMetricsSummary();
    const timeseries = metricsService.getMetricsTimeseries(range);
    res.json({ summary, timeseries });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
