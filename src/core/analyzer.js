import { classifyUnit, scoreUnit, resolveStrategy, CIRCLES, CIRCLE_META } from '../lib/strategy.js';

export function analyzeUnit(unit, { now = Date.now(), strategy } = {}) {
  const basis = unit.leafMaxMtimeMs > 0 ? unit.leafMaxMtimeMs : unit.dirMtimeMs;
  const ageMs = basis > 0 ? Math.max(0, now - basis) : Number.POSITIVE_INFINITY;
  const ageDays = Number.isFinite(ageMs) ? ageMs / 86400000 : Number.POSITIVE_INFINITY;

  const enriched = { ...unit, mtimeMs: basis, ageMs, ageDays };
  const scored = scoreUnit(enriched, strategy);
  const verdict = classifyUnit(enriched, strategy);

  return {
    ...enriched,
    score: scored.score,
    scoreParts: scored.parts,
    circle: verdict.circle,
    circleReason: verdict.reason,
    flags: verdict.flags,
  };
}

export function analyzeUnits(units, { now = Date.now(), strategy = resolveStrategy() } = {}) {
  return units.map((unit) => analyzeUnit(unit, { now, strategy }));
}

function emptyBucket() {
  return { count: 0, bytes: 0, items: [] };
}

export function summarize(units, { now = Date.now() } = {}) {
  const byCircle = {
    safe: emptyBucket(),
    review: emptyBucket(),
    protected: emptyBucket(),
    keep: emptyBucket(),
  };

  for (const unit of units) {
    const bucket = byCircle[unit.circle] || byCircle.keep;
    bucket.count += 1;
    bucket.bytes += unit.sizeBytes;
    bucket.items.push(unit);
  }

  const actionable = units.filter((u) => u.circle === CIRCLES.SAFE || u.circle === CIRCLES.REVIEW);
  const actionableBytes = actionable.reduce((sum, u) => sum + u.sizeBytes, 0);

  const byHarness = new Map();
  for (const unit of units) {
    const key = unit.harnessId;
    if (!byHarness.has(key)) {
      byHarness.set(key, {
        harnessId: key,
        harnessName: unit.harnessName,
        deleteEnabled: unit.deleteEnabled,
        count: 0,
        bytes: 0,
        safeBytes: 0,
        reviewBytes: 0,
        protectedBytes: 0,
        keepBytes: 0,
        newestMs: 0,
        oldestMs: Number.POSITIVE_INFINITY,
      });
    }
    const row = byHarness.get(key);
    row.count += 1;
    row.bytes += unit.sizeBytes;
    if (unit.circle === CIRCLES.SAFE) row.safeBytes += unit.sizeBytes;
    else if (unit.circle === CIRCLES.REVIEW) row.reviewBytes += unit.sizeBytes;
    else if (unit.circle === CIRCLES.PROTECTED) row.protectedBytes += unit.sizeBytes;
    else row.keepBytes += unit.sizeBytes;
    if (Number.isFinite(unit.mtimeMs) && unit.mtimeMs > 0) {
      row.newestMs = Math.max(row.newestMs, unit.mtimeMs);
      row.oldestMs = Math.min(row.oldestMs, unit.mtimeMs);
    }
  }

  for (const row of byHarness.values()) {
    if (!Number.isFinite(row.oldestMs)) row.oldestMs = 0;
  }

  const topCandidates = [...actionable].sort((a, b) => b.score - a.score || b.sizeBytes - a.sizeBytes);

  return {
    now,
    totals: {
      unitCount: units.length,
      totalBytes: units.reduce((sum, u) => sum + u.sizeBytes, 0),
      actionableCount: actionable.length,
      actionableBytes,
      reclaimableBytes: byCircle.safe.bytes + byCircle.review.bytes,
    },
    byCircle,
    byHarness: [...byHarness.values()].sort((a, b) => b.bytes - a.bytes),
    topCandidates: topCandidates.slice(0, 20),
    circles: CIRCLE_META,
  };
}