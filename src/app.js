require('dotenv').config();

const express = require('express');
const path = require('path');
const session = require('express-session');
const pgSession = require('connect-pg-simple')(session);
const { initDb, pool } = require('./db/index');

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

// ── Auth routes (no requireAuth) ──────────────────────────────────────────────
app.use('/api/auth', authRouter);

// ── Protected API routes ───────────────────────────────────────────────────────
app.use('/api/permits',  requireAuth, attachTenant, permitsRouter);
app.use('/api/check',    requireAuth, attachTenant, checkRouter);
app.use('/api/settings', requireAuth, attachTenant, settingsRouter);
app.use('/api/import',   requireAuth, attachTenant, importRouter);
app.use('/api/users',    usersRouter);
app.use('/api/tenants',  tenantsRouter);
app.use('/api/billing',  requireAuth, attachTenant, billingRouter);

// GET /api/scrapers — convenience alias at root level
app.get('/api/scrapers', requireAuth, (req, res) => {
  try {
    res.json(listScrapers());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Catch-all: serve index.html for any non-API route (SPA fallback) ──────────
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/index.html'));
});

// ── Async startup ──────────────────────────────────────────────────────────────
async function main() {
  await initDb();
  app.listen(PORT, () => {
    console.log(`\n🚀 Permit Tracker running at http://localhost:${PORT}\n`);
    scheduler.start();
  });
}

main().catch(err => {
  console.error('Startup failed:', err);
  process.exit(1);
});

module.exports = app;
