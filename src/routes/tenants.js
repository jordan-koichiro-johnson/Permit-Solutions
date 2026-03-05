const express = require('express');
const { requireAuth, requireSuperAdmin } = require('../middleware/auth');
const { listTenants, createTenant, updateTenant, deleteTenant } = require('../db/queries');

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

module.exports = router;
