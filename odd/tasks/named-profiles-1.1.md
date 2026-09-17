# Named selectable profiles 1.1

## Objective and scope
Promote every profile from `config/named-profiles.json` into a selectable `/jb-sdd-odd-models <profile>` profile, using generated full per-agent `config/models.<profile>.json` files and plugin version `1.1.0`.

## User request
- Add the profiles from `config/named-profiles.json` to the selectable profiles currently limited to `openai` and `grok`.
- Complete missing agent assignments with appropriate models by considering effort and cost.
- Create plugin version `1.1`.

## Decisions
- Keep `config/named-profiles.json` as the role catalog and add generated full profile files for runtime selection.
- Register all named profiles in `config/model-profiles.manifest.json` so the command can select them directly.
- Use role-to-agent expansion:
  - `razonamiento`: exploration/proposal/design/verify/review/judge agents.
  - `codigo`: implementation agents.
  - `liviano`: low-cost administrative/status/init/archive/sync agents.
  - `orquestador`: catalog metadata only for now; no current managed child agent represents the parent orchestrator.
- Preserve opposite-provider judge routing by cost lane: OpenAI-family profiles pair to Grok in the same lane; Grok profiles pair back to GPT-5.6 in the same lane.
- Default selectable profile becomes `gpt-5.6-recommended`.
- Preserve legacy `openai` and `grok` aliases; aliases are registered before named profiles so status detection prefers the named default when bytes are equivalent.
- Profile names may contain lowercase dot-separated segments (for example `gpt-5.6-recommended`) but remain path-safe and command-safe: no spaces, slashes, uppercase, empty segments, or trailing separators.

## Tasks
- [x] T1: Add failing tests for manifest registrations, package version, named role expansion, and opposite-provider pair behavior.
  - Evidence: RED `node --experimental-strip-types --test tests/manifest-validation.test.ts tests/installer-merge.test.ts` failed with package version missing, default still `openai`, named profiles unregistered, and dot-containing profile names rejected.
- [x] T2: Generate and register full `models.<profile>.json` files for all named profiles.
  - Evidence: `config/model-profiles.manifest.json` registers all profiles from `config/named-profiles.json` plus `openai`/`grok`; full files exist under `config/models.<profile>.json` and validate against role expansion tests.
- [x] T3: Update installer fixtures/copy behavior if needed.
  - Evidence: installer fixture now copies every manifest-registered `modelsFile`; `fresh temp install copies manifest, registered profiles, extension helpers, and derived default active files` passes.
- [x] T4: Update docs for version 1.1 and the expanded profile list.
  - Evidence: README, usage, switching, installation, sync, and architecture docs describe the 1.1 profile catalog, default, aliases, and safe dotted names.
- [x] T5: Run full verification and native review if required.
  - Evidence: full required validation passed. Native review was not run by this worker.

## Verification evidence
- RED: `node --experimental-strip-types --test tests/manifest-validation.test.ts tests/installer-merge.test.ts` failed before implementation: 7 failing tests covering missing `1.1.0`, manifest default/registration, generated profile files, opposite-provider pair derivation, and safe-name support for dotted profile names.
- GREEN focused: `node --experimental-strip-types --test tests/manifest-validation.test.ts tests/installer-merge.test.ts` passed after implementation: 16/16 tests.
- Full suite: `node --experimental-strip-types --test tests/*.test.ts` passed: 38/38 tests.
- Shell syntax: `bash -n install/install.sh` passed.
- Whitespace: `git diff --check` passed.
- Parent verification: `node --experimental-strip-types --test tests/*.test.ts` passed 38/38; `bash -n install/install.sh` passed; `git diff --check` passed.
- Independent verifier: `gentle-ai-verify` passed with the same three commands and no blockers.
- Native review inspect did not start a lineage: blocked by `native-status-package-binary-missing`; recovery command reported by facade: `node scripts/install-gentle-ai.mjs` from installed gentle-pi package directory after unsetting `GENTLE_PI_SKIP_GENTLE_AI_INSTALL` if set.
