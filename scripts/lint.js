#!/usr/bin/env node
// Dependency-free static checks: package hygiene, module loading and a few
// source heuristics. Exits non-zero when a blocking problem is found.
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const SRC = path.join(ROOT, 'src');

// Browser assets ship as plain files under src/web/public and are never imported
// by Node, so they are exempt from the module-load and heuristic checks below.
const SKIP_DIRS = new Set([path.join(SRC, 'web', 'public')]);

const problems = [];
const warnings = [];

const rel = (p) => path.relative(ROOT, p);

async function collect(dir, out = []) {
  if (SKIP_DIRS.has(dir)) return out;
  const entries = await fs.readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) await collect(full, out);
    else if (entry.isFile() && entry.name.endsWith('.js')) out.push(full);
  }
  return out;
}

const pkg = JSON.parse(await fs.readFile(path.join(ROOT, 'package.json'), 'utf8'));
if (pkg.type !== 'module') problems.push('package.json must set "type": "module"');
if (Object.keys(pkg.dependencies || {}).length > 0) {
  problems.push('package.json declares runtime dependencies; agent-sweep must stay dependency-free');
}
if (Object.keys(pkg.devDependencies || {}).length > 0) {
  warnings.push('package.json declares devDependencies; the project is expected to have none');
}
if (!pkg.bin || !pkg.bin['agent-sweep']) problems.push('package.json is missing the agent-sweep bin entry');
if (!pkg.engines || !pkg.engines.node) problems.push('package.json is missing an engines.node constraint');

const files = await collect(SRC);
for (const file of files) {
  try {
    await import(pathToFileURL(file).href);
  } catch (err) {
    problems.push(`${rel(file)} failed to load: ${err.message}`);
  }
}

const FORBIDDEN = [
  { re: /\bconsole\.log\(/, msg: 'uses console.log instead of the shared logger' },
  { re: /\bexecSync\b/, msg: 'uses blocking execSync' },
  { re: /\brequire\(\s*['"]/, msg: 'uses CommonJS require inside an ESM module' },
  { re: /rm\s+-rf/, msg: 'contains a raw "rm -rf" shell string' },
];

for (const file of files) {
  const text = await fs.readFile(file, 'utf8');
  for (const rule of FORBIDDEN) {
    if (rule.re.test(text)) warnings.push(`${rel(file)}: ${rule.msg}`);
  }
}

/* ---------------- i18n checks (src/web/public) ----------------
 * The browser SPA keeps all copy in i18n.js (zh-CN + en-US tables) and
 * looks it up via t('key') in app.js. These checks keep the call sites
 * and both locale tables consistent so a missing translation can never
 * silently degrade to a raw key at runtime.
 */
const i18nFile = path.join(SRC, 'web', 'public', 'i18n.js');
const appFile = path.join(SRC, 'web', 'public', 'app.js');

function localeKeys(text, marker, endPattern) {
  const markerAt = text.indexOf(marker);
  if (markerAt < 0) return null;
  const openAt = text.indexOf('{', markerAt);
  const endAt = endPattern ? text.indexOf(endPattern, openAt) : text.length;
  if (openAt < 0 || (endPattern && endAt < 0)) return null;
  const block = text.slice(openAt + 1, endAt);
  const keys = new Set();
  const re = /^[ \t]*(?:'([\w.\-]+)'|"([\w.\-]+)"|(\w+))\s*:/gm;
  let m;
  while ((m = re.exec(block)) !== null) keys.add(m[1] || m[2] || m[3]);
  return keys;
}

const i18nText = await fs.readFile(i18nFile, 'utf8');
const appText = await fs.readFile(appFile, 'utf8');

const zhKeys = localeKeys(i18nText, "'zh-CN':", "'en-US':");
const enKeys = localeKeys(i18nText, "'en-US':", '\n  };');
if (!zhKeys) problems.push('i18n.js: zh-CN locale table not found');
if (!enKeys) problems.push('i18n.js: en-US locale table not found');

if (zhKeys && enKeys) {
  for (const key of [...zhKeys].sort()) {
    if (!enKeys.has(key)) problems.push(`i18n.js: key "${key}" missing from en-US`);
  }
  for (const key of [...enKeys].sort()) {
    if (!zhKeys.has(key)) problems.push(`i18n.js: key "${key}" missing from zh-CN`);
  }

  // Literal t('key') call sites must resolve in both locales.
  const referenced = new Set();
  const litRe = /\bt\(\s*(['"])([\w.\-]+)\1\s*[,)]/g;
  let m;
  while ((m = litRe.exec(appText)) !== null) referenced.add(m[2]);
  for (const key of [...referenced].sort()) {
    if (!zhKeys.has(key)) problems.push(`app.js: t('${key}') has no zh-CN entry`);
    if (!enKeys.has(key)) problems.push(`app.js: t('${key}') has no en-US entry`);
  }

  // Dynamic t(`family.${code}`) call sites: every known enum value of the
  // family must be translated in both locales.
  const dynRe = /\bt\(\s*`(\w+)\.\$\{/g;
  const families = new Set();
  while ((m = dynRe.exec(appText)) !== null) families.add(m[1]);
  // Enum values are the full key suffix after the family prefix, so
  // t(`step.${id}.label`) is expressed as 'scan.label', 'select.hint', …
  const familyEnums = {
    circle: ['safe', 'review', 'protected', 'keep'],
    reason: [
      'hard-guard', 'target-report-only', 'contains-protected', 'in-use',
      'within-ttl', 'below-min-size', 'orphan', 'stale', 'asset-file',
      'sensitive-name',
    ],
    step: [
      'scan.label', 'scan.hint', 'select.label', 'select.hint',
      'plan.label', 'plan.hint', 'execute.label', 'execute.hint',
      'trash.label', 'trash.hint',
    ],
  };
  for (const family of families) {
    const enums = familyEnums[family];
    if (!enums) {
      problems.push(`i18n: unknown dynamic family "${family}"; add its enum list to lint.js`);
      continue;
    }
    for (const code of enums) {
      const key = `${family}.${code}`;
      if (!zhKeys.has(key)) problems.push(`i18n.js: dynamic key "${key}" missing from zh-CN`);
      if (!enKeys.has(key)) problems.push(`i18n.js: dynamic key "${key}" missing from en-US`);
    }
  }

  process.stdout.write(`i18n · ${zhKeys.size} keys × 2 locales · ${referenced.size} referenced · ${families.size} dynamic families\n`);
}

process.stdout.write(`agent-sweep lint · ${files.length} modules checked\n`);
for (const warning of warnings) process.stdout.write(`  ! ${warning}\n`);
for (const problem of problems) process.stdout.write(`  ✗ ${problem}\n`);

if (problems.length > 0) {
  process.stdout.write(`\n${problems.length} problem(s) found.\n`);
  process.exitCode = 1;
} else {
  process.stdout.write('\nOK\n');
}