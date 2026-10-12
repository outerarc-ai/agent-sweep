import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveStrategy, scoreUnit, classifyUnit, isActionable, CIRCLES, DEFAULT_STRATEGY } from '../src/lib/strategy.js';

function unit(overrides = {}) {
  return {
    sizeBytes: 100 * 1024 * 1024,
    ageDays: 60,
    ttlDays: 30,
    orphan: false,
    active: false,
    protected: false,
    protectedReason: null,
    removable: true,
    kind: 'cache',
    risk: 'low',
    ...overrides,
  };
}

test('resolveStrategy merges overrides without dropping defaults', () => {
  const strategy = resolveStrategy({ minSizeBytes: 123, weights: { size: 1 } });
  assert.equal(strategy.minSizeBytes, 123);
  assert.equal(strategy.weights.size, 1);
  assert.equal(strategy.weights.age, DEFAULT_STRATEGY.weights.age);
  assert.equal(strategy.riskPenalty.high, DEFAULT_STRATEGY.riskPenalty.high);
});

test('classifyUnit: hard guard wins over every other signal', () => {
  const verdict = classifyUnit(unit({ protected: true, protectedReason: 'hard-guard', orphan: true, active: true }));
  assert.equal(verdict.circle, CIRCLES.PROTECTED);
  assert.ok(verdict.flags.includes('protected'));
});

test('classifyUnit: report-only targets are protected', () => {
  assert.equal(classifyUnit(unit({ removable: false })).circle, CIRCLES.PROTECTED);
  assert.equal(classifyUnit(unit({ removable: false })).reason, 'target-report-only');
});

test('classifyUnit: an occupied unit is a hard veto', () => {
  const verdict = classifyUnit(unit({ active: true, activeReason: 'open-file' }));
  assert.equal(verdict.circle, CIRCLES.PROTECTED);
  assert.match(verdict.reason, /in-use/);
  assert.ok(verdict.flags.includes('active'));
});

test('classifyUnit: fresh units and tiny units are kept', () => {
  assert.equal(classifyUnit(unit({ ageDays: 5 })).circle, CIRCLES.KEEP);
  assert.equal(classifyUnit(unit({ sizeBytes: 1024 })).circle, CIRCLES.KEEP);
  assert.equal(classifyUnit(unit({ sizeBytes: 1024 })).reason, 'below-min-size');
});

test('classifyUnit: stale orphan is safe regardless of risk', () => {
  const verdict = classifyUnit(unit({ orphan: true, risk: 'high' }));
  assert.equal(verdict.circle, CIRCLES.SAFE);
  assert.match(verdict.reason, /^orphan:/);
  assert.ok(verdict.flags.includes('orphan'));
});

test('classifyUnit: stale cache and log are safe', () => {
  assert.equal(classifyUnit(unit({ kind: 'log' })).circle, CIRCLES.SAFE);
  assert.equal(classifyUnit(unit({ kind: 'thumbnail' })).circle, CIRCLES.SAFE);
});

test('classifyUnit: stale medium-risk session data needs review', () => {
  const verdict = classifyUnit(unit({ kind: 'session-store', risk: 'medium' }));
  assert.equal(verdict.circle, CIRCLES.REVIEW);
  assert.match(verdict.reason, /medium-risk/);
});

test('scoreUnit is bounded and rewards size, age and orphan signals', () => {
  const strategy = resolveStrategy();
  const small = scoreUnit(unit({ sizeBytes: 1 }), strategy);
  const big = scoreUnit(unit({ sizeBytes: strategy.sizeCapBytes }), strategy);
  const orphan = scoreUnit(unit({ orphan: true }), strategy);

  assert.ok(big.score > small.score);
  assert.ok(orphan.score > small.score);
  assert.ok(big.score <= 100 && big.score >= 0);
  assert.equal(big.parts.orphanScore, 0);
  assert.equal(orphan.parts.orphanScore, 1);
});

test('isActionable only accepts the first two circles', () => {
  assert.equal(isActionable(CIRCLES.SAFE), true);
  assert.equal(isActionable(CIRCLES.REVIEW), true);
  assert.equal(isActionable(CIRCLES.PROTECTED), false);
  assert.equal(isActionable(CIRCLES.KEEP), false);
});