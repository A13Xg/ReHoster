'use strict';

const path = require('path');
const crypto = require('crypto');
const express = require('express');
const session = require('express-session');
const config = require('./config/env');

const authRoutes = require('./routes/authRoutes');
const adminRoutes = require('./routes/adminRoutes');
const appRoutes = require('./routes/appRoutes');
const errorHandler = require('./middleware/errorHandler');

const app = express();

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

app.use(
  session({
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
  })
);

// Simple synchronizer-token CSRF protection
function generateCsrfToken(req) {
  if (!req.session.csrfToken) {
    req.session.csrfToken = crypto.randomBytes(32).toString('hex');
  }
  return req.session.csrfToken;
}

function csrfMiddleware(req, res, next) {
  // Generate token and expose it to all views
  res.locals.csrfToken = generateCsrfToken(req);

  // Verify on state-changing methods
  if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) {
    // Skip CSRF for the login route (pre-session) and API JSON endpoints
    const skipPaths = ['/login'];
    if (!skipPaths.includes(req.path)) {
      const token = req.body._csrf || req.headers['x-csrf-token'];
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

// Inject username into all view locals
app.use((req, res, next) => {
  res.locals.username = req.session.username || null;
  next();
});

app.get('/', (req, res) => {
  if (req.session && req.session.userId) return res.redirect('/admin');
  res.redirect('/login');
});

app.use('/', authRoutes);
app.use('/', adminRoutes);
app.use('/', appRoutes);

// 404 handler
app.use((req, res) => {
  res.status(404).render('error', {
    title: 'Not Found',
    status: 404,
    message: `Cannot ${req.method} ${req.path}`,
    stack: null,
  });
});

app.use(errorHandler);

module.exports = app;
