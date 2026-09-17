# Opposite-provider judges

## Objective and scope
Add an optional model-profile configuration that routes judge/reviewer agents to the opposite provider from the selected agent profile by default. When the active agent profile is OpenAI, configured judges use Grok; when the active agent profile is Grok, configured judges use OpenAI.

## User request
- Use ODD and TDD.
- Add the capability to the plugin.
- Make it an optional parameter with default `true`.
- Store the configuration in JSON config and other files as needed.

## Decisions
- Treat judge/reviewer agents as explicit manifest configuration, not inferred from ambient `.git` review state.
- Manage known review/judge subagents: `review-risk`, `review-resilience`, `review-readability`, `review-reliability`, `jd-judge-a`, and `jd-judge-b`.
- Preserve the existing `openai` and `grok` profiles and derive mixed active/runtime config at install and switch time.
- `oppositeProviderJudges.enabled` defaults to `true` when the block is absent; absent or empty agents preserve previous uniform-profile coverage, while disabled non-empty agents remain managed/validated without opposite-provider mixing.
- Technical artifacts remain in English.

## TDD plan and tasks
- [x] T1: Add RED tests for manifest validation, explicit judge coverage, default-enabled mixed derivation, and disabled fallback.
- [x] T2: Implement core manifest schema and derivation helpers.
- [x] T3: Add RED/GREEN command behavior for preview, switch, and status using mixed judge mappings.
- [x] T4: Add installer behavior and packaged JSON/doc updates.
- [x] T5: Run full verification and capture follow-ups.
- [x] T6: Resolve native review advisory findings for disabled judge validation/coverage semantics.

## Verification evidence
- RED: `node --experimental-strip-types --test tests/manifest-validation.test.ts` failed before implementation because `deriveCanonicalProfileForSelection` was not exported.
- GREEN focused: `node --experimental-strip-types --test tests/manifest-validation.test.ts` passed 7 tests.
- GREEN focused: `node --experimental-strip-types --test tests/command-behavior.test.ts` passed 10 tests.
- GREEN focused: `node --experimental-strip-types --test tests/installer-merge.test.ts` passed 8 tests.
- Full suite: `node --experimental-strip-types --test tests/*.test.ts` passed 37 tests.
- Shell syntax: `bash -n install/install.sh` passed with no output.
- Parent verification: `node --experimental-strip-types --test tests/*.test.ts` passed 37/37; `bash -n install/install.sh` passed; `git diff --check` passed.
- Independent verifier: `gentle-ai-verify` passed with the same three commands and no blockers.
- Native review `review-c0237d9858fdb068` approved and acknowledged. Non-blocking advisory follow-ups to resolve in T6: `R2-disabled-judges-coverage` and `R3-disabled-judges-profile-validation` in `extensions/model-profiles/core.ts`.
- T6 RED: `node --experimental-strip-types --test tests/manifest-validation.test.ts` failed because disabled opposite-provider judge configs did not require judge profile entries (`Missing expected exception`).
- T6 GREEN focused: `node --experimental-strip-types --test tests/manifest-validation.test.ts` passed 7 tests.
- T6 focused: `node --experimental-strip-types --test tests/command-behavior.test.ts` passed 10 tests.
- T6 focused: `node --experimental-strip-types --test tests/installer-merge.test.ts` passed 8 tests.
- T6 full suite: `node --experimental-strip-types --test tests/*.test.ts` passed 37 tests.
- T6 parent verification: `node --experimental-strip-types --test tests/*.test.ts` passed 37/37; `bash -n install/install.sh` passed; `git diff --check` passed.
- T6 independent verifier: `gentle-ai-verify` passed with no blockers.
- Native review `review-2896086da8d94a02` approved and acknowledged; no correction transition or advisory findings reported.
