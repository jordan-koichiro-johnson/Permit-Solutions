/**
 * eTRAKiT Scraper Factory
 *
 * All WA eTRAKiT cities share the same ASP.NET portal software (CentralSquare).
 * This factory creates a scraper class for any eTRAKiT city from a config object.
 *
 * Usage:
 *   const { createETRAKiTScraper } = require('./etrakit');
 *   module.exports = createETRAKiTScraper({
 *     name:        'shoreline-wa',
 *     displayName: 'Shoreline, WA',
 *     host:        'permits.shorelinewa.gov',
 *   });
 *
 * Config options:
 *   name         — registry key (lowercase, hyphenated)
 *   displayName  — shown in the UI dropdown
 *   host         — portal hostname, e.g. 'permits.shorelinewa.gov'
 *   basePath     — URL prefix (default '/eTRAKiT'; Pasco uses '/etrakit3')
 *   usernameEnv  — env var name for username (cities that require login)
 *   passwordEnv  — env var name for password (cities that require login)
 *
 * How it works:
 *   1. GET /Search/permit.aspx — if redirected to login, authenticate with env vars
 *   2. POST search by permit number using Permit_Main.PERMIT_NO field
 *   3. Try to export results as CSV (clean to parse)
 *   4. Fall back to parsing the RadGrid HTML directly
 */

const https  = require('https');
const qs     = require('querystring');
const BasePermitScraper = require('./base');

// ── Pure helpers ──────────────────────────────────────────────────────────────

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

function parseCSV(text) {
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
        fields.push(cur.trim()); cur = '';
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
  });
}

// Find status from the first CSV row, trying several common column name variants.
function extractStatusFromCSV(rows) {
  if (!rows.length) return null;
  const row = rows[0];
  const status =
    row['Permit Status'] ||
    row['STATUS']        ||
    row['Status']        ||
    row['PERMIT STATUS'] ||
    null;
  const address =
    row['Site Address'] ||
    row['Address']      ||
    row['SITE ADDRESS'] ||
    null;
  const permitType =
    row['Description']  ||
    row['Permit Type']  ||
    row['PERMIT TYPE']  ||
    row['Type']         ||
    null;
  return { status, address, permitType };
}

// Parse status out of the eTRAKiT RadGrid search-results HTML.
// Returns the status string, or null if it can't be determined.
function parseStatusFromHTML(html) {
  // Find the results grid table
  const tableRe = /id="ctl00_cplMain_rgSearchRslts[^"]*"([\s\S]*?)<\/table>/i;
  const tableM  = tableRe.exec(html);
  if (!tableM) return null;
  const tableHTML = tableM[1];

  // Extract header names
  const theadM = /<thead>([\s\S]*?)<\/thead>/i.exec(tableHTML);
  const headers = [];
  if (theadM) {
    const thRe = /<th[^>]*>([\s\S]*?)<\/th>/gi;
    let m;
    while ((m = thRe.exec(theadM[1])) !== null) {
      headers.push(m[1].replace(/<[^>]+>/g, '').trim());
    }
  }

  // Find status column index
  const statusIdx = headers.findIndex(h => /status/i.test(h));

  // Extract first data row
  const tbodyM = /<tbody>([\s\S]*?)<\/tbody>/i.exec(tableHTML);
  if (!tbodyM) return null;

  const rowRe = /<tr[^>]*class="rg(?:Row|AltRow)[^"]*"[^>]*>([\s\S]*?)<\/tr>/i;
  const rowM  = rowRe.exec(tbodyM[1]);
  if (!rowM) return null;

  const cells = [];
  const tdRe = /<td[^>]*>([\s\S]*?)<\/td>/gi;
  let tdM;
  while ((tdM = tdRe.exec(rowM[1])) !== null) {
    cells.push(tdM[1].replace(/<[^>]+>/g, '').trim());
  }

  if (statusIdx >= 0 && cells[statusIdx]) return cells[statusIdx];

  // Fallback: find first cell that looks like a known status value
  const known = /^(issued|approved|pending|expired|void|voided|final|finaled|denied|in review|under review|applied|complete|completed|active|cancelled|closed|withdrawn|incomplete)/i;
  return cells.find(c => known.test(c)) || null;
}

// ── Factory ───────────────────────────────────────────────────────────────────

