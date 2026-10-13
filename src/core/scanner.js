import path from 'node:path';
import fs from 'node:fs/promises';
import { lstatSafe, listDir, measureTree, exists, readText } from '../lib/fsx.js';
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

// Claude Code names a session directory after its working directory with every
// character outside [A-Za-z0-9] replaced by "-". The mapping is lossy ("_", ".",
// " ", "-" and non-ASCII all collapse to "-"), so a name cannot be decoded by
// splitting on "-". Orphan detection therefore prefers hard evidence (the `cwd`
// recorded in the session transcripts) and only falls back to matching the name
// against what actually exists on disk. A name that cannot be resolved either
// way is reported as unknown, never as orphan: being wrong here means a live
// project's history lands in the default-clean circle.
export function encodeCwd(cwd) {
  return String(cwd).replace(/[^a-zA-Z0-9]/g, '-');
}

const TRANSCRIPT_FILES = 8;
const TRANSCRIPT_BYTES = 256 * 1024;
const PROBE_DIR_LIMIT = 2000;

async function recordedCwds(sessionDir) {
  const entries = await listDir(sessionDir);
  const files = entries
    .filter((e) => e.isFile() && e.name.endsWith('.jsonl'))
    .map((e) => path.join(sessionDir, e.name))
    .slice(0, TRANSCRIPT_FILES);
  const cwds = new Set();
  for (const file of files) {
    const text = await readText(file, TRANSCRIPT_BYTES);
    if (!text) continue;
    for (const line of text.split('\n')) {
      if (!line.includes('"cwd"')) continue;
      try {
        const record = JSON.parse(line);
        if (record && typeof record.cwd === 'string' && record.cwd) cwds.add(record.cwd);
      } catch {
        // Partial trailing line or a non-JSON record.
      }
    }
  }
  return [...cwds];
}

async function probeEncodedPath(encoded) {
  // Depth-first walk from the filesystem root, descending only into children
  // whose encoded name is a prefix of the remaining encoded string.
  let budget = PROBE_DIR_LIMIT;

  async function walk(dir, rest) {
    if (rest === '') return dir;
    if (budget <= 0) return null;
    budget -= 1;
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return null;
    }
    for (const entry of entries) {
      if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;
      const enc = encodeCwd(entry.name);
      if (rest === enc) return path.join(dir, entry.name);
      if (rest.startsWith(enc + '-')) {
        const found = await walk(path.join(dir, entry.name), rest.slice(enc.length + 1));
        if (found) return found;
      }
    }
    return null;
  }

  // The leading "-" encodes the root separator.
  if (!encoded.startsWith('-')) return null;
  return walk(path.sep, encoded.slice(1));
}

export async function resolveEncodedCwd(encoded, { platform = PLATFORM, sessionDir = null } = {}) {
  const name = String(encoded);

  if (sessionDir) {
    const matching = (await recordedCwds(sessionDir)).filter((cwd) => encodeCwd(cwd) === name);
    if (matching.length > 0) {
      for (const cwd of matching) {
        if (await exists(cwd)) return { status: 'live', resolved: cwd, evidence: 'transcript-cwd' };
      }
      return { status: 'orphan', resolved: null, at: matching[0], evidence: 'transcript-cwd' };
    }
  }

  if (platform === 'win32') return { status: 'unknown', resolved: null, evidence: null };

  const found = await probeEncodedPath(name);
  if (found) return { status: 'live', resolved: found, evidence: 'filesystem-probe' };
  // No transcript evidence and no matching path: the encoding may be truncated,
  // a parent may be unreadable, or the name may not be an encoded cwd at all.
  return { status: 'unknown', resolved: null, evidence: null };
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
    const resolved = await resolveEncodedCwd(name, { sessionDir: unitPath });
    if (resolved.status === 'unknown') return { orphan: false, reason: 'unresolved-encoding', detail: null };
    if (resolved.status === 'orphan') {
      return { orphan: true, reason: 'host-project-missing', detail: resolved.at ? displayPath(resolved.at) : null };
    }
    return { orphan: false, reason: 'host-project-present', detail: displayPath(resolved.resolved) };
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