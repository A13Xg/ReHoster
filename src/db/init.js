'use strict';

require('dotenv').config();

const path = require('path');
const fs = require('fs');
const bcrypt = require('bcrypt');
const Database = require('better-sqlite3');
const config = require('../config/env');

async function init() {
  const dbPath = path.resolve(config.databasePath);
  const dbDir = path.dirname(dbPath);

  if (!fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, { recursive: true });
    console.log(`Created data directory: ${dbDir}`);
  }

  const managedAppsDir = path.resolve(config.managedAppsDir);
  if (!fs.existsSync(managedAppsDir)) {
    fs.mkdirSync(managedAppsDir, { recursive: true });
    console.log(`Created managed-apps directory: ${managedAppsDir}`);
  }

  const logsDir = path.resolve('./logs');
  if (!fs.existsSync(logsDir)) {
    fs.mkdirSync(logsDir, { recursive: true });
    console.log(`Created logs directory: ${logsDir}`);
  }

  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  const schemaPath = path.join(__dirname, 'schema.sql');
  const schema = fs.readFileSync(schemaPath, 'utf8');

  const statements = schema
    .split(';')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  for (const statement of statements) {
    db.prepare(statement).run();
  }
  console.log('Database schema initialized');

  const existing = db.prepare('SELECT id FROM admin_users WHERE username = ?').get(config.adminUsername);
  if (!existing) {
    const hash = await bcrypt.hash(config.adminPassword, 12);
    db.prepare(
      'INSERT INTO admin_users (username, password_hash) VALUES (?, ?)'
    ).run(config.adminUsername, hash);
    console.log(`Admin user "${config.adminUsername}" created`);
  } else {
    console.log(`Admin user "${config.adminUsername}" already exists`);
  }

  db.close();
  console.log('Database initialization complete');
}

init().catch((err) => {
  console.error('DB init failed:', err);
  process.exit(1);
});
