import { renderTable, formatBytes, formatAge, formatNumber, formatPercent, truncateWide } from '../../lib/format.js';
import { CIRCLE_META } from '../../lib/strategy.js';
import { platformLabel } from '../../lib/platform.js';

function circleTag(circle, paint) {
  const meta = CIRCLE_META[circle];
  const label = meta ? meta.label : circle;
  if (circle === 'safe') return paint('green', `[1] ${label}`);
  if (circle === 'review') return paint('yellow', `[2] ${label}`);
  if (circle === 'protected') return paint('red', `[3] ${label}`);
  return paint('gray', `[0] ${label}`);
}

export function renderScanSummary(scan, summary, { paint = (x) => x } = {}) {
  const lines = [];
  lines.push('');
  lines.push(paint('bold', '扫描概览'));
  lines.push(
    `  平台 ${platformLabel(scan.platform)} · harness ${scan.stats.harnessCount} 个 · 候选单元 ${formatNumber(scan.stats.unitCount)} 个 · 合计 ${formatBytes(scan.stats.totalBytes)}`,
  );
  lines.push(
    `  可回收 ${formatBytes(summary.totals.reclaimableBytes)}（安全圈 ${formatBytes(summary.byCircle.safe.bytes)} · 待确认圈 ${formatBytes(summary.byCircle.review.bytes)}）· 保护 ${formatBytes(summary.byCircle.protected.bytes)}`,
  );
  lines.push('');

  const rows = summary.byHarness.map((row) => [
    row.harnessName + (row.deleteEnabled ? '' : ' (仅报告)'),
    formatNumber(row.count),
    formatBytes(row.bytes),
    formatBytes(row.safeBytes),
    formatBytes(row.reviewBytes),
    formatBytes(row.protectedBytes),
    row.oldestMs ? formatAge(summary.now - row.oldestMs) : '—',
    row.newestMs ? formatAge(summary.now - row.newestMs) : '—',
  ]);

  lines.push(
    renderTable(
      ['Harness', '单元', '合计', '安全圈', '待确认', '保护', '最旧', '最新'],
      rows,
      { align: ['left', 'right', 'right', 'right', 'right', 'right', 'right', 'right'] },
    ),
  );
  return lines.join('\n');
}

export function renderTopCandidates(summary, { paint = (x) => x, limit = 15, home } = {}) {
  const lines = [];
  lines.push('');
  lines.push(paint('bold', `体积优先候选 Top ${limit}`));
  const rows = summary.topCandidates.slice(0, limit).map((unit) => [
    circleTag(unit.circle, paint),
    unit.harnessName,
    unit.kind,
    formatBytes(unit.sizeBytes),
    Number.isFinite(unit.ageDays) ? formatAge(unit.ageMs) : '—',
    unit.orphan ? '孤儿' : '—',
    unit.active ? '占用' : '—',
    truncateWide(unit.displayPath, 46),
  ]);
  lines.push(
    renderTable(['圈层', 'Harness', '类型', '体积', '年龄', '孤儿', '活跃', '路径'], rows, {
      align: ['left', 'left', 'left', 'right', 'right', 'center', 'center', 'left'],
    }),
  );
  return lines.join('\n');
}

export function renderPlan(plan, { paint = (x) => x, home } = {}) {
  const lines = [];
  lines.push('');
  lines.push(paint('bold', '清理计划'));
  lines.push(
    `  计划动作 ${formatNumber(plan.totals.actionCount)} 个 · 预计释放 ${formatBytes(plan.totals.actionBytes)} · 跳过保护 ${plan.skipped.protected} 个 · 跳过保留 ${plan.skipped.keep} 个`,
  );
  if (plan.pruneRepos.length > 0) {
    lines.push(`  执行后将 prune ${plan.pruneRepos.length} 个主仓库的 worktree 注册表`);
  }
  lines.push('');

  const rows = plan.actions.slice(0, 40).map((action) => [
    circleTag(action.circle, paint),
    action.harnessName,
    action.kind,
    formatBytes(action.sizeBytes),
    action.ageDays === null ? '—' : `${action.ageDays}d`,
    action.orphan ? '孤儿' : '—',
    action.circleReason,
    truncateWide(action.displayPath, 44),
  ]);
  if (rows.length === 0) {
    lines.push('  （没有符合当前策略的可执行动作）');
  } else {
    lines.push(
      renderTable(['圈层', 'Harness', '类型', '体积', '年龄', '孤儿', '判定依据', '路径'], rows, {
        align: ['left', 'left', 'left', 'right', 'right', 'center', 'left', 'left'],
      }),
    );
    if (plan.actions.length > rows.length) {
      lines.push(paint('gray', `  … 其余 ${plan.actions.length - rows.length} 个动作已省略，使用 --json 查看完整清单`));
    }
  }
  return lines.join('\n');
}

