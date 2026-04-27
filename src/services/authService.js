'use strict';

const bcrypt = require('bcrypt');
const db = require('../config/db');

const SALT_ROUNDS = 12;

async function createUser(username, password) {
  const hash = await bcrypt.hash(password, SALT_ROUNDS);
  const stmt = db.prepare('INSERT INTO admin_users (username, password_hash) VALUES (?, ?)');
  const result = stmt.run(username, hash);
  return { id: result.lastInsertRowid, username };
}

async function verifyUser(username, password) {
  const user = db.prepare('SELECT * FROM admin_users WHERE username = ?').get(username);
  if (!user) return null;
  const match = await bcrypt.compare(password, user.password_hash);
  if (!match) return null;
  return {
    id: user.id,
    username: user.username,
    force_password_change: user.force_password_change || 0,
  };
}

function getUserById(id) {
  return db.prepare('SELECT id, username, force_password_change, created_at FROM admin_users WHERE id = ?').get(id) || null;
}

async function changePassword(userId, currentPassword, newPassword) {
  const user = db.prepare('SELECT * FROM admin_users WHERE id = ?').get(userId);
  if (!user) throw new Error('User not found');
  const match = await bcrypt.compare(currentPassword, user.password_hash);
  if (!match) throw new Error('Current password is incorrect');
  if (!newPassword || newPassword.length < 8) throw new Error('New password must be at least 8 characters');
  const hash = await bcrypt.hash(newPassword, SALT_ROUNDS);
  db.prepare('UPDATE admin_users SET password_hash = ?, force_password_change = 0, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(hash, userId);
}

module.exports = { createUser, verifyUser, getUserById, changePassword };
