import path from 'node:path';
import { lstatSafe, removeEmptyDirs, exists, removePath } from '../lib/fsx.js';
import { evaluateProtection } from '../safety/guards.js';
import { detectActive } from '../lib/process.js';
import { pruneWorktrees } from '../lib/gitworktree.js';
import { CIRCLES } from '../lib/strategy.js';

export async function verifyAction(action, { guardSet, openFiles, home } = {}) {
  const st = await lstatSafe(action.path);
  if (!st) return { ok: false, reason: 'missing' };
  if (guardSet) {
    const protection = await evaluateProtection(action.path, guardSet, { home });
    if (protection.protected) return { ok: false, reason: `protected:${protection.reason}` };
  }
  const active = await detectActive(action.path, { openFiles, lockFiles: [] });
  if (active.active) return { ok: false, reason: `in-use:${active.reason}` };
  return { ok: true };
}

export async function executePlan(plan, options = {}) {
  const {
    trash,
    dryRun = false,
    prune = true,
    guardSet,
    openFiles,
    home,
    onProgress = null,
  } = options;

  const startedAt = Date.now();
  const report = {
    schema: 'agent-sweep/execution@1',
    batchId: null,
    dryRun,
    planned: plan.actions.length,
    moved: [],
    skipped: [],
    failed: [],
    pruned: [],
    freedBytes: 0,
    durationMs: 0,
  };

  const verified = [];
  for (const action of plan.actions) {
    const check = await verifyAction(action, { guardSet, openFiles, home });
    if (check.ok) {
      verified.push(action);
    } else {
      report.skipped.push({ id: action.id, path: action.displayPath || action.path, reason: check.reason });
    }
  }

  if (dryRun) {
    report.moved = verified.map((action) => ({
      id: action.id,
      path: action.displayPath || action.path,
      sizeBytes: action.sizeBytes,
      trashPath: null,
      dryRun: true,
    }));
    report.freedBytes = verified.reduce((sum, a) => sum + (a.sizeBytes || 0), 0);
    report.prunePlan = plan.pruneRepos || [];
    report.durationMs = Date.now() - startedAt;
    report.dryRun = true;
    return report;
  }

  if (verified.length === 0) {
    report.durationMs = Date.now() - startedAt;
    return report;
  }

  const directDelete = Boolean(options.directDelete);
  const batch = directDelete ? null : await (async () => {
    await trash.init();
    const created = await trash.createBatch({ label: plan.options ? `scan-${plan.generatedAt}` : null });
    report.batchId = created.id;
    return created;
  })();

  let index = 0;
  for (const action of verified) {
    index += 1;
    try {
      if (directDelete) {
        await removePath(action.path);
        report.moved.push({ id: action.id, path: action.displayPath || action.path, sizeBytes: action.sizeBytes, trashPath: null });
      } else {
        const entry = await trash.addEntry(batch, action, index);
        report.moved.push({ id: action.id, path: action.displayPath || action.path, sizeBytes: action.sizeBytes, trashPath: entry.trashPath });
      }
      report.freedBytes += action.sizeBytes || 0;
      if (action.root && action.isDir) {
        await removeEmptyDirs(path.dirname(action.path), action.root).catch(() => {});
      }
      if (onProgress) onProgress({ phase: 'move', action, index, total: verified.length });
    } catch (err) {
      report.failed.push({ id: action.id, path: action.displayPath || action.path, reason: err && err.message ? err.message : String(err) });
      if (batch) batch.stats.failed += 1;
    }
  }

  if (prune && plan.pruneRepos && plan.pruneRepos.length > 0) {
    for (const repo of plan.pruneRepos) {
      if (!(await exists(repo.repo))) continue;
      const result = await pruneWorktrees(repo.repo);
      report.pruned.push({ repo, ok: result.ok, output: result.output || result.reason || '' });
      if (result.ok && batch) batch.prunedRepos.push({ repo: repo.repo, worktrees: repo.worktrees });
    }
  }

  if (batch) await trash.writeManifest(batch);
  report.durationMs = Date.now() - startedAt;
  return report;
}

export function actionableBytes(plan) {
  return plan.actions.filter((a) => a.circle === CIRCLES.SAFE || a.circle === CIRCLES.REVIEW).reduce((sum, a) => sum + (a.sizeBytes || 0), 0);
}