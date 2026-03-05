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
  const { host, username, password, envLabel, columns, city, scraperName } = config;

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

  async function fetchAllPermitsCSV(searchName, log) {
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

  async function importPermits(permits, tenantId, log) {
    const existing = new Set((await queries.getAllPermits(tenantId)).map(p => p.permit_number));
    let added = 0, skipped = 0;

    for (const p of permits) {
      const num = p[columns.permitNumber];
      if (!num) continue;

      if (existing.has(num)) { skipped++; continue; }

      const created = await queries.createPermit({
        tenant_id:    tenantId,
        permit_number: num,
        address:       p[columns.address] || null,
        city,
        scraper_name:  scraperName,
        notes:         p[columns.notes]   || null,
      });
      if (p[columns.status]) {
        await queries.updatePermitStatus(created.id, p[columns.status], tenantId);
      }
      added++;
    }

    log(`Import complete: ${added} new, ${skipped} already in DB.`);
    return { added, skipped, total: permits.length };
  }

  // ── Main ───────────────────────────────────────────────────────────────────

  async function run(tenantId, log = console.log, searchName) {
    if (!searchName) throw new Error('contractor_name is required — set it in Settings before importing.');
    Object.keys(cookies).forEach(k => delete cookies[k]);
    await login(log);
    const permits = await fetchAllPermitsCSV(searchName, log);
    return importPermits(permits, tenantId, log);
  }

  return { run };
}

// ── Column auto-detection ──────────────────────────────────────────────────────

/**
 * Apply heuristics to a CSV header row to guess logical column names.
 * Returns { permitNumber, status, address, notes } — null for any not found.
 */
