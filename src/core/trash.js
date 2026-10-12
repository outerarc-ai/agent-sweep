import path from 'node:path';
import fs from 'node:fs/promises';
import { homedir } from '../lib/platform.js';
import { ensureDir, exists, listDir, movePath, readJson, removePath, lstatSafe } from '../lib/fsx.js';

export const TRASH_SCHEMA = 'agent-sweep/trash@1';

export function defaultTrashRoot() {
  const base = process.env.AGENT_SWEEP_HOME || path.join(homedir(), '.agent-sweep');
  return path.join(base, 'trash');
}

export function batchId(date = new Date()) {
  const pad = (v) => String(v).padStart(2, '0');
  const stamp = `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
  const rand = Math.random().toString(36).slice(2, 6);
  return `${stamp}-${rand}`;
}

export function createTrash({ root = defaultTrashRoot() } = {}) {
  return {
    root,

    async init() {
      await ensureDir(path.join(root));
      return root;
    },

    async createBatch({ label = null, now = new Date() } = {}) {
      const id = batchId(now);
      const dir = path.join(root, id);
      const filesDir = path.join(dir, 'files');
      await ensureDir(filesDir);
      const manifest = {
        schema: TRASH_SCHEMA,
        id,
        label,
        createdAt: now.toISOString(),
        platform: process.platform,
        entries: [],
        prunedRepos: [],
        stats: { moved: 0, failed: 0, freedBytes: 0 },
        dir,
        filesDir,
      };
      return manifest;
    },

    async addEntry(batch, action, index) {
      const source = action.path;
      const base = path.basename(source) || `item-${index}`;
      const safeBase = base.replace(/[/\\]/g, '_');
      let destination = path.join(batch.filesDir, `${String(index).padStart(4, '0')}-${safeBase}`);
      let suffix = 1;
      while (await exists(destination)) {
        destination = path.join(batch.filesDir, `${String(index).padStart(4, '0')}-${safeBase}.${suffix}`);
        suffix += 1;
      }

      const mode = await movePath(source, destination);
      const entry = {
        id: action.id,
        harnessId: action.harnessId,
        targetId: action.targetId,
        kind: action.kind,
        circle: action.circle,
        originalPath: source,
        trashPath: destination,
        sizeBytes: action.sizeBytes,
        isDir: action.isDir,
        mainRepo: action.mainRepo || null,
        moveMode: mode.mode,
        movedAt: new Date().toISOString(),
      };
      batch.entries.push(entry);
      batch.stats.moved += 1;
      batch.stats.freedBytes += action.sizeBytes || 0;
      return entry;
    },

    async writeManifest(batch) {
      const target = path.join(batch.dir, 'manifest.json');
      const payload = JSON.stringify(batch, null, 2);
      await fs.writeFile(target, payload, 'utf8');
      return target;
    },

    async listBatches() {
      const entries = await listDir(root);
      const batches = [];
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const manifestPath = path.join(root, entry.name, 'manifest.json');
        const manifest = await readJson(manifestPath);
        const st = await lstatSafe(path.join(root, entry.name));
        batches.push({
          id: entry.name,
          dir: path.join(root, entry.name),
          createdAt: manifest ? manifest.createdAt : st ? new Date(st.mtimeMs).toISOString() : null,
          entries: manifest ? manifest.entries.length : null,
          freedBytes: manifest ? manifest.stats.freedBytes : null,
          label: manifest ? manifest.label : null,
          hasManifest: Boolean(manifest),
        });
      }
      return batches.sort((a, b) => String(b.id).localeCompare(String(a.id)));
    },

    async readManifest(id) {
      const manifestPath = path.join(root, id, 'manifest.json');
      const manifest = await readJson(manifestPath);
      if (!manifest) throw new Error(`trash batch not found or missing manifest: ${id}`);
      return manifest;
    },

    async restore(id, { dryRun = false, onProgress = null } = {}) {
      const manifest = await this.readManifest(id);
      const restored = [];
      const conflicts = [];
      const missing = [];

      for (const entry of manifest.entries) {
        const source = entry.trashPath;
        const target = entry.originalPath;
        if (!(await exists(source))) {
          missing.push(entry);
          continue;
        }
        if (await exists(target)) {
          conflicts.push(entry);
          continue;
        }
        if (dryRun) {
          restored.push({ ...entry, dryRun: true });
          continue;
        }
        await ensureDir(path.dirname(target));
        await movePath(source, target);
        restored.push(entry);
        if (onProgress) onProgress(entry);
      }

      if (!dryRun && missing.length === 0) {
        await removePath(path.join(root, id));
      }

      return { id, restored, conflicts, missing, dryRun };
    },

    async empty({ olderThanDays = 0, now = Date.now() } = {}) {
      const batches = await this.listBatches();
      const removed = [];
      for (const batch of batches) {
        if (olderThanDays > 0) {
          const created = batch.createdAt ? Date.parse(batch.createdAt) : NaN;
          if (!Number.isFinite(created)) continue;
          const ageDays = (now - created) / 86400000;
          if (ageDays < olderThanDays) continue;
        }
        await removePath(batch.dir);
        removed.push(batch.id);
      }
      return { removed };
    },

    async stats() {
      const batches = await this.listBatches();
      return {
        root,
        batchCount: batches.length,
        freedBytes: batches.reduce((sum, b) => sum + (b.freedBytes || 0), 0),
        batches,
      };
    },
  };
}