const express = require('express');
const router = express.Router();
const queries = require('../db/queries');
const { sendTestEmail } = require('../services/notifier');
const scheduler = require('../services/scheduler');

// GET /api/settings — get all settings
router.get('/', async (req, res) => {
  try {
    const settings = await queries.getAllSettings(req.tenantId);
    // Mask SMTP password in response
    const safe = { ...settings };
    if (safe.smtp_pass && safe.smtp_pass.length > 0) {
      safe.smtp_pass = '••••••••';
    }
    res.json(safe);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/settings — update settings
router.put('/', async (req, res) => {
  try {
    const allowed = [
      'check_interval_hours',
      'email_to',
      'email_from',
      'smtp_host',
      'smtp_port',
      'smtp_user',
      'smtp_pass',
    ];

    const updates = {};
    for (const key of allowed) {
      if (req.body[key] !== undefined) {
        // Skip masked password (user didn't change it)
        if (key === 'smtp_pass' && req.body[key] === '••••••••') continue;
        updates[key] = req.body[key];
      }
    }

    await queries.updateSettings(req.tenantId, updates);

    // Restart scheduler if interval changed
    if (updates.check_interval_hours) {
      await scheduler.restart();
    }

    const settings = await queries.getAllSettings(req.tenantId);
    const safe = { ...settings };
    if (safe.smtp_pass && safe.smtp_pass.length > 0) {
      safe.smtp_pass = '••••••••';
    }
    res.json(safe);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/settings/test-email — send a test email
router.post('/test-email', async (req, res) => {
  try {
    await sendTestEmail(req.tenantId);
    res.json({ success: true, message: 'Test email sent successfully.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/settings/scheduler — scheduler status
router.get('/scheduler', (req, res) => {
  try {
    res.json(scheduler.getStatus());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
