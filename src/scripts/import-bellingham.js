require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });

const { createImporter } = require('./etrakit');

const { run } = createImporter({
  host:       'permits.cob.org',
  username:   process.env.BELLINGHAM_WA_USERNAME,
  password:   process.env.BELLINGHAM_WA_PASSWORD,
  envLabel:   'BELLINGHAM_WA',
  columns: {
    permitNumber: 'Permit #',
    status:       'STATUS',
    address:      'Address',
    notes:        'Permit Type',
  },
  city:        'Bellingham, WA',
  scraperName: 'bellingham-wa',
});

module.exports = { run };

if (require.main === module) {
  const searchName = process.env.CONTRACTOR_NAME;
  if (!searchName) { console.error('Set CONTRACTOR_NAME in .env'); process.exit(1); }
  run(1, console.log, searchName).catch(err => { console.error('Fatal error:', err.message); process.exit(1); });
}
