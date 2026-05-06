'use strict';

require('dotenv').config();

const path = require('path');
const fs = require('fs');
const bcrypt = require('bcrypt');
const Database = require('better-sqlite3');
const config = require('../config/env');

const DEFAULT_SETTINGS = {
  theme: 'dark',
  panel_name: 'ReHoster',
  auto_update_check: '1',
  auto_update_interval: '24',
  port_range_start: '4000',
  port_range_end: '4999',
  docker_restart_policy: 'unless-stopped',
  analytics_retention_days: '7',
  log_retention_days: '30',
};

function addColumnIfMissing(db, table, column, definition) {
  const cols = db.pragma(`table_info(${table})`);
  const exists = cols.some((c) => c.name === column);
  if (!exists) {
    db.prepare(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`).run();
    console.log(`Added column ${column} to ${table}`);
  }
}

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
  const statements = schema.split(';').map((s) => s.trim()).filter((s) => s.length > 0);
  for (const statement of statements) {
    db.prepare(statement).run();
  }
  console.log('Database schema initialized');

  // Migration: add new columns to pre-existing tables
  addColumnIfMissing(db, 'admin_users', 'force_password_change', 'INTEGER DEFAULT 0');
  addColumnIfMissing(db, 'apps', 'description', 'TEXT');
  addColumnIfMissing(db, 'apps', 'group_id', 'INTEGER');
  addColumnIfMissing(db, 'apps', 'public_hostname', 'TEXT');
  addColumnIfMissing(db, 'apps', 'service_type', "TEXT DEFAULT 'auto'");
  addColumnIfMissing(db, 'apps', 'detected_frameworks', 'TEXT');
  addColumnIfMissing(db, 'apps', 'last_health_check', 'DATETIME');
  addColumnIfMissing(db, 'apps', 'health_status', 'TEXT');
  addColumnIfMissing(db, 'apps', 'cpu_limit', 'TEXT');
  addColumnIfMissing(db, 'apps', 'memory_limit', 'TEXT');
  addColumnIfMissing(db, 'apps', 'tags', 'TEXT');
  addColumnIfMissing(db, 'apps', 'webhook_url', 'TEXT');
  addColumnIfMissing(db, 'apps', 'restart_schedule', 'TEXT');

  // Seed default settings (INSERT OR IGNORE = won't overwrite existing)
  const insertSetting = db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)');
  for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) {
    insertSetting.run(key, value);
  }
  console.log('Default settings seeded');

  const existing = db.prepare('SELECT id FROM admin_users WHERE username = ?').get(config.adminUsername);
  if (!existing) {
    const hash = await bcrypt.hash(config.adminPassword, 12);
    db.prepare('INSERT INTO admin_users (username, password_hash, force_password_change) VALUES (?, ?, 1)').run(config.adminUsername, hash);
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
