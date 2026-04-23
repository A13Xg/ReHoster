'use strict';

const path = require('path');
const fs = require('fs');
const config = require('../config/env');

function getAppDir(safeName) {
  return path.join(path.resolve(config.managedAppsDir), safeName);
}

function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

function safeJoin(base, ...parts) {
  const resolvedBase = path.resolve(base);
  const joined = path.resolve(resolvedBase, ...parts);
  if (!joined.startsWith(resolvedBase + path.sep) && joined !== resolvedBase) {
    throw new Error(`Path traversal detected: ${joined} is outside ${resolvedBase}`);
  }
  return joined;
}

module.exports = { getAppDir, ensureDir, safeJoin };
