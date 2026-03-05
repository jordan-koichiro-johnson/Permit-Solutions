const express = require('express');
const router  = express.Router();
const everett    = require('../scripts/import-everett');
const bellingham = require('../scripts/import-bellingham');
const marysville = require('../scripts/import-marysville');

const IMPORTERS = [
  { name: 'bellingham', displayName: 'Bellingham, WA' },
  { name: 'everett',    displayName: 'Everett, WA'    },
  { name: 'marysville', displayName: 'Marysville, WA' },
];

// GET /api/import/list — list available importers
router.get('/list', (req, res) => res.json(IMPORTERS));

// POST /api/import/everett — run a full import from Everett portal
router.post('/everett', async (req, res) => {
  const logs = [];
  const log  = msg => { logs.push(msg); console.log('[import]', msg); };

  try {
    const result = await everett.run(req.tenantId, log);
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
    const result = await bellingham.run(req.tenantId, log);
    res.json({ success: true, ...result, logs });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message, logs });
  }
});

// POST /api/import/marysville — run a full import from Marysville portal
router.post('/marysville', async (req, res) => {
  const logs = [];
  const log  = msg => { logs.push(msg); console.log('[import]', msg); };

  try {
    const result = await marysville.run(req.tenantId, log);
    res.json({ success: true, ...result, logs });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message, logs });
  }
});

module.exports = router;
