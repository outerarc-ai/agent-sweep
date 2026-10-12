import fs from 'node:fs/promises';
import path from 'node:path';
import { isPathInside } from './paths.js';

export async function lstatSafe(target) {
  try {
    return await fs.lstat(target);
  } catch {
    return null;
  }
}

export async function statSafe(target) {
  try {
    return await fs.stat(target);
  } catch {
    return null;
  }
}

export async function exists(target) {
  return (await lstatSafe(target)) !== null;
}

export async function isDirectory(target) {
  const st = await lstatSafe(target);
  return Boolean(st && st.isDirectory());
}

export async function isFile(target) {
  const st = await lstatSafe(target);
  return Boolean(st && st.isFile());
}

export async function listDir(target) {
  try {
    return await fs.readdir(target, { withFileTypes: true });
  } catch {
    return [];
  }
}

export async function listNames(target) {
  try {
    return await fs.readdir(target);
  } catch {
    return [];
  }
}

export async function ensureDir(target) {
  await fs.mkdir(target, { recursive: true });
  return target;
}

export async function readText(target, maxBytes = 1024 * 1024) {
  try {
    const handle = await fs.open(target, 'r');
    try {
      const buf = Buffer.alloc(maxBytes);
      const { bytesRead } = await handle.read(buf, 0, maxBytes, 0);
      return buf.subarray(0, bytesRead).toString('utf8');
    } finally {
      await handle.close();
    }
  } catch {
    return null;
  }
}

export async function readJson(target) {
  const text = await readText(target);
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

const MAX_ENTRIES = 500000;

export async function measureTree(root) {
  const result = {
    sizeBytes: 0,
    fileCount: 0,
    dirCount: 0,
    symlinkCount: 0,
    leafMaxMtimeMs: 0,
    dirMtimeMs: 0,
    unreadable: 0,
    truncated: false,
    maxDepth: 0,
  };

  const rootStat = await lstatSafe(root);
  if (!rootStat) return result;
  result.dirMtimeMs = rootStat.mtimeMs;

  if (!rootStat.isDirectory()) {
    result.sizeBytes = rootStat.size;
    result.fileCount = 1;
    result.leafMaxMtimeMs = rootStat.mtimeMs;
    return result;
  }

  const stack = [{ dir: root, depth: 0 }];
  let seen = 0;

  while (stack.length > 0) {
    const { dir, depth } = stack.pop();
    if (depth > result.maxDepth) result.maxDepth = depth;

    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      result.unreadable += 1;
      continue;
    }

    for (const entry of entries) {
      if (seen >= MAX_ENTRIES) {
        result.truncated = true;
        break;
      }
      seen += 1;

      const full = path.join(dir, entry.name);
      const st = await lstatSafe(full);
      if (!st) {
        result.unreadable += 1;
        continue;
      }

      if (st.isSymbolicLink()) {
        result.symlinkCount += 1;
        result.fileCount += 1;
        if (st.mtimeMs > result.leafMaxMtimeMs) result.leafMaxMtimeMs = st.mtimeMs;
        continue;
      }

      if (st.isDirectory()) {
        result.dirCount += 1;
        stack.push({ dir: full, depth: depth + 1 });
        continue;
      }

      result.fileCount += 1;
      result.sizeBytes += st.size;
      if (st.mtimeMs > result.leafMaxMtimeMs) result.leafMaxMtimeMs = st.mtimeMs;
    }

    if (result.truncated) break;
  }

  return result;
}

export async function pathSize(target) {
  const st = await lstatSafe(target);
  if (!st) return 0;
  if (!st.isDirectory()) return st.size;
  const measured = await measureTree(target);
  return measured.sizeBytes;
}

export async function movePath(source, destination) {
  await ensureDir(path.dirname(destination));
  try {
    await fs.rename(source, destination);
    return { mode: 'rename' };
  } catch (err) {
    if (err && (err.code === 'EXDEV' || err.code === 'EPERM' || err.code === 'ENOTEMPTY')) {
      await fs.cp(source, destination, { recursive: true, force: true, errorOnExist: false });
      await fs.rm(source, { recursive: true, force: true });
      return { mode: 'copy' };
    }
    throw err;
  }
}

export async function removePath(target) {
  await fs.rm(target, { recursive: true, force: true, maxRetries: 3 });
}

export async function removeEmptyDirs(root, stopAt = root) {
  let current = root;
  const removed = [];
  while (isPathInside(stopAt, current) && current !== stopAt) {
    const names = await listNames(current);
    if (names.length > 0) break;
    try {
      await fs.rmdir(current);
      removed.push(current);
    } catch {
      break;
    }
    current = path.dirname(current);
  }
  return removed;
}

export async function realpathSafe(target) {
  try {
    return await fs.realpath(target);
  } catch {
    return null;
  }
}