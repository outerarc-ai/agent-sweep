import { formatBytes, formatDate, renderTable } from '../../lib/format.js';
import { promptConfirm, isInteractive } from '../prompt.js';

async function listTrash(ctx) {
  const { logger, flags } = ctx;
  const stats = await ctx.trash.stats();

  if (flags.json) {
    logger.raw(`${JSON.stringify({ schema: 'agent-sweep/trash@1', ...stats }, null, 2)}\n`);
    return 0;
  }

  logger.out('');
  logger.out(logger.paint('bold', '回收站'));
  logger.out(`  根目录 ${stats.root}`);
  logger.out(`  批次 ${stats.batchCount} 个 · 累计释放 ${formatBytes(stats.freedBytes)}`);
  if (stats.batches.length > 0) {
    logger.out('');
    const rows = stats.batches.map((batch) => [
      batch.id,
      batch.createdAt ? formatDate(batch.createdAt) : '—',
      batch.entries === null ? '—' : String(batch.entries),
      batch.freedBytes === null ? '—' : formatBytes(batch.freedBytes),
    ]);
    logger.out(renderTable(['批次', '创建时间', '条目', '释放'], rows, { align: ['left', 'left', 'right', 'right'] }));
    logger.out('');
    logger.out(logger.paint('gray', '  还原: agent-sweep restore <batchId>'));
  }
  return 0;
}

async function emptyTrash(ctx) {
  const { logger, flags } = ctx;
  const olderThanDays = Number.isFinite(flags.keepDaysValue) ? flags.keepDaysValue : 0;

  if (!flags.yes) {
    if (!isInteractive()) {
      logger.error('清空回收站不可还原，请显式传入 --yes。');
      return 2;
    }
    const scope = olderThanDays > 0 ? `超过 ${olderThanDays} 天的` : '全部';
    const ok = await promptConfirm(`将永久删除${scope}回收站批次，继续？`);
    if (!ok) {
      logger.out('已取消。');
      return 0;
    }
  }

  const { removed } = await ctx.trash.empty({ olderThanDays });
  logger.out(`已清空 ${removed.length} 个批次。`);
  return 0;
}

export async function run(ctx) {
  const sub = ctx.positionals[0] || 'list';
  if (sub === 'list') return listTrash(ctx);
  if (sub === 'empty') return emptyTrash(ctx);
  ctx.logger.error(`未知子命令: trash ${sub}（可用: list | empty）`);
  return 2;
}