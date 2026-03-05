const { pool } = require('./index');

// ─── Permits ─────────────────────────────────────────────────────────────────

async function getAllPermits(tenantId) {
  const { rows } = await pool.query(
    `SELECT * FROM permits WHERE tenant_id = $1 ORDER BY date_added DESC`,
    [tenantId]
  );
  return rows;
}

async function getActivePermits(tenantId) {
  const { rows } = await pool.query(
    `SELECT * FROM permits WHERE tenant_id = $1 AND active = true ORDER BY id`,
    [tenantId]
  );
  return rows;
}

async function getAllActivePermits() {
  const { rows } = await pool.query(
    `SELECT * FROM permits WHERE active = true ORDER BY id`
  );
  return rows;
}

async function getPermitById(id, tenantId) {
  const { rows } = await pool.query(
    `SELECT * FROM permits WHERE id = $1 AND tenant_id = $2`,
    [id, tenantId]
  );
  return rows[0] || null;
}

async function createPermit({ tenant_id, permit_number, address, city, scraper_name, notes }) {
  const { rows } = await pool.query(
    `INSERT INTO permits (tenant_id, permit_number, address, city, scraper_name, notes)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
    [tenant_id, permit_number, address, city, scraper_name, notes]
  );
  return getPermitById(rows[0].id, tenant_id);
}

async function updatePermit(id, tenantId, fields) {
  const allowed = ['permit_number', 'address', 'city', 'scraper_name', 'notes', 'active'];
  const updates = [];
  const values = [];
  let idx = 1;
  for (const k of allowed) {
    if (fields[k] !== undefined) {
      updates.push(`${k} = $${idx++}`);
      values.push(fields[k]);
    }
  }
  if (!updates.length) return getPermitById(id, tenantId);
  values.push(id, tenantId);
  await pool.query(
    `UPDATE permits SET ${updates.join(', ')} WHERE id = $${idx++} AND tenant_id = $${idx++}`,
    values
  );
  return getPermitById(id, tenantId);
}

async function deletePermit(id, tenantId) {
  await pool.query(`DELETE FROM permits WHERE id = $1 AND tenant_id = $2`, [id, tenantId]);
}

async function updatePermitStatus(id, status, tenantId) {
  const current = await getPermitById(id, tenantId);
  await pool.query(
    `UPDATE permits
     SET current_status = $1,
         last_changed_status = $2,
         last_checked = NOW(),
         last_status_changed = NOW()
     WHERE id = $3 AND tenant_id = $4`,
    [status, current ? current.current_status : null, id, tenantId]
  );
}

async function touchPermitChecked(id, tenantId) {
  await pool.query(
    `UPDATE permits SET last_checked = NOW() WHERE id = $1 AND tenant_id = $2`,
    [id, tenantId]
  );
}

// ─── Status History ───────────────────────────────────────────────────────────

async function addHistoryEntry({ tenant_id, permit_id, status, raw_details, status_changed }) {
  const { rows } = await pool.query(
    `INSERT INTO status_history (tenant_id, permit_id, status, raw_details, status_changed)
     VALUES ($1, $2, $3, $4, $5) RETURNING id`,
    [
      tenant_id,
      permit_id,
      status,
      typeof raw_details === 'object' ? JSON.stringify(raw_details) : (raw_details || null),
      Boolean(status_changed),
    ]
  );
  return rows[0].id;
}

async function getHistoryForPermit(permit_id, tenantId) {
  const { rows } = await pool.query(
    `SELECT * FROM status_history WHERE permit_id = $1 AND tenant_id = $2 ORDER BY checked_at DESC`,
    [permit_id, tenantId]
  );
  return rows;
}

// ─── Settings ─────────────────────────────────────────────────────────────────

async function getAllSettings(tenantId) {
  const { rows } = await pool.query(
    `SELECT key, value FROM settings WHERE tenant_id = $1`,
    [tenantId]
  );
  const result = {};
  for (const { key, value } of rows) {
    result[key] = value;
  }
  return result;
}

async function getSetting(tenantId, key) {
  const { rows } = await pool.query(
    `SELECT value FROM settings WHERE tenant_id = $1 AND key = $2`,
    [tenantId, key]
  );
  return rows[0] ? rows[0].value : null;
}

async function setSetting(tenantId, key, value) {
  await pool.query(
    `INSERT INTO settings (tenant_id, key, value) VALUES ($1, $2, $3)
     ON CONFLICT (tenant_id, key) DO UPDATE SET value = EXCLUDED.value`,
    [tenantId, key, String(value)]
  );
}

async function updateSettings(tenantId, settingsObj) {
  for (const [key, value] of Object.entries(settingsObj)) {
    await setSetting(tenantId, key, value);
  }
  return getAllSettings(tenantId);
}

// ─── Users ────────────────────────────────────────────────────────────────────

async function getUserByUsername(username) {
  const { rows } = await pool.query(
    `SELECT * FROM users WHERE LOWER(username) = LOWER($1) LIMIT 1`,
    [username]
  );
  return rows[0] || null;
}

async function getUserById(tenantId, id) {
  const { rows } = await pool.query(
    `SELECT id, tenant_id, username, email, first_name, last_name, role, is_super_admin, active, created_at, last_login
     FROM users WHERE id = $1 AND tenant_id = $2`,
    [id, tenantId]
  );
  return rows[0] || null;
}

async function getUserByIdCrossTenant(id) {
  const { rows } = await pool.query(
    `SELECT id, tenant_id, username, email, first_name, last_name, role, is_super_admin, active, created_at, last_login
     FROM users WHERE id = $1`,
    [id]
  );
  return rows[0] || null;
}

async function listUsers(tenantId) {
  const { rows } = await pool.query(
    `SELECT id, tenant_id, username, email, first_name, last_name, role, is_super_admin, active, created_at, last_login
     FROM users WHERE tenant_id = $1 ORDER BY created_at ASC`,
    [tenantId]
  );
  return rows;
}

async function listAllUsers() {
  const { rows } = await pool.query(
    `SELECT u.id, u.tenant_id, u.username, u.email, u.first_name, u.last_name, u.role, u.is_super_admin, u.active, u.created_at, u.last_login,
            t.name AS tenant_name, t.slug AS tenant_slug
     FROM users u
     JOIN tenants t ON t.id = u.tenant_id
     ORDER BY t.name ASC, u.created_at ASC`
  );
  return rows;
}

async function createUser(tenantId, username, passwordHash, role = 'user') {
  const { rows } = await pool.query(
    `INSERT INTO users (tenant_id, username, password_hash, role) VALUES ($1, $2, $3, $4) RETURNING id`,
    [tenantId, username, passwordHash, role]
  );
  return getUserById(tenantId, rows[0].id);
}

async function updateUser(tenantId, id, fields) {
  const allowed = ['username', 'email', 'first_name', 'last_name', 'role', 'is_super_admin', 'active'];
  const updates = [];
  const values = [];
  let idx = 1;
  for (const k of allowed) {
    if (fields[k] !== undefined) {
      updates.push(`${k} = $${idx++}`);
      values.push(fields[k]);
    }
  }
  if (!updates.length) return getUserById(tenantId, id);
  values.push(id, tenantId);
  await pool.query(
    `UPDATE users SET ${updates.join(', ')} WHERE id = $${idx++} AND tenant_id = $${idx++}`,
    values
  );
  return getUserById(tenantId, id);
}

async function updateUserCrossTenant(id, fields) {
  const allowed = ['username', 'email', 'first_name', 'last_name', 'role', 'is_super_admin', 'active'];
  const updates = [];
  const values = [];
  let idx = 1;
  for (const k of allowed) {
    if (fields[k] !== undefined) {
      updates.push(`${k} = $${idx++}`);
      values.push(fields[k]);
    }
  }
  if (!updates.length) return getUserByIdCrossTenant(id);
  values.push(id);
  await pool.query(
    `UPDATE users SET ${updates.join(', ')} WHERE id = $${idx++}`,
    values
  );
  return getUserByIdCrossTenant(id);
}

async function deleteUser(tenantId, id) {
  await pool.query(`DELETE FROM users WHERE id = $1 AND tenant_id = $2`, [id, tenantId]);
}

async function deleteUserCrossTenant(id) {
  await pool.query(`DELETE FROM users WHERE id = $1`, [id]);
}

async function updateUserPassword(id, passwordHash) {
  await pool.query(`UPDATE users SET password_hash = $1 WHERE id = $2`, [passwordHash, id]);
}

async function updateLastLogin(id) {
  await pool.query(`UPDATE users SET last_login = NOW() WHERE id = $1`, [id]);
}

// ─── Tenants ──────────────────────────────────────────────────────────────────

async function listTenants() {
  const { rows } = await pool.query(`SELECT * FROM tenants ORDER BY created_at ASC`);
  return rows;
}

async function createTenant(name, slug) {
  const { rows } = await pool.query(
    `INSERT INTO tenants (name, slug) VALUES ($1, $2) RETURNING *`,
    [name, slug]
  );
  return rows[0];
}

async function updateTenant(id, fields) {
  const allowed = ['name', 'slug'];
  const updates = [];
  const values = [];
  let idx = 1;
  for (const k of allowed) {
    if (fields[k] !== undefined) {
      updates.push(`${k} = $${idx++}`);
      values.push(fields[k]);
    }
  }
  if (!updates.length) {
    const { rows } = await pool.query(`SELECT * FROM tenants WHERE id = $1`, [id]);
    return rows[0] || null;
  }
  values.push(id);
  const { rows } = await pool.query(
    `UPDATE tenants SET ${updates.join(', ')} WHERE id = $${idx++} RETURNING *`,
    values
  );
  return rows[0] || null;
}

async function deleteTenant(id) {
  await pool.query(`DELETE FROM tenants WHERE id = $1`, [id]);
}

module.exports = {
  getAllPermits,
  getActivePermits,
  getAllActivePermits,
  getPermitById,
  createPermit,
  updatePermit,
  deletePermit,
  updatePermitStatus,
  touchPermitChecked,
  addHistoryEntry,
  getHistoryForPermit,
  getAllSettings,
  getSetting,
  setSetting,
  updateSettings,
  getUserByUsername,
  getUserById,
  getUserByIdCrossTenant,
  listUsers,
  listAllUsers,
  createUser,
  updateUser,
  updateUserCrossTenant,
  deleteUser,
  deleteUserCrossTenant,
  updateUserPassword,
  updateLastLogin,
  listTenants,
  createTenant,
  updateTenant,
  deleteTenant,
};
