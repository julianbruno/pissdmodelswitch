# Install and recover `/jb-sdd-odd-models`

Run the included installer from this package. It validates package data, backs up existing files that will change, installs the command plus helper layout, and merges only the managed SDD/ODD runtime mappings.

## Prerequisites

- A working Gentle Pi installation with an `agent/` directory under Pi home.
- Gentle Pi's native agent runtime support for `agent/subagents.json.model_profiles`.
- Node.js 22.19.0 or newer available as `node`; this matches the supported Pi package engine and lets the installer run TypeScript with `--experimental-strip-types`.
- Authentication configured in Pi for each provider you intend to select.

The installer does not install Pi, models, credentials, provider authentication, or provider access. A successful file installation does not prove that a provider account can access every configured model.

## Install

```sh
cd /path/to/pi-sdd-model-switch
./install/install.sh
```

The entrypoint is `./install/install.sh`; `./install` is a directory, not a command.

### Package version

`package.json.version` is the single SemVer source. To configure the version of your local package, edit that field before installation, for example to `1.2.3` or `1.2.3-rc.1+build.5`. Missing or invalid metadata fails before target mutation. This is package metadata, not an install-time version selector: changing it does not fetch a release or change the source code being installed.

### Installed files

The installer writes:

- `~/.pi/agent/extensions/sdd-model-profiles.ts`
- helper modules under `~/.pi/agent/extensions/model-profiles/`
- `~/.pi/gentle-ai/model-profiles.manifest.json`
- every profile registered by that manifest, including `openaigentle`, GPT-5.6, GPT Astra, GPT Astra-only, Grok lanes, and legacy alias files such as `models.openai.json` and `models.grok.json`
- derived active `~/.pi/gentle-ai/models.json` from the manifest default profile, including opposite-provider judge entries when configured
- the merged managed entries in `~/.pi/agent/subagents.json`, using the same effective profile

Existing unrelated canonical keys, unrelated top-level runtime keys, and unrelated `model_profiles` entries in `subagents.json` are preserved. Re-running the installer is safe: identical files are left unchanged and no backup is created. With the packaged manifest, the default profile is `openaigentle`, using GPT-6 Sol/Luna. Unpaired profiles such as `openaigentle` retain their own judge mappings; configured pairs use opposite-provider judges unless `oppositeProviderJudges` is disabled or has no agents.

### Custom Pi home

Set `PI_HOME` during installation **and whenever Pi runs**:

```sh
PI_HOME=/srv/my-pi ./install/install.sh
PI_HOME=/srv/my-pi pi
```

The target must already contain `agent/`; this prevents accidentally installing into an arbitrary directory. The extension defaults to `~/.pi` when `PI_HOME` is unset.

## Installer output

Normal progress goes to stdout: preflight, resolved `PI_HOME`, package version, changed-file count, backup progress, and each file write. These abbreviated examples use version `1.1.0`; paths and counts vary.

Successful update (stdout excerpts; exit status 0):

```text
Target PI_HOME: /srv/my-pi
Package: jb-sdd-odd-models 1.1.0
Plan: 1 changed file(s).
Backup: saving 1 existing changed file(s) before writing install targets.
Backup complete: /srv/my-pi/backups/jb-sdd-odd-models-<timestamp>-<pid>
Writing 1/1: agent/extensions/sdd-model-profiles.ts
SUCCESS: Installed jb-sdd-odd-models 1.1.0 into /srv/my-pi (1 changed files).
Restart Pi, then run /jb-sdd-odd-models status.
```

Identical reinstall (stdout ending; exit status 0):

```text
Plan: 0 changed file(s).
NO-OP: jb-sdd-odd-models 1.1.0 is already installed in /srv/my-pi; no files changed.
```

Invalid version (stderr; nonzero exit status):

```text
FAILURE: jb-sdd-odd-models installer: package.json.version must be a valid SemVer (for example, 1.2.3 or 1.2.3-rc.1+build.5).
```

Preflight progress may appear before a failure; it is not a success signal. A failed run does not print `SUCCESS:`. Resolve the reported error before retrying; for a write failure, inspect the destination and any reported backup first.

## Backups and reinstall behavior

Before writing any install targets, the installer backs up all existing files that will change to a timestamped directory under:

```text
$PI_HOME/backups/jb-sdd-odd-models-<timestamp>-<pid>/
```

Backups retain paths relative to `PI_HOME`. Newly created files have no prior copy and therefore do not appear in the backup. A reinstall that would produce identical bytes changes nothing and creates no backup.

Each target write is atomic, but the whole install is not. A later write failure can leave earlier files updated; there is no automatic rollback. See [Uninstall or restore](#uninstall-or-restore) for manual restoration.

If an active transaction journal or lock exists, the installer fails closed before writing. Run `/jb-sdd-odd-models doctor` to inspect the state and `/jb-sdd-odd-models recover` only when it is safe to complete recovery.

## Verify

1. Restart Pi so it loads the installed extension.
2. Run `/jb-sdd-odd-models status`.
3. Run `/jb-sdd-odd-models doctor`.
4. Confirm that all managed mappings are listed and the active profile is `openaigentle`, another registered profile, or intentionally `custom`.
5. Optionally switch and verify:

   ```text
   /jb-sdd-odd-models grok-recommended
   /jb-sdd-odd-models status
   /jb-sdd-odd-models doctor
   ```

If Pi does not recognize the command, verify that Gentle Pi loads TypeScript extensions from `$PI_HOME/agent/extensions`, that `extensions/model-profiles/` was copied next to the command extension, and that the same `PI_HOME` is used at install time and runtime.

## Add or install a third profile

The manifest is the source of truth. To add a profile such as `local`, add it to `model-profiles.manifest.json`, create `models.local.json`, and include exactly the same active managed agents as the existing profiles, including configured judge/reviewer agents. Then reinstall so the new manifest/profile file is copied into Pi home. A profile without an `oppositeProviderJudges.profilePairs` entry uses its own models for judges.

After reinstalling, verify:

```text
/jb-sdd-odd-models list
/jb-sdd-odd-models preview local
/jb-sdd-odd-models doctor
```

## Recover or undo runtime state

Use these commands from Pi after installation:

- `/jb-sdd-odd-models undo` reverts the last completed transaction only if neither target file has changed since that transaction completed.
- `/jb-sdd-odd-models recover` handles an interrupted transaction when current bytes match recorded safe states.
- `/jb-sdd-odd-models doctor` reports stale locks, malformed journals, and preserved unrelated mappings without writing.

Recovery is intentionally conservative. If a noncooperating writer changed either file outside the transaction, recovery refuses unknown bytes instead of overwriting them.

## Uninstall or restore

There is no automated uninstall because removing shared JSON keys safely depends on changes made after installation.

To restore a previous state:

1. Stop Pi.
2. Choose the installer backup created for the relevant run.
3. Copy each saved file back to the same relative path under `PI_HOME`.
4. For files that the installer created and that have no backup, inspect them before manually removing them. Do not remove `subagents.json` if another runtime or configuration uses it.
5. Restart Pi and verify the desired runtime behavior.

To uninstall without a complete restore, manually remove the extension and profile files, then remove only the managed `model_profiles` keys from `subagents.json`. Preserve every unrelated key and mapping.
