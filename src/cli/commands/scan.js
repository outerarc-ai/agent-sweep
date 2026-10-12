import { renderScanSummary, renderTopCandidates } from '../../core/reporter/terminal.js';
import { emitJsonAndHtml, describeOptions } from './shared.js';

export async function run(ctx) {
  const { logger, flags } = ctx;
  const { scan, summary } = await ctx.scanAndAnalyze();

  if (!flags.json) {
    logger.out(renderScanSummary(scan, summary, { paint: logger.paint }));
    logger.out(renderTopCandidates(summary, { paint: logger.paint, home: ctx.home }));
    if (!flags.quiet) {
      logger.out('');
      logger.out(
        logger.paint(
          'gray',
          `  提示: 这是只读报告。执行清理请运行 "agent-sweep clean"，默认移入回收站可还原。`,
        ),
      );
    }
  }

  await emitJsonAndHtml(ctx, { scan, summary, plan: null, options: describeOptions(ctx) });
  return 0;
}