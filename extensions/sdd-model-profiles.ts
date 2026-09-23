import { readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve, sep } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import {
  deriveCanonicalProfileForSelection,
  deriveRuntimeConfigForSelection,
  deriveRuntimeModelProfilesForSelection,
  isJsonObject,
  managedAgents,
  registeredProfileNames,
  validateManifest,
  validateProfileSet,
  type JsonObject,
  type ModelEffort,
  type ModelProfileEntry,
  type ModelProfilesManifest,
  type RuntimeModelProfileEntry,
  type ValidatedModelProfile,
} from "./model-profiles/core.ts";
import {
  inspectModelProfileTransactions,
  recoverModelProfileTransaction,
  runModelProfileTransaction,
  undoLastModelProfileTransaction,
  type ModelProfileTransactionTargets,
} from "./model-profiles/transaction.ts";

export type ModelProfileExtensionOptions = {
  piHome?: string;
  gentleDir?: string;
  canonicalPath?: string;
  runtimePath?: string;
  manifestPath?: string;
};

type ResolvedPaths = {
  piHome: string;
  gentleDir: string;
  canonicalPath: string;
  runtimePath: string;
  manifestPath: string;
};

type ProfileRegistry = {
  manifest: ModelProfilesManifest;
  profiles: Record<string, ValidatedModelProfile>;
};

type ProfileRuntimeState = {
  canonical: JsonObject;
  runtime: JsonObject;
  canonicalEntries: Partial<Record<string, ModelProfileEntry>>;
  runtimeEntries: Partial<Record<string, RuntimeModelProfileEntry>>;
};

const COMMAND_NAME = "jb-sdd-odd-models";
const STATIC_ACTIONS = ["status", "list", "preview", "doctor", "undo", "recover"] as const;
const providerModelPattern = /^[^/\s]+\/[^/\s]+$/;
const hasOwn = Object.prototype.hasOwnProperty;

function hasOwnKey(value: JsonObject, key: string): boolean {
  return hasOwn.call(value, key);
}

function resolvePaths(options: ModelProfileExtensionOptions = {}): ResolvedPaths {
  const piHome = resolve(options.piHome ?? process.env.PI_HOME ?? join(homedir(), ".pi"));
  const gentleDir = resolve(options.gentleDir ?? join(piHome, "gentle-ai"));
  return {
    piHome,
    gentleDir,
    canonicalPath: resolve(options.canonicalPath ?? join(gentleDir, "models.json")),
    runtimePath: resolve(options.runtimePath ?? join(piHome, "agent", "subagents.json")),
    manifestPath: resolve(options.manifestPath ?? join(gentleDir, "model-profiles.manifest.json")),
  };
}

function assertWithin(root: string, candidate: string, label: string): string {
  const resolvedRoot = resolve(root);
  const resolvedCandidate = resolve(candidate);
  if (resolvedCandidate !== resolvedRoot && !resolvedCandidate.startsWith(`${resolvedRoot}${sep}`)) {
    throw new Error(`${label} must stay inside ${resolvedRoot}.`);
  }
  return resolvedCandidate;
}

function profilePath(paths: ResolvedPaths, modelsFile: string, profileName: string): string {
  if (modelsFile !== `models.${profileName}.json`) {
    throw new Error(`Profile ${profileName} modelsFile must be models.${profileName}.json.`);
  }
  return assertWithin(paths.gentleDir, join(paths.gentleDir, modelsFile), `Profile ${profileName} path`);
}

function parseJsonObject(text: string, label: string, path: string): JsonObject {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    throw new Error(`${label} is not valid JSON (${path}): ${error instanceof Error ? error.message : String(error)}`);
  }
  if (!isJsonObject(parsed)) throw new Error(`${label} must contain a JSON object (${path}).`);
  return parsed;
}

async function readJsonObject(path: string, label: string): Promise<JsonObject> {
  return parseJsonObject(await readFile(path, "utf8"), label, path);
}

