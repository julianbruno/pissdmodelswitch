import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { constants } from "node:fs";
import { access, chmod, copyFile, mkdir, readFile, readdir, realpath, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { promisify } from "node:util";
import test from "node:test";

import { deriveCanonicalProfileForSelection, deriveRuntimeModelProfilesForSelection, validateManifest, validateProfileSet } from "../extensions/model-profiles/core.ts";
import { installModelProfiles } from "../install/model-profiles-install.ts";

const execFileAsync = promisify(execFile);

type JsonObject = Record<string, any>;

async function exists(path: string): Promise<boolean> {
  try {
    await access(path, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

async function readJson(path: string): Promise<JsonObject> {
  return JSON.parse(await readFile(path, "utf8"));
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function tempRoot(name: string): Promise<string> {
  return mkdir(join(tmpdir(), `${name}-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`), { recursive: true });
}

async function preparePiHome(name: string): Promise<string> {
  const piHome = await tempRoot(name);
  await mkdir(join(piHome, "agent"), { recursive: true });
  return piHome;
}

async function copyTree(source: string, target: string): Promise<void> {
  const entries = await readdir(source, { withFileTypes: true });
  await mkdir(target, { recursive: true });
  for (const entry of entries) {
    const from = join(source, entry.name);
    const to = join(target, entry.name);
    if (entry.isDirectory()) await copyTree(from, to);
    else if (entry.isFile()) await copyFile(from, to);
  }
}

async function copyPackageFixture(): Promise<string> {
  const root = await tempRoot("installer-package");
  await mkdir(join(root, "config"), { recursive: true });
  await mkdir(join(root, "extensions"), { recursive: true });
  await mkdir(join(root, "install"), { recursive: true });
  await copyFile("config/model-profiles.manifest.json", join(root, "config", "model-profiles.manifest.json"));
  await copyFile("config/models.openai.json", join(root, "config", "models.openai.json"));
  await copyFile("config/models.grok.json", join(root, "config", "models.grok.json"));
  await copyFile("extensions/sdd-model-profiles.ts", join(root, "extensions", "sdd-model-profiles.ts"));
  await copyTree("extensions/model-profiles", join(root, "extensions", "model-profiles"));
  await copyFile("install/install.sh", join(root, "install", "install.sh"));
  await copyFile("install/model-profiles-install.ts", join(root, "install", "model-profiles-install.ts"));
  await chmod(join(root, "install", "install.sh"), 0o755);
  return realpath(root);
}

async function expectedDefaultFrom(packageRoot = ".") {
  const manifest = validateManifest(await readJson(join(packageRoot, "config", "model-profiles.manifest.json")));
  const inputs: JsonObject = {};
  for (const profile of manifest.profiles) {
    inputs[profile.name] = await readJson(join(packageRoot, "config", profile.modelsFile));
  }
  const profiles = validateProfileSet(inputs, manifest);
  return { manifest, profiles, profile: profiles[manifest.defaultProfile] };
}

async function runInstall(packageRoot: string, piHome: string) {
  return installModelProfiles({ packageRoot: resolve(packageRoot), piHome: resolve(piHome), log: () => undefined });
}

async function runShellInstallWithFakeNode(version: string, packageRoot: string, piHome: string) {
  const fakeBin = join(await tempRoot(`fake-node-${version.replace(/[^0-9]/g, "-")}`), "bin");
  await mkdir(fakeBin, { recursive: true });
  const fakeNode = join(fakeBin, "node");
  await writeFile(fakeNode, `#!/usr/bin/env sh
if [ "$1" = "-p" ]; then
  printf '${version}\\n'
  exit 0
fi
exec ${JSON.stringify(process.execPath)} "$@"
`, "utf8");
  await chmod(fakeNode, 0o755);
  return execFileAsync(join(packageRoot, "install", "install.sh"), [], { env: { ...process.env, PATH: `${fakeBin}:${process.env.PATH}`, PI_HOME: piHome }, timeout: 120_000 });
}

test("packaged duplicate active and seed files are eliminated after equivalence proof", async () => {
  const { manifest, profiles } = await expectedDefaultFrom();
  assert.deepEqual(deriveCanonicalProfileForSelection(manifest.defaultProfile, profiles, manifest)["sdd-research"], profiles.openai["sdd-research"]);
  assert.deepEqual(deriveRuntimeModelProfilesForSelection(manifest.defaultProfile, profiles, manifest)["sdd-research"], {
    model: profiles.openai["sdd-research"].model,
    effort: profiles.openai["sdd-research"].thinking,
  });
  assert.equal(await exists("config/models.json"), false);
  assert.equal(await exists("config/subagents.seed.json"), false);
});

test("malformed manifest or registered profile fails before any target mutation", async () => {
  const packageRoot = await copyPackageFixture();
  const piHome = await preparePiHome("installer-malformed");
  const canonicalPath = join(piHome, "gentle-ai", "models.json");
  const runtimePath = join(piHome, "agent", "subagents.json");
  await writeJson(canonicalPath, { keep: { model: "provider/keep", thinking: "low" } });
  await writeJson(runtimePath, { model_profiles: { keep: { model: "provider/keep", effort: "low" } }, preserved: true });
  const beforeCanonical = await readFile(canonicalPath, "utf8");
  const beforeRuntime = await readFile(runtimePath, "utf8");

  await writeJson(join(packageRoot, "config", "model-profiles.manifest.json"), { schemaVersion: 999 });
  await assert.rejects(runInstall(packageRoot, piHome), /schemaVersion must be 1/);
  assert.equal(await readFile(canonicalPath, "utf8"), beforeCanonical);
  assert.equal(await readFile(runtimePath, "utf8"), beforeRuntime);
  assert.equal(await exists(join(piHome, "backups")), false);

  await copyFile("config/model-profiles.manifest.json", join(packageRoot, "config", "model-profiles.manifest.json"));
  const openai = await readJson(join(packageRoot, "config", "models.openai.json"));
  delete openai["sdd-research"];
  await writeJson(join(packageRoot, "config", "models.openai.json"), openai);
  await assert.rejects(runInstall(packageRoot, piHome), /missing: sdd-research/);
  assert.equal(await readFile(canonicalPath, "utf8"), beforeCanonical);
  assert.equal(await readFile(runtimePath, "utf8"), beforeRuntime);
});

test("fresh temp install copies manifest, registered profiles, extension helpers, and derived default active files", async () => {
  const piHome = await preparePiHome("installer-fresh");
  const result = await runInstall(".", piHome);
  const { manifest, profiles } = await expectedDefaultFrom();

  assert.equal(result.changed, true);
  assert.deepEqual(await readJson(join(piHome, "gentle-ai", "model-profiles.manifest.json")), manifest);
  for (const registration of manifest.profiles) {
    assert.deepEqual(await readJson(join(piHome, "gentle-ai", registration.modelsFile)), await readJson(join("config", registration.modelsFile)));
  }
  assert.deepEqual(await readJson(join(piHome, "gentle-ai", "models.json")), deriveCanonicalProfileForSelection(manifest.defaultProfile, profiles, manifest));
  assert.deepEqual((await readJson(join(piHome, "agent", "subagents.json"))).model_profiles, deriveRuntimeModelProfilesForSelection(manifest.defaultProfile, profiles, manifest));
  assert.deepEqual((await readJson(join(piHome, "gentle-ai", "models.json")))["review-risk"], profiles.grok["review-risk"]);
  assert.equal(await exists(join(piHome, "agent", "extensions", "sdd-model-profiles.ts")), true);
  assert.equal(await exists(join(piHome, "agent", "extensions", "model-profiles", "core.ts")), true);
  assert.equal(await exists(join(piHome, "agent", "extensions", "model-profiles", "transaction.ts")), true);
  assert.equal(await exists(join(piHome, "agent", "extensions", "core.ts")), false);
  assert.equal(await exists(join(piHome, "backups")), false);
});

test("legacy migration preserves unrelated runtime and canonical data, creates backups, and repeat install is byte no-op", async () => {
  const piHome = await preparePiHome("installer-legacy");
  const canonicalPath = join(piHome, "gentle-ai", "models.json");
  const runtimePath = join(piHome, "agent", "subagents.json");
  await writeJson(canonicalPath, {
    "sdd-init": { model: "legacy/init", thinking: "low" },
    customCanonical: { model: "keep/canonical", thinking: "medium" },
  });
  await writeJson(runtimePath, {
    model_profiles: {
      "sdd-init": { model: "legacy/init", effort: "low" },
      unrelatedAgent: { model: "keep/runtime", effort: "low" },
    },
    unrelatedTopLevel: { keep: true },
  });
  const beforeCanonical = await readFile(canonicalPath, "utf8");
  const beforeRuntime = await readFile(runtimePath, "utf8");

  const first = await runInstall(".", piHome);
  assert.equal(first.changed, true);
  assert.ok(first.backupRoot);
  assert.equal(await readFile(join(first.backupRoot!, "gentle-ai", "models.json"), "utf8"), beforeCanonical);
  assert.equal(await readFile(join(first.backupRoot!, "agent", "subagents.json"), "utf8"), beforeRuntime);
  assert.equal(await exists(join(first.backupRoot!, "RESTORE.txt")), true);

  const canonical = await readJson(canonicalPath);
  const runtime = await readJson(runtimePath);
  assert.deepEqual(canonical.customCanonical, { model: "keep/canonical", thinking: "medium" });
  assert.deepEqual(runtime.unrelatedTopLevel, { keep: true });
  assert.deepEqual(runtime.model_profiles.unrelatedAgent, { model: "keep/runtime", effort: "low" });
  assert.ok(canonical["sdd-research"]);
  assert.ok(runtime.model_profiles["sdd-research"]);

  const afterCanonical = await readFile(canonicalPath, "utf8");
  const afterRuntime = await readFile(runtimePath, "utf8");
  const afterCanonicalStat = await stat(canonicalPath);
  const afterRuntimeStat = await stat(runtimePath);
  await new Promise((resolve) => setTimeout(resolve, 10));
  const second = await runInstall(".", piHome);
  assert.equal(second.changed, false);
  assert.equal(second.backupRoot, undefined);
  assert.equal(await readFile(canonicalPath, "utf8"), afterCanonical);
  assert.equal(await readFile(runtimePath, "utf8"), afterRuntime);
  assert.equal((await stat(canonicalPath)).mtimeMs, afterCanonicalStat.mtimeMs);
  assert.equal((await stat(runtimePath)).mtimeMs, afterRuntimeStat.mtimeMs);
});

test("dynamic third profile installs and the installed command can status and switch through copied helpers", async () => {
  const packageRoot = await copyPackageFixture();
  const piHome = await preparePiHome("installer-dynamic");
  const manifest = await readJson(join(packageRoot, "config", "model-profiles.manifest.json"));
  manifest.profiles.push({ name: "local", modelsFile: "models.local.json" });
  await writeJson(join(packageRoot, "config", "model-profiles.manifest.json"), manifest);
  const baseProfile = await readJson(join(packageRoot, "config", "models.openai.json"));
  const localProfile = Object.fromEntries(Object.keys(baseProfile).map((agent) => [agent, { model: `local/${agent}`, thinking: "medium" }]));
  await writeJson(join(packageRoot, "config", "models.local.json"), localProfile);

  await runInstall(packageRoot, piHome);
  assert.deepEqual(await readJson(join(piHome, "gentle-ai", "models.local.json")), localProfile);

  const imported = await import(`${join(piHome, "agent", "extensions", "sdd-model-profiles.ts")}?${Date.now()}`);
  const commands = new Map<string, any>();
  imported.default({ registerCommand: (name: string, command: any) => commands.set(name, command) }, { piHome });
  const command = commands.get("jb-sdd-odd-models");
  assert.ok(command);
  const notifications: Array<{ message: string; level: string }> = [];
  let reloads = 0;
  const ctx = { cwd: piHome, ui: { notify: (message: string, level: string) => notifications.push({ message, level }) }, reload: async () => { reloads += 1; } };

  await command.handler("status", ctx);
  assert.match(notifications.at(-1)?.message ?? "", /Active SDD\/ODD profile: openai/);
  await command.handler("local", ctx);
  assert.equal(reloads, 1);
  assert.match(notifications.at(-1)?.message ?? "", /local profile activated/);
  assert.deepEqual((await readJson(join(piHome, "gentle-ai", "models.json")))["sdd-research"], { model: "local/sdd-research", thinking: "medium" });
  assert.deepEqual((await readJson(join(piHome, "agent", "subagents.json"))).model_profiles["sdd-research"], { model: "local/sdd-research", effort: "medium" });
});

test("installer fails closed when active transaction or same-target lock is present", async () => {
  const piHome = await preparePiHome("installer-lock");
  await runInstall(".", piHome);
  const canonicalPath = join(piHome, "gentle-ai", "models.json");
  const runtimePath = join(piHome, "agent", "subagents.json");
  const beforeCanonical = await readFile(canonicalPath, "utf8");
  const beforeRuntime = await readFile(runtimePath, "utf8");
  const journalDir = join(piHome, "gentle-ai", ".model-profiles-transactions");
  await mkdir(journalDir, { recursive: true });
  await writeJson(join(journalDir, "active.json"), {
    schemaVersion: 1,
    id: "fixture",
    operation: "switch",
    phase: "prepared",
    createdAt: new Date().toISOString(),
    targetIdentity: { canonicalPath, runtimePath },
    files: {
      canonical: { path: canonicalPath, beforeHash: "bad", beforeContent: "", afterHash: "bad", afterContent: "" },
      runtime: { path: runtimePath, beforeHash: "bad", beforeContent: "", afterHash: "bad", afterContent: "" },
    },
  });

  await assert.rejects(runInstall(".", piHome), /transaction state is unresolved|active transaction|ambiguous/i);
  assert.equal(await readFile(canonicalPath, "utf8"), beforeCanonical);
  assert.equal(await readFile(runtimePath, "utf8"), beforeRuntime);
  await writeFile(join(journalDir, "active.json"), "{malformed", "utf8");
  await assert.rejects(runInstall(".", piHome), /transaction state is unresolved|ambiguous/i);
});

test("install shell enforces Node strip-types minimum before running the TypeScript installer", async () => {
  const packageRoot = await copyPackageFixture();
  const piHome = await preparePiHome("installer-node-min");

  await assert.rejects(
    runShellInstallWithFakeNode("22.18.1", packageRoot, piHome),
    /Node\.js 22\.19\.0 or newer is required.*--experimental-strip-types/s,
  );
  assert.equal(await exists(join(piHome, "gentle-ai")), false);
});

test("install shell accepts Node 22.19.0 and newer supported versions", async () => {
  const packageRoot2219 = await copyPackageFixture();
  const piHome2219 = await preparePiHome("installer-node-2219");
  await runShellInstallWithFakeNode("22.19.0", packageRoot2219, piHome2219);
  assert.equal(await exists(join(piHome2219, "gentle-ai", "models.json")), true);

  const packageRootNewer = await copyPackageFixture();
  const piHomeNewer = await preparePiHome("installer-node-newer");
  await runShellInstallWithFakeNode("26.8.2", packageRootNewer, piHomeNewer);
  assert.equal(await exists(join(piHomeNewer, "gentle-ai", "models.json")), true);
});
