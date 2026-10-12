const boot = JSON.parse(document.getElementById('bootstrap').textContent || '{}');
const TOKEN = boot.token || '';
const I18N = window.I18N;
const t = I18N.t;
const fmtNum = I18N.fmtNum;
const fmtDate = I18N.fmtDate;

const viewEl = document.getElementById('view');
const stepsEl = document.getElementById('steps');
const envEl = document.getElementById('env');
const titleEl = document.getElementById('viewTitle');
const subEl = document.getElementById('viewSub');
const topActionsEl = document.getElementById('topActions');
const selbarEl = document.getElementById('selbar');
const modalRoot = document.getElementById('modalRoot');
const toastsEl = document.getElementById('toasts');
const brandSubEl = document.getElementById('brandSub');
const localeSwitchEl = document.getElementById('localeSwitch');

/* ------------------------------ helpers ------------------------------ */

function esc(value) {
  return String(value === undefined || value === null ? '' : value).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[c]);
}

function fmtBytes(bytes) {
  const n = Number(bytes) || 0;
  if (n < 1024) return `${n} B`;
  const units = ['KB', 'MB', 'GB', 'TB', 'PB'];
  let value = n / 1024;
  let i = 0;
  while (value >= 1024 && i < units.length - 1) { value /= 1024; i += 1; }
  const digits = value >= 100 ? 0 : value >= 10 ? 1 : 2;
  return `${value.toFixed(digits)} ${units[i]}`;
}

function fmtAge(ms) {
  if (!Number.isFinite(ms) || ms <= 0) return '—';
  const days = ms / 86400000;
  if (days < 1 / 24) return `${Math.max(1, Math.round(ms / 60000))}m`;
  if (days < 1) return `${Math.round(ms / 3600000)}h`;
  if (days < 90) return `${Math.round(days)}d`;
  if (days < 730) return `${(days / 30.44).toFixed(1)}mo`;
  return `${(days / 365.25).toFixed(1)}y`;
}

/* circle labels + reasons are machine codes from the backend; map them
 * to localized text, falling back to the raw code when unknown. */
function circleLabel(key) {
  const label = t(`circle.${key}`);
  return label === `circle.${key}` ? key : label;
}

function reasonLabel(reason) {
  if (!reason) return '';
  const base = String(reason).split(':')[0];
  const label = t(`reason.${base}`);
  return label === `reason.${base}` ? reason : label;
}

async function api(path, { method = 'GET', body } = {}) {
  const headers = { 'x-agent-sweep-token': TOKEN };
  if (body !== undefined) headers['content-type'] = 'application/json';
  const res = await fetch(path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = { raw: text }; }
  if (!res.ok) throw new Error((data && (data.detail || data.error)) || `HTTP ${res.status}`);
  return data;
}

function toast(message, kind = '') {
  const node = document.createElement('div');
  node.className = `toast ${kind}`;
  node.textContent = message;
  toastsEl.appendChild(node);
  setTimeout(() => { node.style.opacity = '0'; node.style.transition = 'opacity .3s'; }, 3200);
  setTimeout(() => node.remove(), 3600);
}

function closeModal() { modalRoot.classList.remove('open'); modalRoot.innerHTML = ''; }

function openModal({ title, bodyHtml, confirmLabel = t('confirm'), danger = false, onConfirm }) {
  modalRoot.innerHTML = `
    <div class="modalBack" data-modal-close></div>
    <div class="modal" role="dialog" aria-modal="true">
      <header>${esc(title)}</header>
      <div class="body">${bodyHtml}</div>
      <footer>
        <button class="btn" data-modal-close>${esc(t('cancel'))}</button>
        <button class="btn ${danger ? 'danger' : 'primary'}" data-modal-confirm>${esc(confirmLabel)}</button>
      </footer>
    </div>`;
  modalRoot.classList.add('open');
  modalRoot.querySelectorAll('[data-modal-close]').forEach((n) => n.addEventListener('click', closeModal));
  modalRoot.querySelector('[data-modal-confirm]').addEventListener('click', async (event) => {
    const btn = event.currentTarget;
    btn.disabled = true;
    try { await onConfirm(); closeModal(); } catch (err) { btn.disabled = false; toast(err.message, 'err'); }
  });
}

/* ------------------------------ state ------------------------------ */

const STEP_IDS = ['scan', 'select', 'plan', 'execute', 'trash'];
const CIRCLE_KEYS = ['safe', 'review', 'protected', 'keep'];

const state = {
  step: 'scan',
  ui: null,
  config: null,
  job: null,
  scan: null,
  units: [],
  selection: new Set(),
  filters: { circle: 'all', harness: 'all', kind: 'all', minScore: 0, search: '', sort: 'sizeBytes', dir: 'desc' },
  plan: null,
  dryExecution: null,
  execution: null,
  report: null,
  trash: null,
  openBatch: null,
  busy: null,
  mode: 'trash',
};

function stepMeta(id) {
  return { id, n: STEP_IDS.indexOf(id) + 1, label: t(`step.${id}.label`), hint: t(`step.${id}.hint`) };
}

/* ------------------------------ selection helpers ------------------------------ */

function selectable(unit) { return unit.deleteEnabled && unit.circle !== 'protected'; }

function filteredUnits() {
  const f = state.filters;
  const search = f.search.trim().toLowerCase();
  let list = state.units.filter((u) => {
    if (!selectable(u)) return false;
    if (f.circle !== 'all' && u.circle !== f.circle) return false;
    if (f.harness !== 'all' && u.harnessId !== f.harness) return false;
    if (f.kind !== 'all' && u.kind !== f.kind) return false;
    if (f.minScore > 0 && u.score < f.minScore) return false;
    if (search && !u.displayPath.toLowerCase().includes(search) && !u.harnessName.toLowerCase().includes(search)) return false;
    return true;
  });
  const dir = f.dir === 'asc' ? 1 : -1;
  list = list.slice().sort((a, b) => {
    const av = a[f.sort] === null ? -1 : a[f.sort];
    const bv = b[f.sort] === null ? -1 : b[f.sort];
    if (typeof av === 'string') return String(av).localeCompare(String(bv)) * dir;
    return (av - bv) * dir;
  });
  return list;
}

function selectedUnits() {
  return state.units.filter((u) => state.selection.has(u.id));
}

