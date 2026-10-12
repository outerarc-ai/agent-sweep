import { formatBytes, renderTable } from '../../lib/format.js';

export async function run(ctx) {
  const { logger, flags, positionals } = ctx;
  const id = positionals[0];
  if (!id) {
    logger.error('用法: agent-sweep restore <batchId>');
    logger.out('  可用批次请运行 "agent-sweep trash list" 查看。');
    return 2;
  }

  const dryRun = Boolean(flags.dryRun);
  let result;
  try {
    result = await ctx.trash.restore(id, { dryRun });
  } catch (err) {
    logger.error(err && err.message ? err.message : String(err));
    return 1;
  }

  if (flags.json) {
    logger.raw(`${JSON.stringify({ schema: 'agent-sweep/restore@1', ...result }, null, 2)}\n`);
    return 0;
  }

  logger.out('');
  logger.out(logger.paint('bold', dryRun ? '还原预演（未改动磁盘）' : '还原结果'));
  logger.out(
    `  批次 ${result.id} · 已还原 ${result.restored.length} 个 · 冲突 ${result.conflicts.length} 个 · 缺失 ${result.missing.length} 个`,
  );

  if (result.restored.length > 0) {
    const rows = result.restored.slice(0, 20).map((entry) => [formatBytes(entry.sizeBytes), entry.originalPath]);
    logger.out('');
    logger.out(renderTable(['体积', '还原到'], rows, { align: ['right', 'left'] }));
  }
  if (result.conflicts.length > 0) {
    logger.out('');
    logger.out(logger.paint('yellow', `  ${result.conflicts.length} 个目标已存在，未覆盖：`));
    for (const entry of result.conflicts.slice(0, 10)) {
      logger.out(`    · ${entry.originalPath}`);
    }
  }
  if (result.missing.length > 0) {
    logger.out('');
    logger.out(logger.paint('yellow', `  ${result.missing.length} 个回收站文件缺失，无法还原。`));
  }
  return 0;
}