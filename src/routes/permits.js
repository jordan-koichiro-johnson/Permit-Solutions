const express = require('express');
const router = express.Router();
const queries = require('../db/queries');

// GET /api/permits — list all permits
router.get('/', async (req, res) => {
  try {
    const permits = await queries.getAllPermits(req.tenantId);
    res.json(permits);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/permits/:id — get one permit
router.get('/:id', async (req, res) => {
  try {
    const permit = await queries.getPermitById(Number(req.params.id), req.tenantId);
    if (!permit) return res.status(404).json({ error: 'Permit not found' });
    res.json(permit);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/permits — create permit
router.post('/', async (req, res) => {
  try {
    const { permit_number, address, city, scraper_name, notes } = req.body;

    if (!permit_number || !permit_number.trim()) {
      return res.status(400).json({ error: 'permit_number is required' });
    }
    if (!scraper_name || !scraper_name.trim()) {
      return res.status(400).json({ error: 'scraper_name is required' });
    }

    const permit = await queries.createPermit({
      tenant_id: req.tenantId,
      permit_number: permit_number.trim(),
      address: address?.trim() || null,
      city: city?.trim() || null,
      scraper_name: scraper_name.trim(),
      notes: notes?.trim() || null,
    });
    res.status(201).json(permit);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/permits/:id — update permit
router.put('/:id', async (req, res) => {
  try {
    const id = Number(req.params.id);
    const existing = await queries.getPermitById(id, req.tenantId);
    if (!existing) return res.status(404).json({ error: 'Permit not found' });

    const { permit_number, address, city, scraper_name, notes, active } = req.body;
    const fields = {};
    if (permit_number !== undefined) fields.permit_number = permit_number;
    if (address !== undefined) fields.address = address;
    if (city !== undefined) fields.city = city;
    if (scraper_name !== undefined) fields.scraper_name = scraper_name;
    if (notes !== undefined) fields.notes = notes;
    if (active !== undefined) fields.active = Boolean(active);

    const updated = await queries.updatePermit(id, req.tenantId, fields);
    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/permits/:id — delete permit
router.delete('/:id', async (req, res) => {
  try {
    const id = Number(req.params.id);
    const existing = await queries.getPermitById(id, req.tenantId);
    if (!existing) return res.status(404).json({ error: 'Permit not found' });
    await queries.deletePermit(id, req.tenantId);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/permits/:id/history — status history
router.get('/:id/history', async (req, res) => {
  try {
    const id = Number(req.params.id);
    const permit = await queries.getPermitById(id, req.tenantId);
    if (!permit) return res.status(404).json({ error: 'Permit not found' });
    const history = await queries.getHistoryForPermit(id, req.tenantId);
    res.json(history);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
