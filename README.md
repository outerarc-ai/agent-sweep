# agent-sweep

[![CI](https://github.com/outerarc-ai/agent-sweep/actions/workflows/ci.yml/badge.svg)](https://github.com/outerarc-ai/agent-sweep/actions/workflows/ci.yml)
[![CodeQL](https://github.com/outerarc-ai/agent-sweep/actions/workflows/codeql.yml/badge.svg)](https://github.com/outerarc-ai/agent-sweep/actions/workflows/codeql.yml)
[![npm version](https://img.shields.io/npm/v/agent-sweep.svg)](https://www.npmjs.com/package/agent-sweep)
[![license](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](LICENSE)
[![node](https://img.shields.io/badge/node-%3E%3D18.17.0-brightgreen.svg)](package.json)

**English** · [简体中文](README.zh-CN.md)

Cross-harness cleanup for AI coding agent residue. agent-sweep scans, reviews and reclaims the session workspaces, orphan git worktrees and application caches that AI coding agents leave behind on your machine. It covers Claude Code, Codex CLI, Cursor, Trae, Windsurf, Copilot, Aider, Goose/OpenCode and more.

- **Read-only by default.** Scan, analysis and planning never write to disk. Only `clean` can change anything.
- **Reversible.** Items are moved to a local trash with a restore manifest. `restore` rolls a batch back in one command.
- **Hard safety constraints.** Memory files, MCP registrations, credentials and active workspaces sit in a *never-clean* circle that no flag can override.
- **Zero dependencies.** Node built-ins only. There are no `dependencies` and no CDN assets. HTML reports are self-contained, and the local web UI is dependency-free too.
- **Registry-driven.** Supporting a new harness means adding one declaration. The scan engine does not change.

## Why

AI coding agents write a lot of state into your home directory: session JSONL files, rollouts sharded by day, file history, image and paste caches, and **orphan git worktrees**. This data only grows. It is also spread across a dozen directory conventions that know nothing about each other.

| Symptom | Typical scale |
| --- | --- |
| Session workspaces and worktrees pile up | Tens of GB for a single harness |
| Host project deleted, worktree registration left behind | "Orphans" pointing at a repo that no longer exists |
| IDE caches (Cache / CodeCache / GPUCache / logs) | Grow linearly with usage |
| Memory, credentials and MCP config mixed in with junk | Deleting the wrong file is irreversible |

agent-sweep lists all of these objects in one place. It uses **compound signals** to decide what is safe to reclaim, and it shows you a reviewable plan before it touches anything.

## Install

```bash
# Run from source, no install needed
node ./bin/agent-sweep.js scan

# Or install globally
npm install -g agent-sweep
agent-sweep scan
```

Requires Node.js `>= 18.17.0`. Supports macOS, Linux and Windows. On Windows, two capabilities degrade automatically:

- Process-occupancy detection is unavailable.
- `encoded-cwd` orphan detection for session directories uses only the `cwd` recorded in session transcripts and does no filesystem probing. Without that evidence, the session is reported as *unknown* instead of being misjudged as an orphan.

## Quick start

```bash
# 1. Read-only scan of what is on disk (terminal tables)
agent-sweep scan

# 2. Write a self-contained HTML report to share or review
agent-sweep scan --html report.html

# 3. Build a reviewable cleanup plan (still read-only)
agent-sweep plan --include-review

# 4. Persist the plan, then execute it later (re-verified per item)
agent-sweep plan --include-review --save plan.json
agent-sweep clean --plan-file plan.json --yes

# 5. Rehearse: run the full re-verification and move logic without writing
agent-sweep clean --include-review --dry-run

# 6. Execute: move items to the trash (reversible)
agent-sweep clean --include-review --yes

# 7. Changed your mind? Restore from the trash
agent-sweep trash list
agent-sweep restore 20261012-114530-9qmh
```

## What it looks like

Below is an excerpt of a real `scan` on a macOS machine that has run several AI coding agents for a long time. The scan was read-only and took about 7 seconds. Terminal output is currently in Chinese. The web UI is bilingual.

```console
扫描概览
  平台 macOS · harness 8 个 · 候选单元 430 个 · 合计 8.90 GB
  可回收 2.33 GB（安全圈 1.98 GB · 待确认圈 359 MB）· 保护 770 MB

Harness                单元     合计   安全圈  待确认     保护   最旧  最新
─────────────────────  ────  ───────  ───────  ──────  ───────  ─────  ────
Trae / Trae CN / SOLO   396  8.90 GB  1.98 GB  359 MB   770 MB  8.3mo    1m
Copilot CLI (仅报告)     33  19.2 KB      0 B     0 B  19.2 KB    67d    2h
Claude Code               1  50 B       0 B     0 B      0 B    41d   41d
```

Three numbers stand out:

- **Total:** 430 residue objects, 8.90 GB.
- **Reclaimable:** 2.33 GB, of which 1.98 GB is safe to clean right away.
- **Protected:** 770 MB of memory, credentials and active sessions that no flag can touch.

Orphan worktrees (whose host project was deleted) and stale caches are flagged automatically.

The same data is also available as:

- `agent-sweep scan --html report.html`: a self-contained HTML report
- `agent-sweep ui --open`: select, rehearse and execute in the browser (see below)
- `agent-sweep clean --include-review --yes`: execute; reclaimed space goes to the trash and can be restored

## Local web UI

If you would rather not remember flags, the local web UI walks through the whole flow:

```bash
agent-sweep ui --open
```

It opens `http://127.0.0.1:7317/` and is organised in five steps. It shares the same pipeline as the CLI.

1. **Scan.** Pick harnesses and set TTL, minimum size and minimum score, then list candidates read-only.
2. **Select.** Filter by circle, harness, kind, score and keyword, and pick items one by one. Never-clean and report-only items are not listed here. A summary line shows their count and size.
3. **Rehearse.** Re-verify every item with the same rules as a real run, and show what would be processed and what would be blocked. Nothing is written.
4. **Execute.** Choose *move to trash* or *delete permanently*. Permanent deletion requires typing `DELETE`. The result shows the space freed and the `git worktree prune` outcome.
5. **Trash.** Browse batch manifests, rehearse a restore and restore.

The UI is bilingual (Chinese / English) and can be switched from the sidebar. The choice is stored in `localStorage`. On first visit the language follows the browser. All copy is localised on the client, including backend codes such as circles and classification reasons.

The safety boundary is the same as the CLI, with extra hardening:

- Binds to `127.0.0.1` only, unless `--host` is given. A **session token** is generated at startup and required on every API call.
- Checks `Origin` to reject cross-site requests. Static assets are protected against path traversal.
- The server **never trusts paths sent by the client**. On execute, it rebuilds the plan by item id and re-checks the hard constraints and process occupancy.
- Permanent deletion requires `confirmText: "DELETE"` in the request body, on top of the typed confirmation in the UI.

| Option | Description |
| --- | --- |
| `--port <n>` | Port to listen on (default `7317`) |
| `--host <addr>` | Bind address (default `127.0.0.1`; a non-loopback address prints a warning) |
| `--open` | Open the browser after start |

Scan options (`--harness` / `--ttl` / `--min-size` / `--no-active-check` / `--trash-root` and so on) also act as defaults in the web UI.

## Safety model: three circles

Every candidate is placed in exactly one circle. The circle is **the last gate before execution** and is independent of the score.

| Circle | Meaning | Acted on by default |
| --- | --- | --- |
| **Circle 1 · Safe to clean** | Orphan worktrees, stale caches, logs, thumbnails | ✅ Yes |
| **Circle 2 · Review before cleaning** | Stale session data that still carries some uncertainty | ⚠️ Only with `--include-review` |
| **Circle 3 · Never clean** | Memory, credentials, MCP registrations, plugins, items in use, report-only targets | ⛔ Hard constraint, no flag overrides it |

Classification short-circuits in this order (first match wins):

1. Matches an explicit guard (`neverDelete` or a global protected path) → circle 3
2. Target declared `removable: false` (report-only) → circle 3
3. In use by a process (open file via lsof / lock file) → circle 3
4. Younger than the TTL → keep
5. Smaller than `--min-size` → keep
6. Orphan → circle 1
7. Cache / log / thumbnail → circle 1
8. Stale low-risk object → circle 1
9. Any other stale object → circle 2

> Guards are **directory-aware**. Filename heuristics (such as `.env` or `AGENTS.md`) only protect the individual file. A session directory is never frozen just because it happens to contain a `.env.example`. Subtree protection only honours paths declared explicitly in the registry.

See [docs/safety-model.md](docs/safety-model.md) for the full model.

## Supported harnesses

| ID | Name | Shape | Default TTL | Risk | Write capability |
| --- | --- | --- | --- | --- | --- |
| `claude-code` | Claude Code | CLI | 30d | medium | ✅ Cleanable |
| `codex` | Codex CLI | CLI | 60d | medium | ✅ Cleanable |
| `cursor` | Cursor | IDE | 30d | high | ✅ Cleanable |
| `trae` | Trae / Trae CN / SOLO | IDE | 30d | medium | ✅ Cleanable |
| `windsurf` | Windsurf / Devin | IDE | 90d | medium | Report only |
| `copilot` | Copilot CLI | CLI | 60d | low | Report only |
| `aider` | Aider | CLI | 90d | low | Report only |
| `goose` | Goose / OpenCode | XDG | 60d | low | Report only |

Report-only harnesses are fully scanned and shown in reports, but they never produce an executable action. This is a deliberate, gradual approach: show the scale first, then decide whether to enable writes.

To see the full registry and the paths of every target:

```bash
agent-sweep harnesses
agent-sweep harnesses trae --verbose
```

Want another harness supported? Open a [harness request](https://github.com/outerarc-ai/agent-sweep/issues/new?template=harness_request.yml).

## Commands

| Command | Description |
| --- | --- |
| `scan` | Read-only scan and residue report (default command) |
| `plan` | Build a reviewable cleanup plan (read-only) |
| `clean` | Execute cleanup (moves to the trash by default, reversible) |
| `restore <batchId>` | Restore one batch from the trash |
| `trash [list\|empty]` | List or empty the trash |
| `ui` | Start the local web UI (scan / select / rehearse / execute / restore) |
| `harnesses [id]` | List the built-in harness registry |
| `doctor` | Environment and registry self-check |
| `help` / `version` | Help / version |

### Common options

| Option | Description |
| --- | --- |
| `--harness <id>` | Limit to a harness (repeatable or comma-separated) |
| `--ttl <days\|id=days>` | Override TTL, e.g. `--ttl 60` or `--ttl trae=45` |
| `--older-than <days>` | Same as a global `--ttl` |
| `--min-size <size>` | Minimum action size, e.g. `--min-size 10MB` |
| `--min-score <n>` | Minimum action score |
| `--include-review` | Also act on circle 2 |
| `--safe-only` | Circle 1 only (default) |
| `--dry-run, -n` | Rehearse only, write nothing |
| `--yes, -y` | Skip the interactive confirmation |
| `--direct-delete` | Delete permanently instead of moving to the trash (requires `--yes`) |
| `--no-prune` | Skip `git worktree prune` |
| `--no-active-check` | Skip lsof process-occupancy detection |
| `--json` | Output JSON |
| `--html <file>` | Write a self-contained HTML report |
| `--trash-root <path>` | Custom trash root directory |
| `--save <file>` | (`plan`) Write the plan to a JSON file |
| `--plan-file <file>` | (`clean`) Execute a previously saved plan (re-verified per item) |
| `--concurrency <n>` | Concurrent measurements (default 8) |
| `--port <n>` / `--host <addr>` / `--open` | Web UI port / bind address / open browser |
| `--verbose, -v` / `--quiet, -q` / `--no-color` | Logging and colour control |

## How items are judged

Age is **not** the directory's own mtime. It is the **newest leaf-file mtime** in the subtree. A directory's mtime changes whenever unrelated children are added or removed. The leaf mtime reflects the last real write. Three more signals are layered on top, and items are ranked by a weighted score:

| Signal | Weight | Description |
| --- | --- | --- |
| Size | 0.50 | Normalised against `sizeCap` (default 2 GB) |
| Age | 0.35 | Normalised against `TTL × 3` |
| Orphan | 0.15 | Worktree main repo missing / session host project deleted |

Risk level adds a penalty (low 0 / medium 0.05 / high 0.15), so higher-risk items rank lower at the same size.

There are two kinds of orphan detection:

- **git-worktree.** Reads the `.git` pointer file in the worktree and resolves the main repository. If the main repo or the gitdir is missing, the worktree is an orphan.
- **encoded-cwd.** The session directory name encodes the host project path. Every non-alphanumeric character becomes `-`, so `_`, `.`, spaces and `/` cannot be told apart after encoding. agent-sweep first reads the `cwd` recorded in the session JSONL. A session is an orphan only when that `cwd` encodes to the directory name *and* no longer exists. Without transcript evidence, it matches the encoded name against directories that actually exist. A match means the session is live. No match means *unknown* (circle 2). A decode failure alone **never** makes a session an orphan.

## Trash and restore

By default, `clean` renames items into `~/.agent-sweep/trash/<batchId>/files/` and writes a `manifest.json` with the original paths, sizes and batch metadata. Across volumes it falls back to copy-then-delete.

- Restore: `agent-sweep restore <batchId>`. Existing targets are never overwritten; they are counted as conflicts.
- Empty the trash: `agent-sweep trash empty [--keep-days 7]`. This cannot be undone and requires `--yes`.
- After removing a worktree, `git worktree prune` runs on its main repository so no new registry residue is left behind.

## Exit codes

| Code | Meaning |
| --- | --- |
| `0` | Success |
| `1` | Some items failed during execution / self-check failed |
| `2` | Argument or usage error (e.g. missing `--yes`, unknown command) |

## Development

```bash
npm test        # Node built-in test runner, 100+ cases
npm run lint    # dependency-free static checks (package hygiene / module loading / source heuristics / i18n key coverage)
npm run check   # end-to-end self-check: full pipeline on a synthetic fixture + trash/restore round trip
```

None of the three scripts needs external tools, and all of them run offline. See [CONTRIBUTING.md](CONTRIBUTING.md) before opening a pull request.

## Documentation

The design documents are currently written in Chinese.

- [Architecture and pipeline](docs/architecture.md)
- [Safety model and guards](docs/safety-model.md)
- [Registry and adding a harness](docs/harness-registry.md)

## Security

agent-sweep can delete files, so anything that makes it touch something it should have protected is treated as a security issue. Please report it privately as described in [SECURITY.md](SECURITY.md), not in a public issue.

## License

Released under the [Apache License 2.0](LICENSE), © outerarc-ai.

The license includes an explicit patent grant. Keep the `LICENSE` file when redistributing or modifying. If upstream provides a `NOTICE` file, keep that as well.

## Contributing

Issues and pull requests are welcome. Please read [CONTRIBUTING.md](CONTRIBUTING.md) first, and follow the [Code of Conduct](CODE_OF_CONDUCT.md).
