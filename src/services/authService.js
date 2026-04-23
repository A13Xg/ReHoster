'use strict';

const bcrypt = require('bcrypt');
const db = require('../config/db');

const SALT_ROUNDS = 12;

async function createUser(username, password) {
  const hash = await bcrypt.hash(password, SALT_ROUNDS);
  const stmt = db.prepare(
    'INSERT INTO admin_users (username, password_hash) VALUES (?, ?)'
  );
  const result = stmt.run(username, hash);
  return { id: result.lastInsertRowid, username };
}

async function verifyUser(username, password) {
  const user = db.prepare('SELECT * FROM admin_users WHERE username = ?').get(username);
  if (!user) return null;
  const match = await bcrypt.compare(password, user.password_hash);
  return match ? { id: user.id, username: user.username } : null;
}

function getUserById(id) {
  return db.prepare('SELECT id, username, created_at FROM admin_users WHERE id = ?').get(id) || null;
}

module.exports = { createUser, verifyUser, getUserById };
