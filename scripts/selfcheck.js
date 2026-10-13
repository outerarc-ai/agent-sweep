#!/usr/bin/env node
// End-to-end self check: builds a synthetic harness home in a temp directory,
// runs the full read-only pipeline plus a reversible clean/restore round trip,
// and asserts the safety invariants. Never touches the real user home.
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { loadRegistry, buildRegistryGuards } from '../src/core/registry.js';
import { scan, encodeCwd } from '../src/core/scanner.js';
import { analyzeUnits, summarize } from '../src/core/analyzer.js';
import { buildPlan } from '../src/core/planner.js';
import { executePlan } from '../src/core/executor.js';
import { createTrash } from '../src/core/trash.js';
import { resolveStrategy, CIRCLES } from '../src/lib/strategy.js';
import { evaluateProtection } from '../src/safety/guards.js';

const DAY = 86400000;
const results = [];

function check(label, condition, detail = '') {
  results.push({ label, ok: Boolean(condition), detail });
}

async function writeOld(file, days, content = 'x') {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, content);
  const when = new Date(Date.now() - days * DAY);
  await fs.utimes(file, when, when);
}

async function buildFixture(home) {
  await writeOld(path.join(home, '.trae-cn', 'work', 'sess-1', 'out.txt'), 40);
  await writeOld(path.join(home, '.trae-cn', 'work', 'sess-2', 'out.txt'), 40);
  const activeFile = path.join(home, '.trae-cn', 'work', 'sess-active', 'out.txt');
  await writeOld(activeFile, 40);

  const orphanWt = path.join(home, '.trae-cn', 'worktrees', 'proj', 'orphan-branch');
  await fs.mkdir(orphanWt, { recursive: true });
  await writeOld(path.join(orphanWt, '.git'), 40, `gitdir: ${path.join(home, 'gone-repo', '.git', 'worktrees', 'orphan-branch')}\n`);
  await writeOld(path.join(orphanWt, 'work.txt'), 40);

  const liveWt = path.join(home, '.trae-cn', 'worktrees', 'proj', 'live-branch');
  await fs.mkdir(path.join(home, 'main-repo', '.git', 'worktrees', 'live-branch'), { recursive: true });
  await fs.mkdir(liveWt, { recursive: true });
  await writeOld(path.join(liveWt, '.git'), 40, `gitdir: ${path.join(home, 'main-repo', '.git', 'worktrees', 'live-branch')}\n`);
  await writeOld(path.join(liveWt, 'work.txt'), 40);

  // A session whose transcript records a host project that no longer exists is
  // a proven orphan; one without transcript evidence cannot be proven either way.
  const goneHost = path.join(home, 'gone_host.project');
  await writeOld(
    path.join(home, '.claude', 'projects', encodeCwd(goneHost), 'session.jsonl'),
    40,
    `${JSON.stringify({ type: 'user', cwd: goneHost })}\n`,
  );
  await writeOld(path.join(home, '.claude', 'projects', '-no-such-host-zzz', 'session.jsonl'), 40);
  await writeOld(path.join(home, '.claude', 'projects', '-tmp-x', 'session.jsonl'), 40);
  await writeOld(path.join(home, '.claude', 'projects', '-tmp-x', 'memory', 'note.md'), 40);
  await writeOld(path.join(home, '.claude', 'plugins', 'foo', 'index.js'), 40);

  return { orphanWt, liveWt, activeFile, goneHost };
}

