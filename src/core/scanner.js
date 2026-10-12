import path from 'node:path';
import { lstatSafe, listDir, measureTree, exists } from '../lib/fsx.js';
import { toPosix, displayPath, isPathInside } from '../lib/paths.js';
import { matchGlob } from '../lib/matcher.js';
import { inspectWorktree } from '../lib/gitworktree.js';
import { detectActive } from '../lib/process.js';
import { evaluateProtection } from '../safety/guards.js';
import { pMapLimit } from '../lib/async.js';
import { PLATFORM } from '../lib/platform.js';
import { availableHarnesses, resolveTargetPaths } from './registry.js';

const FILE_WALK_LIMIT = 200000;

async function walkFiles(root, limit = FILE_WALK_LIMIT) {
  const files = [];
  const stack = [root];
  let seen = 0;
  while (stack.length > 0) {
    const dir = stack.pop();
    let entries;
    try {
      entries = await listDir(dir);
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (seen >= limit) return { files, truncated: true };
      const full = path.join(dir, entry.name);
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) {
        stack.push(full);
      } else if (entry.isFile()) {
        seen += 1;
        files.push(full);
      }
    }
  }
  return { files, truncated: false };
}

const encodedCache = new Map();

export async function resolveEncodedCwd(encoded, { platform = PLATFORM } = {}) {
  if (platform === 'win32') return { status: 'unknown', resolved: null };
  if (encodedCache.has(encoded)) return encodedCache.get(encoded);

  const trimmed = String(encoded).replace(/^[-_]+/, '');
  const parts = trimmed.split('-').filter(Boolean);
  let current = path.sep;
  let index = 0;

  while (index < parts.length) {
    let matched = false;
    for (let end = parts.length; end > index; end -= 1) {
      const candidate = parts.slice(index, end).join('-');
      const probe = path.join(current, candidate);
      if (await exists(probe)) {
        current = probe;
        index = end;
        matched = true;
        break;
      }
    }
    if (!matched) {
      const result = { status: 'orphan', resolved: null, at: current };
      encodedCache.set(encoded, result);
      return result;
    }
  }

  const result = { status: 'live', resolved: current };
  encodedCache.set(encoded, result);
  return result;
}

function isNestedDepth(relative, depth) {
  if (!relative || relative === '.') return false;
  const segments = relative.split(path.sep).filter(Boolean);
  return segments.length === depth;
}

async function enumerateUnits(root, target) {
  const units = [];

  if (target.unit === 'dir') {
    const st = await lstatSafe(root);
    if (st) units.push({ path: root, isDir: st.isDirectory() });
    return units;
  }

  if (target.unit === 'glob-file') {
    const { files } = await walkFiles(root);
    for (const file of files) {
      const rel = toPosix(path.relative(root, file));
      if (matchGlob(rel, target.pattern)) units.push({ path: file, isDir: false });
    }
    return units;
  }

  const entries = await listDir(root);
  for (const entry of entries) {
    const full = path.join(root, entry.name);
    if (target.unit === 'child-dir') {
      if (entry.isDirectory() && !entry.isSymbolicLink()) units.push({ path: full, isDir: true });
    } else if (target.unit === 'child-entry') {
      units.push({ path: full, isDir: entry.isDirectory() });
    } else if (target.unit === 'nested-dir') {
      if (!entry.isDirectory() || entry.isSymbolicLink()) continue;
      const grand = await listDir(full);
      for (const child of grand) {
        if (child.isDirectory() && !child.isSymbolicLink()) {
          units.push({ path: path.join(full, child.name), isDir: true });
        }
      }
    }
  }
  return units;
}

async function resolveOrphan(target, unitPath) {
  const type = target.orphan ? target.orphan.type : 'none';
  if (type === 'none') return { orphan: false, reason: 'not-applicable', detail: null };
  if (type === 'git-worktree') {
    const info = await inspectWorktree(unitPath);
    if (info.kind === 'none') return { orphan: false, reason: 'no-gitdir-pointer', detail: null };
    return {
      orphan: info.orphan,
      reason: info.reason,
      detail: info.mainRepo ? displayPath(info.mainRepo) : null,
      mainRepo: info.mainRepo,
    };
  }
  if (type === 'encoded-cwd') {
    const name = path.basename(unitPath);
    const resolved = await resolveEncodedCwd(name);
    if (resolved.status === 'unknown') return { orphan: false, reason: 'unresolved-encoding', detail: null };
    return {
      orphan: resolved.status === 'orphan',
      reason: resolved.status === 'orphan' ? 'host-project-missing' : 'host-project-present',
      detail: resolved.resolved ? displayPath(resolved.resolved) : null,
    };
  }
  return { orphan: false, reason: 'unknown-type', detail: null };
}

