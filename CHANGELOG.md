# Changelog

All notable changes to this project are documented here.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- Plan persistence: `plan --save <file>` writes the `agent-sweep/plan@1` plan to
  a JSON file and `clean --plan-file <file>` executes it later. A plan file is
  treated as untrusted input: on load every action is re-checked against the
  current registry (schema version, structure, target scope, and the
  report-only gate), and execution still runs the full per-action
  re-verification (existence / guards / process occupancy). Vanished or
  in-use items are skipped; invalid, downgraded or version-mismatched plan
  files exit with code 2.
- English `README.md` as the primary readme; the Chinese readme moves to
  `README.zh-CN.md` with a language switcher in both.
- CodeQL workflow (security-and-quality queries, weekly schedule).
- `npm run pack:check` and a CI job that verifies the published tarball
  contents and smoke-tests the packed CLI.
- Release guards: the tag must match `package.json` and `CHANGELOG.md` must
  have a section for the version; pre-release tags publish as pre-releases.
- `publishConfig` (public access, provenance) and a `prepublishOnly` gate.
- Node 24 in the CI matrix; CI concurrency and job timeouts.
- Maintainer release steps and Conventional Commits guidance in `CONTRIBUTING.md`.
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
- Piping CLI output into a command that closes early (`agent-sweep scan | head`)
  no longer crashes with an unhandled `EPIPE` error.
- `SECURITY.md` pointed reporters at a maintainer email that does not exist;
  it now links directly to private vulnerability reporting.
- The bug report template linked `SECURITY.md` with a broken relative URL and
  did not list the `ui` command.
- Claude Code sessions are no longer misclassified as orphans (and auto-cleaned
  in the safe circle) when the project path contains `_`, `.`, spaces or other
  non-alphanumeric characters. Claude Code encodes every such character as `-`,
  which the previous `/`-only decoder could not reverse. Orphan status now
  requires transcript evidence (the recorded `cwd` no longer exists); a
  directory that cannot be resolved is reported as unknown and stays in the
  review circle. The resolver also no longer caches results for the lifetime of
  the process, so a long-running `ui` server sees projects deleted after start.
- Guard evaluation no longer treats filename heuristics (e.g. `.env.example`,
  `AGENTS.md`) as directory-level protection, so a session directory that merely
  contains a template file is no longer frozen out of cleanup.
- Dry-run execution now returns the full list of actions that passed
  re-verification instead of an empty set.
- Per-target unit counts in scan records are no longer cumulative across targets.
- An unrecognised command now exits with code 2 instead of silently falling
  back to `scan`.