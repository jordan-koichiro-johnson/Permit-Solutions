/**
 * checker.js
 *
 * Orchestrates the full check cycle:
 *   1. Fetch active permits from DB
 *   2. For each permit, run the appropriate scraper
 *   3. Compare new status to stored status
 *   4. Persist result to status_history
 *   5. Update permit record if status changed
 *   6. Send notification batch if any changes detected
 */

const queries = require('../db/queries');
const { getScraperInstance } = require('../scrapers/index');
const notifier = require('./notifier');

/**
 * Check a single permit by ID.
 * @param {number} permitId
 * @returns {Promise<{ changed: boolean, permit: object, result: object, error?: string }>}
 */
async function checkPermit(permitId) {
  const permit = queries.getPermitById(permitId);
  if (!permit) throw new Error(`Permit ${permitId} not found`);

  let scrapeResult;
  let errorMsg;

  try {
    const scraper = getScraperInstance(permit.scraper_name);
    scrapeResult = await scraper.checkStatus(permit.permit_number);
  } catch (err) {
    errorMsg = err.message;
    console.error(`[checker] Error scraping permit #${permit.id} (${permit.permit_number}):`, err.message);

    // Still record the failed attempt in history
    queries.addHistoryEntry({
      permit_id: permit.id,
      status: 'Error',
      raw_details: { error: err.message },
      status_changed: 0,
    });
    queries.touchPermitChecked(permit.id);

    return { changed: false, permit, result: null, error: errorMsg };
  }

  const newStatus = scrapeResult.status || 'Unknown';
  const oldStatus = permit.current_status;
  const changed = oldStatus !== newStatus;

  // Record in history
  queries.addHistoryEntry({
    permit_id: permit.id,
    status: newStatus,
    raw_details: { ...scrapeResult.details, url: scrapeResult.url },
    status_changed: changed,
  });

  if (changed) {
    queries.updatePermitStatus(permit.id, newStatus);
  } else {
    queries.touchPermitChecked(permit.id);
  }

  const updatedPermit = queries.getPermitById(permit.id);
  return { changed, permit: updatedPermit, result: scrapeResult, oldStatus };
}

/**
 * Check all active permits.
 * Sends a notification email if any statuses changed.
 * @returns {Promise<{ total: number, checked: number, changed: number, errors: number, changes: Array }>}
 */
async function checkAllPermits() {
  const permits = queries.getActivePermits();
  console.log(`[checker] Starting check for ${permits.length} active permit(s)…`);

  const results = {
    total: permits.length,
    checked: 0,
    changed: 0,
    errors: 0,
    changes: [],
  };

  for (const permit of permits) {
    try {
      const outcome = await checkPermit(permit.id);
      results.checked++;

      if (outcome.error) {
        results.errors++;
      } else if (outcome.changed) {
        results.changed++;
        results.changes.push({
          permit: outcome.permit,
          oldStatus: outcome.oldStatus,
          newStatus: outcome.permit.current_status,
          result: outcome.result,
        });
      }
    } catch (err) {
      results.errors++;
      console.error(`[checker] Unexpected error for permit ${permit.id}:`, err.message);
    }
  }

  console.log(
    `[checker] Done. Checked: ${results.checked}, Changed: ${results.changed}, Errors: ${results.errors}`
  );

  if (results.changes.length > 0) {
    try {
      await notifier.sendChangeReport(results.changes);
    } catch (err) {
      console.error('[checker] Failed to send notification email:', err.message);
    }
  }

  return results;
}

module.exports = { checkPermit, checkAllPermits };
