/**
 * BasePermitScraper
 *
 * All city scrapers must extend this class and implement the three abstract
 * members below.  The checker service calls `checkStatus()` and expects a
 * consistent return shape regardless of city.
 */
class BasePermitScraper {
  /**
   * @param {object} config  Optional config overrides (e.g. custom timeouts)
   */
  constructor(config = {}) {
    this.config = config;
  }

  /**
   * Internal registry key — must be lowercase, hyphenated, unique.
   * Example: 'austin-tx'
   * @returns {string}
   */
  get name() {
    throw new Error(`${this.constructor.name} must implement get name()`);
  }

  /**
   * Human-readable city name shown in the UI.
   * Example: 'Austin, TX'
   * @returns {string}
   */
  get displayName() {
    throw new Error(`${this.constructor.name} must implement get displayName()`);
  }

  /**
   * Two-letter US state code this scraper belongs to (e.g. 'WA', 'OR').
   * Return null for demo/example scrapers that are always accessible.
   * @returns {string|null}
   */
  get state() {
    return null;
  }

  /**
   * Fetch the current status of a single permit.
   *
   * @param {string} permitNumber  The permit number as entered by the user
   * @returns {Promise<{
   *   status: string,       // Normalized status string, e.g. 'Approved', 'Pending Review'
   *   details: object,      // Any extra fields scraped (applicant, type, issued, expires …)
   *   url: string           // The canonical URL that was checked
   * }>}
   */
  async checkStatus(permitNumber) {
    throw new Error(`${this.constructor.name} must implement checkStatus()`);
  }
}

module.exports = BasePermitScraper;
