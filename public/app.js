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

// ── Current user context (set after /me) ──────────────────────────────────────
let currentUser = null; // { id, username, role, isSuperAdmin }

// ── Current plan (loaded on init) ─────────────────────────────────────────────
let currentPlan = null; // { plan, canCheck, canImport, userLimit, states, … }

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
    showPage(page);
  });
});

function showPage(page) {
  document.querySelectorAll('.nav-link').forEach(l => {
    l.classList.toggle('active', l.dataset.page === page);
  });
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.getElementById(`page-${page}`).classList.add('active');
  if (page === 'settings') loadSettings();
}

function switchSubtab(tab) {
  document.querySelectorAll('.sub-tab-btn').forEach(b => b.classList.remove('active'));
  document.querySelectorAll('.subtab-content').forEach(c => c.classList.remove('active'));
  const btn = document.querySelector(`.sub-tab-btn[data-subtab="${tab}"]`);
  if (btn) btn.classList.add('active');
  const content = document.getElementById(`subtab-${tab}`);
  if (content) content.classList.add('active');
  if (tab === 'users')   loadUsers();
  if (tab === 'tenants') loadTenants();
  if (tab === 'general') loadSettings();
  if (tab === 'billing') loadBilling();
}

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

// ── Import dropdown ───────────────────────────────────────────────────────────

let importCities = [];

async function loadImportCities() {
  try {
    importCities = await GET('/import/list');
    const list = document.getElementById('import-city-list');
    list.innerHTML = importCities.map(c => `
      <li data-name="${escapeHtml(c.name)}" data-display="${escapeHtml(c.displayName)}">
        <input type="checkbox" id="import-cb-${escapeHtml(c.name)}" />
        <label for="import-cb-${escapeHtml(c.name)}">${escapeHtml(c.displayName)}</label>
      </li>
    `).join('');
    list.querySelectorAll('input[type="checkbox"]').forEach(cb => {
      cb.addEventListener('change', updateImportRunButton);
    });
  } catch (err) {
    console.error('Failed to load import cities:', err);
  }
}

function updateImportRunButton() {
  const checked = document.querySelectorAll('#import-city-list input[type="checkbox"]:checked');
  const btn = document.getElementById('btn-import-run');
  btn.disabled = checked.length === 0;
  btn.textContent = checked.length > 0 ? `Import Selected (${checked.length})` : 'Import Selected';
}

// Toggle dropdown
const btnImportToggle = document.getElementById('btn-import');
const importDropdown  = document.getElementById('import-dropdown');

btnImportToggle.addEventListener('click', e => {
  e.stopPropagation();
  importDropdown.toggleAttribute('hidden');
  if (!importDropdown.hasAttribute('hidden')) {
    document.getElementById('import-search').focus();
  }
});

// Close on outside click
document.addEventListener('click', e => {
  if (!e.target.closest('.import-wrap')) {
    importDropdown.setAttribute('hidden', '');
  }
});

// Search filter
document.getElementById('import-search').addEventListener('input', e => {
  const q = e.target.value.toLowerCase();
  document.querySelectorAll('#import-city-list li').forEach(li => {
    const display = li.dataset.display.toLowerCase();
    li.style.display = display.includes(q) ? '' : 'none';
  });
});

// Run import
document.getElementById('btn-import-run').addEventListener('click', async () => {
  if (currentPlan && !currentPlan.canImport) {
    importDropdown.setAttribute('hidden', '');
    document.getElementById('upgrade-modal-msg').textContent =
      'Importing is not available on the Free plan. Upgrade to Starter or Business to import permits.';
    openModal('modal-upgrade');
    return;
  }
  const checked = [...document.querySelectorAll('#import-city-list input[type="checkbox"]:checked')];
  if (checked.length === 0) return;

  const cities = checked.map(cb => {
    const li = cb.closest('li');
    return { name: li.dataset.name, displayName: li.dataset.display };
  });

  importDropdown.setAttribute('hidden', '');
  // Uncheck all
  document.querySelectorAll('#import-city-list input[type="checkbox"]').forEach(cb => { cb.checked = false; });
  updateImportRunButton();

  for (const city of cities) {
    showToast(`Importing from ${city.displayName}…`, 'info');
    try {
      const res = await POST(`/import/${city.name}`);
      if (res.logs && res.logs.length) console.log(`[${city.name}]\n` + res.logs.join('\n'));
      showToast(`${city.displayName}: ${res.added} new, ${res.skipped} already tracked`, 'success');
    } catch (err) {
      showToast(`${city.displayName} import failed: ` + err.message, 'error');
    }
  }

  await loadPermits();
});

