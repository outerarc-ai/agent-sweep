import { toPosix } from './paths.js';

const REGEX_CACHE = new Map();

export function globToRegExp(pattern, { caseSensitive = true } = {}) {
  const key = `${caseSensitive ? 'S' : 'I'}::${pattern}`;
  const cached = REGEX_CACHE.get(key);
  if (cached) return cached;

  const normalized = toPosix(String(pattern));
  let out = '';
  for (let i = 0; i < normalized.length; i += 1) {
    const ch = normalized[i];
    if (ch === '*') {
      const next = normalized[i + 1];
      if (next === '*') {
        const after = normalized[i + 2];
        if (after === '/') {
          out += '(?:.*/)?';
          i += 2;
        } else {
          out += '.*';
          i += 1;
        }
      } else {
        out += '[^/]*';
      }
    } else if (ch === '?') {
      out += '[^/]';
    } else if (ch === '{') {
      const end = normalized.indexOf('}', i);
      if (end === -1) {
        out += '\\{';
      } else {
        const options = normalized
          .slice(i + 1, end)
          .split(',')
          .map((part) => part.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[^/]*'));
        out += `(?:${options.join('|')})`;
        i = end;
      }
    } else if ('.+^$()|[]\\'.includes(ch)) {
      out += `\\${ch}`;
    } else {
      out += ch;
    }
  }

  const regex = new RegExp(`^${out}$`, caseSensitive ? '' : 'i');
  REGEX_CACHE.set(key, regex);
  return regex;
}

export function matchGlob(target, pattern, options) {
  return globToRegExp(pattern, options).test(toPosix(target));
}

export function matchAnyGlob(target, patterns, options) {
  if (!patterns || patterns.length === 0) return null;
  const posix = toPosix(target);
  for (const pattern of patterns) {
    if (globToRegExp(pattern, options).test(posix)) return pattern;
  }
  return null;
}

export function matchAnySegment(target, patterns, options) {
  if (!patterns || patterns.length === 0) return null;
  const posix = toPosix(target);
  const segments = posix.split('/');
  for (const pattern of patterns) {
    const regex = globToRegExp(pattern, options);
    for (const segment of segments) {
      if (regex.test(segment)) return pattern;
    }
  }
  return null;
}