const { createETRAKiTScraper } = require('./etrakit');

module.exports = createETRAKiTScraper({
  name:        'bellingham-wa',
  displayName: 'Bellingham, WA',
  host:        'permits.cob.org',
  usernameEnv: 'BELLINGHAM_WA_USERNAME',
  passwordEnv: 'BELLINGHAM_WA_PASSWORD',
});
