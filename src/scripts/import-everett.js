require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });

const { createImporter } = require('./etrakit');

const { run } = createImporter({
  host:       'onlinepermits.everettwa.gov',
  username:   process.env.EVERETT_WA_USERNAME,
  password:   process.env.EVERETT_WA_PASSWORD,
  searchName: 'FAST WATER HEATER',
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
  run().catch(err => { console.error('Fatal error:', err.message); process.exit(1); });
}