function readJsonObjectSync(path: string, label: string): JsonObject {
  return parseJsonObject(readFileSync(path, "utf8"), label, path);
}

async function loadRegistry(paths: ResolvedPaths): Promise<ProfileRegistry> {
  const manifest = validateManifest(await readJsonObject(assertWithin(paths.gentleDir, paths.manifestPath, "Manifest path"), "Model profile manifest"));
  const profileInputs: JsonObject = Object.create(null);
  for (const registration of manifest.profiles) {
    profileInputs[registration.name] = await readJsonObject(
      profilePath(paths, registration.modelsFile, registration.name),
      `Profile ${registration.name}`,
    );
  }
  return { manifest, profiles: validateProfileSet(profileInputs, manifest) };
}

function loadManifestForCompletions(paths: ResolvedPaths): ModelProfilesManifest | undefined {
  try {
    return validateManifest(readJsonObjectSync(assertWithin(paths.gentleDir, paths.manifestPath, "Manifest path"), "Model profile manifest"));
  } catch {
    return undefined;
  }
}

function exactKeys(value: JsonObject, expected: readonly string[], label: string): void {
  const keys = Object.keys(value);
  const missing = expected.filter((key) => !hasOwnKey(value, key));
  const extra = keys.filter((key) => !expected.includes(key));
  if (missing.length || extra.length || keys.length !== expected.length) {
    const details = [
      missing.length ? `missing: ${missing.join(", ")}` : "",
      extra.length ? `extra: ${extra.join(", ")}` : "",
    ].filter(Boolean).join("; ");
    throw new Error(`${label} must contain exactly ${expected.length} expected keys${details ? ` (${details})` : ""}.`);
  }
}

function validateModel(value: unknown, label: string): string {
  if (typeof value !== "string" || value !== value.trim() || !providerModelPattern.test(value)) {
    throw new Error(`${label} must be a non-empty provider/model identifier.`);
  }
  return value;
}

function validateEffort(value: unknown, label: string): ModelEffort {
  if (typeof value !== "string" || !value || value !== value.trim()) {
    throw new Error(`${label} must be a non-empty, trimmed string.`);
  }
  return value;
}

function validateCanonicalEntry(value: unknown, label: string): ModelProfileEntry {
  if (!isJsonObject(value)) throw new Error(`${label} must be a JSON object.`);
  exactKeys(value, ["model", "thinking"], label);
  return {
    model: validateModel(value.model, `${label}.model`),
    thinking: validateEffort(value.thinking, `${label}.thinking`),
  };
}

function validateRuntimeEntry(value: unknown, label: string): RuntimeModelProfileEntry {
  if (!isJsonObject(value)) throw new Error(`${label} must be a JSON object.`);
  exactKeys(value, ["model", "effort"], label);
  return {
    model: validateModel(value.model, `${label}.model`),
    effort: validateEffort(value.effort, `${label}.effort`),
  };
}

function validateActiveState(
  canonical: JsonObject,
  runtime: JsonObject,
  manifest: ModelProfilesManifest,
  options: { allowMissingManagedEntries: boolean },
): ProfileRuntimeState {
  const agents = managedAgents(manifest);
  const canonicalEntries: Partial<Record<string, ModelProfileEntry>> = Object.create(null);
  const runtimeEntries: Partial<Record<string, RuntimeModelProfileEntry>> = Object.create(null);

  if (!isJsonObject(runtime.model_profiles)) {
    throw new Error("subagents.json.model_profiles must be a JSON object.");
  }

  for (const agent of agents) {
    if (hasOwnKey(canonical, agent)) {
      canonicalEntries[agent] = validateCanonicalEntry(canonical[agent], `models.json.${agent}`);
    } else if (!options.allowMissingManagedEntries) {
      throw new Error(`models.json.${agent} is missing.`);
    }

    if (hasOwnKey(runtime.model_profiles, agent)) {
      runtimeEntries[agent] = validateRuntimeEntry(runtime.model_profiles[agent], `model_profiles.${agent}`);
    } else if (!options.allowMissingManagedEntries) {
      throw new Error(`model_profiles.${agent} is missing.`);
    }
  }

  return { canonical, runtime, canonicalEntries, runtimeEntries };
}

