import { test } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';
import { scanHarness, scan, resolveEncodedCwd, encodeCwd } from '../src/core/scanner.js';
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

// Claude Code encodes a session directory name by replacing every character
// outside [A-Za-z0-9] with "-", so "_", "." and " " are indistinguishable from
// "/" once encoded. The filesystem probe is POSIX-only; transcript evidence is
// platform-independent.
const posixOnly = process.platform === 'win32' ? 'filesystem probing is POSIX-only' : false;

async function writeTranscript(sessionDir, cwd) {
  await fs.mkdir(sessionDir, { recursive: true });
  const lines = [
    JSON.stringify({ type: 'queue-operation' }),
    JSON.stringify({ type: 'user', cwd, message: { role: 'user', content: 'hi' } }),
  ];
  await fs.writeFile(path.join(sessionDir, 'abc.jsonl'), lines.join('\n') + '\n');
}

test('encodeCwd mirrors the Claude Code directory encoding', () => {
  assert.equal(encodeCwd('/Users/me/my_app/v1.2'), '-Users-me-my-app-v1-2');
  assert.equal(encodeCwd('/home/me/.config/has space'), '-home-me--config-has-space');
});

test('resolveEncodedCwd resolves live projects whose names contain _ . and spaces', { skip: posixOnly }, async () => {
  const base = await fs.realpath(await mktmp('sweep-enc-'));
  for (const name of ['my_app', 'v1.2', 'has space', 'a-b_c.d']) {
    const dir = path.join(base, name);
    await fs.mkdir(dir);
    const result = await resolveEncodedCwd(encodeCwd(dir), { platform: 'linux' });
    assert.equal(result.status, 'live', name);
    assert.equal(result.resolved, dir);
  }
  await fs.rm(base, { recursive: true, force: true });
});

test('resolveEncodedCwd reports unknown, not orphan, when nothing on disk matches', async () => {
  const result = await resolveEncodedCwd('-zzz-no-such-project-999', { platform: 'linux' });
  assert.equal(result.status, 'unknown');
  assert.equal(result.resolved, null);
});

test('resolveEncodedCwd flags orphan only on transcript evidence', async () => {
  const base = await mktmp('sweep-enc-');
  const gone = path.join(base, 'gone_project');
  const sessionDir = path.join(base, 'projects', encodeCwd(gone));
  await writeTranscript(sessionDir, gone);
  const result = await resolveEncodedCwd(encodeCwd(gone), { sessionDir });
  assert.equal(result.status, 'orphan');
  assert.equal(result.at, gone);
  assert.equal(result.evidence, 'transcript-cwd');
  await fs.rm(base, { recursive: true, force: true });
});

test('resolveEncodedCwd trusts a transcript cwd that still exists', async () => {
  const base = await mktmp('sweep-enc-');
  const live = path.join(base, 'live_project');
  await fs.mkdir(live);
  const sessionDir = path.join(base, 'projects', encodeCwd(live));
  await writeTranscript(sessionDir, live);
  const result = await resolveEncodedCwd(encodeCwd(live), { sessionDir, platform: 'win32' });
  assert.equal(result.status, 'live');
  assert.equal(result.resolved, live);
  await fs.rm(base, { recursive: true, force: true });
});

test('resolveEncodedCwd ignores transcript cwds that do not encode to the directory name', async () => {
  const base = await mktmp('sweep-enc-');
  const sessionDir = path.join(base, 'projects', '-zzz-unrelated-name');
  await writeTranscript(sessionDir, path.join(base, 'somewhere_else'));
  const result = await resolveEncodedCwd('-zzz-unrelated-name', { sessionDir, platform: 'linux' });
  assert.equal(result.status, 'unknown');
  await fs.rm(base, { recursive: true, force: true });
});

test('resolveEncodedCwd reports unknown on Windows without transcript evidence', async () => {
  const result = await resolveEncodedCwd('-anything', { platform: 'win32' });
  assert.equal(result.status, 'unknown');
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