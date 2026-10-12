import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { renderHtmlReport } from '../core/reporter/html.js';
import { silentLogger } from '../lib/log.js';
import {
  buildState,
  runScan,
  planSelection,
  runExecution,
  listTrash,
  readBatch,
  restoreBatch,
  emptyTrash,
  createServiceContext,
} from './service.js';

const PUBLIC_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'public');
const BOOTSTRAP_PLACEHOLDER = '__AGENT_SWEEP_BOOTSTRAP__';

const CONTENT_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};

const LOOPBACK_HOSTS = new Set(['127.0.0.1', '::1', 'localhost']);
const MAX_BODY_BYTES = 2 * 1024 * 1024;
const MAX_JOBS = 20;

class JobStore {
  constructor() {
    this.jobs = new Map();
  }

  create(kind) {
    const id = crypto.randomBytes(9).toString('hex');
    const job = {
      id,
      kind,
      state: 'running',
      startedAt: Date.now(),
      finishedAt: null,
      progress: null,
      result: null,
      error: null,
    };
    this.jobs.set(id, job);
    this.evict();
    return job;
  }

  get(id) {
    return this.jobs.get(id) || null;
  }

  running(kind) {
    for (const job of this.jobs.values()) {
      if (job.kind === kind && job.state === 'running') return job;
    }
    return null;
  }

  evict() {
    if (this.jobs.size <= MAX_JOBS) return;
    const ordered = [...this.jobs.values()].sort((a, b) => a.startedAt - b.startedAt);
    while (ordered.length > MAX_JOBS) {
      const oldest = ordered.shift();
      this.jobs.delete(oldest.id);
    }
  }
}

function jobView(job) {
  if (!job) return null;
  return {
    id: job.id,
    kind: job.kind,
    state: job.state,
    startedAt: job.startedAt,
    finishedAt: job.finishedAt,
    durationMs: (job.finishedAt || Date.now()) - job.startedAt,
    progress: job.progress,
    error: job.error,
    result: job.result,
  };
}

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    'cache-control': 'no-store',
  });
  res.end(body);
}

function sendText(res, status, text) {
  res.writeHead(status, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' });
  res.end(text);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new Error('request body too large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      const text = Buffer.concat(chunks).toString('utf8').trim();
      if (!text) return resolve({});
      try {
        const parsed = JSON.parse(text);
        resolve(parsed && typeof parsed === 'object' ? parsed : {});
      } catch {
        reject(new Error('invalid JSON body'));
      }
    });
    req.on('error', reject);
  });
}

function originAllowed(req) {
  const origin = req.headers.origin;
  if (!origin) return true;
  try {
    return LOOPBACK_HOSTS.has(new URL(origin).hostname);
  } catch {
    return false;
  }
}

