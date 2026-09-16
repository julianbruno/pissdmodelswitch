# Architecture and boundaries

This package is a small configuration-and-extension layer. It does not bundle Pi, a subagent runtime, provider SDKs, or credentials.

## Components

| Component | Responsibility | Does not own |
|---|---|---|
| `extensions/sdd-model-profiles.ts` | Registers `/sdd-models`, validates profiles, reports status, switches two active files, and requests reload. | Provider authentication, model execution, or subagent definitions. |
| `config/models.*.json` | Defines canonical OpenAI/Grok mappings and the initially active profile. | Runtime plugin behavior. |
| `config/subagents.seed.json` | Supplies only managed `model_profiles` entries in runtime `{ model, effort }` shape. | Unrelated `subagents.json` keys or mappings. |
| `install/install.sh` | Validates assets, backs up changed targets, installs files, and performs a merge-friendly runtime update. | Installing Gentle Pi, `pi-subagents-j0k3r`, or credentials. |
| Documentation | Explains operation, recovery, and limitations. | A license grant; see `NOTICE.md`. |

## Dependency boundaries

```text
Gentle Pi extension host
  └─ loads sdd-model-profiles.ts
       ├─ reads/writes $PI_HOME/gentle-ai model profiles
       ├─ reads/writes $PI_HOME/agent/subagents.json
       └─ requests Pi reload

pi-subagents-j0k3r
  └─ consumes subagents.json.model_profiles
       └─ dispatches the selected model/effort for each SDD agent

Provider authentication/model catalog
  └─ determines whether configured model identifiers can actually run
```

The TypeScript extension imports the Pi extension API from `@earendil-works/pi-coding-agent`; it therefore requires the compatible Gentle Pi runtime. Runtime model dispatch depends on `pi-subagents-j0k3r`.

## Installation boundary

The installer writes only beneath `PI_HOME` at installation time. It preserves unrelated JSON keys and creates timestamped backups for existing targets whose content changes. It does not edit the source package.

The packaged extension has one portability change from the observed canonical source: it resolves Pi home from `PI_HOME` when set, otherwise retaining the original `~/.pi` behavior. A custom value must be exported into the Pi process as well as the installer process.

## Known limitations

### `sdd-research` drift

The command's hard-coded managed set contains exactly 12 agents and predates the newer `sdd-research` agent. Consequently:

- named profiles do not include `sdd-research`;
- switching does not add, remove, or alter its runtime mapping;
- status does not display or evaluate it; and
- active-profile detection can report `openai` or `grok` regardless of an unrelated `sdd-research` mapping.

This is intentional preservation of current `/sdd-models` behavior, not a claim that `sdd-research` should remain unmanaged. Supporting it requires a coordinated command/profile contract update.

### Other limitations

- The two-file switch uses atomic replacement per file plus compensating rollback; the pair is not a single filesystem transaction.
- Reload failure leaves successfully written mappings in place.
- Model identifiers are static snapshots and can become unavailable or renamed by providers.
- Installation validates file shape, not credentials or remote model availability.
- The installer cannot reliably prove that `pi-subagents-j0k3r` is enabled; verification must include a real SDD subagent invocation.
- Automated uninstall is omitted to avoid deleting shared configuration or post-install changes.
