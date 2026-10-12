import { loadRegistry, buildRegistryGuards } from '../core/registry.js';
import { scan } from '../core/scanner.js';
import { analyzeUnits, summarize } from '../core/analyzer.js';
import { resolveStrategy } from '../lib/strategy.js';
import { collectOpenFiles } from '../lib/process.js';
import { createTrash, defaultTrashRoot } from '../core/trash.js';
import { homedir, PLATFORM } from '../lib/platform.js';

export function buildStrategy(flags) {
  const overrides = {};
  if (flags.minSizeBytes !== undefined && flags.minSizeBytes !== null) {
    overrides.minSizeBytes = flags.minSizeBytes;
    overrides.enforceMinSize = flags.minSizeBytes > 0;
  }
  if (Number.isFinite(flags.minScoreValue)) overrides.minScore = flags.minScoreValue;
  return resolveStrategy(overrides);
}

export function buildScanOptions(flags) {
  const ttlSpecs = flags.ttlSpecs || { global: null, overrides: {} };
  const globalTtl = flags.olderThanDays || ttlSpecs.global || null;
  return {
    harnessIds: flags.harness || null,
    ttlOverrides: ttlSpecs.overrides,
    globalTtl,
    concurrency: Number.isFinite(flags.concurrencyValue) ? flags.concurrencyValue : 8,
    includeReportOnly: flags.includeReportOnly !== false,
    platform: PLATFORM,
  };
}

export async function createContext({ flags, positionals, logger }) {
  const registry = loadRegistry();
  const guardSet = buildRegistryGuards(registry);
  const home = homedir();
  const strategy = buildStrategy(flags);
  const scanOptions = buildScanOptions(flags);
  const trash = createTrash({ root: flags.trashRoot || defaultTrashRoot() });

  let activeCache = null;

  async function loadActiveFiles() {
    if (flags.noActiveCheck) {
      return { supported: false, paths: [], byPath: new Map(), reason: 'disabled-by-flag' };
    }
    if (activeCache) return activeCache;
    activeCache = await collectOpenFiles();
    return activeCache;
  }

  async function scanAndAnalyze() {
    const openFiles = await loadActiveFiles();
    if (!openFiles.supported && openFiles.reason && openFiles.reason !== 'disabled-by-flag') {
      logger.warn(`进程占用检测不可用（${openFiles.reason}），活跃判定将退化为不可用`);
    }
    const scanResult = await scan(registry, {
      ...scanOptions,
      home,
      guardSet,
      openFiles,
    });
    const units = analyzeUnits(scanResult.units, { now: Date.now(), strategy });
    const summary = summarize(units, { now: Date.now() });
    return { scan: scanResult, units, summary, openFiles };
  }

  return {
    flags,
    positionals,
    logger,
    registry,
    guardSet,
    home,
    strategy,
    scanOptions,
    trash,
    loadActiveFiles,
    scanAndAnalyze,
  };
}