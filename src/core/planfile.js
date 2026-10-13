import fs from 'node:fs/promises';
import { PLAN_SCHEMA } from './planner.js';
import { registryRoots } from './registry.js';
import { isPathInside } from '../lib/paths.js';

export class PlanFileError extends Error {
  constructor(message) {
    super(message);
    this.name = 'PlanFileError';
  }
}

export async function savePlanFile(plan, file) {
  await fs.writeFile(file, `${JSON.stringify(plan, null, 2)}\n`, 'utf8');
}

export async function loadPlanFile(file, registry) {
  let plan;
  try {
    plan = JSON.parse(await fs.readFile(file, 'utf8'));
  } catch (err) {
    throw new PlanFileError(`无法解析计划文件 ${file}: ${err.message}`);
  }
  validatePlan(plan, registry);
  // Recompute totals from the action list: a plan file is external input, and
  // only the actions array drives execution.
  plan.totals = {
    actionCount: plan.actions.length,
    actionBytes: plan.actions.reduce((sum, a) => sum + (a.sizeBytes || 0), 0),
  };
  if (!Array.isArray(plan.pruneRepos)) plan.pruneRepos = [];
  return plan;
}

export function validatePlan(plan, registry) {
  if (!plan || typeof plan !== 'object' || Array.isArray(plan)) {
    throw new PlanFileError('计划文件结构非法（根节点必须是 JSON 对象）');
  }
  if (plan.schema !== PLAN_SCHEMA) {
    throw new PlanFileError(`计划文件版本不匹配：期望 ${PLAN_SCHEMA}，实际 ${plan.schema || '（缺失）'}`);
  }
  if (!Array.isArray(plan.actions)) {
    throw new PlanFileError('计划文件缺少 actions 数组');
  }
  for (const action of plan.actions) {
    if (!action || typeof action.id !== 'string' || typeof action.path !== 'string') {
      throw new PlanFileError('计划文件中的每个动作必须包含 id 与 path');
    }
    if (registry) assertActionOwned(action, registry);
  }
}

// A plan file is user-supplied data. Every action must still belong to a
// registry target, or a crafted file could point execution at arbitrary paths.
function assertActionOwned(action, registry) {
  const harness = registry.byId.get(action.harnessId) || registry.resolve(action.harnessId);
  if (!harness) {
    throw new PlanFileError(`计划文件动作引用了未知 harness: ${action.harnessId}`);
  }
  const roots = registryRoots(harness).map((r) => r.path);
  if (!roots.some((root) => isPathInside(root, action.path))) {
    throw new PlanFileError(`计划文件动作 ${action.id} 的路径不在注册表目标范围内`);
  }
}
