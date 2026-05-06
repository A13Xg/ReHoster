'use strict';

require('dotenv').config();

function requireEnv(name, defaultValue) {
  const value = process.env[name];
  if (value === undefined || value === '') {
    if (defaultValue !== undefined) return defaultValue;
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

const config = {
  nodeEnv: requireEnv('NODE_ENV', 'development'),
  port: parseInt(requireEnv('PORT', '3000'), 10),
  locale: requireEnv('LOCALE', 'en-US'),
  sessionSecret: requireEnv('SESSION_SECRET', 'dev-secret-change-in-production'),
  adminUsername: requireEnv('ADMIN_USERNAME', 'Admin'),
  adminPassword: requireEnv('ADMIN_PASSWORD', 'ReHostPassword'),
  databasePath: requireEnv('DATABASE_PATH', './data/hosting-panel.sqlite'),
  managedAppsDir: requireEnv('MANAGED_APPS_DIR', './managed-apps'),
  appPortStart: parseInt(requireEnv('APP_PORT_START', '4000'), 10),
  appPortEnd: parseInt(requireEnv('APP_PORT_END', '4999'), 10),
  baseHost: requireEnv('BASE_HOST', 'http://localhost'),
  defaultContainerPort: parseInt(requireEnv('DEFAULT_CONTAINER_PORT', '3000'), 10),
  dockerRestartPolicy: requireEnv('DOCKER_RESTART_POLICY', 'unless-stopped'),
  panelVersion: (() => { try { return require('../../package.json').version || '1.0.0'; } catch { return '1.0.0'; } })(),
};

if (isNaN(config.port) || config.port < 1 || config.port > 65535) {
  throw new Error(`Invalid PORT value: ${process.env.PORT}`);
}
if (isNaN(config.appPortStart) || isNaN(config.appPortEnd)) {
  throw new Error('APP_PORT_START and APP_PORT_END must be valid integers');
}
if (config.appPortStart >= config.appPortEnd) {
  throw new Error('APP_PORT_START must be less than APP_PORT_END');
}

module.exports = config;