// ── Check All ─────────────────────────────────────────────────────────────────

const btnCheckAll = document.getElementById('btn-check-all');
btnCheckAll.addEventListener('click', async () => {
  if (currentPlan && !currentPlan.canCheck) {
    document.getElementById('upgrade-modal-msg').textContent =
      'Bulk permit checking is not available on the Free plan. Upgrade to Starter or Business to check all permits at once.';
    openModal('modal-upgrade');
    return;
  }
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
    currentUser = user;
    loginScreen.style.display = 'none';
    appShell.style.display = '';
    document.getElementById('sidebar-username').textContent = user.username;
    applyRoleVisibility(user);
  } catch (_) {
    // Not authenticated — show login
    appShell.style.display = 'none';
    loginScreen.style.display = '';
  }
}

function applyRoleVisibility(user) {
  // Show/hide Users sub-tab based on role
  const usersBtn = document.getElementById('subtab-btn-users');
  const tenantsBtn = document.getElementById('subtab-btn-tenants');
  if (user.role === 'admin' || user.isSuperAdmin) {
    usersBtn.style.display = '';
  } else {
    usersBtn.style.display = 'none';
  }
  if (user.isSuperAdmin) {
    tenantsBtn.style.display = '';
  } else {
    tenantsBtn.style.display = 'none';
  }
}

