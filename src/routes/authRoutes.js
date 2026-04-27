'use strict';

const express = require('express');
const rateLimit = require('express-rate-limit');
const authService = require('../services/authService');
const requireAuth = require('../middleware/requireAuth');

const router = express.Router();

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: 'Too many login attempts. Please try again in 15 minutes.',
  skip: (req) => req.method === 'GET',
});

router.get('/login', (req, res) => {
  if (req.session && req.session.userId) return res.redirect('/admin');
  res.render('login', { title: 'Login', error: req.query.error || null });
});

router.post('/login', loginLimiter, async (req, res, next) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) {
      return res.render('login', { title: 'Login', error: 'Username and password are required' });
    }
    const user = await authService.verifyUser(String(username).trim(), String(password));
    if (!user) {
      return res.render('login', { title: 'Login', error: 'Invalid username or password' });
    }
    req.session.regenerate((err) => {
      if (err) return next(err);
      req.session.userId = user.id;
      req.session.username = user.username;
      req.session.forcePasswordChange = user.force_password_change === 1;
      if (user.force_password_change === 1) {
        return res.redirect('/admin/change-password');
      }
      const returnTo = req.session.returnTo || '/admin';
      delete req.session.returnTo;
      res.redirect(returnTo);
    });
  } catch (err) {
    next(err);
  }
});

router.post('/logout', (req, res, next) => {
  req.session.destroy((err) => {
    if (err) return next(err);
    res.redirect('/login');
  });
});

router.get('/admin/change-password', requireAuth, (req, res) => {
  res.render('change-password', {
    title: 'Change Password',
    error: null,
    forced: req.session.forcePasswordChange || false,
  });
});

router.post('/admin/change-password', requireAuth, async (req, res, next) => {
  try {
    const { currentPassword, newPassword, confirmPassword } = req.body;
    if (!currentPassword || !newPassword || !confirmPassword) {
      return res.render('change-password', { title: 'Change Password', error: 'All fields are required', forced: req.session.forcePasswordChange || false });
    }
    if (newPassword !== confirmPassword) {
      return res.render('change-password', { title: 'Change Password', error: 'New passwords do not match', forced: req.session.forcePasswordChange || false });
    }
    await authService.changePassword(req.session.userId, String(currentPassword), String(newPassword));
    req.session.forcePasswordChange = false;
    res.redirect('/admin?msg=password_changed');
  } catch (err) {
    res.render('change-password', {
      title: 'Change Password',
      error: err.message,
      forced: req.session.forcePasswordChange || false,
    });
  }
});

module.exports = router;
