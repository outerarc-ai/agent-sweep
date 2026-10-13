# Security Policy

agent-sweep is a **destructive-capable** tool: `clean` moves or deletes files on
the user's machine. Anything that causes it to touch a file it should have left
alone is treated as a security issue.

## Supported versions

The latest released minor version receives security fixes. Fixes are published as
a patch release and noted in `CHANGELOG.md`.

## What counts as a vulnerability

- A file or directory that should be protected by the never-delete circle
  (memory files, credentials, MCP registrations, plugin directories, active
  sessions) is deleted or moved anyway.
- A guard can be bypassed through a crafted path, symlink, or unit name.
- The trash layer can lose a moved item, or `restore` can overwrite an existing
  file instead of reporting a conflict.
- `--dry-run` writes to disk.
- A read-only command (`scan`, `plan`) writes to disk.
- Command injection, path traversal, or symlink escape in path resolution.

## What is out of scope

- Deleting items the user explicitly asked to delete with `--yes` or
  `--direct-delete`, when those items were correctly classified as safe or
  review and the user opted into the review circle.
- Data loss that occurs because the user emptied the trash
  (`trash empty`) — that operation is documented as irreversible.
- Missing a harness's directories (an incompleteness bug, not a security issue).
  Report these as normal issues.

## Reporting

Please **do not** open a public issue for a safety bug. Report it privately
through GitHub's private vulnerability reporting:
[Security → Report a vulnerability](https://github.com/outerarc-ai/agent-sweep/security/advisories/new).

Include:

- The affected version and your OS / Node version.
- The exact command you ran.
- What was protected but got touched, and the relevant scan/plan output
  (redact your username and project names).

## Response

We aim to acknowledge a report within a few days, confirm the impact, and ship a
patch release with a regression test that reproduces the unsafe classification
before the fix.