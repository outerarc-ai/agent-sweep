# Contributing to agent-sweep

Thanks for helping make agent residue cleanup safer and more complete. This
project deliberately stays small: **zero runtime dependencies**, a registry-driven
architecture, and a hard safety gate in front of every write.

## Ground rules

1. **No runtime dependencies.** The tool must run with nothing but the Node
   built-ins. Pull requests that add a `dependencies` entry will be declined
   unless there is no reasonable built-in alternative.
2. **Read-only until the executor.** `scan`, analysis, planning and reporting must
   never touch the filesystem. Only the executor (reached from `clean`) may write,
   and only through the trash layer.
3. **The three-circle gate is sacred.** Never-delete protections (memory files,
   credentials, MCP registrations, plugin dirs, active units) are enforced before
   any action is considered. Do not add a flag that bypasses them.
4. **Leaf-mtime age.** Age is derived from the newest leaf file mtime in a subtree,
   not the directory's own mtime. Keep it that way.

## Getting started

```bash
git clone https://github.com/outerarc-ai/agent-sweep.git
cd agent-sweep
npm test          # Node built-in test runner
npm run lint      # dependency-free static checks
npm run check     # end-to-end self check on a synthetic fixture home
npm run pack:check  # what `npm publish` would ship
```

The first three commands must pass before a pull request is ready. CI runs
them on macOS, Linux and Windows across every supported Node major, plus
CodeQL and a smoke test of the packed CLI.

## Releasing (maintainers)

1. Move the `## [Unreleased]` entries in `CHANGELOG.md` under a new
   `## [x.y.z] - YYYY-MM-DD` heading.
2. Bump `version` in `package.json` (`npm version x.y.z --no-git-tag-version`).
3. Merge to `main`, then push a matching tag: `git tag vx.y.z && git push origin vx.y.z`.

The release workflow refuses to publish if the tag does not match
`package.json` or the changelog has no section for the version. It publishes
to npm with provenance and creates the GitHub release.

## Adding a harness

New harnesses are **declarations, not code**. Append a descriptor under
`src/core/harnesses/` and register it in `src/core/harnesses/index.js`:

```js
export const myHarness = {
  id: 'my-harness',
  name: 'My Harness',
  kind: 'cli',                    // cli | ide | xdg
  platforms: ['darwin', 'linux', 'win32'],
  defaultTTL: 60,
  risk: 'low',                    // low | medium | high
  deleteEnabled: false,           // start as report-only
  targets: [ /* path templates, unit shape, orphan probe */ ],
  neverDelete: [ /* explicit protected paths */ ],
};
```

Start every new harness with `deleteEnabled: false`. Ship it as report-only,
confirm the scan output matches reality on your machine, and only then open a
separate pull request that flips the flag.

See [docs/harness-registry.md](docs/harness-registry.md) for the full descriptor
reference.

## Commit and PR conventions

- One logical change per pull request.
- Commit messages follow [Conventional Commits](https://www.conventionalcommits.org/)
  in the imperative mood, e.g. `fix(scanner): stop misclassifying live sessions`
  or `feat(harness): add windsurf orphan probe`. Common types: `feat`, `fix`,
  `docs`, `test`, `refactor`, `ci`, `chore`.
- Update `CHANGELOG.md` under `## [Unreleased]`.
- Fill in the pull request template, including the safety checklist.

## Reporting bugs

Open an issue with your OS, Node version, the exact command, and the observed
versus expected behavior. **Redact absolute paths that reveal your username or
project names** — the scan output contains real filesystem paths.

If you believe the tool deleted something it should have protected, that is a
security issue: see [SECURITY.md](SECURITY.md) instead of a public issue.

## License

By contributing you agree that your contributions are licensed under the
[Apache License 2.0](LICENSE).