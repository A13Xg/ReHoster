'use strict';

const https = require('https');

function requestJson(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { timeout: 5000, headers: { 'User-Agent': 'ReHoster-TimeClient' } }, (res) => {
      let data = '';
      res.on('data', (chunk) => {
        data += chunk;
      });
      res.on('end', () => {
        if (res.statusCode < 200 || res.statusCode >= 300) {
          return reject(new Error(`HTTP ${res.statusCode}`));
        }
        try {
          resolve(JSON.parse(data));
        } catch (err) {
          reject(new Error(`Invalid JSON response: ${err.message}`));
        }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy(new Error('Request timeout'));
    });
  });
}

async function getTimeFromServer() {
  // Primary source
  try {
    const payload = await requestJson('https://worldtimeapi.org/api/timezone/Etc/UTC');
    if (payload && payload.datetime) {
      return {
        source: 'worldtimeapi.org',
        utcIso: payload.datetime,
      };
    }
  } catch {}

  // Secondary source
  try {
    const payload = await requestJson('https://timeapi.io/api/Time/current/zone?timeZone=UTC');
    if (payload && payload.dateTime) {
      return {
        source: 'timeapi.io',
        utcIso: payload.dateTime,
      };
    }
  } catch {}

  throw new Error('Failed to get time from external time servers');
}

module.exports = { getTimeFromServer };
