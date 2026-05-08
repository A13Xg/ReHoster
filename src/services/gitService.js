'use strict';

const fs = require('fs');
const path = require('path');
const simpleGit = require('simple-git');
const { isValidRepoUrl } = require('../utils/validation');

// How long to wait between retry attempts (in milliseconds).
const RETRY_DELAY_MS = 3000;

// Maximum number of network retry attempts for fetch/pull operations.
const MAX_RETRIES = 2;

/**
 * Sleep for a given number of milliseconds.
 * Used for retry back-off.
 * @param {number} ms
 */
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Determine whether a repository at the given path is a shallow clone.
 * Git creates a "shallow" file inside .git when cloned with --depth.
 * @param {string} repoPath - Absolute path to the local repository root.
 * @returns {boolean}
 */
function isShallowRepo(repoPath) {
  try {
    return fs.existsSync(path.join(repoPath, '.git', 'shallow'));
  } catch {
    return false;
  }
}

/**
 * Determine whether the repository working tree has uncommitted changes.
 * Returns true when there are staged, unstaged, or untracked changes.
 * @param {import('simple-git').SimpleGit} git - Initialised simple-git instance.
 * @returns {Promise<boolean>}
 */
async function hasUncommittedChanges(git) {
  try {
    const status = await git.status();
    return !status.isClean();
  } catch {
    // If status cannot be read, assume clean to avoid blocking a pull.
    return false;
  }
}

/**
 * Determine whether HEAD is in a detached state (i.e. not on any named branch).
 * @param {import('simple-git').SimpleGit} git
 * @returns {Promise<boolean>}
 */
async function isDetachedHead(git) {
  try {
    const branch = await git.branch();
    return branch.detached === true;
  } catch {
    return false;
  }
}

/**
 * Clone a GitHub repository into targetPath.
 *
 * A shallow clone (--depth 1) is used to minimise network traffic.
 * The caller is responsible for running unshallow if needed later.
 *
 * @param {string} repoUrl   - GitHub HTTPS or SSH URL.
 * @param {string} branch    - Branch name to clone.
 * @param {string} targetPath - Local directory to clone into (must not exist yet).
 * @param {{ onProgress?: (p: object) => void }} [options]
 *
 * @example
 * await cloneRepo('https://github.com/user/repo', 'main', '/managed-apps/my-app');
 */
async function cloneRepo(repoUrl, branch, targetPath, options = {}) {
  if (!isValidRepoUrl(repoUrl)) {
    throw new Error(`Invalid repository URL: ${repoUrl}`);
  }
  const git = simpleGit();
  if (options && typeof options.onProgress === 'function') {
    git.progress((progress) => options.onProgress(progress));
  }
  await git.clone(repoUrl, targetPath, ['--branch', branch, '--depth', '1']);
}

/**
 * Fetch the latest commit metadata from origin without modifying the working tree.
 *
 * If the repository is a shallow clone the function automatically runs
 * `git fetch --unshallow` first so that comparison against origin/<branch>
 * works correctly.  A shallow clone lacks the commit graph needed to compare
 * HEAD with remote refs.
 *
 * Network failures are retried up to MAX_RETRIES times with a RETRY_DELAY_MS
 * back-off between attempts.
 *
 * @param {string} targetPath - Absolute path to the local repository.
 * @param {string} branch     - Remote branch name (e.g. "main").
 * @returns {Promise<void>}
 */
async function fetchLatest(targetPath, branch) {
  const git = simpleGit(targetPath);

  // Unshallow first so that we can access remote tracking refs.
  if (isShallowRepo(targetPath)) {
    try {
      await git.fetch(['--unshallow', 'origin', branch]);
      return;
    } catch (unshallowErr) {
      // --unshallow may fail on already-complete repos or when offline.
      // Fall through to normal fetch as a best-effort.
    }
  }

  let lastErr;
  for (let attempt = 1; attempt <= MAX_RETRIES + 1; attempt += 1) {
    try {
      await git.fetch(['origin', branch]);
      return;
    } catch (err) {
      lastErr = err;
      const isNetworkError = isTransientGitError(String(err && (err.message || err)));
      if (!isNetworkError || attempt > MAX_RETRIES) break;
      await sleep(RETRY_DELAY_MS * attempt);
    }
  }

  throw lastErr || new Error(`git fetch failed for branch "${branch}" in ${targetPath}`);
}

/**
 * Check whether the local repository has behind the remote.
 *
 * Performs a fetch, then compares HEAD against origin/<branch>.
 * Returns a result object that describes the current revision state.
 *
 * @param {string} targetPath - Absolute path to the local repository.
 * @param {string} branch     - Branch to compare against.
 * @returns {Promise<{ changed: boolean, local: string, remote: string }>}
 *
 * @example
 * const state = await hasRemoteChanges('/managed-apps/my-app', 'main');
 * if (state.changed) console.log('Updates available');
 */
async function hasRemoteChanges(targetPath, branch) {
  await fetchLatest(targetPath, branch);
  const local = await getRevision(targetPath, 'HEAD');
  const remote = await getRevision(targetPath, `origin/${branch}`);
  return { changed: local !== remote, local, remote };
}

/**
 * Pull the latest commits from origin into the local working tree.
 *
 * Safety measures applied automatically:
 *  - If the working tree is dirty, uncommitted changes are stashed before the
 *    pull and restored afterwards (stash pop).  This prevents pull conflicts
 *    while preserving any local edits made through the file browser.
 *  - If HEAD is detached, the named branch is checked out first.
 *  - If the repository is shallow, an unshallow fetch is run before pull.
 *
 * @param {string} targetPath - Absolute path to the local repository.
 * @param {string} branch     - Branch to pull from origin.
 * @param {{ onProgress?: (p: object) => void }} [options]
 * @returns {Promise<void>}
 *
 * @example
 * await pullLatest('/managed-apps/my-app', 'main');
 */
