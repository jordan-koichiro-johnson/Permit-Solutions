#!/usr/bin/env node
/**
 * Probe an eTRAKiT city portal and auto-detect CSV column names.
 *
 * Usage:
 *   node src/scripts/probe-etrakit.js \
 *     --host permits.shorelinewa.gov \
 *     --search "CONTRACTOR NAME" \
 *     [--username u] [--password p] [--basepath /etrakit3]
 *
 * Credentials can also come from env vars: PROBE_USERNAME, PROBE_PASSWORD
 */

require('dotenv').config();
const { probeCity } = require('./etrakit');

function parseArgs() {
  const args = process.argv.slice(2);
  const get = flag => { const i = args.indexOf(flag); return i >= 0 ? args[i + 1] : null; };
  return {
    host:     get('--host'),
    username: get('--username') || process.env.PROBE_USERNAME || null,
    password: get('--password') || process.env.PROBE_PASSWORD || null,
    search:   get('--search'),
    basePath: get('--basepath') || '/eTRAKiT',
  };
}

(async () => {
  const { host, username, password, search, basePath } = parseArgs();

  if (!host || !search) {
    console.error(
      'Usage: node src/scripts/probe-etrakit.js' +
      ' --host <hostname> --search "<contractor name>"' +
      ' [--username u] [--password p] [--basepath /eTRAKiT]'
    );
    process.exit(1);
  }

  try {
    await probeCity({ host, username, password, searchName: search, basePath }, console.log);
  } catch (err) {
    console.error('\nProbe failed:', err.message);
    process.exit(1);
  }
})();
