import { test } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';
import { createTrash, defaultTrashRoot, batchId, TRASH_SCHEMA } from '../src/core/trash.js';

async function makeTrash() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'sweep-trash-'));
  return { root, trash: createTrash({ root }) };
}

async function makeSource() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'sweep-src-'));
  const file = path.join(dir, 'a.txt');
  await fs.writeFile(file, 'hello');
  return { dir, file };
}

function action(file, overrides = {}) {
  return {
    id: `trae:cache:${file}`,
    harnessId: 'trae',
    targetId: 'cache',
    kind: 'cache',
    circle: 'safe',
    path: file,
    sizeBytes: 5,
    isDir: false,
    mainRepo: null,
    ...overrides,
  };
}

test('batch ids are unique and time ordered', () => {
  const a = batchId(new Date('2026-01-02T03:04:05'));
  const b = batchId(new Date('2026-01-02T03:04:05'));
  assert.match(a, /^20260102-030405-[a-z0-9]{4}$/);
  assert.notEqual(a, b);
});

test('defaultTrashRoot lives under the agent-sweep home', () => {
  assert.match(defaultTrashRoot(), /\.agent-sweep[\\/]trash$/);
});

test('moving an item records a manifest and removes the source', async () => {
  const { root, trash } = await makeTrash();
  const { dir, file } = await makeSource();

  await trash.init();
  const batch = await trash.createBatch({ label: 'unit' });
  await trash.addEntry(batch, action(file), 1);
  await trash.writeManifest(batch);

  assert.equal(batch.schema, TRASH_SCHEMA);
  assert.equal(batch.stats.moved, 1);
  assert.equal(batch.stats.freedBytes, 5);
  assert.equal(await fs.stat(file).then(() => true, () => false), false);

  const batches = await trash.listBatches();
  assert.equal(batches.length, 1);
  assert.equal(batches[0].entries, 1);
  assert.equal(batches[0].label, 'unit');

  await fs.rm(root, { recursive: true, force: true });
  await fs.rm(dir, { recursive: true, force: true });
});

test('restore returns items to their original path and clears the batch', async () => {
  const { root, trash } = await makeTrash();
  const { dir, file } = await makeSource();

  await trash.init();
  const batch = await trash.createBatch();
  await trash.addEntry(batch, action(file), 1);
  await trash.writeManifest(batch);

  const result = await trash.restore(batch.id);
  assert.equal(result.restored.length, 1);
  assert.equal(result.conflicts.length, 0);
  assert.equal(result.missing.length, 0);
  assert.equal(await fs.stat(file).then(() => true, () => false), true);

  const batches = await trash.listBatches();
  assert.equal(batches.length, 0);

  await fs.rm(root, { recursive: true, force: true });
  await fs.rm(dir, { recursive: true, force: true });
});

test('restore reports conflicts without overwriting', async () => {
  const { root, trash } = await makeTrash();
  const { dir, file } = await makeSource();

  await trash.init();
  const batch = await trash.createBatch();
  await trash.addEntry(batch, action(file), 1);
  await trash.writeManifest(batch);

  await fs.writeFile(file, 'replacement');

  const result = await trash.restore(batch.id);
  assert.equal(result.restored.length, 0);
  assert.equal(result.conflicts.length, 1);
  assert.equal(await fs.readFile(file, 'utf8'), 'replacement');

  await fs.rm(root, { recursive: true, force: true });
  await fs.rm(dir, { recursive: true, force: true });
});

test('restore dry-run changes nothing', async () => {
  const { root, trash } = await makeTrash();
  const { dir, file } = await makeSource();

  await trash.init();
  const batch = await trash.createBatch();
  await trash.addEntry(batch, action(file), 1);
  await trash.writeManifest(batch);

  const result = await trash.restore(batch.id, { dryRun: true });
  assert.equal(result.restored.length, 1);
  assert.equal(await fs.stat(file).then(() => true, () => false), false);
  assert.equal((await trash.listBatches()).length, 1);

  await fs.rm(root, { recursive: true, force: true });
  await fs.rm(dir, { recursive: true, force: true });
});

test('empty removes batches and stats aggregate freed bytes', async () => {
  const { root, trash } = await makeTrash();
  const { dir, file } = await makeSource();

  await trash.init();
  const batch = await trash.createBatch();
  await trash.addEntry(batch, action(file), 1);
  await trash.writeManifest(batch);

  const stats = await trash.stats();
  assert.equal(stats.batchCount, 1);
  assert.equal(stats.freedBytes, 5);

  const kept = await trash.empty({ olderThanDays: 1 });
  assert.equal(kept.removed.length, 0);

  const cleared = await trash.empty({ olderThanDays: 0 });
  assert.equal(cleared.removed.length, 1);
  assert.equal((await trash.listBatches()).length, 0);

  await fs.rm(root, { recursive: true, force: true });
  await fs.rm(dir, { recursive: true, force: true });
});

test('readManifest rejects an unknown batch', async () => {
  const { root, trash } = await makeTrash();
  await assert.rejects(() => trash.readManifest('nope'), /not found/);
  await fs.rm(root, { recursive: true, force: true });
});