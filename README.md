# Switch SDD model profiles safely

This portable package installs the `/sdd-models` Pi command and the current OpenAI and Grok mappings for 12 SDD agents. The installer preserves unrelated runtime configuration and backs up every existing file it changes.

## Quick start

Prerequisites: Gentle Pi, `pi-subagents-j0k3r`, Node.js, and provider authentication for the models you plan to use.

```sh
cd pi-sdd-model-switch
./install/install.sh
# Restart Pi, then run:
/sdd-models status
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

The command manages exactly these 12 mappings: `sdd-init`, `sdd-explore`, `sdd-proposal`, `sdd-spec`, `sdd-design`, `sdd-tasks`, `sdd-onboard`, `sdd-archive`, `sdd-apply`, `sdd-verify`, `sdd-status`, and `sdd-sync`.

It intentionally does not manage the newer `sdd-research` agent. See [Architecture and limitations](ARCHITECTURE.md#known-limitations).
