const { Pool } = require('pg');
const bcrypt = require('bcryptjs');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
});

async function initDb() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS tenants (
      id         SERIAL PRIMARY KEY,
      name       TEXT NOT NULL,
      slug       TEXT UNIQUE NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS users (
      id            SERIAL PRIMARY KEY,
      tenant_id     INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      username      TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      created_at    TIMESTAMPTZ DEFAULT NOW(),
      last_login    TIMESTAMPTZ,
      UNIQUE(tenant_id, username)
    );

    CREATE TABLE IF NOT EXISTS permits (
      id                  SERIAL PRIMARY KEY,
      tenant_id           INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      permit_number       TEXT NOT NULL,
      address             TEXT,
      city                TEXT,
      scraper_name        TEXT NOT NULL,
      current_status      TEXT,
      last_changed_status TEXT,
      last_checked        TIMESTAMPTZ,
      date_added          TIMESTAMPTZ DEFAULT NOW(),
      notes               TEXT,
      active              BOOLEAN DEFAULT TRUE,
      last_status_changed TIMESTAMPTZ
    );

    CREATE TABLE IF NOT EXISTS status_history (
      id             SERIAL PRIMARY KEY,
      tenant_id      INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      permit_id      INTEGER NOT NULL REFERENCES permits(id) ON DELETE CASCADE,
      status         TEXT,
      raw_details    TEXT,
      checked_at     TIMESTAMPTZ DEFAULT NOW(),
      status_changed BOOLEAN DEFAULT FALSE
    );

    CREATE TABLE IF NOT EXISTS settings (
      id        SERIAL PRIMARY KEY,
      tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      key       TEXT NOT NULL,
      value     TEXT,
      UNIQUE(tenant_id, key)
    );
  `);

  // Migrate users table: add new columns if they don't exist yet
  await pool.query(`
    ALTER TABLE users ADD COLUMN IF NOT EXISTS email TEXT;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS first_name TEXT;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS last_name TEXT;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS role TEXT NOT NULL DEFAULT 'user';
    ALTER TABLE users ADD COLUMN IF NOT EXISTS is_super_admin BOOLEAN NOT NULL DEFAULT FALSE;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS active BOOLEAN NOT NULL DEFAULT TRUE;
  `);

  // Migrate tenants table: add plan + Stripe columns
  await pool.query(`
    ALTER TABLE tenants ADD COLUMN IF NOT EXISTS plan TEXT NOT NULL DEFAULT 'free';
    ALTER TABLE tenants ADD COLUMN IF NOT EXISTS stripe_customer_id TEXT;
    ALTER TABLE tenants ADD COLUMN IF NOT EXISTS stripe_subscription_id TEXT;
  `);

  // Create tenant_states table
  await pool.query(`
    CREATE TABLE IF NOT EXISTS tenant_states (
      id         SERIAL PRIMARY KEY,
      tenant_id  INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      state_code TEXT NOT NULL,
      added_at   TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(tenant_id, state_code)
    );
  `);

  // Migrate tenant_states: add stripe_item_id column
  await pool.query(`
    ALTER TABLE tenant_states ADD COLUMN IF NOT EXISTS stripe_item_id TEXT;
  `);

  // Seed default tenant
  const { rows: tenants } = await pool.query(`SELECT id FROM tenants LIMIT 1`);
  if (tenants.length === 0) {
    await pool.query(`INSERT INTO tenants (name, slug) VALUES ('Default', 'default')`);
    console.log('[DB] Created default tenant.');
  }

  // Seed admin user for tenant 1
  const { rows: users } = await pool.query(`SELECT id FROM users WHERE tenant_id = 1 LIMIT 1`);
  if (users.length === 0) {
    const hash = await bcrypt.hash('admin', 12);
    await pool.query(
      `INSERT INTO users (tenant_id, username, password_hash, role, is_super_admin) VALUES (1, 'admin', $1, 'admin', TRUE)`,
      [hash]
    );
    console.warn('[AUTH] Default admin/admin account created. Change the password immediately.');
  } else {
    // Ensure existing admin user has correct role/super-admin flags
    await pool.query(
      `UPDATE users SET role = 'admin', is_super_admin = TRUE WHERE tenant_id = 1 AND username = 'admin'`
    );
  }

  // Seed default settings for tenant 1
  const defaults = {
    check_interval_hours: '4',
    contractor_name: '',
    email_to: '',
    email_from: '',
    smtp_host: 'smtp.gmail.com',
    smtp_port: '587',
    smtp_user: '',
    smtp_pass: '',
  };
  for (const [key, value] of Object.entries(defaults)) {
    await pool.query(
      `INSERT INTO settings (tenant_id, key, value) VALUES (1, $1, $2) ON CONFLICT DO NOTHING`,
      [key, value]
    );
  }
}

module.exports = { pool, initDb };