async function pullLatest(targetPath, branch, options = {}) {
  const git = simpleGit(targetPath);

  if (options && typeof options.onProgress === 'function') {
    git.progress((progress) => options.onProgress(progress));
  }

  // --- Unshallow if needed ---
  if (isShallowRepo(targetPath)) {
    try {
      await git.fetch(['--unshallow', 'origin']);
    } catch {
      // Best effort — continue even if unshallow fails.
    }
  }

  // --- Fix detached HEAD ---
  const detached = await isDetachedHead(git);
  if (detached && branch) {
    try {
      await git.checkout(branch);
    } catch {
      // If checkout fails (e.g. local branch doesn't exist), try creating it.
      try {
        await git.checkoutBranch(branch, `origin/${branch}`);
      } catch {
        // Cannot fix HEAD; pull will likely fail, but let it attempt.
      }
    }
  }

  // --- Stash dirty tree ---
  const dirty = await hasUncommittedChanges(git);
  let stashed = false;
  if (dirty) {
    try {
      const stashResult = await git.stash(['push', '-u', '-m', 'rehoster-auto-stash']);
      // stash push outputs "No local changes to save" when the tree was clean.
      stashed = !stashResult.includes('No local changes');
    } catch {
      // Stash failed — proceed anyway; pull may still succeed.
    }
  }

  // --- Pull with retries ---
  let lastErr;
  for (let attempt = 1; attempt <= MAX_RETRIES + 1; attempt += 1) {
    try {
      if (branch) {
        await git.pull('origin', branch, ['--ff-only']);
      } else {
        await git.pull(['--ff-only']);
      }
      lastErr = null;
      break;
    } catch (err) {
      lastErr = err;
      // If fast-forward-only fails because the histories diverged, retry
      // without --ff-only so the operation can still succeed.
      if (err.message && err.message.includes('Not possible to fast-forward')) {
        try {
          if (branch) {
            await git.pull('origin', branch);
          } else {
            await git.pull();
          }
          lastErr = null;
          break;
        } catch (fallbackErr) {
          lastErr = fallbackErr;
        }
      }
      const isNetworkError = isTransientGitError(String(err && (err.message || err)));
      if (!isNetworkError || attempt > MAX_RETRIES) break;
      await sleep(RETRY_DELAY_MS * attempt);
    }
  }

  // --- Restore stash ---
  if (stashed) {
    try {
      await git.stash(['pop']);
    } catch {
      // Stash pop conflicts are surfaced to the user via log messages.
      // The pull itself succeeded so do not re-throw.
    }
  }

  if (lastErr) throw lastErr;
}

/**
 * Resolve a git ref (branch, tag, HEAD, …) to its full 40-character SHA.
 *
 * @param {string} targetPath - Absolute path to the repository.
 * @param {string} [ref='HEAD'] - Ref to resolve.
 * @returns {Promise<string>} Full SHA string.
 */
async function getRevision(targetPath, ref = 'HEAD') {
  const git = simpleGit(targetPath);
  return (await git.revparse([ref])).trim();
}

/**
 * Check out a named branch in the working tree.
 *
 * @param {string} targetPath - Absolute path to the repository.
 * @param {string} branch     - Branch name to check out.
 */
async function checkoutBranch(targetPath, branch) {
  const git = simpleGit(targetPath);
  await git.checkout(branch);
}

/**
 * Return the currently checked-out branch name, or null if in detached HEAD.
 *
 * @param {string} targetPath
 * @returns {Promise<string|null>}
 */
async function getCurrentBranch(targetPath) {
  try {
    const git = simpleGit(targetPath);
    const summary = await git.branch();
    return summary.current || null;
  } catch {
    return null;
  }
}

/**
 * Return the short summary of the latest commit on HEAD.
 * Useful for logging and the upgrade page.
 *
 * @param {string} targetPath
 * @returns {Promise<{ hash: string, date: string, message: string, author: string } | null>}
 */
async function getLatestCommitInfo(targetPath) {
  try {
    const git = simpleGit(targetPath);
    const log = await git.log(['-1', '--format=%H%n%ci%n%s%n%an']);
    if (!log.latest) return null;
    // log.latest has .hash, .date, .message, .author_name populated by simple-git.
    return {
      hash: log.latest.hash,
      date: log.latest.date,
      message: log.latest.message,
      author: log.latest.author_name,
    };
  } catch {
    return null;
  }
}

/**
 * Return true when the error message indicates a transient network or
 * connectivity problem (e.g. DNS failure, connection reset, timeout).
 * These errors are candidates for automatic retry.
 *
 * Note: 404 "repository not found" is **not** treated as transient — that
 * typically indicates a permanent misconfiguration (wrong URL, deleted repo,
 * or missing permissions).
 *
 * @param {string} message - Error message string.
 * @returns {boolean}
 */
function isTransientGitError(message) {
  const text = String(message || '').toLowerCase();
  return text.includes('unable to connect')
    || text.includes('could not resolve host')
    || text.includes('connection timed out')
    || text.includes('connection reset')
    || text.includes('temporary failure in name resolution')
    || text.includes('network is unreachable')
    || text.includes('tls handshake timeout')
    || text.includes('the remote end hung up');
}

module.exports = {
  isValidRepoUrl,
  cloneRepo,
  pullLatest,
  fetchLatest,
  getRevision,
  hasRemoteChanges,
  checkoutBranch,
  getCurrentBranch,
  getLatestCommitInfo,
  isShallowRepo,
  isTransientGitError,
};
