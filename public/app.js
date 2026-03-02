/* ─────────────────────────────────────────────────────────────────────────── *
 *  Permit Tracker — Frontend JS
 * ─────────────────────────────────────────────────────────────────────────── */

// ── SVG Icons ─────────────────────────────────────────────────────────────────

const ICONS = {
  history: `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>`,
  refresh: `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/><path d="M8 16H3v5"/></svg>`,
  pencil:  `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/><path d="m15 5 4 4"/></svg>`,
  trash:   `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/><line x1="10" x2="10" y1="11" y2="17"/><line x1="14" x2="14" y1="11" y2="17"/></svg>`,
};

// ── API helpers ───────────────────────────────────────────────────────────────

async function api(method, path, body) {
  const opts = {
    method,
    headers: { 'Content-Type': 'application/json' },
  };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch('/api' + path, opts);
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

const GET    = path        => api('GET',    path);
const POST   = (path, b)   => api('POST',   path, b);
const PUT    = (path, b)   => api('PUT',    path, b);
const DELETE = path        => api('DELETE', path);

// ── State ─────────────────────────────────────────────────────────────────────

let allPermits      = [];
let scrapers        = [];
let sortKey         = 'date_added';
let sortDir         = -1;
let searchQuery     = '';
let activeTabs      = new Set(['active', 'finaled', 'closed']); // all on = show everything
let enabledScrapers = new Set(); // scraper_names currently checked in city filter
let pendingDeleteId = null;

// ── Toast ─────────────────────────────────────────────────────────────────────

const toastEl = document.getElementById('toast');
let toastTimer;
function showToast(msg, type = 'info') {
  toastEl.textContent = msg;
  toastEl.className = `toast ${type} show`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.remove('show'), 3500);
}

// ── Navigation ────────────────────────────────────────────────────────────────

document.querySelectorAll('.nav-link').forEach(link => {
  link.addEventListener('click', e => {
    e.preventDefault();
    const page = link.dataset.page;
    document.querySelectorAll('.nav-link').forEach(l => l.classList.remove('active'));
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
    link.classList.add('active');
    document.getElementById(`page-${page}`).classList.add('active');
    if (page === 'settings') loadSettings();
  });
});

// ── Modal helpers ─────────────────────────────────────────────────────────────

function openModal(id) {
  document.getElementById(id).removeAttribute('hidden');
}
function closeModal(id) {
  document.getElementById(id).setAttribute('hidden', '');
}

document.querySelectorAll('[data-close]').forEach(btn => {
  btn.addEventListener('click', () => closeModal(btn.dataset.close));
});
document.querySelectorAll('.modal-overlay').forEach(overlay => {
  overlay.addEventListener('click', e => {
    if (e.target === overlay) closeModal(overlay.id);
  });
});

// ── Status badge ──────────────────────────────────────────────────────────────

