const db = require('./index');

// ─── Permits ────────────────────────────────────────────────────────────────

function getAllPermits() {
  return db.prepare(`
    SELECT * FROM permits ORDER BY date_added DESC
  `).all();
}

function getActivePermits() {
  return db.prepare(`
    SELECT * FROM permits WHERE active = 1 ORDER BY id
  `).all();
}

function getPermitById(id) {
  return db.prepare(`SELECT * FROM permits WHERE id = ?`).get(id);
}

function createPermit({ permit_number, address, city, scraper_name, notes }) {
  const stmt = db.prepare(`
    INSERT INTO permits (permit_number, address, city, scraper_name, notes)
    VALUES (@permit_number, @address, @city, @scraper_name, @notes)
  `);
  const result = stmt.run({ permit_number, address, city, scraper_name, notes });
  return getPermitById(result.lastInsertRowid);
}

function updatePermit(id, fields) {
  const allowed = ['permit_number', 'address', 'city', 'scraper_name', 'notes', 'active'];
  const updates = Object.keys(fields)
    .filter(k => allowed.includes(k))
    .map(k => `${k} = @${k}`)
    .join(', ');

  if (!updates) return getPermitById(id);

  db.prepare(`UPDATE permits SET ${updates} WHERE id = @id`).run({ ...fields, id });
  return getPermitById(id);
}

function deletePermit(id) {
  db.prepare(`DELETE FROM permits WHERE id = ?`).run(id);
}

function updatePermitStatus(id, status) {
  const current = getPermitById(id);
  db.prepare(`
    UPDATE permits
    SET current_status = @status,
        last_changed_status = @old_status,
        last_checked = datetime('now'),
        last_status_changed = datetime('now')
    WHERE id = @id
  `).run({ status, old_status: current ? current.current_status : null, id });
}

function touchPermitChecked(id) {
  db.prepare(`
    UPDATE permits SET last_checked = datetime('now') WHERE id = ?
  `).run(id);
}

// ─── Status History ──────────────────────────────────────────────────────────

function addHistoryEntry({ permit_id, status, raw_details, status_changed }) {
  const stmt = db.prepare(`
    INSERT INTO status_history (permit_id, status, raw_details, status_changed)
    VALUES (@permit_id, @status, @raw_details, @status_changed)
  `);
  const result = stmt.run({
    permit_id,
    status,
    raw_details: typeof raw_details === 'object' ? JSON.stringify(raw_details) : (raw_details || null),
    status_changed: status_changed ? 1 : 0,
  });
  return result.lastInsertRowid;
}

function getHistoryForPermit(permit_id) {
  return db.prepare(`
    SELECT * FROM status_history
    WHERE permit_id = ?
    ORDER BY checked_at DESC
  `).all(permit_id);
}

// ─── Settings ────────────────────────────────────────────────────────────────

function getAllSettings() {
  const rows = db.prepare(`SELECT key, value FROM settings`).all();
  const result = {};
  for (const { key, value } of rows) {
    result[key] = value;
  }
  return result;
}

function getSetting(key) {
  const row = db.prepare(`SELECT value FROM settings WHERE key = ?`).get(key);
  return row ? row.value : null;
}

function setSetting(key, value) {
  db.prepare(`
    INSERT INTO settings (key, value) VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `).run(key, String(value));
}

function updateSettings(settingsObj) {
  const update = db.transaction((obj) => {
    for (const [key, value] of Object.entries(obj)) {
      setSetting(key, value);
    }
  });
  update(settingsObj);
  return getAllSettings();
}

// ─── Users ───────────────────────────────────────────────────────────────────

function getUserByUsername(username) {
  return db.prepare(`SELECT * FROM users WHERE username = @username COLLATE NOCASE`).get({ username });
}

function createUser(username, passwordHash) {
  return db.prepare(`INSERT INTO users (username, password_hash) VALUES (@username, @passwordHash)`).run({ username, passwordHash });
}

function updateLastLogin(id) {
  db.prepare(`UPDATE users SET last_login = datetime('now') WHERE id = @id`).run({ id });
}

module.exports = {
  getAllPermits,
  getActivePermits,
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
  createUser,
  updateLastLogin,
};
