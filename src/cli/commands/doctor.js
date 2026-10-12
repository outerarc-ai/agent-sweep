import fs from 'node:fs/promises';
import path from 'node:path';
import { renderDoctor } from '../../core/reporter/terminal.js';
import { renderTable, formatBytes } from '../../lib/format.js';
import { resolveTargetPaths, availableHarnesses } from '../../core/registry.js';
import { lstatSafe, measureTree } from '../../lib/fsx.js';
import { collectOpenFiles } from '../../lib/process.js';
import { gitAvailable } from '../../lib/gitworktree.js';
import { PLATFORM, platformLabel } from '../../lib/platform.js';
import { collapseHome } from '../../lib/paths.js';

const MIN_NODE_MAJOR = 18;

export async function run(ctx) {
  const { logger, flags, registry, guardSet } = ctx;
  const home = ctx.home;
  const checks = [];

  const nodeMajor = Number(process.versions.node.split('.')[0]);
  checks.push({
    label: `Node.js 版本 v${process.versions.node}`,
    ok: nodeMajor >= MIN_NODE_MAJOR,
    detail: nodeMajor >= MIN_NODE_MAJOR ? `满足 >= ${MIN_NODE_MAJOR}` : `需要 >= ${MIN_NODE_MAJOR}.17.0`,
  });

  const gitOk = await gitAvailable();
  checks.push({
    label: 'git 可用',
    ok: gitOk,
    warn: !gitOk,
    detail: gitOk ? '可用于 worktree prune' : '未检测到 git，worktree prune 将跳过',
  });

  const openFiles = flags.noActiveCheck
    ? { supported: false, reason: 'disabled-by-flag' }
    : await collectOpenFiles();
  checks.push({
    label: '进程占用检测（lsof）',
    ok: Boolean(openFiles.supported),
    warn: !openFiles.supported,
    detail: openFiles.supported ? `已读取 ${openFiles.paths.length} 个打开文件` : `不可用（${openFiles.reason || 'unknown'}），活跃判定退化`,
  });

  const applicable = availableHarnesses(registry, PLATFORM);
  checks.push({
    label: '注册表校验',
    ok: registry.harnesses.length > 0,
    detail: `${registry.harnesses.length} 条声明，${applicable.length} 条适用于 ${platformLabel(PLATFORM)}，${guardSet.entries.length} 条永不清理硬约束`,
  });

  let trashOk = false;
  let trashDetail = '';
  try {
    const root = ctx.trash.root;
    await fs.mkdir(root, { recursive: true });
    await fs.access(root, fs.constants.W_OK);
    trashOk = true;
    trashDetail = collapseHome(root, home);
  } catch (err) {
    trashDetail = err && err.message ? err.message : 'not writable';
  }
  checks.push({ label: '回收站可写', ok: trashOk, detail: trashDetail });

  const present = [];
  let presentBytes = 0;
  for (const harness of applicable) {
    for (const target of harness.targets) {
      for (const root of resolveTargetPaths(target)) {
        const st = await lstatSafe(root);
        if (!st) continue;
        const measured = st.isDirectory() ? await measureTree(root) : { sizeBytes: st.size, fileCount: 1 };
        present.push({
          harness: harness.name,
          target: target.id,
          path: collapseHome(root, home),
          bytes: measured.sizeBytes,
          files: measured.fileCount,
        });
        presentBytes += measured.sizeBytes;
      }
    }
  }

  checks.push({
    label: '命中扫描根',
    ok: present.length > 0,
    warn: present.length === 0,
    detail: `${present.length} 个目录存在，合计 ${formatBytes(presentBytes)}`,
  });

  if (flags.json) {
    logger.raw(`${JSON.stringify({ schema: 'agent-sweep/doctor@1', platform: PLATFORM, checks, roots: present }, null, 2)}\n`);
    return 0;
  }

  logger.out(renderDoctor(checks, { paint: logger.paint }));

  if (present.length > 0) {
    logger.out('');
    logger.out(logger.paint('bold', '  命中的扫描根（按体积）'));
    const rows = present
      .sort((a, b) => b.bytes - a.bytes)
      .slice(0, 25)
      .map((row) => [row.harness, row.target, formatBytes(row.bytes), String(row.files), row.path]);
    logger.out(renderTable(['Harness', '目标', '体积', '文件数', '路径'], rows, {
      align: ['left', 'left', 'right', 'right', 'left'],
    }));
  }

  const failed = checks.filter((c) => !c.ok && !c.warn).length;
  return failed > 0 ? 1 : 0;
}