function statusBadge(status) {
  if (!status) return `<span class="badge badge-unknown">Unknown</span>`;
  const s = status.toLowerCase();
  let cls = 'unknown';
  if (s.includes('approv'))       cls = 'approved';
  else if (s.includes('issu'))    cls = 'issued';
  else if (s.includes('pend'))    cls = 'pending';
  else if (s.includes('review'))  cls = 'review';
  else if (s.includes('under'))   cls = 'review';
  else if (s.includes('deni'))    cls = 'denied';
  else if (s.includes('expir'))   cls = 'expired';
  else if (s.includes('error'))   cls = 'error';
  return `<span class="badge badge-${cls}">${escapeHtml(status)}</span>`;
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function formatDate(dt) {
  if (!dt) return '—';
  try {
    return new Date(dt + (dt.includes('T') ? '' : ' UTC')).toLocaleString();
  } catch { return dt; }
}

// ── Load permits ──────────────────────────────────────────────────────────────

async function loadPermits() {
  try {
    allPermits = await GET('/permits');
    renderCityFilter();
    renderTabCounts();
    renderTable();
    renderStats();
    updateLastCheckTime();
  } catch (err) {
    showToast('Failed to load permits: ' + err.message, 'error');
  }
}

function updateLastCheckTime() {
  const times = allPermits
    .filter(p => p.last_checked)
    .map(p => new Date(p.last_checked + ' UTC'));
  const latest = times.length ? new Date(Math.max(...times)) : null;
  document.getElementById('last-check-time').textContent =
    latest ? `Last checked: ${latest.toLocaleString()}` : 'No checks run yet';
}

// ── Status classification ─────────────────────────────────────────────────────

function classifyStatus(status) {
  if (!status) return 'unknown';
  const s = status.toLowerCase();
  if (s.includes('final') || s.includes('approv') || s.includes('complet')) return 'finaled';
  if (s.includes('void') || s.includes('deni') || s.includes('archiv') ||
      s.includes('expir') || s.includes('cancel') || s.includes('withdraw')) return 'closed';
  if (s.includes('issu') || s.includes('pend') || s.includes('review') ||
      s.includes('incomplete') || s.includes('active') || s.includes('open')) return 'active';
  return 'unknown';
}

// ── Stats ─────────────────────────────────────────────────────────────────────

function renderStats() {
  const total    = allPermits.length;
  const active   = allPermits.filter(p => p.active).length;
  const approved = allPermits.filter(p => classifyStatus(p.current_status) === 'finaled').length;
  const pending  = allPermits.filter(p => classifyStatus(p.current_status) === 'active').length;
  const denied   = allPermits.filter(p => classifyStatus(p.current_status) === 'closed').length;

  document.getElementById('stat-total').textContent    = total;
  document.getElementById('stat-active').textContent   = active;
  document.getElementById('stat-approved').textContent = approved;
  document.getElementById('stat-pending').textContent  = pending;
  document.getElementById('stat-denied').textContent   = denied;
}

// ── City filter ───────────────────────────────────────────────────────────────

function renderCityFilter() {
  // Group scrapers by scraper_name, count permits per scraper
  const groups = {};
  for (const p of allPermits) {
    const key = p.scraper_name;
    if (!groups[key]) groups[key] = { count: 0, displayName: p.city || key };
    groups[key].count++;
  }

  // Also include scrapers with 0 permits (from scrapers list)
  for (const s of scrapers) {
    if (!groups[s.name]) groups[s.name] = { count: 0, displayName: s.displayName };
  }

  // Init enabledScrapers to all on first render
  if (enabledScrapers.size === 0) {
    Object.keys(groups).forEach(k => enabledScrapers.add(k));
  }

  const container = document.getElementById('city-filter-list');
  container.innerHTML = Object.entries(groups).map(([key, { count, displayName }]) => `
    <label class="filter-checkbox">
      <input type="checkbox" data-scraper="${escapeHtml(key)}"
        ${enabledScrapers.has(key) ? 'checked' : ''} />
      ${escapeHtml(displayName)}
      <span class="city-count">${count}</span>
    </label>
  `).join('');

  container.querySelectorAll('input[type="checkbox"]').forEach(cb => {
    cb.addEventListener('change', () => {
      const key = cb.dataset.scraper;
      if (cb.checked) enabledScrapers.add(key);
      else enabledScrapers.delete(key);
      renderTable();
      renderTabCounts();
    });
  });
}

// ── Tab counts ────────────────────────────────────────────────────────────────

function renderTabCounts() {
  const visible = allPermits.filter(p => enabledScrapers.has(p.scraper_name));
  document.getElementById('tab-count-all').textContent     = visible.length;
  document.getElementById('tab-count-active').textContent  = visible.filter(p => classifyStatus(p.current_status) === 'active').length;
  document.getElementById('tab-count-finaled').textContent = visible.filter(p => classifyStatus(p.current_status) === 'finaled').length;
  document.getElementById('tab-count-closed').textContent  = visible.filter(p => classifyStatus(p.current_status) === 'closed').length;
}

// ── Tabs ──────────────────────────────────────────────────────────────────────

const ALL_TABS = ['active', 'finaled', 'closed'];

function updateTabHighlights() {
  const allSelected = ALL_TABS.every(t => activeTabs.has(t));
  document.querySelectorAll('.tab').forEach(tab => {
    const name = tab.dataset.tab;
    if (name === 'all') {
      tab.classList.toggle('active', allSelected);
    } else {
      tab.classList.toggle('active', activeTabs.has(name));
    }
  });

  const labels = { active: 'Active', finaled: 'Finaled', closed: 'Closed' };
  const heading = allSelected
    ? 'All Permits'
    : [...activeTabs].map(t => labels[t] || t).join(' + ') + ' Permits';
  document.getElementById('table-heading').textContent = heading || 'Permits';
}

document.querySelectorAll('.tab').forEach(tab => {
  tab.addEventListener('click', () => {
    const name = tab.dataset.tab;
    if (name === 'all') {
      if (ALL_TABS.every(t => activeTabs.has(t))) {
        ALL_TABS.forEach(t => activeTabs.delete(t));
      } else {
        ALL_TABS.forEach(t => activeTabs.add(t));
      }
    } else {
      if (activeTabs.has(name)) {
        activeTabs.delete(name);
      } else {
        activeTabs.add(name);
      }
    }
    updateTabHighlights();
    renderTable();
  });
});

// ── Table render ──────────────────────────────────────────────────────────────

function renderTable() {
  let rows = [...allPermits];

  // City / portal filter
  if (enabledScrapers.size > 0) {
    rows = rows.filter(p => enabledScrapers.has(p.scraper_name));
  }

  // Tab filter — when all three are on, show everything (including 'unknown')
  if (!ALL_TABS.every(t => activeTabs.has(t))) {
    rows = rows.filter(p => activeTabs.has(classifyStatus(p.current_status)));
  }

  // Search filter
  if (searchQuery) {
    const q = searchQuery.toLowerCase();
    rows = rows.filter(p =>
      (p.permit_number || '').toLowerCase().includes(q) ||
      (p.address || '').toLowerCase().includes(q) ||
      (p.city || '').toLowerCase().includes(q) ||
      (p.current_status || '').toLowerCase().includes(q)
    );
  }

  // Sort
  rows.sort((a, b) => {
    const av = a[sortKey] ?? '';
    const bv = b[sortKey] ?? '';
    if (av < bv) return -1 * sortDir;
    if (av > bv) return  1 * sortDir;
    return 0;
  });

  const tbody = document.getElementById('permits-tbody');
  if (rows.length === 0) {
    tbody.innerHTML = `<tr><td colspan="6" class="empty-msg">
      ${searchQuery ? 'No permits match your search.' : 'No permits yet. Click <strong>Add Permit</strong> to get started.'}
    </td></tr>`;
    return;
  }

  tbody.innerHTML = rows.map(p => `
    <tr data-id="${p.id}">
      <td><strong>${escapeHtml(p.permit_number)}</strong></td>
      <td>${escapeHtml(p.address) || '<span style="color:var(--text-muted)">—</span>'}</td>
      <td>${escapeHtml(p.city) || '<span style="color:var(--text-muted)">—</span>'}</td>
      <td>${statusBadge(p.current_status)}</td>
      <td style="color:var(--text-muted);font-size:.8rem">${formatDate(p.last_status_changed)}</td>
      <td>
        <div class="row-actions" onclick="event.stopPropagation()">
          <button class="active-chip ${p.active ? 'on' : ''}" title="${p.active ? 'Active (click to pause)' : 'Paused (click to activate)'}"
            onclick="toggleActive(${p.id}, ${p.active})"></button>
          <button class="btn-icon-sm" onclick="openHistoryModal(${p.id})" title="View history">${ICONS.history}</button>
          <button class="btn-icon-sm" onclick="checkOne(${p.id})" title="Check now">${ICONS.refresh}</button>
          <button class="btn-icon-sm" onclick="openEditModal(${p.id})" title="Edit">${ICONS.pencil}</button>
          <button class="btn-icon-sm danger" onclick="confirmDelete(${p.id})" title="Delete">${ICONS.trash}</button>
        </div>
      </td>
    </tr>
  `).join('');

  // Row click → history
  tbody.querySelectorAll('tr[data-id]').forEach(tr => {
    tr.addEventListener('click', () => openHistoryModal(Number(tr.dataset.id)));
  });
}

// ── Sort ──────────────────────────────────────────────────────────────────────

document.querySelectorAll('thead th[data-sort]').forEach(th => {
  th.addEventListener('click', () => {
    const key = th.dataset.sort;
    if (sortKey === key) {
      sortDir *= -1;
    } else {
      sortKey = key;
      sortDir = 1;
    }
    renderTable();
  });
});

// ── Search ────────────────────────────────────────────────────────────────────

document.getElementById('search-input').addEventListener('input', e => {
  searchQuery = e.target.value.trim();
  renderTable();
});

// ── Import from Everett ───────────────────────────────────────────────────────

const btnImport = document.getElementById('btn-import-everett');
btnImport.addEventListener('click', async () => {
  btnImport.classList.add('loading');
  btnImport.disabled = true;
  showToast('Importing permits from Everett portal…', 'info');
  try {
    const res = await POST('/import/everett');
    showToast(
      `Import complete: ${res.added} new, ${res.skipped} already tracked`,
      'success'
    );
    await loadPermits();
  } catch (err) {
    showToast('Import failed: ' + err.message, 'error');
  } finally {
    btnImport.classList.remove('loading');
    btnImport.disabled = false;
  }
});

// ── Import from Bellingham ────────────────────────────────────────────────────

const btnImportBellingham = document.getElementById('btn-import-bellingham');
btnImportBellingham.addEventListener('click', async () => {
  btnImportBellingham.classList.add('loading');
  btnImportBellingham.disabled = true;
  showToast('Importing permits from Bellingham portal…', 'info');
  try {
    const res  = await fetch('/api/import/bellingham', { method: 'POST' });
    const data = await res.json();
    if (data.logs && data.logs.length) console.log('[bellingham]\n' + data.logs.join('\n'));
    if (!res.ok) {
      showToast('Import failed: ' + (data.error || `HTTP ${res.status}`), 'error');
    } else {
      showToast(`Import complete: ${data.added} new, ${data.skipped} already tracked`, 'success');
      await loadPermits();
    }
  } catch (err) {
    showToast('Import failed: ' + err.message, 'error');
  } finally {
    btnImportBellingham.classList.remove('loading');
    btnImportBellingham.disabled = false;
  }
});

// ── Check All ─────────────────────────────────────────────────────────────────

const btnCheckAll = document.getElementById('btn-check-all');
btnCheckAll.addEventListener('click', async () => {
  btnCheckAll.classList.add('loading');
  btnCheckAll.disabled = true;
  try {
    const res = await POST('/check');
    showToast(
      `Check complete: ${res.checked} checked, ${res.changed} changed, ${res.errors} errors`,
      res.errors > 0 ? 'error' : 'success'
    );
    await loadPermits();
  } catch (err) {
    showToast('Check failed: ' + err.message, 'error');
  } finally {
    btnCheckAll.classList.remove('loading');
    btnCheckAll.disabled = false;
  }
});

// ── Check One ────────────────────────────────────────────────────────────────

async function checkOne(id) {
  showToast('Checking permit…', 'info');
  try {
    const res = await POST(`/check/${id}`);
    showToast(
      res.changed ? `Status changed to: ${res.permit.current_status}` : 'Status unchanged',
      res.changed ? 'success' : 'info'
    );
    await loadPermits();
  } catch (err) {
    showToast('Check failed: ' + err.message, 'error');
  }
}

// ── Toggle Active ─────────────────────────────────────────────────────────────

async function toggleActive(id, currentActive) {
  try {
    await PUT(`/permits/${id}`, { active: !currentActive });
    await loadPermits();
  } catch (err) {
    showToast('Failed to update permit: ' + err.message, 'error');
  }
}

// ── Add / Edit Modal ──────────────────────────────────────────────────────────

document.getElementById('btn-add-permit').addEventListener('click', () => {
  openAddModal();
});

async function loadScrapers() {
  if (scrapers.length > 0) return;
  try {
    scrapers = await GET('/scrapers');
    const sel = document.getElementById('permit-scraper');
    scrapers.forEach(s => {
      const opt = document.createElement('option');
      opt.value = s.name;
      opt.textContent = s.displayName;
      sel.appendChild(opt);
    });
  } catch (err) {
    console.error('Failed to load scrapers:', err);
  }
}

function openAddModal() {
  document.getElementById('modal-permit-title').textContent = 'Add Permit';
  document.getElementById('permit-submit-btn').textContent = 'Add Permit';
  document.getElementById('permit-id').value = '';
  document.getElementById('permit-form').reset();
  document.getElementById('permit-form-msg').style.display = 'none';
  loadScrapers();
  openModal('modal-permit');
}

function openEditModal(id) {
  const permit = allPermits.find(p => p.id === id);
  if (!permit) return;
  document.getElementById('modal-permit-title').textContent = 'Edit Permit';
  document.getElementById('permit-submit-btn').textContent = 'Save Changes';
  document.getElementById('permit-id').value = id;
  document.getElementById('permit-number').value = permit.permit_number || '';
  document.getElementById('permit-address').value = permit.address || '';
  document.getElementById('permit-notes').value = permit.notes || '';
  document.getElementById('permit-form-msg').style.display = 'none';
  loadScrapers().then(() => {
    document.getElementById('permit-scraper').value = permit.scraper_name || '';
  });
  openModal('modal-permit');
}

document.getElementById('permit-form').addEventListener('submit', async e => {
  e.preventDefault();
  const id       = document.getElementById('permit-id').value;
  const number   = document.getElementById('permit-number').value.trim();
  const address  = document.getElementById('permit-address').value.trim();
  const scraper  = document.getElementById('permit-scraper').value;
  const notes    = document.getElementById('permit-notes').value.trim();
  const msgEl    = document.getElementById('permit-form-msg');
  const btn      = document.getElementById('permit-submit-btn');

  msgEl.style.display = 'none';
  btn.disabled = true;

  try {
    if (id) {
      await PUT(`/permits/${id}`, { permit_number: number, address, scraper_name: scraper, notes });
      showToast('Permit updated.', 'success');
    } else {
      // Get display name for city from selected scraper
      const scraperObj = scrapers.find(s => s.name === scraper);
      await POST('/permits', {
        permit_number: number,
        address,
        city: scraperObj ? scraperObj.displayName : scraper,
        scraper_name: scraper,
        notes,
      });
      showToast('Permit added.', 'success');
    }
    closeModal('modal-permit');
    await loadPermits();
  } catch (err) {
    msgEl.textContent = err.message;
    msgEl.className = 'form-msg error';
    msgEl.style.display = 'block';
  } finally {
    btn.disabled = false;
  }
});

// ── Delete ────────────────────────────────────────────────────────────────────

function confirmDelete(id) {
  pendingDeleteId = id;
  const permit = allPermits.find(p => p.id === id);
  document.getElementById('delete-msg').textContent =
    `Delete permit "${permit?.permit_number}"? This will remove all history and cannot be undone.`;
  openModal('modal-delete');
}

document.getElementById('btn-confirm-delete').addEventListener('click', async () => {
  if (!pendingDeleteId) return;
  try {
    await DELETE(`/permits/${pendingDeleteId}`);
    showToast('Permit deleted.', 'success');
    closeModal('modal-delete');
    await loadPermits();
  } catch (err) {
    showToast('Delete failed: ' + err.message, 'error');
  }
  pendingDeleteId = null;
});

// ── History Modal ─────────────────────────────────────────────────────────────

async function openHistoryModal(id) {
  const permit = allPermits.find(p => p.id === id);
  document.getElementById('modal-history-title').textContent =
    `History — ${permit?.permit_number || 'Permit #' + id}`;
  document.getElementById('history-content').innerHTML = '<p style="color:var(--text-muted)">Loading…</p>';
  openModal('modal-history');

  try {
    const history = await GET(`/permits/${id}/history`);
    if (history.length === 0) {
      document.getElementById('history-content').innerHTML =
        '<p style="color:var(--text-muted)">No history yet. Run a check first.</p>';
      return;
    }

    document.getElementById('history-content').innerHTML = history.map(entry => {
      let detailsHtml = '';
      if (entry.raw_details) {
        try {
          const details = JSON.parse(entry.raw_details);
          detailsHtml = Object.entries(details)
            .filter(([k, v]) => v && k !== 'fetched_at')
            .map(([k, v]) => `<span style="margin-right:12px"><em>${escapeHtml(k)}:</em> ${escapeHtml(String(v))}</span>`)
            .join('');
        } catch (_) {}
      }
      return `
        <div class="history-entry">
          <div class="history-dot ${entry.status_changed ? 'changed' : ''}"></div>
          <div class="history-time">${formatDate(entry.checked_at)}</div>
          <div class="history-status">
            ${statusBadge(entry.status)}
            ${entry.status_changed ? '<span style="color:var(--primary);font-size:.75rem;margin-left:8px">● STATUS CHANGED</span>' : ''}
          </div>
          ${detailsHtml ? `<div class="history-details">${detailsHtml}</div>` : ''}
        </div>
      `;
    }).join('');
  } catch (err) {
    document.getElementById('history-content').innerHTML =
      `<p style="color:var(--danger)">Failed to load history: ${escapeHtml(err.message)}</p>`;
  }
}

// ── Settings ──────────────────────────────────────────────────────────────────

async function loadSettings() {
  try {
    const settings = await GET('/settings');
    const form = document.getElementById('settings-form');
    Object.entries(settings).forEach(([key, value]) => {
      const input = form.querySelector(`[name="${key}"]`);
      if (input) input.value = value || '';
    });
    await loadSchedulerStatus();
  } catch (err) {
    showToast('Failed to load settings: ' + err.message, 'error');
  }
}

async function loadSchedulerStatus() {
  try {
    const status = await GET('/settings/scheduler');
    document.getElementById('scheduler-status').innerHTML = `
      <p><strong>Status:</strong> ${status.running ? '🟢 Running' : '🔴 Stopped'}</p>
      <p><strong>Interval:</strong> ${status.interval_hours} hours</p>
      <p><strong>Cron:</strong> <code style="font-size:.8rem;background:var(--surface2);padding:2px 6px;border-radius:4px">${status.cron || '—'}</code></p>
    `;
  } catch (err) {
    document.getElementById('scheduler-status').innerHTML = `<p style="color:var(--danger)">Failed to load status</p>`;
  }
}

document.getElementById('settings-form').addEventListener('submit', async e => {
  e.preventDefault();
  const form   = e.target;
  const msgEl  = document.getElementById('settings-msg');
  const data   = Object.fromEntries(new FormData(form));

  msgEl.style.display = 'none';
  try {
    await PUT('/settings', data);
    msgEl.textContent = 'Settings saved successfully.';
    msgEl.className = 'form-msg success';
    msgEl.style.display = 'block';
    await loadSchedulerStatus();
    setTimeout(() => { msgEl.style.display = 'none'; }, 3000);
  } catch (err) {
    msgEl.textContent = 'Save failed: ' + err.message;
    msgEl.className = 'form-msg error';
    msgEl.style.display = 'block';
  }
});

document.getElementById('btn-test-email').addEventListener('click', async () => {
  const btn = document.getElementById('btn-test-email');
  const msgEl = document.getElementById('settings-msg');
  btn.disabled = true;
  msgEl.style.display = 'none';
  try {
    await POST('/settings/test-email');
    msgEl.textContent = 'Test email sent! Check your inbox.';
    msgEl.className = 'form-msg success';
    msgEl.style.display = 'block';
    showToast('Test email sent!', 'success');
  } catch (err) {
    msgEl.textContent = 'Test email failed: ' + err.message;
    msgEl.className = 'form-msg error';
    msgEl.style.display = 'block';
  } finally {
    btn.disabled = false;
  }
});

// ── Theme ──────────────────────────────────────────────────────────────────────

function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  localStorage.setItem('theme', theme);
  const isLight = theme === 'light';
  document.getElementById('theme-icon-sun').style.display  = isLight ? 'none' : '';
  document.getElementById('theme-icon-moon').style.display = isLight ? '' : 'none';
  document.getElementById('theme-label').textContent = isLight ? 'Dark mode' : 'Light mode';
}

