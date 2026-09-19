# Programmatic testing guide

This document explains how to test the plugin without launching a real Pi session or mutating the real `~/.pi` home.

## Quick path

Run the complete test suite from the repository root:

```sh
node --experimental-strip-types --test tests/*.test.ts
```

Also run the shell and whitespace checks before committing:

```sh
bash -n install/install.sh
git diff --check
```

Expected current result:

```text
38 tests pass
```

## What the suite covers

| Test file | Purpose |
|---|---|
| `tests/manifest-validation.test.ts` | Validates manifest schema, package version, managed agent coverage, generated profile files, named-profile role expansion, opposite-provider judge pairing, and runtime derivation. |
| `tests/installer-merge.test.ts` | Verifies installation into temporary `PI_HOME` fixtures, dynamic copying of every registered profile, default active profile derivation, backup behavior, idempotency, and Node version gating. |
| `tests/command-behavior.test.ts` | Exercises the `/jb-sdd-odd-models` command seam with a fake Pi command context: completions, list, preview, switch, no-op behavior, undo, recover, and transaction safety. |
| `tests/doctor.test.ts` | Verifies read-only diagnostics for healthy state, drift, malformed journals, missing entries, catalog evidence, auth evidence, and effort compatibility. |
| `tests/transaction-recovery.test.ts` | Tests the transaction layer directly: locks, rollback, interrupted writes, recovery, undo, and external-change guards. |

## Focused test commands

Use focused files while developing, then always run the full suite before delivery.

```sh
# Manifest/profile schema, named profiles, and role expansion
node --experimental-strip-types --test tests/manifest-validation.test.ts

# Installer merge, backups, defaults, and dynamic profile copying
node --experimental-strip-types --test tests/installer-merge.test.ts

# Command behavior through the Pi extension seam
node --experimental-strip-types --test tests/command-behavior.test.ts

# Doctor diagnostics
node --experimental-strip-types --test tests/doctor.test.ts

# Transaction safety and recovery
node --experimental-strip-types --test tests/transaction-recovery.test.ts
```

## Fixtures and safety model

The tests avoid the real Pi home by creating temporary directories under the OS temp directory.

Common fixture patterns:

- Temporary `PI_HOME` roots include an `agent/` directory before installer tests run.
- Runtime files are written under temp paths such as `gentle-ai/models.json` and `agent/subagents.json`.
- Command tests register the extension against a fake command API and capture notifications/reload counts in memory.
- Installer tests copy package assets into a temporary package fixture before mutating them.
- Transaction tests operate on temp `models.json`, `subagents.json`, and `.model-profiles-transactions` paths.

Do not point tests at a real `~/.pi` directory. The test helpers are intentionally written to create isolated fixtures.

## Testing profile changes

When adding or changing profiles:

1. Update `config/named-profiles.json` if the role catalog changes.
2. Update or regenerate the corresponding `config/models.<profile>.json` files.
3. Update `config/model-profiles.manifest.json` if profiles are added, removed, renamed, or paired differently.
4. Run:

   ```sh
   node --experimental-strip-types --test tests/manifest-validation.test.ts
   node --experimental-strip-types --test tests/installer-merge.test.ts
   node --experimental-strip-types --test tests/*.test.ts
   ```

The manifest tests compare generated full profiles against the role expansion from `config/named-profiles.json`. This protects against missing managed agents and stale generated profile files.

## Testing installer behavior

Use the in-process installer tests for normal coverage:

```sh
node --experimental-strip-types --test tests/installer-merge.test.ts
```

Use shell syntax and version-gate checks before release:

```sh
bash -n install/install.sh
node --experimental-strip-types --test tests/installer-merge.test.ts
```

The installer tests verify that:

- all manifest-registered profile files are copied;
- active `models.json` is derived from the manifest default profile;
- runtime `subagents.json.model_profiles` is merged without deleting unrelated entries;
- backups are created only when existing files change;
- repeat installs are byte no-ops;
- unresolved transaction state fails closed.

## Testing command behavior

Command tests do not require real Pi. They import the extension, register the command in a fake API, then call the handler directly.

Run:

```sh
node --experimental-strip-types --test tests/command-behavior.test.ts
```

This verifies:

- argument completions;
- `list` output;
- `preview <profile>` without writes;
- direct profile switching;
- semantic no-op switching;
- opposite-provider judge mappings;
- transaction undo and recovery through the command seam.

## Testing doctor behavior

Run:

```sh
node --experimental-strip-types --test tests/doctor.test.ts
```

Doctor tests are read-only. They verify diagnostics without repair or writes.

## Testing transaction recovery

Run:

```sh
node --experimental-strip-types --test tests/transaction-recovery.test.ts
```

These tests focus on the lower-level transaction machinery and simulate fault points. They verify that interrupted or competing writes do not silently overwrite unknown bytes.

## Pre-delivery checklist

Before commit, install, push, or release:

```sh
node --experimental-strip-types --test tests/*.test.ts
bash -n install/install.sh
git diff --check
```

Then inspect repository state:

```sh
git status --short
```

Only install into a real Pi home when explicitly intended:

```sh
./install/install.sh
```

After real installation, restart Pi and verify manually:

```text
/jb-sdd-odd-models status
/jb-sdd-odd-models doctor
```
