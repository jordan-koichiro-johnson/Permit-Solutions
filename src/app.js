require('dotenv').config();

const express = require('express');
const path = require('path');
const session = require('express-session');
const pgSession = require('connect-pg-simple')(session);
const { initDb, pool } = require('./db/index');

const rateLimit      = require('express-rate-limit');
const pinoHttp       = require('pino-http');
const logger         = require('./logger');
const permitsRouter  = require('./routes/permits');
const checkRouter    = require('./routes/check');
const settingsRouter = require('./routes/settings');
const importRouter   = require('./routes/import');
const authRouter     = require('./routes/auth');
const usersRouter    = require('./routes/users');
const tenantsRouter  = require('./routes/tenants');
const billingRouter  = require('./routes/billing');
const { webhookHandler } = require('./routes/stripe');
const { requireAuth, attachTenant } = require('./middleware/auth');
const { listScrapers } = require('./scrapers/index');
const scheduler      = require('./services/scheduler');

const app = express();
const PORT = process.env.PORT || 3000;

// Trust Render's (and similar) reverse proxy so req.secure works correctly,
// which is required for the session cookie's secure flag to be set properly.
app.set('trust proxy', 1);

// ── Session secret ─────────────────────────────────────────────────────────────
const SESSION_SECRET = process.env.SESSION_SECRET;
if (!SESSION_SECRET) {
  console.warn('[AUTH] SESSION_SECRET not set — using random fallback. Sessions will not survive restarts. Set SESSION_SECRET in .env.');
}

// ── Stripe webhook (raw body — MUST be before express.json) ───────────────────
app.post('/api/stripe/webhook', express.raw({ type: 'application/json' }), webhookHandler);

// ── Middleware ─────────────────────────────────────────────────────────────────
app.use(pinoHttp({ logger, autoLogging: { ignore: (req) => req.url === '/health' } }));
app.use(express.json());

app.use(session({
  store: new pgSession({ pool, createTableIfMissing: true }),
  secret: SESSION_SECRET || require('crypto').randomBytes(32).toString('hex'),
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
  },
}));

// Static files served before auth — login page must be accessible
app.use(express.static(path.join(__dirname, '../public')));

// ── Rate limiters ──────────────────────────────────────────────────────────────
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 min
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests, please try again later.' },
});

// Stricter limit for scraper-heavy endpoints
const heavyLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests, please try again later.' },
});

// ── Health check (no auth) ────────────────────────────────────────────────────
app.get('/health', async (req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ status: 'ok', uptime: Math.floor(process.uptime()), db: 'ok' });
  } catch (err) {
    res.status(503).json({ status: 'error', db: 'unavailable' });
  }
});

// ── Auth routes (no requireAuth) ──────────────────────────────────────────────
app.use('/api/auth', authRouter);

// ── Protected API routes ───────────────────────────────────────────────────────
app.use('/api/permits',  apiLimiter, requireAuth, attachTenant, permitsRouter);
app.use('/api/check',    heavyLimiter, requireAuth, attachTenant, checkRouter);
app.use('/api/settings', apiLimiter, requireAuth, attachTenant, settingsRouter);
app.use('/api/import',   heavyLimiter, requireAuth, attachTenant, importRouter);
app.use('/api/users',    apiLimiter, usersRouter);
app.use('/api/tenants',  apiLimiter, tenantsRouter);
app.use('/api/billing',  apiLimiter, requireAuth, attachTenant, billingRouter);

// GET /api/scrapers — convenience alias at root level
app.get('/api/scrapers', requireAuth, (req, res) => {
  try {
    res.json(listScrapers());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Global API error handler ───────────────────────────────────────────────
app.use((err, req, res, next) => {
  (req.log || logger).error({ err }, 'Request error');
  if (res.headersSent) return next(err);
  const status = err.status || err.statusCode || 500;
  const message = status < 500 ? err.message : 'Internal server error';
  res.status(status).json({ error: message });
});

// ── Catch-all: serve index.html for any non-API route (SPA fallback) ──────────
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/index.html'));
});

// ── Async startup ──────────────────────────────────────────────────────────────
async function main() {
  await initDb();
  app.listen(PORT, () => {
    logger.info(`Permit Tracker running at http://localhost:${PORT}`);
    scheduler.start();
  });
}

main().catch(err => {
  console.error('Startup failed:', err);
  process.exit(1);
});

process.on('unhandledRejection', (reason) => {
  logger.error({ reason }, 'Unhandled rejection');
});
process.on('uncaughtException', (err) => {
  logger.error({ err }, 'Uncaught exception');
  process.exit(1);
});

// ── Graceful shutdown ───────────────────────────────────────────────────────
async function shutdown(signal) {
  logger.info(`${signal} received — shutting down gracefully`);
  scheduler.stop();
  await pool.end();
  logger.info('DB pool closed. Exiting.');
  process.exit(0);
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT',  () => shutdown('SIGINT'));

module.exports = app;
