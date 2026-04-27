'use strict';

require('dotenv').config();

const pino = require('pino');
const logger = pino({ level: 'info' }, pino.destination({ dest: 1, sync: false }));

async function main() {
  const { execFile } = require('child_process');
  const path = require('path');
  const initPath = path.join(__dirname, 'db', 'init.js');

  await new Promise((resolve, reject) => {
    execFile(process.execPath, [initPath], { env: process.env }, (err, stdout, stderr) => {
      if (stdout) process.stdout.write(stdout);
      if (stderr) process.stderr.write(stderr);
      if (err) return reject(err);
      resolve();
    });
  });

  const config = require('./config/env');
  const app = require('./app');

  // Prune old logs on startup
  try {
    const settingsService = require('./services/settingsService');
    const { analyticsMiddleware, pruneOldTraffic } = require('./middleware/analyticsMiddleware');
    const systemLogService = require('./services/systemLogService');

    const retentionDays = parseInt(settingsService.getSetting('log_retention_days', '30'), 10) || 30;
    const analyticsRetention = parseInt(settingsService.getSetting('analytics_retention_days', '7'), 10) || 7;
    systemLogService.pruneOldLogs(retentionDays);
    pruneOldTraffic(analyticsRetention);
  } catch (err) {
    logger.warn({ err }, 'Failed to prune old logs on startup');
  }

  // Periodic metrics collection every 60 seconds
  const metricsService = require('./services/metricsService');
  setInterval(async () => {
    try {
      await metricsService.collectSystemMetrics();
    } catch {}
  }, 60 * 1000);

  // Health checks every 5 minutes
  const healthService = require('./services/healthService');
  setInterval(async () => {
    try {
      await healthService.checkAllApps();
    } catch {}
  }, 5 * 60 * 1000);

  app.listen(config.port, () => {
    logger.info(`ReHoster panel running on port ${config.port} [${config.nodeEnv}]`);
    logger.info(`Open: http://localhost:${config.port}`);
  });
}

main().catch((err) => {
  console.error('Startup failed:', err);
  process.exit(1);
});
