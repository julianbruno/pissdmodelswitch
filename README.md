# Switch SDD/ODD model profiles safely

This portable package installs the `/jb-sdd-odd-models` Pi command, helper modules, and a versioned model-profile manifest for SDD phase agents plus core ODD generic agents. The manifest is the source of truth: it defines the managed agent groups, registered profile files, reserved command names, and default profile.

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

- [Installation and recovery](HOW_TO_INSTALL.md)
- [Command usage](USAGE.md)
- [How switching works](MODEL_SWITCHING.md)
- [Architecture and limitations](ARCHITECTURE.md)
- [Provenance caveat](NOTICE.md)

## Scope

The command manages every agent named in `config/model-profiles.manifest.json`. The current manifest covers SDD phase agents, including `sdd-research`, and ODD generic agents: `gentle-ai-explore`, `gentle-ai-worker`, and `gentle-ai-verify`.

It writes only the managed keys in the installed canonical and runtime mappings. Unrelated top-level JSON keys and unrelated `model_profiles` entries are preserved and reported by `doctor` rather than treated as errors.