document.getElementById('btn-theme-toggle').addEventListener('click', () => {
  const current = document.documentElement.getAttribute('data-theme') || 'dark';
  applyTheme(current === 'dark' ? 'light' : 'dark');
});

// ── Auth ──────────────────────────────────────────────────────────────────────

const loginScreen = document.getElementById('login-screen');
const appShell    = document.getElementById('app-shell');

async function checkAuth() {
  try {
    const user = await fetch('/api/auth/me').then(async r => {
      if (!r.ok) throw new Error('unauthenticated');
      return r.json();
    });
    // Authenticated — show app
    loginScreen.style.display = 'none';
    appShell.style.display = '';
    document.getElementById('sidebar-username').textContent = user.username;
  } catch (_) {
    // Not authenticated — show login
    appShell.style.display = 'none';
    loginScreen.style.display = '';
  }
}

document.getElementById('login-form').addEventListener('submit', async e => {
  e.preventDefault();
  const username = document.getElementById('login-username').value.trim();
  const password = document.getElementById('login-password').value;
  const errorEl  = document.getElementById('login-error');
  const btn      = document.getElementById('login-submit-btn');

  errorEl.style.display = 'none';
  btn.disabled = true;
  btn.textContent = 'Signing in…';

  try {
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });
    const data = await res.json();
    if (!res.ok) {
      errorEl.textContent = data.error || 'Login failed';
      errorEl.style.display = 'block';
      return;
    }
    await checkAuth();
    loadPermits();
  } catch (err) {
    errorEl.textContent = 'Network error — please try again';
    errorEl.style.display = 'block';
  } finally {
    btn.disabled = false;
    btn.textContent = 'Sign In';
  }
});

document.getElementById('btn-logout').addEventListener('click', async () => {
  await fetch('/api/auth/logout', { method: 'POST' });
  window.location.reload();
});

// ── Init ──────────────────────────────────────────────────────────────────────

applyTheme(localStorage.getItem('theme') || 'dark');
updateTabHighlights();

// Check auth first; loadPermits is called after successful login (or if already authed)
checkAuth().then(() => {
  if (appShell.style.display !== 'none') {
    loadPermits();
  }
});