function createETRAKiTScraper({
  name,
  displayName,
  host,
  basePath    = '/eTRAKiT',
  usernameEnv = null,
  passwordEnv = null,
  state       = null,
}) {
  class ETRAKiTScraper extends BasePermitScraper {
    get name()        { return name; }
    get displayName() { return displayName; }
    get state()       { return state; }

    async checkStatus(permitNumber) {
      // Per-request isolated cookie jar
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

      function httpReq(method, path, body, redirects = 0) {
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
              if (loc.startsWith('http')) {
                const u = new URL(loc);
                loc = u.pathname + (u.search || '');
              }
              res.resume();
              return resolve(httpReq('GET', loc, null, redirects + 1));
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

      const get  = path       => httpReq('GET',  path);
      const post = (path, b)  => httpReq('POST', path, b);

      const searchPath = `${basePath}/Search/permit.aspx`;
      const portalUrl  = `https://${host}${searchPath}`;

      // 1. GET search page
      let page = await get(searchPath);

      // 2. Login if the city requires authentication.
      // Detect login page by "login" in path OR the Marysville-style EtrakitError page.
      const isLoginPage = p => /login|EtrakitError/i.test(p.finalPath);

      if (isLoginPage(page)) {
        const username = usernameEnv ? process.env[usernameEnv] : null;
        const password = passwordEnv ? process.env[passwordEnv] : null;

        if (!username || !password) {
          throw new Error(
            `${displayName} requires a login to search permits. ` +
            `Set ${usernameEnv} and ${passwordEnv} in your .env file.`
          );
        }

        // Auto-detect login form style: standard eTRAKiT vs Marysville embedded widget.
        const loginHtml   = page.text();
        const loginFields = extractHiddenFields(loginHtml);
        const credentials = loginHtml.includes('txtPublicUserName')
          ? {
              '__EVENTTARGET':                   '',
              '__EVENTARGUMENT':                 '',
              'ctl00$cplMain$txtPublicUserName': username,
              'ctl00$cplMain$txtPublicPassword': password,
              'ctl00$cplMain$btnPublicLogin':    'Login',
            }
          : {
              '__EVENTTARGET':             '',
              '__EVENTARGUMENT':           '',
              'ctl00$ucLogin$ddlSelLogin': 'Public',
              'ctl00$ucLogin$RadTextBox2': username,
              'ctl00$ucLogin$txtPassword': password,
              'ctl00$ucLogin$btnLogin':    'Log In',
            };

        const loginRes = await post(page.finalPath, { ...loginFields, ...credentials });

        if (isLoginPage(loginRes) && !/logged in user/i.test(loginRes.text())) {
          throw new Error(
            `${displayName}: login failed — check ${usernameEnv} and ${passwordEnv} in .env`
          );
        }

        page = await get(searchPath);
      }

      // 3. POST search by permit number
      const sf = extractHiddenFields(page.text());
      const searchRes = await post(searchPath, {
        ...sf,
        '__EVENTTARGET':                 '',
        '__EVENTARGUMENT':               '',
        'ctl00$cplMain$ddSearchBy':      'Permit_Main.PERMIT_NO',
        'ctl00$cplMain$ddSearchOper':    'EQUALS',
        'ctl00$cplMain$txtSearchString': permitNumber,
        'ctl00$cplMain$btnSearch':       'Search',
      });

      // 4. Try CSV export (cleaner to parse than HTML)
      const ef = extractHiddenFields(searchRes.text());
      const csvRes = await post(searchPath, {
        ...ef,
        '__EVENTTARGET':   'ctl00$cplMain$btnExportToExcel',
        '__EVENTARGUMENT': '',
      });

      const isCSV = csvRes.contentType.includes('csv') ||
                    csvRes.contentType.includes('excel') ||
                    csvRes.contentType.includes('spreadsheet');

      if (isCSV) {
        const rows   = parseCSV(csvRes.text());
        const parsed = extractStatusFromCSV(rows);
        if (parsed?.status) {
          return {
            status:  parsed.status,
            details: {
              address:     parsed.address     || null,
              permit_type: parsed.permitType  || null,
              fetched_at:  new Date().toISOString(),
            },
            url: portalUrl,
          };
        }
      }

      // 5. Fallback: parse status from RadGrid HTML
      const status = parseStatusFromHTML(searchRes.text());
      return {
        status:  status || 'Unknown',
        details: { fetched_at: new Date().toISOString() },
        url:     portalUrl,
      };
    }
  }

  return ETRAKiTScraper;
}

module.exports = { createETRAKiTScraper };
