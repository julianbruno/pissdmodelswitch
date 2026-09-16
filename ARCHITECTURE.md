# Architecture and boundaries

This package is a small configuration-and-extension layer. It does not bundle Pi, an agent runtime, provider SDKs, model catalogs, or credentials.

## Components

| Component | Responsibility | Does not own |
|---|---|---|
| `extensions/sdd-model-profiles.ts` | Registers `/jb-sdd-odd-models`, validates SDD/ODD profiles through shared helpers, reports status/list/preview/doctor, switches profiles, undoes/recover transactions, and requests reload after changed mutations. | Provider authentication, model execution, model catalog generation, or agent definitions. |
| `extensions/model-profiles/core.ts` | Owns manifest/profile validation and canonical/runtime derivation. | Pi extension registration. |
| `extensions/model-profiles/transaction.ts` | Owns read/write transaction locking, active journal, history, guarded undo, recovery, and read-only inspection diagnostics. | Choosing model profiles or repairing malformed state automatically. |
| `config/model-profiles.manifest.json` | Defines schema version, managed agent groups, default profile, reserved command names, and registered profile files. | Runtime behavior. |
| `config/models.<profile>.json` | Defines each named canonical model profile; active files are derived from the manifest default at install time. | Runtime behavior or user overrides. |
| `install/install.sh` and `install/model-profiles-install.ts` | Enforce the Node strip-types minimum, validate assets, back up changed targets, install extension/helper layout, and perform a merge-friendly runtime update. | Installing Gentle Pi, credentials, or providers. |
| Documentation | Explains operation, recovery, and limitations. | A license grant; see `NOTICE.md`. |

## Dependency boundaries

```text
Gentle Pi extension host
  └─ loads sdd-model-profiles.ts
       ├─ reads/writes $PI_HOME/gentle-ai model profiles
       ├─ reads/writes $PI_HOME/agent/subagents.json
       ├─ inspects $PI_HOME/gentle-ai/.model-profiles-transactions
       ├─ uses ctx.modelRegistry for local read-only doctor evidence
       └─ requests Pi reload after changed mutations

Gentle Pi native agent runtime
  └─ consumes subagents.json.model_profiles
       └─ dispatches the selected model/effort for each managed agent

Provider authentication/model catalog
  └─ determines whether configured model identifiers can actually run
```

`doctor` uses the supported Pi extension APIs documented for command contexts: `ctx.modelRegistry.find()` for effective local catalog lookup and `getProviderAuthStatus()` when available for configured-auth evidence. It does not call providers, resolve provider requests, or prove remote account entitlement.

## Installation boundary

The installer writes only beneath `PI_HOME` at installation time. It validates the versioned manifest and every registered profile before writing, derives active `models.json` and merged `subagents.json` entries from the default named profile, preserves unrelated JSON keys, and creates timestamped backups for existing targets whose content changes. It also installs `extensions/model-profiles/core.ts` and `extensions/model-profiles/transaction.ts` next to the command extension, which is required for the installed command to load.

The packaged extension resolves Pi home from `PI_HOME` when set, otherwise retaining `~/.pi` behavior. A custom value must be exported into the Pi process as well as the installer process.

## Version boundary

- Installer runtime: Node.js 22.19.0 or newer, matching the supported Pi package engine while `install/install.sh` runs TypeScript with `--experimental-strip-types`.
- Pi runtime: a compatible Gentle Pi version with TypeScript extensions, `registerCommand`, `ctx.reload`, and command-context `ctx.modelRegistry`. This package does not add extra machinery solely to report Pi or provider versions.

## Known limitations

- Model identifiers are static snapshots and can become unavailable or renamed by providers.
- Installation validates file shape, not credentials or remote model availability.
- `doctor` can report local catalog/auth evidence, but it cannot establish provider execution or account entitlement.
- Installed/global status does not prove effective project routing when project overrides or scoped models are active.
- The two target files are replaced atomically per file, not as an atomic pair.
- Recovery refuses unknown bytes from noncooperating writers rather than overwriting them.
- Reload failure leaves successfully written mappings in place.
- Automated uninstall is omitted to avoid deleting shared configuration or post-install changes.
