import { test } from 'node:test';
import assert from 'node:assert/strict';
import { analyzeUnit, analyzeUnits, summarize } from '../src/core/analyzer.js';
import { resolveStrategy, CIRCLES } from '../src/lib/strategy.js';

const DAY = 86400000;

function raw(overrides = {}) {
  return {
    harnessId: 'trae',
    harnessName: 'Trae',
    targetId: 'worktrees',
    kind: 'worktree',
    risk: 'medium',
    ttlDays: 30,
    deleteEnabled: true,
    removable: true,
    sizeBytes: 200 * 1024 * 1024,
    fileCount: 10,
    dirCount: 2,
    symlinkCount: 0,
    leafMaxMtimeMs: 0,
    dirMtimeMs: 0,
    orphan: true,
    orphanReason: 'main-repo-missing',
    active: false,
    protected: false,
    relPath: 'p/b',
    displayPath: '~/.trae-cn/worktrees/p/b',
    path: '/h/.trae-cn/worktrees/p/b',
    root: '/h/.trae-cn/worktrees',
    isDir: true,
    ...overrides,
  };
}

test('analyzeUnit derives age from leaf mtime, falling back to dir mtime', () => {
  const now = 100 * DAY;
  const withLeaf = analyzeUnit(raw({ leafMaxMtimeMs: now - 40 * DAY }), { now });
  assert.ok(Math.abs(withLeaf.ageDays - 40) < 0.01);

  const withDir = analyzeUnit(raw({ leafMaxMtimeMs: 0, dirMtimeMs: now - 10 * DAY }), { now });
  assert.ok(Math.abs(withDir.ageDays - 10) < 0.01);
  assert.equal(withDir.mtimeMs, now - 10 * DAY);
});

test('analyzeUnit classifies a stale orphan worktree as safe', () => {
  const now = Date.now();
  const unit = analyzeUnit(raw({ leafMaxMtimeMs: now - 40 * DAY }), { now });
  assert.equal(unit.circle, CIRCLES.SAFE);
  assert.ok(unit.flags.includes('orphan'));
  assert.ok(unit.score > 0);
});

test('summarize buckets by circle and harness and ranks candidates', () => {
  const now = Date.now();
  const units = analyzeUnits(
    [
      raw({ leafMaxMtimeMs: now - 40 * DAY }),
      raw({
        harnessId: 'cursor',
        harnessName: 'Cursor',
        path: '/h/.cursor/worktrees/p/b',
        leafMaxMtimeMs: now - 400 * DAY,
        protected: true,
        protectedReason: 'hard-guard',
      }),
    ],
    { now, strategy: resolveStrategy() },
  );

  const summary = summarize(units, { now });
  assert.equal(summary.totals.unitCount, 2);
  assert.equal(summary.byCircle.safe.count, 1);
  assert.equal(summary.byCircle.protected.count, 1);
  assert.equal(summary.byHarness.length, 2);
  assert.equal(summary.topCandidates.length, 1);
  assert.equal(summary.topCandidates[0].circle, CIRCLES.SAFE);
  assert.equal(summary.totals.reclaimableBytes, summary.byCircle.safe.bytes);
});

test('summarize on an empty scan is well formed', () => {
  const summary = summarize([], { now: 0 });
  assert.equal(summary.totals.unitCount, 0);
  assert.equal(summary.totals.reclaimableBytes, 0);
  assert.equal(summary.byHarness.length, 0);
  assert.equal(summary.topCandidates.length, 0);
});