import { describeHarness, availableHarnesses } from '../../core/registry.js';
import { renderHarnessList } from '../../core/reporter/terminal.js';
import { PLATFORM, platformLabel } from '../../lib/platform.js';

export async function run(ctx) {
  const { logger, flags, registry, positionals } = ctx;
  const home = ctx.home;

  if (flags.json) {
    const payload = {
      schema: 'agent-sweep/harnesses@1',
      platform: PLATFORM,
      harnesses: registry.harnesses.map((h) => describeHarness(h, { home })),
    };
    logger.raw(`${JSON.stringify(payload, null, 2)}\n`);
    return 0;
  }

  const filterId = positionals[0];
  let harnesses = availableHarnesses(registry, PLATFORM);
  if (filterId) {
    const resolved = registry.resolve(filterId);
    if (!resolved) {
      logger.error(`未知 harness: ${filterId}`);
      return 2;
    }
    harnesses = [resolved];
  }

  logger.out('');
  logger.out(logger.paint('bold', `内置 harness 注册表 · ${platformLabel(PLATFORM)}`));
  logger.out(
    logger.paint(
      'gray',
      `  共 ${registry.harnesses.length} 条声明，其中 ${availableHarnesses(registry, PLATFORM).length} 条适用于当前平台`,
    ),
  );
  logger.out(renderHarnessList(harnesses, { paint: logger.paint }));

  if (flags.verbose) {
    for (const harness of harnesses) {
      const described = describeHarness(harness, { home });
      logger.out('');
      logger.out(logger.paint('bold', `  ${described.name} (${described.id})`));
      if (described.summary) logger.out(`    ${described.summary}`);
      if (described.docs) logger.out(logger.paint('gray', `    文档 ${described.docs}`));
      logger.out('    扫描目标:');
      for (const target of described.targets) {
        const perm = target.removable ? logger.paint('green', '可清理') : logger.paint('gray', '仅报告');
        logger.out(`      · [${target.kind}] ${target.label}  ${perm}`);
        logger.out(logger.paint('gray', `        路径 ${target.paths.join(' , ')}`));
      }
      if (described.neverDelete.length > 0) {
        logger.out('    永不清理:');
        for (const pattern of described.neverDelete) logger.out(logger.paint('gray', `      · ${pattern}`));
      }
    }
  }
  return 0;
}