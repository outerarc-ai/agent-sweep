import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { createWebServer } from '../src/web/server.js';
import { silentLogger } from '../src/lib/log.js';

const DAY = 86400000;

async function writeOld(file, days, content = 'x') {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, content);
  const when = new Date(Date.now() - days * DAY);
  await fs.utimes(file, when, when);
}

async function buildFixture(home) {
  await writeOld(path.join(home, '.trae-cn', 'work', 'sess-1', 'out.txt'), 40);
  await writeOld(path.join(home, '.trae-cn', 'work', 'sess-2', 'out.txt'), 40);
  const orphanWt = path.join(home, '.trae-cn', 'worktrees', 'proj', 'orphan-branch');
  await fs.mkdir(orphanWt, { recursive: true });
  await writeOld(path.join(orphanWt, '.git'), 40, `gitdir: ${path.join(home, 'gone-repo', '.git', 'worktrees', 'orphan-branch')}\n`);
  await writeOld(path.join(orphanWt, 'work.txt'), 40);
  await writeOld(path.join(home, '.claude', 'projects', '-no-such-host-zzz', 'session.jsonl'), 40);
  return { orphanWt };
}

function makeRequest(base) {
  return async function request(pathname, { method = 'GET', token, body, origin } = {}) {
    const headers = {};
    if (token) headers['x-agent-sweep-token'] = token;
    if (origin) headers.origin = origin;
    if (body !== undefined) headers['content-type'] = 'application/json';
    const res = await fetch(base + pathname, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    let data = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = text;
    }
    return { status: res.status, data, text, headers: res.headers };
  };
}

async function withServer(run) {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), 'sweep-web-home-'));
  const state = await fs.mkdtemp(path.join(os.tmpdir(), 'sweep-web-state-'));
  const prevHome = process.env.AGENT_SWEEP_HOME_DIR;
  const prevState = process.env.AGENT_SWEEP_HOME;
  process.env.AGENT_SWEEP_HOME_DIR = home;
  process.env.AGENT_SWEEP_HOME = state;
  await buildFixture(home);

  const { server, token } = createWebServer({ baseFlags: {}, version: 'test', logger: silentLogger });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  const base = `http://127.0.0.1:${port}`;

  try {
    await run({ base, token, home, request: makeRequest(base) });
  } finally {
    await new Promise((resolve) => server.close(resolve));
    if (prevHome === undefined) delete process.env.AGENT_SWEEP_HOME_DIR;
    else process.env.AGENT_SWEEP_HOME_DIR = prevHome;
    if (prevState === undefined) delete process.env.AGENT_SWEEP_HOME;
    else process.env.AGENT_SWEEP_HOME = prevState;
    await fs.rm(home, { recursive: true, force: true });
    await fs.rm(state, { recursive: true, force: true });
  }
}

async function waitForJob(request, token, id, timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const res = await request(`/api/jobs/${id}`, { token });
    assert.equal(res.status, 200, 'job lookup should succeed');
    if (res.data.state !== 'running') return res.data;
    if (Date.now() > deadline) throw new Error('scan job did not finish in time');
    await new Promise((resolve) => setTimeout(resolve, 80));
  }
}

test('web ui serves the shell and enforces the session token', async () => {
  await withServer(async ({ request, token }) => {
    const shell = await request('/');
    assert.equal(shell.status, 200);
    assert.match(shell.text, /agent-sweep/);
    assert.ok(!shell.text.includes('__AGENT_SWEEP_BOOTSTRAP__'), 'bootstrap placeholder must be replaced');
    assert.ok(shell.text.includes(token), 'session token must be injected into the page');

    const anonymous = await request('/api/state');
    assert.equal(anonymous.status, 403);

    const authed = await request('/api/state', { token });
    assert.equal(authed.status, 200);
    assert.ok(authed.data.harnesses.length >= 8, 'state should describe the built-in harnesses');
    assert.equal(authed.data.schema, 'agent-sweep/ui-state@1');
  });
});

test('web ui rejects cross-origin api calls and path traversal', async () => {
  await withServer(async ({ request, token, base }) => {
    const crossOrigin = await request('/api/state', { token, origin: 'http://evil.example' });
    assert.equal(crossOrigin.status, 403);

    const sameOrigin = await request('/api/state', { token, origin: base });
    assert.equal(sameOrigin.status, 200);

    const asset = await request('/styles.css');
    assert.equal(asset.status, 200);
    assert.match(asset.headers.get('content-type') || '', /text\/css/);

    const traversal = await request('/%2e%2e/package.json');
    assert.ok(traversal.status === 404 || traversal.status === 403, 'traversal must not resolve');
    assert.ok(!String(traversal.text).includes('"name": "agent-sweep"'), 'must not leak package.json');
  });
});

