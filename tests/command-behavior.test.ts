import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import test from "node:test";

import sddModelProfiles from "../extensions/sdd-model-profiles.ts";
import { inspectModelProfileTransactions } from "../extensions/model-profiles/transaction.ts";

type RegisteredCommand = {
  description: string;
  getArgumentCompletions?: (prefix: string) => Array<{ value: string; label?: string }> | null;
  handler: (args: string, ctx: FakeCommandContext) => Promise<void> | void;
};

type FakeCommandContext = {
  cwd: string;
  ui: { notify(message: string, level: string): void };
  reload(): Promise<void>;
};

const agents = ["sdd-init", "sdd-explore", "sdd-research", "gentle-ai-worker"];

function profile(modelPrefix: string, effort = "high"): Record<string, { model: string; thinking: string }> {
  return Object.fromEntries(agents.map((agent) => [agent, { model: `${modelPrefix}/${agent}`, thinking: effort }]));
}

async function readJson(path: string): Promise<any> {
  return JSON.parse(await readFile(path, "utf8"));
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function snapshotTree(root: string): Promise<Array<{ path: string; type: "dir" | "file"; mtimeMs: number; content?: string }>> {
  const records: Array<{ path: string; type: "dir" | "file"; mtimeMs: number; content?: string }> = [];
  async function walk(path: string): Promise<void> {
    const current = await stat(path);
    records.push({ path: relative(root, path) || ".", type: current.isDirectory() ? "dir" : "file", mtimeMs: current.mtimeMs });
    if (!current.isDirectory()) {
      records[records.length - 1].content = await readFile(path, "utf8");
      return;
    }
    const entries = await readdir(path, { withFileTypes: true });
    for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
      await walk(join(path, entry.name));
    }
  }
  await walk(root);
  return records;
}

