const express = require('express');
const router  = express.Router();
const everett    = require('../scripts/import-everett');
const bellingham = require('../scripts/import-bellingham');
const marysville = require('../scripts/import-marysville');
const { getSetting } = require('../db/queries');

const IMPORTERS = [
  { name: 'bellingham', displayName: 'Bellingham, WA' },
  { name: 'everett',    displayName: 'Everett, WA'    },
  { name: 'marysville', displayName: 'Marysville, WA' },
];

// GET /api/import/list — list available importers
router.get('/list', (req, res) => res.json(IMPORTERS));

async function getContractorName(tenantId) {
  const name = await getSetting(tenantId, 'contractor_name');
  if (!name || !name.trim()) {
    throw new Error('No contractor name set. Go to Settings → General and enter your contractor name first.');
  }
  return name.trim();
}

// POST /api/import/everett
router.post('/everett', async (req, res) => {
  const logs = [];
  const log  = msg => { logs.push(msg); console.log('[import]', msg); };
  try {
    const contractorName = await getContractorName(req.tenantId);
    const result = await everett.run(req.tenantId, log, contractorName);
    res.json({ success: true, ...result, logs });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message, logs });
  }
});

// POST /api/import/bellingham
router.post('/bellingham', async (req, res) => {
  const logs = [];
  const log  = msg => { logs.push(msg); console.log('[import]', msg); };
  try {
    const contractorName = await getContractorName(req.tenantId);
    const result = await bellingham.run(req.tenantId, log, contractorName);
    res.json({ success: true, ...result, logs });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message, logs });
  }
});

// POST /api/import/marysville
router.post('/marysville', async (req, res) => {
  const logs = [];
  const log  = msg => { logs.push(msg); console.log('[import]', msg); };
  try {
    const contractorName = await getContractorName(req.tenantId);
    const result = await marysville.run(req.tenantId, log, contractorName);
    res.json({ success: true, ...result, logs });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message, logs });
  }
});

module.exports = router;