async function readActiveState(paths: ResolvedPaths, manifest: ModelProfilesManifest, allowMissingManagedEntries: boolean): Promise<ProfileRuntimeState> {
  const [canonical, runtime] = await Promise.all([
    readJsonObject(paths.canonicalPath, "Active canonical profile"),
    readJsonObject(paths.runtimePath, "Runtime configuration"),
  ]);
  return validateActiveState(canonical, runtime, manifest, { allowMissingManagedEntries });
}

function runtimeProfilesObject(runtime: JsonObject): JsonObject {
  if (!isJsonObject(runtime.model_profiles)) throw new Error("subagents.json.model_profiles must be a JSON object.");
  return runtime.model_profiles;
}

function selectedProfile(registry: ProfileRegistry, name: string): ValidatedModelProfile | undefined {
  return hasOwnKey(registry.profiles, name) ? registry.profiles[name] : undefined;
}

function usage(manifest?: ModelProfilesManifest): string {
  const profilePart = manifest ? registeredProfileNames(manifest).join("|") : "<profile>";
  return `Usage: /${COMMAND_NAME} status|list|preview <profile>|doctor|undo|recover|${profilePart}`;
}

function formatCanonicalEntry(entry: ModelProfileEntry | undefined): string {
  return entry ? `${entry.model} (${entry.thinking})` : "(missing)";
}

function formatRuntimeEntry(entry: RuntimeModelProfileEntry | undefined): string {
  return entry ? `${entry.model} (${entry.effort})` : "(missing)";
}

function profileMatchesState(state: ProfileRuntimeState, profile: ValidatedModelProfile, manifest: ModelProfilesManifest): boolean {
  for (const agent of managedAgents(manifest)) {
    const canonical = state.canonicalEntries[agent];
    const runtime = state.runtimeEntries[agent];
    const expected = profile[agent];
    if (!canonical || !runtime) return false;
    if (canonical.model !== expected.model || canonical.thinking !== expected.thinking) return false;
    if (runtime.model !== expected.model || runtime.effort !== expected.thinking) return false;
  }
  return true;
}

async function statusText(paths: ResolvedPaths, includeUsage = false): Promise<string> {
  let manifest: ModelProfilesManifest | undefined;
  try {
    const registry = await loadRegistry(paths);
    manifest = registry.manifest;
    const state = await readActiveState(paths, registry.manifest, false);

    let active = "custom";
    for (const name of registeredProfileNames(registry.manifest)) {
      const profile = selectedProfile(registry, name);
      if (profile && profileMatchesState(state, deriveCanonicalProfileForSelection(name, registry.profiles, registry.manifest), registry.manifest)) active = name;
    }

    const mapping = managedAgents(registry.manifest).map((agent) => {
      const source = state.canonicalEntries[agent]!;
      const live = state.runtimeEntries[agent]!;
      const drift = source.model === live.model && source.thinking === live.effort ? "" : " [misaligned]";
      return `${agent}: ${source.model} (${source.thinking})${drift}`;
    });
    return [includeUsage ? usage(registry.manifest) : "", `Active SDD/ODD profile: ${active}`, ...mapping].filter(Boolean).join("\n");
  } catch (error) {
    return [includeUsage ? usage(manifest) : "", "Active SDD/ODD profile: unknown", error instanceof Error ? error.message : String(error)]
      .filter(Boolean)
      .join("\n");
  }
}

function listText(registry: ProfileRegistry): string {
  const lines = ["Registered SDD/ODD profiles:"];
  for (const name of registeredProfileNames(registry.manifest)) {
    lines.push(`- ${name}${name === registry.manifest.defaultProfile ? " (default)" : ""}`);
  }
  return lines.join("\n");
}