async function createHarness() {
  const root = await mkdir(join(tmpdir(), `sdd-model-profiles-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`), { recursive: true });
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
      { name: "local", modelsFile: "models.local.json" },
    ],
  };

  await writeJson(join(gentleDir, "model-profiles.manifest.json"), manifest);
  await writeJson(join(gentleDir, "models.openai.json"), profile("openai-codex", "high"));
  await writeJson(join(gentleDir, "models.grok.json"), profile("xai", "xhigh"));
  await writeJson(join(gentleDir, "models.local.json"), profile("local", "medium"));
  await writeJson(join(gentleDir, "models.json"), { ...profile("openai-codex", "high"), unmanagedCanonical: { model: "keep/me", thinking: "low" } });
  await writeJson(join(agentDir, "subagents.json"), {
    model_profiles: {
      ...Object.fromEntries(agents.map((agent) => [agent, { model: `openai-codex/${agent}`, effort: "high" }])),
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
  const ctx: FakeCommandContext = {
    cwd: root,
    ui: { notify: (message, level) => notifications.push({ message, level }) },
    reload: async () => { reloadCount += 1; },
  };

  return {
    root,
    gentleDir,
    runtimePath: join(agentDir, "subagents.json"),
    canonicalPath: join(gentleDir, "models.json"),
    journalDir: join(gentleDir, ".model-profiles-transactions"),
    command,
    ctx,
    notifications,
    reloadCount: () => reloadCount,
  };
}

test("registered command uses manifest profiles for completion, list, preview, and direct switching", async () => {
  const harness = await createHarness();

  assert.deepEqual(harness.command.getArgumentCompletions?.("l")?.map((item) => item.value), ["list", "local"]);
  assert.deepEqual(harness.command.getArgumentCompletions?.("preview l")?.map((item) => item.value), ["preview local"]);
  assert.deepEqual(harness.command.getArgumentCompletions?.("preview ")?.map((item) => item.value), ["preview openai", "preview grok", "preview local"]);

  await harness.command.handler("list", harness.ctx);
  assert.match(harness.notifications.at(-1)?.message ?? "", /local/);
  assert.equal(harness.reloadCount(), 0);

  const beforePreviewCanonical = await readFile(harness.canonicalPath, "utf8");
  const beforePreviewRuntime = await readFile(harness.runtimePath, "utf8");
  await harness.command.handler("preview local", harness.ctx);
  assert.match(harness.notifications.at(-1)?.message ?? "", /Preview SDD\/ODD profile: local/);
  assert.match(harness.notifications.at(-1)?.message ?? "", /sdd-research/);
  assert.match(harness.notifications.at(-1)?.message ?? "", /canonical .*openai-codex\/sdd-research.* -> .*local\/sdd-research/s);
  assert.match(harness.notifications.at(-1)?.message ?? "", /runtime .*openai-codex\/sdd-research.* -> .*local\/sdd-research/s);
  assert.equal(await readFile(harness.canonicalPath, "utf8"), beforePreviewCanonical);
  assert.equal(await readFile(harness.runtimePath, "utf8"), beforePreviewRuntime);
  assert.equal(harness.reloadCount(), 0);

  await harness.command.handler("local", harness.ctx);
  assert.equal(harness.reloadCount(), 1);
  const canonical = await readJson(harness.canonicalPath);
  const runtime = await readJson(harness.runtimePath);
  assert.deepEqual(canonical.unmanagedCanonical, { model: "keep/me", thinking: "low" });
  assert.deepEqual(runtime.model_profiles.unrelatedAgent, { model: "keep/runtime", effort: "low" });
  assert.equal(runtime.unrelatedTopLevel, true);
  assert.deepEqual(canonical["sdd-research"], { model: "local/sdd-research", thinking: "medium" });
  assert.deepEqual(runtime.model_profiles["sdd-research"], { model: "local/sdd-research", effort: "medium" });
});

test("fresh aligned switch leaves complete fixture tree unchanged with no history", async () => {
  const harness = await createHarness();
  const before = await snapshotTree(harness.root);
  await new Promise((resolve) => setTimeout(resolve, 10));

  await harness.command.handler("openai", harness.ctx);

  assert.equal(harness.reloadCount(), 0);
  assert.match(harness.notifications.at(-1)?.message ?? "", /already active/i);
  assert.deepEqual(await snapshotTree(harness.root), before);
});

test("unknown, malformed, preview, and aligned switch inputs do not write or reload", async () => {
  const harness = await createHarness();

  await harness.command.handler("constructor", harness.ctx);
  await harness.command.handler("preview constructor", harness.ctx);
  await harness.command.handler("preview", harness.ctx);
  assert.equal(harness.reloadCount(), 0);
  assert.match(harness.notifications.at(-1)?.message ?? "", /Usage:/);

  await harness.command.handler("openai", harness.ctx);
  assert.equal(harness.reloadCount(), 0);
  assert.match(harness.notifications.at(-1)?.message ?? "", /already active/i);

  const beforeCanonical = await readFile(harness.canonicalPath, "utf8");
  const beforeRuntime = await readFile(harness.runtimePath, "utf8");
  const beforeCanonicalStat = await stat(harness.canonicalPath);
  const beforeRuntimeStat = await stat(harness.runtimePath);
  await new Promise((resolve) => setTimeout(resolve, 5));
  await harness.command.handler("openai", harness.ctx);
  assert.equal(await readFile(harness.canonicalPath, "utf8"), beforeCanonical);
  assert.equal(await readFile(harness.runtimePath, "utf8"), beforeRuntime);
  assert.equal((await stat(harness.canonicalPath)).mtimeMs, beforeCanonicalStat.mtimeMs);
  assert.equal((await stat(harness.runtimePath)).mtimeMs, beforeRuntimeStat.mtimeMs);
  assert.equal(harness.reloadCount(), 0);
});

test("switch repairs missing newly managed research entries while rejecting malformed existing data", async () => {
  const harness = await createHarness();
  const canonical = await readJson(harness.canonicalPath);
  const runtime = await readJson(harness.runtimePath);
  delete canonical["sdd-research"];
  delete runtime.model_profiles["sdd-research"];
  await writeJson(harness.canonicalPath, canonical);
  await writeJson(harness.runtimePath, runtime);

  await harness.command.handler("grok", harness.ctx);
  assert.equal(harness.reloadCount(), 1);
  assert.deepEqual((await readJson(harness.canonicalPath))["sdd-research"], { model: "xai/sdd-research", thinking: "xhigh" });
  assert.deepEqual((await readJson(harness.runtimePath)).model_profiles["sdd-research"], { model: "xai/sdd-research", effort: "xhigh" });

  const malformed = await readJson(harness.runtimePath);
  malformed.model_profiles["sdd-init"] = { model: "broken-only", effort: "high" };
  await writeJson(harness.runtimePath, malformed);
  const before = await readFile(harness.runtimePath, "utf8");
  await harness.command.handler("openai", harness.ctx);
  assert.equal(harness.reloadCount(), 1);
  assert.match(harness.notifications.at(-1)?.message ?? "", /provider\/model identifier|must contain \{model, effort\}|must be one of/);
  assert.equal(await readFile(harness.runtimePath, "utf8"), before);
});

test("undo command and completions use transaction history through the command seam", async () => {
  const harness = await createHarness();

  assert.ok(harness.command.getArgumentCompletions?.("u")?.some((item) => item.value === "undo"));
  assert.ok(harness.command.getArgumentCompletions?.("r")?.some((item) => item.value === "recover"));

  await harness.command.handler("grok", harness.ctx);
  assert.equal(harness.reloadCount(), 1);
  assert.equal((await inspectModelProfileTransactions({ canonicalPath: harness.canonicalPath, runtimePath: harness.runtimePath, journalDir: harness.journalDir })).history.length, 1);

  await harness.command.handler("undo", harness.ctx);
  assert.equal(harness.reloadCount(), 2);
  assert.match(harness.notifications.at(-1)?.message ?? "", /undone/i);
  assert.deepEqual((await readJson(harness.canonicalPath))["sdd-init"], { model: "openai-codex/sdd-init", thinking: "high" });
  assert.deepEqual((await readJson(harness.runtimePath)).model_profiles["sdd-init"], { model: "openai-codex/sdd-init", effort: "high" });
});

test("semantic no-op switch leaves transaction history bytes and reload count unchanged", async () => {
  const harness = await createHarness();
  await harness.command.handler("grok", harness.ctx);
  const historyBefore = await inspectModelProfileTransactions({ canonicalPath: harness.canonicalPath, runtimePath: harness.runtimePath, journalDir: harness.journalDir });
  const canonicalBefore = await readFile(harness.canonicalPath, "utf8");
  const runtimeBefore = await readFile(harness.runtimePath, "utf8");
  const treeBefore = await snapshotTree(harness.root);
  await new Promise((resolve) => setTimeout(resolve, 10));

  await harness.command.handler("grok", harness.ctx);

  const historyAfter = await inspectModelProfileTransactions({ canonicalPath: harness.canonicalPath, runtimePath: harness.runtimePath, journalDir: harness.journalDir });
  assert.equal(harness.reloadCount(), 1);
  assert.equal(await readFile(harness.canonicalPath, "utf8"), canonicalBefore);
  assert.equal(await readFile(harness.runtimePath, "utf8"), runtimeBefore);
  assert.deepEqual(historyAfter, historyBefore);
  assert.deepEqual(await snapshotTree(harness.root), treeBefore);
});

test("aligned switch refuses active or ambiguous transaction state instead of claiming healthy no-op", async () => {
  const activeHarness = await createHarness();
  const script = `
    import { runModelProfileTransaction } from ${JSON.stringify(new URL("../extensions/model-profiles/transaction.ts", import.meta.url).href)};
    await runModelProfileTransaction(${JSON.stringify({ canonicalPath: activeHarness.canonicalPath, runtimePath: activeHarness.runtimePath, journalDir: activeHarness.journalDir })}, {
      operation: "switch",
      plan: () => ({
        canonicalContent: ${JSON.stringify(`${JSON.stringify({ ...profile("xai", "xhigh"), unmanagedCanonical: { model: "keep/me", thinking: "low" } }, null, 2)}\n`)},
        runtimeContent: ${JSON.stringify(`${JSON.stringify({ model_profiles: { ...Object.fromEntries(agents.map((agent) => [agent, { model: `xai/${agent}`, effort: "xhigh" }])), unrelatedAgent: { model: "keep/runtime", effort: "low" } }, unrelatedTopLevel: true }, null, 2)}\n`)},
      }),
      faultHook: (event) => { if (event === "after-journal") process.exit(47); },
    });
  `;
  const child = spawnSync(process.execPath, ["--experimental-strip-types", "--input-type=module", "--eval", script], { encoding: "utf8" });
  assert.equal(child.status, 47, child.stderr);
  await activeHarness.command.handler("openai", activeHarness.ctx);
  assert.equal(activeHarness.reloadCount(), 0);
  assert.doesNotMatch(activeHarness.notifications.at(-1)?.message ?? "", /profile is already active/i);
  assert.match(activeHarness.notifications.at(-1)?.message ?? "", /transaction is already active|lock/i);

  const ambiguousHarness = await createHarness();
  await mkdir(ambiguousHarness.journalDir, { recursive: true });
  await writeFile(join(ambiguousHarness.journalDir, "active.json"), "{malformed", "utf8");
  await ambiguousHarness.command.handler("openai", ambiguousHarness.ctx);
  assert.equal(ambiguousHarness.reloadCount(), 0);
  assert.doesNotMatch(ambiguousHarness.notifications.at(-1)?.message ?? "", /profile is already active/i);
  assert.match(ambiguousHarness.notifications.at(-1)?.message ?? "", /transaction|journal|JSON/i);

  const lockHarness = await createHarness();
  await mkdir(lockHarness.journalDir, { recursive: true });
  await writeJson(join(lockHarness.journalDir, "lock.json"), {
    pid: process.pid,
    token: "live",
    createdAt: new Date().toISOString(),
    targetIdentity: { canonicalPath: lockHarness.canonicalPath, runtimePath: lockHarness.runtimePath },
  });
  await lockHarness.command.handler("openai", lockHarness.ctx);
  assert.equal(lockHarness.reloadCount(), 0);
  assert.doesNotMatch(lockHarness.notifications.at(-1)?.message ?? "", /profile is already active/i);
  assert.match(lockHarness.notifications.at(-1)?.message ?? "", /lock/i);
});

test("recover command reports deterministic transaction recovery through the command seam", async () => {
  const harness = await createHarness();
  await harness.command.handler("recover", harness.ctx);
  assert.equal(harness.reloadCount(), 0);
  assert.match(harness.notifications.at(-1)?.message ?? "", /No model profile transaction needs recovery/i);
});

test("recover command finishes a real interrupted active switch through the command seam", async () => {
  const harness = await createHarness();
  const script = `
    import { runModelProfileTransaction } from ${JSON.stringify(new URL("../extensions/model-profiles/transaction.ts", import.meta.url).href)};
    await runModelProfileTransaction(${JSON.stringify({ canonicalPath: harness.canonicalPath, runtimePath: harness.runtimePath, journalDir: harness.journalDir })}, {
      operation: "switch",
      plan: () => ({
        canonicalContent: ${JSON.stringify(`${JSON.stringify({ ...profile("xai", "xhigh"), unmanagedCanonical: { model: "keep/me", thinking: "low" } }, null, 2)}\n`)},
        runtimeContent: ${JSON.stringify(`${JSON.stringify({ model_profiles: { ...Object.fromEntries(agents.map((agent) => [agent, { model: `xai/${agent}`, effort: "xhigh" }])), unrelatedAgent: { model: "keep/runtime", effort: "low" } }, unrelatedTopLevel: true }, null, 2)}\n`)},
      }),
      faultHook: (event) => { if (event === "after-replace:canonical") process.exit(46); },
    });
  `;
  const child = spawnSync(process.execPath, ["--experimental-strip-types", "--input-type=module", "--eval", script], { encoding: "utf8" });
  assert.equal(child.status, 46, child.stderr);
  assert.deepEqual((await readJson(harness.canonicalPath))["sdd-init"], { model: "xai/sdd-init", thinking: "xhigh" });
  assert.deepEqual((await readJson(harness.runtimePath)).model_profiles["sdd-init"], { model: "openai-codex/sdd-init", effort: "high" });

  await harness.command.handler("recover", harness.ctx);

  assert.equal(harness.reloadCount(), 1);
  assert.match(harness.notifications.at(-1)?.message ?? "", /recovery finished/i);
  assert.deepEqual((await readJson(harness.runtimePath)).model_profiles["sdd-init"], { model: "xai/sdd-init", effort: "xhigh" });
});