async function main() {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), 'sweep-selfcheck-home-'));
  const trashRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'sweep-selfcheck-trash-'));
  const previousHome = process.env.AGENT_SWEEP_HOME_DIR;
  process.env.AGENT_SWEEP_HOME_DIR = home;

  try {
    const fixture = await buildFixture(home);

    const registry = loadRegistry();
    check('注册表加载', registry.harnesses.length >= 8, `${registry.harnesses.length} 条声明`);
    const guardSet = buildRegistryGuards(registry);
    check('护栏构建', guardSet.entries.length > 0, `${guardSet.entries.length} 条硬约束`);

    const openFiles = {
      supported: true,
      paths: [fixture.activeFile],
      byPath: new Map([[fixture.activeFile, { pid: 4242, command: 'trae' }]]),
    };
    const strategy = resolveStrategy({ minSizeBytes: 0, enforceMinSize: false });

    const scanResult = await scan(registry, {
      home,
      guardSet,
      openFiles,
      harnessIds: ['trae', 'claude-code'],
      ttlOverrides: {},
      globalTtl: null,
      concurrency: 4,
      platform: process.platform,
    });
    const units = analyzeUnits(scanResult.units, { now: Date.now(), strategy });
    const summary = summarize(units, { now: Date.now() });

    check('扫描到全部合成单元', units.length === 8, `${units.length} 个单元`);

    const byRel = (needle) => units.find((u) => u.path.endsWith(needle));
    const orphan = byRel('orphan-branch');
    const live = byRel('live-branch');
    const protectedDir = byRel('-tmp-x');
    const activeUnit = byRel('sess-active');

    check('孤儿工作树判为安全圈', orphan && orphan.orphan === true && orphan.circle === CIRCLES.SAFE, orphan ? orphan.circleReason : 'missing');
    check('活跃工作树未被判为孤儿', live && live.orphan === false);
    check('含 memory 的会话目录落入保护圈', protectedDir && protectedDir.circle === CIRCLES.PROTECTED, protectedDir ? protectedDir.protectedReason : 'missing');
    check('进程占用单元落入保护圈', activeUnit && activeUnit.active === true && activeUnit.circle === CIRCLES.PROTECTED, activeUnit ? activeUnit.circleReason : 'missing');

    check('安全圈计数正确', summary.byCircle.safe.count === 2, `${summary.byCircle.safe.count} / 期望 2`);
    check('待确认圈计数正确', summary.byCircle.review.count === 4, `${summary.byCircle.review.count} / 期望 4`);
    check('保护圈计数正确', summary.byCircle.protected.count === 2, String(summary.byCircle.protected.count));
    const goneHostUnit = byRel(encodeCwd(fixture.goneHost));
    check(
      '会话记录证实宿主项目已删除时判为孤儿',
      Boolean(goneHostUnit) && goneHostUnit.orphan === true && goneHostUnit.circle === CIRCLES.SAFE,
      goneHostUnit ? goneHostUnit.circle : 'missing',
    );
    const unresolvedHost = byRel('-no-such-host-zzz');
    check(
      '无法证实宿主项目缺失的会话不判孤儿',
      Boolean(unresolvedHost) && unresolvedHost.orphan === false && unresolvedHost.circle === CIRCLES.REVIEW,
      unresolvedHost ? unresolvedHost.circle : 'missing',
    );

    const plan = buildPlan(units, {
      summary,
      now: summary.now,
      platform: scanResult.platform,
      options: { circles: [CIRCLES.SAFE, CIRCLES.REVIEW], harnessIds: ['trae', 'claude-code'] },
    });
    const actionCircles = new Set(plan.actions.map((a) => a.circle));
    check('计划包含安全圈与待确认圈动作', plan.totals.actionCount === 6, String(plan.totals.actionCount));
    check('计划从不包含保护圈对象', !actionCircles.has(CIRCLES.PROTECTED));

    const dryRun = await executePlan(plan, { dryRun: true, guardSet, openFiles, home });
    check('预演不写盘', dryRun.dryRun === true && dryRun.batchId === null);
    check('预演通过复检全部动作', dryRun.moved.length === plan.totals.actionCount, `${dryRun.moved.length}/${plan.totals.actionCount}`);
    check('预演后源目录仍在', await fs.stat(fixture.orphanWt).then(() => true, () => false));

    const trash = createTrash({ root: trashRoot });
    const execution = await executePlan(plan, { trash, guardSet, openFiles, home });
    check('执行移入回收站', execution.moved.length === plan.totals.actionCount && Boolean(execution.batchId), execution.batchId || 'no-batch');
    check('执行后源目录已移走', !(await fs.stat(fixture.orphanWt).then(() => true, () => false)));

    const manifest = await trash.readManifest(execution.batchId);
    check('回收站清单条目匹配', manifest.entries.length === execution.moved.length, `${manifest.entries.length} 条`);

    const restored = await trash.restore(execution.batchId);
    check('可还原全部条目', restored.restored.length === execution.moved.length, `${restored.restored.length} 个`);
    check('还原后源目录回归', await fs.stat(fixture.orphanWt).then(() => true, () => false));

    const pluginGuard = await evaluateProtection(path.join(home, '.claude', 'plugins', 'foo', 'index.js'), guardSet, { home });
    check('插件目录受硬约束保护', pluginGuard.protected === true, pluginGuard.reason || 'not-protected');
    const memoryGuard = await evaluateProtection(path.join(home, '.claude', 'projects', '-tmp-x', 'memory', 'note.md'), guardSet, { home });
    check('记忆文件受硬约束保护', memoryGuard.protected === true, memoryGuard.reason || 'not-protected');
  } finally {
    if (previousHome === undefined) delete process.env.AGENT_SWEEP_HOME_DIR;
    else process.env.AGENT_SWEEP_HOME_DIR = previousHome;
    await fs.rm(home, { recursive: true, force: true });
    await fs.rm(trashRoot, { recursive: true, force: true });
  }

  const failed = results.filter((r) => !r.ok);
  process.stdout.write('agent-sweep selfcheck\n');
  for (const result of results) {
    process.stdout.write(`  ${result.ok ? '✓' : '✗'} ${result.label}${result.detail ? `  (${result.detail})` : ''}\n`);
  }
  process.stdout.write(`\n${results.length - failed.length}/${results.length} checks passed\n`);
  if (failed.length > 0) process.exitCode = 1;
}

main().catch((err) => {
  process.stderr.write(`selfcheck failed: ${err && err.stack ? err.stack : String(err)}\n`);
  process.exitCode = 1;
});