async function previewText(paths: ResolvedPaths, name: string): Promise<string> {
  const registry = await loadRegistry(paths);
  const profile = selectedProfile(registry, name);
  if (!profile) return `Unknown profile: ${name}\n${usage(registry.manifest)}`;

  const state = await readActiveState(paths, registry.manifest, true);
  const nextProfile = deriveCanonicalProfileForSelection(name, registry.profiles, registry.manifest);
  const nextRuntimeProfiles = deriveRuntimeModelProfilesForSelection(name, registry.profiles, registry.manifest);
  const lines = [`Preview SDD/ODD profile: ${name}`, "No files will be written."];
  for (const agent of managedAgents(registry.manifest)) {
    const afterCanonical = nextProfile[agent];
    const afterRuntime = nextRuntimeProfiles[agent];
    lines.push(
      `${agent}: canonical ${formatCanonicalEntry(state.canonicalEntries[agent])} -> ${formatCanonicalEntry(afterCanonical)}; runtime ${formatRuntimeEntry(state.runtimeEntries[agent])} -> ${formatRuntimeEntry(afterRuntime)}`,
    );
  }
  return lines.join("\n");
}

type DoctorCommandContext = {
  cwd?: string;
  modelRegistry?: {
    find(provider: string, modelId: string): unknown;
    getProviderAuthStatus?(provider: string): { configured: boolean; source?: string; label?: string };
    getProviderDisplayName?(provider: string): string;
  };
  model?: { provider: string; id: string };
  thinkingLevel?: string;
};

type DoctorActiveState = ProfileRuntimeState & {
  diagnostics: string[];
  valid: boolean;
  unrelatedRuntimeMappings: string[];
};

function inspectActiveStateForDoctor(canonical: JsonObject, runtime: JsonObject, manifest: ModelProfilesManifest): DoctorActiveState {
  const agents = managedAgents(manifest);
  const managed = new Set(agents);
  const canonicalEntries: Partial<Record<string, ModelProfileEntry>> = Object.create(null);
  const runtimeEntries: Partial<Record<string, RuntimeModelProfileEntry>> = Object.create(null);
  const diagnostics: string[] = [];
  let valid = true;

  const runtimeProfiles = isJsonObject(runtime.model_profiles) ? runtime.model_profiles : undefined;
  if (!runtimeProfiles) {
    diagnostics.push("subagents.json.model_profiles must be a JSON object.");
    valid = false;
  }

  for (const agent of agents) {
    if (hasOwnKey(canonical, agent)) {
      try {
        canonicalEntries[agent] = validateCanonicalEntry(canonical[agent], `models.json.${agent}`);
      } catch (error) {
        diagnostics.push(error instanceof Error ? error.message : String(error));
        valid = false;
      }
    } else {
      diagnostics.push(`models.json.${agent} is missing.`);
      valid = false;
    }

    if (runtimeProfiles && hasOwnKey(runtimeProfiles, agent)) {
      try {
        runtimeEntries[agent] = validateRuntimeEntry(runtimeProfiles[agent], `model_profiles.${agent}`);
      } catch (error) {
        diagnostics.push(error instanceof Error ? error.message : String(error));
        valid = false;
      }
    } else {
      diagnostics.push(`model_profiles.${agent} is missing.`);
      valid = false;
    }
  }

  const unrelatedRuntimeMappings = runtimeProfiles ? Object.keys(runtimeProfiles).filter((key) => !managed.has(key)).sort() : [];
  return { canonical, runtime, canonicalEntries, runtimeEntries, diagnostics, valid, unrelatedRuntimeMappings };
}

function splitModelIdentifier(identifier: string): { provider: string; modelId: string } | undefined {
  const separator = identifier.indexOf("/");
  if (separator <= 0 || separator === identifier.length - 1) return undefined;
  return { provider: identifier.slice(0, separator), modelId: identifier.slice(separator + 1) };
}

