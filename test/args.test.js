import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseArgs, parseSize, parseDays, parseTtlSpecs } from '../src/cli/args.js';

test('parseSize understands units', () => {
  assert.equal(parseSize('10MB'), 10 * 1024 ** 2);
  assert.equal(parseSize('1g'), 1024 ** 3);
  assert.equal(parseSize('512'), 512);
  assert.equal(parseSize('2.5mb'), Math.round(2.5 * 1024 ** 2));
  assert.equal(parseSize('bogus'), null);
});

test('parseDays understands units', () => {
  assert.equal(parseDays('30'), 30);
  assert.equal(parseDays('4w'), 28);
  assert.equal(parseDays('2mo'), 60.88);
  assert.equal(parseDays('nope'), null);
});

test('parseTtlSpecs splits global and per-harness overrides', () => {
  const result = parseTtlSpecs(['60', 'trae=45', 'cursor=7d']);
  assert.equal(result.global, 60);
  assert.equal(result.overrides.trae, 45);
  assert.equal(result.overrides.cursor, 7);
});

test('parseArgs handles boolean and value flags', () => {
  const { flags, positionals } = parseArgs(['clean', '--yes', '--include-review', '--ttl', 'trae=45', '--min-size', '10MB']);
  assert.deepEqual(positionals, ['clean']);
  assert.equal(flags.yes, true);
  assert.equal(flags.includeReview, true);
  assert.equal(flags.ttlSpecs.overrides.trae, 45);
  assert.equal(flags.minSizeBytes, 10 * 1024 ** 2);
});

test('parseArgs supports --flag=value and short flags', () => {
  const { flags } = parseArgs(['--html=out.html', '-n', '-q']);
  assert.equal(flags.html, 'out.html');
  assert.equal(flags.dryRun, true);
  assert.equal(flags.quiet, true);
});

test('parseArgs collects repeated --harness', () => {
  const { flags } = parseArgs(['scan', '--harness', 'trae', '--harness', 'claude-code,cursor']);
  assert.deepEqual(flags.harness, ['trae', 'claude-code', 'cursor']);
});

test('parseArgs records unknown flags', () => {
  const { flags } = parseArgs(['--nonsense']);
  assert.deepEqual(flags.unknown, ['nonsense']);
});

test('parseArgs stops parsing after --', () => {
  const { positionals } = parseArgs(['restore', '--', '--weird-id']);
  assert.deepEqual(positionals, ['restore', '--weird-id']);
});