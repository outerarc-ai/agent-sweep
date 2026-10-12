import { createContext } from '../cli/context.js';
import { silentLogger } from '../lib/log.js';
import { buildPlan, actionId } from '../core/planner.js';
import { executePlan } from '../core/executor.js';
import { describeHarness, availableHarnesses } from '../core/registry.js';
import { CIRCLES, CIRCLE_META } from '../lib/strategy.js';
import { PLATFORM, platformLabel } from '../lib/platform.js';
import { collapseHome } from '../lib/paths.js';

export const UI_STATE_SCHEMA = 'agent-sweep/ui-state@1';
export const UI_SCAN_SCHEMA = 'agent-sweep/ui-scan@1';

function contextFor(flags) {
  return createContext({ flags, positionals: [], logger: silentLogger });
}

// Translate a UI request body into the same flag shape the CLI parser produces,
// so scanning keeps a single source of truth for strategy and options.
export function flagsFromRequest(body = {}) {
  const flags = {};
  if (Array.isArray(body.harnessIds) && body.harnessIds.length > 0) flags.harness = body.harnessIds;
  if (Number.isFinite(body.globalTtlDays) && body.globalTtlDays > 0) flags.olderThanDays = body.globalTtlDays;
  if (body.ttlOverrides && typeof body.ttlOverrides === 'object') {
    flags.ttlSpecs = { global: null, overrides: body.ttlOverrides };
  }
  if (Number.isFinite(body.minSizeBytes)) flags.minSizeBytes = body.minSizeBytes;
  if (Number.isFinite(body.minScore)) flags.minScoreValue = body.minScore;
  if (Number.isFinite(body.concurrency)) flags.concurrencyValue = body.concurrency;
  if (body.includeReportOnly === false) flags.includeReportOnly = false;
  if (body.noActiveCheck === true) flags.noActiveCheck = true;
  return flags;
}

function serializeUnit(unit, now) {
  const finiteAge = Number.isFinite(unit.ageMs);
  return {
    id: actionId(unit),
    harnessId: unit.harnessId,
    harnessName: unit.harnessName,
    targetId: unit.targetId,
    targetLabel: unit.targetLabel,
    kind: unit.kind,
    relPath: unit.relPath,
    displayPath: unit.displayPath,
    path: unit.path,
    root: unit.root,
    sizeBytes: unit.sizeBytes,
    fileCount: unit.fileCount,
    dirCount: unit.dirCount,
    ageMs: finiteAge ? unit.ageMs : null,
    ageDays: Number.isFinite(unit.ageDays) ? Math.round(unit.ageDays * 10) / 10 : null,
    mtimeMs: unit.mtimeMs > 0 ? unit.mtimeMs : null,
    circle: unit.circle,
    circleReason: unit.circleReason,
    score: unit.score,
    flags: unit.flags,
    orphan: unit.orphan,
    orphanReason: unit.orphanReason,
    orphanDetail: unit.orphanDetail,
    active: unit.active,
    activeReason: unit.activeReason,
    protected: unit.protected,
    protectedReason: unit.protectedReason,
    removable: unit.removable,
    deleteEnabled: unit.deleteEnabled,
    isDir: unit.isDir,
    risk: unit.risk,
    ttlDays: unit.ttlDays,
    now,
  };
}

function serializeSummary(summary) {
  const byCircle = {};
  for (const [key, bucket] of Object.entries(summary.byCircle)) {
    byCircle[key] = { count: bucket.count, bytes: bucket.bytes };
  }
  return {
    now: summary.now,
    totals: summary.totals,
    byCircle,
    byHarness: summary.byHarness,
    circles: CIRCLE_META,
  };
}

function serializeScan(scan) {
  return {
    platform: scan.platform,
    platformLabel: platformLabel(scan.platform),
    durationMs: scan.durationMs,
    stats: scan.stats,
    harnesses: scan.harnesses.map((entry) => ({
      id: entry.harness.id,
      name: entry.harness.name,
      deleteEnabled: Boolean(entry.harness.deleteEnabled),
      unitCount: entry.units.length,
      targets: entry.targets.map((target) => ({
        id: target.id,
        label: target.label,
        kind: target.kind,
        removable: target.removable,
        present: target.present,
        unitCount: target.unitCount,
        roots: target.roots,
      })),
    })),
  };
}

