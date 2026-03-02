/**
 * ExampleCityScraper — Template / Demo Scraper
 *
 * ──────────────────────────────────────────────────────────────────────────
 * HOW TO CREATE A NEW CITY SCRAPER
 * ──────────────────────────────────────────────────────────────────────────
 * 1. Copy this file to `src/scrapers/<city-key>.js`
 *    e.g. `src/scrapers/austin-tx.js`
 *
 * 2. Change the class name and the two getters:
 *      get name()        → the registry key  (e.g. 'austin-tx')
 *      get displayName() → shown in the UI   (e.g. 'Austin, TX')
 *
 * 3. Replace the body of `checkStatus()` with real Playwright automation.
 *    Tips for adapting to a real portal:
 *
 *    a) Open the city permit portal in a normal browser.
 *    b) Use DevTools → Network to find the search/result XHR/fetch calls.
 *       If the portal exposes a JSON API, call it directly with node-fetch
 *       instead of launching a browser — much faster & more reliable.
 *    c) If the portal is a classic form, use Playwright:
 *         await page.goto(PORTAL_URL);
 *         await page.fill('#permit-number-input', permitNumber);
 *         await page.click('#search-button');
 *         await page.waitForSelector('.result-row', { timeout: 15000 });
 *    d) Normalise the status string to one of:
 *         'Approved' | 'Pending' | 'Under Review' | 'Denied' | 'Expired' | 'Issued' | 'Unknown'
 *       (or any string — the UI just colour-codes based on these keywords)
 *
 * 4. Register the scraper in `src/scrapers/index.js`:
 *      'austin-tx': require('./austin-tx'),
 *
 * 5. Done — the new city will appear in the UI dropdown automatically.
 * ──────────────────────────────────────────────────────────────────────────
 */

const { chromium } = require('playwright');
const BasePermitScraper = require('./base');

class ExampleCityScraper extends BasePermitScraper {
  get name() {
    return 'example-city';
  }

  get displayName() {
    return 'Example City (Demo)';
  }

  /**
   * This implementation does NOT launch a real browser — it returns
   * deterministic fake data so you can test the full pipeline without
   * needing a live city portal.
   *
   * The status cycles through a predefined list based on the permit number
   * so you can simulate status changes by checking the same permit twice
   * with different stored statuses.
   */
  async checkStatus(permitNumber) {
    // ── DEMO MODE ────────────────────────────────────────────────────────
    // Replace everything below this comment with real Playwright scraping.
    // ────────────────────────────────────────────────────────────────────

    const DEMO_URL = `https://example-city.gov/permits/search?q=${encodeURIComponent(permitNumber)}`;

    // Simulate network delay
    await new Promise(resolve => setTimeout(resolve, 200));

    // Cycle through statuses to make testing easy
    const statuses = ['Pending', 'Under Review', 'Approved', 'Issued'];
    const hash = permitNumber.split('').reduce((acc, c) => acc + c.charCodeAt(0), 0);
    const status = statuses[hash % statuses.length];

    return {
      status,
      details: {
        applicant: 'John Demo Doe',
        permit_type: 'Building Permit',
        issued: null,
        expires: null,
        description: `Demo permit for ${permitNumber}`,
        fetched_at: new Date().toISOString(),
      },
      url: DEMO_URL,
    };

    // ── REAL PLAYWRIGHT EXAMPLE (commented out) ───────────────────────────
    /*
    const PORTAL_URL = 'https://permits.example-city.gov/search';

    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage();
      await page.goto(PORTAL_URL, { waitUntil: 'networkidle', timeout: 30000 });

      // Fill in the search form
      await page.fill('[data-testid="permit-number"]', permitNumber);
      await page.click('[data-testid="search-btn"]');

      // Wait for results
      await page.waitForSelector('.permit-result', { timeout: 15000 });

      // Extract data
      const result = await page.evaluate(() => {
        const row = document.querySelector('.permit-result');
        return {
          status: row.querySelector('.status-badge')?.textContent?.trim() ?? 'Unknown',
          applicant: row.querySelector('.applicant-name')?.textContent?.trim() ?? '',
          permit_type: row.querySelector('.permit-type')?.textContent?.trim() ?? '',
          issued: row.querySelector('.issued-date')?.textContent?.trim() ?? null,
          expires: row.querySelector('.expiry-date')?.textContent?.trim() ?? null,
        };
      });

      return {
        status: result.status || 'Unknown',
        details: result,
        url: page.url(),
      };
    } finally {
      await browser.close();
    }
    */
  }
}

module.exports = ExampleCityScraper;
