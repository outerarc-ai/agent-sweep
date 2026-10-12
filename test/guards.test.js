import { test } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';
import { buildGuardSet, evaluateProtection, staticPrefix, GLOBAL_PROTECTED_PATHS } from '../src/safety/guards.js';
import { loadRegistry, buildRegistryGuards } from '../src/core/registry.js';

test('staticPrefix extracts the fixed head of a pattern', () => {
  assert.equal(staticPrefix('/a/b/**'), '/a/b');
  assert.equal(staticPrefix('/a/b/c.json'), '/a/b');
  assert.equal(staticPrefix('/**'), '/');
});

test('buildGuardSet merges global and harness patterns', () => {
  const guardSet = buildRegistryGuards(loadRegistry());
  assert.ok(guardSet.entries.length > GLOBAL_PROTECTED_PATHS.length);
  assert.ok(guardSet.basenames.has('agents.md'));
});

test('sensitive files are protected but templates are not', async () => {
  const guardSet = buildGuardSet([]);
  const home = os.homedir();
  const secret = await evaluateProtection(path.join(home, 'somewhere', '.env'), guardSet, { home, deep: false });
  assert.equal(secret.protected, true);
  const template = await evaluateProtection(path.join(home, 'somewhere', '.env.example'), guardSet, { home, deep: false });
  assert.equal(template.protected, false);
});

test('memory directories are protected as a hard guard', async () => {
  const guardSet = buildRegistryGuards(loadRegistry());
  const home = os.homedir();
  const memory = path.join(home, '.claude', 'projects', '-x-y', 'memory', 'note.md');
  const result = await evaluateProtection(memory, guardSet, { home, deep: false });
  assert.equal(result.protected, true);
  assert.match(result.reason, /guard/);
});

test('a session directory containing a protected subtree is protected', async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'sweep-guard-'));
  const guardSet = buildGuardSet([{ id: 'fake', neverDelete: [path.join(tmp, 'session', 'keep/**')] }]);
  const session = path.join(tmp, 'session');
  await fs.mkdir(path.join(session, 'keep'), { recursive: true });
  await fs.writeFile(path.join(session, 'keep', 'x.txt'), 'hi');

  const result = await evaluateProtection(session, guardSet, { home: tmp });
  assert.equal(result.protected, true);
  assert.equal(result.reason, 'contains-protected');

  await fs.rm(tmp, { recursive: true, force: true });
});

test('filename heuristics never block a whole session directory', async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'sweep-guard-'));
  const guardSet = buildGuardSet([]);
  const session = path.join(tmp, 'session');
  await fs.mkdir(session, { recursive: true });
  await fs.writeFile(path.join(session, '.env.example'), 'A=1');
  await fs.writeFile(path.join(session, 'AGENTS.md'), '# notes');
  await fs.writeFile(path.join(session, 'dev-token.py'), 'print(1)');

  const result = await evaluateProtection(session, guardSet, { home: tmp });
  assert.equal(result.protected, false);

  await fs.rm(tmp, { recursive: true, force: true });
});