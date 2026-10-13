import { test } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';
import { execFile } from 'node:child_process';
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

test('plan --save writes a plan file that clean --plan-file executes with re-verification', async () => {
  await withHome(async (home, env) => {
    const workDir = path.join(home, '.trae-cn', 'work');
    const s1 = path.join(workDir, 's1');
    const s2 = path.join(workDir, 's2');
    const payload = Buffer.alloc(1024 * 1024);
    const old = new Date(Date.now() - 40 * 24 * 3600 * 1000);
    for (const dir of [s1, s2]) {
      await fs.mkdir(dir, { recursive: true });
      const file = path.join(dir, 'payload.bin');
      await fs.writeFile(file, payload);
      await fs.utimes(file, old, old);
    }

    const planFile = path.join(home, 'plan.json');
    await runCli(['plan', '--save', planFile, '--include-review', '--no-color', '--no-active-check'], env);
    const saved = JSON.parse(await fs.readFile(planFile, 'utf8'));
    assert.equal(saved.schema, 'agent-sweep/plan@1');
    assert.equal(saved.totals.actionCount, 2);

    // The unit disappears between planning and execution: it must be skipped by re-verification.
    await fs.rm(s2, { recursive: true });

    const out = JSON.parse(await runCli(['clean', '--plan-file', planFile, '--yes', '--json', '--no-color', '--no-active-check'], env));
    assert.equal(out.execution.moved.length, 1);
    assert.match(out.execution.moved[0].path, /s1$/);
    assert.equal(out.execution.skipped.length, 1);
    assert.equal(out.execution.skipped[0].reason, 'missing');
    assert.match(out.execution.skipped[0].path, /s2$/);

    const batches = await fs.readdir(path.join(home, 'trash'));
    assert.equal(batches.length, 1);
    const manifest = JSON.parse(await fs.readFile(path.join(home, 'trash', batches[0], 'manifest.json'), 'utf8'));
    assert.equal(manifest.entries.length, 1);
    assert.equal(manifest.entries[0].originalPath, s1);
  });
});

test('clean --plan-file exits 2 on a version-mismatched plan file', async () => {
  await withHome(async (home, env) => {
    const bad = path.join(home, 'bad.json');
    await fs.writeFile(bad, JSON.stringify({ schema: 'agent-sweep/plan@2', actions: [] }), 'utf8');
    await assert.rejects(
      () => runCli(['clean', '--plan-file', bad, '--yes', '--no-color'], env),
      (err) => err.code === 2,
    );
  });
});

test('an unknown command exits non-zero', async () => {
  await withHome(async (_home, env) => {
    await assert.rejects(() => runCli(['frobnicate'], env), (err) => err.code === 2);
  });
});