test('web ui runs the full scan → dry-run → execute → restore flow', async () => {
  await withServer(async ({ request, token, home }) => {
    const scanStart = await request('/api/scan', {
      method: 'POST',
      token,
      body: { harnessIds: ['trae', 'claude-code'], minSizeBytes: 0, noActiveCheck: true },
    });
    assert.equal(scanStart.status, 202);
    assert.ok(scanStart.data.jobId);

    const job = await waitForJob(request, token, scanStart.data.jobId);
    assert.equal(job.state, 'done', job.error || 'scan should complete');
    assert.equal(job.result.schema, 'agent-sweep/ui-scan@1');
    assert.ok(job.result.units.length >= 4, `expected synthetic units, got ${job.result.units.length}`);
    assert.equal(job.result.summary.totals.unitCount, job.result.units.length);

    const selectable = job.result.units.filter((u) => u.deleteEnabled && u.circle !== 'protected');
    assert.ok(selectable.length >= 3, `expected selectable units, got ${selectable.length}`);
    const actionIds = selectable.map((u) => u.id);

    const dry = await request('/api/execute', { method: 'POST', token, body: { actionIds, dryRun: true } });
    assert.equal(dry.status, 200);
    assert.equal(dry.data.report.dryRun, true);
    assert.equal(dry.data.report.moved, actionIds.length);
    assert.ok(
      await fs.stat(path.join(home, '.trae-cn', 'worktrees', 'proj', 'orphan-branch')).then(() => true, () => false),
      'dry-run must not move anything',
    );

    const noConfirm = await request('/api/execute', { method: 'POST', token, body: { actionIds, dryRun: false } });
    assert.equal(noConfirm.status, 400);

    const directNoPhrase = await request('/api/execute', {
      method: 'POST',
      token,
      body: { actionIds, dryRun: false, directDelete: true, confirm: true },
    });
    assert.equal(directNoPhrase.status, 400);
    assert.equal(directNoPhrase.data.error, 'confirm-text-required');

    const run = await request('/api/execute', {
      method: 'POST',
      token,
      body: { actionIds, dryRun: false, confirm: true, prune: false },
    });
    assert.equal(run.status, 200);
    assert.ok(run.data.report.moved >= 1, 'execution should move at least one unit');
    assert.ok(run.data.report.batchId, 'execution should create a trash batch');
    assert.ok(
      !(await fs.stat(path.join(home, '.trae-cn', 'worktrees', 'proj', 'orphan-branch')).then(() => true, () => false)),
      'execution must move the orphan worktree',
    );

    const trash = await request('/api/trash', { token });
    assert.equal(trash.status, 200);
    assert.ok(trash.data.batchCount >= 1);

    const manifest = await request(`/api/trash/${run.data.report.batchId}`, { token });
    assert.equal(manifest.status, 200);
    assert.equal(manifest.data.entries.length, run.data.report.moved);

    const restoreDry = await request('/api/trash/restore', {
      method: 'POST',
      token,
      body: { batchId: run.data.report.batchId, dryRun: true },
    });
    assert.equal(restoreDry.status, 200);
    assert.equal(restoreDry.data.restored.length, run.data.report.moved);
    assert.ok(
      !(await fs.stat(path.join(home, '.trae-cn', 'worktrees', 'proj', 'orphan-branch')).then(() => true, () => false)),
      'restore dry-run must not write',
    );

    const restore = await request('/api/trash/restore', {
      method: 'POST',
      token,
      body: { batchId: run.data.report.batchId, confirm: true },
    });
    assert.equal(restore.status, 200);
    assert.equal(restore.data.restored.length, run.data.report.moved);
    assert.ok(
      await fs.stat(path.join(home, '.trae-cn', 'worktrees', 'proj', 'orphan-branch')).then(() => true, () => false),
      'restore must return the orphan worktree',
    );

    const report = await request('/api/report.html', { token });
    assert.equal(report.status, 200);
    assert.match(report.headers.get('content-type') || '', /text\/html/);
    assert.match(report.text, /agent-sweep/);
  });
});