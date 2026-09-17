# Profile alias relationships

This document records how legacy profile names relate to the version 1.1 selectable profiles.

## Legacy aliases

| Legacy profile | Comparable 1.1 profile | Notes |
|---|---|---|
| `openai` | `gpt-5.6-recommended` | Backward-compatible OpenAI alias. Prefer `gpt-5.6-recommended` for new usage. |
| `grok` | `grok-recommended` | Backward-compatible Grok alias. Prefer `grok-recommended` for new usage. |

## Opposite-provider judge routing for legacy aliases

When `oppositeProviderJudges.enabled` is `true`:

| Selected profile | Judge/reviewer profile |
|---|---|
| `openai` | `grok` |
| `grok` | `openai` |

These legacy pairings preserve the previous behavior.

## Opposite-provider judge routing for 1.1 profiles

Version 1.1 profiles pair judges by provider and cost lane:

| Selected profile | Judge/reviewer profile |
|---|---|
| `gpt-5.6-low-cost` | `grok-low-cost` |
| `gpt-5.6-recommended` | `grok-recommended` |
| `gpt-5.6-powerful` | `grok-powerful` |
| `gpt-astra-low-cost` | `grok-low-cost` |
| `gpt-astra-recommended` | `grok-recommended` |
| `gpt-astra-powerful` | `grok-powerful` |
| `gpt-astra-only-low-cost` | `grok-low-cost` |
| `gpt-astra-only-recommended` | `grok-recommended` |
| `gpt-astra-only-powerful` | `grok-powerful` |
| `grok-low-cost` | `gpt-5.6-low-cost` |
| `grok-recommended` | `gpt-5.6-recommended` |
| `grok-powerful` | `gpt-5.6-powerful` |

## When to use each profile

| Profile | Use when |
|---|---|
| `gpt-5.6-low-cost` | You want the cheapest OpenAI-family profile for routine exploration, small fixes, docs, or low-risk maintenance. |
| `gpt-5.6-recommended` | You want the default balanced OpenAI profile for normal ODD/SDD work. Start here unless cost or difficulty says otherwise. |
| `gpt-5.6-powerful` | You need stronger reasoning for complex design, risky refactors, broad verification, or tasks where mistakes are expensive. |
| `gpt-astra-low-cost` | You want Astra only for reasoning-heavy agents while keeping lower-cost GPT-5.6 models for code/light roles. |
| `gpt-astra-recommended` | You want a balanced Astra-oriented profile for harder planning/reasoning, while keeping code work on the cost-aware model. |
| `gpt-astra-powerful` | You want Astra on reasoning and code roles for high-complexity work where quality matters more than cost. |
| `gpt-astra-only-low-cost` | You need all managed agents on Astra but want the lowest effort/cost setting available for that family. |
| `gpt-astra-only-recommended` | You need all managed agents on Astra with the standard cost-matched assignment. |
| `gpt-astra-only-powerful` | You need all managed agents on Astra for difficult work, with more effort on reasoning/code roles. |
| `grok-low-cost` | You want the cheapest Grok-family profile for routine tasks, smoke checks, or low-risk work. |
| `grok-recommended` | You want the default balanced Grok profile for normal work. Use this when you prefer Grok as the primary provider. |
| `grok-powerful` | You want stronger Grok reasoning/code coverage for complex or high-risk work. |
| `openai` | Compatibility alias only. Use when an older script or habit expects `openai`; otherwise prefer `gpt-5.6-recommended`. |
| `grok` | Compatibility alias only. Use when an older script or habit expects `grok`; otherwise prefer `grok-recommended`. |

## Recommendation

Use the explicit 1.1 profile names for new work. Keep `openai` and `grok` only for compatibility with older commands, scripts, or habits.