function supportsEffort(model: unknown, effort: ModelEffort): boolean {
  if (!isJsonObject(model) || model.reasoning !== true) return false;
  const map = isJsonObject(model.thinkingLevelMap) ? model.thinkingLevelMap : undefined;
  if (map && hasOwnKey(map, effort) && map[effort] === null) return false;
  // Preserve baseline diagnostics; extended/model-specific levels require explicit evidence.
  if (effort === "low" || effort === "medium" || effort === "high") return true;
  return !!map && hasOwnKey(map, effort) && map[effort] !== null && map[effort] !== undefined;
}

async function doctorText(paths: ResolvedPaths, ctx: DoctorCommandContext): Promise<{ text: string; level: "info" | "warning" }> {
  const info: string[] = [];
  const issues: string[] = [];
  let registry: ProfileRegistry | undefined;
  let state: DoctorActiveState | undefined;

  try {
    registry = await loadRegistry(paths);
  } catch (error) {
    issues.push(`Registered profile issue: ${error instanceof Error ? error.message : String(error)}`);
  }

  if (registry) {
    try {
      const [canonical, runtime] = await Promise.all([
        readJsonObject(paths.canonicalPath, "Active canonical profile"),
        readJsonObject(paths.runtimePath, "Runtime configuration"),
      ]);
      state = inspectActiveStateForDoctor(canonical, runtime, registry.manifest);
      issues.push(...state.diagnostics);

      let active = "unknown";
      if (state.valid) {
        active = "custom";
        for (const name of registeredProfileNames(registry.manifest)) {
          const profile = selectedProfile(registry, name);
          if (profile && profileMatchesState(state, deriveCanonicalProfileForSelection(name, registry.profiles, registry.manifest), registry.manifest)) active = name;
        }
      }
      info.push(`Active SDD/ODD profile: ${active}`);

      for (const agent of managedAgents(registry.manifest)) {
        const canonical = state.canonicalEntries[agent];
        const runtime = state.runtimeEntries[agent];
        if (canonical && runtime && (canonical.model !== runtime.model || canonical.thinking !== runtime.effort)) {
          issues.push(`Drift: ${agent} canonical ${canonical.model} (${canonical.thinking}) != runtime ${runtime.model} (${runtime.effort})`);
        }
      }

      if (state.unrelatedRuntimeMappings.length) {
        info.push(`Unrelated runtime mappings preserved: ${state.unrelatedRuntimeMappings.join(", ")}`);
      }
    } catch (error) {
      issues.push(`Active state issue: ${error instanceof Error ? error.message : String(error)}`);
      info.push("Active SDD/ODD profile: unknown");
    }
  } else {
    info.push("Active SDD/ODD profile: unknown");
  }

  try {
    const transaction = await inspectModelProfileTransactions(transactionTargets(paths));
    for (const diagnostic of transaction.diagnostics) {
      if (diagnostic.area === "active") issues.push(`Active transaction journal is malformed: ${diagnostic.message}`);
      if (diagnostic.area === "history") issues.push(`Transaction history is malformed: ${diagnostic.message}`);
    }
    if (transaction.active) info.push(`Transaction: active ${transaction.active.operation} ${transaction.active.phase}`);
    if (transaction.lock.state === "present") issues.push(`Transaction lock is present for pid ${transaction.lock.pid ?? "unknown"}; doctor will not reclaim it.`);
    if (transaction.lock.state === "ambiguous") issues.push(`Transaction lock is ambiguous: ${transaction.lock.reason}`);
  } catch (error) {
    issues.push(`Transaction inspection failed: ${error instanceof Error ? error.message : String(error)}`);
  }

  const registryApi = ctx.modelRegistry;
  if (!registryApi) {
    info.push("Pi model registry unavailable; catalog, auth, and effort checks skipped.");
    info.push("Doctor cannot establish provider authentication or execution from files alone.");
  } else if (registry && state) {
    const providers = new Set<string>();
    const seenModels = new Set<string>();
    for (const agent of managedAgents(registry.manifest)) {
      const entry = state.runtimeEntries[agent] ?? (state.canonicalEntries[agent] ? { model: state.canonicalEntries[agent]!.model, effort: state.canonicalEntries[agent]!.thinking } : undefined);
      if (!entry || seenModels.has(`${entry.model}#${entry.effort}`)) continue;
      seenModels.add(`${entry.model}#${entry.effort}`);
      const parsed = splitModelIdentifier(entry.model);
      if (!parsed) continue;
      providers.add(parsed.provider);
      const model = registryApi.find(parsed.provider, parsed.modelId);
      if (!model) {
        issues.push(`Catalog: ${entry.model} is not in the effective local catalog; this is a bounded local diagnostic, not proof remote unavailable.`);
        continue;
      }
      if (supportsEffort(model, entry.effort)) {
        info.push(`Catalog: ${entry.model} found, effort ${entry.effort} compatible.`);
      } else {
        issues.push(`Effort: ${entry.model} does not advertise ${entry.effort} support in the effective local catalog.`);
      }
    }

    if (providers.size && registryApi.getProviderAuthStatus) {
      for (const provider of [...providers].sort()) {
        const status = registryApi.getProviderAuthStatus(provider);
        if (status.configured) {
          info.push(`Provider auth: ${provider} configured${status.source ? ` (${status.source})` : ""}.`);
        } else {
          issues.push(`Provider auth: ${provider} is not configured in the effective session; this does not prove remote unavailable.`);
        }
      }
    } else {
      info.push("Provider auth status API unavailable; auth checks skipped.");
    }
  }

  if (ctx.model) info.push(`Current Pi session model: ${ctx.model.provider}/${ctx.model.id}${ctx.thinkingLevel ? ` (${ctx.thinkingLevel})` : ""}.`);
  info.push("Installed/global profile status does not prove effective project routing; project overrides and session registry scope can change the model catalog used by Pi.");
  info.push("Doctor cannot establish provider authentication or provider execution; it performs only local file, registry, and transaction inspection.");
  info.push("Doctor is read-only; no files were repaired or reclaimed.");

  const header = issues.length ? "Doctor summary: issues found" : "Doctor summary: no blocking errors";
  const text = [header, ...issues.map((line) => `ERROR: ${line}`), ...info].join("\n");
  return { text, level: issues.length ? "warning" : "info" };
}

