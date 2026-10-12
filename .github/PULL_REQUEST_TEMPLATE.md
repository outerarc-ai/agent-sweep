## Summary

<!-- What changed and why. One logical change per PR. -->

## Type of change

- [ ] Bug fix
- [ ] New harness declaration
- [ ] New capability
- [ ] Documentation
- [ ] Refactor (no behavior change)

## Safety checklist

Every PR that touches classification, guards, the planner or the executor must
confirm all of the following:

- [ ] `scan`, analysis, planning and reporting remain read-only (no filesystem writes).
- [ ] The never-delete circle still short-circuits before any action is considered.
- [ ] No flag or option can bypass the never-delete protections.
- [ ] A regression test reproduces the behavior this PR fixes or adds.
- [ ] No new runtime dependency was introduced.

## Verification

- [ ] `npm test` passes
- [ ] `npm run lint` passes
- [ ] `npm run check` passes

## Notes for reviewers

<!-- Tradeoffs, follow-ups, or anything you deliberately left out of scope. -->

## Changelog

- [ ] `CHANGELOG.md` updated under `## [Unreleased]`