import { CIRCLES } from '../lib/strategy.js';
import { PLATFORM } from '../lib/platform.js';

export const PLAN_SCHEMA = 'agent-sweep/plan@1';

export function actionId(unit) {
  return `${unit.harnessId}:${unit.targetId}:${unit.relPath}`;
}

export function toAction(unit) {
  return {
    id: actionId(unit),
    harnessId: unit.harnessId,
    harnessName: unit.harnessName,
    targetId: unit.targetId,
    targetLabel: unit.targetLabel,
    kind: unit.kind,
    path: unit.path,
    root: unit.root,
    displayPath: unit.displayPath,
    sizeBytes: unit.sizeBytes,
    fileCount: unit.fileCount,
    ageDays: Number.isFinite(unit.ageDays) ? Math.round(unit.ageDays * 10) / 10 : null,
    mtimeMs: unit.mtimeMs,
    circle: unit.circle,
    circleReason: unit.circleReason,
    score: unit.score,
    flags: unit.flags,
    orphan: unit.orphan,
    orphanReason: unit.orphanReason,
    orphanDetail: unit.orphanDetail,
    mainRepo: unit.mainRepo,
    active: unit.active,
    protected: unit.protected,
    deleteEnabled: unit.deleteEnabled,
    isDir: unit.isDir,
  };
}

export function selectActions(
  units,
  { circles = [CIRCLES.SAFE], minScore = 0, harnessIds = null, ids = null } = {},
) {
  const allowed = new Set(circles);
  const explicit = ids && ids.length > 0 ? new Set(ids) : null;
  return units.filter((unit) => {
    if (!unit.deleteEnabled) return false;
    if (explicit) {
      // Explicit selection still cannot cross the hard safety line: protected
      // (memory, credentials, MCP registry, in-use) units are never actionable.
      if (unit.circle === CIRCLES.PROTECTED) return false;
      return explicit.has(actionId(unit));
    }
    if (!allowed.has(unit.circle)) return false;
    if (minScore > 0 && unit.score < minScore) return false;
    if (harnessIds && harnessIds.length > 0 && !harnessIds.includes(unit.harnessId)) return false;
    return true;
  });
}

export function collectPruneRepos(actions) {
  const repos = new Map();
  for (const action of actions) {
    if (action.kind !== 'worktree') continue;
    if (!action.mainRepo) continue;
    repos.set(action.mainRepo, (repos.get(action.mainRepo) || 0) + 1);
  }
  return [...repos.entries()].map(([repo, worktrees]) => ({ repo, worktrees }));
}

export function buildPlan(units, { summary, options = {}, now = Date.now(), platform = PLATFORM } = {}) {
  const actions = selectActions(units, {
    circles: options.circles,
    minScore: options.minScore,
    harnessIds: options.harnessIds,
    ids: options.ids,
  });

  const protectedUnits = units.filter((u) => u.circle === CIRCLES.PROTECTED);
  const keepUnits = units.filter((u) => u.circle === CIRCLES.KEEP);

  return {
    schema: PLAN_SCHEMA,
    generatedAt: new Date(now).toISOString(),
    platform,
    options: {
      circles: options.circles,
      minSizeBytes: options.minSizeBytes,
      minScore: options.minScore,
      ttlOverrides: options.ttlOverrides || {},
      harnessIds: options.harnessIds || null,
      selectionMode: options.ids && options.ids.length > 0 ? 'explicit' : 'by-circle',
      directDelete: Boolean(options.directDelete),
    },
    summary: summary
      ? {
          unitCount: summary.totals.unitCount,
          totalBytes: summary.totals.totalBytes,
          actionableBytes: summary.totals.actionableBytes,
          reclaimableBytes: summary.totals.reclaimableBytes,
        }
      : null,
    actions: actions.map(toAction).sort((a, b) => b.sizeBytes - a.sizeBytes),
    pruneRepos: collectPruneRepos(actions.map(toAction)),
    skipped: {
      protected: protectedUnits.length,
      protectedBytes: protectedUnits.reduce((sum, u) => sum + u.sizeBytes, 0),
      keep: keepUnits.length,
      keepBytes: keepUnits.reduce((sum, u) => sum + u.sizeBytes, 0),
    },
    totals: {
      actionCount: actions.length,
      actionBytes: actions.reduce((sum, u) => sum + u.sizeBytes, 0),
    },
  };
}