const { createETRAKiTScraper } = require('./etrakit');

module.exports = createETRAKiTScraper({
  name:        'everett-wa',
  displayName: 'Everett, WA',
  host:        'onlinepermits.everettwa.gov',
  usernameEnv: 'EVERETT_WA_USERNAME',
  passwordEnv: 'EVERETT_WA_PASSWORD',
});
