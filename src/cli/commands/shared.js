import fs from 'node:fs/promises';
import { buildJsonReport, toJson } from '../../core/reporter/json.js';
import { renderHtmlReport } from '../../core/reporter/html.js';
import { CIRCLES } from '../../lib/strategy.js';

export function describeOptions(ctx) {
  const f = ctx.flags;
  return {
    harness: f.harness || null,
    globalTtlDays: ctx.scanOptions.globalTtl,
    ttlOverrides: ctx.scanOptions.ttlOverrides,
    minSizeBytes: ctx.strategy.minSizeBytes,
    enforceMinSize: ctx.strategy.enforceMinSize,
    minScore: ctx.strategy.minScore || 0,
    includeReview: Boolean(f.includeReview),
    directDelete: Boolean(f.directDelete),
    prune: f.noPrune ? false : true,
    activeCheck: !f.noActiveCheck,
  };
}

export function actionCircles(flags) {
  const circles = [CIRCLES.SAFE];
  if (flags.includeReview || flags.all) circles.push(CIRCLES.REVIEW);
  return circles;
}

export async function emitJsonAndHtml(ctx, payload, { silentJson = false } = {}) {
  const { logger, flags } = ctx;
  const report = buildJsonReport({ ...payload, options: describeOptions(ctx) });

  if (flags.html) {
    const html = renderHtmlReport(payload);
    await fs.writeFile(flags.html, html, 'utf8');
    if (!flags.quiet && !flags.json) logger.out(`HTML 报告已写出: ${flags.html}`);
  }
  if (flags.json && !silentJson) {
    logger.raw(`${toJson(report)}\n`);
  }
  return report;
}