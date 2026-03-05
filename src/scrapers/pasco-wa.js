const { createETRAKiTScraper } = require('./etrakit');

// Pasco uses eTRAKiT 3, which has a different base path than the classic version.
// If the portal requires login, set PASCO_WA_USERNAME and PASCO_WA_PASSWORD in .env
// after creating an account at: https://egov-pasco.com/etrakit3/
module.exports = createETRAKiTScraper({
  name:        'pasco-wa',
  displayName: 'Pasco, WA',
  host:        'egov-pasco.com',
  basePath:    '/etrakit3',
  usernameEnv: 'PASCO_WA_USERNAME',
  passwordEnv: 'PASCO_WA_PASSWORD',
});