function selectedBytes() {
  return selectedUnits().reduce((sum, u) => sum + u.sizeBytes, 0);
}

function selectionSummary() {
  const units = selectedUnits();
  const safe = units.filter((u) => u.circle === 'safe').length;
  const review = units.filter((u) => u.circle === 'review').length;
  return { count: units.length, bytes: selectedBytes(), safe, review };
}

/* ------------------------------ sidebar ------------------------------ */

function stepState(id) {
  const has = {
    scan: Boolean(state.scan),
    select: state.selection.size > 0,
    plan: Boolean(state.plan),
    execute: Boolean(state.report && !state.report.dryRun),
    trash: Boolean(state.trash && state.trash.batchCount > 0),
  };
  const enabled = {
    scan: true,
    select: Boolean(state.scan),
    plan: state.selection.size > 0,
    execute: Boolean(state.plan),
    trash: true,
  };
  return { done: has[id], enabled: enabled[id] };
}

function renderSidebar() {
  stepsEl.innerHTML = STEP_IDS.map((id) => {
    const s = stepMeta(id);
    const st = stepState(id);
    const cls = [id === state.step ? 'active' : '', st.done ? 'done' : '', st.enabled ? '' : 'disabled'].filter(Boolean).join(' ');
    return `<li class="${cls}" data-step="${id}" title="${esc(s.hint)}">
      <span class="n">${st.done && id !== state.step ? '✓' : s.n}</span>
      <span>${esc(s.label)}</span>
    </li>`;
  }).join('');

  if (!state.ui) { envEl.innerHTML = ''; return; }
  envEl.innerHTML = `
    <div class="row"><span>${esc(t('envPlatform'))}</span><span>${esc(state.ui.platformLabel)}</span></div>
    <div class="row"><span>${esc(t('envVersion'))}</span><span>v${esc(state.ui.version)}</span></div>
    <div class="row"><span>${esc(t('envHarnesses'))}</span><span>${esc(t('envHarnessCount', { n: state.ui.harnesses.length }))}</span></div>`;
}

function renderLocaleSwitch() {
  brandSubEl.textContent = t('brandSub');
  const labels = { 'zh-CN': '中文', 'en-US': 'EN' };
  localeSwitchEl.innerHTML = I18N.supported.map((loc) => `
    <button type="button" data-locale="${loc}" class="${loc === I18N.locale ? 'active' : ''}"
      aria-pressed="${loc === I18N.locale}">${esc(labels[loc] || loc)}</button>`).join('');
}

function go(step) {
  const st = stepState(step);
  if (!st.enabled) return;
  state.step = step;
  if (step === 'trash') refreshTrash();
  render();
}

/* ------------------------------ top actions ------------------------------ */

function renderTopActions() {
  const parts = [];
  if (state.scan) {
    parts.push(`<button class="btn sm" data-act="rescan">${esc(t('actRescan'))}</button>`);
    parts.push(`<button class="btn sm" data-act="report">${esc(t('actExport'))}</button>`);
  }
  if (state.step === 'select' && state.selection.size > 0) {
    parts.push(`<button class="btn sm primary" data-act="to-plan">${esc(t('actToPlan', { n: fmtNum(state.selection.size) }))}</button>`);
  }
  topActionsEl.innerHTML = parts.join('');
}

/* ------------------------------ scan step ------------------------------ */

function harnessOptions() {
  return state.ui ? state.ui.harnesses : [];
}

function defaultConfig() {
  const d = state.ui.defaults;
  return {
    harnessIds: harnessOptions().map((h) => h.id),
    globalTtlDays: '',
    minSizeMB: Math.round((d.minSizeBytes || 0) / (1024 * 1024)) || 0,
    minScore: d.minScore || 0,
    includeReportOnly: d.includeReportOnly !== false,
    activeCheck: d.activeCheck !== false,
  };
}

function scanBody() {
  const c = state.config;
  const allIds = harnessOptions().map((h) => h.id);
  const body = {
    minSizeBytes: Math.round((Number(c.minSizeMB) || 0) * 1024 * 1024),
    minScore: Number(c.minScore) || 0,
    includeReportOnly: Boolean(c.includeReportOnly),
    noActiveCheck: !c.activeCheck,
  };
  if (c.harnessIds.length !== allIds.length) body.harnessIds = c.harnessIds;
  const ttl = Number(c.globalTtlDays);
  if (Number.isFinite(ttl) && ttl > 0) body.globalTtlDays = ttl;
  return body;
}

