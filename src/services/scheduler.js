/**
 * scheduler.js
 *
 * Manages the node-cron job that periodically checks all permits.
 * Reads check_interval_hours from settings at startup and whenever restart() is called.
 */

const cron = require('node-cron');
const { getSetting } = require('../db/queries');
const { checkAllPermits } = require('./checker');

let currentJob = null;
let currentInterval = null;

// Convert hours to a cron expression.
// Supports fractional hours down to 1 minute.
// Examples:
//   1   → every 1 hour  → '0 * /1 * * *'  (without space)
//   4   → every 4 hours → '0 * /4 * * *'  (without space)
//   0.5 → every 30 mins → '* /30 * * * *' (without space)
function hoursToCron(hours) {
  const h = parseFloat(hours);
  if (!h || h <= 0) return '0 */4 * * *'; // default 4 hours

  if (h < 1) {
    // Sub-hour — use minutes
    const minutes = Math.round(h * 60);
    return `*/${Math.max(1, minutes)} * * * *`;
  }

  // Full hours
  const roundedHours = Math.round(h);
  if (roundedHours >= 24) return '0 0 * * *'; // daily
  return `0 */${roundedHours} * * *`;
}

/**
 * Start the cron scheduler.
 * If already running, stops the previous job first.
 */
function start() {
  const intervalHours = getSetting('check_interval_hours') || '4';
  const expression = hoursToCron(intervalHours);
  currentInterval = intervalHours;

  if (currentJob) {
    currentJob.stop();
    currentJob = null;
  }

  console.log(`[scheduler] Starting check every ${intervalHours}h — cron: "${expression}"`);

  currentJob = cron.schedule(expression, async () => {
    console.log(`[scheduler] Triggered scheduled check at ${new Date().toISOString()}`);
    try {
      await checkAllPermits();
    } catch (err) {
      console.error('[scheduler] Check failed:', err.message);
    }
  });
}

/**
 * Stop the current cron job.
 */
function stop() {
  if (currentJob) {
    currentJob.stop();
    currentJob = null;
    console.log('[scheduler] Stopped.');
  }
}

/**
 * Restart the scheduler (e.g. after settings change).
 */
function restart() {
  stop();
  start();
}

/**
 * Returns info about the current schedule.
 */
function getStatus() {
  return {
    running: currentJob !== null,
    interval_hours: currentInterval,
    cron: currentInterval ? hoursToCron(currentInterval) : null,
  };
}

module.exports = { start, stop, restart, getStatus };
