'use strict';

const path = require('path');
const crypto = require('crypto');
const express = require('express');
const session = require('express-session');
const rateLimit = require('express-rate-limit');
const config = require('./config/env');
const authRoutes = require('./routes/authRoutes');
const adminRoutes = require('./routes/adminRoutes');
const appRoutes = require('./routes/appRoutes');
const settingsRoutes = require('./routes/settingsRoutes');
const statusRoutes = require('./routes/statusRoutes');
const groupRoutes = require('./routes/groupRoutes');
const metricsRoutes = require('./routes/metricsRoutes');
const analyticsRoutes = require('./routes/analyticsRoutes');
const upgradeRoutes = require('./routes/upgradeRoutes');
const apiRoutes = require('./routes/apiRoutes');
const errorHandler = require('./middleware/errorHandler');
const settingsMiddleware = require('./middleware/settingsMiddleware');
const { analyticsMiddleware } = require('./middleware/analyticsMiddleware');

const app = express();

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.static(path.join(__dirname, 'public')));
app.use('/media', express.static(path.join(__dirname, '..', 'media')));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

app.get('/favicon.ico', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'media', 'Re-HosterLogo.ico'));
});

// Security headers
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  next();
});

app.use(session({
  secret: config.sessionSecret,
  resave: false,
  saveUninitialized: false,
  name: 'rehoster.sid',
  cookie: {
    httpOnly: true,
    secure: config.nodeEnv === 'production',
    maxAge: 24 * 60 * 60 * 1000,
    sameSite: 'lax',
  },
}));

// Rate limiting for admin POST routes
const adminPostLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 200,
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => req.method !== 'POST',
});
const adminReadLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 1000,
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => req.method === 'POST',
});
app.use('/admin', adminPostLimiter);
app.use('/admin', adminReadLimiter);

// CSRF
const CSRF_SKIP_PATHS = new Set(['/login', '/status', '/status.json', '/metrics.json', '/analytics.json', '/api/system-logs']);

function generateCsrfToken(req) {
  if (!req.session.csrfToken) {
    req.session.csrfToken = crypto.randomBytes(32).toString('hex');
  }
  return req.session.csrfToken;
}

function csrfMiddleware(req, res, next) {
  res.locals.csrfToken = generateCsrfToken(req);
  if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) {
    if (!CSRF_SKIP_PATHS.has(req.path)) {
      const token = req.body._csrf || req.headers['x-csrf-token'] || req.headers['csrf-token'];
      if (!token || token !== req.session.csrfToken) {
        const err = new Error('Invalid CSRF token');
        err.status = 403;
        return next(err);
      }
    }
  }
  next();
}

app.use(csrfMiddleware);

// Settings middleware — puts settings/panelName/theme in res.locals
app.use(settingsMiddleware);

// Analytics middleware for admin routes
app.use('/admin', analyticsMiddleware);

app.use((req, res, next) => {
  res.locals.username = req.session.username || null;
  res.locals.panelVersion = config.panelVersion;
  next();
});

app.get('/', (req, res) => {
  if (req.session && req.session.userId) return res.redirect('/admin');
  res.redirect('/login');
});

app.use('/', authRoutes);
app.use('/', adminRoutes);
app.use('/', appRoutes);
app.use('/', settingsRoutes);
app.use('/', statusRoutes);
app.use('/', groupRoutes);
app.use('/', metricsRoutes);
app.use('/', analyticsRoutes);
app.use('/', upgradeRoutes);
app.use('/', apiRoutes);

app.use((req, res) => {
  res.status(404).render('error', { title: 'Not Found', status: 404, message: `Cannot ${req.method} ${req.path}`, stack: null });
});

app.use(errorHandler);

module.exports = app;
