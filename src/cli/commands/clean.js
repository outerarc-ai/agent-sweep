import { buildPlan } from '../../core/planner.js';
import { loadPlanFile } from '../../core/planfile.js';
import { executePlan } from '../../core/executor.js';
import { renderPlan, renderExecution } from '../../core/reporter/terminal.js';
import { emitJsonAndHtml, describeOptions, actionCircles } from './shared.js';
import { promptConfirm, isInteractive } from '../prompt.js';
import { formatBytes } from '../../lib/format.js';

export async function run(ctx) {
  const { logger, flags } = ctx;

  let plan;
  let units;
  let openFiles;
  let scan = null;
  let summary = null;

  if (flags.planFile) {
    try {
      plan = await loadPlanFile(flags.planFile, ctx.registry);
    } catch (err) {
      logger.error(err.message);
      return 2;
    }
    openFiles = await ctx.loadActiveFiles();
  } else {
    ({ scan, units, summary, openFiles } = await ctx.scanAndAnalyze());
    plan = buildPlan(units, {
      summary,
      now: summary.now,
      platform: scan.platform,
      options: {
        circles: actionCircles(flags),
        minSizeBytes: ctx.strategy.minSizeBytes,
        minScore: ctx.strategy.minScore || 0,
        ttlOverrides: ctx.scanOptions.ttlOverrides,
        harnessIds: flags.harness || null,
        directDelete: Boolean(flags.directDelete),
      },
    });
  }

  const dryRun = Boolean(flags.dryRun);

  if (plan.totals.actionCount === 0) {
    if (!flags.json) {
      logger.out(flags.planFile ? '计划文件中没有可执行动作。' : '没有符合当前策略的可执行动作。可尝试 --include-review 扩大范围。');
    }
    await emitJsonAndHtml(ctx, { scan, summary, plan, execution: null });
    return 0;
  }

  if (!flags.json) {
    if (flags.planFile) {
      logger.out(`计划文件: ${flags.planFile}（生成于 ${plan.generatedAt || '未知'}，执行前逐项复检）`);
    }
    logger.out(renderPlan(plan, { paint: logger.paint, home: ctx.home }));
  }

  if (!dryRun && flags.directDelete && !flags.yes) {
    logger.error('--direct-delete 会不可逆地删除数据，必须同时显式传入 --yes。');
    return 2;
  }

  if (!dryRun && !flags.yes) {
    if (!isInteractive()) {
      logger.error('非交互环境（stdin 非 TTY）：请显式传入 --yes 以确认执行，或先使用 --dry-run 预演。');
      return 2;
    }
    const target = flags.directDelete ? '并直接删除' : '到回收站';
    const ok = await promptConfirm(
      `将处理 ${plan.totals.actionCount} 个对象（${formatBytes(plan.totals.actionBytes)}）${target}，继续？`,
    );
    if (!ok) {
      logger.out('已取消。');
      return 0;
    }
  }

  const execution = await executePlan(plan, {
    trash: ctx.trash,
    dryRun,
    directDelete: Boolean(flags.directDelete),
    prune: !flags.noPrune,
    guardSet: ctx.guardSet,
    openFiles,
    home: ctx.home,
    onProgress: (event) => logger.debug(`move ${event.index}/${event.total} ${event.action.displayPath}`),
  });

  if (!flags.json) logger.out(renderExecution(execution, { paint: logger.paint }));

  await emitJsonAndHtml(ctx, { scan, summary, plan, execution });
  return execution.failed.length > 0 ? 1 : 0;
}
