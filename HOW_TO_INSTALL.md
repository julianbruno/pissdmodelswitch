# Install and recover `/sdd-models`

Run the included installer from this package. It validates package data, backs up existing files that will change, and merges only the 12 managed runtime mappings.

## Prerequisites

- A working Gentle Pi installation.
- The `pi-subagents-j0k3r` extension/plugin that consumes `subagents.json.model_profiles`.
- Node.js available as `node` (Pi already requires Node.js).
- A Pi home containing an `agent/` directory. The default is `~/.pi`.
- Authentication configured in Pi for each provider you intend to select:
  - OpenAI Codex for `openai-codex/...` models.
  - xAI for `xai/...` models.

The installer does not install Pi, plugins, models, credentials, or provider authentication. A successful file installation does not prove that a provider account can access every configured model.

## Install

```sh
cd /path/to/pi-sdd-model-switch
./install/install.sh
```

The installer writes:

- `~/.pi/agent/extensions/sdd-model-profiles.ts`
- `~/.pi/gentle-ai/models.openai.json`
- `~/.pi/gentle-ai/models.grok.json`
- `~/.pi/gentle-ai/models.json`
- the managed entries in `~/.pi/agent/subagents.json`

Existing unrelated top-level keys and unrelated `model_profiles` entries in `subagents.json` are preserved. Re-running the installer is safe: identical files are left unchanged.

### Custom Pi home

Set `PI_HOME` during installation **and whenever Pi runs**:

```sh
PI_HOME=/srv/my-pi ./install/install.sh
PI_HOME=/srv/my-pi pi
```

The target must already contain `agent/`; this prevents accidentally installing into an arbitrary directory. The extension defaults to `~/.pi` when `PI_HOME` is unset.

## Backups

When an existing target changes, the installer creates a timestamped directory under:

```text
$PI_HOME/backups/sdd-models-<timestamp>-<pid>/
```

Backups retain paths relative to `PI_HOME`. Newly created files have no prior copy and therefore do not appear in the backup.

## Verify

1. Restart Pi so it loads the installed extension.
2. Run `/sdd-models status`.
3. Confirm that all 12 mappings are listed and the active profile is `openai`, `grok`, or intentionally `custom`.
4. Optionally switch and verify:

   ```text
   /sdd-models grok
   /sdd-models status
   ```

5. Run an SDD subagent only after confirming provider authentication and model availability.

If Pi does not recognize the command, verify that Gentle Pi loads TypeScript extensions from `$PI_HOME/agent/extensions` and that the same `PI_HOME` is used at install time and runtime.

## Uninstall or restore

There is no automated uninstall because removing shared JSON keys safely depends on changes made after installation.

To restore a previous state:

1. Stop Pi.
2. Choose the installer backup created for the relevant run.
3. Copy each saved file back to the same relative path under `PI_HOME`.
4. For files that the installer created and that have no backup, inspect them before manually removing them. Do not remove `subagents.json` if another plugin or configuration uses it.
5. Restart Pi and verify the desired runtime behavior.

To uninstall without a complete restore, manually remove the extension and profile files, then remove only the 12 managed `model_profiles` keys from `subagents.json`. Preserve every unrelated key and mapping.
