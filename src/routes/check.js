const express = require('express');
const router = express.Router();
const { checkAllPermits, checkPermit } = require('../services/checker');
const { listScrapers } = require('../scrapers/index');
const { attachPlan } = require('../middleware/auth');

// POST /api/check — trigger check for all active permits (blocked on free tier)
router.post('/', attachPlan, async (req, res) => {
  if (!req.tenantPlan.canCheck) {
    return res.status(403).json({ error: 'Bulk permit checking requires a paid plan. Upgrade in Settings → Billing.' });
  }
  try {
    const results = await checkAllPermits(req.tenantId);
    res.json(results);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/check/:id — trigger check for one permit
router.post('/:id', async (req, res) => {
  try {
    const id = Number(req.params.id);
    const result = await checkPermit(id, req.tenantId);
    res.json(result);
  } catch (err) {
    if (err.message.includes('not found')) {
      return res.status(404).json({ error: err.message });
    }
    res.status(500).json({ error: err.message });
  }
});

// GET /api/scrapers — list available scrapers
router.get('/scrapers', (req, res) => {
  try {
    res.json(listScrapers());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
