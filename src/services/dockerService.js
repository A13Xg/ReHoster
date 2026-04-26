'use strict';

const fs = require('fs');
const path = require('path');
const { runCommand } = require('../utils/shell');
const config = require('../config/env');

const DEFAULT_DOCKERFILE = `FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm install --omit=dev
COPY . .
RUN npm run build || true
ENV PORT=3000
EXPOSE 3000
CMD ["npm", "start"]
`;

const DEFAULT_DOCKERIGNORE = `node_modules
.git
.env
.DS_Store
npm-debug.log
`;

async function isDockerAvailable() {
  const result = await runCommand('docker', ['info'], { timeout: 10000 });
  return result.exitCode === 0;
}

async function buildImage(appPath, imageName) {
  const result = await runCommand('docker', ['build', '-t', imageName, appPath], {
    cwd: appPath,
    timeout: 10 * 60 * 1000,
  });
  if (result.exitCode !== 0) {
    throw new Error(`Docker build failed:\n${result.stderr}`);
  }
  return result;
}

async function runContainer({ imageName, containerName, hostPort, containerPort, envVars, restartPolicy }) {
  const args = ['run', '-d', '--name', containerName, '-p', `${hostPort}:${containerPort}`];

  if (restartPolicy) {
    args.push('--restart', restartPolicy);
  }

  if (envVars && typeof envVars === 'object') {
    for (const [key, val] of Object.entries(envVars)) {
      args.push('-e', `${key}=${val}`);
    }
  }

  args.push(imageName);

  const result = await runCommand('docker', args, { timeout: 30000 });
  if (result.exitCode !== 0) {
    throw new Error(`docker run failed:\n${result.stderr}`);
  }
  return result;
}

async function stopContainer(containerName) {
  return runCommand('docker', ['stop', containerName], { timeout: 30000 });
}

async function startContainer(containerName) {
  const result = await runCommand('docker', ['start', containerName], { timeout: 30000 });
  if (result.exitCode !== 0) {
    throw new Error(`docker start failed:\n${result.stderr}`);
  }
  return result;
}

async function restartContainer(containerName) {
  const result = await runCommand('docker', ['restart', containerName], { timeout: 30000 });
  if (result.exitCode !== 0) {
    throw new Error(`docker restart failed:\n${result.stderr}`);
  }
  return result;
}

async function removeContainer(containerName) {
  return runCommand('docker', ['rm', '-f', containerName], { timeout: 30000 });
}

async function getLogs(containerName, lines = 100) {
  const result = await runCommand('docker', ['logs', '--tail', String(lines), containerName], {
    timeout: 15000,
  });
  return result.stdout + result.stderr;
}

async function inspect(containerName) {
  const result = await runCommand('docker', ['inspect', containerName], { timeout: 10000 });
  if (result.exitCode !== 0) return null;
  try {
    const parsed = JSON.parse(result.stdout);
    return Array.isArray(parsed) ? parsed[0] : parsed;
  } catch {
    return null;
  }
}

async function getContainerStatus(containerName) {
  const data = await inspect(containerName);
  if (!data) return 'not_found';
  const state = data.State && data.State.Status;
  if (state === 'running') return 'running';
  if (state === 'exited') return 'stopped';
  return state || 'unknown';
}

async function generateDockerfile(appPath) {
  const dockerfilePath = path.join(appPath, 'Dockerfile');
  const dockerignorePath = path.join(appPath, '.dockerignore');

  if (!fs.existsSync(dockerfilePath)) {
    fs.writeFileSync(dockerfilePath, DEFAULT_DOCKERFILE, 'utf8');
  }
  if (!fs.existsSync(dockerignorePath)) {
    fs.writeFileSync(dockerignorePath, DEFAULT_DOCKERIGNORE, 'utf8');
  }
}

async function removeImage(imageName) {
  return runCommand('docker', ['rmi', '-f', imageName], { timeout: 30000 });
}

module.exports = {
  isDockerAvailable,
  buildImage,
  runContainer,
  stopContainer,
  startContainer,
  restartContainer,
  removeContainer,
  getLogs,
  inspect,
  getContainerStatus,
  generateDockerfile,
  removeImage,
};
