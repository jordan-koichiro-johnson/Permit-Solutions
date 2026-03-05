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
 * @param {number} tenantId
 * @returns {Promise<{ changed: boolean, permit: object, result: object, error?: string }>}
 */
async function checkPermit(permitId, tenantId) {
  const permit = await queries.getPermitById(permitId, tenantId);
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
    await queries.addHistoryEntry({
      tenant_id: tenantId,
      permit_id: permit.id,
      status: 'Error',
      raw_details: { error: err.message },
      status_changed: false,
    });
    await queries.touchPermitChecked(permit.id, tenantId);

    return { changed: false, permit, result: null, error: errorMsg };
  }

  const newStatus = scrapeResult.status || 'Unknown';
  const oldStatus = permit.current_status;
  const changed = oldStatus !== newStatus;

  // Record in history
  await queries.addHistoryEntry({
    tenant_id: tenantId,
    permit_id: permit.id,
    status: newStatus,
    raw_details: { ...scrapeResult.details, url: scrapeResult.url },
    status_changed: changed,
  });

  if (changed) {
    await queries.updatePermitStatus(permit.id, newStatus, tenantId);
  } else {
    await queries.touchPermitChecked(permit.id, tenantId);
  }

  const updatedPermit = await queries.getPermitById(permit.id, tenantId);
  return { changed, permit: updatedPermit, result: scrapeResult, oldStatus };
}

/**
 * Check all active permits.
 * Sends a notification email if any statuses changed.
 * @param {number|null} tenantId — if set, only that tenant's permits; if null, all tenants
 * @returns {Promise<{ total: number, checked: number, changed: number, errors: number, changes: Array }>}
 */
async function checkAllPermits(tenantId = null) {
  const permits = tenantId
    ? await queries.getActivePermits(tenantId)
    : await queries.getAllActivePermits();

  console.log(`[checker] Starting check for ${permits.length} active permit(s)…`);

  const results = {
    total: permits.length,
    checked: 0,
    changed: 0,
    errors: 0,
    changes: [],
  };

  for (const permit of permits) {
    const tid = tenantId ?? permit.tenant_id;
    try {
      const outcome = await checkPermit(permit.id, tid);
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
