import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatBytes, formatAge, displayWidth, padEndWide, truncateWide, renderTable } from '../src/lib/format.js';

test('formatBytes scales units', () => {
  assert.equal(formatBytes(0), '0 B');
  assert.equal(formatBytes(512), '512 B');
  assert.equal(formatBytes(1024), '1.00 KB');
  assert.equal(formatBytes(1536), '1.50 KB');
  assert.equal(formatBytes(1024 * 1024), '1.00 MB');
  assert.equal(formatBytes(5 * 1024 ** 3), '5.00 GB');
});

test('formatAge renders coarse buckets', () => {
  assert.equal(formatAge(30 * 60000), '30m');
  assert.equal(formatAge(5 * 3600000), '5h');
  assert.equal(formatAge(10 * 86400000), '10d');
  assert.equal(formatAge(200 * 86400000), '6.6mo');
});

test('displayWidth counts CJK as double width', () => {
  assert.equal(displayWidth('abc'), 3);
  assert.equal(displayWidth('中文'), 4);
  assert.equal(displayWidth('a中'), 3);
});

test('padEndWide pads to a target visual width', () => {
  assert.equal(displayWidth(padEndWide('中文', 8)), 8);
  assert.equal(displayWidth(padEndWide('abcd', 8)), 8);
});

test('truncateWide respects width and adds ellipsis', () => {
  const out = truncateWide('这是一个很长的中文标题内容', 8);
  assert.ok(displayWidth(out) <= 8);
  assert.ok(out.endsWith('…'));
});

test('renderTable aligns columns', () => {
  const table = renderTable(['A', 'B'], [['x', '1'], ['yy', '22']], { align: ['left', 'right'] });
  const lines = table.split('\n');
  assert.equal(lines.length, 4);
  assert.ok(lines[0].startsWith('A'));
  assert.ok(lines[2].endsWith('1'));
});