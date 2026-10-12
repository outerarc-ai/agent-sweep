import { test } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';
import { executePlan, verifyAction } from '../src/core/executor.js';
import { createTrash } from '../src/core/trash.js';
import { buildGuardSet } from '../src/safety/guards.js';
import { CIRCLES } from '../src/lib/strategy.js';

const openFiles = { supported: false, paths: [], byPath: new Map() };

function action(file, overrides = {}) {
  return {
    id: `trae:cache:${file}`,
    harnessId: 'trae',
    targetId: 'cache',
    targetLabel: '缓存',
    kind: 'cache',
    path: file,
    root: path.dirname(file),
    displayPath: file,
    sizeBytes: 5,
    fileCount: 1,
    ageDays: 40,
    mtimeMs: 0,
    circle: CIRCLES.SAFE,
    circleReason: 'stale-cache',
    score: 60,
    flags: [],
    orphan: false,
    active: false,
    protected: false,
    deleteEnabled: true,
    isDir: false,
    ...overrides,
  };
}

async function fixture() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'sweep-exec-'));
  const trashRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'sweep-trash-'));
  const file = path.join(dir, 'a.txt');
  await fs.writeFile(file, 'x');
  return { dir, trashRoot, file };
}

const exists = (p) => fs.stat(p).then(() => true, () => false);

test('dry-run verifies actions but never touches disk', async () => {
  const { dir, file } = await fixture();
  const plan = { actions: [action(file)], pruneRepos: [], options: {} };
  const report = await executePlan(plan, { dryRun: true, guardSet: buildGuardSet([]), openFiles, home: dir });

  assert.equal(report.dryRun, true);
  assert.equal(report.moved.length, 1);
  assert.equal(report.moved[0].dryRun, true);
  assert.equal(report.batchId, null);
  assert.equal(report.freedBytes, 5);
  assert.equal(await exists(file), true);

  await fs.rm(dir, { recursive: true, force: true });
});

test('trash mode moves files and writes a manifest', async () => {
  const { dir, trashRoot, file } = await fixture();
  const trash = createTrash({ root: trashRoot });
  const plan = { actions: [action(file)], pruneRepos: [], options: { generatedAt: 'now' } };
  const report = await executePlan(plan, { trash, guardSet: buildGuardSet([]), openFiles, home: dir });

  assert.ok(report.batchId);
  assert.equal(report.moved.length, 1);
  assert.equal(await exists(file), false);
  assert.equal((await trash.listBatches()).length, 1);

  await fs.rm(dir, { recursive: true, force: true });
  await fs.rm(trashRoot, { recursive: true, force: true });
});

test('direct delete removes files without a trash batch', async () => {
  const { dir, file } = await fixture();
  const plan = { actions: [action(file)], pruneRepos: [], options: {} };
  const report = await executePlan(plan, { directDelete: true, guardSet: buildGuardSet([]), openFiles, home: dir });

  assert.equal(report.batchId, null);
  assert.equal(report.moved.length, 1);
  assert.equal(report.moved[0].trashPath, null);
  assert.equal(await exists(file), false);

  await fs.rm(dir, { recursive: true, force: true });
});

test('verifyAction rejects missing paths', async () => {
  const result = await verifyAction({ path: '/definitely/not/here' }, { guardSet: buildGuardSet([]), openFiles, home: '/' });
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'missing');
});

test('verifyAction rejects protected paths even if planned', async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'sweep-exec-'));
  const file = path.join(tmp, 'a.txt');
  await fs.writeFile(file, 'x');
  const guardSet = buildGuardSet([{ id: 'fake', neverDelete: [path.join(tmp, '**')] }]);

  const result = await verifyAction({ path: file }, { guardSet, openFiles, home: tmp });
  assert.equal(result.ok, false);
  assert.match(result.reason, /protected:/);

  await fs.rm(tmp, { recursive: true, force: true });
});

test('an action that vanished after planning is skipped, not failed', async () => {
  const { dir, trashRoot, file } = await fixture();
  await fs.rm(file);
  const trash = createTrash({ root: trashRoot });
  const plan = { actions: [action(file)], pruneRepos: [], options: {} };
  const report = await executePlan(plan, { trash, guardSet: buildGuardSet([]), openFiles, home: dir });

  assert.equal(report.moved.length, 0);
  assert.equal(report.skipped.length, 1);
  assert.equal(report.skipped[0].reason, 'missing');
  assert.equal(report.batchId, null);

  await fs.rm(dir, { recursive: true, force: true });
  await fs.rm(trashRoot, { recursive: true, force: true });
});