const { createETRAKiTScraper } = require('./etrakit');

// If the portal requires login, set WALLA_WALLA_COUNTY_WA_USERNAME and
// WALLA_WALLA_COUNTY_WA_PASSWORD in .env after creating an account at:
//   https://wala-trk.aspgov.com/eTRAKiT/
module.exports = createETRAKiTScraper({
  name:        'walla-walla-county-wa',
  displayName: 'Walla Walla County, WA',
  host:        'wala-trk.aspgov.com',
  usernameEnv: 'WALLA_WALLA_COUNTY_WA_USERNAME',
  passwordEnv: 'WALLA_WALLA_COUNTY_WA_PASSWORD',
  state:       'WA',
});
