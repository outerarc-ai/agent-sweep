import { buildPlan } from '../../core/planner.js';
import { renderPlan } from '../../core/reporter/terminal.js';
import { emitJsonAndHtml, describeOptions, actionCircles } from './shared.js';

export async function run(ctx) {
  const { logger, flags } = ctx;
  const { scan, units, summary } = await ctx.scanAndAnalyze();

  const plan = buildPlan(units, {
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

  if (!flags.json) {
    logger.out(renderPlan(plan, { paint: logger.paint, home: ctx.home }));
    if (!flags.quiet) {
      logger.out('');
      logger.out(
        logger.paint('gray', `  这是计划，尚未改动磁盘。执行请运行 "agent-sweep clean"${flags.includeReview ? ' --include-review' : ''}。`),
      );
    }
  }

  await emitJsonAndHtml(ctx, { scan, summary, plan, options: describeOptions(ctx) });
  return 0;
}