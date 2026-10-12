import { formatBytes, formatAge, formatNumber, formatDate } from '../../lib/format.js';
import { CIRCLE_META } from '../../lib/strategy.js';
import { platformLabel } from '../../lib/platform.js';

export function escapeHtml(value) {
  return String(value === undefined || value === null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const CIRCLE_CLASS = { safe: 'c-safe', review: 'c-review', protected: 'c-protected', keep: 'c-keep' };

function stackedBar(byCircle, total) {
  const order = ['safe', 'review', 'protected', 'keep'];
  const safeTotal = total || 1;
  const segments = order
    .map((key) => {
      const bytes = byCircle[key] ? byCircle[key].bytes : 0;
      const pct = (bytes / safeTotal) * 100;
      if (pct <= 0) return '';
      const meta = CIRCLE_META[key];
      return `<span class="seg ${CIRCLE_CLASS[key]}" style="width:${pct.toFixed(3)}%" title="${escapeHtml(meta.label)} ${formatBytes(bytes)}"></span>`;
    })
    .join('');
  return `<div class="bar" role="img" aria-label="圈层体积分布">${segments}</div>`;
}

function legend(byCircle, total) {
  const order = ['safe', 'review', 'protected', 'keep'];
  return order
    .map((key) => {
      const bucket = byCircle[key] || { count: 0, bytes: 0 };
      const meta = CIRCLE_META[key];
      const pct = total ? ((bucket.bytes / total) * 100).toFixed(1) : '0.0';
      return `<li><span class="dot ${CIRCLE_CLASS[key]}"></span><b>${escapeHtml(meta.label)}</b>
        <span class="muted">${formatBytes(bucket.bytes)} · ${formatNumber(bucket.count)} 个 · ${pct}%</span></li>`;
    })
    .join('');
}

function harnessRows(summary) {
  return summary.byHarness
    .map(
      (row) => `<tr>
      <td><span class="hname">${escapeHtml(row.harnessName)}</span>${row.deleteEnabled ? '' : '<span class="badge">仅报告</span>'}</td>
      <td class="num">${formatNumber(row.count)}</td>
      <td class="num">${formatBytes(row.bytes)}</td>
      <td class="num pos">${formatBytes(row.safeBytes)}</td>
      <td class="num warn">${formatBytes(row.reviewBytes)}</td>
      <td class="num neg">${formatBytes(row.protectedBytes)}</td>
      <td class="num">${row.oldestMs ? formatAge(summary.now - row.oldestMs) : '—'}</td>
      <td class="num">${row.newestMs ? formatAge(summary.now - row.newestMs) : '—'}</td>
    </tr>`,
    )
    .join('');
}

function candidateRows(units, now) {
  if (!units || units.length === 0) {
    return '<tr><td colspan="7" class="muted">没有符合当前策略的单元</td></tr>';
  }
  return units
    .map(
      (unit) => `<tr>
      <td>${escapeHtml(unit.harnessName)}</td>
      <td>${escapeHtml(unit.kind)}</td>
      <td class="num">${formatBytes(unit.sizeBytes)}</td>
      <td class="num">${Number.isFinite(unit.ageDays) ? formatAge(unit.ageMs) : '—'}</td>
      <td class="num">${unit.score.toFixed(1)}</td>
      <td>${unit.orphan ? '<span class="pill orphan">孤儿</span>' : ''}${unit.active ? '<span class="pill active">占用</span>' : ''}${!unit.orphan && !unit.active ? '<span class="muted">—</span>' : ''}</td>
      <td class="path" title="${escapeHtml(unit.path)}">${escapeHtml(unit.displayPath)}</td>
    </tr>`,
    )
    .join('');
}

function protectedRows(units) {
  const byReason = new Map();
  for (const unit of units) {
    const key = unit.protectedReason || unit.circleReason;
    if (!byReason.has(key)) byReason.set(key, { count: 0, bytes: 0, samples: [] });
    const row = byReason.get(key);
    row.count += 1;
    row.bytes += unit.sizeBytes;
    if (row.samples.length < 3) row.samples.push(unit.displayPath);
  }
  return [...byReason.entries()]
    .sort((a, b) => b[1].bytes - a[1].bytes)
    .map(
      ([reason, row]) => `<tr>
      <td><code>${escapeHtml(reason)}</code></td>
      <td class="num">${formatNumber(row.count)}</td>
      <td class="num">${formatBytes(row.bytes)}</td>
      <td class="path">${row.samples.map((s) => escapeHtml(s)).join('<br>')}</td>
    </tr>`,
    )
    .join('');
}

export function renderHtmlReport({ scan, summary, plan, execution = null, options = {} } = {}) {
  const now = summary ? summary.now : Date.now();
  const totals = summary ? summary.totals : { unitCount: 0, totalBytes: 0, reclaimableBytes: 0 };
  const byCircle = summary ? summary.byCircle : { safe: { count: 0, bytes: 0 }, review: { count: 0, bytes: 0 }, protected: { count: 0, bytes: 0 }, keep: { count: 0, bytes: 0 } };

  const safeUnits = summary ? summary.byCircle.safe.items.sort((a, b) => b.sizeBytes - a.sizeBytes) : [];
  const reviewUnits = summary ? summary.byCircle.review.items.sort((a, b) => b.sizeBytes - a.sizeBytes) : [];
  const protectedUnits = summary ? summary.byCircle.protected.items.sort((a, b) => b.sizeBytes - a.sizeBytes) : [];

  const title = 'agent-sweep 残留工作区清理报告';

  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>
  :root{
    --bg:#f6f8fb; --surface:#ffffff; --ink:#141a24; --ink-2:#3d4757; --muted:#6b7688;
    --line:#e2e7ef; --accent:#1f4fd8; --accent-soft:#eaf0ff;
    --safe:#1f7a4d; --review:#b5731a; --protected:#b3261e; --keep:#5f6368;
  }
  *{box-sizing:border-box}
  html,body{margin:0;padding:0}
  body{background:var(--bg);color:var(--ink);
    font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Hiragino Sans GB","Microsoft YaHei",Roboto,Helvetica,Arial,sans-serif;
    line-height:1.6;-webkit-font-smoothing:antialiased}
  .wrap{max-width:1080px;margin:0 auto;padding:40px 24px 80px}
  header.top{display:flex;flex-wrap:wrap;gap:16px;align-items:flex-end;justify-content:space-between;
    padding-bottom:20px;border-bottom:2px solid var(--ink)}
  h1{font-size:26px;margin:0;letter-spacing:-.01em}
  .sub{color:var(--muted);font-size:13px;margin-top:6px}
  .brand{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:13px;color:var(--accent);
    background:var(--accent-soft);border:1px solid #cfdcff;border-radius:6px;padding:6px 10px}
  h2{font-size:17px;margin:40px 0 12px;padding-left:10px;border-left:3px solid var(--accent)}
  .cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:14px;margin-top:24px}
  .card{background:var(--surface);border:1px solid var(--line);border-radius:10px;padding:16px 18px}
  .card .k{font-size:12px;color:var(--muted);letter-spacing:.02em}
  .card .v{font-size:22px;font-weight:700;margin-top:6px;font-variant-numeric:tabular-nums}
  .card .v.pos{color:var(--safe)} .card .v.warn{color:var(--review)} .card .v.neg{color:var(--protected)}
  .bar{display:flex;height:16px;border-radius:8px;overflow:hidden;background:#eef1f6;border:1px solid var(--line)}
  .seg{display:block;height:100%}
  .seg.c-safe{background:var(--safe)} .seg.c-review{background:var(--review)}
  .seg.c-protected{background:var(--protected)} .seg.c-keep{background:var(--keep)}
  ul.legend{list-style:none;margin:14px 0 0;padding:0;display:flex;flex-wrap:wrap;gap:18px}
  ul.legend li{display:flex;align-items:center;gap:8px;font-size:13px}
  .dot{width:10px;height:10px;border-radius:3px;display:inline-block}
  .dot.c-safe{background:var(--safe)} .dot.c-review{background:var(--review)}
  .dot.c-protected{background:var(--protected)} .dot.c-keep{background:var(--keep)}
  .muted{color:var(--muted)}
  table{width:100%;border-collapse:collapse;background:var(--surface);border:1px solid var(--line);
    border-radius:10px;overflow:hidden;font-size:13px}
  th,td{padding:10px 12px;text-align:left;border-bottom:1px solid var(--line);vertical-align:top}
  th{background:#f0f3f9;font-size:12px;color:var(--ink-2);font-weight:600;white-space:nowrap}
  tr:last-child td{border-bottom:none}
  td.num,th.num{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}
  td.pos{color:var(--safe)} td.warn{color:var(--review)} td.neg{color:var(--protected)}
  td.path{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:12px;color:var(--ink-2);word-break:break-all}
  .hname{font-weight:600}
  .badge{margin-left:8px;font-size:11px;color:var(--muted);border:1px solid var(--line);border-radius:999px;padding:1px 8px}
  .pill{display:inline-block;font-size:11px;border-radius:999px;padding:1px 8px;margin-right:4px}
  .pill.orphan{background:#fdeceb;color:var(--protected);border:1px solid #f5c6c2}
  .pill.active{background:#fff4e5;color:var(--review);border:1px solid #f0d8ae}
  .note{background:var(--surface);border:1px solid var(--line);border-left:3px solid var(--accent);
    border-radius:8px;padding:14px 16px;font-size:13px;color:var(--ink-2)}
  .note ul{margin:8px 0 0;padding-left:20px}
  .note li{margin:4px 0}
  footer{margin-top:48px;padding-top:18px;border-top:1px solid var(--line);color:var(--muted);font-size:12px}
  code{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;background:#f0f3f9;border-radius:4px;padding:1px 6px;font-size:12px}
  @media (max-width:720px){
    .wrap{padding:24px 14px 60px}
    table{font-size:12px} th,td{padding:8px}
  }
  @media print{body{background:#fff} .card,table{break-inside:avoid}}
</style>
</head>
<body>
<div class="wrap">
  <header class="top">
    <div>
      <h1>${escapeHtml(title)}</h1>
      <div class="sub">生成于 ${escapeHtml(formatDate(now))} · 平台 ${escapeHtml(platformLabel(scan ? scan.platform : process.platform))} · 只读扫描，未改动磁盘</div>
    </div>
    <div class="brand">agent-sweep · P0 report</div>
  </header>

  <div class="cards">
    <div class="card"><div class="k">候选单元</div><div class="v">${formatNumber(totals.unitCount)}</div></div>
    <div class="card"><div class="k">扫描总体积</div><div class="v">${formatBytes(totals.totalBytes)}</div></div>
    <div class="card"><div class="k">可回收总量</div><div class="v pos">${formatBytes(totals.reclaimableBytes)}</div></div>
    <div class="card"><div class="k">安全圈（免确认）</div><div class="v pos">${formatBytes(byCircle.safe.bytes)}</div></div>
    <div class="card"><div class="k">待确认圈</div><div class="v warn">${formatBytes(byCircle.review.bytes)}</div></div>
    <div class="card"><div class="k">永不清理</div><div class="v neg">${formatBytes(byCircle.protected.bytes)}</div></div>
  </div>

  <h2>圈层体积分布</h2>
  ${stackedBar(byCircle, totals.totalBytes)}
  <ul class="legend">${legend(byCircle, totals.totalBytes)}</ul>

  <h2>按 Harness 汇总</h2>
  <table>
    <thead><tr>
      <th>Harness</th><th class="num">单元</th><th class="num">合计</th>
      <th class="num">安全圈</th><th class="num">待确认</th><th class="num">保护</th>
      <th class="num">最旧</th><th class="num">最新</th>
    </tr></thead>
    <tbody>${harnessRows(summary)}</tbody>
  </table>

  <h2>第 1 圈 · 可安全清理</h2>
  <table>
    <thead><tr><th>Harness</th><th>类型</th><th class="num">体积</th><th class="num">年龄</th><th class="num">评分</th><th>信号</th><th>路径</th></tr></thead>
    <tbody>${candidateRows(safeUnits, now)}</tbody>
  </table>

  <h2>第 2 圈 · 需确认后清理</h2>
  <table>
    <thead><tr><th>Harness</th><th>类型</th><th class="num">体积</th><th class="num">年龄</th><th class="num">评分</th><th>信号</th><th>路径</th></tr></thead>
    <tbody>${candidateRows(reviewUnits, now)}</tbody>
  </table>

  <h2>第 3 圈 · 永不清理</h2>
  <table>
    <thead><tr><th>保护原因</th><th class="num">数量</th><th class="num">体积</th><th>样例</th></tr></thead>
    <tbody>${protectedRows(protectedUnits)}</tbody>
  </table>

  <h2>判定方法</h2>
  <div class="note">
    <p style="margin:0">年龄取子树内叶子文件的最大修改时间，而非目录自身 mtime；再叠加孤儿、进程占用与体积三个信号，按体积加权评分排序。</p>
    <ul>
      <li><b>进程占用是硬性否决项</b>：命中即落入第 3 圈，任何情况下不自动清理。</li>
      <li><b>孤儿判定</b>：worktree 指向的主仓库已消失，或会话目录对应的宿主项目已删除。</li>
      <li><b>可还原</b>：默认移入回收站，附带还原清单；直接删除需显式参数。</li>
      <li><b>连带动作</b>：删除 worktree 后对主仓库执行 <code>git worktree prune</code>，避免制造新的注册表残留。</li>
    </ul>
  </div>

  <footer>
    ${escapeHtml(title)} · 由 agent-sweep 生成 · 本报告为零外部依赖的自包含 HTML。
    ${execution ? `· 执行批次 ${escapeHtml(execution.batchId || 'dry-run')}，释放 ${formatBytes(execution.freedBytes || 0)}。` : '· 本报告为只读扫描结果，未执行任何删除。'}
  </footer>
</div>
</body>
</html>`;
}