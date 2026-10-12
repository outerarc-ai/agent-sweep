import path from 'node:path';
import { homedir, isWindows } from './platform.js';

const TOKEN_RE = /\{(home|appSupport|config|data|state|cache|temp)\}/g;

export function appSupportDir() {
  if (process.platform === 'darwin') {
    return path.join(homedir(), 'Library', 'Application Support');
  }
  if (isWindows) {
    return process.env.APPDATA || path.join(homedir(), 'AppData', 'Roaming');
  }
  return process.env.XDG_CONFIG_HOME || path.join(homedir(), '.config');
}

export function configDir() {
  return process.env.XDG_CONFIG_HOME || path.join(homedir(), '.config');
}

export function dataDir() {
  return process.env.XDG_DATA_HOME || path.join(homedir(), '.local', 'share');
}

export function stateDir() {
  return process.env.XDG_STATE_HOME || path.join(homedir(), '.local', 'state');
}

export function cacheDir() {
  if (process.platform === 'darwin') {
    return path.join(homedir(), 'Library', 'Caches');
  }
  return process.env.XDG_CACHE_HOME || path.join(homedir(), '.cache');
}

const TOKENS = {
  home: homedir,
  appSupport: appSupportDir,
  config: configDir,
  data: dataDir,
  state: stateDir,
  cache: cacheDir,
  temp: () => process.env.TMPDIR || '/tmp',
};

export function expandPath(input) {
  if (!input || typeof input !== 'string') return input;
  let out = input.trim();
  if (out === '~') {
    return homedir();
  }
  if (out.startsWith('~/') || out.startsWith('~\\')) {
    out = path.join(homedir(), out.slice(2));
  }
  out = out.replace(TOKEN_RE, (_m, name) => {
    const fn = TOKENS[name];
    return fn ? fn() : _m;
  });
  return path.normalize(out);
}

export function expandPaths(list) {
  return (list || []).map(expandPath);
}

export function isPathInside(parent, child) {
  if (!parent || !child) return false;
  const rel = path.relative(parent, child);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

export function toPosix(p) {
  return p.split(path.sep).join('/');
}

export function collapseHome(p, home = homedir()) {
  if (!p) return p;
  if (p === home) return '~';
  if (p.startsWith(home + path.sep)) return '~/' + toPosix(p.slice(home.length + 1));
  return p;
}

export function displayPath(p, home = homedir()) {
  return collapseHome(p, home);
}

export function uniquePaths(paths) {
  return [...new Set(paths.filter(Boolean).map((p) => path.normalize(p)))];
}