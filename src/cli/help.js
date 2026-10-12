export const VERSION = '0.1.0';

export const USAGE = `agent-sweep — 跨 harness 的智能体残留工作区清理工具

用法:
  agent-sweep <command> [options]

命令:
  scan                 只读扫描并输出残留报告（默认命令）
  plan                 生成可审阅的清理计划（只读）
  clean                执行清理（默认移入回收站，可还原）
  restore <batchId>    从回收站还原某一批次
  trash [list|empty]   查看或清空回收站
  harnesses            列出内置 harness 注册表
  doctor               环境与注册表自检
  help                 显示帮助
  version              显示版本

常用选项:
  --harness <id>        限定 harness（可重复，或逗号分隔）
  --ttl <days|id=days>  覆盖 TTL，如 --ttl 60 或 --ttl trae=45
  --older-than <days>   等价于全局 --ttl
  --min-size <size>     动作体积下限，如 --min-size 10MB
  --min-score <n>       动作评分下限
  --include-review      把第 2 圈（需确认）纳入动作
  --safe-only           仅第 1 圈（默认）
  --dry-run, -n         只预演，不写盘
  --yes, -y             跳过交互确认
  --direct-delete       直接删除而非移入回收站（需 --yes）
  --no-prune            跳过 git worktree prune
  --no-active-check     跳过 lsof 进程占用检测
  --json                以 JSON 输出
  --html <file>         写出自包含 HTML 报告
  --trash-root <path>   自定义回收站根目录
  --concurrency <n>     并发测量数（默认 8）
  --verbose, -v         详细日志
  --quiet, -q           静默
  --no-color            关闭颜色
  -h, --help            显示帮助
  -V, --version         显示版本

示例:
  agent-sweep scan --html report.html
  agent-sweep plan --harness trae --ttl trae=45
  agent-sweep clean --include-review --dry-run
  agent-sweep clean --yes
  agent-sweep restore 20261012-114500-abcd

安全模型:
  第 1 圈 可安全清理（孤儿工作树、陈旧缓存/日志）——默认可执行
  第 2 圈 需确认后清理（陈旧但仍有不确定性的会话数据）——需 --include-review
  第 3 圈 永不清理（记忆、凭据、MCP 注册、活跃占用）——硬约束，任何参数都不越权
`;

export function helpText() {
  return USAGE;
}

export function versionText() {
  return `agent-sweep ${VERSION}`;
}