/**
 * Scraper Registry
 *
 * Maps scraper_name keys (stored in the DB) to their class constructors.
 * Add new cities here after creating their scraper files.
 *
 * The key must be:
 *  - lowercase
 *  - URL-safe (no spaces — use hyphens)
 *  - Unique across all scrapers
 */
const scrapers = {
  'example-city':            require('./example-city'),
  'bellingham-wa':           require('./bellingham-wa'),
  'everett-wa':              require('./everett-wa'),
  'shoreline-wa':            require('./shoreline-wa'),
  'walla-walla-county-wa':   require('./walla-walla-county-wa'),
  'pasco-wa':                require('./pasco-wa'),
  'marysville-wa':           require('./marysville-wa'),
  'lacey-wa':                require('./lacey-wa'),
};

/**
 * Get an instantiated scraper by name.
 * @param {string} name
 * @param {object} [config]
 * @returns {BasePermitScraper}
 */
function getScraperInstance(name, config = {}) {
  const ScraperClass = scrapers[name];
  if (!ScraperClass) {
    throw new Error(`Unknown scraper: "${name}". Available: ${Object.keys(scrapers).join(', ')}`);
  }
  return new ScraperClass(config);
}

/**
 * Returns array of { name, displayName } for the UI dropdown.
 */
function listScrapers() {
  return Object.entries(scrapers).map(([name, Cls]) => {
    const instance = new Cls();
    return { name, displayName: instance.displayName };
  });
}

module.exports = { scrapers, getScraperInstance, listScrapers };