function overviewHtml() {
  const { summary, scan } = state.scan;
  const tot = summary.totals;
  const c = summary.byCircle;
  const total = tot.totalBytes || 1;

  const segs = CIRCLE_KEYS.map((key) => {
    const bytes = c[key] ? c[key].bytes : 0;
    const pct = (bytes / total) * 100;
    if (pct <= 0) return '';
    return `<span class="seg c-${key}" style="width:${pct.toFixed(3)}%" title="${esc(circleLabel(key))} ${fmtBytes(bytes)}"></span>`;
  }).join('');

  const legend = CIRCLE_KEYS.map((key) => {
    const bucket = c[key] || { count: 0, bytes: 0 };
    const pct = ((bucket.bytes / total) * 100).toFixed(1);
    return `<li><span class="dot c-${key}"></span><b>${esc(circleLabel(key))}</b>
      <span class="muted">${esc(t('scan.legend', { bytes: fmtBytes(bucket.bytes), n: fmtNum(bucket.count), pct }))}</span></li>`;
  }).join('');

  const harnessRows = summary.byHarness.map((row) => `<tr>
    <td><span class="mono">${esc(row.harnessName)}</span>${row.deleteEnabled ? '' : `<span class="badge">${esc(t('tagReportOnly'))}</span>`}</td>
    <td class="num">${fmtNum(row.count)}</td>
    <td class="num">${fmtBytes(row.bytes)}</td>
    <td class="num pos">${fmtBytes(row.safeBytes)}</td>
    <td class="num warn">${fmtBytes(row.reviewBytes)}</td>
    <td class="num neg">${fmtBytes(row.protectedBytes)}</td>
    <td class="num">${row.oldestMs ? fmtAge(summary.now - row.oldestMs) : '—'}</td>
    <td class="num">${row.newestMs ? fmtAge(summary.now - row.newestMs) : '—'}</td>
  </tr>`).join('');

  return `
    <div class="cards">
      <div class="card"><div class="k">${esc(t('scan.units'))}</div><div class="v">${fmtNum(tot.unitCount)}</div></div>
      <div class="card"><div class="k">${esc(t('scan.total'))}</div><div class="v">${fmtBytes(tot.totalBytes)}</div></div>
      <div class="card"><div class="k">${esc(t('scan.reclaimable'))}</div><div class="v pos">${fmtBytes(tot.reclaimableBytes)}</div></div>
      <div class="card"><div class="k">${esc(t('circle.short.safe'))}</div><div class="v pos">${fmtBytes(c.safe.bytes)}</div></div>
      <div class="card"><div class="k">${esc(t('circle.short.review'))}</div><div class="v warn">${fmtBytes(c.review.bytes)}</div></div>
      <div class="card"><div class="k">${esc(t('circle.short.protected'))}</div><div class="v neg">${fmtBytes(c.protected.bytes)}</div></div>
    </div>

    <h2 class="sec">${esc(t('scan.circleDist'))}</h2>
    <div class="bar" role="img" aria-label="${esc(t('scan.circleDist'))}">${segs}</div>
    <ul class="legend">${legend}</ul>

    <h2 class="sec">${esc(t('scan.byHarness'))}</h2>
    <div class="tableWrap"><table>
      <thead><tr>
        <th>Harness</th><th class="num">${esc(t('scan.thUnits'))}</th><th class="num">${esc(t('scan.thTotal'))}</th>
        <th class="num">${esc(t('scan.thSafe'))}</th><th class="num">${esc(t('scan.thReview'))}</th><th class="num">${esc(t('scan.thProtected'))}</th>
        <th class="num">${esc(t('scan.thOldest'))}</th><th class="num">${esc(t('scan.thNewest'))}</th>
      </tr></thead>
      <tbody>${harnessRows || `<tr><td colspan="8" class="muted">${esc(t('scan.noData'))}</td></tr>`}</tbody>
    </table></div>

    <div class="btn-row" style="margin-top:20px">
      <button class="btn primary" data-act="to-select">${esc(t('scan.toSelect', { n: fmtNum(tot.unitCount) }))}</button>
      <span class="muted">${esc(t('scan.footnote', { s: (scan.durationMs / 1000).toFixed(1) }))}</span>
    </div>`;
}

function renderScan() {
  const c = state.config;
  const harnesses = harnessOptions();
  const allSelected = c.harnessIds.length === harnesses.length;

  const harnessBoxes = harnesses.map((h) => `
    <label>
      <input type="checkbox" data-harness="${esc(h.id)}" ${c.harnessIds.includes(h.id) ? 'checked' : ''}>
      <span>${esc(h.name)}</span>
      ${h.deleteEnabled ? '' : `<span class="tag">${esc(t('tagReportOnly'))}</span>`}
    </label>`).join('');

  const progress = state.job ? `
    <div class="panel" style="margin-top:16px">
      <div class="progress"><i id="progBar" style="width:${state.job.progress ? Math.round(((state.job.progress.index + 1) / state.job.progress.total) * 100) : 4}%"></i></div>
      <div class="progressLabel">
        <span id="progText">${state.job.progress
          ? esc(t('scan.progress', { name: state.job.progress.harnessName, i: state.job.progress.index + 1, n: state.job.progress.total }))
          : esc(t('scan.progressInit'))}</span>
        <span class="spinner dark"></span>
      </div>
    </div>` : '';

  const overview = state.scan && !state.job ? `<h2 class="sec">${esc(t('scan.overview'))}</h2>${overviewHtml()}` : '';

  viewEl.innerHTML = `
    <div class="panel">
      <div class="form">
        <div class="field">
          <label>${esc(t('scan.ttl'))}</label>
          <input type="number" min="0" step="1" id="f-ttl" value="${esc(c.globalTtlDays)}" placeholder="${esc(t('scan.ttlPlaceholder'))}">
          <span class="hint">${esc(t('scan.ttlHint'))}</span>
        </div>
        <div class="field">
          <label>${esc(t('scan.minSize'))}</label>
          <input type="number" min="0" step="1" id="f-size" value="${esc(c.minSizeMB)}">
          <span class="hint">${esc(t('scan.minSizeHint'))}</span>
        </div>
        <div class="field">
          <label>${esc(t('scan.minScore'))}</label>
          <input type="number" min="0" max="100" step="1" id="f-score" value="${esc(c.minScore)}">
          <span class="hint">${esc(t('scan.minScoreHint'))}</span>
        </div>
        <div class="field">
          <label>${esc(t('scan.options'))}</label>
          <div style="display:flex;flex-direction:column;gap:8px;padding-top:2px">
            <label class="checkline"><input type="checkbox" id="f-active" ${c.activeCheck ? 'checked' : ''}> ${esc(t('scan.activeCheck'))}</label>
            <label class="checkline"><input type="checkbox" id="f-report" ${c.includeReportOnly ? 'checked' : ''}> ${esc(t('scan.reportOnly'))}</label>
          </div>
        </div>
      </div>

      <h2 class="sec">${esc(t('scan.scope'))}</h2>
      <div class="checkline" style="margin-bottom:8px">
        <label class="checkline"><input type="checkbox" id="f-all-harness" ${allSelected ? 'checked' : ''}> ${esc(t('scan.selectAll'))}</label>
        <span class="muted">${esc(t('scan.harnessCount', { n: fmtNum(harnesses.length) }))}</span>
      </div>
      <div class="harnessGrid">${harnessBoxes}</div>

      <div class="btn-row" style="margin-top:18px">
        <button class="btn primary" data-act="scan" ${state.job ? 'disabled' : ''}>
          ${state.job ? `<span class="spinner"></span> ${esc(t('scan.running'))}` : esc(t('scan.start'))}
        </button>
        <span class="muted">${esc(t('scan.readOnly'))}</span>
      </div>
    </div>
    ${progress}
    ${overview}`;
}

/* ------------------------------ select step ------------------------------ */

function circleOptions() {
  // The selection table only lists actionable units, so the circle filter
  // only offers the two cleanable circles.
  return ['safe', 'review'].map((k) => `<option value="${k}" ${state.filters.circle === k ? 'selected' : ''}>${esc(circleLabel(k))}</option>`).join('');
}

