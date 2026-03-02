const express = require('express');
const router  = express.Router();
const everett    = require('../scripts/import-everett');
const bellingham = require('../scripts/import-bellingham');

// POST /api/import/everett — run a full import from Everett portal
router.post('/everett', async (req, res) => {
  const logs = [];
  const log  = msg => { logs.push(msg); console.log('[import]', msg); };

  try {
    const result = await everett.run(log);
    res.json({ success: true, ...result, logs });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message, logs });
  }
});

// POST /api/import/bellingham — run a full import from Bellingham portal
router.post('/bellingham', async (req, res) => {
  const logs = [];
  const log  = msg => { logs.push(msg); console.log('[import]', msg); };

  try {
    const result = await bellingham.run(log);
    res.json({ success: true, ...result, logs });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message, logs });
  }
});

module.exports = router;
