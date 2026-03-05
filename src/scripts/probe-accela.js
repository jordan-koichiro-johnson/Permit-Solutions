/**
 * Tests multiple auth parameter combinations for Accela.
 * Run: node src/scripts/probe-accela.js
 */
require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });

const https = require('https');
const qs    = require('querystring');

const APP_ID     = process.env.ACCELA_APP_ID;
const APP_SECRET = process.env.ACCELA_APP_SECRET;
const AGENCY     = process.env.TACOMA_WA_ACCELA_AGENCY;
const USERNAME   = process.env.TACOMA_WA_ACCELA_USERNAME;
const PASSWORD   = process.env.TACOMA_WA_ACCELA_PASSWORD;

function authPost(body) {
  return new Promise((resolve, reject) => {
    const bodyStr = qs.stringify(body);
    const hdrs = {
      'Content-Type':   'application/x-www-form-urlencoded',
      'Content-Length': Buffer.byteLength(bodyStr),
      'x-accela-appid': APP_ID,
    };
    const r = https.request({ hostname: 'auth.accela.com', path: '/oauth2/token', method: 'POST', headers: hdrs }, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(Buffer.concat(chunks).toString()) }); }
        catch (e) { resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString() }); }
      });
    });
    r.on('error', reject);
    r.write(bodyStr);
    r.end();
  });
}

async function tryAuth(label, body) {
  const res = await authPost(body);
  const ok = !!res.body.access_token;
  console.log(`[${ok ? 'OK' : 'FAIL'}] ${label} → ${res.status} ${JSON.stringify(res.body).slice(0, 120)}`);
  return ok ? res.body : null;
}

async function run() {
  const base = { grant_type: 'password', client_id: APP_ID, client_secret: APP_SECRET, username: USERNAME, password: PASSWORD };

  // Try different scope and environment combinations
  await tryAuth('scope=records env=PROD',               { ...base, scope: 'records',                    agency_name: AGENCY, environment: 'PROD' });
  await tryAuth('scope=get_records env=PROD',           { ...base, scope: 'get_records',                agency_name: AGENCY, environment: 'PROD' });
  await tryAuth('scope=records professionals env=PROD', { ...base, scope: 'records professionals',      agency_name: AGENCY, environment: 'PROD' });
  await tryAuth('no scope env=PROD',                    { ...base,                                       agency_name: AGENCY, environment: 'PROD' });
  await tryAuth('scope=records env=TRAKIT',             { ...base, scope: 'records',                    agency_name: AGENCY, environment: 'TRAKIT' });
  await tryAuth('scope=records env=TACOMA',             { ...base, scope: 'records',                    agency_name: AGENCY, environment: AGENCY });
  await tryAuth('no agency_name',                       { ...base, scope: 'records',                                         environment: 'PROD' });
  await tryAuth('agency lowercase env=PROD',            { ...base, scope: 'records', agency_name: AGENCY.toLowerCase(), environment: 'PROD' });
}

run().catch(console.error);