function hiddenUnits() {
  return state.units.filter((u) => !selectable(u));
}

function harnessFilterOptions() {
  const seen = new Map();
  for (const u of state.units) seen.set(u.harnessId, u.harnessName);
  return [...seen.entries()].map(([id, name]) => `<option value="${esc(id)}" ${state.filters.harness === id ? 'selected' : ''}>${esc(name)}</option>`).join('');
}

function kindOptions() {
  const kinds = [...new Set(state.units.map((u) => u.kind))].sort();
  return kinds.map((k) => `<option value="${esc(k)}" ${state.filters.kind === k ? 'selected' : ''}>${esc(k)}</option>`).join('');
}

function sortIndicator(key) {
  if (state.filters.sort !== key) return '';
  return state.filters.dir === 'asc' ? ' ↑' : ' ↓';
}

function renderSelect() {
  const list = filteredUnits();
  const rows = list.map((u) => {
    const can = selectable(u);
    const checked = state.selection.has(u.id);
    const signals = `${u.orphan ? `<span class="sig orphan">${esc(t('reason.orphan'))}</span>` : ''}${u.active ? `<span class="sig active">${esc(t('reason.in-use'))}</span>` : ''}`;
    return `<tr class="${checked ? 'selected' : ''}" data-id="${esc(u.id)}">
      <td class="cell-check"><input type="checkbox" data-select="${esc(u.id)}" ${checked ? 'checked' : ''} ${can ? '' : 'disabled'}></td>
      <td><span class="mono">${esc(u.harnessName)}</span>${u.deleteEnabled ? '' : `<span class="badge">${esc(t('tagReportOnly'))}</span>`}</td>
      <td>${esc(u.kind)}</td>
      <td class="num">${fmtBytes(u.sizeBytes)}</td>
      <td class="num">${u.ageMs === null ? '—' : fmtAge(u.ageMs)}</td>
      <td class="num">${u.score.toFixed(1)}</td>
      <td><span class="circle-cell ${u.circle}"><span class="dot c-${u.circle}"></span>${esc(reasonLabel(u.circleReason) || circleLabel(u.circle))}</span></td>
      <td>${signals || '<span class="muted">—</span>'}</td>
      <td class="path" title="${esc(u.path)}">${esc(u.displayPath)}</td>
    </tr>`;
  }).join('');

  const actionable = state.units.filter(selectable);
  const allChosen = actionable.length > 0 && actionable.every((u) => state.selection.has(u.id));
  const hidden = hiddenUnits();
  const hiddenBytes = hidden.reduce((sum, u) => sum + u.sizeBytes, 0);

  viewEl.innerHTML = `
    <div class="toolbar">
      <div class="group">
        <div class="field"><label>${esc(t('sel.circle'))}</label>
          <select id="fl-circle"><option value="all">${esc(t('sel.all'))}</option>${circleOptions()}</select></div>
        <div class="field"><label>Harness</label>
          <select id="fl-harness"><option value="all">${esc(t('sel.all'))}</option>${harnessFilterOptions()}</select></div>
        <div class="field"><label>${esc(t('sel.type'))}</label>
          <select id="fl-kind"><option value="all">${esc(t('sel.all'))}</option>${kindOptions()}</select></div>
        <div class="field"><label>${esc(t('sel.minScore'))}</label>
          <input type="number" min="0" max="100" step="1" id="fl-score" value="${esc(state.filters.minScore)}"></div>
        <div class="field"><label>${esc(t('sel.search'))}</label>
          <input type="search" id="fl-search" value="${esc(state.filters.search)}" placeholder="${esc(t('sel.searchPlaceholder'))}"></div>
      </div>
      <div class="group">
        <button class="btn sm" data-act="sel-safe">${esc(t('sel.allSafe'))}</button>
        <button class="btn sm" data-act="sel-review">${esc(t('sel.allReview'))}</button>
        <button class="btn sm" data-act="sel-visible">${esc(t('sel.allVisible'))}</button>
        <button class="btn sm ghost" data-act="sel-clear">${esc(t('sel.clear'))}</button>
      </div>
    </div>

    <div class="muted" style="margin-bottom:8px;font-size:12px">
      ${esc(t('sel.shown', { shown: fmtNum(list.length), total: fmtNum(actionable.length) }))}
      ${hidden.length ? ` · ${esc(t('sel.hidden', { n: fmtNum(hidden.length), bytes: fmtBytes(hiddenBytes) }))}` : ''}
    </div>

    <div class="tableWrap"><table>
      <thead><tr>
        <th class="cell-check"><input type="checkbox" id="fl-check-all" ${allChosen ? 'checked' : ''}></th>
        <th class="sortable" data-sort="harnessName">Harness${sortIndicator('harnessName')}</th>
        <th class="sortable" data-sort="kind">${esc(t('sel.thType'))}${sortIndicator('kind')}</th>
        <th class="num sortable" data-sort="sizeBytes">${esc(t('sel.thSize'))}${sortIndicator('sizeBytes')}</th>
        <th class="num sortable" data-sort="ageMs">${esc(t('sel.thAge'))}${sortIndicator('ageMs')}</th>
        <th class="num sortable" data-sort="score">${esc(t('sel.thScore'))}${sortIndicator('score')}</th>
        <th class="sortable" data-sort="circle">${esc(t('sel.thCircle'))}${sortIndicator('circle')}</th>
        <th>${esc(t('sel.thType'))}</th>
        <th>${esc(t('sel.thPath'))}</th>
      </tr></thead>
      <tbody>${rows || `<tr><td colspan="9" class="muted" style="padding:24px;text-align:center">${esc(t('sel.empty'))}</td></tr>`}</tbody>
    </table></div>`;

  renderSelbar();
}

function renderSelbar() {
  if (state.step !== 'select') { selbarEl.innerHTML = ''; return; }
  const s = selectionSummary();
  selbarEl.innerHTML = `
    <div class="selbar">
      <div class="info">${t('sel.selected', { n: `<b>${fmtNum(s.count)}</b>`, bytes: `<b>${fmtBytes(s.bytes)}</b>` })}
        <span class="muted">${esc(t('sel.selectedCircles', { safe: fmtNum(s.safe), review: fmtNum(s.review) }))}</span></div>
      <div class="btn-row">
        <button class="btn" data-act="sel-clear">${esc(t('sel.clear'))}</button>
        <button class="btn primary" data-act="to-plan" ${s.count === 0 ? 'disabled' : ''}>${esc(t('actToPlanShort'))}</button>
      </div>
    </div>`;
}

