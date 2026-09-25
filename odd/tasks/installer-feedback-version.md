# Installer feedback and package version

## Objective
Make `./install/install.sh` visibly report preflight, destination, package version, changed-file/backup progress, and unmistakable success/no-op/failure. Treat `package.json.version` as the single configurable SemVer source; do not offer release download or a misleading install-time version override.

## Constraints and acceptance
Preserve Pi home merge, existing backups and per-file atomic writes, transaction guard, idempotent no-op, and nonzero failure status. Validate metadata before target mutation; no success on failure. Shell entrypoint is `./install/install.sh` (`./install` is a directory). Existing untracked `PI_UPDATE_TROUBLESHOOTING.md` is unrelated; leave untouched. Technical artifacts in English. No installation into the live Pi home without a separate request.

## Plan and progress
- [x] T1: Implement version validation and informative installer console output, with focused fresh/no-op/error/version regression tests. Route: delegated writer, multi-file trigger. Check: `node --experimental-strip-types --test tests/installer-merge.test.ts` (11/11 passed); `sh -n install/install.sh` passed.
- [x] T2: Document configuration and output, verify full suite and shell syntax. Route: delegated writer for docs; independent verification per assessment. Checks: `npm test` (58/58), `sh -n install/install.sh`, `git diff --check` passed; separate read-only verifier passed.

## TDD and delivery
TDD mode not explicitly configured; ordinary functional checks. Runner: package `npm test`, focused Node test. Forecast ~150 authored diff lines, ask-on-risk strategy. Work-unit commits pending explicit commit authorization under safety rule; do not push or install globally.

## Evidence
Exploration: installer had success/no-op output but no startup progress; `package.json` is 1.1.0. User selected package metadata rather than selectable release installation. T1 changed `install/install.sh`, `install/model-profiles-install.ts`, and `tests/installer-merge.test.ts`. Focused tests 11/11 and shell syntax passed. Native risk assessment returned unassessable due to unrelated untracked file; separate read-only verifier found no concrete issues. `npm test` 58/58, shell syntax, and diff check passed; parent spot-checked diff check. Simulated write failure remains untested. No live install or commit.

## Next step
Optional user-authorized install into live PI_HOME and Pi restart/status verification. No further source work pending.