function applyPlanLockIcons() {
  const lockCheck  = document.getElementById('check-lock-icon');
  const lockImport = document.getElementById('import-lock-icon');
  if (!currentPlan) return;
  if (lockCheck)  lockCheck.style.display  = currentPlan.canCheck  ? 'none' : '';
  if (lockImport) lockImport.style.display = currentPlan.canImport ? 'none' : '';
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
    if (appShell.style.display !== 'none') {
      loadPermits();
      loadImportCities();
      loadBilling();
    }
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

// ── Settings Sub-tabs ─────────────────────────────────────────────────────────

document.querySelectorAll('.sub-tab-btn').forEach(btn => {
  btn.addEventListener('click', () => switchSubtab(btn.dataset.subtab));
});

// ── Change My Password ────────────────────────────────────────────────────────

document.getElementById('btn-change-password').addEventListener('click', () => {
  document.getElementById('change-password-form').reset();
  document.getElementById('change-password-msg').style.display = 'none';
  openModal('modal-change-password');
});

document.getElementById('change-password-form').addEventListener('submit', async e => {
  e.preventDefault();
  const currentPassword = document.getElementById('change-current-password').value;
  const newPassword     = document.getElementById('change-new-password').value;
  const msgEl = document.getElementById('change-password-msg');
  const btn   = e.target.querySelector('[type="submit"]');

  msgEl.style.display = 'none';
  btn.disabled = true;
  try {
    await POST('/auth/change-password', { currentPassword, newPassword });
    msgEl.textContent = 'Password updated successfully.';
    msgEl.className = 'form-msg success';
    msgEl.style.display = 'block';
    setTimeout(() => closeModal('modal-change-password'), 1500);
  } catch (err) {
    msgEl.textContent = err.message;
    msgEl.className = 'form-msg error';
    msgEl.style.display = 'block';
  } finally {
    btn.disabled = false;
  }
});

// ── Users ─────────────────────────────────────────────────────────────────────

let allUsers = [];
let pendingDeleteUserId = null;
let allTenantsCache = [];

async function loadUsers() {
  try {
    allUsers = await GET('/users');
    renderUsersTable();
  } catch (err) {
    showToast('Failed to load users: ' + err.message, 'error');
  }
}

function renderUsersTable() {
  const tbody = document.getElementById('users-tbody');
  const thTenant = document.getElementById('users-th-tenant');

  // Show tenant column only for super-admins
  if (currentUser?.isSuperAdmin) {
    thTenant.style.display = '';
  }

  if (!allUsers.length) {
    tbody.innerHTML = `<tr><td colspan="8" class="empty-msg">No users found.</td></tr>`;
    return;
  }

  tbody.innerHTML = allUsers.map(u => {
    const roleBadge = u.role === 'admin'
      ? `<span class="badge badge-admin">Admin</span>`
      : `<span class="badge badge-user">User</span>`;
    const statusBadge = u.active
      ? `<span class="badge badge-active">Active</span>`
      : `<span class="badge badge-inactive">Inactive</span>`;
    const isSelf = currentUser && u.id === currentUser.id;
    const tenantCell = currentUser?.isSuperAdmin
      ? `<td>${escapeHtml(u.tenant_name || u.tenant_slug || String(u.tenant_id))}</td>`
      : '';

    return `
      <tr>
        <td><strong>${escapeHtml(u.username)}</strong>${isSelf ? ' <span class="hint">(you)</span>' : ''}</td>
        <td>${escapeHtml([u.first_name, u.last_name].filter(Boolean).join(' ')) || '—'}</td>
        <td>${escapeHtml(u.email) || '—'}</td>
        <td>${roleBadge}</td>
        <td>${statusBadge}</td>
        ${tenantCell}
        <td style="color:var(--text-muted);font-size:.8rem">${formatDate(u.last_login)}</td>
        <td>
          <div class="row-actions">
            <button class="btn-icon-sm" onclick="openEditUserModal(${u.id})" title="Edit">${ICONS.pencil}</button>
            <button class="btn-icon-sm" onclick="openResetPasswordModal(${u.id})" title="Reset password">
              <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="18" height="11" x="3" y="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
            </button>
            ${!isSelf ? `<button class="btn-icon-sm danger" onclick="confirmDeleteUser(${u.id})" title="Delete">${ICONS.trash}</button>` : ''}
          </div>
        </td>
      </tr>
    `;
  }).join('');
}

document.getElementById('btn-add-user').addEventListener('click', () => openAddUserModal());

function openAddUserModal() {
  document.getElementById('modal-user-title').textContent = 'Add User';
  document.getElementById('user-submit-btn').textContent = 'Add User';
  document.getElementById('user-id').value = '';
  document.getElementById('user-form').reset();
  document.getElementById('user-active').checked = true;
  document.getElementById('user-password-group').style.display = '';
  document.getElementById('user-form-msg').style.display = 'none';

  // Tenant picker: only for super-admin
  setupUserTenantPicker(null);
  openModal('modal-user');
}

async function setupUserTenantPicker(selectedTenantId) {
  const group = document.getElementById('user-tenant-group');
  const sel   = document.getElementById('user-tenant-id');
  if (!currentUser?.isSuperAdmin) {
    group.style.display = 'none';
    return;
  }
  group.style.display = '';
  // Load tenants if not cached
  if (!allTenantsCache.length) {
    try { allTenantsCache = await GET('/tenants'); } catch (_) {}
  }
  sel.innerHTML = allTenantsCache.map(t =>
    `<option value="${t.id}" ${selectedTenantId === t.id ? 'selected' : ''}>${escapeHtml(t.name)}</option>`
  ).join('');
}

function openEditUserModal(id) {
  const u = allUsers.find(x => x.id === id);
  if (!u) return;
  document.getElementById('modal-user-title').textContent = 'Edit User';
  document.getElementById('user-submit-btn').textContent = 'Save Changes';
  document.getElementById('user-id').value = id;
  document.getElementById('user-username').value   = u.username || '';
  document.getElementById('user-first-name').value = u.first_name || '';
  document.getElementById('user-last-name').value  = u.last_name || '';
  document.getElementById('user-email').value      = u.email || '';
  document.getElementById('user-role').value       = u.role || 'user';
  document.getElementById('user-active').checked   = Boolean(u.active);
  document.getElementById('user-password-group').style.display = 'none'; // no password on edit
  document.getElementById('user-form-msg').style.display = 'none';
  setupUserTenantPicker(u.tenant_id);
  openModal('modal-user');
}

document.getElementById('user-form').addEventListener('submit', async e => {
  e.preventDefault();
  const id        = document.getElementById('user-id').value;
  const username  = document.getElementById('user-username').value.trim();
  const password  = document.getElementById('user-password').value;
  const firstName = document.getElementById('user-first-name').value.trim();
  const lastName  = document.getElementById('user-last-name').value.trim();
  const email     = document.getElementById('user-email').value.trim();
  const role      = document.getElementById('user-role').value;
  const active    = document.getElementById('user-active').checked;
  const tenantId  = document.getElementById('user-tenant-id').value;
  const msgEl     = document.getElementById('user-form-msg');
  const btn       = document.getElementById('user-submit-btn');

  msgEl.style.display = 'none';
  btn.disabled = true;

  try {
    if (id) {
      // Edit
      const body = { username, first_name: firstName, last_name: lastName, email, role, active };
      await PUT(`/users/${id}`, body);
      showToast('User updated.', 'success');
    } else {
      // Add
      const body = { username, password, first_name: firstName, last_name: lastName, email, role };
      if (currentUser?.isSuperAdmin && tenantId) body.tenant_id = Number(tenantId);
      await POST('/users', body);
      showToast('User created.', 'success');
    }
    closeModal('modal-user');
    await loadUsers();
  } catch (err) {
    msgEl.textContent = err.message;
    msgEl.className = 'form-msg error';
    msgEl.style.display = 'block';
  } finally {
    btn.disabled = false;
  }
});

// ── Reset Password ────────────────────────────────────────────────────────────

function openResetPasswordModal(userId) {
  const u = allUsers.find(x => x.id === userId);
  document.getElementById('reset-password-user-id').value = userId;
  document.getElementById('reset-password-msg-text').textContent =
    `Set a new password for ${u ? escapeHtml(u.username) : 'this user'}.`;
  document.getElementById('reset-password-form').reset();
  document.getElementById('reset-password-err').style.display = 'none';
  openModal('modal-reset-password');
}

document.getElementById('reset-password-form').addEventListener('submit', async e => {
  e.preventDefault();
  const id          = document.getElementById('reset-password-user-id').value;
  const newPassword = document.getElementById('reset-password-new').value;
  const errEl = document.getElementById('reset-password-err');
  const btn   = e.target.querySelector('[type="submit"]');

  errEl.style.display = 'none';
  btn.disabled = true;
  try {
    await POST(`/users/${id}/reset-password`, { newPassword });
    showToast('Password reset successfully.', 'success');
    closeModal('modal-reset-password');
  } catch (err) {
    errEl.textContent = err.message;
    errEl.style.display = 'block';
  } finally {
    btn.disabled = false;
  }
});

// ── Delete User ───────────────────────────────────────────────────────────────

function confirmDeleteUser(id) {
  const u = allUsers.find(x => x.id === id);
  pendingDeleteUserId = id;
  document.getElementById('delete-user-msg').textContent =
    `Delete user "${u?.username}"? This cannot be undone.`;
  openModal('modal-delete-user');
}

document.getElementById('btn-confirm-delete-user').addEventListener('click', async () => {
  if (!pendingDeleteUserId) return;
  try {
    await DELETE(`/users/${pendingDeleteUserId}`);
    showToast('User deleted.', 'success');
    closeModal('modal-delete-user');
    await loadUsers();
  } catch (err) {
    showToast('Delete failed: ' + err.message, 'error');
  }
  pendingDeleteUserId = null;
});

// ── Tenants ───────────────────────────────────────────────────────────────────

let allTenants = [];
let pendingDeleteTenantId = null;

async function loadTenants() {
  try {
    allTenants = await GET('/tenants');
    allTenantsCache = allTenants; // keep cache in sync
    renderTenantsTable();
  } catch (err) {
    showToast('Failed to load tenants: ' + err.message, 'error');
  }
}

function renderTenantsTable() {
  const tbody = document.getElementById('tenants-tbody');
  if (!allTenants.length) {
    tbody.innerHTML = `<tr><td colspan="6" class="empty-msg">No tenants found.</td></tr>`;
    return;
  }
  tbody.innerHTML = allTenants.map(t => `
    <tr>
      <td><strong>${escapeHtml(t.name)}</strong></td>
      <td><code style="font-size:.8rem;background:var(--surface2);padding:2px 7px;border-radius:4px">${escapeHtml(t.slug)}</code></td>
      <td><span class="plan-badge plan-badge-${t.plan || 'free'}">${t.plan || 'free'}</span></td>
      <td>
        <button class="btn btn-ghost btn-sm" onclick="openTenantStatesModal(${t.id}, '${escapeHtml(t.name)}')">States</button>
      </td>
      <td style="color:var(--text-muted);font-size:.8rem">${formatDate(t.created_at)}</td>
      <td>
        <div class="row-actions">
          <button class="btn-icon-sm" onclick="openEditTenantModal(${t.id})" title="Edit">${ICONS.pencil}</button>
          ${t.id !== 1 ? `<button class="btn-icon-sm danger" onclick="confirmDeleteTenant(${t.id})" title="Delete">${ICONS.trash}</button>` : ''}
        </div>
      </td>
    </tr>
  `).join('');
}

// ── Tenant state management (super-admin) ─────────────────────────────────────

let activeTenantStatesId = null;

async function openTenantStatesModal(tenantId, tenantName) {
  activeTenantStatesId = tenantId;
  document.getElementById('modal-tenant-states-title').textContent = `States — ${tenantName}`;
  document.getElementById('modal-tenant-state-select').value = '';
  await refreshTenantStatesModal();
  openModal('modal-tenant-states');
}

async function refreshTenantStatesModal() {
  try {
    const { states } = await GET(`/tenants/${activeTenantStatesId}/states`);
    const listEl = document.getElementById('modal-tenant-states-list');
    if (!states.length) {
      listEl.innerHTML = '<p class="hint" style="margin:0">No states unlocked.</p>';
    } else {
      listEl.innerHTML = states.map(code => `
        <span class="state-tag">
          ${escapeHtml(code)}
          <button class="state-tag-remove" onclick="removeTenantStateAdmin('${escapeHtml(code)}')" title="Remove">×</button>
        </span>
      `).join('');
    }
  } catch (err) {
    showToast('Failed to load states: ' + err.message, 'error');
  }
}

async function addTenantStateAdmin() {
  const sel = document.getElementById('modal-tenant-state-select');
  const code = sel ? sel.value : '';
  if (!code) return;
  try {
    await POST(`/tenants/${activeTenantStatesId}/states`, { state: code });
    sel.value = '';
    await refreshTenantStatesModal();
    showToast(`${code} added.`, 'success');
  } catch (err) {
    showToast('Failed to add state: ' + err.message, 'error');
  }
}

async function removeTenantStateAdmin(code) {
  try {
    await api('DELETE', `/tenants/${activeTenantStatesId}/states/${code}`);
    await refreshTenantStatesModal();
    showToast(`${code} removed.`, 'success');
  } catch (err) {
    showToast('Failed to remove state: ' + err.message, 'error');
  }
}

document.getElementById('btn-add-tenant').addEventListener('click', () => {
  document.getElementById('modal-tenant-title').textContent = 'Add Tenant';
  document.getElementById('tenant-submit-btn').textContent = 'Add Tenant';
  document.getElementById('tenant-id').value = '';
  document.getElementById('tenant-form').reset();
  document.getElementById('tenant-form-msg').style.display = 'none';
  openModal('modal-tenant');
});

function openEditTenantModal(id) {
  const t = allTenants.find(x => x.id === id);
  if (!t) return;
  document.getElementById('modal-tenant-title').textContent = 'Edit Tenant';
  document.getElementById('tenant-submit-btn').textContent = 'Save Changes';
  document.getElementById('tenant-id').value   = id;
  document.getElementById('tenant-name').value = t.name || '';
  document.getElementById('tenant-slug').value = t.slug || '';
  document.getElementById('tenant-form-msg').style.display = 'none';
  openModal('modal-tenant');
}

document.getElementById('tenant-form').addEventListener('submit', async e => {
  e.preventDefault();
  const id   = document.getElementById('tenant-id').value;
  const name = document.getElementById('tenant-name').value.trim();
  const slug = document.getElementById('tenant-slug').value.trim();
  const msgEl = document.getElementById('tenant-form-msg');
  const btn   = document.getElementById('tenant-submit-btn');

  msgEl.style.display = 'none';
  btn.disabled = true;
  try {
    if (id) {
      await PUT(`/tenants/${id}`, { name, slug });
      showToast('Tenant updated.', 'success');
    } else {
      await POST('/tenants', { name, slug });
      showToast('Tenant created.', 'success');
    }
    closeModal('modal-tenant');
    await loadTenants();
  } catch (err) {
    msgEl.textContent = err.message;
    msgEl.className = 'form-msg error';
    msgEl.style.display = 'block';
  } finally {
    btn.disabled = false;
  }
});

function confirmDeleteTenant(id) {
  const t = allTenants.find(x => x.id === id);
  pendingDeleteTenantId = id;
  document.getElementById('delete-tenant-msg').textContent =
    `Delete tenant "${t?.name}"? This removes all its users, permits, and history. This cannot be undone.`;
  openModal('modal-delete-tenant');
}

document.getElementById('btn-confirm-delete-tenant').addEventListener('click', async () => {
  if (!pendingDeleteTenantId) return;
  try {
    await DELETE(`/tenants/${pendingDeleteTenantId}`);
    showToast('Tenant deleted.', 'success');
    closeModal('modal-delete-tenant');
    await loadTenants();
  } catch (err) {
    showToast('Delete failed: ' + err.message, 'error');
  }
  pendingDeleteTenantId = null;
});

// ── Billing ───────────────────────────────────────────────────────────────────

async function loadBilling() {
  // Check for successful checkout redirect
  const params = new URLSearchParams(window.location.search);
  if (params.get('checkout') === 'success') {
    showToast('Subscription activated!', 'success');
    history.replaceState(null, '', window.location.pathname);
  }

  try {
    const b = await GET('/billing');
    currentPlan = b;
    applyPlanLockIcons();
    renderBillingTab(b);
  } catch (err) {
    console.error('Failed to load billing info:', err);
  }
}

async function startCheckout(planKey) {
  try {
    const res = await POST('/billing/checkout', { plan: planKey });
    if (res.url) window.location.href = res.url;
  } catch (err) {
    showToast('Checkout failed: ' + err.message, 'error');
  }
}

async function openPortal() {
  try {
    const res = await POST('/billing/portal', {});
    if (res.url) window.location.href = res.url;
  } catch (err) {
    showToast('Could not open billing portal: ' + err.message, 'error');
  }
}

function renderBillingTab(b) {
  // Plan badge
  const badge = document.getElementById('billing-plan-badge');
  if (badge) {
    badge.textContent = b.label;
    badge.className = `plan-badge plan-badge-${b.plan}`;
  }

  // Price
  const priceEl = document.getElementById('billing-plan-price');
  if (priceEl) {
    priceEl.textContent = b.price === 0 ? 'Free' : `$${b.price}/mo`;
  }

  // User count
  const userCountEl = document.getElementById('billing-user-count');
  if (userCountEl) {
    const limit = b.userLimit === null ? '∞' : b.userLimit;
    userCountEl.textContent = `${b.userCount} / ${limit}`;
  }

  // Feature flags
  const canCheckEl  = document.getElementById('billing-can-check');
  const canImportEl = document.getElementById('billing-can-import');
  if (canCheckEl)  canCheckEl.innerHTML  = b.canCheck  ? '<span class="plan-feature-on">Enabled</span>'  : '<span class="plan-feature-off">Upgrade required</span>';
  if (canImportEl) canImportEl.innerHTML = b.canImport ? '<span class="plan-feature-on">Enabled</span>' : '<span class="plan-feature-off">Upgrade required</span>';

  // Manage Billing button (shown when there's an active subscription)
  const manageRow = document.getElementById('billing-manage-row');
  if (manageRow) {
    manageRow.style.display = b.hasActiveSubscription ? '' : 'none';
  }

  // Upgrade CTA — show for free plan
  const ctaEl = document.getElementById('billing-upgrade-cta');
  if (ctaEl) {
    if (b.plan === 'free') {
      ctaEl.style.display = '';
      const optionsEl = document.getElementById('billing-plan-options');
      if (optionsEl) {
        optionsEl.innerHTML = b.availablePlans
          .filter(p => p.key !== 'free')
          .map(p => `
            <div class="billing-plan-option">
              <div class="billing-plan-option-name"><span class="plan-badge plan-badge-${p.key}">${p.label}</span></div>
              <div class="billing-plan-option-price">$${p.price}/mo</div>
              <div class="billing-plan-option-features">
                Up to ${p.userLimit === null ? 'unlimited' : p.userLimit} users &bull;
                Bulk checking &bull; Importing
              </div>
              <button class="btn btn-primary btn-sm" style="margin-top:8px" onclick="startCheckout('${p.key}')">Upgrade to ${p.label}</button>
            </div>
          `).join('');
      }
    } else {
      ctaEl.style.display = 'none';
    }
  }

  // States
  renderBillingStates(b.states, b.plan);
}

function renderBillingStates(states, plan) {
  const listEl = document.getElementById('billing-states-list');
  if (!listEl) return;

  if (states.length === 0) {
    listEl.innerHTML = '<p class="hint" style="margin:0 0 8px">No states unlocked yet.</p>';
  } else {
    listEl.innerHTML = states.map(code => `
      <span class="state-tag">
        ${escapeHtml(code)}
        <button class="state-tag-remove" onclick="removeBillingState('${escapeHtml(code)}')" title="Remove ${escapeHtml(code)}">×</button>
      </span>
    `).join('');
  }

  // Hide states card on free plan
  const statesCard = document.getElementById('billing-states-card');
  if (statesCard) {
    statesCard.style.display = plan === 'free' ? 'none' : '';
  }
}

async function addBillingState() {
  const sel = document.getElementById('billing-state-select');
  const code = sel ? sel.value : '';
  if (!code) return;
  try {
    const res = await POST('/billing/states', { state: code });
    currentPlan.states = res.states;
    renderBillingStates(res.states, currentPlan.plan);
    if (sel) sel.value = '';
    showToast(`${code} added.`, 'success');
    // Reload import list to reflect newly unlocked state
    importCities = [];
    await loadImportCities();
  } catch (err) {
    showToast('Failed to add state: ' + err.message, 'error');
  }
}

async function removeBillingState(code) {
  try {
    const res = await api('DELETE', `/billing/states/${code}`);
    currentPlan.states = res.states;
    renderBillingStates(res.states, currentPlan.plan);
    showToast(`${code} removed.`, 'success');
    // Reload import list
    importCities = [];
    await loadImportCities();
  } catch (err) {
    showToast('Failed to remove state: ' + err.message, 'error');
  }
}

document.addEventListener('click', e => {
  if (e.target && e.target.id === 'btn-add-state') {
    addBillingState();
  }
});

// ── Init ──────────────────────────────────────────────────────────────────────

applyTheme(localStorage.getItem('theme') || 'dark');
updateTabHighlights();

// Check auth first; loadPermits is called after successful login (or if already authed)
checkAuth().then(() => {
  if (appShell.style.display !== 'none') {
    loadPermits();
    loadImportCities();
    loadBilling();
  }
});
