const { createETRAKiTScraper } = require('./etrakit');

// If the portal requires login, set LACEY_WA_USERNAME and
// LACEY_WA_PASSWORD in .env after creating an account at:
//   https://trakitweb.ci.lacey.wa.us/eTRAKiT/
module.exports = createETRAKiTScraper({
  name:        'lacey-wa',
  displayName: 'Lacey, WA',
  host:        'trakitweb.ci.lacey.wa.us',
  usernameEnv: 'LACEY_WA_USERNAME',
  passwordEnv: 'LACEY_WA_PASSWORD',
  state:       'WA',
});
