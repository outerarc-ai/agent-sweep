# Changelog

All notable changes to this project are documented here.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- Registry-driven harness descriptors for 8 harnesses: Claude Code, Codex CLI,
  Cursor, Windsurf/Devin, Trae/Trae CN/SOLO, Copilot CLI, Aider, Goose/OpenCode.
- Read-only scanner and compound residue analyzer (leaf mtime age + orphan +
  process occupancy + size weighted score).
- Three-circle safety model: safe / review / never-delete, enforced as a hard
  constraint before any write.
- Planner producing a reviewable, serializable cleanup plan.
- Reversible executor: items move to a local trash with a restore manifest.
- `git worktree prune` follow-up for removed worktrees.
- Reporters: terminal tables, machine-readable JSON, self-contained HTML.
- CLI commands: `scan`, `plan`, `clean`, `restore`, `trash`, `harnesses`,
  `doctor`, `help`, `version`.
- Test suite based on the Node built-in test runner.
- Dependency-free `npm run lint` (package hygiene, module loading, source
  heuristics) and `npm run check` (end-to-end self check on a synthetic
  harness home, including a clean/restore round trip).
- Documentation: `README.md` plus `docs/architecture.md`,
  `docs/safety-model.md` and `docs/harness-registry.md`.
- Community files: `CONTRIBUTING.md`, `SECURITY.md`, `CODE_OF_CONDUCT.md`,
  GitHub issue and pull request templates, `.gitattributes`, and a Dependabot
  config for GitHub Actions.
- CI (three OS × three Node versions) and a tag-driven release workflow.

### Changed
- License aligned to Apache-2.0 across `LICENSE`, `package.json`, `README.md`
  and `CONTRIBUTING.md`.
- `package.json` repository, issues and homepage URLs now point at the real
  repository, and an `author` field was added.

### Fixed
- Guard evaluation no longer treats filename heuristics (e.g. `.env.example`,
  `AGENTS.md`) as directory-level protection, so a session directory that merely
  contains a template file is no longer frozen out of cleanup.
- Dry-run execution now returns the full list of actions that passed
  re-verification instead of an empty set.
- Per-target unit counts in scan records are no longer cumulative across targets.
- An unrecognised command now exits with code 2 instead of silently falling
  back to `scan`.