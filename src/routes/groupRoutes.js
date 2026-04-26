'use strict';

const express = require('express');
const requireAuth = require('../middleware/requireAuth');
const db = require('../config/db');

const router = express.Router();

router.use(requireAuth);

router.get('/admin/groups', (req, res, next) => {
  try {
    const groups = db.prepare('SELECT g.*, COUNT(a.id) as app_count FROM groups g LEFT JOIN apps a ON a.group_id = g.id GROUP BY g.id ORDER BY g.name ASC').all();
    res.render('groups/index', { title: 'Groups', groups });
  } catch (err) {
    next(err);
  }
});

router.post('/admin/groups', (req, res, next) => {
  try {
    const name = String(req.body.name || '').trim().slice(0, 100);
    const description = String(req.body.description || '').trim().slice(0, 500);
    const color = /^#[0-9a-fA-F]{6}$/.test(req.body.color) ? req.body.color : '#6366f1';
    if (!name) throw new Error('Group name is required');
    db.prepare('INSERT INTO groups (name, description, color) VALUES (?, ?, ?)').run(name, description, color);
    res.redirect('/admin/groups');
  } catch (err) {
    next(err);
  }
});

router.get('/admin/groups/:id/edit', (req, res, next) => {
  try {
    const group = db.prepare('SELECT * FROM groups WHERE id = ?').get(Number(req.params.id));
    if (!group) return res.status(404).render('error', { title: 'Not Found', status: 404, message: 'Group not found', stack: null });
    res.render('groups/edit', { title: 'Edit Group', group });
  } catch (err) {
    next(err);
  }
});

router.post('/admin/groups/:id/edit', (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const name = String(req.body.name || '').trim().slice(0, 100);
    const description = String(req.body.description || '').trim().slice(0, 500);
    const color = /^#[0-9a-fA-F]{6}$/.test(req.body.color) ? req.body.color : '#6366f1';
    if (!name) throw new Error('Group name is required');
    db.prepare('UPDATE groups SET name = ?, description = ?, color = ? WHERE id = ?').run(name, description, color, id);
    res.redirect('/admin/groups');
  } catch (err) {
    next(err);
  }
});

router.post('/admin/groups/:id/delete', (req, res, next) => {
  try {
    const id = Number(req.params.id);
    db.prepare('UPDATE apps SET group_id = NULL WHERE group_id = ?').run(id);
    db.prepare('DELETE FROM groups WHERE id = ?').run(id);
    res.redirect('/admin/groups');
  } catch (err) {
    next(err);
  }
});

module.exports = router;
