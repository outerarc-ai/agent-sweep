import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import { isWindows } from './platform.js';
import { isPathInside } from './paths.js';
import { readText } from './fsx.js';

const execFileAsync = promisify(execFile);

const KNOWN_BINARIES = [
  'claude',
  'codex',
  'cursor',
  'windsurf',
  'devin',
  'trae',
  'trae-cn',
  'solo',
  'copilot',
  'aider',
  'goose',
  'opencode',
  'node',
  'code',
];

export async function collectOpenFiles({ timeoutMs = 12000, maxBuffer = 128 * 1024 * 1024 } = {}) {
  if (isWindows) return { supported: false, paths: [], byPath: new Map(), reason: 'lsof unavailable on Windows' };
  try {
    const { stdout } = await execFileAsync('lsof', ['-nP', '-F', 'pcn'], { timeout: timeoutMs, maxBuffer });
    const paths = [];
    const byPath = new Map();
    let pid = null;
    let command = null;
    for (const line of stdout.split('\n')) {
      if (!line) continue;
      const tag = line[0];
      const value = line.slice(1);
      if (tag === 'p') pid = Number(value);
      else if (tag === 'c') command = value;
      else if (tag === 'n') {
        const normalized = normalizeOpenPath(value);
        if (!normalized) continue;
        paths.push(normalized);
        byPath.set(normalized, { pid, command });
      }
    }
    return { supported: true, paths, byPath };
  } catch (err) {
    return { supported: false, paths: [], byPath: new Map(), reason: err && err.message ? err.message : 'lsof failed' };
  }
}

function normalizeOpenPath(value) {
  if (!value) return null;
  if (value.startsWith('/')) return value;
  return null;
}

export async function collectProcesses({ timeoutMs = 8000 } = {}) {
  try {
    if (isWindows) {
      const { stdout } = await execFileAsync('tasklist', ['/FO', 'CSV', '/NH'], { timeout: timeoutMs });
      const procs = [];
      for (const line of stdout.split('\n')) {
        const name = line.split('","')[0].replace(/^"/, '').replace(/\.exe$/i, '');
        if (name) procs.push({ pid: null, command: name });
      }
      return procs;
    }
    const { stdout } = await execFileAsync('ps', ['-axo', 'pid=,comm='], { timeout: timeoutMs, maxBuffer: 32 * 1024 * 1024 });
    const procs = [];
    for (const line of stdout.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      const match = trimmed.match(/^(\d+)\s+(.*)$/);
      if (!match) continue;
      procs.push({ pid: Number(match[1]), command: match[2] });
    }
    return procs;
  } catch {
    return [];
  }
}

export function runningHarnessBinaries(processes) {
  const found = new Set();
  for (const proc of processes || []) {
    const base = path.basename(String(proc.command || '')).replace(/\.exe$/i, '').toLowerCase();
    if (KNOWN_BINARIES.includes(base)) found.add(base);
  }
  return found;
}

export function findOpenOccupants(targetPath, openFiles) {
  if (!openFiles || !openFiles.supported) return [];
  const hits = new Map();
  for (const openPath of openFiles.paths) {
    if (isPathInside(targetPath, openPath)) {
      const info = openFiles.byPath.get(openPath);
      const key = info && info.pid ? `${info.pid}:${info.command}` : openPath;
      if (!hits.has(key)) hits.set(key, { pid: info ? info.pid : null, command: info ? info.command : null, path: openPath });
    }
  }
  return [...hits.values()];
}

export function isPidAlive(pid) {
  if (!pid || !Number.isFinite(pid)) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return Boolean(err && err.code === 'EPERM');
  }
}

export async function readLockPid(target) {
  const text = await readText(target, 4096);
  if (!text) return null;
  const match = text.match(/\d{1,7}/);
  if (!match) return null;
  return Number(match[0]);
}

export async function detectActive(targetPath, { openFiles, lockFiles = [], lockOwnerAlive = true } = {}) {
  const occupants = findOpenOccupants(targetPath, openFiles);
  if (occupants.length > 0) {
    return { active: true, reason: 'open-file', occupants };
  }
  for (const lock of lockFiles) {
    const lockPath = path.join(targetPath, lock);
    const pid = await readLockPid(lockPath);
    if (pid && isPidAlive(pid)) {
      return { active: true, reason: 'lock-pid', occupants: [{ pid, command: lock }] };
    }
    if (pid === null && (await readText(lockPath, 64))) {
      if (lockOwnerAlive) {
        return { active: true, reason: 'lock-file', occupants: [{ pid: null, command: lock }] };
      }
    }
  }
  return { active: false, reason: null, occupants: [] };
}