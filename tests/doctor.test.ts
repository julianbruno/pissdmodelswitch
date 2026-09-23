import assert from "node:assert/strict";
import { constants } from "node:fs";
import { access, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";

import sddModelProfiles from "../extensions/sdd-model-profiles.ts";

type RegisteredCommand = {
  description: string;
  getArgumentCompletions?: (prefix: string) => Array<{ value: string; label?: string }> | null;
  handler: (args: string, ctx: FakeCommandContext) => Promise<void> | void;
};

type FakeCommandContext = {
  cwd: string;
  ui: { notify(message: string, level: string): void };
  reload(): Promise<void>;
  modelRegistry?: {
    find(provider: string, modelId: string): any;
    getProviderAuthStatus(provider: string): { configured: boolean; source?: string; label?: string };
    getProviderDisplayName?(provider: string): string;
  };
  model?: { provider: string; id: string };
  thinkingLevel?: string;
};

const agents = ["sdd-init", "sdd-explore", "sdd-research", "gentle-ai-worker"];

function profile(modelPrefix: string, effort = "high"): Record<string, { model: string; thinking: string }> {
  return Object.fromEntries(agents.map((agent) => [agent, { model: `${modelPrefix}/${agent}`, thinking: effort }]));
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

async function readJson(path: string): Promise<any> {
  return JSON.parse(await readFile(path, "utf8"));
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function snapshot(paths: string[]): Promise<Map<string, { content?: string; mtimeMs?: number; exists: boolean }>> {
  const result = new Map<string, { content?: string; mtimeMs?: number; exists: boolean }>();
  for (const path of paths) {
    if (!await exists(path)) {
      result.set(path, { exists: false });
      continue;
    }
    const info = await stat(path);
    result.set(path, { exists: true, mtimeMs: info.mtimeMs, content: info.isFile() ? await readFile(path, "utf8") : undefined });
  }
  return result;
}

async function createHarness(effort = "high") {
  const root = await mkdir(join(tmpdir(), `doctor-model-profiles-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`), { recursive: true });
  const piHome = root;
  const gentleDir = join(piHome, "gentle-ai");
  const agentDir = join(piHome, "agent");
  await mkdir(gentleDir, { recursive: true });
  await mkdir(agentDir, { recursive: true });

  const manifest = {
    schemaVersion: 1,
    defaultProfile: "openai",
    managedAgentGroups: { sdd: ["sdd-init", "sdd-explore", "sdd-research"], odd: ["gentle-ai-worker"] },
    reservedCommandNames: ["status", "list", "preview", "doctor", "undo", "recover"],
    profiles: [
      { name: "openai", modelsFile: "models.openai.json" },
      { name: "grok", modelsFile: "models.grok.json" },
    ],
  };

  await writeJson(join(gentleDir, "model-profiles.manifest.json"), manifest);
  await writeJson(join(gentleDir, "models.openai.json"), profile("known", effort));
  await writeJson(join(gentleDir, "models.grok.json"), profile("known-grok", "xhigh"));
  await writeJson(join(gentleDir, "models.json"), { ...profile("known", effort), unmanagedCanonical: { model: "keep/me", thinking: "low" } });
  await writeJson(join(agentDir, "subagents.json"), {
    model_profiles: {
      ...Object.fromEntries(agents.map((agent) => [agent, { model: `known/${agent}`, effort }])),
      unrelatedAgent: { model: "keep/runtime", effort: "low" },
    },
    unrelatedTopLevel: true,
  });

  const commands = new Map<string, RegisteredCommand>();
  sddModelProfiles({ registerCommand: (name: string, command: RegisteredCommand) => commands.set(name, command) } as any, { piHome });
  const command = commands.get("jb-sdd-odd-models");
  assert.ok(command);

  const notifications: Array<{ message: string; level: string }> = [];
  let reloadCount = 0;
  const models = new Map<string, any>();
  for (const agent of agents) {
    const thinkingLevelMap = agent === "gentle-ai-worker" ? undefined : { xhigh: "xhigh" };
    models.set(`known/${agent}`, { provider: "known", id: agent, name: agent, reasoning: true, thinkingLevelMap });
    models.set(`known-grok/${agent}`, { provider: "known-grok", id: agent, name: agent, reasoning: true, thinkingLevelMap: { xhigh: "xhigh" } });
  }
  const ctx: FakeCommandContext = {
    cwd: root,
    ui: { notify: (message, level) => notifications.push({ message, level }) },
    reload: async () => { reloadCount += 1; },
    modelRegistry: {
      find: (provider, modelId) => models.get(`${provider}/${modelId}`),
      getProviderAuthStatus: (provider) => ({ configured: provider === "known", source: provider === "known" ? "stored" : undefined }),
      getProviderDisplayName: (provider) => provider,
    },
    model: { provider: "known", id: "sdd-init" },
    thinkingLevel: "high",
  };

  return {
    root,
    gentleDir,
    runtimePath: join(agentDir, "subagents.json"),
    canonicalPath: join(gentleDir, "models.json"),
    manifestPath: join(gentleDir, "model-profiles.manifest.json"),
    journalDir: join(gentleDir, ".model-profiles-transactions"),
    command,
    ctx,
    notifications,
    reloadCount: () => reloadCount,
  };
}

test("doctor is offered in completion/help and performs a read-only healthy diagnostic", async () => {
  const harness = await createHarness();
  assert.ok(harness.command.getArgumentCompletions?.("d")?.some((item) => item.value === "doctor"));

  await harness.command.handler("nonsense", harness.ctx);
  assert.match(harness.notifications.at(-1)?.message ?? "", /doctor/);

  const paths = [harness.canonicalPath, harness.runtimePath, harness.manifestPath, join(harness.journalDir, "active.json"), join(harness.journalDir, "history.json")];
  const before = await snapshot(paths);
  await harness.command.handler("doctor", harness.ctx);
  const message = harness.notifications.at(-1)?.message ?? "";

  assert.equal(harness.reloadCount(), 0);
  assert.equal(harness.notifications.at(-1)?.level, "info");
  assert.match(message, /Doctor summary: no blocking errors/i);
  assert.match(message, /Active SDD\/ODD profile: openai/);
  assert.match(message, /Catalog: known\/sdd-init found, effort high compatible/);
  assert.match(message, /Provider auth: known configured \(stored\)/);
  assert.match(message, /Unrelated runtime mappings preserved: unrelatedAgent/);
  assert.match(message, /does not prove effective project routing/i);
  assert.deepEqual(await snapshot(paths), before);
});

test("doctor reports malformed journals, drift, missing entries, catalog bounds, and effort incompatibility without repair", async () => {
  const harness = await createHarness();
  const canonical = await readJson(harness.canonicalPath);
  const runtime = await readJson(harness.runtimePath);
  delete canonical["sdd-research"];
  runtime.model_profiles["sdd-explore"] = { model: "known/sdd-explore", effort: "low" };
  runtime.model_profiles["sdd-research"] = { model: "unknown/missing-model", effort: "xhigh" };
  runtime.model_profiles["gentle-ai-worker"] = { model: "known/gentle-ai-worker", effort: "xhigh" };
  await writeJson(harness.canonicalPath, canonical);
  await writeJson(harness.runtimePath, runtime);
  await mkdir(harness.journalDir, { recursive: true });
  await writeFile(join(harness.journalDir, "active.json"), "{malformed", "utf8");
  await writeFile(join(harness.journalDir, "history.json"), JSON.stringify([{ schemaVersion: 1, id: "bad" }]), "utf8");

  const paths = [harness.canonicalPath, harness.runtimePath, join(harness.journalDir, "active.json"), join(harness.journalDir, "history.json")];
  const before = await snapshot(paths);
  await harness.command.handler("doctor", harness.ctx);
  const message = harness.notifications.at(-1)?.message ?? "";

  assert.equal(harness.reloadCount(), 0);
  assert.equal(harness.notifications.at(-1)?.level, "warning");
  assert.match(message, /Doctor summary: issues found/i);
  assert.match(message, /Active transaction journal is malformed/i);
  assert.match(message, /Transaction history is malformed/i);
  assert.match(message, /models\.json\.sdd-research is missing/);
  assert.match(message, /Drift: sdd-explore canonical known\/sdd-explore \(high\) != runtime known\/sdd-explore \(low\)/);
  assert.match(message, /Catalog: unknown\/missing-model is not in the effective local catalog/);
  assert.match(message, /Effort: known\/gentle-ai-worker does not advertise xhigh support/);
  assert.match(message, /Doctor is read-only; no files were repaired or reclaimed/);
  assert.deepEqual(await snapshot(paths), before);
});

const effortEvidenceCases = [
  { name: "advertised max", effort: "max", map: { max: "max" }, supported: true },
  { name: "max mapped to provider-specific value", effort: "max", map: { max: 32768 }, supported: true },
  { name: "nonadvertised max", effort: "max", map: { xhigh: "xhigh" }, supported: false },
  { name: "max without a map", effort: "max", map: undefined, supported: false },
  { name: "null max", effort: "max", map: { max: null }, supported: false },
  { name: "undefined max", effort: "max", map: { max: undefined }, supported: false },
  { name: "inherited max", effort: "max", map: Object.create({ max: "max" }), supported: false },
  { name: "nonreasoning max", effort: "max", map: { max: "max" }, reasoning: false, supported: false },
  { name: "advertised custom level", effort: "provider-ultra", map: { "provider-ultra": "ultra" }, supported: true },
  { name: "nonadvertised custom level", effort: "provider-ultra", map: {}, supported: false },
  { name: "advertised xhigh", effort: "xhigh", map: { xhigh: "xhigh" }, supported: true },
  { name: "undefined xhigh", effort: "xhigh", map: { xhigh: undefined }, supported: false },
  { name: "explicitly disabled baseline", effort: "high", map: { high: null }, supported: false },
];

for (const evidence of effortEvidenceCases) {
  test(`doctor checks registry evidence for ${evidence.name} without mutation`, async () => {
    const harness = await createHarness(evidence.effort);
    for (const agent of agents) {
      const model = harness.ctx.modelRegistry!.find("known", agent);
      model.reasoning = evidence.reasoning ?? true;
      model.thinkingLevelMap = evidence.map;
    }
    const paths = [harness.canonicalPath, harness.runtimePath, harness.manifestPath, join(harness.gentleDir, "models.openai.json"), harness.journalDir];
    const before = await snapshot(paths);

    await harness.command.handler("doctor", harness.ctx);
    const message = harness.notifications.at(-1)?.message ?? "";

    assert.equal(harness.notifications.at(-1)?.level, evidence.supported ? "info" : "warning");
    assert.match(message, /Active SDD\/ODD profile: openai/);
    for (const agent of agents) {
      const compatible = `Catalog: known/${agent} found, effort ${evidence.effort} compatible.`;
      const unsupported = `Effort: known/${agent} does not advertise ${evidence.effort} support`;
      assert.equal(message.includes(compatible), evidence.supported);
      assert.equal(message.includes(unsupported), !evidence.supported);
    }
    assert.equal(harness.reloadCount(), 0);
    assert.deepEqual(await snapshot(paths), before);
  });
}

test("doctor bounds max diagnostics when Pi model registry or auth evidence is unavailable", async () => {
  const harness = await createHarness("max");
  harness.ctx.modelRegistry = undefined;

  await harness.command.handler("doctor", harness.ctx);
  const message = harness.notifications.at(-1)?.message ?? "";

  assert.match(message, /Pi model registry unavailable; catalog, auth, and effort checks skipped/i);
  assert.match(message, /cannot establish provider authentication or execution/i);
  assert.doesNotMatch(message, /remote unavailable/i);
  assert.doesNotMatch(message, /effort max compatible|does not advertise max support/i);
  assert.equal(harness.reloadCount(), 0);
});
