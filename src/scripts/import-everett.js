/**
 * import-everett.js
 *
 * Bulk imports ALL permits for your contractor from the Everett WA
 * eTRAKiT portal using raw HTTP — no browser, no pagination.
 *
 * Flow:
 *   1. Login via public portal credentials
 *   2. Search by contractor name
 *   3. Click "Export to Excel" — portal returns a CSV of ALL results
 *   4. Parse CSV and import into DB
 *
 * Run directly:  node src/scripts/import-everett.js
 * Or as module:  require('./import-everett').run()
 */

require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });

const https   = require('https');
const qs      = require('querystring');
const queries = require('../db/queries');

const HOST        = 'onlinepermits.everettwa.gov';
const USERNAME    = process.env.EVERETT_WA_USERNAME;
const PASSWORD    = process.env.EVERETT_WA_PASSWORD;
const SEARCH_NAME = 'FAST WATER HEATER';

// ── Cookie jar ────────────────────────────────────────────────────────────────

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

// ── HTTP helper ───────────────────────────────────────────────────────────────

function req(method, path, body, redirects = 0) {
  return new Promise((resolve, reject) => {
    if (redirects > 10) return reject(new Error('Too many redirects'));
    const bodyStr = body ? qs.stringify(body) : '';
    const hdrs = {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      'Cookie':     cookieStr(),
      'Referer':    `https://${HOST}/eTRAKiT/`,
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
      res.on('end', () => resolve({
        status:      res.statusCode,
        finalPath:   path,
        contentType: res.headers['content-type'] || '',
        body:        Buffer.concat(chunks),
        text:        () => Buffer.concat(chunks).toString('utf8'),
      }));
    });
    r.on('error', reject);
    if (bodyStr) r.write(bodyStr);
    r.end();
  });
}

const get  = path         => req('GET',  path);
const post = (path, body) => req('POST', path, body);

// ── Helpers ───────────────────────────────────────────────────────────────────

function extractHiddenFields(html) {
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

// Parse a simple CSV with quoted fields
function parseCSV(text) {
  // Strip BOM if present
  const clean = text.replace(/^\uFEFF/, '');
  const lines = clean.split(/\r?\n/).filter(l => l.trim());
  if (lines.length < 2) return [];

  const parseRow = line => {
    const fields = [];
    let cur = '', inQuote = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        if (inQuote && line[i + 1] === '"') { cur += '"'; i++; }
        else inQuote = !inQuote;
      } else if (ch === ',' && !inQuote) {
        fields.push(cur.trim());
        cur = '';
      } else {
        cur += ch;
      }
    }
    fields.push(cur.trim());
    return fields;
  };

  const headers = parseRow(lines[0]);
  return lines.slice(1).map(line => {
    const vals = parseRow(line);
    const obj = {};
    headers.forEach((h, i) => { obj[h] = vals[i] ?? ''; });
    return obj;
  }).filter(r => r['Permit Number']);
}

// ── Login ─────────────────────────────────────────────────────────────────────

async function login(log) {
  if (!USERNAME || !PASSWORD) {
    throw new Error('EVERETT_WA_USERNAME and EVERETT_WA_PASSWORD must be set in .env');
  }
  log('Logging in...');
  const loginPage = await get('/eTRAKiT/dashboard.aspx');
  const fields    = extractHiddenFields(loginPage.text());

  const res = await post(loginPage.finalPath, {
    ...fields,
    '__EVENTTARGET':                       'ctl00$cplMain$lnkBtnPublicLogin',
    '__EVENTARGUMENT':                     '',
    'ctl00$cplMain$txtPublicUserId':       USERNAME,
    'ctl00$cplMain$txtPublicUserPassword': PASSWORD,
  });

  if (!res.text().includes('lnkBtnLogout') && !res.text().includes('Log Out')) {
    throw new Error('Login failed — check EVERETT_WA_USERNAME and EVERETT_WA_PASSWORD in .env');
  }
  log('Login successful.');
}

// ── Search + CSV export ───────────────────────────────────────────────────────

async function fetchAllPermitsCSV(log) {
  log(`Searching for contractor: "${SEARCH_NAME}"...`);

  // GET search page
  const searchPage = await get('/eTRAKiT/Search/permit.aspx');
  const sf         = extractHiddenFields(searchPage.text());

  // POST search
  const searchRes  = await post('/eTRAKiT/Search/permit.aspx', {
    ...sf,
    '__EVENTTARGET':                 '',
    '__EVENTARGUMENT':               '',
    'ctl00$cplMain$ddSearchBy':      'Permit_Main.CONTRACTOR_NAME',
    'ctl00$cplMain$ddSearchOper':    'CONTAINS',
    'ctl00$cplMain$txtSearchString': SEARCH_NAME,
    'ctl00$cplMain$btnSearch':       'Search',
  });

  log('Search complete. Exporting CSV...');

  // POST export — returns CSV of ALL results with no pagination limit
  const ef         = extractHiddenFields(searchRes.text());
  const exportRes  = await post('/eTRAKiT/Search/permit.aspx', {
    ...ef,
    '__EVENTTARGET':   '',
    '__EVENTARGUMENT': '',
    'ctl00$cplMain$btnExportToExcel': 'Export To Excel',
  });

  if (!exportRes.contentType.includes('csv') && !exportRes.contentType.includes('excel') && !exportRes.contentType.includes('spreadsheet')) {
    throw new Error(`Unexpected response type: ${exportRes.contentType}. Export may have failed.`);
  }

  const permits = parseCSV(exportRes.text());
  log(`CSV received: ${permits.length} permit(s).`);
  return permits;
}

// ── Import into DB ────────────────────────────────────────────────────────────

async function importPermits(permits, log) {
  const existing = new Set(queries.getAllPermits().map(p => p.permit_number));
  let added = 0, skipped = 0;

  for (const p of permits) {
    const num = p['Permit Number'];
    if (!num) continue;

    if (existing.has(num)) { skipped++; continue; }

    const created = queries.createPermit({
      permit_number: num,
      address:       p['Site Address'] || null,
      city:          'Everett, WA',
      scraper_name:  'everett-wa',
      notes:         p['Description'] || null,
    });
    if (p['Permit Status']) {
      queries.updatePermitStatus(created.id, p['Permit Status']);
    }
    added++;
  }

  log(`Import complete: ${added} new, ${skipped} already in DB.`);
  return { added, skipped, total: permits.length };
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function run(log = console.log) {
  Object.keys(cookies).forEach(k => delete cookies[k]);
  await login(log);
  const permits = await fetchAllPermitsCSV(log);
  return await importPermits(permits, log);
}

module.exports = { run };

if (require.main === module) {
  run().catch(err => { console.error('Fatal error:', err.message); process.exit(1); });
}
