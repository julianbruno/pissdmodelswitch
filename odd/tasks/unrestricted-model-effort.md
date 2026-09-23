# Preserve unrestricted model effort values

## Objective
Preserve the original `openaigentle` mapping exactly, including `sdd-archive` using `openai-codex/gpt-6-luna` with `thinking: max`. Remove package-local effort whitelists without asserting that the installed runtime/provider supports every value.

## Scope and constraints
- Keep required effort values nonempty strings; do not normalize or silently downgrade.
- Keep opposite-provider selection, profile coverage, install fail-closed behavior, and unrelated mappings intact.
- Doctor should report unsupported or unavailable model-specific effort evidence for `max` rather than invent compatibility.
- Preserve existing working-tree changes from the prior profile work. User explicitly authorized installation after completion; do not push or commit without separate authorization.
- TDD mode: off (no explicit strict TDD setting established); runner: `npm test`.
- Delivery strategy: ask-on-risk. Estimated authored diff: approximately 80–160 lines, subject to verification.

## Tasks
- [x] T1 — Remove local enum restrictions and preserve `max` end to end. Route: delegated writer (multi-file write). Acceptance: exact canonical/runtime `sdd-archive` effort `max`, other mappings unchanged, invalid empty effort still rejected. Evidence: focused tests 22/22, `npm test` 42/42, `git diff --check` passed; no commit.
- [x] T2 — Update diagnostics, regression coverage, and user documentation for unrestricted effort values, then install after verification. Route: delegated writer and independent verifier (native assess unassessable due to untracked candidate). Acceptance: doctor requires explicit model capability evidence for extended efforts; tests cover advertised/missing/null/undefined `max` and read-only behavior; docs separate profile acceptance from runtime support. Evidence: focused doctor/installer 24/24, full `npm test` 55/55, independent verifier 55/55, `bash -n install/install.sh` and `git diff --check` passed. Installer wrote to `/Users/julian/.pi`, backed up changed files, and installed all 25 mappings including canonical `max` and runtime `max`; active Pi session reload and provider execution remain unverified. No commit.

## Evidence and progress
- Read-only exploration mapped whitelists in `extensions/model-profiles/core.ts` and `extensions/sdd-model-profiles.ts`, doctor capability checks, tests, and docs.
- T1 and T2 implementation and checks passed; installation completed with backup at `/Users/julian/.pi/backups/jb-sdd-odd-models-2026-09-23T02-13-30-926Z-26374`.
- Readback: installed default `openaigentle`; all 25 managed mappings equal repository profile, including archive `max` in both canonical and runtime; installed extension bytes match source. No work-unit commit.

## Next step
Restart Pi, run `/jb-sdd-odd-models status` and `/jb-sdd-odd-models doctor`, and confirm live provider support for `gpt-6-luna` / `max`.