function detectColumns(headers) {
  const lc = headers.map(h => h.toLowerCase());
  const find = test => headers[lc.findIndex(test)] ?? null;

  return {
    permitNumber: find(h => /permit/.test(h) && /(no\b|num|#|number)/.test(h)),
    status:       find(h => /status/.test(h)),
    address:      find(h => /address|addr/.test(h)),
    notes:        find(h => /description|permit\s*type|\btype\b/.test(h)),
  };
}

// ── Probe factory ──────────────────────────────────────────────────────────────

/**
 * Connect to an eTRAKiT city portal, run a contractor search, export CSV,
 * and auto-detect column names from the header row.
 *
 * Prints raw headers and the detected mapping so you can verify before
 * configuring a new city importer.
 *
 * @param {object} opts
 * @param {string}  opts.host        — portal hostname, e.g. 'permits.shorelinewa.gov'
 * @param {string}  [opts.username]  — portal username (if login required)
 * @param {string}  [opts.password]  — portal password (if login required)
 * @param {string}  opts.searchName  — contractor name to search for
 * @param {string}  [opts.basePath]  — URL prefix (default '/eTRAKiT')
 * @param {Function} [log]           — logging function (default console.log)
 * @returns {{ headers: string[], mapping: object }}
 */
async function probeCity({ host, username, password, searchName, basePath = '/eTRAKiT' }, log = console.log) {
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
        'Referer':    `https://${host}${basePath}/`,
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
          resolve({ status: res.statusCode, finalPath: path, contentType: res.headers['content-type'] || '', text: () => buf.toString('utf8') });
        });
      });
      r.on('error', reject);
      if (bodyStr) r.write(bodyStr);
      r.end();
    });
  }

  const get  = path         => req('GET',  path);
  const post = (path, body) => req('POST', path, body);
  const searchPath = `${basePath}/Search/permit.aspx`;

  // Detect which login form fields a page uses and return a ready-to-POST credentials object.
  // Handles both the standard eTRAKiT public login and the Marysville-style embedded widget.
  function buildLoginFields(html, user, pass) {
    if (html.includes('txtPublicUserName')) {
      return {
        '__EVENTTARGET':                   '',
        '__EVENTARGUMENT':                 '',
        'ctl00$cplMain$txtPublicUserName': user,
        'ctl00$cplMain$txtPublicPassword': pass,
        'ctl00$cplMain$btnPublicLogin':    'Login',
      };
    }
    // Marysville-style: RadTextBox2 username, ucLogin$txtPassword, btnLogin
    return {
      '__EVENTTARGET':             '',
      '__EVENTARGUMENT':           '',
      'ctl00$ucLogin$ddlSelLogin': 'Public',
      'ctl00$ucLogin$RadTextBox2': user,
      'ctl00$ucLogin$txtPassword': pass,
      'ctl00$ucLogin$btnLogin':    'Log In',
    };
  }

  // Returns true if the response indicates the user is now logged in.
  function isLoggedIn(html) {
    return /logged in user/i.test(html) || !/txtPublicUserName|RadTextBox2/i.test(html);
  }

  // 1. GET search page; login if redirected or if credentials supplied for gated CSV export
  log(`Connecting to https://${host}${searchPath} ...`);
  let page = await get(searchPath);

  if (page.finalPath.toLowerCase().includes('login') || /EtrakitError/i.test(page.finalPath)) {
    if (!username || !password) {
      throw new Error('Portal requires login but no credentials provided (use --username / --password).');
    }
    log(`Login required (${page.finalPath}). Authenticating...`);
    const fields = extractHiddenFields(page.text());
    const loginRes = await post(page.finalPath, { ...fields, ...buildLoginFields(page.text(), username, password) });
    if (!isLoggedIn(loginRes.text())) {
      throw new Error('Login failed — check your credentials.');
    }
    log('Login successful.');
    page = await get(searchPath);
  } else if (username && password) {
    // Public search page but credentials supplied — portal may gate CSV export behind auth.
    log('Public portal with credentials — attempting login via embedded widget...');
    const fields = extractHiddenFields(page.text());
    const loginRes = await post(page.finalPath, { ...fields, ...buildLoginFields(page.text(), username, password) });
    if (!isLoggedIn(loginRes.text())) {
      throw new Error('Login failed — check your credentials.');
    }
    log('Login successful.');
    page = await get(searchPath);
  } else {
    log('Public portal (no login required).');
  }

  // Some portals use a non-standard base path. If the primary search path doesn't have the
  // search form, fall back to the root-relative /Search/permit.aspx.
  let activeSearchPath = searchPath;
  if (!/ddSearchBy/i.test(page.text()) && basePath !== '') {
    log(`Search form not found at ${searchPath} — trying /Search/permit.aspx ...`);
    const altPage = await get('/Search/permit.aspx');
    if (/ddSearchBy/i.test(altPage.text())) {
      activeSearchPath = '/Search/permit.aspx';
      page = altPage;
      log('Found search form at /Search/permit.aspx');
    } else {
      throw new Error('Could not find permit search form. Portal may require Playwright-based scraping.');
    }
  }

  // 2. Search by contractor name
  log(`Searching for: "${searchName}" ...`);
  const sf = extractHiddenFields(page.text());
  const searchRes = await post(activeSearchPath, {
    ...sf,
    '__EVENTTARGET':                 '',
    '__EVENTARGUMENT':               '',
    'ctl00$cplMain$ddSearchBy':      'Permit_Main.CONTRACTOR_NAME',
    'ctl00$cplMain$ddSearchOper':    'CONTAINS',
    'ctl00$cplMain$txtSearchString': searchName,
    'ctl00$cplMain$btnSearch':       'Search',
  });

  // 3. Export CSV
  // Diagnose: check what the search result page contains
  const searchHtml = searchRes.text();
  const exportBtnMatch = searchHtml.match(/id=["']([^"']*(?:export|excel|ExportTo)[^"']*)["']/i);
  const rowCountMatch  = searchHtml.match(/(\d+)\s*record[s]?\s*found/i) ||
                         searchHtml.match(/showing\s*\d+\s*[-–]\s*\d+\s*of\s*(\d+)/i);
  log(`Search results: ${rowCountMatch ? rowCountMatch[1] + ' records' : 'count unknown'}`);
  log(`Export button ID found: ${exportBtnMatch ? exportBtnMatch[1] : '(none — may have no results or different ID)'}`);

  // Derive the __EVENTTARGET from the actual button ID if found, otherwise use default.
  // HTML id uses _ separators (e.g. cplMain_btnExportToExcel); __EVENTTARGET uses $ and needs ctl00$ prefix.
  const exportTarget = exportBtnMatch
    ? (() => { const id = exportBtnMatch[1].replace(/_/g, '$'); return id.startsWith('ctl00$') ? id : `ctl00$${id}`; })()
    : 'ctl00$cplMain$btnExportToExcel';

  log(`Exporting CSV (target: ${exportTarget})...`);
  const ef = extractHiddenFields(searchHtml);
  const exportRes = await post(activeSearchPath, {
    ...ef,
    '__EVENTTARGET':   exportTarget,
    '__EVENTARGUMENT': '',
  });

  const isCSV = exportRes.contentType.includes('csv') ||
                exportRes.contentType.includes('excel') ||
                exportRes.contentType.includes('spreadsheet');

  if (!isCSV) {
    const preview = exportRes.text().slice(0, 300).replace(/\s+/g, ' ');
    throw new Error(`Export did not return CSV (got: ${exportRes.contentType}). Body preview: ${preview}`);
  }

  // 4. Parse header row
  const rawText  = exportRes.text().replace(/^\uFEFF/, '');
  const firstLine = rawText.split(/\r?\n/)[0] || '';

  const parseRow = line => {
    const fields = []; let cur = '', inQuote = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        if (inQuote && line[i + 1] === '"') { cur += '"'; i++; }
        else inQuote = !inQuote;
      } else if (ch === ',' && !inQuote) {
        fields.push(cur.trim()); cur = '';
      } else { cur += ch; }
    }
    fields.push(cur.trim());
    return fields;
  };

  const headers = parseRow(firstLine);
  const mapping = detectColumns(headers);

  // 5. Report
  log('\n--- Raw CSV headers ---');
  headers.forEach((h, i) => log(`  [${i}] ${h}`));

  log('\n--- Detected column mapping ---');
  for (const [field, col] of Object.entries(mapping)) {
    log(`  ${field.padEnd(14)}: ${col !== null ? `"${col}"` : '(not detected)'}`);
  }

  const missing = Object.entries(mapping).filter(([, v]) => v === null).map(([k]) => k);
  if (missing.length) {
    log(`\nWARNING: Could not auto-detect: ${missing.join(', ')}`);
    log('You will need to set these manually in the city config.');
  } else {
    log('\nAll columns detected. Use this in your city config:');
    log('  columns: ' + JSON.stringify(mapping));
  }

  return { headers, mapping };
}

module.exports = { createImporter, probeCity };
