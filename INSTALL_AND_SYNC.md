# Install and sync model profiles

Use this after changing the packaged model profiles in this repository and you want Pi to use them.

## Quick path

From this repository:

```sh
cd ~/miscodigos/pissdmodelswitch
./install/install.sh
```

Then restart Pi and run:

```text
/jb-sdd-odd-models status
/jb-sdd-odd-models doctor
```

If the active profile is not `openai`, switch to it:

```text
/jb-sdd-odd-models openai
/jb-sdd-odd-models status
```

## What the installer updates

The installer syncs the repository's packaged profiles into Pi's home directory.
By default that is `~/.pi`.

It writes or updates:

- `~/.pi/agent/extensions/sdd-model-profiles.ts`
- `~/.pi/agent/extensions/model-profiles/`
- `~/.pi/gentle-ai/model-profiles.manifest.json`
- registered profile files such as `~/.pi/gentle-ai/models.openai.json`
- active `~/.pi/gentle-ai/models.json`
- managed `model_profiles` entries in `~/.pi/agent/subagents.json`

Unrelated runtime keys and unrelated `model_profiles` entries are preserved.

## Custom `PI_HOME`

If Pi uses a non-default home directory, install and run Pi with the same `PI_HOME`:

```sh
cd ~/miscodigos/pissdmodelswitch
PI_HOME=/path/to/pi-home ./install/install.sh
PI_HOME=/path/to/pi-home pi
```

The target `PI_HOME` must already contain an `agent/` directory.

## Recovery checks

If installation refuses to write because a model-profile transaction or lock exists, inspect first:

```text
/jb-sdd-odd-models doctor
```

Recover only when the diagnostic says it is safe:

```text
/jb-sdd-odd-models recover
/jb-sdd-odd-models doctor
```

## Expected result

After reinstalling and selecting `openai`, Pi should use the OpenAI profile from:

```text
config/models.openai.json
```

For the current Recommended GPT-5.6 mapping, that means:

| Role | Model | Effort |
|---|---|---|
| Reasoning agents | `openai-codex/gpt-5.6-sol` | `medium` |
| Code agents | `openai-codex/gpt-5.6-terra` | `high` |
| Lightweight agents | `openai-codex/gpt-5.6-luna` | `high` |
