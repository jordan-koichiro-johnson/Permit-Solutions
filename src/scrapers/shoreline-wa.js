const { createETRAKiTScraper } = require('./etrakit');

// Shoreline's permit search is publicly accessible — no credentials needed.
module.exports = createETRAKiTScraper({
  name:        'shoreline-wa',
  displayName: 'Shoreline, WA',
  host:        'permits.shorelinewa.gov',
  state:       'WA',
});
