# Install `/jb-sdd-odd-models`

This guide shows the shortest safe path to install the model-profile switch plugin into Pi.

## Quick install

From this repository:

```sh
cd /path/to/pissdmodelswitch
./install/install.sh
```

Then restart Pi and verify the command is loaded:

```text
/jb-sdd-odd-models status
/jb-sdd-odd-models doctor
```

## Requirements

- Gentle Pi is already installed.
- `$PI_HOME/agent/` exists. If `PI_HOME` is unset, the installer uses `~/.pi`.
- Node.js 22.19.0 or newer is available as `node`.
- Pi provider authentication is already configured for the providers you plan to use.

The installer does not install Pi, provider credentials, or model access.

## What gets installed

The installer copies the command and profile data into Pi home:

| Target | Purpose |
|---|---|
| `$PI_HOME/agent/extensions/sdd-model-profiles.ts` | Slash command extension |
| `$PI_HOME/agent/extensions/model-profiles/` | Helper modules |
| `$PI_HOME/gentle-ai/model-profiles.manifest.json` | Profile manifest |
| `$PI_HOME/gentle-ai/models.openai.json` | OpenAI profile |
| `$PI_HOME/gentle-ai/models.grok.json` | Grok profile |
| `$PI_HOME/gentle-ai/models.json` | Derived active canonical profile |
| `$PI_HOME/agent/subagents.json` | Merged runtime `model_profiles` entries |

Unrelated JSON keys and unrelated `model_profiles` entries are preserved.

## Custom `PI_HOME`

Use the same `PI_HOME` for installation and when running Pi:

```sh
PI_HOME=/path/to/pi-home ./install/install.sh
PI_HOME=/path/to/pi-home pi
```

The target must already contain an `agent/` directory.

## Backups

When an existing target file changes, the installer creates a backup under:

```text
$PI_HOME/backups/jb-sdd-odd-models-<timestamp>-<pid>/
```

Re-running the installer with identical generated files is a no-op and does not create a new backup.

## Verify after restart

Run:

```text
/jb-sdd-odd-models status
/jb-sdd-odd-models doctor
```

Expected result:

- Pi recognizes `/jb-sdd-odd-models`.
- `status` shows `openai`, `grok`, another registered profile, or intentionally `custom`.
- `doctor` reports healthy managed mappings or actionable diagnostics.

## Common recovery path

If the installer refuses to write because a transaction or lock exists, restart Pi and inspect:

```text
/jb-sdd-odd-models doctor
```

Recover only when the diagnostic says recovery is safe:

```text
/jb-sdd-odd-models recover
/jb-sdd-odd-models doctor
```

## Related docs

- [Install and recover details](HOW_TO_INSTALL.md)
- [Command usage](USAGE.md)
- [How switching works](MODEL_SWITCHING.md)
