#!/usr/bin/env sh
set -eu

fail() {
  printf 'sdd-models installer: %s\n' "$*" >&2
  exit 1
}

command -v node >/dev/null 2>&1 || fail "Node.js is required (Pi itself requires Node.js)."
if [ -z "${PI_HOME:-}" ] && [ -z "${HOME:-}" ]; then
  fail "Neither HOME nor PI_HOME is set. Set one before installing."
fi

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
PACKAGE_ROOT=$(CDPATH= cd -- "$SCRIPT_DIR/.." && pwd)
PI_HOME=${PI_HOME:-"$HOME/.pi"}

[ -d "$PI_HOME/agent" ] || fail "Pi agent directory not found at $PI_HOME/agent. Install Gentle Pi first, or set PI_HOME to its Pi home."

for file in \
  extensions/sdd-model-profiles.ts \
  config/models.openai.json \
  config/models.grok.json \
  config/models.json \
  config/subagents.seed.json
do
  [ -f "$PACKAGE_ROOT/$file" ] || fail "Package asset is missing: $file"
done

PACKAGE_ROOT=$PACKAGE_ROOT PI_HOME=$PI_HOME node <<'NODE'
const { constants } = require("node:fs");
const { access, chmod, copyFile, mkdir, readFile, rename, stat, writeFile } = require("node:fs/promises");
const path = require("node:path");

const root = process.env.PACKAGE_ROOT;
const piHome = process.env.PI_HOME;
const managedAgents = [
  "sdd-init", "sdd-explore", "sdd-proposal", "sdd-spec", "sdd-design", "sdd-tasks",
  "sdd-onboard", "sdd-archive", "sdd-apply", "sdd-verify", "sdd-status", "sdd-sync",
];

function parseObject(text, label) {
  let value;
  try { value = JSON.parse(text); } catch (error) { throw new Error(`${label} is not valid JSON: ${error.message}`); }
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must contain a JSON object.`);
  return value;
}

function validateCanonical(value, label) {
  const keys = Object.keys(value);
  if (keys.length !== managedAgents.length || managedAgents.some((name) => !keys.includes(name))) {
    throw new Error(`${label} must contain exactly the 12 managed SDD agents.`);
  }
  for (const name of managedAgents) {
    const entry = value[name];
    if (!entry || typeof entry.model !== "string" || typeof entry.thinking !== "string") {
      throw new Error(`${label}.${name} must contain string model and thinking fields.`);
    }
  }
}

function validateSeed(value) {
  if (!value.model_profiles || typeof value.model_profiles !== "object" || Array.isArray(value.model_profiles)) {
    throw new Error("config/subagents.seed.json must contain model_profiles.");
  }
  const keys = Object.keys(value.model_profiles);
  if (keys.length !== managedAgents.length || managedAgents.some((name) => !keys.includes(name))) {
    throw new Error("config/subagents.seed.json must contain exactly the 12 managed model_profiles entries.");
  }
  for (const name of managedAgents) {
    const entry = value.model_profiles[name];
    if (!entry || typeof entry.model !== "string" || typeof entry.effort !== "string") {
      throw new Error(`model_profiles.${name} must contain string model and effort fields.`);
    }
  }
}

async function exists(file) {
  try { await access(file, constants.F_OK); return true; } catch { return false; }
}

async function atomicWrite(file, content, mode) {
  await mkdir(path.dirname(file), { recursive: true });
  const temp = path.join(path.dirname(file), `.${path.basename(file)}.${process.pid}.${Date.now()}.tmp`);
  await writeFile(temp, content, { encoding: "utf8", mode, flag: "wx" });
  await rename(temp, file);
  await chmod(file, mode);
}

(async () => {
  const sourceFiles = {
    extension: path.join(root, "extensions", "sdd-model-profiles.ts"),
    openai: path.join(root, "config", "models.openai.json"),
    grok: path.join(root, "config", "models.grok.json"),
    canonical: path.join(root, "config", "models.json"),
    seed: path.join(root, "config", "subagents.seed.json"),
  };
  const source = {};
  for (const [name, file] of Object.entries(sourceFiles)) source[name] = await readFile(file, "utf8");

  validateCanonical(parseObject(source.openai, "config/models.openai.json"), "config/models.openai.json");
  validateCanonical(parseObject(source.grok, "config/models.grok.json"), "config/models.grok.json");
  validateCanonical(parseObject(source.canonical, "config/models.json"), "config/models.json");
  const seed = parseObject(source.seed, "config/subagents.seed.json");
  validateSeed(seed);

  const runtimePath = path.join(piHome, "agent", "subagents.json");
  let runtime = {};
  if (await exists(runtimePath)) runtime = parseObject(await readFile(runtimePath, "utf8"), runtimePath);
  const existingProfiles = runtime.model_profiles;
  if (existingProfiles !== undefined && (!existingProfiles || typeof existingProfiles !== "object" || Array.isArray(existingProfiles))) {
    throw new Error(`${runtimePath}.model_profiles must be a JSON object before it can be merged.`);
  }
  const mergedProfiles = { ...(existingProfiles || {}) };
  for (const name of managedAgents) mergedProfiles[name] = seed.model_profiles[name];
  const mergedRuntime = `${JSON.stringify({ ...runtime, model_profiles: mergedProfiles }, null, 2)}\n`;

  const plans = [
    [path.join(piHome, "agent", "extensions", "sdd-model-profiles.ts"), source.extension, 0o644],
    [path.join(piHome, "gentle-ai", "models.openai.json"), source.openai, 0o600],
    [path.join(piHome, "gentle-ai", "models.grok.json"), source.grok, 0o600],
    [path.join(piHome, "gentle-ai", "models.json"), source.canonical, 0o600],
    [runtimePath, mergedRuntime, 0o600],
  ];

  const changed = [];
  for (const plan of plans) {
    const [file, content] = plan;
    const current = (await exists(file)) ? await readFile(file, "utf8") : null;
    if (current !== content) changed.push({ plan, existed: current !== null });
  }
  if (!changed.length) {
    console.log(`sdd-models is already installed in ${piHome}; no files changed.`);
    return;
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backupRoot = path.join(piHome, "backups", `sdd-models-${stamp}-${process.pid}`);
  const existingChanges = changed.filter((item) => item.existed);
  if (existingChanges.length) {
    for (const { plan: [file] } of existingChanges) {
      const relative = path.relative(piHome, file);
      if (relative.startsWith("..")) throw new Error(`Refusing to back up path outside PI_HOME: ${file}`);
      const backup = path.join(backupRoot, relative);
      await mkdir(path.dirname(backup), { recursive: true });
      await copyFile(file, backup);
    }
    await writeFile(path.join(backupRoot, "RESTORE.txt"), "Copy the saved files back to the same relative paths under PI_HOME. Files absent from this backup were created by the installer.\n", "utf8");
  }

  for (const { plan: [file, content, mode] } of changed) await atomicWrite(file, content, mode);

  console.log(`Installed sdd-models into ${piHome}.`);
  if (existingChanges.length) console.log(`Backups: ${backupRoot}`);
  console.log("Restart Pi, then run /sdd-models status.");
})().catch((error) => {
  console.error(`sdd-models installer: ${error.message}`);
  process.exitCode = 1;
});
NODE