/* ------------------------------ plan step ------------------------------ */

function actionRows(actions, emptyText) {
  if (!actions || actions.length === 0) {
    return `<tr><td colspan="5" class="muted" style="padding:20px;text-align:center">${esc(emptyText)}</td></tr>`;
  }
  return actions.map((a) => `<tr>
    <td><span class="mono">${esc(a.harnessName)}</span></td>
    <td>${esc(a.kind)}</td>
    <td class="num">${fmtBytes(a.sizeBytes)}</td>
    <td class="num">${a.ageDays === null ? '—' : `${a.ageDays}d`}</td>
    <td class="path" title="${esc(a.path)}">${esc(a.displayPath)}</td>
  </tr>`).join('');
}

function renderPlan() {
  const plan = state.plan;
  const dry = state.dryExecution;
  if (!plan) { viewEl.innerHTML = `<div class="empty">${esc(t('plan.empty'))}</div>`; return; }

  const moved = dry ? dry.moved : plan.actions;
  const skipped = dry ? dry.skipped : [];

  const pruneRows = (plan.pruneRepos || []).map((r) => `<tr>
    <td class="path">${esc(r.repo)}</td><td class="num">${fmtNum(r.worktrees)}</td></tr>`).join('');

  const skippedBlock = skipped.length > 0 ? `
    <h2 class="sec">${esc(t('plan.skipped', { n: fmtNum(skipped.length) }))}</h2>
    <div class="note warn"><p>${esc(t('plan.skippedNote'))}</p>
      <ul>${skipped.slice(0, 12).map((s) => `<li><span class="mono">${esc(s.path)}</span> — ${esc(reasonLabel(s.reason) || s.reason)}</li>`).join('')}</ul>
      ${skipped.length > 12 ? `<p class="muted">${esc(t('plan.more', { n: fmtNum(skipped.length - 12) }))}</p>` : ''}
    </div>` : '';

  viewEl.innerHTML = `
    <div class="cards">
      <div class="card"><div class="k">${esc(t('plan.cardCount'))}</div><div class="v">${fmtNum(plan.totals.actionCount)}</div></div>
      <div class="card"><div class="k">${esc(t('plan.cardFreed'))}</div><div class="v pos">${fmtBytes(plan.totals.actionBytes)}</div></div>
      <div class="card"><div class="k">${esc(t('plan.cardVerified'))}</div><div class="v">${fmtNum(moved.length)}</div></div>
      <div class="card"><div class="k">${esc(t('plan.cardSkipped'))}</div><div class="v ${skipped.length ? 'warn' : ''}">${fmtNum(skipped.length)}</div></div>
      <div class="card"><div class="k">${esc(t('plan.cardProtected'))}</div><div class="v neg">${fmtBytes(plan.skipped.protectedBytes)}</div></div>
    </div>

    <div class="note" style="margin-top:16px"><p>${esc(t('plan.note'))}</p></div>

    <h2 class="sec">${esc(t('plan.verified', { n: fmtNum(moved.length) }))}</h2>
    <div class="tableWrap"><table>
      <thead><tr><th>Harness</th><th>${esc(t('sel.thType'))}</th><th class="num">${esc(t('plan.thSize'))}</th><th class="num">${esc(t('plan.thAge'))}</th><th>${esc(t('plan.thPath'))}</th></tr></thead>
      <tbody>${actionRows(moved, t('plan.emptyActions'))}</tbody>
    </table></div>

    ${skippedBlock}

    <h2 class="sec">${esc(t('plan.prune', { n: fmtNum((plan.pruneRepos || []).length) }))}</h2>
    <div class="tableWrap"><table>
      <thead><tr><th>${esc(t('plan.thRepo'))}</th><th class="num">${esc(t('plan.thWorktrees'))}</th></tr></thead>
      <tbody>${pruneRows || `<tr><td colspan="2" class="muted" style="padding:20px;text-align:center">${esc(t('plan.noPrune'))}</td></tr>`}</tbody>
    </table></div>

    <div class="btn-row" style="margin-top:20px">
      <button class="btn primary" data-act="to-execute" ${moved.length === 0 ? 'disabled' : ''}>${esc(t('plan.toExecute'))}</button>
      <button class="btn" data-act="back-select">${esc(t('plan.backSelect'))}</button>
    </div>`;
}

/* ------------------------------ execute step ------------------------------ */

function executeMode() { return state.mode || 'trash'; }

function renderExecute() {
  if (!state.plan) { viewEl.innerHTML = `<div class="empty">${esc(t('exec.empty'))}</div>`; return; }

  if (state.report && !state.report.dryRun) { renderExecuteResult(); return; }

  const plan = state.plan;
  const moved = state.dryExecution ? state.dryExecution.moved.length : plan.totals.actionCount;
  const mode = executeMode();

  viewEl.innerHTML = `
    <div class="panel">
      <h2 class="sec" style="margin-top:0">${esc(t('exec.method'))}</h2>
      <div class="form">
        <div class="field">
          <label>${esc(t('exec.mode'))}</label>
          <div style="display:flex;flex-direction:column;gap:8px;padding-top:2px">
            <label class="checkline"><input type="radio" name="mode" value="trash" ${mode === 'trash' ? 'checked' : ''}> ${esc(t('exec.modeTrash'))}</label>
            <label class="checkline"><input type="radio" name="mode" value="direct" ${mode === 'direct' ? 'checked' : ''}> ${esc(t('exec.modeDirect'))}</label>
          </div>
        </div>
        <div class="field">
          <label>${esc(t('exec.followup'))}</label>
          <div style="padding-top:2px">
            <label class="checkline"><input type="checkbox" id="f-prune" checked> ${esc(t('exec.prune'))}</label>
          </div>
        </div>
      </div>
    </div>

    <div class="note ${mode === 'direct' ? 'danger' : ''}" style="margin-top:16px">
      <p>${t('exec.willProcess', { n: `<b>${fmtNum(moved)}</b>`, bytes: `<b>${fmtBytes(plan.totals.actionBytes)}</b>` })}</p>
      <ul>
        <li>${esc(t('exec.verifyNote'))}</li>
        <li>${esc(mode === 'trash' ? t('exec.trashNote') : t('exec.directNote'))}</li>
      </ul>
    </div>

    ${mode === 'direct' ? `
      <div class="panel" style="margin-top:16px">
        <div class="field">
          <label>${esc(t('exec.confirmLabel'))}</label>
          <input type="text" id="f-confirmtext" placeholder="${esc(t('exec.confirmPlaceholder'))}">
          <span class="hint">${esc(t('exec.confirmHint'))}</span>
        </div>
      </div>` : ''}

    <div class="btn-row" style="margin-top:20px">
      <button class="btn ${mode === 'direct' ? 'danger' : 'primary'}" data-act="execute">${esc(mode === 'direct' ? t('exec.btnDirect') : t('exec.btnTrash'))}</button>
      <button class="btn" data-act="back-plan">${esc(t('exec.backPlan'))}</button>
    </div>`;
}

