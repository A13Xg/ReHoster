'use strict';

const config = require('../config/env');
const settingsService = require('../services/settingsService');

function settingsMiddleware(req, res, next) {
  try {
    const settings = settingsService.getAllSettings();
    res.locals.settings = settings;
    res.locals.panelName = settings.panel_name || 'ReHoster';
    res.locals.theme = settings.theme || 'dark';
    res.locals.locale = settings.locale || config.locale || 'en-US';
    res.locals.timezone = settings.timezone || config.timezone || 'UTC';
    res.locals.formatDate = (value) => {
      if (!value) return '—';
      const date = new Date(value);
      return Number.isNaN(date.getTime())
        ? String(value)
        : date.toLocaleString(res.locals.locale, { timeZone: res.locals.timezone });
    };
  } catch {
    res.locals.settings = {};
    res.locals.panelName = 'ReHoster';
    res.locals.theme = 'dark';
    res.locals.locale = config.locale || 'en-US';
    res.locals.timezone = config.timezone || 'UTC';
    res.locals.formatDate = (value) => {
      if (!value) return '—';
      const date = new Date(value);
      return Number.isNaN(date.getTime())
        ? String(value)
        : date.toLocaleString(res.locals.locale, { timeZone: res.locals.timezone });
    };
  }
  next();
}

module.exports = settingsMiddleware;
