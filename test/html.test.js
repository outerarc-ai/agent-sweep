import { test } from 'node:test';
import assert from 'node:assert/strict';
import { escapeHtml, renderHtmlReport } from '../src/core/reporter/html.js';

function emptySummary(now = Date.now()) {
  return {
    now,
    totals: { unitCount: 0, totalBytes: 0, actionableCount: 0, actionableBytes: 0, reclaimableBytes: 0 },
    byCircle: {
      safe: { count: 0, bytes: 0, items: [] },
      review: { count: 0, bytes: 0, items: [] },
      protected: { count: 0, bytes: 0, items: [] },
      keep: { count: 0, bytes: 0, items: [] },
    },
    byHarness: [],
    topCandidates: [],
  };
}

test('escapeHtml neutralises markup and coerces null', () => {
  assert.equal(escapeHtml('<a href="x">&</a>'), '&lt;a href=&quot;x&quot;&gt;&amp;&lt;/a&gt;');
  assert.equal(escapeHtml("it's"), 'it&#39;s');
  assert.equal(escapeHtml(null), '');
  assert.equal(escapeHtml(undefined), '');
});

test('renderHtmlReport emits a self-contained document with no external assets', () => {
  const html = renderHtmlReport({ scan: { platform: 'darwin' }, summary: emptySummary(), plan: null });

  assert.ok(html.startsWith('<!doctype html>'));
  assert.ok(html.includes('<html lang="zh-CN">'));
  assert.ok(html.includes('<meta charset="utf-8">'));
  assert.ok(html.trimEnd().endsWith('</html>'));
  assert.ok(!html.includes('<script'));
  assert.ok(!html.includes('http://'));
  assert.ok(!html.includes('https://'));
  assert.ok(!html.includes('src='));
});

test('renderHtmlReport escapes untrusted unit paths', () => {
  const summary = emptySummary();
  summary.totals.unitCount = 1;
  summary.byCircle.safe.count = 1;
  summary.byCircle.safe.items = [
    {
      harnessName: '<script>alert(1)</script>',
      kind: 'cache',
      sizeBytes: 1024,
      ageDays: 40,
      ageMs: 40 * 86400000,
      score: 50,
      orphan: true,
      active: false,
      displayPath: '/x/<img src=x onerror=alert(1)>',
      path: '/x/evil',
    },
  ];
  summary.byHarness = [
    { harnessId: 'x', harnessName: '<b>bad</b>', deleteEnabled: true, count: 1, bytes: 1024, safeBytes: 1024, reviewBytes: 0, protectedBytes: 0, keepBytes: 0, newestMs: 0, oldestMs: 0 },
  ];

  const html = renderHtmlReport({ scan: { platform: 'darwin' }, summary, plan: null });
  assert.ok(!html.includes('<script>alert(1)</script>'));
  assert.ok(!html.includes('<img src=x'));
  assert.ok(html.includes('&lt;script&gt;alert(1)&lt;/script&gt;'));
});