'use strict';

const path = require('path');
const fs = require('fs');
const express = require('express');
const requireAuth = require('../middleware/requireAuth');
const config = require('../config/env');
const updateService = require('../services/updateService');
const gitService = require('../services/gitService');
const { runCommand } = require('../utils/shell');

const router = express.Router();

// Absolute path of the ReHoster repository root (one level above /src).
const REPO_ROOT = path.resolve(__dirname, '..', '..');

/**
 * Determine if the panel is running from a git checkout by looking for .git/.
 * If not (e.g. installed from a zip or npm global), git-based upgrades are
 * unavailable.
 * @returns {boolean}
 */
function isGitRepo() {
  try {
    return fs.existsSync(path.join(REPO_ROOT, '.git'));
  } catch {
    return false;
  }
}

/**
 * Attempt to detect available git updates for the panel itself.
 *
 * Strategy:
 *  1. Determine the current branch.
 *  2. Fetch from origin (handles shallow repos, retries on transient errors).
 *  3. Compare HEAD and origin/<branch> SHAs.
 *
 * @returns {Promise<{ hasUpdates: boolean, message: string, currentHash?: string, remoteHash?: string, branch?: string }>}
 */
async function checkGitUpdates() {
  if (!isGitRepo()) {
    return {
      hasUpdates: false,
      message: 'Not running from a git checkout — git-based upgrade unavailable.',
      isGitRepo: false,
    };
  }

  let branch;
  try {
    branch = await gitService.getCurrentBranch(REPO_ROOT);
  } catch {
    branch = null;
  }

  if (!branch) {
    // Detached HEAD or no branch info — we can still compare HEAD vs. origin/main.
    branch = 'main';
  }

  try {
    const state = await gitService.hasRemoteChanges(REPO_ROOT, branch);
    if (state.changed) {
      return {
        hasUpdates: true,
        message: `Updates available on branch "${branch}": ${state.local.slice(0, 7)} → ${state.remote.slice(0, 7)}`,
        currentHash: state.local,
        remoteHash: state.remote,
        branch,
        isGitRepo: true,
      };
    }
    return {
      hasUpdates: false,
      message: `Already up to date (${state.local.slice(0, 7)}) on branch "${branch}".`,
      currentHash: state.local,
      remoteHash: state.remote,
      branch,
      isGitRepo: true,
    };
  } catch (err) {
    return {
      hasUpdates: false,
      message: `Git update check failed: ${err.message}`,
      branch,
      isGitRepo: true,
      error: err.message,
    };
  }
}

router.use(requireAuth);

// GET /admin/upgrade — show the current version and cached update status.
router.get('/admin/upgrade', async (req, res) => {
  const cachedStatus = updateService.getCachedStatus();
  res.render('upgrade', {
    title: 'Upgrade',
    currentVersion: config.panelVersion,
    checkResult: null,
    updateStatus: cachedStatus,
    gitInfo: null,
  });
});

// POST /admin/upgrade/check — force a fresh check against GitHub.
router.post('/admin/upgrade/check', async (req, res) => {
  let updateStatus;
  let gitCheckResult;

  try {
    // Check the GitHub releases API for a newer semantic version.
    updateStatus = await updateService.checkForUpdates();
  } catch {
    updateStatus = updateService.getCachedStatus();
  }

  try {
    // Check whether the local git tree is behind origin.
    gitCheckResult = await checkGitUpdates();
  } catch (err) {
    gitCheckResult = { hasUpdates: false, message: `Git check error: ${err.message}` };
  }

  res.render('upgrade', {
    title: 'Upgrade',
    currentVersion: config.panelVersion,
    checkResult: {
      hasUpdates: gitCheckResult.hasUpdates,
      message: gitCheckResult.message,
    },
    updateStatus,
    gitInfo: gitCheckResult,
  });
});

// POST /admin/upgrade/apply — pull the latest changes and update dependencies.
router.post('/admin/upgrade/apply', async (req, res) => {
  const steps = [];
  let overallSuccess = true;

  if (!isGitRepo()) {
    return res.render('upgrade', {
      title: 'Upgrade',
      currentVersion: config.panelVersion,
      checkResult: {
        hasUpdates: false,
        message: 'Cannot apply upgrade: not running from a git checkout.',
      },
      updateStatus: updateService.getCachedStatus(),
      gitInfo: null,
    });
  }

  // Step 1 — git pull with all safety checks (stash dirty tree, handle shallow, retry).
  try {
    const branch = await gitService.getCurrentBranch(REPO_ROOT) || 'main';
    steps.push({ label: 'git pull', status: 'running' });
    await gitService.pullLatest(REPO_ROOT, branch);
    steps[steps.length - 1].status = 'ok';
    steps[steps.length - 1].detail = `Pulled branch "${branch}" successfully.`;
  } catch (err) {
    steps[steps.length - 1].status = 'error';
    steps[steps.length - 1].detail = err.message;
    overallSuccess = false;
  }

  // Step 2 — npm install to pick up any new/updated dependencies.
  try {
    steps.push({ label: 'npm install', status: 'running' });
    const npmResult = await runCommand('npm', ['install', '--prefer-offline'], {
      cwd: REPO_ROOT,
      timeout: 120000,
    });
    if (npmResult.exitCode === 0) {
      steps[steps.length - 1].status = 'ok';
      steps[steps.length - 1].detail = 'Dependencies updated.';
    } else {
      // npm install failure is non-fatal — the app likely still runs.
      steps[steps.length - 1].status = 'warn';
      steps[steps.length - 1].detail = `npm install exited ${npmResult.exitCode}: ${(npmResult.stderr || '').slice(0, 200)}`;
    }
  } catch (err) {
    steps[steps.length - 1].status = 'warn';
    steps[steps.length - 1].detail = `npm install failed: ${err.message}`;
  }

  const summaryMessage = overallSuccess
    ? 'Upgrade applied successfully. Please restart the server to load the new code.'
    : `Upgrade encountered errors. Review the steps below and restart if needed. First error: ${steps.find((s) => s.status === 'error')?.detail || 'unknown'}`;

  const updateStatus = updateService.getCachedStatus();
  res.render('upgrade', {
    title: 'Upgrade',
    currentVersion: config.panelVersion,
    checkResult: {
      hasUpdates: false,
      message: summaryMessage,
      steps,
    },
    updateStatus,
    gitInfo: null,
  });
});

module.exports = router;
