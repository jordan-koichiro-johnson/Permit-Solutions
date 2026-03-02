const express = require('express');
const router = express.Router();
const { checkAllPermits, checkPermit } = require('../services/checker');
const { listScrapers } = require('../scrapers/index');

// POST /api/check — trigger check for all active permits
router.post('/', async (req, res) => {
  try {
    const results = await checkAllPermits();
    res.json(results);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/check/:id — trigger check for one permit
router.post('/:id', async (req, res) => {
  try {
    const id = Number(req.params.id);
    const result = await checkPermit(id);
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
