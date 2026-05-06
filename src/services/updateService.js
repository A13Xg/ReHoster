'use strict';

const https = require('https');
const config = require('../config/env');

class UpdateService {
  constructor() {
    this.repo = 'A13Xg/ReHoster';
    this.cacheTTL = 60 * 60 * 1000; // 1 hour
    this.lastCheckTime = 0;
    this.cachedLatestVersion = null;
  }

  /**
   * Parse semantic version string into comparable format
   */
  parseVersion(versionString) {
    const match = String(versionString || '').match(/^v?(\d+)\.(\d+)\.(\d+)(?:-.+)?$/);
    if (!match) return { major: 0, minor: 0, patch: 0, raw: versionString };
    return {
      major: parseInt(match[1], 10),
      minor: parseInt(match[2], 10),
      patch: parseInt(match[3], 10),
      raw: versionString,
    };
  }

  /**
   * Compare two version objects. Returns -1 (a < b), 0 (equal), 1 (a > b)
   */
  compareVersions(v1, v2) {
    if (v1.major !== v2.major) return v1.major > v2.major ? 1 : -1;
    if (v1.minor !== v2.minor) return v1.minor > v2.minor ? 1 : -1;
    if (v1.patch !== v2.patch) return v1.patch > v2.patch ? 1 : -1;
    return 0;
  }

  /**
   * Fetch latest GitHub release tag (via GitHub API)
   */
  async getLatestGitHubRelease() {
    // Return cached version if fresh
    if (this.cachedLatestVersion && Date.now() - this.lastCheckTime < this.cacheTTL) {
      return this.cachedLatestVersion;
    }

    return new Promise((resolve, reject) => {
      const options = {
        hostname: 'api.github.com',
        path: `/repos/${this.repo}/releases/latest`,
        method: 'GET',
        headers: {
          'User-Agent': 'ReHoster-UpdateChecker',
          Accept: 'application/vnd.github.v3+json',
        },
        timeout: 5000,
      };

      https
        .request(options, (res) => {
          let data = '';
          res.on('data', (chunk) => {
            data += chunk;
          });
          res.on('end', () => {
            try {
              const parsed = JSON.parse(data);
              const tag = parsed.tag_name || '';
              this.cachedLatestVersion = tag;
              this.lastCheckTime = Date.now();
              resolve(tag);
            } catch (err) {
              reject(new Error(`Failed to parse GitHub API response: ${err.message}`));
            }
          });
        })
        .on('error', (err) => {
          reject(new Error(`Failed to fetch latest release: ${err.message}`));
        })
        .on('timeout', () => {
          reject(new Error('GitHub API request timed out'));
        })
        .end();
    });
  }

  /**
   * Check if an update is available
   */
  async checkForUpdates() {
    try {
      const latestTag = await this.getLatestGitHubRelease();
      const current = this.parseVersion(config.panelVersion);
      const latest = this.parseVersion(latestTag);

      const comparison = this.compareVersions(current, latest);
      const updateAvailable = comparison < 0;

      return {
        current: config.panelVersion,
        latest: latestTag,
        updateAvailable,
        message: updateAvailable
          ? `Update available: ${config.panelVersion} → ${latestTag}`
          : `Already on latest (${config.panelVersion})`,
        error: null,
      };
    } catch (err) {
      return {
        current: config.panelVersion,
        latest: null,
        updateAvailable: false,
        message: null,
        error: err.message,
      };
    }
  }

  /**
   * Get cached update status (for UI status badge)
   */
  getCachedStatus() {
    if (!this.cachedLatestVersion) {
      return {
        current: config.panelVersion,
        latest: null,
        updateAvailable: false,
        message: 'Not checked yet',
        error: null,
      };
    }

    const current = this.parseVersion(config.panelVersion);
    const latest = this.parseVersion(this.cachedLatestVersion);
    const updateAvailable = this.compareVersions(current, latest) < 0;

    return {
      current: config.panelVersion,
      latest: this.cachedLatestVersion,
      updateAvailable,
      message: updateAvailable
        ? `Update available: ${config.panelVersion} → ${this.cachedLatestVersion}`
        : `Already on latest (${config.panelVersion})`,
      error: null,
    };
  }
}

module.exports = new UpdateService();
