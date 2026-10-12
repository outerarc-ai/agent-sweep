const boot = JSON.parse(document.getElementById('bootstrap').textContent || '{}');
const TOKEN = boot.token || '';

const viewEl = document.getElementById('view');
const stepsEl = document.getElementById('steps');
const envEl = document.getElementById('env');
const titleEl = document.getElementById('viewTitle');
const subEl = document.getElementById('viewSub');
const topActionsEl = document.getElementById('topActions');
const selbarEl = document.getElementById('selbar');
const modalRoot = document.getElementById('modalRoot');
const toastsEl = document.getElementById('toasts');

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

function fmtNum(n) { return new Intl.NumberFormat('en-US').format(Number(n) || 0); }

function fmtDate(input) {
  const d = input instanceof Date ? input : new Date(input);
  if (Number.isNaN(d.getTime())) return '—';
  const p = (v) => String(v).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
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

function openModal({ title, bodyHtml, confirmLabel = '确认', danger = false, onConfirm }) {
  modalRoot.innerHTML = `
    <div class="modalBack" data-modal-close></div>
    <div class="modal" role="dialog" aria-modal="true">
      <header>${esc(title)}</header>
      <div class="body">${bodyHtml}</div>
      <footer>
        <button class="btn" data-modal-close>取消</button>
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

const STEPS = [
  { id: 'scan', n: 1, label: '扫描', hint: '只读枚举候选残留' },
  { id: 'select', n: 2, label: '勾选', hint: '挑选要清理的对象' },
  { id: 'plan', n: 3, label: '预演', hint: '复核动作，不写盘' },
  { id: 'execute', n: 4, label: '执行', hint: '移入回收站或删除' },
  { id: 'trash', n: 5, label: '回收站', hint: '查看与还原批次' },
];

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
};

const CIRCLE_CLASS = { safe: 'safe', review: 'review', protected: 'protected', keep: 'keep' };

/* ------------------------------ selection helpers ------------------------------ */

function selectable(unit) { return unit.deleteEnabled && unit.circle !== 'protected'; }

function filteredUnits() {
  const f = state.filters;
  const search = f.search.trim().toLowerCase();
  let list = state.units.filter((u) => {
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
  stepsEl.innerHTML = STEPS.map((s) => {
    const st = stepState(s.id);
    const cls = [s.id === state.step ? 'active' : '', st.done ? 'done' : '', st.enabled ? '' : 'disabled'].filter(Boolean).join(' ');
    return `<li class="${cls}" data-step="${s.id}">
      <span class="n">${st.done && s.id !== state.step ? '✓' : s.n}</span>
      <span class="meta"><b>${esc(s.label)}</b><small>${esc(s.hint)}</small></span>
    </li>`;
  }).join('');

  if (!state.ui) { envEl.innerHTML = ''; return; }
  envEl.innerHTML = `
    <div class="row"><span>平台</span><span>${esc(state.ui.platformLabel)}</span></div>
    <div class="row"><span>版本</span><span>v${esc(state.ui.version)}</span></div>
    <div class="row"><span>回收站</span><span class="mono">${esc(state.ui.trashRoot)}</span></div>
    <div class="row"><span>Harness</span><span>${fmtNum(state.ui.harnesses.length)} 个</span></div>`;
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
    parts.push('<button class="btn sm" data-act="rescan">重新扫描</button>');
    parts.push('<button class="btn sm" data-act="report">导出 HTML 报告</button>');
  }
  if (state.step === 'select' && state.selection.size > 0) {
    parts.push(`<button class="btn sm primary" data-act="to-plan">生成预演（${fmtNum(state.selection.size)}）</button>`);
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
  const t = summary.totals;
  const c = summary.byCircle;
  const order = ['safe', 'review', 'protected', 'keep'];
  const total = t.totalBytes || 1;
  const segs = order.map((key) => {
    const bytes = c[key] ? c[key].bytes : 0;
    const pct = (bytes / total) * 100;
    if (pct <= 0) return '';
    return `<span class="seg c-${key}" style="width:${pct.toFixed(3)}%" title="${esc(summary.circles[key].label)} ${fmtBytes(bytes)}"></span>`;
  }).join('');
  const legend = order.map((key) => {
    const bucket = c[key] || { count: 0, bytes: 0 };
    const pct = ((bucket.bytes / total) * 100).toFixed(1);
    return `<li><span class="dot c-${key}"></span><b>${esc(summary.circles[key].label)}</b>
      <span class="muted">${fmtBytes(bucket.bytes)} · ${fmtNum(bucket.count)} 个 · ${pct}%</span></li>`;
  }).join('');

  const harnessRows = summary.byHarness.map((row) => `<tr>
    <td><span class="mono">${esc(row.harnessName)}</span>${row.deleteEnabled ? '' : '<span class="badge">仅报告</span>'}</td>
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
      <div class="card"><div class="k">候选单元</div><div class="v">${fmtNum(t.unitCount)}</div></div>
      <div class="card"><div class="k">扫描总体积</div><div class="v">${fmtBytes(t.totalBytes)}</div></div>
      <div class="card"><div class="k">可回收总量</div><div class="v pos">${fmtBytes(t.reclaimableBytes)}</div></div>
      <div class="card"><div class="k">安全圈</div><div class="v pos">${fmtBytes(c.safe.bytes)}</div></div>
      <div class="card"><div class="k">待确认圈</div><div class="v warn">${fmtBytes(c.review.bytes)}</div></div>
      <div class="card"><div class="k">永不清理</div><div class="v neg">${fmtBytes(c.protected.bytes)}</div></div>
    </div>

    <h2 class="sec">圈层体积分布</h2>
    <div class="bar" role="img" aria-label="圈层体积分布">${segs}</div>
    <ul class="legend">${legend}</ul>

    <h2 class="sec">按 Harness 汇总</h2>
    <div class="tableWrap"><table>
      <thead><tr>
        <th>Harness</th><th class="num">单元</th><th class="num">合计</th>
        <th class="num">安全圈</th><th class="num">待确认</th><th class="num">保护</th>
        <th class="num">最旧</th><th class="num">最新</th>
      </tr></thead>
      <tbody>${harnessRows || '<tr><td colspan="8" class="muted">无数据</td></tr>'}</tbody>
    </table></div>

    <div class="btn-row" style="margin-top:20px">
      <button class="btn primary" data-act="to-select">去勾选（${fmtNum(t.unitCount)} 个候选）</button>
      <span class="muted">扫描耗时 ${(scan.durationMs / 1000).toFixed(1)}s · 只读，未改动磁盘</span>
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
      ${h.deleteEnabled ? '' : '<span class="tag">仅报告</span>'}
    </label>`).join('');

  const progress = state.job ? `
    <div class="panel" style="margin-top:16px">
      <div class="progress"><i id="progBar" style="width:${state.job.progress ? Math.round(((state.job.progress.index + 1) / state.job.progress.total) * 100) : 4}%"></i></div>
      <div class="progressLabel">
        <span id="progText">${state.job.progress ? `正在扫描 ${esc(state.job.progress.harnessName)}（${state.job.progress.index + 1}/${state.job.progress.total}）` : '正在初始化扫描…'}</span>
        <span class="spinner dark"></span>
      </div>
    </div>` : '';

  const overview = state.scan && !state.job ? `<h2 class="sec">扫描概览</h2>${overviewHtml()}` : '';

  viewEl.innerHTML = `
    <div class="panel">
      <div class="form">
        <div class="field">
          <label>TTL（天）</label>
          <input type="number" min="0" step="1" id="f-ttl" value="${esc(c.globalTtlDays)}" placeholder="留空使用各 harness 默认值">
          <span class="hint">超过该年龄的残留才进入候选；留空则按 harness 默认 TTL</span>
        </div>
        <div class="field">
          <label>最小体积（MB）</label>
          <input type="number" min="0" step="1" id="f-size" value="${esc(c.minSizeMB)}">
          <span class="hint">小于该体积的对象不进入可清理范围</span>
        </div>
        <div class="field">
          <label>最低评分</label>
          <input type="number" min="0" max="100" step="1" id="f-score" value="${esc(c.minScore)}">
          <span class="hint">复合评分下限（0-100）</span>
        </div>
        <div class="field">
          <label>开关</label>
          <div style="display:flex;flex-direction:column;gap:8px;padding-top:2px">
            <label class="checkline"><input type="checkbox" id="f-active" ${c.activeCheck ? 'checked' : ''}> 检测进程占用（推荐）</label>
            <label class="checkline"><input type="checkbox" id="f-report" ${c.includeReportOnly ? 'checked' : ''}> 纳入仅报告的 harness</label>
          </div>
        </div>
      </div>

      <h2 class="sec">扫描范围</h2>
      <div class="checkline" style="margin-bottom:8px">
        <label class="checkline"><input type="checkbox" id="f-all-harness" ${allSelected ? 'checked' : ''}> 全选</label>
        <span class="muted">${fmtNum(harnesses.length)} 个适用于当前平台的 harness</span>
      </div>
      <div class="harnessGrid">${harnessBoxes}</div>

      <div class="btn-row" style="margin-top:18px">
        <button class="btn primary" data-act="scan" ${state.job ? 'disabled' : ''}>
          ${state.job ? '<span class="spinner"></span> 扫描中…' : '开始扫描'}
        </button>
        <span class="muted">扫描为只读操作，不会改动任何文件</span>
      </div>
    </div>
    ${progress}
    ${overview}`;
}

/* ------------------------------ select step ------------------------------ */

function circleOptions() {
  const circles = state.ui ? state.ui.circles : {};
  const keys = ['safe', 'review', 'protected', 'keep'];
  return keys.map((k) => `<option value="${k}" ${state.filters.circle === k ? 'selected' : ''}>${esc(circles[k] ? circles[k].label : k)}</option>`).join('');
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
    const signals = `${u.orphan ? '<span class="pill orphan">孤儿</span>' : ''}${u.active ? '<span class="pill active">占用</span>' : ''}${!u.orphan && !u.active ? '<span class="muted">—</span>' : ''}`;
    return `<tr class="${checked ? 'selected' : ''}" data-id="${esc(u.id)}">
      <td class="cell-check"><input type="checkbox" data-select="${esc(u.id)}" ${checked ? 'checked' : ''} ${can ? '' : 'disabled'}></td>
      <td><span class="mono">${esc(u.harnessName)}</span>${u.deleteEnabled ? '' : '<span class="badge">仅报告</span>'}</td>
      <td>${esc(u.kind)}</td>
      <td class="num">${fmtBytes(u.sizeBytes)}</td>
      <td class="num">${u.ageMs === null ? '—' : fmtAge(u.ageMs)}</td>
      <td class="num">${u.score.toFixed(1)}</td>
      <td><span class="pill circle ${CIRCLE_CLASS[u.circle] || 'keep'}">${esc(u.circleReason || u.circle)}</span></td>
      <td>${signals}</td>
      <td class="path" title="${esc(u.path)}">${esc(u.displayPath)}</td>
    </tr>`;
  }).join('');

  const allSelectable = list.filter(selectable);
  const allChosen = allSelectable.length > 0 && allSelectable.every((u) => state.selection.has(u.id));

  viewEl.innerHTML = `
    <div class="toolbar">
      <div class="group">
        <div class="field"><label>圈层</label>
          <select id="fl-circle"><option value="all">全部</option>${circleOptions()}</select></div>
        <div class="field"><label>Harness</label>
          <select id="fl-harness"><option value="all">全部</option>${harnessFilterOptions()}</select></div>
        <div class="field"><label>类型</label>
          <select id="fl-kind"><option value="all">全部</option>${kindOptions()}</select></div>
        <div class="field"><label>最低评分</label>
          <input type="number" min="0" max="100" step="1" id="fl-score" value="${esc(state.filters.minScore)}"></div>
        <div class="field"><label>搜索</label>
          <input type="search" id="fl-search" value="${esc(state.filters.search)}" placeholder="路径或 harness"></div>
      </div>
      <div class="group">
        <button class="btn sm" data-act="sel-safe">全选安全圈</button>
        <button class="btn sm" data-act="sel-review">全选待确认</button>
        <button class="btn sm" data-act="sel-visible">全选当前结果</button>
        <button class="btn sm ghost" data-act="sel-clear">清空</button>
      </div>
    </div>

    <div class="muted" style="margin-bottom:8px;font-size:12px">
      显示 ${fmtNum(list.length)} / ${fmtNum(state.units.length)} 个单元 · 点击表头排序
    </div>

    <div class="tableWrap"><table>
      <thead><tr>
        <th class="cell-check"><input type="checkbox" id="fl-check-all" ${allChosen ? 'checked' : ''}></th>
        <th class="sortable" data-sort="harnessName">Harness${sortIndicator('harnessName')}</th>
        <th class="sortable" data-sort="kind">类型${sortIndicator('kind')}</th>
        <th class="num sortable" data-sort="sizeBytes">体积${sortIndicator('sizeBytes')}</th>
        <th class="num sortable" data-sort="ageMs">年龄${sortIndicator('ageMs')}</th>
        <th class="num sortable" data-sort="score">评分${sortIndicator('score')}</th>
        <th class="sortable" data-sort="circle">圈层${sortIndicator('circle')}</th>
        <th>信号</th>
        <th>路径</th>
      </tr></thead>
      <tbody>${rows || '<tr><td colspan="9" class="muted" style="padding:24px;text-align:center">没有符合筛选条件的单元</td></tr>'}</tbody>
    </table></div>`;

  renderSelbar();
}

function renderSelbar() {
  if (state.step !== 'select') { selbarEl.innerHTML = ''; return; }
  const s = selectionSummary();
  selbarEl.innerHTML = `
    <div class="selbar">
      <div class="info">已选 <b>${fmtNum(s.count)}</b> 个对象 · 合计 <b>${fmtBytes(s.bytes)}</b>
        <span class="muted">（安全圈 ${fmtNum(s.safe)} · 待确认 ${fmtNum(s.review)}）</span></div>
      <div class="btn-row">
        <button class="btn" data-act="sel-clear">清空</button>
        <button class="btn primary" data-act="to-plan" ${s.count === 0 ? 'disabled' : ''}>生成预演 →</button>
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
  if (!plan) { viewEl.innerHTML = '<div class="empty">尚未生成预演，请先在「勾选」中选择对象。</div>'; return; }

  const moved = dry ? dry.moved : plan.actions;
  const skipped = dry ? dry.skipped : [];

  const pruneRows = (plan.pruneRepos || []).map((r) => `<tr>
    <td class="path">${esc(r.repo)}</td><td class="num">${fmtNum(r.worktrees)}</td></tr>`).join('');

  const skippedBlock = skipped.length > 0 ? `
    <h2 class="sec">执行时被跳过的对象（${fmtNum(skipped.length)}）</h2>
    <div class="note warn"><p>以下对象在复核阶段被安全约束拦下，不会被处理：</p>
      <ul>${skipped.slice(0, 12).map((s) => `<li><span class="mono">${esc(s.path)}</span> — ${esc(s.reason)}</li>`).join('')}</ul>
      ${skipped.length > 12 ? `<p class="muted">…还有 ${fmtNum(skipped.length - 12)} 个</p>` : ''}
    </div>` : '';

  viewEl.innerHTML = `
    <div class="cards">
      <div class="card"><div class="k">待处理对象</div><div class="v">${fmtNum(plan.totals.actionCount)}</div></div>
      <div class="card"><div class="k">预计释放</div><div class="v pos">${fmtBytes(plan.totals.actionBytes)}</div></div>
      <div class="card"><div class="k">复核通过</div><div class="v">${fmtNum(moved.length)}</div></div>
      <div class="card"><div class="k">复核跳过</div><div class="v ${skipped.length ? 'warn' : ''}">${fmtNum(skipped.length)}</div></div>
      <div class="card"><div class="k">保护圈（未纳入）</div><div class="v neg">${fmtBytes(plan.skipped.protectedBytes)}</div></div>
    </div>

    <div class="note" style="margin-top:16px">
      <p><b>这是预演结果，未改动磁盘。</b>预演已按与真实执行相同的规则复核每个对象（安全硬约束 + 进程占用），
      因此「复核通过」的数量即为执行时真正会被处理的对象数。</p>
    </div>

    <h2 class="sec">复核通过 · 将被处理（${fmtNum(moved.length)}）</h2>
    <div class="tableWrap"><table>
      <thead><tr><th>Harness</th><th>类型</th><th class="num">体积</th><th class="num">年龄</th><th>路径</th></tr></thead>
      <tbody>${actionRows(moved, '没有可处理的对象')}</tbody>
    </table></div>

    ${skippedBlock}

    <h2 class="sec">连带动作 · git worktree prune（${fmtNum((plan.pruneRepos || []).length)} 个主仓库）</h2>
    <div class="tableWrap"><table>
      <thead><tr><th>主仓库</th><th class="num">关联工作树</th></tr></thead>
      <tbody>${pruneRows || '<tr><td colspan="2" class="muted" style="padding:20px;text-align:center">无需 prune</td></tr>'}</tbody>
    </table></div>

    <div class="btn-row" style="margin-top:20px">
      <button class="btn primary" data-act="to-execute" ${moved.length === 0 ? 'disabled' : ''}>确认并执行 →</button>
      <button class="btn" data-act="back-select">返回调整勾选</button>
    </div>`;
}

/* ------------------------------ execute step ------------------------------ */

function executeMode() { return state.mode || 'trash'; }

function renderExecute() {
  if (!state.plan) { viewEl.innerHTML = '<div class="empty">请先生成预演。</div>'; return; }

  if (state.report && !state.report.dryRun) { renderExecuteResult(); return; }

  const plan = state.plan;
  const moved = state.dryExecution ? state.dryExecution.moved.length : plan.totals.actionCount;
  const mode = executeMode();

  viewEl.innerHTML = `
    <div class="panel">
      <h2 class="sec" style="margin-top:0">执行方式</h2>
      <div class="form">
        <div class="field">
          <label>处理方式</label>
          <div style="display:flex;flex-direction:column;gap:8px;padding-top:2px">
            <label class="checkline"><input type="radio" name="mode" value="trash" ${mode === 'trash' ? 'checked' : ''}> 移入回收站（推荐，可还原）</label>
            <label class="checkline"><input type="radio" name="mode" value="direct" ${mode === 'direct' ? 'checked' : ''}> 直接删除（不可还原）</label>
          </div>
        </div>
        <div class="field">
          <label>连带动作</label>
          <div style="padding-top:2px">
            <label class="checkline"><input type="checkbox" id="f-prune" checked> 对关联主仓库执行 git worktree prune</label>
          </div>
        </div>
      </div>
    </div>

    <div class="note ${mode === 'direct' ? 'danger' : ''}" style="margin-top:16px">
      <p>即将处理 <b>${fmtNum(moved)}</b> 个对象，预计释放 <b>${fmtBytes(plan.totals.actionBytes)}</b>。</p>
      <ul>
        <li>处理前会对每个对象再次复核安全约束与进程占用，命中保护圈的对象自动跳过。</li>
        <li>${mode === 'trash' ? '对象将移入回收站，可在第 5 步「回收站」中还原。' : '直接删除不可还原，请确认已复核预演结果。'}</li>
      </ul>
    </div>

    ${mode === 'direct' ? `
      <div class="panel" style="margin-top:16px">
        <div class="field">
          <label>危险操作确认</label>
          <input type="text" id="f-confirmtext" placeholder="输入 DELETE 以启用直接删除">
          <span class="hint">直接删除不可恢复，必须输入大写 DELETE</span>
        </div>
      </div>` : ''}

    <div class="btn-row" style="margin-top:20px">
      <button class="btn ${mode === 'direct' ? 'danger' : 'primary'}" data-act="execute">${mode === 'direct' ? '直接删除' : '移入回收站'}</button>
      <button class="btn" data-act="back-plan">返回预演</button>
    </div>`;
}

function renderExecuteResult() {
  const r = state.report;
  const exec = state.execution;
  const failed = exec.failed || [];
  const pruned = exec.pruned || [];

  viewEl.innerHTML = `
    <div class="cards">
      <div class="card"><div class="k">已处理</div><div class="v pos">${fmtNum(r.moved)}</div></div>
      <div class="card"><div class="k">释放空间</div><div class="v pos">${fmtBytes(r.freedBytes)}</div></div>
      <div class="card"><div class="k">复核跳过</div><div class="v ${r.skipped ? 'warn' : ''}">${fmtNum(r.skipped)}</div></div>
      <div class="card"><div class="k">失败</div><div class="v ${r.failed ? 'neg' : ''}">${fmtNum(r.failed)}</div></div>
      <div class="card"><div class="k">prune 仓库</div><div class="v">${fmtNum(r.pruned)}</div></div>
    </div>

    <div class="note ${failed.length ? 'warn' : ''}" style="margin-top:16px">
      <p>${exec.dryRun ? '预演' : '执行'}完成，耗时 ${(exec.durationMs / 1000).toFixed(1)}s。
      ${r.batchId ? `批次 <span class="mono">${esc(r.batchId)}</span> 已写入回收站，可随时还原。` : ''}</p>
    </div>

    ${failed.length ? `
      <h2 class="sec">失败明细</h2>
      <div class="note danger"><ul>${failed.map((f) => `<li><span class="mono">${esc(f.path)}</span> — ${esc(f.reason)}</li>`).join('')}</ul></div>` : ''}

    ${pruned.length ? `
      <h2 class="sec">prune 结果</h2>
      <div class="tableWrap"><table>
        <thead><tr><th>主仓库</th><th>结果</th></tr></thead>
        <tbody>${pruned.map((p) => `<tr><td class="path">${esc(p.repo.repo || p.repo)}</td><td>${p.ok ? '<span class="pos">成功</span>' : `<span class="warn">${esc(p.output || '失败')}</span>`}</td></tr>`).join('')}</tbody>
      </table></div>` : ''}

    <div class="btn-row" style="margin-top:20px">
      <button class="btn primary" data-act="to-trash">前往回收站</button>
      <button class="btn" data-act="rescan">重新扫描</button>
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
  if (!manifest || !manifest.entries) return '<div class="muted">无条目</div>';
  return `<div class="tableWrap" style="max-height:40vh;margin-top:12px"><table>
    <thead><tr><th class="num">体积</th><th>原始路径</th></tr></thead>
    <tbody>${manifest.entries.map((e) => `<tr>
      <td class="num">${fmtBytes(e.sizeBytes)}</td>
      <td class="path" title="${esc(e.originalPath)}">${esc(e.originalPath)}</td>
    </tr>`).join('')}</tbody>
  </table></div>`;
}

function renderTrash() {
  const t = state.trash;
  if (!t) { viewEl.innerHTML = '<div class="empty">正在读取回收站…</div>'; return; }

  const batches = t.batches.map((b) => `
    <details class="batch" data-batch="${esc(b.id)}">
      <summary>
        <span><span class="mono">${esc(b.id)}</span>
          ${b.label ? `<span class="badge">${esc(b.label)}</span>` : ''}</span>
        <span class="muted">${b.createdAt ? fmtDate(b.createdAt) : '—'} ·
          ${b.entries === null ? '—' : `${fmtNum(b.entries)} 条`} ·
          ${b.freedBytes === null ? '—' : fmtBytes(b.freedBytes)}</span>
      </summary>
      <div class="batchBody">
        <div id="batch-body-${esc(b.id)}" class="muted">展开以读取清单…</div>
        <div class="btn-row" style="margin-top:12px">
          <button class="btn sm" data-act="restore-dry" data-batch="${esc(b.id)}">还原预演</button>
          <button class="btn sm primary" data-act="restore" data-batch="${esc(b.id)}">还原此批次</button>
        </div>
      </div>
    </details>`).join('');

  viewEl.innerHTML = `
    <div class="cards">
      <div class="card"><div class="k">批次</div><div class="v">${fmtNum(t.batchCount)}</div></div>
      <div class="card"><div class="k">累计释放</div><div class="v pos">${fmtBytes(t.freedBytes)}</div></div>
    </div>

    <h2 class="sec">批次列表</h2>
    ${batches || '<div class="empty">回收站为空。执行清理后，被移入的对象会出现在这里。</div>'}

    ${t.batchCount > 0 ? `
      <div class="btn-row" style="margin-top:20px">
        <button class="btn danger" data-act="empty">清空回收站（不可还原）</button>
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
      if (job.state === 'error') { toast(`扫描失败：${job.error}`, 'err'); render(); return; }
      state.scan = job.result;
      state.units = job.result.units;
      state.selection = new Set();
      state.plan = null; state.dryExecution = null; state.execution = null; state.report = null;
      toast(`扫描完成：${fmtNum(state.units.length)} 个候选单元`, 'ok');
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
  if (ids.length === 0) { toast('请先勾选要处理的对象', 'err'); return; }
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

  if (directDelete && confirmText !== 'DELETE') { toast('请输入 DELETE 以确认直接删除', 'err'); return; }

  const body = { actionIds: ids, dryRun: false, directDelete, prune, confirm: true };
  if (directDelete) body.confirmText = confirmText;

  const run = async () => {
    state.busy = 'execute';
    try {
      const res = await api('/api/execute', { method: 'POST', body });
      state.execution = res.execution;
      state.report = res.report;
      state.plan = res.plan;
      toast(directDelete ? `已删除 ${fmtNum(res.report.moved)} 个对象` : `已移入回收站 ${fmtNum(res.report.moved)} 个对象`, 'ok');
      state.selection = new Set();
      render();
      refreshTrash();
    } catch (err) { toast(err.message, 'err'); } finally { state.busy = null; }
  };

  if (directDelete) {
    openModal({
      title: '确认直接删除',
      bodyHtml: `<p>将<b>不可还原地</b>删除 ${fmtNum(state.plan.totals.actionCount)} 个对象，预计释放 ${fmtBytes(state.plan.totals.actionBytes)}。</p>
        <p class="muted" style="margin-top:8px">该操作无法通过回收站恢复。</p>`,
      confirmLabel: '直接删除',
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
        ? `还原预演：可还原 ${fmtNum(res.restored.length)} · 冲突 ${fmtNum(res.conflicts.length)} · 缺失 ${fmtNum(res.missing.length)}`
        : `已还原 ${fmtNum(res.restored.length)} 个对象${res.conflicts.length ? `，${fmtNum(res.conflicts.length)} 个目标已存在被跳过` : ''}`;
      toast(msg, dryRun ? '' : 'ok');
      if (!dryRun) refreshTrash();
    } catch (err) { toast(err.message, 'err'); }
  };
  if (dryRun) { await doIt(); return; }
  openModal({
    title: '确认还原批次',
    bodyHtml: `<p>将把批次 <span class="mono">${esc(batchId)}</span> 中的对象还原回原始路径。</p>
      <p class="muted" style="margin-top:8px">若原始路径已存在同名对象，将跳过该项以避免覆盖。</p>`,
    confirmLabel: '还原',
    onConfirm: doIt,
  });
}

function emptyTrash() {
  openModal({
    title: '清空回收站',
    bodyHtml: `<p>将<b>永久删除</b>回收站中的全部批次，此操作不可还原。</p>
      <div class="field" style="margin-top:12px">
        <label>仅清空超过 N 天的批次（留空表示全部）</label>
        <input type="number" min="0" step="1" id="f-keepdays" placeholder="例如 30">
      </div>`,
    confirmLabel: '清空',
    danger: true,
    onConfirm: async () => {
      const raw = document.getElementById('f-keepdays');
      const days = raw && raw.value.trim() !== '' ? Number(raw.value) : 0;
      const res = await api('/api/trash/empty', { method: 'POST', body: { confirm: true, olderThanDays: Number.isFinite(days) ? days : 0 } });
      toast(`已清空 ${fmtNum(res.removed.length)} 个批次`, 'ok');
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
    toast('报告已导出', 'ok');
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
  renderSidebar();
  renderTopActions();
  const step = STEPS.find((s) => s.id === state.step);
  titleEl.textContent = step ? step.label : '';
  subEl.textContent = step ? step.hint : '';

  if (state.step === 'scan') { selbarEl.innerHTML = ''; renderScan(); }
  else if (state.step === 'select') renderSelect();
  else if (state.step === 'plan') { selbarEl.innerHTML = ''; renderPlan(); }
  else if (state.step === 'execute') { selbarEl.innerHTML = ''; renderExecute(); }
  else if (state.step === 'trash') { selbarEl.innerHTML = ''; renderTrash(); }
}

/* ------------------------------ events ------------------------------ */

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
  const t = e.target;
  if (t.matches('[data-select]')) {
    const id = t.dataset.select;
    if (t.checked) state.selection.add(id); else state.selection.delete(id);
    const row = t.closest('tr');
    if (row) row.classList.toggle('selected', t.checked);
    renderSelbar();
    renderSidebar();
    renderTopActions();
    return;
  }
  if (t.id === 'fl-circle') { state.filters.circle = t.value; renderSelect(); }
  else if (t.id === 'fl-harness') { state.filters.harness = t.value; renderSelect(); }
  else if (t.id === 'fl-kind') { state.filters.kind = t.value; renderSelect(); }
  else if (t.id === 'fl-score') { state.filters.minScore = Number(t.value) || 0; renderSelect(); }
  else if (t.id === 'f-ttl') { state.config.globalTtlDays = t.value; }
  else if (t.id === 'f-size') { state.config.minSizeMB = t.value; }
  else if (t.id === 'f-score') { state.config.minScore = t.value; }
  else if (t.id === 'f-active') { state.config.activeCheck = t.checked; }
  else if (t.id === 'f-report') { state.config.includeReportOnly = t.checked; }
  else if (t.id === 'f-all-harness') {
    state.config.harnessIds = t.checked ? harnessOptions().map((h) => h.id) : [];
    renderScan();
  } else if (t.dataset && t.dataset.harness) {
    const id = t.dataset.harness;
    if (t.checked) { if (!state.config.harnessIds.includes(id)) state.config.harnessIds.push(id); }
    else state.config.harnessIds = state.config.harnessIds.filter((x) => x !== id);
  } else if (t.name === 'mode') {
    state.mode = t.value;
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

/* ------------------------------ init ------------------------------ */

async function init() {
  try {
    state.ui = await api('/api/state');
    state.config = defaultConfig();
    state.mode = 'trash';
  } catch (err) {
    viewEl.innerHTML = `<div class="note danger">初始化失败：${esc(err.message)}</div>`;
    return;
  }
  render();
  refreshTrash();
}

init();