import path from 'node:path';
import fs from 'node:fs/promises';
import { expandPath, toPosix, isPathInside } from '../lib/paths.js';
import { homedir } from '../lib/platform.js';
import { globToRegExp } from '../lib/matcher.js';

const WILDCARD_CHARS = new Set(['*', '?', '{', '[']);

export const GLOBAL_PROTECTED_PATHS = Object.freeze([
  '~/.claude.json',
  '~/.claude/settings.json',
  '~/.claude/settings.local.json',
  '~/.claude/history.jsonl',
  '~/.claude/plugins/**',
  '~/.claude/commands/**',
  '~/.claude/agents/**',
  '~/.claude/skills/**',
  '~/.claude/projects/*/memory/**',
  '~/.codex/config.toml',
  '~/.codex/AGENTS.md',
  '~/.codex/history.jsonl',
  '~/.codex/memories/**',
  '~/.codex/prompts/**',
  '~/.cursor/mcp.json',
  '~/.cursor/rules/**',
  '~/.cursor/argv.json',
  '~/.codeium/windsurf/memories/**',
  '~/.codeium/windsurf/mcp_config.json',
  '~/.codeium/windsurf/global_rules.md',
  '~/.copilot/config.json',
  '~/.copilot/mcp-config.json',
  '~/.trae-cn/mcps/**',
  '~/.trae-cn/plugins/**',
  '~/.trae-cn/permission/**',
  '~/.trae-cn/memory/**',
  '~/.trae-cn/skills/**',
  '~/.trae-cn/memory-config.json',
  '~/.trae-cn/argv.json',
  '~/.trae/mcps/**',
  '~/.trae/plugins/**',
  '~/.trae/skills/**',
  '~/.gemini/settings.json',
  '~/.gemini/oauth_creds.json',
  '~/.continue/config.yaml',
  '~/.continue/config.json',
  '~/.aider.conf.yml',
  '~/.config/goose/config.yaml',
  '~/.config/opencode/**',
  '~/.local/share/opencode/auth.json',
  '~/.agents/**',
]);

export const GLOBAL_PROTECTED_BASENAMES = Object.freeze([
  'CLAUDE.md',
  'AGENTS.md',
  '.mcp.json',
  '.clinerules',
  '.cursorrules',
  '.aider.conf.yml',
  '.worktreeinclude',
]);

const SENSITIVE_RE = /(^|[._-])(credentials?|secrets?|tokens?|apikey|api[_-]?key|passwords?|passwd|oauth|auth)([._-]|$)/i;
const ENV_FILE_RE = /^\.env(\.[a-z0-9]+)?$/i;
const ENV_TEMPLATE_RE = /\.(example|sample|template|dist|defaults?)$/i;

function isSensitiveName(base) {
  if (ENV_TEMPLATE_RE.test(base)) return false;
  return ENV_FILE_RE.test(base) || SENSITIVE_RE.test(base);
}

export function staticPrefix(pattern) {
  const posix = toPosix(pattern);
  let index = posix.length;
  for (let i = 0; i < posix.length; i += 1) {
    if (WILDCARD_CHARS.has(posix[i])) {
      index = i;
      break;
    }
  }
  const head = posix.slice(0, index);
  const lastSlash = head.lastIndexOf('/');
  const prefix = lastSlash === -1 ? head : head.slice(0, lastSlash);
  return prefix || '/';
}

function withDirVariants(pattern) {
  const out = [pattern];
  if (pattern.endsWith('/**')) out.push(pattern.slice(0, -3));
  return out;
}

function toEntry(pattern, reason) {
  const expanded = expandPath(pattern);
  return {
    pattern: expanded,
    posixPattern: toPosix(expanded),
    regex: globToRegExp(expanded),
    prefix: staticPrefix(expanded),
    reason,
  };
}

export function buildGuardSet(harnesses = []) {
  const entries = [];
  for (const pattern of GLOBAL_PROTECTED_PATHS) {
    for (const variant of withDirVariants(pattern)) entries.push(toEntry(variant, 'global-guard'));
  }
  for (const harness of harnesses) {
    for (const pattern of harness.neverDelete || []) {
      for (const variant of withDirVariants(pattern)) entries.push(toEntry(variant, `harness-guard:${harness.id}`));
    }
  }
  return {
    entries,
    basenames: new Set(GLOBAL_PROTECTED_BASENAMES.map((n) => n.toLowerCase())),
  };
}

function matchGuard(absPath, guardSet) {
  const base = path.basename(absPath);
  if (guardSet.basenames.has(base.toLowerCase())) {
    return { reason: `asset-file:${base}`, pattern: null };
  }
  if (isSensitiveName(base)) {
    return { reason: `sensitive-name:${base}`, pattern: null };
  }
  const posix = toPosix(path.normalize(absPath));
  for (const entry of guardSet.entries) {
    if (entry.regex.test(posix)) {
      return { reason: entry.reason, pattern: entry.pattern };
    }
  }
  return null;
}

// Containment only consults curated harness paths: a filename heuristic must never
// block a whole session directory (e.g. a repo copy that happens to contain .env.example).
function matchGuardDescendant(absPath, guardSet) {
  const posix = toPosix(path.normalize(absPath));
  for (const entry of guardSet.entries) {
    if (entry.regex.test(posix)) {
      return { reason: entry.reason, pattern: entry.pattern };
    }
  }
  return null;
}

async function probeSubtree(absPath, guardSet, { maxDepth = 2, maxEntries = 5000 } = {}) {
  const stack = [{ dir: absPath, depth: 0 }];
  let seen = 0;
  while (stack.length > 0) {
    const { dir, depth } = stack.pop();
    if (depth >= maxDepth) continue;
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      seen += 1;
      if (seen > maxEntries) return null;
      const full = path.join(dir, entry.name);
      const hit = matchGuardDescendant(full, guardSet);
      if (hit) return { path: full, ...hit };
      if (entry.isDirectory() && !entry.isSymbolicLink()) stack.push({ dir: full, depth: depth + 1 });
    }
  }
  return null;
}

export async function evaluateProtection(absPath, guardSet, { home = homedir(), deep = true } = {}) {
  const direct = matchGuard(absPath, guardSet);
  if (direct) {
    return { protected: true, reason: direct.reason, matchedPattern: direct.pattern, detail: null };
  }

  for (const entry of guardSet.entries) {
    if (!entry.prefix || entry.prefix === '/') continue;
    if (entry.prefix === absPath) continue;
    if (!isPathInside(absPath, entry.prefix)) continue;
    try {
      const st = await fs.lstat(entry.prefix);
      if (st) {
        return {
          protected: true,
          reason: 'contains-protected',
          matchedPattern: entry.pattern,
          detail: entry.prefix.replace(home, '~'),
        };
      }
    } catch {
      continue;
    }
  }

  if (deep) {
    const st = await fs.lstat(absPath).catch(() => null);
    if (st && st.isDirectory()) {
      const hit = await probeSubtree(absPath, guardSet);
      if (hit) {
        return {
          protected: true,
          reason: 'contains-protected',
          matchedPattern: hit.pattern,
          detail: hit.path.replace(home, '~'),
        };
      }
    }
  }

  return { protected: false, reason: null };
}

export function describeGuards(guardSet, { home = homedir() } = {}) {
  return guardSet.entries.map((entry) => ({
    pattern: entry.pattern.replace(home, '~'),
    reason: entry.reason,
  }));
}