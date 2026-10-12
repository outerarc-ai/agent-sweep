export const JSON_SCHEMA = 'agent-sweep/report@1';

export function buildJsonReport({ scan, summary, plan, execution = null, options = {} } = {}) {
  return {
    schema: JSON_SCHEMA,
    generatedAt: new Date(summary ? summary.now : Date.now()).toISOString(),
    platform: scan ? scan.platform : process.platform,
    options,
    stats: scan ? scan.stats : null,
    totals: summary ? summary.totals : null,
    byCircle: summary
      ? Object.fromEntries(
          Object.entries(summary.byCircle).map(([key, bucket]) => [
            key,
            { count: bucket.count, bytes: bucket.bytes },
          ]),
        )
      : null,
    byHarness: summary ? summary.byHarness : null,
    candidates: summary
      ? summary.topCandidates.map((unit) => ({
          id: `${unit.harnessId}:${unit.targetId}:${unit.relPath}`,
          harnessId: unit.harnessId,
          targetId: unit.targetId,
          kind: unit.kind,
          circle: unit.circle,
          circleReason: unit.circleReason,
          score: unit.score,
          sizeBytes: unit.sizeBytes,
          ageDays: Number.isFinite(unit.ageDays) ? Math.round(unit.ageDays * 10) / 10 : null,
          orphan: unit.orphan,
          orphanReason: unit.orphanReason,
          active: unit.active,
          protected: unit.protected,
          displayPath: unit.displayPath,
        }))
      : null,
    plan: plan || null,
    execution: execution || null,
  };
}

export function toJson(data, { pretty = true } = {}) {
  return pretty ? JSON.stringify(data, null, 2) : JSON.stringify(data);
}