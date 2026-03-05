const express = require('express');
const router  = express.Router();
const everett    = require('../scripts/import-everett');
const bellingham = require('../scripts/import-bellingham');
const marysville = require('../scripts/import-marysville');
const { getSetting } = require('../db/queries');
const { attachPlan } = require('../middleware/auth');

const IMPORTERS = [
  { name: 'bellingham', displayName: 'Bellingham, WA', state: 'WA' },
  { name: 'everett',    displayName: 'Everett, WA',    state: 'WA' },
  { name: 'marysville', displayName: 'Marysville, WA', state: 'WA' },
];

// GET /api/import/list — return importers filtered by tenant's unlocked states
router.get('/list', attachPlan, (req, res) => {
  const { states } = req.tenantPlan;
  const visible = IMPORTERS.filter(i => i.state === null || states.includes(i.state));
  res.json(visible);
});

async function getContractorName(tenantId) {
  const name = await getSetting(tenantId, 'contractor_name');
  if (!name || !name.trim()) {
    throw new Error('No contractor name set. Go to Settings → General and enter your contractor name first.');
  }
  return name.trim();
}

function requireImport(req, res, next) {
  if (!req.tenantPlan || !req.tenantPlan.canImport) {
    return res.status(403).json({ error: 'Importing requires a paid plan. Upgrade in Settings → Billing.' });
  }
  next();
}

// POST /api/import/everett
router.post('/everett', attachPlan, requireImport, async (req, res) => {
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
router.post('/bellingham', attachPlan, requireImport, async (req, res) => {
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
router.post('/marysville', attachPlan, requireImport, async (req, res) => {
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
