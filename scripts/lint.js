#!/usr/bin/env node
// Dependency-free static checks: package hygiene, module loading and a few
// source heuristics. Exits non-zero when a blocking problem is found.
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const SRC = path.join(ROOT, 'src');

const problems = [];
const warnings = [];

const rel = (p) => path.relative(ROOT, p);

async function collect(dir, out = []) {
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

process.stdout.write(`agent-sweep lint · ${files.length} modules checked\n`);
for (const warning of warnings) process.stdout.write(`  ! ${warning}\n`);
for (const problem of problems) process.stdout.write(`  ✗ ${problem}\n`);

if (problems.length > 0) {
  process.stdout.write(`\n${problems.length} problem(s) found.\n`);
  process.exitCode = 1;
} else {
  process.stdout.write('\nOK\n');
}