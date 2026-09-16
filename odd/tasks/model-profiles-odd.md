# Model profiles for ODD agents

## Goal
Update the model switching plug-in so it manages Organic Driven Development (ODD) generic agents in addition to SDD phase agents, choosing provider-specific models by the expected effort level of each task role.

## Scope
- Extend managed profile data with ODD generic agents: `gentle-ai-explore`, `gentle-ai-worker`, and `gentle-ai-verify`.
- Keep runtime writes compatible with `subagents.json.model_profiles` using `{ model, effort }`.
- Preserve unrelated runtime configuration and existing rollback behavior.
- Update documentation and installer validation to reflect the expanded managed set.

## Tasks
- [x] Map current SDD-only assumptions and define the ODD role effort mapping.
- [x] Update profile JSON and extension logic for SDD + ODD managed agents.
- [x] Update installer validation/merge and user documentation.
- [x] Validate JSON shape and run focused checks.

## Validation evidence
- `gentle-ai-verify` ran JSON profile validation: passed.
- `gentle-ai-verify` ran installer smoke with temporary `PI_HOME`: passed.
- Parent spot check `node - <<'NODE' ...`: passed.
- Command rename validation confirmed source registers `jb-sdd-odd-models` and no longer registers `sdd-models`.
- Installer wrote the updated extension to `/Users/julian/.pi/agent/extensions/sdd-model-profiles.ts`.
- Installed runtime profile contains ODD mappings: explore=`medium`, worker=`high`, verify=`xhigh`.

## Follow-up change
- Renamed the Pi command from `/sdd-models` to `/jb-sdd-odd-models`.
- Documentation now presents `/jb-sdd-odd-models`; `/sdd-models` remains only as historical provenance in `NOTICE.md`.

## Decisions
- ODD generic routing is owned by `pi-subagents` runtime config, not by the SDD phase assignment table.
- The plug-in should not pass ad-hoc model parameters; it should write persisted `model_profiles` entries.
- ODD role effort mapping: explore = medium, worker = high, verify = xhigh, because exploration is bounded read-only mapping, implementation needs stronger synthesis, and independent verification should use the strongest reasoning.
