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

async function pullLatest(targetPath) {
  const git = simpleGit(targetPath);
  await git.pull();
}

async function checkoutBranch(targetPath, branch) {
  const git = simpleGit(targetPath);
  await git.checkout(branch);
}

module.exports = { isValidRepoUrl, cloneRepo, pullLatest, checkoutBranch };
