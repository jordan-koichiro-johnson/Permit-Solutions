const { createETRAKiTScraper } = require('./etrakit');

// If the portal requires login, set MARYSVILLE_WA_USERNAME and
// MARYSVILLE_WA_PASSWORD in .env after creating an account at:
//   https://permits.marysvillewa.gov/eTRAKiT/
module.exports = createETRAKiTScraper({
  name:        'marysville-wa',
  displayName: 'Marysville, WA',
  host:        'permits.marysvillewa.gov',
  basePath:    '',
  usernameEnv: 'MARYSVILLE_WA_USERNAME',
  passwordEnv: 'MARYSVILLE_WA_PASSWORD',
});
