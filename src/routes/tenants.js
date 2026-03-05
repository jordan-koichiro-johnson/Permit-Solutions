const express = require('express');
const { requireAuth, requireSuperAdmin } = require('../middleware/auth');
const { listTenants, createTenant, updateTenant, deleteTenant, getTenantStates } = require('../db/queries');
const { syncAddState, syncRemoveState } = require('./billing');

const router = express.Router();

// All routes: must be authenticated + super-admin
router.use(requireAuth, requireSuperAdmin);

// ── GET /api/tenants ───────────────────────────────────────────────────────
router.get('/', async (req, res) => {
  try {
    const tenants = await listTenants();
    res.json(tenants);
  } catch (err) {
    console.error('[TENANTS] list error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── POST /api/tenants ──────────────────────────────────────────────────────
router.post('/', async (req, res) => {
  const { name, slug } = req.body || {};
  if (!name || !slug) return res.status(400).json({ error: 'name and slug are required' });
  if (!/^[a-z0-9-]+$/.test(slug)) {
    return res.status(400).json({ error: 'slug must contain only lowercase letters, numbers, and hyphens' });
  }

  try {
    const tenant = await createTenant(name, slug);
    res.status(201).json(tenant);
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'A tenant with that slug already exists' });
    console.error('[TENANTS] create error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── PUT /api/tenants/:id ───────────────────────────────────────────────────
router.put('/:id', async (req, res) => {
  const id = Number(req.params.id);
  const { name, slug } = req.body || {};

  if (slug !== undefined && !/^[a-z0-9-]+$/.test(slug)) {
    return res.status(400).json({ error: 'slug must contain only lowercase letters, numbers, and hyphens' });
  }

  try {
    const tenant = await updateTenant(id, { name, slug });
    if (!tenant) return res.status(404).json({ error: 'Tenant not found' });
    res.json(tenant);
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'A tenant with that slug already exists' });
    console.error('[TENANTS] update error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── DELETE /api/tenants/:id ────────────────────────────────────────────────
router.delete('/:id', async (req, res) => {
  const id = Number(req.params.id);
  if (id === 1) return res.status(400).json({ error: 'Cannot delete the default tenant' });

  try {
    await deleteTenant(id);
    res.json({ ok: true });
  } catch (err) {
    console.error('[TENANTS] delete error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── GET /api/tenants/:id/states ────────────────────────────────────────────
router.get('/:id/states', async (req, res) => {
  try {
    const states = await getTenantStates(Number(req.params.id));
    res.json({ states });
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── POST /api/tenants/:id/states ───────────────────────────────────────────
router.post('/:id/states', async (req, res) => {
  const tenantId = Number(req.params.id);
  const { state } = req.body || {};
  if (!state || !/^[A-Za-z]{2}$/.test(state)) {
    return res.status(400).json({ error: 'state must be a 2-letter code' });
  }
  try {
    await syncAddState(tenantId, state.toUpperCase());
    const states = await getTenantStates(tenantId);
    res.json({ ok: true, states });
  } catch (err) {
    console.error('[TENANTS] add state error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── DELETE /api/tenants/:id/states/:code ───────────────────────────────────
router.delete('/:id/states/:code', async (req, res) => {
  const tenantId = Number(req.params.id);
  const code = (req.params.code || '').toUpperCase();
  if (!/^[A-Z]{2}$/.test(code)) {
    return res.status(400).json({ error: 'state must be a 2-letter code' });
  }
  try {
    await syncRemoveState(tenantId, code);
    const states = await getTenantStates(tenantId);
    res.json({ ok: true, states });
  } catch (err) {
    console.error('[TENANTS] remove state error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