function renderExecuteResult() {
  const r = state.report;
  const exec = state.execution;
  const failed = exec.failed || [];
  const pruned = exec.pruned || [];

  viewEl.innerHTML = `
    <div class="cards">
      <div class="card"><div class="k">${esc(t('exec.cardProcessed'))}</div><div class="v pos">${fmtNum(r.moved)}</div></div>
      <div class="card"><div class="k">${esc(t('exec.cardFreed'))}</div><div class="v pos">${fmtBytes(r.freedBytes)}</div></div>
      <div class="card"><div class="k">${esc(t('exec.cardSkipped'))}</div><div class="v ${r.skipped ? 'warn' : ''}">${fmtNum(r.skipped)}</div></div>
      <div class="card"><div class="k">${esc(t('exec.cardFailed'))}</div><div class="v ${r.failed ? 'neg' : ''}">${fmtNum(r.failed)}</div></div>
      <div class="card"><div class="k">${esc(t('exec.cardPruned'))}</div><div class="v">${fmtNum(r.pruned)}</div></div>
    </div>

    <div class="note ${failed.length ? 'warn' : ''}" style="margin-top:16px">
      <p>${t('exec.finishNote', { label: esc(exec.dryRun ? t('exec.labelDry') : t('exec.labelReal')), s: (exec.durationMs / 1000).toFixed(1) })}
      ${r.batchId ? esc(t('exec.batchNote', { id: esc(r.batchId) })) : ''}</p>
    </div>

    ${failed.length ? `
      <h2 class="sec">${esc(t('exec.failedTitle'))}</h2>
      <div class="note danger"><ul>${failed.map((f) => `<li><span class="mono">${esc(f.path)}</span> — ${esc(reasonLabel(f.reason) || f.reason)}</li>`).join('')}</ul></div>` : ''}

    ${pruned.length ? `
      <h2 class="sec">${esc(t('exec.pruneTitle'))}</h2>
      <div class="tableWrap"><table>
        <thead><tr><th>${esc(t('plan.thRepo'))}</th><th>${esc(t('exec.thResult'))}</th></tr></thead>
        <tbody>${pruned.map((p) => `<tr><td class="path">${esc(p.repo.repo || p.repo)}</td><td>${p.ok ? `<span class="pos">${esc(t('exec.ok'))}</span>` : `<span class="warn">${esc(p.output || t('exec.failed'))}</span>`}</td></tr>`).join('')}</tbody>
      </table></div>` : ''}

    <div class="btn-row" style="margin-top:20px">
      <button class="btn primary" data-act="to-trash">${esc(t('exec.toTrash'))}</button>
      <button class="btn" data-act="rescan">${esc(t('actRescan'))}</button>
    </div>`;
}

/* ------------------------------ trash step ------------------------------ */

async function refreshTrash() {
  try {
    state.trash = await api('/api/trash');
    if (state.step === 'trash') render();
  } catch (err) { toast(err.message, 'err'); }
}

function batchEntriesHtml(manifest) {
  if (!manifest || !manifest.entries) return `<div class="muted">${esc(t('trash.noEntries'))}</div>`;
  return `<div class="tableWrap" style="max-height:40vh"><table>
    <thead><tr><th class="num">${esc(t('trash.thSize'))}</th><th>${esc(t('trash.thPath'))}</th></tr></thead>
    <tbody>${manifest.entries.map((e) => `<tr>
      <td class="num">${fmtBytes(e.sizeBytes)}</td>
      <td class="path" title="${esc(e.originalPath)}">${esc(e.originalPath)}</td>
    </tr>`).join('')}</tbody>
  </table></div>`;
}

function renderTrash() {
  const tr = state.trash;
  if (!tr) { viewEl.innerHTML = `<div class="empty">${esc(t('trash.loading'))}</div>`; return; }

  const batches = tr.batches.map((b) => `
    <details class="batch" data-batch="${esc(b.id)}">
      <summary>
        <span><span class="mono">${esc(b.id)}</span>
          ${b.label ? `<span class="badge">${esc(b.label)}</span>` : ''}</span>
        <span class="muted">${b.createdAt ? fmtDate(b.createdAt) : '—'} ·
          ${b.entries === null ? '—' : esc(t('trash.entries', { n: fmtNum(b.entries) }))} ·
          ${b.freedBytes === null ? '—' : fmtBytes(b.freedBytes)}</span>
      </summary>
      <div class="batchBody">
        <div id="batch-body-${esc(b.id)}" class="muted">${esc(t('trash.expand'))}</div>
        <div class="btn-row" style="margin-top:12px">
          <button class="btn sm" data-act="restore-dry" data-batch="${esc(b.id)}">${esc(t('trash.restoreDry'))}</button>
          <button class="btn sm primary" data-act="restore" data-batch="${esc(b.id)}">${esc(t('trash.restore'))}</button>
        </div>
      </div>
    </details>`).join('');

  viewEl.innerHTML = `
    <div class="cards">
      <div class="card"><div class="k">${esc(t('trash.cardBatches'))}</div><div class="v">${fmtNum(tr.batchCount)}</div></div>
      <div class="card"><div class="k">${esc(t('trash.cardFreed'))}</div><div class="v pos">${fmtBytes(tr.freedBytes)}</div></div>
    </div>

    <h2 class="sec">${esc(t('trash.list'))}</h2>
    ${batches || `<div class="empty">${esc(t('trash.empty'))}</div>`}

    ${tr.batchCount > 0 ? `
      <div class="btn-row" style="margin-top:20px">
        <button class="btn danger" data-act="empty">${esc(t('trash.emptyTrash'))}</button>
      </div>` : ''}`;
}