function serialized(value: JsonObject): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function transactionTargets(paths: ResolvedPaths): ModelProfileTransactionTargets {
  return {
    canonicalPath: paths.canonicalPath,
    runtimePath: paths.runtimePath,
    journalDir: join(paths.gentleDir, ".model-profiles-transactions"),
  };
}

function assertNoTransactionHazardForNoop(inspection: Awaited<ReturnType<typeof inspectModelProfileTransactions>>): void {
  if (inspection.active) throw new Error("A model profile transaction is already active; run recover before starting another mutation.");
  if (inspection.lock.state === "present") {
    const owner = inspection.lock.pid === undefined ? "an unknown pid" : `pid ${inspection.lock.pid}`;
    throw new Error(`Model profile transaction lock is already held by ${owner}. Run recover only after that process exits.`);
  }
  if (inspection.lock.state === "ambiguous") throw new Error(`Model profile transaction lock is ambiguous: ${inspection.lock.reason}`);
  const diagnostic = inspection.diagnostics[0];
  if (diagnostic) throw new Error(`Model profile transaction ${diagnostic.area} is ambiguous: ${diagnostic.message}`);
}

async function switchProfile(paths: ResolvedPaths, name: string): Promise<"changed" | "noop"> {
  const registry = await loadRegistry(paths);
  const profile = selectedProfile(registry, name);
  if (!profile) throw new Error(`Unknown profile: ${name}\n${usage(registry.manifest)}`);

  const targets = transactionTargets(paths);
  const preflightState = await readActiveState(paths, registry.manifest, true);
  const selectedCanonicalProfile = deriveCanonicalProfileForSelection(name, registry.profiles, registry.manifest);
  if (profileMatchesState(preflightState, selectedCanonicalProfile, registry.manifest)) {
    assertNoTransactionHazardForNoop(await inspectModelProfileTransactions(targets));
    return "noop";
  }

  return runModelProfileTransaction(targets, {
    operation: "switch",
    plan: ({ canonicalContent, runtimeContent }) => {
      const state = validateActiveState(
        parseJsonObject(canonicalContent, "Active canonical profile", paths.canonicalPath),
        parseJsonObject(runtimeContent, "Runtime configuration", paths.runtimePath),
        registry.manifest,
        { allowMissingManagedEntries: true },
      );

      const nextProfile = deriveCanonicalProfileForSelection(name, registry.profiles, registry.manifest);
      if (profileMatchesState(state, nextProfile, registry.manifest)) return null;

      const nextCanonical: JsonObject = { ...state.canonical, ...nextProfile };
      const nextRuntime = deriveRuntimeConfigForSelection(name, registry.profiles, registry.manifest, state.runtime);
      runtimeProfilesObject(nextRuntime);
      return { canonicalContent: serialized(nextCanonical), runtimeContent: serialized(nextRuntime) };
    },
  });
}

