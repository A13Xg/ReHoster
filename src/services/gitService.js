'use strict';

const simpleGit = require('simple-git');
const { isValidRepoUrl } = require('../utils/validation');

async function cloneRepo(repoUrl, branch, targetPath) {
  if (!isValidRepoUrl(repoUrl)) {
    throw new Error(`Invalid repository URL: ${repoUrl}`);
  }
  const git = simpleGit();
  await git.clone(repoUrl, targetPath, ['--branch', branch, '--depth', '1']);
}

async function pullLatest(targetPath, branch) {
  const git = simpleGit(targetPath);
  if (branch) {
    await git.pull('origin', branch);
    return;
  }
  await git.pull();
}

async function fetchLatest(targetPath, branch) {
  const git = simpleGit(targetPath);
  await git.fetch('origin', branch);
}

async function getRevision(targetPath, ref = 'HEAD') {
  const git = simpleGit(targetPath);
  return (await git.revparse([ref])).trim();
}

async function hasRemoteChanges(targetPath, branch) {
  await fetchLatest(targetPath, branch);
  const local = await getRevision(targetPath, 'HEAD');
  const remote = await getRevision(targetPath, `origin/${branch}`);
  return { changed: local !== remote, local, remote };
}

async function checkoutBranch(targetPath, branch) {
  const git = simpleGit(targetPath);
  await git.checkout(branch);
}

module.exports = { isValidRepoUrl, cloneRepo, pullLatest, fetchLatest, getRevision, hasRemoteChanges, checkoutBranch };