export function buildState(ctx, { version } = {}) {
  const harnesses = availableHarnesses(ctx.registry, PLATFORM).map((h) => {
    const described = describeHarness(h, { home: ctx.home });
    return {
      id: described.id,
      name: described.name,
      vendor: described.vendor,
      kind: described.kind,
      risk: described.risk,
      defaultTTL: described.defaultTTL,
      deleteEnabled: described.deleteEnabled,
      summary: described.summary,
      docs: described.docs,
      neverDelete: described.neverDelete,
      targets: described.targets.map((t) => ({
        id: t.id,
        label: t.label,
        kind: t.kind,
        unit: t.unit,
        removable: t.removable,
        orphan: t.orphan,
        paths: t.paths,
      })),
    };
  });

  return {
    schema: UI_STATE_SCHEMA,
    version,
    platform: PLATFORM,
    platformLabel: platformLabel(PLATFORM),
    home: ctx.home,
    trashRoot: collapseHome(ctx.trash.root, ctx.home),
    defaults: {
      minSizeBytes: ctx.strategy.minSizeBytes,
      minScore: ctx.strategy.minScore || 0,
      concurrency: ctx.scanOptions.concurrency,
      includeReportOnly: true,
      activeCheck: true,
    },
    circles: CIRCLE_META,
    harnesses,
  };
}

export async function runScan({ baseFlags = {}, body = {}, onProgress = null } = {}) {
  const flags = { ...baseFlags, ...flagsFromRequest(body) };
  const ctx = await contextFor(flags);
  ctx.scanOptions = { ...ctx.scanOptions, onHarness: onProgress };

  const { scan, units, summary, openFiles } = await ctx.scanAndAnalyze();
  const now = summary.now;

  const raw = { ctx, scan, units, summary, openFiles, flags };
  const view = {
    schema: UI_SCAN_SCHEMA,
    options: {
      harnessIds: flags.harness || null,
      globalTtlDays: ctx.scanOptions.globalTtl || null,
      ttlOverrides: ctx.scanOptions.ttlOverrides,
      minSizeBytes: ctx.strategy.minSizeBytes,
      minScore: ctx.strategy.minScore || 0,
      includeReportOnly: ctx.scanOptions.includeReportOnly,
      activeCheck: !flags.noActiveCheck,
    },
    scan: serializeScan(scan),
    summary: serializeSummary(summary),
    units: units.map((unit) => serializeUnit(unit, now)),
  };
  return { raw, view };
}

export function planSelection(raw, { actionIds = [], directDelete = false } = {}) {
  const ids = Array.isArray(actionIds) ? actionIds.filter(Boolean) : [];
  return buildPlan(raw.units, {
    summary: raw.summary,
    now: raw.summary.now,
    platform: raw.scan.platform,
    options: {
      ids,
      circles: [CIRCLES.SAFE, CIRCLES.REVIEW],
      minSizeBytes: raw.ctx.strategy.minSizeBytes,
      minScore: raw.ctx.strategy.minScore || 0,
      ttlOverrides: raw.ctx.scanOptions.ttlOverrides,
      directDelete,
    },
  });
}

export async function runExecution(raw, { actionIds = [], dryRun = false, directDelete = false, prune = true } = {}) {
  const plan = planSelection(raw, { actionIds, directDelete });
  const execution = await executePlan(plan, {
    trash: raw.ctx.trash,
    dryRun,
    directDelete,
    prune,
    guardSet: raw.ctx.guardSet,
    openFiles: raw.openFiles,
    home: raw.ctx.home,
  });
  return { plan, execution };
}

export async function listTrash(ctx) {
  return ctx.trash.stats();
}

export async function readBatch(ctx, id) {
  return ctx.trash.readManifest(id);
}

export async function restoreBatch(ctx, id, { dryRun = false } = {}) {
  return ctx.trash.restore(id, { dryRun });
}

export async function emptyTrash(ctx, { olderThanDays = 0 } = {}) {
  return ctx.trash.empty({ olderThanDays });
}

export async function createServiceContext(baseFlags = {}) {
  return contextFor(baseFlags);
}