function completionItems(paths: ResolvedPaths, prefix: string): Array<{ value: string; label: string }> | null {
  const leftTrimmed = prefix.toLowerCase().replace(/^\s+/, "");
  const normalized = leftTrimmed.trim();
  const manifest = loadManifestForCompletions(paths);
  const profileNames = manifest ? registeredProfileNames(manifest) : [];

  if (leftTrimmed.startsWith("preview ")) {
    const profilePrefix = leftTrimmed.slice("preview ".length).trim();
    const previewItems = profileNames
      .filter((name) => name.startsWith(profilePrefix))
      .map((name) => ({ value: `preview ${name}`, label: `preview ${name} — Show before/after without writing` }));
    return previewItems.length ? previewItems : null;
  }

  const options = [
    { value: "status", label: "status — Show active profile and mapping" },
    { value: "list", label: "list — Show registered profiles" },
    { value: "preview", label: "preview <profile> — Show before/after without writing" },
    { value: "doctor", label: "doctor — Diagnose profile files, local catalog, and transaction state without writing" },
    { value: "undo", label: "undo — Revert the last completed profile transaction if files still match" },
    { value: "recover", label: "recover — Finish or clear an interrupted profile transaction" },
    ...profileNames.map((name) => ({ value: name, label: `${name} — Activate ${name} profile` })),
  ].filter(({ value }) => value.startsWith(normalized));
  return options.length ? options : null;
}

function parseArgs(args: string): { kind: "status" | "list" | "doctor" | "undo" | "recover" } | { kind: "preview" | "switch"; name: string } | { kind: "unknown"; value: string } {
  const tokens = String(args ?? "").trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return { kind: "status" };
  if (tokens.length === 1 && tokens[0] === "status") return { kind: "status" };
  if (tokens.length === 1 && tokens[0] === "list") return { kind: "list" };
  if (tokens.length === 1 && tokens[0] === "doctor") return { kind: "doctor" };
  if (tokens.length === 1 && tokens[0] === "undo") return { kind: "undo" };
  if (tokens.length === 1 && tokens[0] === "recover") return { kind: "recover" };
  if (tokens[0] === "preview" && tokens.length === 2) return { kind: "preview", name: tokens[1] };
  if (tokens[0] === "preview") return { kind: "unknown", value: tokens.join(" ") };
  if (tokens.length === 1 && !STATIC_ACTIONS.includes(tokens[0] as (typeof STATIC_ACTIONS)[number])) return { kind: "switch", name: tokens[0] };
  return { kind: "unknown", value: tokens.join(" ") };
}