/* ------------------------------ actions ------------------------------ */

async function startScan() {
  if (state.job) return;
  try {
    const res = await api('/api/scan', { method: 'POST', body: scanBody() });
    state.job = { id: res.jobId, progress: null };
    render();
    pollJob(res.jobId);
  } catch (err) {
    toast(err.message, 'err');
  }
}

async function pollJob(id) {
  const tick = async () => {
    try {
      const job = await api(`/api/jobs/${id}`);
      if (job.state === 'running') {
        state.job = { id, progress: job.progress };
        if (state.step === 'scan') render();
        setTimeout(tick, 600);
        return;
      }
      state.job = null;
      if (job.state === 'error') { toast(t('scan.failed', { err: job.error }), 'err'); render(); return; }
      state.scan = job.result;
      state.units = job.result.units;
      state.selection = new Set();
      state.plan = null; state.dryExecution = null; state.execution = null; state.report = null;
      toast(t('scan.done', { n: fmtNum(state.units.length) }), 'ok');
      state.step = 'select';
      render();
    } catch (err) {
      state.job = null;
      toast(err.message, 'err');
      render();
    }
  };
  tick();
}

async function goPlan() {
  const ids = [...state.selection];
  if (ids.length === 0) { toast(t('sel.selectFirst'), 'err'); return; }
  state.busy = 'plan';
  try {
    const res = await api('/api/execute', { method: 'POST', body: { actionIds: ids, dryRun: true } });
    state.plan = res.plan;
    state.dryExecution = res.execution;
    state.execution = null; state.report = null;
    state.step = 'plan';
    render();
  } catch (err) { toast(err.message, 'err'); } finally { state.busy = null; }
}

async function doExecute() {
  const ids = [...state.selection];
  const mode = executeMode();
  const directDelete = mode === 'direct';
  const prune = document.getElementById('f-prune') ? document.getElementById('f-prune').checked : true;
  const confirmText = document.getElementById('f-confirmtext') ? document.getElementById('f-confirmtext').value.trim() : '';

  if (directDelete && confirmText !== 'DELETE') { toast(t('exec.confirmToast'), 'err'); return; }

  const body = { actionIds: ids, dryRun: false, directDelete, prune, confirm: true };
  if (directDelete) body.confirmText = confirmText;

  const run = async () => {
    state.busy = 'execute';
    try {
      const res = await api('/api/execute', { method: 'POST', body });
      state.execution = res.execution;
      state.report = res.report;
      state.plan = res.plan;
      toast(directDelete
        ? t('exec.deletedToast', { n: fmtNum(res.report.moved) })
        : t('exec.movedToast', { n: fmtNum(res.report.moved) }), 'ok');
      state.selection = new Set();
      render();
      refreshTrash();
    } catch (err) { toast(err.message, 'err'); } finally { state.busy = null; }
  };

  if (directDelete) {
    openModal({
      title: t('exec.modalTitle'),
      bodyHtml: `<p>${t('exec.modalBody', { n: fmtNum(state.plan.totals.actionCount), bytes: fmtBytes(state.plan.totals.actionBytes) })}</p>
        <p class="muted" style="margin-top:8px">${esc(t('exec.modalSub'))}</p>`,
      confirmLabel: t('exec.btnDirect'),
      danger: true,
      onConfirm: run,
    });
  } else {
    await run();
  }
}

async function restoreBatch(batchId, dryRun) {
  const doIt = async () => {
    try {
      const res = await api('/api/trash/restore', { method: 'POST', body: { batchId, dryRun, confirm: true } });
      const msg = dryRun
        ? t('trash.restoreDryToast', { n: fmtNum(res.restored.length), c: fmtNum(res.conflicts.length), m: fmtNum(res.missing.length) })
        : t('trash.restoreToast', { n: fmtNum(res.restored.length) })
          + (res.conflicts.length ? t('trash.restoreToastConflicts', { c: fmtNum(res.conflicts.length) }) : '');
      toast(msg, dryRun ? '' : 'ok');
      if (!dryRun) refreshTrash();
    } catch (err) { toast(err.message, 'err'); }
  };
  if (dryRun) { await doIt(); return; }
  openModal({
    title: t('trash.restoreModalTitle'),
    bodyHtml: `<p>${t('trash.restoreModalBody', { id: `<span class="mono">${esc(batchId)}</span>` })}</p>
      <p class="muted" style="margin-top:8px">${esc(t('trash.restoreModalSub'))}</p>`,
    confirmLabel: t('trash.restoreBtn'),
    onConfirm: doIt,
  });
}

function emptyTrash() {
  openModal({
    title: t('trash.emptyModalTitle'),
    bodyHtml: `<p>${t('trash.emptyModalBody')}</p>
      <div class="field" style="margin-top:12px">
        <label>${esc(t('trash.keepDays'))}</label>
        <input type="number" min="0" step="1" id="f-keepdays" placeholder="${esc(t('trash.keepDaysPlaceholder'))}">
      </div>`,
    confirmLabel: t('trash.emptyBtn'),
    danger: true,
    onConfirm: async () => {
      const raw = document.getElementById('f-keepdays');
      const days = raw && raw.value.trim() !== '' ? Number(raw.value) : 0;
      const res = await api('/api/trash/empty', { method: 'POST', body: { confirm: true, olderThanDays: Number.isFinite(days) ? days : 0 } });
      toast(t('trash.emptiedToast', { n: fmtNum(res.removed.length) }), 'ok');
      refreshTrash();
    },
  });
}