export async function scanHarness(harness, context) {
  const { guardSet, openFiles, options } = context;
  const home = options.home;
  const targets = [];
  const units = [];

  for (const target of harness.targets || []) {
    const roots = resolveTargetPaths(target);
    const startIndex = units.length;
    const record = {
      harnessId: harness.id,
      targetId: target.id,
      label: target.label,
      kind: target.kind,
      unit: target.unit,
      removable: Boolean(target.removable),
      roots: [],
      unitCount: 0,
      present: false,
    };

    for (const root of roots) {
      const st = await lstatSafe(root);
      const rootRecord = { path: displayPath(root, home), exists: Boolean(st), units: 0 };
      if (!st) {
        record.roots.push(rootRecord);
        continue;
      }
      record.present = true;
      const enumerated = await enumerateUnits(root, target);
      rootRecord.units = enumerated.length;
      record.roots.push(rootRecord);

      for (const item of enumerated) {
        units.push({
          harnessId: harness.id,
          harnessName: harness.name,
          targetId: target.id,
          targetLabel: target.label,
          kind: target.kind,
          risk: harness.risk,
          ttlDays:
            (options.ttlOverrides && options.ttlOverrides[harness.id]) ||
            options.globalTtl ||
            harness.defaultTTL,
          deleteEnabled: Boolean(harness.deleteEnabled),
          removable: Boolean(target.removable),
          root,
          path: item.path,
          isDir: item.isDir,
        });
      }
    }

    record.unitCount = units.length - startIndex;
    targets.push(record);
  }

  const lockFiles = new Set();
  for (const target of harness.targets || []) {
    for (const lock of target.lockFiles || []) lockFiles.add(lock);
  }

  const enriched = await pMapLimit(units, options.concurrency || 8, async (unit) => {
    const measured = await measureTree(unit.path);
    const protection = await evaluateProtection(unit.path, guardSet, { home });
    const orphan = await resolveOrphan(
      (harness.targets || []).find((t) => t.id === unit.targetId) || {},
      unit.path,
    );
    const activeInfo = await detectActive(unit.path, {
      openFiles,
      lockFiles: [...lockFiles],
      lockOwnerAlive: true,
    });

    return {
      ...unit,
      relPath: path.relative(unit.root, unit.path) || path.basename(unit.path),
      displayPath: displayPath(unit.path, home),
      sizeBytes: measured.sizeBytes,
      fileCount: measured.fileCount,
      dirCount: measured.dirCount,
      symlinkCount: measured.symlinkCount,
      leafMaxMtimeMs: measured.leafMaxMtimeMs,
      dirMtimeMs: measured.dirMtimeMs,
      truncated: measured.truncated,
      unreadable: measured.unreadable,
      orphan: orphan.orphan,
      orphanReason: orphan.reason,
      orphanDetail: orphan.detail,
      mainRepo: orphan.mainRepo || null,
      active: activeInfo.active,
      activeReason: activeInfo.reason,
      occupants: activeInfo.occupants,
      protected: protection.protected,
      protectedReason: protection.reason,
      protectedDetail: protection.detail || null,
    };
  });

  return { harness, targets, units: enriched };
}

export async function scan(registry, options = {}) {
  const startedAt = Date.now();
  const platform = options.platform || PLATFORM;
  const home = options.home;
  const guardSet = options.guardSet;
  const openFiles = options.openFiles || { supported: false, paths: [], byPath: new Map() };

  const requested = options.harnessIds;
  let harnesses = availableHarnesses(registry, platform);
  if (requested && requested.length > 0) {
    harnesses = harnesses.filter((h) => requested.includes(h.id));
  }
  if (options.includeReportOnly === false) {
    harnesses = harnesses.filter((h) => h.deleteEnabled);
  }

  const results = [];
  const total = harnesses.length;
  for (let index = 0; index < harnesses.length; index += 1) {
    const harness = harnesses[index];
    if (typeof options.onHarness === 'function') {
      options.onHarness({ index, total, harness });
    }
    results.push(await scanHarness(harness, { guardSet, openFiles, options: { ...options, home } }));
  }

  const allUnits = results.flatMap((r) => r.units);
  return {
    platform,
    startedAt,
    durationMs: Date.now() - startedAt,
    harnesses: results,
    units: allUnits,
    stats: {
      harnessCount: results.length,
      unitCount: allUnits.length,
      totalBytes: allUnits.reduce((sum, u) => sum + u.sizeBytes, 0),
      missingRoots: results.flatMap((r) => r.targets).flatMap((t) => t.roots).filter((r) => !r.exists).length,
    },
  };
}