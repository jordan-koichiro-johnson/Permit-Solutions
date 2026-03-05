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
    return { name, displayName: instance.displayName, state: instance.state };
  });
}

/**
 * Derive a 2-letter state code from a scraper name.
 * e.g. 'bellingham-wa' → 'WA', 'walla-walla-county-wa' → 'WA'
 * Returns null for scrapers with no state suffix (e.g. 'example-city').
 */
function stateFromScraper(scraperName) {
  if (!scraperName) return null;
  const parts = scraperName.split('-');
  const last = parts[parts.length - 1];
  if (/^[a-z]{2}$/.test(last) && last !== 'ty') return last.toUpperCase();
  return null;
}

module.exports = { scrapers, getScraperInstance, listScrapers, stateFromScraper };
