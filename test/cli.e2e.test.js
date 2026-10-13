import { test } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

const execFileAsync = promisify(execFile);
const BIN = fileURLToPath(new URL('../bin/agent-sweep.js', import.meta.url));

async function withHome(fn) {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), 'sweep-e2e-'));
  const env = { ...process.env, AGENT_SWEEP_HOME_DIR: home, AGENT_SWEEP_HOME: home, NO_COLOR: '1' };
  try {
    return await fn(home, env);
  } finally {
    await fs.rm(home, { recursive: true, force: true });
  }
}

async function runCli(args, env) {
  const { stdout } = await execFileAsync(process.execPath, [BIN, ...args], { env, maxBuffer: 32 * 1024 * 1024 });
  return stdout;
}

test('version prints the package version', async () => {
  await withHome(async (_home, env) => {
    const stdout = await runCli(['version'], env);
    assert.match(stdout, /^agent-sweep \d+\.\d+\.\d+/);
  });
});

test('help exits cleanly with usage text', async () => {
  await withHome(async (_home, env) => {
    const stdout = await runCli(['help'], env);
    assert.ok(stdout.includes('用法'));
    assert.ok(stdout.includes('scan'));
    assert.ok(stdout.includes('安全模型'));
  });
});

test('harnesses --json lists the registry', async () => {
  await withHome(async (_home, env) => {
    const payload = JSON.parse(await runCli(['harnesses', '--json', '--no-color'], env));
    assert.equal(payload.schema, 'agent-sweep/harnesses@1');
    assert.ok(payload.harnesses.length >= 8);
    assert.ok(payload.harnesses.every((h) => h.id && Array.isArray(h.targets)));
  });
});

test('scan --json against an empty home reports nothing reclaimable', async () => {
  await withHome(async (_home, env) => {
    const payload = JSON.parse(await runCli(['scan', '--json', '--no-color', '--no-active-check'], env));
    assert.equal(payload.schema, 'agent-sweep/report@1');
    assert.equal(payload.totals.unitCount, 0);
    assert.equal(payload.totals.reclaimableBytes, 0);
  });
});

test('plan --json against an empty home yields an empty plan', async () => {
  await withHome(async (_home, env) => {
    const payload = JSON.parse(await runCli(['plan', '--json', '--no-color', '--no-active-check'], env));
    assert.equal(payload.plan.totals.actionCount, 0);
    assert.equal(payload.plan.actions.length, 0);
  });
});

test('clean --dry-run --json never writes a batch', async () => {
  await withHome(async (home, env) => {
    const payload = JSON.parse(await runCli(['clean', '--dry-run', '--json', '--no-color', '--no-active-check'], env));
    assert.equal(payload.plan.totals.actionCount, 0);
    assert.equal(payload.execution, null);
    const trashRoot = path.join(home, 'trash');
    assert.equal(await fs.stat(trashRoot).then(() => true, () => false), false);
  });
});

test('doctor --json reports environment checks', async () => {
  await withHome(async (_home, env) => {
    const payload = JSON.parse(await runCli(['doctor', '--json', '--no-color', '--no-active-check'], env));
    assert.equal(payload.schema, 'agent-sweep/doctor@1');
    assert.ok(Array.isArray(payload.checks));
    assert.ok(payload.checks.some((c) => c.label.includes('Node.js')));
  });
});

test('an unknown command exits non-zero', async () => {
  await withHome(async (_home, env) => {
    await assert.rejects(() => runCli(['frobnicate'], env), (err) => err.code === 2);
  });
});
test('a closed stdout pipe exits cleanly instead of crashing', { skip: process.platform === 'win32' && 'EPIPE semantics differ on Windows' }, async () => {
  await withHome(async (_home, env) => {
    const child = spawn(process.execPath, [BIN, 'harnesses', '--verbose'], { env, stdio: ['ignore', 'pipe', 'pipe'] });
    let stderr = '';
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.stdout.once('data', () => child.stdout.destroy());
    const code = await new Promise((resolve) => child.on('close', resolve));
    assert.equal(code, 0);
    assert.doesNotMatch(stderr, /EPIPE|Unhandled/);
  });
});