async function downloadReport() {
  try {
    const res = await fetch('/api/report.html', { headers: { 'x-agent-sweep-token': TOKEN } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const html = await res.text();
    const url = URL.createObjectURL(new Blob([html], { type: 'text/html' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = 'agent-sweep-report.html';
    a.click();
    URL.revokeObjectURL(url);
    toast(t('reportExported'), 'ok');
  } catch (err) { toast(err.message, 'err'); }
}

/* ------------------------------ selection ops ------------------------------ */

function applySelection(ids, mode) {
  const list = filteredUnits().filter(selectable);
  if (mode === 'clear') state.selection = new Set();
  else if (mode === 'add') ids.forEach((id) => state.selection.add(id));
  else if (mode === 'visible') { state.selection = new Set(); list.forEach((u) => state.selection.add(u.id)); }
  renderSelect();
  renderSidebar();
  renderTopActions();
}

/* ------------------------------ render root ------------------------------ */

function render() {
  renderLocaleSwitch();
  renderSidebar();
  renderTopActions();
  const step = stepMeta(state.step);
  titleEl.textContent = step.label;
  subEl.textContent = step.hint;

  if (state.step === 'scan') { selbarEl.innerHTML = ''; renderScan(); }
  else if (state.step === 'select') renderSelect();
  else if (state.step === 'plan') { selbarEl.innerHTML = ''; renderPlan(); }
  else if (state.step === 'execute') { selbarEl.innerHTML = ''; renderExecute(); }
  else if (state.step === 'trash') { selbarEl.innerHTML = ''; renderTrash(); }
}

/* ------------------------------ events ------------------------------ */

localeSwitchEl.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-locale]');
  if (btn) I18N.setLocale(btn.dataset.locale);
});

stepsEl.addEventListener('click', (e) => {
  const li = e.target.closest('[data-step]');
  if (li) go(li.dataset.step);
});

topActionsEl.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-act]');
  if (!btn) return;
  const act = btn.dataset.act;
  if (act === 'rescan') go('scan');
  else if (act === 'report') downloadReport();
  else if (act === 'to-plan') goPlan();
});

selbarEl.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-act]');
  if (!btn) return;
  if (btn.dataset.act === 'to-plan') goPlan();
  else if (btn.dataset.act === 'sel-clear') applySelection([], 'clear');
});

viewEl.addEventListener('click', (e) => {
  const actBtn = e.target.closest('[data-act]');
  if (actBtn) {
    const act = actBtn.dataset.act;
    if (act === 'scan') startScan();
    else if (act === 'to-select') go('select');
    else if (act === 'to-plan') goPlan();
    else if (act === 'back-select') go('select');
    else if (act === 'to-execute') go('execute');
    else if (act === 'back-plan') go('plan');
    else if (act === 'execute') doExecute();
    else if (act === 'to-trash') go('trash');
    else if (act === 'empty') emptyTrash();
    else if (act === 'restore') restoreBatch(actBtn.dataset.batch, false);
    else if (act === 'restore-dry') restoreBatch(actBtn.dataset.batch, true);
    else if (act === 'sel-safe') applySelection(state.units.filter((u) => u.circle === 'safe').map((u) => u.id), 'add');
    else if (act === 'sel-review') applySelection(state.units.filter((u) => u.circle === 'review').map((u) => u.id), 'add');
    else if (act === 'sel-visible') applySelection([], 'visible');
    else if (act === 'sel-clear') applySelection([], 'clear');
    return;
  }

  const sortTh = e.target.closest('th[data-sort]');
  if (sortTh) {
    const key = sortTh.dataset.sort;
    if (state.filters.sort === key) state.filters.dir = state.filters.dir === 'asc' ? 'desc' : 'asc';
    else { state.filters.sort = key; state.filters.dir = 'desc'; }
    renderSelect();
    return;
  }

  const checkAll = e.target.closest('#fl-check-all');
  if (checkAll) {
    if (checkAll.checked) applySelection([], 'visible');
    else applySelection([], 'clear');
  }
});

viewEl.addEventListener('change', (e) => {
  const el = e.target;
  if (el.matches('[data-select]')) {
    const id = el.dataset.select;
    if (el.checked) state.selection.add(id); else state.selection.delete(id);
    const row = el.closest('tr');
    if (row) row.classList.toggle('selected', el.checked);
    renderSelbar();
    renderSidebar();
    renderTopActions();
    return;
  }
  if (el.id === 'fl-circle') { state.filters.circle = el.value; renderSelect(); }
  else if (el.id === 'fl-harness') { state.filters.harness = el.value; renderSelect(); }
  else if (el.id === 'fl-kind') { state.filters.kind = el.value; renderSelect(); }
  else if (el.id === 'fl-score') { state.filters.minScore = Number(el.value) || 0; renderSelect(); }
  else if (el.id === 'f-ttl') { state.config.globalTtlDays = el.value; }
  else if (el.id === 'f-size') { state.config.minSizeMB = el.value; }
  else if (el.id === 'f-score') { state.config.minScore = el.value; }
  else if (el.id === 'f-active') { state.config.activeCheck = el.checked; }
  else if (el.id === 'f-report') { state.config.includeReportOnly = el.checked; }
  else if (el.id === 'f-all-harness') {
    state.config.harnessIds = el.checked ? harnessOptions().map((h) => h.id) : [];
    renderScan();
  } else if (el.dataset && el.dataset.harness) {
    const id = el.dataset.harness;
    if (el.checked) { if (!state.config.harnessIds.includes(id)) state.config.harnessIds.push(id); }
    else state.config.harnessIds = state.config.harnessIds.filter((x) => x !== id);
  } else if (el.name === 'mode') {
    state.mode = el.value;
    renderExecute();
  }
});

viewEl.addEventListener('input', (e) => {
  if (e.target.id === 'fl-search') {
    state.filters.search = e.target.value;
    clearTimeout(viewEl._searchTimer);
    viewEl._searchTimer = setTimeout(renderSelect, 180);
  }
});

viewEl.addEventListener('toggle', async (e) => {
  const details = e.target;
  if (!details.matches('details.batch') || !details.open) return;
  const id = details.dataset.batch;
  const body = document.getElementById(`batch-body-${id}`);
  if (!body || body.dataset.loaded) return;
  try {
    const manifest = await api(`/api/trash/${encodeURIComponent(id)}`);
    body.innerHTML = batchEntriesHtml(manifest);
    body.dataset.loaded = '1';
  } catch (err) { body.textContent = err.message; }
}, true);

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') closeModal();
});

I18N.onChange(() => render());

/* ------------------------------ init ------------------------------ */

async function init() {
  try {
    state.ui = await api('/api/state');
    state.config = defaultConfig();
    state.mode = 'trash';
  } catch (err) {
    viewEl.innerHTML = `<div class="note danger">${esc(t('initFailed', { err: err.message }))}</div>`;
    return;
  }
  render();
  refreshTrash();
}

init();