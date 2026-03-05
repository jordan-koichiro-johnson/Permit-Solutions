const express = require('express');
const bcrypt = require('bcryptjs');
const rateLimit = require('express-rate-limit');
const { getUserByUsername, updateLastLogin, updateUserPassword } = require('../db/queries');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10,
  message: { error: 'Too many login attempts. Try again in 15 minutes.' },
  standardHeaders: true,
  legacyHeaders: false,
});

// POST /api/auth/login
router.post('/login', loginLimiter, async (req, res) => {
  const { username, password } = req.body || {};

  if (!username || !password) {
    return res.status(400).json({ error: 'Invalid credentials' });
  }

  try {
    const user = await getUserByUsername(username);
    if (!user) {
      // Constant-time compare to prevent user enumeration
      await bcrypt.compare(password, '$2b$12$invalidhashpadding000000000000000000000000000000000000');
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const match = await bcrypt.compare(password, user.password_hash);
    if (!match) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    if (user.active === false) {
      return res.status(401).json({ error: 'Account is disabled' });
    }

    // Regenerate session to prevent session fixation
    req.session.regenerate((err) => {
      if (err) return res.status(500).json({ error: 'Session error' });
      req.session.userId      = user.id;
      req.session.username    = user.username;
      req.session.tenantId    = user.tenant_id;
      req.session.role        = user.role || 'user';
      req.session.isSuperAdmin = Boolean(user.is_super_admin);
      // Explicitly save before responding so the store is written before the
      // browser receives the cookie — prevents logout-on-refresh
      req.session.save((saveErr) => {
        if (saveErr) return res.status(500).json({ error: 'Session save error' });
        updateLastLogin(user.id).catch(e => console.error('[AUTH] updateLastLogin failed:', e));
        res.json({ id: user.id, username: user.username, role: user.role || 'user', isSuperAdmin: Boolean(user.is_super_admin) });
      });
    });
  } catch (err) {
    console.error('[AUTH] Login error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/auth/logout
router.post('/logout', (req, res) => {
  req.session.destroy((err) => {
    if (err) {
      return res.status(500).json({ error: 'Logout failed' });
    }
    res.clearCookie('connect.sid');
    res.json({ ok: true });
  });
});

// GET /api/auth/me
router.get('/me', (req, res) => {
  if (!req.session || !req.session.userId) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  res.json({
    id:          req.session.userId,
    username:    req.session.username,
    role:        req.session.role || 'user',
    isSuperAdmin: Boolean(req.session.isSuperAdmin),
  });
});

// POST /api/auth/change-password
router.post('/change-password', requireAuth, async (req, res) => {
  const { currentPassword, newPassword } = req.body || {};
  if (!currentPassword || !newPassword) {
    return res.status(400).json({ error: 'currentPassword and newPassword are required' });
  }
  if (newPassword.length < 6) {
    return res.status(400).json({ error: 'New password must be at least 6 characters' });
  }

  try {
    const { rows } = await require('../db/index').pool.query(
      `SELECT password_hash FROM users WHERE id = $1`,
      [req.session.userId]
    );
    if (!rows.length) return res.status(404).json({ error: 'User not found' });

    const match = await bcrypt.compare(currentPassword, rows[0].password_hash);
    if (!match) return res.status(401).json({ error: 'Current password is incorrect' });

    const newHash = await bcrypt.hash(newPassword, 12);
    await updateUserPassword(req.session.userId, newHash);
    res.json({ ok: true });
  } catch (err) {
    console.error('[AUTH] change-password error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