function isInside(parent, child) {
  const rel = path.relative(parent, child);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

function safeEqual(a, b) {
  const bufA = Buffer.from(String(a));
  const bufB = Buffer.from(String(b));
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

export function createWebServer({ baseFlags = {}, version = '0.0.0', logger = silentLogger } = {}) {
  const token = crypto.randomBytes(24).toString('hex');
  const jobs = new JobStore();

  let baseCtx = null;
  let baseCtxError = null;
  const ready = createServiceContext(baseFlags)
    .then((ctx) => {
      baseCtx = ctx;
    })
    .catch((err) => {
      baseCtxError = err;
    });

  let lastScan = null;

  function requireToken(req, res) {
    const provided = req.headers['x-agent-sweep-token'];
    if (!provided || !safeEqual(provided, token)) {
      sendJson(res, 403, { error: 'forbidden', detail: 'missing or invalid session token' });
      return false;
    }
    if (!originAllowed(req)) {
      sendJson(res, 403, { error: 'forbidden', detail: 'cross-origin request rejected' });
      return false;
    }
    return true;
  }

  async function serveStatic(res, pathname) {
    const rel = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
    const target = path.resolve(PUBLIC_DIR, rel);
    if (!isInside(PUBLIC_DIR, target)) return sendText(res, 403, 'forbidden');
    let data;
    try {
      data = await fs.readFile(target);
    } catch {
      return sendText(res, 404, 'not found');
    }
    const ext = path.extname(target).toLowerCase();
    res.writeHead(200, {
      'content-type': CONTENT_TYPES[ext] || 'application/octet-stream',
      'content-length': data.length,
      'cache-control': ext === '.html' ? 'no-store' : 'no-cache',
    });
    res.end(data);
  }

  async function serveIndex(res) {
    let html;
    try {
      html = await fs.readFile(path.join(PUBLIC_DIR, 'index.html'), 'utf8');
    } catch {
      return sendText(res, 500, 'ui assets missing');
    }
    const bootstrap = JSON.stringify({ token, version, startedAt: new Date().toISOString() }).replace(
      /</g,
      '\\u003c',
    );
    const out = html.replace(BOOTSTRAP_PLACEHOLDER, bootstrap);
    res.writeHead(200, { 'content-type': CONTENT_TYPES['.html'], 'cache-control': 'no-store' });
    res.end(out);
  }

  async function handleApi(req, res, pathname) {
    if (!requireToken(req, res)) return;
    await ready;
    if (baseCtxError) return sendJson(res, 500, { error: 'context-init-failed', detail: baseCtxError.message });

    if (req.method === 'GET' && pathname === '/api/state') {
      return sendJson(res, 200, buildState(baseCtx, { version }));
    }

    if (req.method === 'POST' && pathname === '/api/scan') {
      if (jobs.running('scan')) {
        return sendJson(res, 409, { error: 'scan-in-progress', detail: 'a scan is already running' });
      }
      const body = await readBody(req);
      const job = jobs.create('scan');
      runScan({
        baseFlags,
        body,
        onProgress: (p) => {
          job.progress = {
            phase: 'scan',
            index: p.index,
            total: p.total,
            harnessId: p.harness.id,
            harnessName: p.harness.name,
          };
        },
      })
        .then(({ raw, view }) => {
          lastScan = raw;
          job.result = view;
          job.state = 'done';
          job.finishedAt = Date.now();
          logger.info(`scan complete: ${view.units.length} units in ${view.scan.durationMs}ms`);
        })
        .catch((err) => {
          job.state = 'error';
          job.error = err && err.message ? err.message : String(err);
          job.finishedAt = Date.now();
          logger.error(`scan failed: ${job.error}`);
        });
      return sendJson(res, 202, { jobId: job.id, state: job.state });
    }

    if (req.method === 'GET' && pathname.startsWith('/api/jobs/')) {
      const id = pathname.slice('/api/jobs/'.length);
      const job = jobs.get(id);
      if (!job) return sendJson(res, 404, { error: 'job-not-found', id });
      return sendJson(res, 200, jobView(job));
    }

    if (req.method === 'POST' && pathname === '/api/plan') {
      if (!lastScan) return sendJson(res, 409, { error: 'no-scan', detail: 'run a scan first' });
      const body = await readBody(req);
      const plan = planSelection(lastScan, {
        actionIds: body.actionIds,
        directDelete: Boolean(body.directDelete),
      });
      return sendJson(res, 200, { plan });
    }

    if (req.method === 'POST' && pathname === '/api/execute') {
      if (!lastScan) return sendJson(res, 409, { error: 'no-scan', detail: 'run a scan first' });
      const body = await readBody(req);
      const dryRun = body.dryRun !== false;
      const directDelete = body.directDelete === true;
      if (!dryRun) {
        if (body.confirm !== true) {
          return sendJson(res, 400, { error: 'confirm-required', detail: 'set confirm:true to execute for real' });
        }
        if (directDelete && body.confirmText !== 'DELETE') {
          return sendJson(res, 400, {
            error: 'confirm-text-required',
            detail: 'direct delete requires confirmText:"DELETE"',
          });
        }
      }
      const { plan, execution } = await runExecution(lastScan, {
        actionIds: body.actionIds,
        dryRun,
        directDelete,
        prune: body.prune !== false,
      });
      return sendJson(res, 200, {
        plan,
        execution,
        report: {
          planned: plan.totals.actionCount,
          plannedBytes: plan.totals.actionBytes,
          moved: execution.moved.length,
          skipped: execution.skipped.length,
          failed: execution.failed.length,
          pruned: execution.pruned.length,
          freedBytes: execution.freedBytes,
          batchId: execution.batchId,
          dryRun: execution.dryRun,
        },
      });
    }

    if (req.method === 'GET' && pathname === '/api/trash') {
      return sendJson(res, 200, await listTrash(baseCtx));
    }

    if (req.method === 'GET' && pathname.startsWith('/api/trash/')) {
      const id = decodeURIComponent(pathname.slice('/api/trash/'.length));
      try {
        return sendJson(res, 200, await readBatch(baseCtx, id));
      } catch (err) {
        return sendJson(res, 404, { error: 'batch-not-found', id, detail: err.message });
      }
    }

    if (req.method === 'POST' && pathname === '/api/trash/restore') {
      const body = await readBody(req);
      if (!body.batchId) return sendJson(res, 400, { error: 'batchId-required' });
      const dryRun = body.dryRun === true;
      if (!dryRun && body.confirm !== true) {
        return sendJson(res, 400, { error: 'confirm-required', detail: 'set confirm:true to restore' });
      }
      try {
        const result = await restoreBatch(baseCtx, body.batchId, { dryRun });
        return sendJson(res, 200, result);
      } catch (err) {
        return sendJson(res, 404, { error: 'restore-failed', detail: err.message });
      }
    }

    if (req.method === 'POST' && pathname === '/api/trash/empty') {
      const body = await readBody(req);
      if (body.confirm !== true) {
        return sendJson(res, 400, { error: 'confirm-required', detail: 'set confirm:true to empty the trash' });
      }
      const olderThanDays = Number.isFinite(body.olderThanDays) ? body.olderThanDays : 0;
      return sendJson(res, 200, await emptyTrash(baseCtx, { olderThanDays }));
    }

    if (req.method === 'GET' && pathname === '/api/report.html') {
      if (!lastScan) return sendText(res, 409, 'no scan yet');
      const html = renderHtmlReport({ scan: lastScan.scan, summary: lastScan.summary, plan: null });
      res.writeHead(200, { 'content-type': CONTENT_TYPES['.html'], 'cache-control': 'no-store' });
      return res.end(html);
    }

    return sendJson(res, 404, { error: 'not-found', path: pathname });
  }

  const server = http.createServer(async (req, res) => {
    let url;
    try {
      url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    } catch {
      return sendText(res, 400, 'bad request');
    }
    const { pathname } = url;

    try {
      if (pathname.startsWith('/api/')) return await handleApi(req, res, pathname);
      if (req.method !== 'GET' && req.method !== 'HEAD') return sendText(res, 405, 'method not allowed');
      if (pathname === '/') return await serveIndex(res);
      return await serveStatic(res, pathname);
    } catch (err) {
      if (!res.headersSent) sendJson(res, 500, { error: 'internal', detail: err && err.message ? err.message : String(err) });
      else res.end();
    }
  });

  server.on('clientError', (err, socket) => {
    if (socket.writable) socket.end('HTTP/1.1 400 Bad Request\r\n\r\n');
  });

  return { server, token, getLastScan: () => lastScan };
}

export function openBrowser(url) {
  const platform = process.platform;
  const command = platform === 'darwin' ? 'open' : platform === 'win32' ? 'cmd' : 'xdg-open';
  const args = platform === 'win32' ? ['/c', 'start', '', url] : [url];
  try {
    const child = spawn(command, args, { stdio: 'ignore', detached: true });
    child.on('error', () => {});
    child.unref();
  } catch {
    // Opening a browser is best effort; the URL is printed either way.
  }
}

export async function startUi({
  baseFlags = {},
  version = '0.0.0',
  host = '127.0.0.1',
  port = 7317,
  open = false,
  logger = silentLogger,
} = {}) {
  const { server, token, getLastScan } = createWebServer({ baseFlags, version, logger });

  await new Promise((resolve, reject) => {
    const onError = (err) => {
      server.removeListener('listening', onListening);
      reject(err);
    };
    const onListening = () => {
      server.removeListener('error', onError);
      resolve();
    };
    server.once('error', onError);
    server.once('listening', onListening);
    server.listen(port, host);
  });

  const address = server.address();
  const actualPort = address && typeof address === 'object' ? address.port : port;
  const displayHost = host === '0.0.0.0' || host === '::' ? '127.0.0.1' : host;
  const url = `http://${displayHost.includes(':') ? `[${displayHost}]` : displayHost}:${actualPort}/`;

  logger.info(`agent-sweep ui listening on ${url}`);
  if (open) openBrowser(url);

  return { server, url, token, getLastScan, close: () => new Promise((resolve) => server.close(resolve)) };
}