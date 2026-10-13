#!/usr/bin/env node
// Verifies what `npm publish` would ship: every runtime entry point is present,
// and nothing development-only (tests, scripts, CI config) leaks into the tarball.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));

const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const out = execFileSync(npm, ['pack', '--dry-run', '--json', '--ignore-scripts'], {
  cwd: ROOT,
  encoding: 'utf8',
  shell: process.platform === 'win32',
});
const [report] = JSON.parse(out);
const shipped = new Set(report.files.map((f) => f.path.split(path.sep).join('/')));

const required = [
  'package.json',
  'LICENSE',
  'README.md',
  'README.zh-CN.md',
  'CHANGELOG.md',
  pkg.main.replace(/^\.\//, ''),
  ...Object.values(pkg.bin).map((p) => p.replace(/^\.\//, '')),
  'src/web/public/index.html',
  'src/web/public/app.js',
  'src/web/public/i18n.js',
  'src/web/public/styles.css',
];
const forbidden = [/^test\//, /^scripts\//, /^\.github\//, /(^|\/)\.env/, /\.log$/];

const problems = [];
for (const file of required) {
  if (!shipped.has(file)) problems.push(`missing from tarball: ${file}`);
}
for (const file of shipped) {
  if (forbidden.some((re) => re.test(file))) problems.push(`must not be published: ${file}`);
}

const kb = (report.size / 1024).toFixed(1);
process.stdout.write(`agent-sweep pack-check · ${shipped.size} files · ${kb} KB packed\n`);
if (problems.length > 0) {
  for (const p of problems) process.stdout.write(`  ✗ ${p}\n`);
  process.exit(1);
}
process.stdout.write('OK\n');
