/* agent-sweep web ui · i18n runtime (zero dependencies, no build step)
 *
 * Exposes `window.I18N`:
 *   - locale        current locale ('zh-CN' | 'en-US')
 *   - supported     list of supported locales
 *   - t(key, params) translate with {param} interpolation
 *   - fmtNum(n)     locale-aware number formatting
 *   - fmtDate(x)    locale-aware date formatting
 *   - setLocale(l)  persist + apply + notify listeners
 *   - onChange(fn)  subscribe to locale changes
 *
 * Locale resolution order: localStorage -> navigator.language -> en-US.
 */
(function () {
  'use strict';

  var SUPPORTED = ['zh-CN', 'en-US'];
  var STORAGE_KEY = 'agent-sweep:locale';
  var FALLBACK = 'zh-CN';

  var MESSAGES = {
    'zh-CN': {
      docTitle: 'agent-sweep · 本地清理控制台',
      brandSub: '本地清理控制台',

      'step.scan.label': '扫描',
      'step.scan.hint': '只读枚举候选残留',
      'step.select.label': '勾选',
      'step.select.hint': '挑选要清理的对象',
      'step.plan.label': '预演',
      'step.plan.hint': '复核动作，不写盘',
      'step.execute.label': '执行',
      'step.execute.hint': '移入回收站或删除',
      'step.trash.label': '回收站',
      'step.trash.hint': '查看与还原批次',

      envPlatform: '平台',
      envVersion: '版本',
      envTrash: '回收站',
      envHarnesses: 'Harness',
      envHarnessCount: '{n} 个',

      actRescan: '重新扫描',
      actExport: '导出 HTML 报告',
      actToPlan: '生成预演（{n}）',
      actToPlanShort: '生成预演 →',
      confirm: '确认',
      cancel: '取消',

      'circle.safe': '可安全清理',
      'circle.review': '需确认后清理',
      'circle.protected': '永不清理',
      'circle.keep': '保留',
      'circle.short.safe': '安全圈',
      'circle.short.review': '待确认',
      'circle.short.protected': '保护',
      'circle.short.keep': '保留',

      'reason.hard-guard': '硬约束保护',
      'reason.target-report-only': '仅报告目标',
      'reason.contains-protected': '含受保护内容',
      'reason.in-use': '进程占用',
      'reason.within-ttl': '未超 TTL',
      'reason.below-min-size': '低于最小体积',
      'reason.orphan': '孤儿',
      'reason.stale': '陈旧',
      'reason.asset-file': '记忆 / 凭据文件',
      'reason.sensitive-name': '敏感文件名',

      'scan.ttl': 'TTL（天）',
      'scan.ttlHint': '超过该年龄的残留才进入候选；留空则按各 harness 默认值',
      'scan.ttlPlaceholder': '留空使用默认值',
      'scan.minSize': '最小体积（MB）',
      'scan.minSizeHint': '小于该体积的对象不进入可清理范围',
      'scan.minScore': '最低评分',
      'scan.minScoreHint': '复合评分下限（0-100）',
      'scan.options': '选项',
      'scan.activeCheck': '检测进程占用（推荐）',
      'scan.reportOnly': '纳入仅报告的 harness',
      'scan.scope': '扫描范围',
      'scan.selectAll': '全选',
      'scan.harnessCount': '{n} 个适用于当前平台的 harness',
      'scan.start': '开始扫描',
      'scan.running': '扫描中…',
      'scan.readOnly': '扫描为只读操作，不会改动任何文件',
      'scan.progress': '正在扫描 {name}（{i}/{n}）',
      'scan.progressInit': '正在初始化扫描…',
      'scan.overview': '扫描概览',
      'scan.units': '候选单元',
      'scan.total': '扫描总体积',
      'scan.reclaimable': '可回收总量',
      'scan.circleDist': '圈层体积分布',
      'scan.legend': '{bytes} · {n} 个 · {pct}%',
      'scan.byHarness': '按 Harness 汇总',
      'scan.thUnits': '单元',
      'scan.thTotal': '合计',
      'scan.thSafe': '安全圈',
      'scan.thReview': '待确认',
      'scan.thProtected': '保护',
      'scan.thOldest': '最旧',
      'scan.thNewest': '最新',
      'scan.noData': '无数据',
      'scan.toSelect': '去勾选（{n} 个候选）',
      'scan.footnote': '扫描耗时 {s}s · 只读，未改动磁盘',
      'scan.done': '扫描完成：{n} 个候选单元',
      'scan.failed': '扫描失败：{err}',
      tagReportOnly: '仅报告',

      'sel.circle': '圈层',
      'sel.type': '类型',
      'sel.minScore': '最低评分',
      'sel.search': '搜索',
      'sel.searchPlaceholder': '路径或 harness',
      'sel.all': '全部',
      'sel.allSafe': '全选安全圈',
      'sel.allReview': '全选待确认',
      'sel.allVisible': '全选当前结果',
      'sel.clear': '清空',
      'sel.shown': '显示 {shown} / {total} 个单元 · 点击表头排序',
      'sel.hidden': '已隐藏 {n} 个永不清理/仅报告对象（合计 {bytes}）',
      'sel.thType': '类型',
      'sel.thSize': '体积',
      'sel.thAge': '年龄',
      'sel.thScore': '评分',
      'sel.thCircle': '圈层',
      'sel.thPath': '路径',
      'sel.empty': '没有符合筛选条件的单元',
      'sel.selected': '已选 {n} 个对象 · 合计 {bytes}',
      'sel.selectedCircles': '（安全圈 {safe} · 待确认 {review}）',
      'sel.selectFirst': '请先勾选要处理的对象',

      'plan.empty': '尚未生成预演，请先在「勾选」中选择对象。',
      'plan.cardCount': '待处理对象',
      'plan.cardFreed': '预计释放',
      'plan.cardVerified': '复核通过',
      'plan.cardSkipped': '复核跳过',
      'plan.cardProtected': '保护圈（未纳入）',
      'plan.note': '这是预演结果，未改动磁盘。预演已按与真实执行相同的规则复核每个对象（安全硬约束 + 进程占用），因此「复核通过」的数量即为执行时真正会被处理的对象数。',
      'plan.verified': '复核通过 · 将被处理（{n}）',
      'plan.emptyActions': '没有可处理的对象',
      'plan.skipped': '执行时被跳过的对象（{n}）',
      'plan.skippedNote': '以下对象在复核阶段被安全约束拦下，不会被处理：',
      'plan.more': '…还有 {n} 个',
      'plan.prune': '连带动作 · git worktree prune（{n} 个主仓库）',
      'plan.thRepo': '主仓库',
      'plan.thWorktrees': '关联工作树',
      'plan.noPrune': '无需 prune',
      'plan.toExecute': '确认并执行 →',
      'plan.backSelect': '返回调整勾选',
      'plan.thSize': '体积',
      'plan.thAge': '年龄',
      'plan.thPath': '路径',

      'exec.empty': '请先生成预演。',
      'exec.method': '执行方式',
      'exec.mode': '处理方式',
      'exec.modeTrash': '移入回收站（推荐，可还原）',
      'exec.modeDirect': '直接删除（不可还原）',
      'exec.followup': '连带动作',
      'exec.prune': '对关联主仓库执行 git worktree prune',
      'exec.willProcess': '即将处理 {n} 个对象，预计释放 {bytes}。',
      'exec.verifyNote': '处理前会对每个对象再次复核安全约束与进程占用，命中保护圈的对象自动跳过。',
      'exec.trashNote': '对象将移入回收站，可在「回收站」步骤中还原。',
      'exec.directNote': '直接删除不可还原，请确认已复核预演结果。',
      'exec.confirmLabel': '危险操作确认',
      'exec.confirmPlaceholder': '输入 DELETE 以启用直接删除',
      'exec.confirmHint': '直接删除不可恢复，必须输入大写 DELETE',
      'exec.btnTrash': '移入回收站',
      'exec.btnDirect': '直接删除',
      'exec.backPlan': '返回预演',
      'exec.cardProcessed': '已处理',
      'exec.cardFreed': '释放空间',
      'exec.cardSkipped': '复核跳过',
      'exec.cardFailed': '失败',
      'exec.cardPruned': 'prune 仓库',
      'exec.finishNote': '{label}完成，耗时 {s}s。',
      'exec.batchNote': '批次 {id} 已写入回收站，可随时还原。',
      'exec.labelDry': '预演',
      'exec.labelReal': '执行',
      'exec.failedTitle': '失败明细',
      'exec.pruneTitle': 'prune 结果',
      'exec.thResult': '结果',
      'exec.ok': '成功',
      'exec.failed': '失败',
      'exec.toTrash': '前往回收站',
      'exec.movedToast': '已移入回收站 {n} 个对象',
      'exec.deletedToast': '已删除 {n} 个对象',
      'exec.confirmToast': '请输入 DELETE 以确认直接删除',
      'exec.modalTitle': '确认直接删除',
      'exec.modalBody': '将<b>不可还原地</b>删除 {n} 个对象，预计释放 {bytes}。',
      'exec.modalSub': '该操作无法通过回收站恢复。',

      'trash.loading': '正在读取回收站…',
      'trash.cardBatches': '批次',
      'trash.cardFreed': '累计释放',
      'trash.list': '批次列表',
      'trash.empty': '回收站为空。执行清理后，被移入的对象会出现在这里。',
      'trash.entries': '{n} 条',
      'trash.expand': '展开以读取清单…',
      'trash.noEntries': '无条目',
      'trash.thSize': '体积',
      'trash.thPath': '原始路径',
      'trash.restoreDry': '还原预演',
      'trash.restore': '还原此批次',
      'trash.emptyTrash': '清空回收站（不可还原）',
      'trash.restoreModalTitle': '确认还原批次',
      'trash.restoreModalBody': '将把批次 {id} 中的对象还原回原始路径。',
      'trash.restoreModalSub': '若原始路径已存在同名对象，将跳过该项以避免覆盖。',
      'trash.restoreBtn': '还原',
      'trash.restoreDryToast': '还原预演：可还原 {n} · 冲突 {c} · 缺失 {m}',
      'trash.restoreToast': '已还原 {n} 个对象',
      'trash.restoreToastConflicts': '，{c} 个目标已存在被跳过',
      'trash.emptyModalTitle': '清空回收站',
      'trash.emptyModalBody': '将<b>永久删除</b>回收站中的全部批次，此操作不可还原。',
      'trash.keepDays': '仅清空超过 N 天的批次（留空表示全部）',
      'trash.keepDaysPlaceholder': '例如 30',
      'trash.emptyBtn': '清空',
      'trash.emptiedToast': '已清空 {n} 个批次',

      reportExported: '报告已导出',
      initFailed: '初始化失败：{err}'
    },

    'en-US': {
      docTitle: 'agent-sweep · Local Cleanup Console',
      brandSub: 'Local cleanup console',

      'step.scan.label': 'Scan',
      'step.scan.hint': 'Read-only scan for residue',
      'step.select.label': 'Select',
      'step.select.hint': 'Pick what to clean up',
      'step.plan.label': 'Preview',
      'step.plan.hint': 'Re-verify actions, nothing written',
      'step.execute.label': 'Execute',
      'step.execute.hint': 'Move to trash or delete',
      'step.trash.label': 'Trash',
      'step.trash.hint': 'Browse batches and restore',

      envPlatform: 'Platform',
      envVersion: 'Version',
      envTrash: 'Trash root',
      envHarnesses: 'Harnesses',
      envHarnessCount: '{n}',

      actRescan: 'Rescan',
      actExport: 'Export HTML report',
      actToPlan: 'Preview ({n})',
      actToPlanShort: 'Preview →',
      confirm: 'Confirm',
      cancel: 'Cancel',

      'circle.safe': 'Safe to clean',
      'circle.review': 'Needs confirmation',
      'circle.protected': 'Never clean',
      'circle.keep': 'Keep',
      'circle.short.safe': 'Safe',
      'circle.short.review': 'Review',
      'circle.short.protected': 'Protected',
      'circle.short.keep': 'Keep',

      'reason.hard-guard': 'Hard guard',
      'reason.target-report-only': 'Report-only target',
      'reason.contains-protected': 'Contains protected content',
      'reason.in-use': 'In use',
      'reason.within-ttl': 'Within TTL',
      'reason.below-min-size': 'Below min size',
      'reason.orphan': 'Orphan',
      'reason.stale': 'Stale',
      'reason.asset-file': 'Memory / credential file',
      'reason.sensitive-name': 'Sensitive file name',

      'scan.ttl': 'TTL (days)',
      'scan.ttlHint': 'Only residue older than this becomes a candidate; leave empty for per-harness defaults',
      'scan.ttlPlaceholder': 'Empty for defaults',
      'scan.minSize': 'Min size (MB)',
      'scan.minSizeHint': 'Objects below this size are excluded',
      'scan.minScore': 'Min score',
      'scan.minScoreHint': 'Lower bound of the composite score (0-100)',
      'scan.options': 'Options',
      'scan.activeCheck': 'Check process occupancy (recommended)',
      'scan.reportOnly': 'Include report-only harnesses',
      'scan.scope': 'Scan scope',
      'scan.selectAll': 'Select all',
      'scan.harnessCount': '{n} harnesses available on this platform',
      'scan.start': 'Start scan',
      'scan.running': 'Scanning…',
      'scan.readOnly': 'Scanning is read-only; no files are touched',
      'scan.progress': 'Scanning {name} ({i}/{n})',
      'scan.progressInit': 'Initializing scan…',
      'scan.overview': 'Scan overview',
      'scan.units': 'Candidate units',
      'scan.total': 'Total scanned',
      'scan.reclaimable': 'Reclaimable',
      'scan.circleDist': 'Size by circle',
      'scan.legend': '{bytes} · {n} items · {pct}%',
      'scan.byHarness': 'By harness',
      'scan.thUnits': 'Units',
      'scan.thTotal': 'Total',
      'scan.thSafe': 'Safe',
      'scan.thReview': 'Review',
      'scan.thProtected': 'Protected',
      'scan.thOldest': 'Oldest',
      'scan.thNewest': 'Newest',
      'scan.noData': 'No data',
      'scan.toSelect': 'Select ({n} candidates)',
      'scan.footnote': 'Scanned in {s}s · read-only, disk untouched',
      'scan.done': 'Scan complete: {n} candidate units',
      'scan.failed': 'Scan failed: {err}',
      tagReportOnly: 'Report only',

      'sel.circle': 'Circle',
      'sel.type': 'Type',
      'sel.minScore': 'Min score',
      'sel.search': 'Search',
      'sel.searchPlaceholder': 'Path or harness',
      'sel.all': 'All',
      'sel.allSafe': 'Select all safe',
      'sel.allReview': 'Select all review',
      'sel.allVisible': 'Select visible',
      'sel.clear': 'Clear',
      'sel.shown': 'Showing {shown} of {total} units · click headers to sort',
      'sel.hidden': '{n} never-clean / report-only items hidden ({bytes} total)',
      'sel.thType': 'Type',
      'sel.thSize': 'Size',
      'sel.thAge': 'Age',
      'sel.thScore': 'Score',
      'sel.thCircle': 'Circle',
      'sel.thPath': 'Path',
      'sel.empty': 'No units match the filters',
      'sel.selected': '{n} selected · {bytes}',
      'sel.selectedCircles': '(safe {safe} · review {review})',
      'sel.selectFirst': 'Select at least one item first',

      'plan.empty': 'No preview yet — select items in the Select step first.',
      'plan.cardCount': 'To process',
      'plan.cardFreed': 'Expected freed',
      'plan.cardVerified': 'Verified',
      'plan.cardSkipped': 'Skipped by guard',
      'plan.cardProtected': 'Protected (excluded)',
      'plan.note': 'This is a dry run — nothing was changed. Every item was re-verified with the same rules as real execution (hard guards + process occupancy), so "Verified" is exactly what will be processed.',
      'plan.verified': 'Verified · will be processed ({n})',
      'plan.emptyActions': 'Nothing to process',
      'plan.skipped': 'Skipped during re-verification ({n})',
      'plan.skippedNote': 'These items were blocked by safety constraints and will not be processed:',
      'plan.more': '…and {n} more',
      'plan.prune': 'Follow-up · git worktree prune ({n} repos)',
      'plan.thRepo': 'Main repo',
      'plan.thWorktrees': 'Linked worktrees',
      'plan.noPrune': 'Nothing to prune',
      'plan.toExecute': 'Confirm & execute →',
      'plan.backSelect': 'Back to selection',
      'plan.thSize': 'Size',
      'plan.thAge': 'Age',
      'plan.thPath': 'Path',

      'exec.empty': 'Generate a preview first.',
      'exec.method': 'Execution method',
      'exec.mode': 'Method',
      'exec.modeTrash': 'Move to trash (recommended, restorable)',
      'exec.modeDirect': 'Delete permanently (irreversible)',
      'exec.followup': 'Follow-up actions',
      'exec.prune': 'Run git worktree prune on linked repos',
      'exec.willProcess': '{n} items will be processed, freeing {bytes}.',
      'exec.verifyNote': 'Every item is re-verified (guards + process occupancy) before processing; protected items are skipped.',
      'exec.trashNote': 'Items move to the trash and can be restored from the Trash step.',
      'exec.directNote': 'Permanent deletion cannot be undone. Make sure you reviewed the preview.',
      'exec.confirmLabel': 'Confirm destructive action',
      'exec.confirmPlaceholder': 'Type DELETE to enable permanent deletion',
      'exec.confirmHint': 'Permanent deletion is irreversible; type DELETE in capitals',
      'exec.btnTrash': 'Move to trash',
      'exec.btnDirect': 'Delete permanently',
      'exec.backPlan': 'Back to preview',
      'exec.cardProcessed': 'Processed',
      'exec.cardFreed': 'Space freed',
      'exec.cardSkipped': 'Skipped',
      'exec.cardFailed': 'Failed',
      'exec.cardPruned': 'Pruned repos',
      'exec.finishNote': '{label} finished in {s}s.',
      'exec.batchNote': 'Batch {id} written to trash — restore anytime.',
      'exec.labelDry': 'Dry run',
      'exec.labelReal': 'Execution',
      'exec.failedTitle': 'Failures',
      'exec.pruneTitle': 'Prune results',
      'exec.thResult': 'Result',
      'exec.ok': 'OK',
      'exec.failed': 'Failed',
      'exec.toTrash': 'Go to trash',
      'exec.movedToast': 'Moved {n} items to trash',
      'exec.deletedToast': 'Deleted {n} items',
      'exec.confirmToast': 'Type DELETE to confirm permanent deletion',
      'exec.modalTitle': 'Confirm permanent deletion',
      'exec.modalBody': 'This will <b>permanently delete</b> {n} items, freeing {bytes}.',
      'exec.modalSub': 'This cannot be undone via the trash.',

      'trash.loading': 'Loading trash…',
      'trash.cardBatches': 'Batches',
      'trash.cardFreed': 'Total freed',
      'trash.list': 'Batches',
      'trash.empty': 'Trash is empty. Items moved by a cleanup will appear here.',
      'trash.entries': '{n} items',
      'trash.expand': 'Expand to load the manifest…',
      'trash.noEntries': 'No entries',
      'trash.thSize': 'Size',
      'trash.thPath': 'Original path',
      'trash.restoreDry': 'Restore preview',
      'trash.restore': 'Restore this batch',
      'trash.emptyTrash': 'Empty trash (irreversible)',
      'trash.restoreModalTitle': 'Confirm restore',
      'trash.restoreModalBody': 'Restores the items in batch {id} to their original paths.',
      'trash.restoreModalSub': 'If the original path already exists, that item is skipped to avoid overwriting.',
      'trash.restoreBtn': 'Restore',
      'trash.restoreDryToast': 'Restore preview: {n} restorable · {c} conflicts · {m} missing',
      'trash.restoreToast': 'Restored {n} items',
      'trash.restoreToastConflicts': ', {c} skipped (target exists)',
      'trash.emptyModalTitle': 'Empty trash',
      'trash.emptyModalBody': 'This <b>permanently deletes</b> all batches in the trash. This cannot be undone.',
      'trash.keepDays': 'Only empty batches older than N days (empty = all)',
      'trash.keepDaysPlaceholder': 'e.g. 30',
      'trash.emptyBtn': 'Empty',
      'trash.emptiedToast': 'Emptied {n} batches',

      reportExported: 'Report exported',
      initFailed: 'Initialization failed: {err}'
    }
  };

  function normalize(lang) {
    if (typeof lang !== 'string') return 'en-US';
    var l = lang.trim().toLowerCase();
    if (l === 'zh' || l.indexOf('zh-') === 0) return 'zh-CN';
    if (l === 'en' || l.indexOf('en-') === 0) return 'en-US';
    return SUPPORTED.indexOf(l) >= 0 ? l : 'en-US';
  }

  function detect() {
    try {
      var saved = window.localStorage.getItem(STORAGE_KEY);
      if (saved && SUPPORTED.indexOf(saved) >= 0) return saved;
    } catch (e) { /* storage unavailable */ }
    return /zh/i.test(navigator.language || '') ? 'zh-CN' : 'en-US';
  }

  var locale = detect();
  var listeners = [];

  function t(key, params) {
    var template = MESSAGES[locale] && MESSAGES[locale][key];
    if (template === undefined) template = MESSAGES[FALLBACK][key];
    if (template === undefined) return key;
    if (!params) return template;
    return template.replace(/\{(\w+)\}/g, function (m, name) {
      return params[name] !== undefined ? String(params[name]) : m;
    });
  }

  function fmtNum(n) {
    var v = Number(n) || 0;
    try { return new Intl.NumberFormat(locale).format(v); }
    catch (e) { return String(v); }
  }

  function fmtDate(input) {
    var d = input instanceof Date ? input : new Date(input);
    if (Number.isNaN(d.getTime())) return '—';
    try {
      return new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(d);
    } catch (e) {
      return d.toISOString().slice(0, 16).replace('T', ' ');
    }
  }

  function apply() {
    document.documentElement.setAttribute('lang', locale);
    if (document.title) document.title = t('docTitle');
  }

  function setLocale(next) {
    var nextLocale = normalize(next);
    if (nextLocale === locale) return;
    locale = nextLocale;
    try { window.localStorage.setItem(STORAGE_KEY, locale); } catch (e) { /* ignore */ }
    apply();
    for (var i = 0; i < listeners.length; i += 1) listeners[i](locale);
  }

  apply();

  window.I18N = {
    get locale() { return locale; },
    supported: SUPPORTED,
    t: t,
    fmtNum: fmtNum,
    fmtDate: fmtDate,
    setLocale: setLocale,
    onChange: function (fn) { if (typeof fn === 'function') listeners.push(fn); }
  };
})();
