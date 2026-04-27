'use strict';

const express = require('express');
const db = require('../config/db');
const config = require('../config/env');

const router = express.Router();

function getStatusData() {
  let apps = [];
  let dbOk = true;
  try {
    apps = db.prepare("SELECT id, name, safe_name, status, port, public_hostname, health_status, last_health_check FROM apps WHERE status != 'deleted' ORDER BY name ASC").all();
  } catch {
    dbOk = false;
  }
  return {
    panelVersion: config.panelVersion,
    uptime: Math.floor(process.uptime()),
    dbOk,
    apps,
    timestamp: new Date().toISOString(),
  };
}

router.get('/status', (req, res, next) => {
  try {
    const data = getStatusData();
    res.render('status', { title: 'System Status', ...data });
  } catch (err) {
    next(err);
  }
});

router.get('/status.json', (req, res, next) => {
  try {
    res.json(getStatusData());
  } catch (err) {
    next(err);
  }
});

module.exports = router;
