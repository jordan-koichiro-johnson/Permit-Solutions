require('dotenv').config();

const express = require('express');
const path = require('path');
const session = require('express-session');
const SQLiteStore = require('connect-sqlite3')(session);

// Initialize DB (runs migrations, seeds defaults)
require('./db/index');

const permitsRouter  = require('./routes/permits');
const checkRouter    = require('./routes/check');
const settingsRouter = require('./routes/settings');
const importRouter   = require('./routes/import');
const authRouter     = require('./routes/auth');
const { requireAuth } = require('./middleware/auth');
const { listScrapers } = require('./scrapers/index');
const scheduler      = require('./services/scheduler');

const app = express();
const PORT = process.env.PORT || 3000;

// ── Session secret ────────────────────────────────────────────────────────────
const SESSION_SECRET = process.env.SESSION_SECRET;
if (!SESSION_SECRET) {
  console.warn('[AUTH] SESSION_SECRET not set — using random fallback. Sessions will not survive restarts. Set SESSION_SECRET in .env.');
}

// ── Middleware ────────────────────────────────────────────────────────────────
app.use(express.json());

app.use(session({
  store: new SQLiteStore({
    db: 'sessions.db',
    dir: path.join(__dirname, '../data'),
  }),
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

// ── Auth routes (no requireAuth) ─────────────────────────────────────────────
app.use('/api/auth', authRouter);

// ── Protected API routes ──────────────────────────────────────────────────────
app.use('/api/permits',  requireAuth, permitsRouter);
app.use('/api/check',    requireAuth, checkRouter);
app.use('/api/settings', requireAuth, settingsRouter);
app.use('/api/import',   requireAuth, importRouter);

// GET /api/scrapers — convenience alias at root level
app.get('/api/scrapers', requireAuth, (req, res) => {
  try {
    res.json(listScrapers());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Catch-all: serve index.html for any non-API route (SPA fallback) ─────────
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/index.html'));
});

// ── Start server ─────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`\n🚀 Permit Tracker running at http://localhost:${PORT}`);
  console.log(`   Data directory: ${path.join(__dirname, '../data')}\n`);

  // Start the scheduled checker
  scheduler.start();
});

module.exports = app;
