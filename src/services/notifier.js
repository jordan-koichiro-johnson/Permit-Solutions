/**
 * notifier.js
 *
 * Builds an Excel change report and sends it via Nodemailer.
 */

const nodemailer = require('nodemailer');
const ExcelJS = require('exceljs');
const path = require('path');
const fs = require('fs');
const os = require('os');
const queries = require('../db/queries');

/**
 * Build an xlsx workbook with two sheets:
 *  - "Changes"    — one row per changed permit
 *  - "All Permits" — full snapshot (all tenants)
 *
 * @param {Array} changes  Array of { permit, oldStatus, newStatus, result }
 * @returns {Promise<string>} Path to the temp .xlsx file
 */
async function buildExcelReport(changes) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Permit Tracker';
  workbook.created = new Date();

  // ── Sheet 1: Changes ───────────────────────────────────────────────────
  const changesSheet = workbook.addWorksheet('Changes');
  changesSheet.columns = [
    { header: 'Permit #',     key: 'permit_number', width: 18 },
    { header: 'Address',      key: 'address',       width: 30 },
    { header: 'City',         key: 'city',          width: 18 },
    { header: 'Old Status',   key: 'old_status',    width: 18 },
    { header: 'New Status',   key: 'new_status',    width: 18 },
    { header: 'Checked At',   key: 'checked_at',    width: 22 },
    { header: 'Portal URL',   key: 'url',           width: 45 },
  ];

  // Style header row
  const changesHeader = changesSheet.getRow(1);
  changesHeader.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  changesHeader.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF2563EB' } };

  for (const { permit, oldStatus, newStatus, result } of changes) {
    changesSheet.addRow({
      permit_number: permit.permit_number,
      address:       permit.address || '',
      city:          permit.city || '',
      old_status:    oldStatus || 'Unknown',
      new_status:    newStatus,
      checked_at:    permit.last_checked || new Date().toISOString(),
      url:           result?.url || '',
    });
  }

  // ── Sheet 2: All Permits ───────────────────────────────────────────────
  const allSheet = workbook.addWorksheet('All Permits');
  allSheet.columns = [
    { header: 'ID',           key: 'id',             width: 6  },
    { header: 'Permit #',     key: 'permit_number',  width: 18 },
    { header: 'Address',      key: 'address',        width: 30 },
    { header: 'City',         key: 'city',           width: 18 },
    { header: 'Scraper',      key: 'scraper_name',   width: 16 },
    { header: 'Status',       key: 'current_status', width: 18 },
    { header: 'Last Checked', key: 'last_checked',   width: 22 },
    { header: 'Active',       key: 'active',         width: 8  },
    { header: 'Notes',        key: 'notes',          width: 35 },
  ];

  const allHeader = allSheet.getRow(1);
  allHeader.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  allHeader.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF374151' } };

  // Use cross-tenant query for the snapshot sheet
  const allPermits = await queries.getAllActivePermits();
  for (const p of allPermits) {
    allSheet.addRow({
      id:             p.id,
      permit_number:  p.permit_number,
      address:        p.address || '',
      city:           p.city || '',
      scraper_name:   p.scraper_name,
      current_status: p.current_status || '',
      last_checked:   p.last_checked || '',
      active:         p.active ? 'Yes' : 'No',
      notes:          p.notes || '',
    });
  }

  // Write to temp file
  const tmpDir = os.tmpdir();
  const dateStr = new Date().toISOString().slice(0, 10);
  const filePath = path.join(tmpDir, `permit-changes-${dateStr}.xlsx`);
  await workbook.xlsx.writeFile(filePath);
  return filePath;
}

/**
 * Send a change report email with an Excel attachment.
 * If email settings are not configured, logs a warning and skips.
 *
 * @param {Array} changes
 */
async function sendChangeReport(changes) {
  // Derive tenantId from the first change's permit, fall back to 1
  const tenantId = changes[0]?.permit?.tenant_id ?? 1;
  const settings = await queries.getAllSettings(tenantId);

  const { smtp_host, smtp_port, smtp_user, smtp_pass, email_from, email_to } = settings;

  if (!smtp_host || !email_to) {
    console.warn('[notifier] Email not configured — skipping notification.');
    return;
  }

  const xlsxPath = await buildExcelReport(changes);

  const transporter = nodemailer.createTransport({
    host: smtp_host,
    port: parseInt(smtp_port, 10) || 587,
    secure: parseInt(smtp_port, 10) === 465,
    auth: smtp_user && smtp_pass
      ? { user: smtp_user, pass: smtp_pass }
      : undefined,
  });

  const dateStr = new Date().toISOString().slice(0, 10);
  const subject = `[Permit Tracker] ${changes.length} permit status change${changes.length !== 1 ? 's' : ''} detected — ${dateStr}`;

  const textBody = changes.map(({ permit, oldStatus, newStatus }) =>
    `• ${permit.permit_number} (${permit.city || 'Unknown City'}): ${oldStatus || 'Unknown'} → ${newStatus}`
  ).join('\n');

  const htmlBody = `
    <h2>Permit Status Changes Detected</h2>
    <p><strong>Date:</strong> ${dateStr}</p>
    <table border="1" cellpadding="6" cellspacing="0" style="border-collapse:collapse;font-family:sans-serif;">
      <thead style="background:#2563eb;color:#fff;">
        <tr>
          <th>Permit #</th><th>Address</th><th>City</th><th>Old Status</th><th>New Status</th>
        </tr>
      </thead>
      <tbody>
        ${changes.map(({ permit, oldStatus, newStatus }) => `
          <tr>
            <td>${permit.permit_number}</td>
            <td>${permit.address || ''}</td>
            <td>${permit.city || ''}</td>
            <td>${oldStatus || 'Unknown'}</td>
            <td><strong>${newStatus}</strong></td>
          </tr>
        `).join('')}
      </tbody>
    </table>
    <p>See attached Excel file for full details.</p>
  `;

  await transporter.sendMail({
    from: email_from || smtp_user,
    to: email_to,
    subject,
    text: `Permit Status Changes:\n\n${textBody}\n\nSee attached Excel file.`,
    html: htmlBody,
    attachments: [
      {
        filename: `permit-changes-${dateStr}.xlsx`,
        path: xlsxPath,
      },
    ],
  });

  console.log(`[notifier] Email sent to ${email_to} — ${changes.length} change(s)`);

  // Clean up temp file
  try { fs.unlinkSync(xlsxPath); } catch (_) {}
}

/**
 * Send a test email to verify SMTP config.
 * @param {number} [tenantId=1]
 */
async function sendTestEmail(tenantId = 1) {
  const settings = await queries.getAllSettings(tenantId);
  const { smtp_host, smtp_port, smtp_user, smtp_pass, email_from, email_to } = settings;

  if (!smtp_host || !email_to) {
    throw new Error('Email not configured. Set SMTP host and email_to in Settings.');
  }

  const transporter = nodemailer.createTransport({
    host: smtp_host,
    port: parseInt(smtp_port, 10) || 587,
    secure: parseInt(smtp_port, 10) === 465,
    auth: smtp_user && smtp_pass
      ? { user: smtp_user, pass: smtp_pass }
      : undefined,
  });

  await transporter.sendMail({
    from: email_from || smtp_user,
    to: email_to,
    subject: '[Permit Tracker] Test Email',
    text: 'Your Permit Tracker email configuration is working correctly.',
    html: '<h2>Permit Tracker</h2><p>Your email configuration is working correctly.</p>',
  });

  console.log(`[notifier] Test email sent to ${email_to}`);
}

module.exports = { sendChangeReport, sendTestEmail, buildExcelReport };
