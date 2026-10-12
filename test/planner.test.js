import { test } from 'node:test';
import assert from 'node:assert/strict';
import { selectActions, buildPlan, collectPruneRepos, toAction, PLAN_SCHEMA } from '../src/core/planner.js';
import { CIRCLES } from '../src/lib/strategy.js';

function analyzed(overrides = {}) {
  return {
    harnessId: 'trae',
    harnessName: 'Trae',
    targetId: 'worktrees',
    targetLabel: '工作树',
    kind: 'worktree',
    path: '/h/.trae-cn/worktrees/p/b',
    root: '/h/.trae-cn/worktrees',
    displayPath: '~/.trae-cn/worktrees/p/b',
    relPath: 'p/b',
    sizeBytes: 1024,
    fileCount: 3,
    ageDays: 40,
    mtimeMs: 0,
    circle: CIRCLES.SAFE,
    circleReason: 'orphan:main-repo-missing',
    score: 80,
    flags: ['stale', 'orphan'],
    orphan: true,
    orphanReason: 'main-repo-missing',
    orphanDetail: null,
    mainRepo: '/h/proj',
    active: false,
    protected: false,
    deleteEnabled: true,
    isDir: true,
    ...overrides,
  };
}

test('selectActions defaults to safe + delete-enabled only', () => {
  const units = [
    analyzed(),
    analyzed({ circle: CIRCLES.REVIEW, path: '/r' }),
    analyzed({ circle: CIRCLES.SAFE, deleteEnabled: false, path: '/y' }),
  ];
  assert.equal(selectActions(units).length, 1);
});

test('selectActions honours circles, minScore and harness filters', () => {
  const units = [analyzed(), analyzed({ circle: CIRCLES.REVIEW, path: '/r', score: 10 })];
  const both = [CIRCLES.SAFE, CIRCLES.REVIEW];
  assert.equal(selectActions(units, { circles: both }).length, 2);
  assert.equal(selectActions(units, { circles: both, minScore: 50 }).length, 1);
  assert.equal(selectActions(units, { circles: both, harnessIds: ['cursor'] }).length, 0);
});

test('collectPruneRepos aggregates worktrees by main repo', () => {
  const actions = [
    toAction(analyzed()),
    toAction(analyzed({ path: '/h/.trae-cn/worktrees/p/c', relPath: 'p/c' })),
    toAction(analyzed({ kind: 'cache', mainRepo: null, path: '/h/cache' })),
  ];
  const repos = collectPruneRepos(actions);
  assert.equal(repos.length, 1);
  assert.equal(repos[0].repo, '/h/proj');
  assert.equal(repos[0].worktrees, 2);
});

test('buildPlan produces a serializable plan with skipped buckets', () => {
  const units = [
    analyzed(),
    analyzed({ circle: CIRCLES.PROTECTED, protected: true, protectedReason: 'hard-guard', path: '/p' }),
    analyzed({ circle: CIRCLES.KEEP, path: '/k' }),
  ];
  const summary = { totals: { unitCount: 3, totalBytes: 3072, actionableBytes: 1024, reclaimableBytes: 1024 } };
  const plan = buildPlan(units, { summary, options: { circles: [CIRCLES.SAFE] }, now: 0, platform: 'darwin' });

  assert.equal(plan.schema, PLAN_SCHEMA);
  assert.equal(plan.totals.actionCount, 1);
  assert.equal(plan.totals.actionBytes, 1024);
  assert.equal(plan.skipped.protected, 1);
  assert.equal(plan.skipped.keep, 1);
  assert.equal(plan.pruneRepos.length, 1);
  assert.doesNotThrow(() => JSON.parse(JSON.stringify(plan)));
});

test('buildPlan with no matching units yields an empty plan', () => {
  const plan = buildPlan([analyzed({ circle: CIRCLES.KEEP })], { options: { circles: [CIRCLES.SAFE] } });
  assert.equal(plan.totals.actionCount, 0);
  assert.equal(plan.pruneRepos.length, 0);
});

test('selectActions with explicit ids keeps the hard safety line', () => {
  const safe = analyzed({ path: '/h/.trae-cn/worktrees/p/b', relPath: 'p/b' });
  const review = analyzed({ circle: CIRCLES.REVIEW, circleReason: 'stale-medium-risk', path: '/h/.trae-cn/work/s1', relPath: 's1' });
  const protectedUnit = analyzed({ circle: CIRCLES.PROTECTED, protected: true, path: '/h/.claude/plugins/x', relPath: 'plugins/x' });
  const reportOnly = analyzed({ deleteEnabled: false, path: '/h/.copilot/cache', relPath: 'cache' });
  const units = [safe, review, protectedUnit, reportOnly];

  const ids = [toAction(safe).id, toAction(review).id, toAction(protectedUnit).id, toAction(reportOnly).id];
  const picked = selectActions(units, { ids });

  // Explicit selection still cannot reach protected units or report-only harnesses.
  assert.equal(picked.length, 2);
  assert.deepEqual(new Set(picked.map((u) => u.circle)), new Set([CIRCLES.SAFE, CIRCLES.REVIEW]));
});

test('buildPlan records explicit selection mode', () => {
  const unit = analyzed();
  const plan = buildPlan([unit], { options: { ids: [toAction(unit).id] }, now: 0, platform: 'darwin' });
  assert.equal(plan.totals.actionCount, 1);
  assert.equal(plan.options.selectionMode, 'explicit');
});