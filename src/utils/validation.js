'use strict';

// Validate GitHub repo URLs without backtracking-prone alternation regex.
// Accepts: https://github.com/owner/repo[.git] or git@github.com:owner/repo[.git]
function isValidRepoUrl(url) {
  const s = String(url).trim();
  // Must start with one of two known prefixes
  if (s.startsWith('https://github.com/')) {
    const path = s.slice('https://github.com/'.length);
    return /^[A-Za-z0-9][\w.-]{0,98}\/[\w.-]{1,100}(\.git)?$/.test(path);
  }
  if (s.startsWith('git@github.com:')) {
    const path = s.slice('git@github.com:'.length);
    return /^[A-Za-z0-9][\w.-]{0,98}\/[\w.-]{1,100}(\.git)?$/.test(path);
  }
  return false;
}

function sanitizeAppName(name) {
  const s = String(name).toLowerCase();
  const MAX = 50;
  // Cap input processing to avoid unbounded iteration on user-controlled length
  const limit = Math.min(s.length, MAX * 4);
  let result = '';
  let prevDash = false;
  for (let i = 0; i < limit; i++) {
    const c = s[i];
    if ((c >= 'a' && c <= 'z') || (c >= '0' && c <= '9')) {
      result += c;
      prevDash = false;
    } else if (!prevDash && result.length > 0) {
      result += '-';
      prevDash = true;
    }
  }
  // Trim trailing dash
  while (result.length > 0 && result[result.length - 1] === '-') {
    result = result.slice(0, -1);
  }
  return result.slice(0, MAX);
}

function validateAppInput(body) {
  const errors = [];

  if (!body.name || String(body.name).trim().length < 1) {
    errors.push('App name is required');
  } else if (String(body.name).trim().length > 50) {
    errors.push('App name must be 50 characters or fewer');
  }

  if (!body.repoUrl || String(body.repoUrl).trim().length < 1) {
    errors.push('Repository URL is required');
  } else if (!isValidRepoUrl(String(body.repoUrl).trim())) {
    errors.push('Repository URL must be a valid GitHub URL (https or SSH)');
  }

  if (body.branch && String(body.branch).trim().length > 100) {
    errors.push('Branch name is too long');
  }

  if (body.branch && /[^a-zA-Z0-9\-_./]/.test(String(body.branch).trim())) {
    errors.push('Branch name contains invalid characters');
  }

  return { valid: errors.length === 0, errors };
}

function isValidPort(port, start, end) {
  const p = parseInt(port, 10);
  return Number.isInteger(p) && p >= start && p <= end;
}

module.exports = { sanitizeAppName, isValidRepoUrl, validateAppInput, isValidPort };
