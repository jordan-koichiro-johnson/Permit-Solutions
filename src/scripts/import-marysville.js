/**
 * Import permits from Marysville, WA eTRAKiT portal.
 *
 * Marysville uses a non-standard eTRAKiT setup:
 *   - Login page: /EtrakitError2.aspx (embedded widget with RadTextBox2/txtPassword/btnLogin)
 *   - Search page: /Search/permit.aspx (no /eTRAKiT/ prefix)
 *   - Export:      standard ctl00$cplMain$btnExportToExcel __EVENTTARGET
 *
 * Required env vars: MARYSVILLE_WA_USERNAME, MARYSVILLE_WA_PASSWORD
 * CLI usage: set CONTRACTOR_NAME in .env
 */

require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });

const https   = require('https');
const qs      = require('querystring');
const queries = require('../db/queries');

const HOST        = 'permits.marysvillewa.gov';
const LOGIN_PATH  = '/EtrakitError2.aspx';
const SEARCH_PATH = '/Search/permit.aspx';
const COLUMNS = {
  permitNumber: 'PERMIT_NO',
  status:       'STATUS',
  address:      'SITE_ADDR',
  notes:        'Permit Type',
};

// ── HTTP helpers ───────────────────────────────────────────────────────────────

function makeClient() {
  const cookies = {};

  function updateCookies(h) {
    if (!h) return;
    (Array.isArray(h) ? h : [h]).forEach(hdr => {
      const [pair] = hdr.split(';');
      const idx = pair.indexOf('=');
      if (idx > 0) cookies[pair.slice(0, idx).trim()] = pair.slice(idx + 1).trim();
    });
  }

  function cookieStr() {
    return Object.entries(cookies).map(([k, v]) => `${k}=${v}`).join('; ');
  }

  function req(method, path, body, redirects = 0) {
    return new Promise((resolve, reject) => {
      if (redirects > 10) return reject(new Error('Too many redirects'));
      const bodyStr = body ? qs.stringify(body) : '';
      const hdrs = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Cookie':     cookieStr(),
        'Referer':    `https://${HOST}/`,
      };
      if (bodyStr) {
        hdrs['Content-Type']   = 'application/x-www-form-urlencoded';
        hdrs['Content-Length'] = Buffer.byteLength(bodyStr);
      }
      const r = https.request({ hostname: HOST, path, method, headers: hdrs }, res => {
        updateCookies(res.headers['set-cookie']);
        if ([301, 302, 303].includes(res.statusCode) && res.headers.location) {
          let loc = res.headers.location;
          if (loc.startsWith('http')) { const u = new URL(loc); loc = u.pathname + (u.search || ''); }
          res.resume();
          return resolve(req('GET', loc, null, redirects + 1));
        }
        const chunks = [];
        res.on('data', c => chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c)));
        res.on('end', () => {
          const buf = Buffer.concat(chunks);
          resolve({ status: res.statusCode, finalPath: path, contentType: res.headers['content-type'] || '', text: () => buf.toString('utf8') });
        });
      });
      r.on('error', reject);
      if (bodyStr) r.write(bodyStr);
      r.end();
    });
  }

  return {
    get:  path         => req('GET',  path),
    post: (path, body) => req('POST', path, body),
  };
}

