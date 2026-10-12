import { startUi } from '../../web/server.js';
import { VERSION } from '../help.js';

const DEFAULT_PORT = 7317;
const DEFAULT_HOST = '127.0.0.1';
const LOOPBACK = new Set(['127.0.0.1', '::1', 'localhost']);

export async function run(ctx) {
  const { logger, flags } = ctx;

  const port = Number.isFinite(flags.portValue) ? flags.portValue : DEFAULT_PORT;
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    logger.error(`无效端口: ${flags.port}（需为 1-65535 的整数）`);
    return 2;
  }
  const host = flags.host || DEFAULT_HOST;

  const baseFlags = {
    harness: flags.harness,
    ttlSpecs: flags.ttlSpecs,
    olderThanDays: flags.olderThanDays,
    minSizeBytes: flags.minSizeBytes,
    minScoreValue: flags.minScoreValue,
    concurrencyValue: flags.concurrencyValue,
    includeReportOnly: flags.includeReportOnly,
    noActiveCheck: flags.noActiveCheck,
    trashRoot: flags.trashRoot,
  };

  let handle;
  try {
    handle = await startUi({
      baseFlags,
      version: VERSION,
      host,
      port,
      open: Boolean(flags.open),
      logger,
    });
  } catch (err) {
    if (err && err.code === 'EADDRINUSE') {
      logger.error(`端口 ${port} 已被占用，请用 --port 指定其它端口。`);
      return 1;
    }
    logger.error(err && err.message ? err.message : String(err));
    return 1;
  }

  logger.out('');
  logger.out(logger.paint('bold', '  agent-sweep 本地 Web UI 已启动'));
  logger.out(`  ${logger.paint('cyan', handle.url)}`);
  logger.out(logger.paint('gray', `  仅监听本机 · 会话令牌鉴权 · 按 Ctrl+C 退出`));
  if (!LOOPBACK.has(host)) {
    logger.warn(`绑定地址 ${host} 不是回环地址，局域网内其它设备可能访问，请确认网络环境可信。`);
  }
  logger.out('');

  const shutdown = async () => {
    logger.out('');
    logger.out('正在关闭…');
    await handle.close();
    process.exit(0);
  };
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);

  return 0;
}