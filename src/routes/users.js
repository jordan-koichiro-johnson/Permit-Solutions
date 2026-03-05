const express = require('express');
const bcrypt = require('bcryptjs');
const { requireAuth, requireAdmin, requireSuperAdmin, attachTenant } = require('../middleware/auth');
const {
  listUsers, listAllUsers,
  getUserById, getUserByIdCrossTenant,
  createUser, updateUser, updateUserCrossTenant,
  deleteUser, deleteUserCrossTenant,
  updateUserPassword,
} = require('../db/queries');

const router = express.Router();

// All routes require auth + tenant attached
router.use(requireAuth, attachTenant);

// ── GET /api/users ─────────────────────────────────────────────────────────
// Admin: returns users in own tenant.
// Super-admin: returns all users across all tenants.
router.get('/', requireAdmin, async (req, res) => {
  try {
    const users = req.session.isSuperAdmin
      ? await listAllUsers()
      : await listUsers(req.tenantId);
    res.json(users);
  } catch (err) {
    console.error('[USERS] list error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── POST /api/users ────────────────────────────────────────────────────────
// Admin: create user in own tenant.
// Super-admin: can specify tenant_id.
router.post('/', requireAdmin, async (req, res) => {
  const { username, password, email, first_name, last_name, role } = req.body || {};

  if (!username || !password) {
    return res.status(400).json({ error: 'username and password are required' });
  }
  if (password.length < 6) {
    return res.status(400).json({ error: 'Password must be at least 6 characters' });
  }

  // Only super-admin can set role='admin' or is_super_admin, or pick another tenant
  const targetTenantId = (req.session.isSuperAdmin && req.body.tenant_id)
    ? Number(req.body.tenant_id)
    : req.tenantId;

  const assignedRole = (req.session.isSuperAdmin && role) ? role : 'user';

  try {
    const hash = await bcrypt.hash(password, 12);
    const user = await createUser(targetTenantId, username, hash, assignedRole);

    // Set optional fields if provided
    const extras = {};
    if (email      !== undefined) extras.email      = email;
    if (first_name !== undefined) extras.first_name = first_name;
    if (last_name  !== undefined) extras.last_name  = last_name;
    if (Object.keys(extras).length) {
      await updateUser(targetTenantId, user.id, extras);
    }

    const fresh = await getUserById(targetTenantId, user.id);
    res.status(201).json(fresh);
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'Username already exists in this tenant' });
    console.error('[USERS] create error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── PUT /api/users/:id ─────────────────────────────────────────────────────
router.put('/:id', requireAdmin, async (req, res) => {
  const id = Number(req.params.id);
  const { username, email, first_name, last_name, role, is_super_admin, active } = req.body || {};

  // Prevent admin from promoting to super-admin
  const fields = { username, email, first_name, last_name, active };
  if (req.session.isSuperAdmin) {
    if (role          !== undefined) fields.role          = role;
    if (is_super_admin !== undefined) fields.is_super_admin = Boolean(is_super_admin);
  } else {
    // Regular admin can set role to 'admin' or 'user' within their tenant only
    if (role !== undefined) fields.role = role;
  }

  // Prevent admin from deleting/modifying their own role or active status downward
  if (id === req.session.userId && active === false) {
    return res.status(400).json({ error: 'Cannot deactivate your own account' });
  }

  try {
    const user = req.session.isSuperAdmin
      ? await updateUserCrossTenant(id, fields)
      : await updateUser(req.tenantId, id, fields);

    if (!user) return res.status(404).json({ error: 'User not found' });
    res.json(user);
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'Username already exists in this tenant' });
    console.error('[USERS] update error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── DELETE /api/users/:id ──────────────────────────────────────────────────
router.delete('/:id', requireAdmin, async (req, res) => {
  const id = Number(req.params.id);

  if (id === req.session.userId) {
    return res.status(400).json({ error: 'Cannot delete your own account' });
  }

  try {
    if (req.session.isSuperAdmin) {
      await deleteUserCrossTenant(id);
    } else {
      await deleteUser(req.tenantId, id);
    }
    res.json({ ok: true });
  } catch (err) {
    console.error('[USERS] delete error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── POST /api/users/:id/reset-password ────────────────────────────────────
// Admin reset — no current password required.
router.post('/:id/reset-password', requireAdmin, async (req, res) => {
  const id = Number(req.params.id);
  const { newPassword } = req.body || {};

  if (!newPassword || newPassword.length < 6) {
    return res.status(400).json({ error: 'newPassword must be at least 6 characters' });
  }

  // Verify the target user belongs to admin's tenant (unless super-admin)
  if (!req.session.isSuperAdmin) {
    const user = await getUserById(req.tenantId, id);
    if (!user) return res.status(404).json({ error: 'User not found' });
  }

  try {
    const hash = await bcrypt.hash(newPassword, 12);
    await updateUserPassword(id, hash);
    res.json({ ok: true });
  } catch (err) {
    console.error('[USERS] reset-password error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
