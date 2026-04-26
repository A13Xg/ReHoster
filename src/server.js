'use strict';

require('dotenv').config();

const pino = require('pino');
const logger = pino(
  { level: 'info' },
  pino.destination({ dest: 1, sync: false })
);

async function main() {
  // Run DB init on startup
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

  app.listen(config.port, () => {
    logger.info(`ReHoster panel running on port ${config.port} [${config.nodeEnv}]`);
    logger.info(`Open: http://localhost:${config.port}`);
  });
}

main().catch((err) => {
  console.error('Startup failed:', err);
  process.exit(1);
});