export default function sddModelProfiles(pi: ExtensionAPI, options: ModelProfileExtensionOptions = {}): void {
  const paths = resolvePaths(options);

  pi.registerCommand(COMMAND_NAME, {
    description: "Show, preview, or change the global SDD/ODD model profile.",
    getArgumentCompletions: (prefix: string) => completionItems(paths, prefix),
    handler: async (args, ctx) => {
      const parsed = parseArgs(args);
      if (parsed.kind === "status") {
        ctx.ui.notify(await statusText(paths, String(args ?? "").trim() === ""), "info");
        return;
      }
      if (parsed.kind === "list") {
        try {
          ctx.ui.notify(listText(await loadRegistry(paths)), "info");
        } catch (error) {
          ctx.ui.notify(error instanceof Error ? error.message : String(error), "error");
        }
        return;
      }
      if (parsed.kind === "preview") {
        try {
          const text = await previewText(paths, parsed.name);
          ctx.ui.notify(text, text.startsWith("Unknown profile:") ? "warning" : "info");
        } catch (error) {
          ctx.ui.notify(error instanceof Error ? error.message : String(error), "error");
        }
        return;
      }
      if (parsed.kind === "doctor") {
        const result = await doctorText(paths, ctx as DoctorCommandContext);
        ctx.ui.notify(result.text, result.level);
        return;
      }
      if (parsed.kind === "undo") {
        try {
          await undoLastModelProfileTransaction(transactionTargets(paths));
          ctx.ui.notify("Last SDD/ODD model profile transaction undone. Reloading Pi...", "info");
        } catch (error) {
          ctx.ui.notify(error instanceof Error ? error.message : String(error), "error");
          return;
        }
        try {
          await ctx.reload();
        } catch (error) {
          const detail = error instanceof Error ? error.message : String(error);
          ctx.ui.notify(`Reload failed (${detail}), but the undo files remain active. Run /reload manually or restart Pi.`, "error");
        }
        return;
      }
      if (parsed.kind === "recover") {
        let result: Awaited<ReturnType<typeof recoverModelProfileTransaction>>;
        try {
          result = await recoverModelProfileTransaction(transactionTargets(paths));
        } catch (error) {
          ctx.ui.notify(error instanceof Error ? error.message : String(error), "error");
          return;
        }
        if (result === "none") {
          ctx.ui.notify("No model profile transaction needs recovery.", "info");
          return;
        }
        ctx.ui.notify(`Model profile transaction recovery ${result}. Reloading Pi...`, "info");
        try {
          await ctx.reload();
        } catch (error) {
          const detail = error instanceof Error ? error.message : String(error);
          ctx.ui.notify(`Reload failed (${detail}), but recovered profile files remain active. Run /reload manually or restart Pi.`, "error");
        }
        return;
      }
      if (parsed.kind === "unknown") {
        ctx.ui.notify(`Unknown argument: ${parsed.value}\n${usage(loadManifestForCompletions(paths))}`, "warning");
        return;
      }

      try {
        const result = await switchProfile(paths, parsed.name);
        if (result === "noop") {
          ctx.ui.notify(`SDD/ODD ${parsed.name} profile is already active; no reload needed.`, "info");
          return;
        }
      } catch (error) {
        ctx.ui.notify(error instanceof Error ? error.message : String(error), "error");
        return;
      }

      ctx.ui.notify(`SDD/ODD ${parsed.name} profile activated. Reloading Pi...`, "info");
      try {
        await ctx.reload();
        return;
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        ctx.ui.notify(
          `Reload failed (${detail}), but the ${parsed.name} profile files remain active. Run /reload manually or restart Pi.`,
          "error",
        );
      }
    },
  });
}
