import { test } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';
import { scanHarness, scan, resolveEncodedCwd } from '../src/core/scanner.js';
import { buildGuardSet } from '../src/safety/guards.js';
import { loadRegistry } from '../src/core/registry.js';

const openFiles = { supported: false, paths: [], byPath: new Map() };
const DAY = 86400000;

async function mktmp(prefix) {
  return fs.mkdtemp(path.join(os.tmpdir(), prefix));
}

async function writeOld(file, days) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, 'x');
  const when = new Date(Date.now() - days * DAY);
  await fs.utimes(file, when, when);
}

test('resolveEncodedCwd resolves a live host project', async () => {
  const dir = await mktmp('sweep-enc-');
  const encoded = dir.replace(/\//g, '-');
  const result = await resolveEncodedCwd(encoded);
  assert.equal(result.status, 'live');
  assert.ok(result.resolved === dir || result.resolved === (await fs.realpath(dir)));
  await fs.rm(dir, { recursive: true, force: true });
});

test('resolveEncodedCwd flags a missing host project as orphan', async () => {
  const result = await resolveEncodedCwd('-zzz-no-such-project-999');
  assert.equal(result.status, 'orphan');
  assert.equal(result.resolved, null);
});

test('scanHarness enumerates units and flags orphan worktrees', async () => {
  const home = await mktmp('sweep-home-');
  const workRoot = path.join(home, '.trae-cn', 'work');
  await writeOld(path.join(workRoot, 's1', 'note.txt'), 40);
  await writeOld(path.join(workRoot, 's2', 'note.txt'), 40);

  const wtRoot = path.join(home, '.trae-cn', 'worktrees');
  const wt = path.join(wtRoot, 'proj', 'branch');
  await fs.mkdir(wt, { recursive: true });
  await fs.writeFile(path.join(wt, '.git'), `gitdir: ${path.join(home, 'gone', '.git', 'worktrees', 'branch')}\n`);
  await writeOld(path.join(wt, 'file.txt'), 40);

  const harness = {
    id: 'trae',
    name: 'Trae',
    risk: 'medium',
    defaultTTL: 30,
    deleteEnabled: true,
    targets: [
      { id: 'work', kind: 'session-store', label: 'work', paths: [workRoot], unit: 'child-dir', removable: true, orphan: { type: 'none' } },
      { id: 'worktrees', kind: 'worktree', label: 'wt', paths: [wtRoot], unit: 'nested-dir', depth: 2, removable: true, orphan: { type: 'git-worktree' } },
    ],
  };

  const result = await scanHarness(harness, {
    guardSet: buildGuardSet([]),
    openFiles,
    options: { home, concurrency: 4, ttlOverrides: {}, globalTtl: null },
  });

  const workUnits = result.units.filter((u) => u.targetId === 'work');
  assert.equal(workUnits.length, 2);
  assert.ok(workUnits.every((u) => u.sizeBytes > 0));

  const wtUnits = result.units.filter((u) => u.targetId === 'worktrees');
  assert.equal(wtUnits.length, 1);
  assert.equal(wtUnits[0].orphan, true);
  assert.equal(wtUnits[0].orphanReason, 'main-repo-missing');

  const workRecord = result.targets.find((t) => t.targetId === 'work');
  const wtRecord = result.targets.find((t) => t.targetId === 'worktrees');
  assert.equal(workRecord.unitCount, 2);
  assert.equal(wtRecord.unitCount, 1);

  await fs.rm(home, { recursive: true, force: true });
});

test('a live worktree (main repo present) is not orphan', async () => {
  const home = await mktmp('sweep-home-');
  const mainRepo = path.join(home, 'proj');
  await fs.mkdir(path.join(mainRepo, '.git', 'worktrees', 'branch'), { recursive: true });

  const wtRoot = path.join(home, '.cursor', 'worktrees');
  const wt = path.join(wtRoot, 'proj', 'branch');
  await fs.mkdir(wt, { recursive: true });
  await fs.writeFile(path.join(wt, '.git'), `gitdir: ${path.join(mainRepo, '.git', 'worktrees', 'branch')}\n`);
  await writeOld(path.join(wt, 'file.txt'), 40);

  const harness = {
    id: 'cursor',
    name: 'Cursor',
    risk: 'high',
    defaultTTL: 30,
    deleteEnabled: true,
    targets: [
      { id: 'worktrees', kind: 'worktree', label: 'wt', paths: [wtRoot], unit: 'nested-dir', depth: 2, removable: true, orphan: { type: 'git-worktree' } },
    ],
  };

  const result = await scanHarness(harness, {
    guardSet: buildGuardSet([]),
    openFiles,
    options: { home, concurrency: 2, ttlOverrides: {}, globalTtl: null },
  });

  assert.equal(result.units.length, 1);
  assert.equal(result.units[0].orphan, false);

  await fs.rm(home, { recursive: true, force: true });
});

test('scan aggregates the registry against an empty home', async () => {
  const home = await mktmp('sweep-empty-');
  const previousHome = process.env.AGENT_SWEEP_HOME_DIR;
  process.env.AGENT_SWEEP_HOME_DIR = home;
  try {
    const result = await scan(loadRegistry(), {
      home,
      guardSet: buildGuardSet([]),
      openFiles,
      harnessIds: ['trae', 'claude-code'],
      ttlOverrides: {},
      globalTtl: null,
      concurrency: 4,
      platform: process.platform,
    });

    assert.equal(result.stats.harnessCount, 2);
    assert.equal(result.stats.unitCount, 0);
    assert.equal(result.stats.totalBytes, 0);
    assert.ok(result.stats.missingRoots > 0);
  } finally {
    if (previousHome === undefined) delete process.env.AGENT_SWEEP_HOME_DIR;
    else process.env.AGENT_SWEEP_HOME_DIR = previousHome;
    await fs.rm(home, { recursive: true, force: true });
  }
});