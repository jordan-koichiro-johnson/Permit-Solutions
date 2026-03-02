const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
const bcrypt = require('bcryptjs');

const DATA_DIR = path.join(__dirname, '../../data');
const DB_PATH = path.join(DATA_DIR, 'permits.db');

// Ensure data directory exists
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

const db = new Database(DB_PATH);

// Enable WAL mode for better concurrent read performance
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// Schema migrations
db.exec(`
  CREATE TABLE IF NOT EXISTS permits (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    permit_number TEXT NOT NULL,
    address TEXT,
    city TEXT,
    scraper_name TEXT NOT NULL,
    current_status TEXT,
    last_changed_status TEXT,
    last_checked DATETIME,
    date_added DATETIME DEFAULT (datetime('now')),
    notes TEXT,
    active INTEGER DEFAULT 1
  );

  CREATE TABLE IF NOT EXISTS status_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    permit_id INTEGER NOT NULL REFERENCES permits(id) ON DELETE CASCADE,
    status TEXT,
    raw_details TEXT,
    checked_at DATETIME DEFAULT (datetime('now')),
    status_changed INTEGER DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT
  );

  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL UNIQUE COLLATE NOCASE,
    password_hash TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now')),
    last_login TEXT
  );
`);

// Add last_status_changed column if it doesn't exist (migration)
const permitCols = db.pragma('table_info(permits)').map(c => c.name);
if (!permitCols.includes('last_status_changed')) {
  db.exec(`ALTER TABLE permits ADD COLUMN last_status_changed DATETIME`);
}

// Insert default settings if not present
const insertDefault = db.prepare(
  `INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)`
);

const defaults = {
  check_interval_hours: '4',
  email_to: '',
  email_from: '',
  smtp_host: 'smtp.gmail.com',
  smtp_port: '587',
  smtp_user: '',
  smtp_pass: '',
};

for (const [key, value] of Object.entries(defaults)) {
  insertDefault.run(key, value);
}

// Seed default admin user if no users exist
const userCount = db.prepare('SELECT COUNT(*) as c FROM users').get();
if (userCount.c === 0) {
  const hash = bcrypt.hashSync('admin', 12);
  db.prepare('INSERT INTO users (username, password_hash) VALUES (?, ?)').run('admin', hash);
  console.warn('[AUTH] Default admin/admin account created. Change the password immediately.');
}

module.exports = db;
