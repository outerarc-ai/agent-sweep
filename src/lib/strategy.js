export const CIRCLES = Object.freeze({
  SAFE: 'safe',
  REVIEW: 'review',
  PROTECTED: 'protected',
  KEEP: 'keep',
});

export const CIRCLE_META = Object.freeze({
  safe: { id: 1, label: '可安全清理', labelEn: 'Safe to clean', color: '#1f7a4d' },
  review: { id: 2, label: '需确认后清理', labelEn: 'Review before cleaning', color: '#b5731a' },
  protected: { id: 3, label: '永不清理', labelEn: 'Never clean', color: '#b3261e' },
  keep: { id: 0, label: '保留', labelEn: 'Keep', color: '#5f6368' },
});

export const RISK_ORDER = { low: 0, medium: 1, high: 2 };

export const SAFE_KINDS = new Set(['cache', 'log', 'index', 'thumbnail']);

export const DEFAULT_STRATEGY = Object.freeze({
  minSizeBytes: 1024 * 1024,
  sizeCapBytes: 2 * 1024 * 1024 * 1024,
  ageCapMultiplier: 3,
  weights: { size: 0.5, age: 0.35, orphan: 0.15 },
  riskPenalty: { low: 0, medium: 0.05, high: 0.15 },
  enforceMinSize: true,
});

export function resolveStrategy(overrides = {}) {
  return {
    ...DEFAULT_STRATEGY,
    ...overrides,
    weights: { ...DEFAULT_STRATEGY.weights, ...(overrides.weights || {}) },
    riskPenalty: { ...DEFAULT_STRATEGY.riskPenalty, ...(overrides.riskPenalty || {}) },
  };
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

export function scoreUnit(unit, strategy = DEFAULT_STRATEGY) {
  const sizeScore = clamp(unit.sizeBytes / strategy.sizeCapBytes, 0, 1);
  const ttl = unit.ttlDays > 0 ? unit.ttlDays : 30;
  const ageScore = clamp(unit.ageDays / (ttl * strategy.ageCapMultiplier), 0, 1);
  const orphanScore = unit.orphan ? 1 : 0;
  const penalty = strategy.riskPenalty[unit.risk] || 0;
  const raw =
    strategy.weights.size * sizeScore +
    strategy.weights.age * ageScore +
    strategy.weights.orphan * orphanScore -
    penalty;
  const parts = { sizeScore, ageScore, orphanScore, penalty };
  return { score: Math.round(clamp(raw, 0, 1) * 1000) / 10, parts };
}

export function classifyUnit(unit, strategy = DEFAULT_STRATEGY) {
  const flags = [];
  const stale = unit.ageDays >= unit.ttlDays;
  if (stale) flags.push('stale');
  if (unit.orphan) flags.push('orphan');
  if (unit.active) flags.push('active');
  if (unit.protected) flags.push('protected');
  if (unit.sizeBytes >= 1024 * 1024 * 1024) flags.push('large');

  if (unit.protected) {
    return { circle: CIRCLES.PROTECTED, flags, reason: unit.protectedReason || 'hard-guard' };
  }
  if (!unit.removable) {
    return { circle: CIRCLES.PROTECTED, flags, reason: 'target-report-only' };
  }
  if (unit.active) {
    return { circle: CIRCLES.PROTECTED, flags, reason: `in-use:${unit.activeReason || 'unknown'}` };
  }
  if (!stale) {
    return { circle: CIRCLES.KEEP, flags, reason: 'within-ttl' };
  }
  if (strategy.enforceMinSize && unit.sizeBytes < strategy.minSizeBytes) {
    return { circle: CIRCLES.KEEP, flags, reason: 'below-min-size' };
  }
  if (unit.orphan) {
    return { circle: CIRCLES.SAFE, flags, reason: `orphan:${unit.orphanReason || 'unknown'}` };
  }
  if (SAFE_KINDS.has(unit.kind)) {
    return { circle: CIRCLES.SAFE, flags, reason: `stale-${unit.kind}` };
  }
  if (unit.risk === 'low') {
    return { circle: CIRCLES.SAFE, flags, reason: 'stale-low-risk' };
  }
  return { circle: CIRCLES.REVIEW, flags, reason: `stale-${unit.risk}-risk` };
}

export function isActionable(circle) {
  return circle === CIRCLES.SAFE || circle === CIRCLES.REVIEW;
}