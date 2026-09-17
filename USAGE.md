# Use `/jb-sdd-odd-models`

The command reports, previews, diagnoses, switches, undoes, or recovers the global model profile used by the managed SDD phase agents, ODD generic agents, and configured judge/reviewer agents. Registered profile names and optional opposite-provider judge routing come from `model-profiles.manifest.json` instead of being hard-coded.

## Command reference

| Input | Effect |
|---|---|
| `/jb-sdd-odd-models` | Shows usage, active-state detection, and all managed mappings. Read-only. |
| `/jb-sdd-odd-models status` | Shows active-state detection and all managed mappings. Read-only. |
| `/jb-sdd-odd-models doctor` | Performs read-only diagnostics for manifest/profile shape, active canonical/runtime state, transaction journals/locks, local Pi catalog presence, effort compatibility, and auth configuration evidence. |
| `/jb-sdd-odd-models list` | Lists registered profiles and the default profile. Read-only. |
| `/jb-sdd-odd-models preview <profile>` | Shows managed canonical/runtime before → after mappings for a profile. Read-only. |
| `/jb-sdd-odd-models <profile>` | Validates registered profiles and current files, writes the selected profile to canonical and runtime configuration, then reloads Pi. No-op when already aligned. |
| `/jb-sdd-odd-models undo` | Reverts the last completed profile transaction only if both files still match the recorded transaction output, then reloads Pi. |
| `/jb-sdd-odd-models recover` | Finishes, records, or clears an interrupted profile transaction when the current file bytes match a safe recorded state, then reloads Pi when recovery changed state. |
| `/jb-sdd-odd-models <invalid>` | Displays an unknown-argument warning and usage. Read-only. |

Arguments are trimmed and case-insensitive. For example, `/jb-sdd-odd-models OPENAI` selects the OpenAI profile when `openai` is registered.

## Common checks

### Inspect without changing anything

```text
/jb-sdd-odd-models status
```

Expected heading:

```text
Active SDD/ODD profile: openai
```

The state can also be any registered profile name, `custom`, or `unknown`. `[misaligned]` means the canonical entry and live runtime entry differ for that agent. With the packaged `oppositeProviderJudges` block, `openai` status means normal agents match OpenAI while configured judges match Grok; `grok` status means the inverse.

### Diagnose local configuration

```text
/jb-sdd-odd-models doctor
```

`doctor` never writes, repairs, reclaims locks, or reloads Pi. It distinguishes:

- missing or malformed managed entries;
- canonical/runtime drift;
- active profile states: registered profile, `custom`, or `unknown`;
- malformed active/history transaction journals;
- stale or ambiguous transaction locks;
- unrelated runtime mappings that are preserved;
- local effective Pi catalog entries found or missing through `ctx.modelRegistry.find()`;
- effort compatibility using model `reasoning` and `thinkingLevelMap` evidence; and
- configured-auth evidence through Pi's registry auth status.

A missing local catalog model, missing auth status, or missing registry is a bounded diagnostic. It is not proof that a remote provider is unavailable. `doctor` also cannot establish provider execution or account entitlement.

Installed/global profile status does not prove effective project routing: project overrides and the current Pi session registry can change the effective model catalog.

### List and preview profiles

```text
/jb-sdd-odd-models list
/jb-sdd-odd-models preview openai
```

The preview shows each managed agent's current canonical entry and runtime entry next to the selected profile's effective after state, including opposite-provider judge mappings when configured. Missing legacy entries can be repaired by a switch. Malformed existing managed entries stop the switch before any write.

### Select a profile

```text
/jb-sdd-odd-models openai
```

On success, the selected SDD/ODD mappings are written and Pi reloads. The canonical profile uses `thinking`; the runtime mapping receives the same value as `effort`. If the selected profile is already active, the command leaves file bytes and mtimes untouched and does not reload.

## Add a registered profile

To add a third profile such as `local`, keep the same active managed-agent coverage as existing profiles:

1. Add `{ "name": "local", "modelsFile": "models.local.json" }` to `model-profiles.manifest.json`.
2. Create `models.local.json` with exactly every agent listed under the manifest's `managedAgentGroups` plus the configured `oppositeProviderJudges.agents` when that block is enabled.
3. Use `{ "model": "provider/model", "thinking": "low|medium|high|xhigh" }` for each agent.
4. Restart or reinstall so the installed manifest/profile files are copied into Pi home.
5. Run `/jb-sdd-odd-models list`, `/jb-sdd-odd-models preview local`, and `/jb-sdd-odd-models doctor`.

Profile names must be safe lowercase command names and cannot use reserved command names such as `status`, `list`, `preview`, `doctor`, `undo`, or `recover`.

## Completion

Argument completion is synchronous and manifest-backed. It offers `status`, `list`, `preview`, `doctor`, `undo`, `recover`, and registered profile names filtered by the typed prefix; `preview <prefix>` completes registered profile names for preview commands.

## Installed extension files

The installed extension imports helper modules from `extensions/model-profiles/`. Package or manual installs must include that directory next to `extensions/sdd-model-profiles.ts`; the helper modules are not standalone auto-loaded extensions.
