const BOOLEAN_FLAGS = new Map([
  ['json', 'json'],
  ['yes', 'yes'],
  ['y', 'yes'],
  ['dry-run', 'dryRun'],
  ['n', 'dryRun'],
  ['direct-delete', 'directDelete'],
  ['include-review', 'includeReview'],
  ['safe-only', 'safeOnly'],
  ['no-prune', 'noPrune'],
  ['prune', 'prune'],
  ['no-active-check', 'noActiveCheck'],
  ['include-report-only', 'includeReportOnly'],
  ['quiet', 'quiet'],
  ['q', 'quiet'],
  ['verbose', 'verbose'],
  ['v', 'verbose'],
  ['no-color', 'noColor'],
  ['help', 'help'],
  ['h', 'help'],
  ['version', 'version'],
  ['V', 'version'],
  ['force', 'force'],
  ['all', 'all'],
  ['open', 'open'],
]);

const VALUE_FLAGS = new Map([
  ['harness', 'harness'],
  ['ttl', 'ttl'],
  ['older-than', 'olderThan'],
  ['min-size', 'minSize'],
  ['min-score', 'minScore'],
  ['html', 'html'],
  ['out', 'out'],
  ['trash-root', 'trashRoot'],
  ['concurrency', 'concurrency'],
  ['label', 'label'],
  ['keep-days', 'keepDays'],
  ['port', 'port'],
  ['host', 'host'],
]);

export function parseSize(input) {
  if (input === undefined || input === null || input === '') return null;
  if (typeof input === 'number') return input;
  const match = String(input).trim().match(/^([\d.]+)\s*([a-zA-Z]*)$/);
  if (!match) return null;
  const value = Number(match[1]);
  if (!Number.isFinite(value)) return null;
  const unit = match[2].toLowerCase();
  const table = { b: 1, k: 1024, kb: 1024, m: 1024 ** 2, mb: 1024 ** 2, g: 1024 ** 3, gb: 1024 ** 3, t: 1024 ** 4, tb: 1024 ** 4 };
  const multiplier = unit ? table[unit] : 1;
  if (!multiplier) return null;
  return Math.round(value * multiplier);
}

export function parseDays(input) {
  if (input === undefined || input === null || input === '') return null;
  const match = String(input).trim().match(/^([\d.]+)\s*([a-zA-Z]*)$/);
  if (!match) return null;
  const value = Number(match[1]);
  if (!Number.isFinite(value)) return null;
  const unit = match[2].toLowerCase();
  const table = { d: 1, day: 1, days: 1, w: 7, week: 7, weeks: 7, mo: 30.44, month: 30.44, months: 30.44, y: 365.25, year: 365.25, years: 365.25 };
  const multiplier = unit ? table[unit] : 1;
  if (!multiplier) return null;
  return value * multiplier;
}

export function parseTtlSpecs(values) {
  const overrides = {};
  let global = null;
  for (const raw of values || []) {
    const text = String(raw);
    if (text.includes('=')) {
      const [key, value] = text.split('=');
      const days = parseDays(value);
      if (days !== null) overrides[key.trim()] = days;
    } else {
      const days = parseDays(text);
      if (days !== null) global = days;
    }
  }
  return { global, overrides };
}

export function parseArgs(argv = []) {
  const flags = {};
  const positionals = [];
  const harnessList = [];
  const ttlList = [];

  let index = 0;
  while (index < argv.length) {
    const token = argv[index];
    if (token === '--') {
      positionals.push(...argv.slice(index + 1));
      break;
    }
    if (token.startsWith('--')) {
      const eq = token.indexOf('=');
      const rawName = eq === -1 ? token.slice(2) : token.slice(2, eq);
      const inlineValue = eq === -1 ? undefined : token.slice(eq + 1);
      const name = rawName;
      if (BOOLEAN_FLAGS.has(name)) {
        flags[BOOLEAN_FLAGS.get(name)] = inlineValue === undefined ? true : inlineValue !== 'false';
      } else if (VALUE_FLAGS.has(name)) {
        let value = inlineValue;
        if (value === undefined) {
          index += 1;
          value = argv[index];
        }
        const key = VALUE_FLAGS.get(name);
        if (key === 'harness') harnessList.push(...String(value).split(',').map((s) => s.trim()).filter(Boolean));
        else if (key === 'ttl') ttlList.push(value);
        else flags[key] = value;
      } else {
        flags.unknown = flags.unknown || [];
        flags.unknown.push(name);
      }
    } else if (token.startsWith('-') && token.length > 1) {
      const short = token.slice(1);
      if (BOOLEAN_FLAGS.has(short)) {
        flags[BOOLEAN_FLAGS.get(short)] = true;
      } else if (VALUE_FLAGS.has(short)) {
        index += 1;
        flags[VALUE_FLAGS.get(short)] = argv[index];
      } else {
        flags.unknown = flags.unknown || [];
        flags.unknown.push(short);
      }
    } else {
      positionals.push(token);
    }
    index += 1;
  }

  if (harnessList.length > 0) flags.harness = harnessList;
  if (ttlList.length > 0) flags.ttlSpecs = parseTtlSpecs(ttlList);
  if (flags.minSize !== undefined) flags.minSizeBytes = parseSize(flags.minSize);
  if (flags.olderThan !== undefined) flags.olderThanDays = parseDays(flags.olderThan);
  if (flags.keepDays !== undefined) flags.keepDaysValue = parseDays(flags.keepDays);
  if (flags.minScore !== undefined) flags.minScoreValue = Number(flags.minScore);
  if (flags.concurrency !== undefined) flags.concurrencyValue = Number(flags.concurrency);
  if (flags.port !== undefined) flags.portValue = Number(flags.port);

  return { flags, positionals };
}

export const FLAG_DOCS = {
  json: '以 JSON 输出（机器可读）',
  html: '写出自包含 HTML 报告到指定路径',
  harness: '限定 harness（可重复或逗号分隔）',
  ttl: '覆盖 TTL，如 --ttl 60 或 --ttl trae=45',
  olderThan: '等价于全局 --ttl，如 --older-than 30d',
  minSize: '动作体积下限，如 --min-size 10MB',
  minScore: '动作评分下限',
  includeReview: '把第 2 圈（需确认）也纳入动作',
  safeOnly: '仅第 1 圈（默认）',
  dryRun: '只预演，不写盘',
  yes: '跳过交互确认',
  directDelete: '直接删除而非移入回收站（需 --yes）',
  noPrune: '跳过 git worktree prune',
  noActiveCheck: '跳过 lsof 进程占用检测',
  trashRoot: '自定义回收站根目录',
  concurrency: '并发测量数',
  quiet: '静默',
  verbose: '详细日志',
  noColor: '关闭颜色',
  port: '本地 Web UI 端口（默认 7317）',
  host: '本地 Web UI 绑定地址（默认 127.0.0.1）',
  open: '启动本地 Web UI 后自动打开浏览器',
};