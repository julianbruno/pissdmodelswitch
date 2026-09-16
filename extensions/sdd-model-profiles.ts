import { readFile, rename, unlink, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

type ProfileName = "openai" | "grok";
type CanonicalEntry = { model: string; thinking: string };
type RuntimeEntry = { model: string; effort: string };
type JsonObject = Record<string, unknown>;

const SDD_AGENTS = [
  "sdd-init",
  "sdd-explore",
  "sdd-proposal",
  "sdd-spec",
  "sdd-design",
  "sdd-tasks",
  "sdd-onboard",
  "sdd-archive",
  "sdd-apply",
  "sdd-verify",
  "sdd-status",
  "sdd-sync",
] as const;

// Portability change: PI_HOME can relocate Pi's home; the canonical ~/.pi default is unchanged.
const piHome = process.env.PI_HOME || join(homedir(), ".pi");
const gentleDir = join(piHome, "gentle-ai");
const canonicalPath = join(gentleDir, "models.json");
const runtimePath = join(piHome, "agent", "subagents.json");
const profilePaths: Record<ProfileName, string> = {
  openai: join(gentleDir, "models.openai.json"),
  grok: join(gentleDir, "models.grok.json"),
};

function isObject(value: unknown): value is JsonObject {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

async function readJsonObject(path: string, label: string): Promise<JsonObject> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    throw new Error(`${label} is not valid JSON (${path}): ${error instanceof Error ? error.message : String(error)}`);
  }
  if (!isObject(parsed)) throw new Error(`${label} must contain a JSON object (${path}).`);
  return parsed;
}

function canonicalEntry(value: unknown, label: string): CanonicalEntry {
  if (!isObject(value) || typeof value.model !== "string" || typeof value.thinking !== "string") {
    throw new Error(`${label} must contain {model, thinking}.`);
  }
  return { model: value.model, thinking: value.thinking };
}

function runtimeEntry(value: unknown, label: string): RuntimeEntry {
  if (!isObject(value) || typeof value.model !== "string" || typeof value.effort !== "string") {
    throw new Error(`${label} must contain {model, effort}.`);
  }
  return { model: value.model, effort: value.effort };
}

function validateNamedProfile(value: JsonObject, name: ProfileName): Record<string, CanonicalEntry> {
  const expected = new Set<string>(SDD_AGENTS);
  const keys = Object.keys(value);
  if (keys.length !== SDD_AGENTS.length || keys.some((key) => !expected.has(key))) {
    throw new Error(`Profile ${name} must contain exactly the 12 SDD agents.`);
  }
  return Object.fromEntries(SDD_AGENTS.map((agent) => [agent, canonicalEntry(value[agent], `${name}.${agent}`)]));
}

function validateCanonical(value: JsonObject): void {
  for (const agent of SDD_AGENTS) canonicalEntry(value[agent], `models.json.${agent}`);
}

function runtimeProfiles(value: JsonObject): JsonObject {
  if (!isObject(value.model_profiles)) {
    throw new Error("subagents.json.model_profiles must be a JSON object.");
  }
  for (const agent of SDD_AGENTS) runtimeEntry(value.model_profiles[agent], `model_profiles.${agent}`);
  return value.model_profiles;
}

function sameCanonical(actual: JsonObject, expected: Record<string, CanonicalEntry>): boolean {
  return SDD_AGENTS.every((agent) => {
    const entry = canonicalEntry(actual[agent], `models.json.${agent}`);
    return entry.model === expected[agent].model && entry.thinking === expected[agent].thinking;
  });
}

function sameRuntime(actual: JsonObject, expected: Record<string, CanonicalEntry>): boolean {
  return SDD_AGENTS.every((agent) => {
    const entry = runtimeEntry(actual[agent], `model_profiles.${agent}`);
    return entry.model === expected[agent].model && entry.effort === expected[agent].thinking;
  });
}

async function loadKnownProfiles(): Promise<Record<ProfileName, Record<string, CanonicalEntry>>> {
  return {
    openai: validateNamedProfile(await readJsonObject(profilePaths.openai, "OpenAI profile"), "openai"),
    grok: validateNamedProfile(await readJsonObject(profilePaths.grok, "Grok profile"), "grok"),
  };
}

async function statusText(includeUsage = false): Promise<string> {
  const usage = "Usage: /sdd-models status|openai|grok";
  try {
    const profiles = await loadKnownProfiles();
    const canonical = await readJsonObject(canonicalPath, "Active canonical profile");
    validateCanonical(canonical);
    const runtime = await readJsonObject(runtimePath, "Runtime configuration");
    const activeRuntime = runtimeProfiles(runtime);

    let state: ProfileName | "custom" = "custom";
    for (const name of ["openai", "grok"] as const) {
      if (sameCanonical(canonical, profiles[name]) && sameRuntime(activeRuntime, profiles[name])) state = name;
    }

    const mapping = SDD_AGENTS.map((agent) => {
      const source = canonicalEntry(canonical[agent], `models.json.${agent}`);
      const live = runtimeEntry(activeRuntime[agent], `model_profiles.${agent}`);
      const drift = source.model === live.model && source.thinking === live.effort ? "" : " [misaligned]";
      return `${agent}: ${source.model} (${source.thinking})${drift}`;
    });
    return [includeUsage ? usage : "", `Active SDD profile: ${state}`, ...mapping].filter(Boolean).join("\n");
  } catch (error) {
    return [includeUsage ? usage : "", "Active SDD profile: unknown", error instanceof Error ? error.message : String(error)]
      .filter(Boolean)
      .join("\n");
  }
}