export function renderExecution(report, { paint = (x) => x } = {}) {
  const lines = [];
  lines.push('');
  lines.push(paint('bold', report.dryRun ? '执行预演（未改动磁盘）' : '执行结果'));
  if (report.dryRun) {
    lines.push(`  通过复检 ${report.moved.length} 个 · 计划释放 ${formatBytes(report.freedBytes)}`);
    if (report.prunePlan && report.prunePlan.length > 0) {
      lines.push(`  将 prune ${report.prunePlan.length} 个主仓库的 worktree 注册表`);
    }
  } else {
    lines.push(`  回收站批次 ${report.batchId} · 已移动 ${report.moved.length} 个 · 释放 ${formatBytes(report.freedBytes)} · 耗时 ${(report.durationMs / 1000).toFixed(1)}s`);
  }
  if (report.skipped.length > 0) {
    lines.push('');
    lines.push(paint('yellow', `  跳过 ${report.skipped.length} 个（复检不通过）`));
    for (const item of report.skipped.slice(0, 10)) {
      lines.push(`    · ${item.reason}  ${truncateWide(item.path, 60)}`);
    }
  }
  if (report.failed.length > 0) {
    lines.push('');
    lines.push(paint('red', `  失败 ${report.failed.length} 个`));
    for (const item of report.failed.slice(0, 10)) {
      lines.push(`    · ${item.reason}  ${truncateWide(item.path, 60)}`);
    }
  }
  if (report.pruned.length > 0) {
    lines.push('');
    lines.push('  worktree prune:');
    for (const item of report.pruned) {
      lines.push(`    ${item.ok ? paint('green', '✓') : paint('red', '✗')} ${item.repo.repo}${item.output ? `  ${item.output.split('\n')[0]}` : ''}`);
    }
  }
  if (!report.dryRun && report.batchId) {
    lines.push('');
    lines.push(paint('gray', `  还原命令: agent-sweep restore ${report.batchId}`));
  }
  return lines.join('\n');
}

export function renderHarnessList(harnesses, { paint = (x) => x } = {}) {
  const lines = [];
  lines.push('');
  const rows = harnesses.map((h) => [
    h.id,
    h.name,
    h.vendor || '—',
    h.kind,
    h.deleteEnabled ? paint('green', '可清理') : paint('gray', '仅报告'),
    `${h.defaultTTL}d`,
    h.risk,
    String(h.targets.length),
  ]);
  lines.push(
    renderTable(['ID', '名称', '厂商', '形态', '权限', 'TTL', '风险', '目标数'], rows, {
      align: ['left', 'left', 'left', 'left', 'left', 'right', 'left', 'right'],
    }),
  );
  return lines.join('\n');
}

export function renderDoctor(checks, { paint = (x) => x } = {}) {
  const lines = [];
  lines.push('');
  lines.push(paint('bold', '环境自检'));
  for (const check of checks) {
    const mark = check.ok ? paint('green', '✓') : check.warn ? paint('yellow', '!') : paint('red', '✗');
    lines.push(`  ${mark} ${check.label}${check.detail ? paint('gray', `  ${check.detail}`) : ''}`);
  }
  return lines.join('\n');
}

export function renderBytesPercent(part, total) {
  if (!total) return '0%';
  return formatPercent(part / total);
}