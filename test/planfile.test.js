import { test } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';
import { savePlanFile, loadPlanFile, validatePlan, PlanFileError } from '../src/core/planfile.js';
import { buildPlan, PLAN_SCHEMA } from '../src/core/planner.js';
import { loadRegistry } from '../src/core/registry.js';
import { CIRCLES } from '../src/lib/strategy.js';

const registry = loadRegistry();

async function withHome(fn) {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), 'sweep-planfile-'));
  const prev = process.env.AGENT_SWEEP_HOME_DIR;
  process.env.AGENT_SWEEP_HOME_DIR = home;
  try {
    return await fn(home);
  } finally {
    if (prev === undefined) delete process.env.AGENT_SWEEP_HOME_DIR;
    else process.env.AGENT_SWEEP_HOME_DIR = prev;
    await fs.rm(home, { recursive: true, force: true });
  }
}

function unit(home, overrides = {}) {
  return {
    harnessId: 'trae',
    harnessName: 'Trae',
    targetId: 'work',
    targetLabel: '会话工作目录',
    kind: 'session-store',
    path: path.join(home, '.trae-cn', 'work', 's1'),
    root: path.join(home, '.trae-cn', 'work'),
    displayPath: '~/.trae-cn/work/s1',
    relPath: 's1',
    sizeBytes: 1024,
    fileCount: 1,
    ageDays: 40,
    mtimeMs: 0,
    circle: CIRCLES.SAFE,
    circleReason: 'stale-cache',
    score: 40,
    flags: ['stale'],
    orphan: false,
    orphanReason: null,
    orphanDetail: null,
    mainRepo: null,
    active: false,
    protected: false,
    deleteEnabled: true,
    isDir: true,
    ...overrides,
  };
}

test('savePlanFile + loadPlanFile round trip keeps the plan intact', async () => {
  await withHome(async (home) => {
    const plan = buildPlan([unit(home)], { options: { circles: [CIRCLES.SAFE] }, now: 0, platform: 'darwin' });
    const file = path.join(home, 'plan.json');
    await savePlanFile(plan, file);

    const loaded = await loadPlanFile(file, registry);
    assert.equal(loaded.schema, PLAN_SCHEMA);
    assert.equal(loaded.totals.actionCount, 1);
    assert.equal(loaded.actions[0].path, unit(home).path);
  });
});

test('loadPlanFile recomputes totals and normalises pruneRepos from untrusted input', async () => {
  await withHome(async (home) => {
    const action = {
      id: 'trae:work:s1',
      harnessId: 'trae',
      path: path.join(home, '.trae-cn', 'work', 's1'),
      sizeBytes: 100,
    };
    const file = path.join(home, 'p.json');
    await fs.writeFile(
      file,
      JSON.stringify({ schema: PLAN_SCHEMA, actions: [action], totals: { actionCount: 99, actionBytes: 9999 } }),
      'utf8',
    );

    const loaded = await loadPlanFile(file, registry);
    assert.equal(loaded.totals.actionCount, 1);
    assert.equal(loaded.totals.actionBytes, 100);
    assert.deepEqual(loaded.pruneRepos, []);
    assert.deepEqual(loaded.skipped, { protected: 0, protectedBytes: 0, keep: 0, keepBytes: 0 });
  });
});

test('validatePlan refuses actions in report-only harnesses or report-only targets', async () => {
  await withHome(async (home) => {
    const reportOnlyHarness = {
      schema: PLAN_SCHEMA,
      actions: [{ id: 'windsurf:codeium-windsurf:cascade', harnessId: 'windsurf', path: path.join(home, '.codeium', 'windsurf', 'cascade') }],
    };
    assert.throws(() => validatePlan(reportOnlyHarness, registry), /仅报告模式/);

    const reportOnlyTarget = {
      schema: PLAN_SCHEMA,
      actions: [{
        id: 'trae:work-mode-projects:p',
        harnessId: 'trae',
        path: path.join(home, 'Library', 'Application Support', 'TRAE SOLO CN', 'ModularData', 'ai-agent', 'work-mode-projects', 'p'),
      }],
    };
    assert.throws(() => validatePlan(reportOnlyTarget, registry), /仅报告目标/);
  });
});

test('loadPlanFile rejects invalid JSON with a PlanFileError', async () => {
  await withHome(async (home) => {
    const file = path.join(home, 'p.json');
    await fs.writeFile(file, '{not json', 'utf8');
    await assert.rejects(() => loadPlanFile(file, registry), (err) => {
      assert.ok(err instanceof PlanFileError);
      assert.match(err.message, /无法解析计划文件/);
      return true;
    });
  });
});

test('loadPlanFile rejects a mismatched schema version', async () => {
  await withHome(async (home) => {
    const file = path.join(home, 'p.json');
    await fs.writeFile(file, JSON.stringify({ schema: 'agent-sweep/plan@2', actions: [] }), 'utf8');
    await assert.rejects(() => loadPlanFile(file, registry), (err) => {
      assert.ok(err instanceof PlanFileError);
      assert.match(err.message, /版本不匹配/);
      assert.ok(err.message.includes(PLAN_SCHEMA));
      return true;
    });
  });
});

test('validatePlan rejects a missing actions array and malformed actions', async () => {
  assert.throws(() => validatePlan({ schema: PLAN_SCHEMA }, registry), /缺少 actions/);
  assert.throws(() => validatePlan({ schema: PLAN_SCHEMA, actions: [{ id: 'a:b:c' }] }, registry), /id 与 path/);
});

test('validatePlan rejects actions that leave the registry target scope', async () => {
  const unknownHarness = { schema: PLAN_SCHEMA, actions: [{ id: 'nope:work:s1', harnessId: 'nope', path: '/tmp/whatever' }] };
  assert.throws(() => validatePlan(unknownHarness, registry), /未知 harness/);

  const outOfScope = {
    schema: PLAN_SCHEMA,
    actions: [{ id: 'trae:work:s1', harnessId: 'trae', path: '/tmp/evilmoves' }],
  };
  assert.throws(() => validatePlan(outOfScope, registry), /不在注册表目标范围内/);
});
