/**
 * Probes the Accela Citizen Access portal for Tacoma.
 * Logs in, inspects search form, and attempts a contractor search.
 * Run: node src/scripts/probe-aca.js
 */
require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });

const https = require('https');
const qs    = require('querystring');
const fs    = require('fs');

const HOST     = 'aca-prod.accela.com';
const AGENCY   = 'TACOMA';
const USERNAME = process.env.TACOMA_WA_ACCELA_USERNAME;
const PASSWORD = process.env.TACOMA_WA_ACCELA_PASSWORD;

const cookies = {};
function updateCookies(h) {
  if (!h) return;
  (Array.isArray(h) ? h : [h]).forEach(hdr => {
    const [pair] = hdr.split(';');
    const idx = pair.indexOf('=');
    if (idx > 0) cookies[pair.slice(0, idx).trim()] = pair.slice(idx + 1).trim();
  });
}
function cookieStr() { return Object.entries(cookies).map(([k,v]) => `${k}=${v}`).join('; '); }

function req(method, path, body, redirects = 0) {
  return new Promise((resolve, reject) => {
    if (redirects > 10) return reject(new Error('Too many redirects'));
    const bodyStr = body ? qs.stringify(body) : '';
    const hdrs = {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      'Cookie':     cookieStr(),
      'Referer':    `https://${HOST}/${AGENCY}/`,
    };
    if (bodyStr) { hdrs['Content-Type'] = 'application/x-www-form-urlencoded'; hdrs['Content-Length'] = Buffer.byteLength(bodyStr); }
    const r = https.request({ hostname: HOST, path, method, headers: hdrs }, res => {
      updateCookies(res.headers['set-cookie']);
      if ([301,302,303].includes(res.statusCode) && res.headers.location) {
        let loc = res.headers.location;
        if (loc.startsWith('http')) { const u = new URL(loc); loc = u.pathname + (u.search||''); }
        res.resume();
        return resolve(req('GET', loc, null, redirects + 1));
      }
      const chunks = [];
      res.on('data', c => chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c)));
      res.on('end', () => { const buf = Buffer.concat(chunks); resolve({ status: res.statusCode, finalPath: path, contentType: res.headers['content-type']||'', text: () => buf.toString('utf8') }); });
    });
    r.on('error', reject);
    if (bodyStr) r.write(bodyStr);
    r.end();
  });
}

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

function dumpInputs(html, label) {
  console.log(`\n=== ${label} ===`);
  const selectRe = /<select[^>]*name=["']([^"']+)["'][^>]*>([\s\S]*?)<\/select>/gi;
  let sm;
  while ((sm = selectRe.exec(html)) !== null) {
    const opts = [...sm[2].matchAll(/<option[^>]*value=["']([^"']*)["'][^>]*>([^<]*)/gi)].map(o => `${o[1]}="${o[2].trim()}"`);
    console.log(`  SELECT [${sm[1]}]: ${opts.slice(0,6).join(' | ')}`);
  }
  const inputRe = /<input[^>]+type=["'](text|password|submit|button|email)["'][^>]*/gi;
  let im;
  while ((im = inputRe.exec(html)) !== null) {
    const name  = im[0].match(/name=["']([^"']+)["']/i)?.[1] || '(no name)';
    const value = im[0].match(/value=["']([^"']+)["']/i)?.[1] || '';
    const type  = im[0].match(/type=["']([^"']+)["']/i)?.[1];
    console.log(`  INPUT[${type}] name=${name}${value ? ' value='+value : ''}`);
  }
}

async function run() {
  // Step 1: get the login page
  console.log('Fetching login page...');
  const loginPage = await req('GET', `/${AGENCY}/Login/Login.aspx`);
  console.log(`Status: ${loginPage.status}, url: ${loginPage.finalPath}`);
  dumpInputs(loginPage.text(), 'Login page');
  fs.writeFileSync('aca-login.html', loginPage.text());

  // Step 2: try logging in
  console.log('\nLogging in...');
  const lf = extractHiddenFields(loginPage.text());
  const loginRes = await req('POST', loginPage.finalPath, {
    ...lf,
    '__EVENTTARGET':   '',
    '__EVENTARGUMENT': '',
    'ctl00$PlaceHolderMain$LoginBox$txtUserName':     USERNAME,
    'ctl00$PlaceHolderMain$LoginBox$txtPassword':     PASSWORD,
    'ctl00$PlaceHolderMain$LoginBox$btnLogin':        'Login',
  });
  console.log(`Login result: ${loginRes.status}, url: ${loginRes.finalPath}`);
  console.log('Logged in:', !loginRes.finalPath.includes('Login'));
  fs.writeFileSync('aca-after-login.html', loginRes.text());

  // Step 3: get permit search page
  console.log('\nFetching permit search page...');
  const searchPage = await req('GET', `/${AGENCY}/Cap/CapHome.aspx?module=Permits&TabName=Home`);
  console.log(`Status: ${searchPage.status}, url: ${searchPage.finalPath}`);
  dumpInputs(searchPage.text(), 'Permit search page');
  fs.writeFileSync('aca-search.html', searchPage.text());
}

run().catch(console.error);
