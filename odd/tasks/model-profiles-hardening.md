# Safe, configurable model profiles

## Objective and scope
Externalize the command contract, remove authored duplication, and make switching inspectable/recoverable without overwriting unrelated configuration. User authorized all discussed improvements with ODD and strict TDD.

## Constraints and decisions
Preserve pre-existing dirty work; no reset, commits, dependencies, or global installation. One writer, English artifacts. Preserve direct openai/grok/status syntax. Named config/models.<name>.json remains the model source; config/model-profiles.manifest.json owns version, groups, registrations and default. Active/runtime files are derived. sdd-research matches sdd-explore per profile. Project-only .pi/subagents.json routes development agents to explicitly authorized GPT-5.5; global and distributed model mappings were not replaced. Local catalog evidence never proves remote execution or entitlement. About 400 changed lines per task was advisory only.

## TDD and checks
TDD enabled by explicit user request. Real runner: `node --experimental-strip-types --test tests/*.test.ts`; actual Node v26.8.2. Behavioral RED before implementation, GREEN then REFACTOR reruns. Tests/installer fixtures use temporary PI_HOME only.

## Completed tasks and acceptance
- [x] T0: Read-only architecture mapping and project-only model override unblocked delegation after Codex rejected gpt-6-luna.
- [x] T1: Versioned manifest, strict validation/derivation and sdd-research. Invalid versions/names/duplicates/coverage/model/effort rejected.
- [x] T2: Dynamic profiles/list/completion, read-only preview, direct profile compatibility, filesystem-pure semantic no-op without reload. Preserve unrelated entries and repair missing managed entries.
- [x] T3: Cooperative locking, before-content guards, durable transaction journal, guarded undo and explicit interrupted recovery. Refuse unknown external content; tests cover crashes, interrupted undo and lock states.
- [x] T4: Installer deploys manifest/helpers and derives defaults, preserves unrelated keys, backs up changed existing files and is idempotent. Removed equivalent authored active/seed duplicates. Node minimum >=22.19.0.
- [x] T5: Read-only doctor for drift/completeness/local catalog/auth/effort/transaction evidence, malformed journal diagnostics, command-seam recovery coverage and maintenance documentation.
- [x] T6: Independent final acceptance, parent full-suite checks and approved native candidate review acknowledged.

## Verification evidence
T1: RED missing manifest/research; GREEN/refactor 5 tests. Parent repeated 5/5.
T2: RED command behavior and unrelated runtime preservation; GREEN/refactor 8/8. Parent repeated 8/8.
T3: writer stalled after focused GREEN; fresh independent verifier passed transaction 9/9 and full suite 20/20. Checked interrupted switch/undo expectations and safety. Continuation timeout did not count as completion evidence.
T4: RED missing installer entrypoint; GREEN/refactor installer 7/7 and full suite 27/27. Parent repeated installer 7/7. Shell syntax/diff checks passed; duplicate equivalence checked.
T5: RED missing doctor behavior; GREEN doctor 3/3, command 7/7, full suite 31/31. Parent repeated 31/31.
T6 initially failed independent acceptance despite 31 green tests: no-op created a journal directory and Node floor was below Pi 0.85.1 requirements. Reopened T2/T4, added failing full-tree and version-gate regressions, corrected both, then independent revalidation passed 34/34 plus shell syntax/diff checks. Actual Pi API declarations were inspected for doctor compatibility.
Final parent checks: `node --experimental-strip-types --test tests/*.test.ts` 34/34 pass; `bash -n install/install.sh` pass; `git diff --check` pass.

## Native review
Lineage: review-185c423666fdcd9f. Product candidate: sha256:33a052cf643825efe732a0fb0ab7f22c878fa90d46f4af9186f4bda77b814fc0. All four provider-selected lenses captured; native state approved. Exact acknowledgement completed, authority burned, delivery remains ordinary repository policy. Product scope includes new source/tests/config; ODD bookkeeping excluded.
Non-blocking advisories retained for separate later work, not applied to the approved candidate: R2-doctor-error-labels, R2-duplicate-profile-validation, R3-transaction-commit-not-idempotent. None opened a correction or reopens this review.

## Limitations and delivery
No real provider execution or authentication validated. Stock catalog lacks distributed OpenAI gpt-6 identifiers; user mappings remain intentionally unchanged and doctor reports local evidence. Alternate Node version gates were simulated; actual execution was Node v26.8.2, not Node 22.19. Cooperative locking cannot make a two-file update globally atomic or eliminate races with non-cooperating external writers. No global install or commits performed. Installation is a separate user action.

## Next step
Implementation and verification complete. Report results; no further source edits or delivery actions without a new request.