function extractHidden(html) {
  const fields = {};
  const re = /<input[^>]+type=["']hidden["'][^>]*/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    const name  = m[0].match(/name=["']([^"']+)["']/i)?.[1];
    const value = m[0].match(/value=["']([^"']*)/i)?.[1] ?? '';
    if (name) fields[name] = value;
  }
  return fields;
}

function parseCSV(text) {
  const clean = text.replace(/^\uFEFF/, '');
  const lines = clean.split(/\r?\n/).filter(l => l.trim());
  if (lines.length < 2) return [];

  const parseRow = line => {
    const fields = []; let cur = '', inQuote = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        if (inQuote && line[i + 1] === '"') { cur += '"'; i++; }
        else inQuote = !inQuote;
      } else if (ch === ',' && !inQuote) { fields.push(cur.trim()); cur = ''; }
      else { cur += ch; }
    }
    fields.push(cur.trim());
    return fields;
  };

  const headers = parseRow(lines[0]);
  return lines.slice(1).map(line => {
    const vals = parseRow(line);
    const obj  = {};
    headers.forEach((h, i) => { obj[h] = vals[i] ?? ''; });
    return obj;
  }).filter(r => r[COLUMNS.permitNumber]);
}

// ── Main ───────────────────────────────────────────────────────────────────────

async function run(tenantId, log = console.log, searchName) {
  const username = process.env.MARYSVILLE_WA_USERNAME;
  const password = process.env.MARYSVILLE_WA_PASSWORD;
  if (!searchName) throw new Error('contractor_name is required — set it in Settings before importing.');

  if (!username || !password) {
    throw new Error('MARYSVILLE_WA_USERNAME and MARYSVILLE_WA_PASSWORD must be set in .env');
  }

  const { get, post } = makeClient();

  // 1. Login via embedded widget on EtrakitError2.aspx
  log('Logging in to Marysville eTRAKiT...');
  const loginPage = await get(LOGIN_PATH);
  const lf = extractHidden(loginPage.text());
  const loginRes = await post(LOGIN_PATH, {
    ...lf,
    '__EVENTTARGET':             '',
    '__EVENTARGUMENT':           '',
    'ctl00$ucLogin$ddlSelLogin': 'Public',
    'ctl00$ucLogin$RadTextBox2': username,
    'ctl00$ucLogin$txtPassword': password,
    'ctl00$ucLogin$btnLogin':    'Log In',
  });

  if (!/logged in user/i.test(loginRes.text())) {
    throw new Error('Login failed — check MARYSVILLE_WA_USERNAME and MARYSVILLE_WA_PASSWORD in .env');
  }
  log('Login successful.');

  // 2. Search by contractor name
  log(`Searching for contractor: "${searchName}"...`);
  const searchPage = await get(SEARCH_PATH);
  const sf = extractHidden(searchPage.text());
  const searchRes = await post(SEARCH_PATH, {
    ...sf,
    '__EVENTTARGET':                 '',
    '__EVENTARGUMENT':               '',
    'ctl00$cplMain$ddSearchBy':      'Permit_Main.CONTRACTOR_NAME',
    'ctl00$cplMain$ddSearchOper':    'CONTAINS',
    'ctl00$cplMain$txtSearchString': searchName,
    'ctl00$cplMain$btnSearch':       'Search',
  });

  // 3. Export CSV
  log('Exporting CSV...');
  const ef = extractHidden(searchRes.text());
  const exportRes = await post(SEARCH_PATH, {
    ...ef,
    '__EVENTTARGET':   'ctl00$cplMain$btnExportToExcel',
    '__EVENTARGUMENT': '',
  });

  if (!exportRes.contentType.includes('csv') &&
      !exportRes.contentType.includes('excel') &&
      !exportRes.contentType.includes('spreadsheet')) {
    const preview = exportRes.text().slice(0, 400).replace(/\s+/g, ' ');
    throw new Error(`Unexpected export response (${exportRes.contentType}). Preview: ${preview}`);
  }

  const permits = parseCSV(exportRes.text());
  log(`CSV received: ${permits.length} permit(s).`);

  // 4. Import into DB
  const existing = new Set((await queries.getAllPermits(tenantId)).map(p => p.permit_number));
  let added = 0, skipped = 0;

  for (const p of permits) {
    const num = p[COLUMNS.permitNumber];
    if (!num) continue;
    if (existing.has(num)) { skipped++; continue; }

    const created = await queries.createPermit({
      tenant_id:    tenantId,
      permit_number: num,
      address:       p[COLUMNS.address] || null,
      city:          'Marysville, WA',
      scraper_name:  'marysville-wa',
      notes:         p[COLUMNS.notes]   || null,
    });
    if (p[COLUMNS.status]) {
      await queries.updatePermitStatus(created.id, p[COLUMNS.status], tenantId);
    }
    added++;
  }

  log(`Import complete: ${added} new, ${skipped} already in DB.`);
  return { added, skipped, total: permits.length };
}

module.exports = { run };

if (require.main === module) {
  const searchName = process.env.CONTRACTOR_NAME;
  if (!searchName) { console.error('Set CONTRACTOR_NAME in .env'); process.exit(1); }
  run(1, console.log, searchName).catch(err => { console.error('Fatal error:', err.message); process.exit(1); });
}
