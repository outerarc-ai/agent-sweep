import path from 'node:path';
import { ALL_HARNESSES } from './harnesses/index.js';
import { expandPath, uniquePaths, collapseHome } from '../lib/paths.js';
import { buildGuardSet } from '../safety/guards.js';
import { PLATFORM } from '../lib/platform.js';

export const UNIT_MODES = new Set(['child-dir', 'child-entry', 'nested-dir', 'glob-file', 'dir']);
export const RISK_LEVELS = new Set(['low', 'medium', 'high']);

export class RegistryError extends Error {
  constructor(message) {
    super(message);
    this.name = 'RegistryError';
  }
}

export function validateHarness(harness) {
  const problems = [];
  const require = (condition, message) => {
    if (!condition) problems.push(message);
  };

  require(typeof harness.id === 'string' && harness.id.length > 0, 'id is required');
  require(typeof harness.name === 'string' && harness.name.length > 0, `${harness.id}: name is required`);
  require(Array.isArray(harness.platforms) && harness.platforms.length > 0, `${harness.id}: platforms must be a non-empty array`);
  require(Number.isFinite(harness.defaultTTL) && harness.defaultTTL > 0, `${harness.id}: defaultTTL must be a positive number`);
  require(RISK_LEVELS.has(harness.risk), `${harness.id}: risk must be one of low|medium|high`);
  require(Array.isArray(harness.targets) && harness.targets.length > 0, `${harness.id}: targets must be a non-empty array`);

  const seenTargets = new Set();
  for (const target of harness.targets || []) {
    const prefix = `${harness.id}/${target.id}`;
    require(typeof target.id === 'string' && target.id.length > 0, `${harness.id}: target.id is required`);
    require(!seenTargets.has(target.id), `${harness.id}: duplicate target id ${target.id}`);
    seenTargets.add(target.id);
    require(UNIT_MODES.has(target.unit), `${prefix}: unit must be one of ${[...UNIT_MODES].join('|')}`);
    require(Array.isArray(target.paths) && target.paths.length > 0, `${prefix}: paths must be a non-empty array`);
    require(typeof target.removable === 'boolean', `${prefix}: removable must be a boolean`);
    require(target.kind && typeof target.kind === 'string', `${prefix}: kind is required`);
    if (target.unit === 'nested-dir') {
      require(Number.isInteger(target.depth) && target.depth >= 2, `${prefix}: nested-dir requires depth >= 2`);
    }
    if (target.unit === 'glob-file') {
      require(typeof target.pattern === 'string' && target.pattern.length > 0, `${prefix}: glob-file requires pattern`);
    }
  }

  if (problems.length > 0) {
    throw new RegistryError(`invalid harness descriptor:\n  - ${problems.join('\n  - ')}`);
  }
  return harness;
}

export function loadRegistry({ harnesses = ALL_HARNESSES } = {}) {
  const ids = new Set();
  const aliases = new Map();
  const validated = [];

  for (const harness of harnesses) {
    validateHarness(harness);
    if (ids.has(harness.id)) throw new RegistryError(`duplicate harness id: ${harness.id}`);
    ids.add(harness.id);
    for (const alias of harness.aliases || []) {
      if (aliases.has(alias)) throw new RegistryError(`duplicate harness alias: ${alias}`);
      aliases.set(alias, harness.id);
    }
    validated.push(harness);
  }

  return {
    harnesses: validated,
    byId: new Map(validated.map((h) => [h.id, h])),
    aliases,
    resolve(name) {
      if (!name) return null;
      const key = String(name).toLowerCase();
      if (ids.has(key)) return this.byId.get(key);
      const mapped = aliases.get(key);
      return mapped ? this.byId.get(mapped) : null;
    },
  };
}

export function availableHarnesses(registry, platform = PLATFORM) {
  return registry.harnesses.filter((h) => (h.platforms || []).includes(platform));
}

export function resolveTargetPaths(target) {
  return uniquePaths((target.paths || []).map(expandPath));
}

export function describeTarget(target, { home } = {}) {
  return {
    id: target.id,
    kind: target.kind,
    label: target.label,
    unit: target.unit,
    depth: target.depth,
    pattern: target.pattern,
    removable: target.removable,
    orphan: target.orphan ? target.orphan.type : 'none',
    paths: resolveTargetPaths(target).map((p) => collapseHome(p, home)),
  };
}

export function describeHarness(harness, { home } = {}) {
  return {
    id: harness.id,
    name: harness.name,
    vendor: harness.vendor,
    kind: harness.kind,
    aliases: harness.aliases || [],
    platforms: harness.platforms,
    defaultTTL: harness.defaultTTL,
    risk: harness.risk,
    deleteEnabled: Boolean(harness.deleteEnabled),
    docs: harness.docs,
    summary: harness.summary,
    neverDelete: (harness.neverDelete || []).map((p) => collapseHome(expandPath(p), home)),
    notes: harness.notes || [],
    targets: (harness.targets || []).map((t) => describeTarget(t, { home })),
  };
}

export function buildRegistryGuards(registry) {
  return buildGuardSet(registry.harnesses);
}

export function registryRoots(harness) {
  const roots = [];
  for (const target of harness.targets || []) {
    for (const p of resolveTargetPaths(target)) {
      roots.push({ target, path: p });
    }
  }
  return roots;
}

export function relativeLabel(absPath, home) {
  return collapseHome(path.normalize(absPath), home);
}