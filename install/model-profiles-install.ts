import { constants } from "node:fs";
import { access, chmod, copyFile, mkdir, open, readFile, rename, stat, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { basename, dirname, join, relative, resolve, sep } from "node:path";

import {
  assertProfilesCoverManifest,
  deriveCanonicalProfile,
  deriveRuntimeConfig,
  isJsonObject,
  validateManifest,
  validateProfileSet,
  type JsonObject,
  type ModelProfilesManifest,
  type ValidatedModelProfile,
} from "../extensions/model-profiles/core.ts";

type InstallOptions = {
  packageRoot?: string;
  piHome?: string;
  log?: (message: string) => void;
};

export type InstallResult = {
  changed: boolean;
  backupRoot?: string;
  changedFiles: string[];
};

type Registry = {
  manifest: ModelProfilesManifest;
  profiles: Record<string, ValidatedModelProfile>;
  sourceText: Map<string, string>;
};

type Plan = {
  path: string;
  content: string;
  mode: number;
};

const configMode = 0o600;
const extensionMode = 0o644;
const helperFiles = ["core.ts", "transaction.ts"];

function fail(message: string): never {
  throw new Error(message);
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

function assertInside(root: string, candidate: string, label: string): string {
  const resolvedRoot = resolve(root);
  const resolvedCandidate = resolve(candidate);
  if (resolvedCandidate !== resolvedRoot && !resolvedCandidate.startsWith(`${resolvedRoot}${sep}`)) {
    fail(`${label} must stay inside ${resolvedRoot}.`);
  }
  return resolvedCandidate;
}

function parseJsonObject(text: string, label: string, path: string): JsonObject {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    fail(`${label} is not valid JSON (${path}): ${error instanceof Error ? error.message : String(error)}`);
  }
  if (!isJsonObject(parsed)) fail(`${label} must contain a JSON object (${path}).`);
  return parsed;
}

async function readText(path: string, label: string): Promise<string> {
  try {
    return await readFile(path, "utf8");
  } catch (error) {
    const code = isJsonObject(error) && typeof error.code === "string" ? error.code : "";
    if (code === "ENOENT") fail(`Package asset is missing: ${label}`);
    throw error;
  }
}

async function readOptionalJson(path: string, label: string): Promise<JsonObject | undefined> {
  if (!await exists(path)) return undefined;
  return parseJsonObject(await readFile(path, "utf8"), label, path);
}

async function loadRegistry(packageRoot: string): Promise<Registry> {
  const configDir = assertInside(packageRoot, join(packageRoot, "config"), "Config directory");
  const sourceText = new Map<string, string>();
  const manifestPath = join(configDir, "model-profiles.manifest.json");
  const manifestText = await readText(manifestPath, "config/model-profiles.manifest.json");
  sourceText.set("config/model-profiles.manifest.json", manifestText);
  const manifest = validateManifest(parseJsonObject(manifestText, "Model profile manifest", manifestPath));

  const profileInputs: JsonObject = {};
  for (const registration of manifest.profiles) {
    const relativePath = `config/${registration.modelsFile}`;
    const profilePath = assertInside(configDir, join(configDir, registration.modelsFile), `Profile ${registration.name} path`);
    const profileText = await readText(profilePath, relativePath);
    sourceText.set(relativePath, profileText);
    profileInputs[registration.name] = parseJsonObject(profileText, `Profile ${registration.name}`, profilePath);
  }
  const profiles = validateProfileSet(profileInputs, manifest);
  assertProfilesCoverManifest(profiles, manifest);
  return { manifest, profiles, sourceText };
}

async function loadCopyAssets(packageRoot: string): Promise<Map<string, string>> {
  const assets = new Map<string, string>();
  assets.set("extensions/sdd-model-profiles.ts", await readText(join(packageRoot, "extensions", "sdd-model-profiles.ts"), "extensions/sdd-model-profiles.ts"));
  for (const helper of helperFiles) {
    const relativePath = `extensions/model-profiles/${helper}`;
    assets.set(relativePath, await readText(join(packageRoot, "extensions", "model-profiles", helper), relativePath));
  }
  return assets;
}

function serialized(value: JsonObject): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function assertRuntimeBase(runtime: JsonObject | undefined, runtimePath: string): JsonObject {
  if (!runtime) return {};
  if (runtime.model_profiles !== undefined && !isJsonObject(runtime.model_profiles)) {
    fail(`${runtimePath}.model_profiles must be a JSON object before it can be merged.`);
  }
  return runtime;
}

function planInstall(options: {
  piHome: string;
  registry: Registry;
  copyAssets: Map<string, string>;
  canonicalBase?: JsonObject;
  runtimeBase?: JsonObject;
}): Plan[] {
  const gentleDir = join(options.piHome, "gentle-ai");
  const extensionDir = join(options.piHome, "agent", "extensions");
  const defaultProfile = options.registry.profiles[options.registry.manifest.defaultProfile];
  if (!defaultProfile) fail(`Default profile '${options.registry.manifest.defaultProfile}' is not available.`);

  const canonical = { ...(options.canonicalBase ?? {}), ...deriveCanonicalProfile(defaultProfile, options.registry.manifest) };
  const runtime = deriveRuntimeConfig(defaultProfile, options.registry.manifest, assertRuntimeBase(options.runtimeBase, join(options.piHome, "agent", "subagents.json")));

  const plans: Plan[] = [
    { path: join(gentleDir, "model-profiles.manifest.json"), content: options.registry.sourceText.get("config/model-profiles.manifest.json")!, mode: configMode },
    { path: join(gentleDir, "models.json"), content: serialized(canonical), mode: configMode },
    { path: join(options.piHome, "agent", "subagents.json"), content: serialized(runtime), mode: configMode },
    { path: join(extensionDir, "sdd-model-profiles.ts"), content: options.copyAssets.get("extensions/sdd-model-profiles.ts")!, mode: extensionMode },
  ];

  for (const registration of options.registry.manifest.profiles) {
    plans.push({ path: join(gentleDir, registration.modelsFile), content: options.registry.sourceText.get(`config/${registration.modelsFile}`)!, mode: configMode });
  }
  for (const helper of helperFiles) {
    plans.push({ path: join(extensionDir, "model-profiles", helper), content: options.copyAssets.get(`extensions/model-profiles/${helper}`)!, mode: extensionMode });
  }
  return plans;
}

async function assertNoUnresolvedTransaction(piHome: string): Promise<void> {
  const journalDir = join(piHome, "gentle-ai", ".model-profiles-transactions");
  if (!await exists(journalDir)) return;
  const activePath = join(journalDir, "active.json");
  const lockPath = join(journalDir, "lock.json");
  if (await exists(activePath)) {
    fail("Model profile transaction state is unresolved; run /jb-sdd-odd-models recover before installing.");
  }
  if (await exists(lockPath)) {
    fail("Model profile transaction lock is present; wait for the switch/undo process or run recover before installing.");
  }
}

async function atomicWrite(path: string, content: string, mode: number): Promise<void> {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temp = join(dirname(path), `.${basename(path)}.${process.pid}.${Date.now()}.${Math.random().toString(16).slice(2)}.tmp`);
  let handle;
  try {
    handle = await open(temp, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY, mode);
    await handle.writeFile(content, "utf8");
    await handle.sync();
    await handle.close();
    handle = undefined;
    await rename(temp, path);
    await chmod(path, mode);
  } catch (error) {
    await handle?.close().catch(() => undefined);
    throw error;
  }
}

async function changedPlans(plans: Plan[]): Promise<Array<Plan & { existed: boolean }>> {
  const changed: Array<Plan & { existed: boolean }> = [];
  for (const plan of plans) {
    let current: string | undefined;
    try {
      current = await readFile(plan.path, "utf8");
    } catch (error) {
      const code = isJsonObject(error) && typeof error.code === "string" ? error.code : "";
      if (code !== "ENOENT") throw error;
    }
    if (current !== plan.content) changed.push({ ...plan, existed: current !== undefined });
  }
  return changed;
}

async function backupChanged(piHome: string, changed: Array<Plan & { existed: boolean }>): Promise<string | undefined> {
  const existing = changed.filter((plan) => plan.existed);
  if (!existing.length) return undefined;
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backupRoot = join(piHome, "backups", `jb-sdd-odd-models-${stamp}-${process.pid}`);
  for (const plan of existing) {
    const rel = relative(piHome, plan.path);
    if (rel.startsWith("..") || rel === "") fail(`Refusing to back up path outside PI_HOME: ${plan.path}`);
    const backup = join(backupRoot, rel);
    await mkdir(dirname(backup), { recursive: true, mode: 0o700 });
    await copyFile(plan.path, backup);
  }
  await writeFile(join(backupRoot, "RESTORE.txt"), "Copy the saved files back to the same relative paths under PI_HOME. Files absent from this backup were created by the installer.\n", "utf8");
  return backupRoot;
}

async function validatePiHome(piHome: string): Promise<void> {
  const agent = join(piHome, "agent");
  const info = await stat(agent).catch((error) => {
    const code = isJsonObject(error) && typeof error.code === "string" ? error.code : "";
    if (code === "ENOENT") fail(`Pi agent directory not found at ${agent}. Install Gentle Pi first, or set PI_HOME to its Pi home.`);
    throw error;
  });
  if (!info.isDirectory()) fail(`Pi agent path is not a directory: ${agent}`);
}

export async function installModelProfiles(input: InstallOptions = {}): Promise<InstallResult> {
  const packageRoot = resolve(input.packageRoot ?? join(dirname(fileURLToPath(import.meta.url)), ".."));
  const piHome = resolve(input.piHome ?? process.env.PI_HOME ?? join(process.env.HOME ?? "", ".pi"));
  if (!piHome || piHome === resolve(".pi")) fail("Neither HOME nor PI_HOME is set. Set one before installing.");
  const log = input.log ?? console.log;

  await validatePiHome(piHome);
  const registry = await loadRegistry(packageRoot);
  const copyAssets = await loadCopyAssets(packageRoot);
  await assertNoUnresolvedTransaction(piHome);

  const canonicalPath = join(piHome, "gentle-ai", "models.json");
  const runtimePath = join(piHome, "agent", "subagents.json");
  const canonicalBase = await readOptionalJson(canonicalPath, "Active canonical profile");
  const runtimeBase = await readOptionalJson(runtimePath, "Runtime configuration");
  const plans = planInstall({ piHome, registry, copyAssets, canonicalBase, runtimeBase });
  for (const plan of plans) assertInside(piHome, plan.path, "Install target");

  const changed = await changedPlans(plans);
  if (!changed.length) {
    log(`jb-sdd-odd-models is already installed in ${piHome}; no files changed.`);
    return { changed: false, changedFiles: [] };
  }

  const backupRoot = await backupChanged(piHome, changed);
  for (const plan of changed) await atomicWrite(plan.path, plan.content, plan.mode);

  log(`Installed jb-sdd-odd-models into ${piHome}.`);
  if (backupRoot) log(`Backups: ${backupRoot}`);
  log("Restart Pi, then run /jb-sdd-odd-models status.");
  return { changed: true, backupRoot, changedFiles: changed.map((plan) => plan.path) };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  installModelProfiles({ packageRoot: process.env.PACKAGE_ROOT, piHome: process.env.PI_HOME }).catch((error) => {
    console.error(`jb-sdd-odd-models installer: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  });
}
