# Use `/sdd-models`

The command reports or switches the global model profile used by the 12 managed SDD subagents.

## Command reference

| Input | Effect |
|---|---|
| `/sdd-models` | Shows usage, active-state detection, and all managed mappings. It does not write files. |
| `/sdd-models status` | Shows active-state detection and all managed mappings. It does not write files. |
| `/sdd-models openai` | Validates both named profiles and current files, writes the OpenAI mapping to canonical and runtime configuration, then reloads Pi. |
| `/sdd-models grok` | Validates both named profiles and current files, writes the Grok mapping to canonical and runtime configuration, then reloads Pi. |
| `/sdd-models <invalid>` | Displays an unknown-argument warning and usage. It does not write files. |

Arguments are trimmed and case-insensitive. For example, `/sdd-models OPENAI` selects the OpenAI profile.

## Examples

### Inspect without changing anything

```text
/sdd-models status
```

Expected heading:

```text
Active SDD profile: openai
```

The state can also be `grok`, `custom`, or `unknown`. Each following line shows an agent, model, and thinking level. `[misaligned]` means the canonical entry and live runtime entry differ for that agent.

### Select OpenAI

```text
/sdd-models openai
```

On success, the command reports that the OpenAI SDD profile was activated and asks Pi to reload. The canonical profile uses `thinking`; the runtime mapping receives the same value as `effort`.

### Select Grok

```text
/sdd-models grok
```

On success, the Grok mappings are written and Pi reloads. Provider authentication and model access must already be configured.

### Show usage and status together

```text
/sdd-models
```

This is equivalent to status reporting plus the usage line:

```text
Usage: /sdd-models status|openai|grok
```

### Invalid input

```text
/sdd-models local
```

Expected warning:

```text
Unknown argument: local
Usage: /sdd-models status|openai|grok
```

## Reload failure

A failed automatic reload does not undo a successful profile write. The command reports that the selected files remain active; run `/reload` manually or restart Pi.

## Completion

Argument completion offers `status`, `openai`, and `grok`, filtered by the typed prefix.
