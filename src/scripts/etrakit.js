/**
 * Shared eTRAKiT portal client.
 *
 * All eTRAKiT cities use the same login flow, search form, and CSV export
 * button. Only the host, credentials, and CSV column names vary per city.
 *
 * Usage:
 *   const { createImporter } = require('./etrakit');
 *   const { run } = createImporter({ host, username, password, searchName,
 *                                    envLabel, columns, city, scraperName });
 *   await run(log);
 *
 * Config shape:
 *   host        — portal hostname, e.g. 'permits.cob.org'
 *   username    — resolved credential string
 *   password    — resolved credential string
 *   searchName  — contractor name to search for
 *   envLabel    — prefix used in error messages, e.g. 'BELLINGHAM_WA'
 *   columns     — maps logical names to actual CSV headers:
 *     permitNumber  e.g. 'Permit #' or 'Permit Number'
 *     status        e.g. 'STATUS' or 'Permit Status'
 *     address       e.g. 'Address' or 'Site Address'
 *     notes         e.g. 'Permit Type' or 'Description'
 *   city        — value stored in DB, e.g. 'Bellingham, WA'
 *   scraperName — value stored in DB, e.g. 'bellingham-wa'
 */

const https   = require('https');
const qs      = require('querystring');
const queries = require('../db/queries');

// ── Pure helpers (no config/cookie dependency) ────────────────────────────────

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

function parseCSV(text, permitNumberCol) {
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
    const obj  = {};
    headers.forEach((h, i) => { obj[h] = vals[i] ?? ''; });
    return obj;
  }).filter(r => r[permitNumberCol]);
}

// ── Factory ───────────────────────────────────────────────────────────────────

function createImporter(config) {
  const { host, username, password, searchName, envLabel, columns, city, scraperName } = config;

  // Each importer gets its own isolated cookie jar
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
        'Referer':    `https://${host}/eTRAKiT/`,
      };
      if (bodyStr) {
        hdrs['Content-Type']   = 'application/x-www-form-urlencoded';
        hdrs['Content-Length'] = Buffer.byteLength(bodyStr);
      }
      const r = https.request({ hostname: host, path, method, headers: hdrs }, res => {
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
          resolve({
            status:      res.statusCode,
            finalPath:   path,
            contentType: res.headers['content-type'] || '',
            text:        () => buf.toString('utf8'),
          });
        });
      });
      r.on('error', reject);
      if (bodyStr) r.write(bodyStr);
      r.end();
    });
  }

  const get  = path         => req('GET',  path);
  const post = (path, body) => req('POST', path, body);

  // ── Login ──────────────────────────────────────────────────────────────────

  async function login(log) {
    if (!username || !password) {
      throw new Error(`${envLabel}_USERNAME and ${envLabel}_PASSWORD must be set in .env`);
    }
    log('Logging in...');
    const redirected = await get('/eTRAKiT/Search/permit.aspx');
    const loginPath  = redirected.finalPath;
    const fields     = extractHiddenFields(redirected.text());

    const res = await post(loginPath, {
      ...fields,
      '__EVENTTARGET':                   '',
      '__EVENTARGUMENT':                 '',
      'ctl00$cplMain$txtPublicUserName': username,
      'ctl00$cplMain$txtPublicPassword': password,
      'ctl00$cplMain$btnPublicLogin':    'Login',
    });

    if (res.finalPath.includes('login.aspx')) {
      throw new Error(`Login failed — check ${envLabel}_USERNAME and ${envLabel}_PASSWORD in .env`);
    }
    log('Login successful.');
  }

  // ── Search + CSV export ────────────────────────────────────────────────────

  async function fetchAllPermitsCSV(log) {
    log(`Searching for contractor: "${searchName}"...`);

    const searchPage = await get('/eTRAKiT/Search/permit.aspx');
    if (searchPage.finalPath.includes('login.aspx')) {
      throw new Error('Session lost before search — login may not have persisted.');
    }
    const sf = extractHiddenFields(searchPage.text());

    const searchRes = await post('/eTRAKiT/Search/permit.aspx', {
      ...sf,
      '__EVENTTARGET':                 '',
      '__EVENTARGUMENT':               '',
      'ctl00$cplMain$ddSearchBy':      'Permit_Main.CONTRACTOR_NAME',
      'ctl00$cplMain$ddSearchOper':    'CONTAINS',
      'ctl00$cplMain$txtSearchString': searchName,
      'ctl00$cplMain$btnSearch':       'Search',
    });

    log('Search complete. Exporting CSV...');

    const ef        = extractHiddenFields(searchRes.text());
    const exportRes = await post('/eTRAKiT/Search/permit.aspx', {
      ...ef,
      '__EVENTTARGET':   'ctl00$cplMain$btnExportToExcel',
      '__EVENTARGUMENT': '',
    });

    if (!exportRes.contentType.includes('csv') &&
        !exportRes.contentType.includes('excel') &&
        !exportRes.contentType.includes('spreadsheet')) {
      const preview = exportRes.text().slice(0, 400).replace(/\s+/g, ' ');
      throw new Error(`Unexpected response type: ${exportRes.contentType}. Body preview: ${preview}`);
    }

    const permits = parseCSV(exportRes.text(), columns.permitNumber);
    log(`CSV received: ${permits.length} permit(s).`);
    return permits;
  }

  // ── Import into DB ─────────────────────────────────────────────────────────

  async function importPermits(permits, log) {
    const existing = new Set(queries.getAllPermits().map(p => p.permit_number));
    let added = 0, skipped = 0;

    for (const p of permits) {
      const num = p[columns.permitNumber];
      if (!num) continue;

      if (existing.has(num)) { skipped++; continue; }

      const created = queries.createPermit({
        permit_number: num,
        address:       p[columns.address] || null,
        city,
        scraper_name:  scraperName,
        notes:         p[columns.notes]   || null,
      });
      if (p[columns.status]) {
        queries.updatePermitStatus(created.id, p[columns.status]);
      }
      added++;
    }

    log(`Import complete: ${added} new, ${skipped} already in DB.`);
    return { added, skipped, total: permits.length };
  }

  // ── Main ───────────────────────────────────────────────────────────────────

  async function run(log = console.log) {
    Object.keys(cookies).forEach(k => delete cookies[k]);
    await login(log);
    const permits = await fetchAllPermitsCSV(log);
    return importPermits(permits, log);
  }

  return { run };
}

module.exports = { createImporter };
