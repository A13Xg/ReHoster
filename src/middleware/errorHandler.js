'use strict';

const pino = require('pino');
const logger = pino({ name: 'error-handler' });

function errorHandler(err, req, res, next) {
  const status = err.status || err.statusCode || 500;
  const message = err.message || 'Internal Server Error';

  logger.error({ err, url: req.url, method: req.method }, message);

  if (res.headersSent) {
    return next(err);
  }

  if (req.accepts('html')) {
    return res.status(status).render('error', {
      title: `Error ${status}`,
      status,
      message,
      stack: process.env.NODE_ENV !== 'production' ? err.stack : null,
    });
  }

  return res.status(status).json({ error: message });
}

module.exports = errorHandler;
