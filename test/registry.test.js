import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateHarness, loadRegistry, availableHarnesses, resolveTargetPaths, describeHarness, RegistryError } from '../src/core/registry.js';
import { ALL_HARNESSES } from '../src/core/harnesses/index.js';

test('every built-in harness descriptor validates', () => {
  const registry = loadRegistry();
  assert.equal(registry.harnesses.length, ALL_HARNESSES.length);
  assert.ok(registry.harnesses.length >= 8);
});

test('registry resolves ids and aliases case-insensitively', () => {
  const registry = loadRegistry();
  assert.equal(registry.resolve('trae').id, 'trae');
  assert.equal(registry.resolve('trae-cn').id, 'trae');
  assert.equal(registry.resolve('CLAUDE').id, 'claude-code');
  assert.equal(registry.resolve('aider-chat').id, 'aider');
  assert.equal(registry.resolve('nope'), null);
  assert.equal(registry.resolve(''), null);
});

test('validateHarness rejects malformed descriptors', () => {
  assert.throws(() => validateHarness({ id: 'x' }), RegistryError);
  assert.throws(
    () =>
      validateHarness({
        id: 'x',
        name: 'X',
        platforms: ['darwin'],
        defaultTTL: 30,
        risk: 'low',
        targets: [{ id: 't', unit: 'nested-dir', paths: ['/x'], removable: true, kind: 'cache' }],
      }),
    /depth >= 2/,
  );
  assert.throws(
    () =>
      validateHarness({
        id: 'x',
        name: 'X',
        platforms: ['darwin'],
        defaultTTL: 30,
        risk: 'low',
        targets: [{ id: 't', unit: 'glob-file', paths: ['/x'], removable: true, kind: 'cache' }],
      }),
    /requires pattern/,
  );
});

test('loadRegistry rejects duplicate ids and aliases', () => {
  const first = ALL_HARNESSES[0];
  assert.throws(() => loadRegistry({ harnesses: [{ ...first }, { ...first }] }), /duplicate harness id/);
});

test('availableHarnesses filters by platform', () => {
  const registry = loadRegistry();
  const darwin = availableHarnesses(registry, 'darwin');
  assert.ok(darwin.length > 0);
  assert.ok(darwin.every((h) => h.platforms.includes('darwin')));
});

test('resolveTargetPaths expands tokens and dedupes', () => {
  const paths = resolveTargetPaths({ paths: ['~/.claude/projects', '~/.claude/projects'] });
  assert.equal(paths.length, 1);
  assert.ok(!paths[0].includes('~'));
});

test('describeHarness surfaces targets, guards and metadata', () => {
  const registry = loadRegistry();
  const described = describeHarness(registry.resolve('trae'), { home: '/home/u' });
  assert.equal(described.id, 'trae');
  assert.equal(described.deleteEnabled, true);
  assert.ok(described.targets.length > 0);
  assert.ok(described.targets.every((t) => Array.isArray(t.paths) && typeof t.removable === 'boolean'));
  assert.ok(described.neverDelete.length > 0);
});