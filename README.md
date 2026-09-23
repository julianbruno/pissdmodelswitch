# Switch SDD/ODD model profiles safely

This portable package installs the `/jb-sdd-odd-models` Pi command, helper modules, and a versioned model-profile manifest for SDD phase agents plus core ODD generic agents. The manifest is the source of truth: it defines the managed agent groups, optional opposite-provider judge routing, registered profile files, reserved command names, and default profile.

The installer derives active runtime files from the default named profile, preserves unrelated configuration, and backs up every existing file it changes.

## Quick start

Prerequisites: Gentle Pi, Node.js 22.19.0 or newer for the installer, and Pi provider authentication for the models you plan to use.

```sh
cd pi-sdd-model-switch
./install/install.sh
# Restart Pi, then run:
/jb-sdd-odd-models status
/jb-sdd-odd-models doctor
```

For a non-default Pi home:

```sh
PI_HOME=/path/to/pi-home ./install/install.sh
PI_HOME=/path/to/pi-home pi
```

`PI_HOME` must also be present when Pi runs so the extension reads the same files the installer wrote.

## Documentation

- [Quick installation](INSTALLATION.md)
- [Installation and recovery](HOW_TO_INSTALL.md)
- [Programmatic testing](TESTING.md)
- [Command usage](USAGE.md)
- [How switching works](MODEL_SWITCHING.md)
- [Architecture and limitations](ARCHITECTURE.md)
- [Provenance caveat](NOTICE.md)

## Scope

The command manages every agent named in `config/model-profiles.manifest.json`. The current manifest covers `orchestrator`, SDD phase agents, including `sdd-research`, ODD generic agents (`gentle-ai-explore`, `gentle-ai-worker`, and `gentle-ai-verify`), review support agents (`review-refuter` and `review-validator`), and configured judge/reviewer agents (`review-risk`, `review-resilience`, `review-readability`, `review-reliability`, `jd-judge-a`, and `jd-judge-b`).

Version 1.1 registers every named profile from `config/named-profiles.json`: GPT-5.6, GPT Astra, GPT Astra-only, and Grok low-cost/recommended/powerful variants. The default profile is `openaigentle`, using GPT-6 Sol/Luna; legacy `openai` and `grok` aliases remain registered for compatibility.

For paired profiles, judge/reviewer agents use an opposite-provider profile in the same cost lane: GPT-family profiles route judges to the matching Grok lane, and Grok profiles route judges to the matching GPT-5.6 lane. Legacy `openai` still pairs with `grok`, and `grok` still pairs with `openai`. Unpaired profiles, including `openaigentle`, retain their own judge mappings. Manifests without configured judge agents keep the previous uniform-profile behavior.

It writes only the managed keys in the installed canonical and runtime mappings. Unrelated top-level JSON keys and unrelated `model_profiles` entries are preserved and reported by `doctor` rather than treated as errors.
