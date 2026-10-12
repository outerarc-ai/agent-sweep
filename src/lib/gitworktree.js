import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readText, exists } from './fsx.js';

const execFileAsync = promisify(execFile);

const GITDIR_RE = /^gitdir:\s*(.+?)\s*$/m;

export async function readGitdirPointer(worktreePath) {
  const pointer = path.join(worktreePath, '.git');
  const text = await readText(pointer, 8192);
  if (!text) return null;
  const match = text.match(GITDIR_RE);
  if (!match) return null;
  const raw = match[1];
  return path.isAbsolute(raw) ? path.normalize(raw) : path.resolve(worktreePath, raw);
}

export function mainRepoFromGitdir(gitdir) {
  if (!gitdir) return null;
  const parts = gitdir.split(path.sep);
  const index = parts.lastIndexOf('worktrees');
  if (index <= 0) return null;
  const dotGitIndex = index - 1;
  const repoRootParts = parts.slice(0, dotGitIndex);
  if (repoRootParts.length === 0) return null;
  return repoRootParts.join(path.sep) || path.sep;
}

export async function inspectWorktree(worktreePath) {
  const gitdir = await readGitdirPointer(worktreePath);
  if (!gitdir) {
    return { kind: 'none', gitdir: null, mainRepo: null, mainRepoExists: false, gitdirExists: false, orphan: false, reason: 'no-gitdir-pointer' };
  }
  const mainRepo = mainRepoFromGitdir(gitdir);
  const mainRepoExists = mainRepo ? await exists(mainRepo) : false;
  const gitdirExists = await exists(gitdir);
  const orphan = !mainRepoExists || !gitdirExists;
  return {
    kind: 'worktree',
    gitdir,
    mainRepo,
    mainRepoExists,
    gitdirExists,
    orphan,
    reason: orphan
      ? !mainRepoExists
        ? 'main-repo-missing'
        : 'gitdir-missing'
      : 'linked',
  };
}

export async function pruneWorktrees(mainRepo, { dryRun = false, timeoutMs = 30000 } = {}) {
  if (!mainRepo) return { ok: false, reason: 'no-main-repo' };
  const args = ['-C', mainRepo, 'worktree', 'prune'];
  if (dryRun) args.push('-n', '-v');
  try {
    const { stdout, stderr } = await execFileAsync('git', args, { timeout: timeoutMs, maxBuffer: 8 * 1024 * 1024 });
    return { ok: true, dryRun, output: `${stdout}${stderr}`.trim() };
  } catch (err) {
    return { ok: false, reason: err && err.message ? err.message : 'git prune failed' };
  }
}

export async function gitAvailable() {
  try {
    await execFileAsync('git', ['--version'], { timeout: 5000 });
    return true;
  } catch {
    return false;
  }
}