function serialized(value: JsonObject): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

async function stageWrite(path: string, content: string): Promise<string> {
  const temp = join(dirname(path), `.${path.split("/").pop()}.${process.pid}.${Date.now()}.${Math.random().toString(16).slice(2)}.tmp`);
  await writeFile(temp, content, { encoding: "utf8", flag: "wx", mode: 0o600 });
  return temp;
}

async function discardTemp(path: string | undefined): Promise<void> {
  if (!path) return;
  try {
    await unlink(path);
  } catch {
    // Best effort: a successful rename already removed the temporary path.
  }
}

async function restore(path: string, original: string): Promise<void> {
  const temp = await stageWrite(path, original);
  try {
    await rename(temp, path);
  } finally {
    await discardTemp(temp);
  }
}

async function switchProfile(name: ProfileName): Promise<void> {
  const profiles = await loadKnownProfiles();
  const selected = profiles[name];

  const [canonicalOriginal, runtimeOriginal] = await Promise.all([
    readFile(canonicalPath, "utf8"),
    readFile(runtimePath, "utf8"),
  ]);
  const canonical = await readJsonObject(canonicalPath, "Active canonical profile");
  validateCanonical(canonical);
  const runtime = await readJsonObject(runtimePath, "Runtime configuration");
  const currentRuntimeProfiles = runtimeProfiles(runtime);

  const nextCanonical: JsonObject = { ...canonical };
  const nextRuntimeProfiles: JsonObject = { ...currentRuntimeProfiles };
  for (const agent of SDD_AGENTS) {
    nextCanonical[agent] = { ...selected[agent] };
    nextRuntimeProfiles[agent] = { model: selected[agent].model, effort: selected[agent].thinking };
  }
  const nextRuntime: JsonObject = { ...runtime, model_profiles: nextRuntimeProfiles };

  let canonicalTemp: string | undefined;
  let runtimeTemp: string | undefined;
  let canonicalReplaced = false;
  let runtimeReplaced = false;
  try {
    canonicalTemp = await stageWrite(canonicalPath, serialized(nextCanonical));
    runtimeTemp = await stageWrite(runtimePath, serialized(nextRuntime));
    await rename(canonicalTemp, canonicalPath);
    canonicalReplaced = true;
    canonicalTemp = undefined;
    await rename(runtimeTemp, runtimePath);
    runtimeReplaced = true;
    runtimeTemp = undefined;
  } catch (error) {
    const rollbackErrors: string[] = [];
    if (runtimeReplaced) {
      try { await restore(runtimePath, runtimeOriginal); } catch (rollbackError) { rollbackErrors.push(`runtime: ${String(rollbackError)}`); }
    }
    if (canonicalReplaced) {
      try { await restore(canonicalPath, canonicalOriginal); } catch (rollbackError) { rollbackErrors.push(`canonical: ${String(rollbackError)}`); }
    }
    const suffix = rollbackErrors.length ? ` Rollback incomplete (${rollbackErrors.join("; ")}).` : " Replaced files were restored.";
    throw new Error(`Could not activate ${name}: ${error instanceof Error ? error.message : String(error)}.${suffix}`);
  } finally {
    await Promise.all([discardTemp(canonicalTemp), discardTemp(runtimeTemp)]);
  }
}

export default function sddModelProfiles(pi: ExtensionAPI): void {
  pi.registerCommand("sdd-models", {
    description: "Show or change the global SDD model profile (status|openai|grok).",
    getArgumentCompletions: (prefix: string) => {
      const normalized = prefix.trim().toLowerCase();
      const options = [
        { value: "status", label: "status — Show active profile and mapping" },
        { value: "openai", label: "openai — Activate OpenAI Codex" },
        { value: "grok", label: "grok — Activate xAI Grok" },
      ].filter(({ value }) => value.startsWith(normalized));
      return options.length ? options : null;
    },
    handler: async (args, ctx) => {
      const action = String(args ?? "").trim().toLowerCase();
      if (action === "" || action === "status") {
        ctx.ui.notify(await statusText(action === ""), "info");
        return;
      }
      if (action !== "openai" && action !== "grok") {
        ctx.ui.notify(`Unknown argument: ${action}\nUsage: /sdd-models status|openai|grok`, "warning");
        return;
      }
      try {
        await switchProfile(action);
      } catch (error) {
        ctx.ui.notify(error instanceof Error ? error.message : String(error), "error");
        return;
      }

      ctx.ui.notify(`SDD ${action} profile activated. Reloading Pi...`, "info");
      try {
        await ctx.reload();
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        ctx.ui.notify(
          `Reload failed (${detail}), but the ${action} profile files remain active. Run /reload manually or restart Pi.`,
          "error",
        );
      }
    },
  });
}
