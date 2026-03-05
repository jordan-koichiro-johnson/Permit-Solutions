require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });

const { createImporter } = require('./etrakit');

const { run } = createImporter({
  host:       'onlinepermits.everettwa.gov',
  username:   process.env.EVERETT_WA_USERNAME,
  password:   process.env.EVERETT_WA_PASSWORD,
  envLabel:   'EVERETT_WA',
  columns: {
    permitNumber: 'Permit Number',
    status:       'Permit Status',
    address:      'Site Address',
    notes:        'Description',
  },
  city:        'Everett, WA',
  scraperName: 'everett-wa',
});

module.exports = { run };

if (require.main === module) {
  const searchName = process.env.CONTRACTOR_NAME;
  if (!searchName) { console.error('Set CONTRACTOR_NAME in .env'); process.exit(1); }
  run(1, console.log, searchName).catch(err => { console.error('Fatal error:', err.message); process.exit(1); });
}
