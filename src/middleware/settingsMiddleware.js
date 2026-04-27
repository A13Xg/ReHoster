'use strict';

const settingsService = require('../services/settingsService');

function settingsMiddleware(req, res, next) {
  try {
    const settings = settingsService.getAllSettings();
    res.locals.settings = settings;
    res.locals.panelName = settings.panel_name || 'ReHoster';
    res.locals.theme = settings.theme || 'dark';
  } catch {
    res.locals.settings = {};
    res.locals.panelName = 'ReHoster';
    res.locals.theme = 'dark';
  }
  next();
}

module.exports = settingsMiddleware;
