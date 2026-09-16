import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

import {
  inspectModelProfileTransactions,
  recoverModelProfileTransaction,
  runModelProfileTransaction,
  undoLastModelProfileTransaction,
  type ModelProfileTransactionTargets,
} from "../extensions/model-profiles/transaction.ts";

async function tempTargets(): Promise<ModelProfileTransactionTargets & { root: string }> {
  const root = await mkdir(join(tmpdir(), `model-profile-tx-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`), { recursive: true });
  const gentleDir = join(root, "gentle-ai");
  const agentDir = join(root, "agent");
  await mkdir(gentleDir, { recursive: true });
  await mkdir(agentDir, { recursive: true });
  const canonicalPath = join(gentleDir, "models.json");
  const runtimePath = join(agentDir, "subagents.json");
  await writeFile(canonicalPath, "canonical-before\n", "utf8");
  await writeFile(runtimePath, "runtime-before\n", "utf8");
  return { root, canonicalPath, runtimePath, journalDir: join(gentleDir, ".model-profiles-transactions") };
}

async function pair(targets: ModelProfileTransactionTargets): Promise<[string, string]> {
  return Promise.all([readFile(targets.canonicalPath, "utf8"), readFile(targets.runtimePath, "utf8")]);
}

async function changeBoth(targets: ModelProfileTransactionTargets, suffix = "after"): Promise<void> {
  await runModelProfileTransaction(targets, {
    operation: "switch",
    plan: () => ({ canonicalContent: `canonical-${suffix}\n`, runtimeContent: `runtime-${suffix}\n` }),
  });
}

test("competing same-target mutations refuse one writer without data loss", async () => {
  const targets = await tempTargets();
  let releaseFirst!: () => void;
  const firstMayFinish = new Promise<void>((resolve) => { releaseFirst = resolve; });
  let firstHoldingLock!: () => void;
  const firstHasLock = new Promise<void>((resolve) => { firstHoldingLock = resolve; });

  const first = runModelProfileTransaction(targets, {
    operation: "switch",
    plan: () => ({ canonicalContent: "canonical-first\n", runtimeContent: "runtime-first\n" }),
    faultHook: async (event) => {
      if (event === "after-journal") {
        firstHoldingLock();
        await firstMayFinish;
      }
    },
  });

  await firstHasLock;
  await assert.rejects(
    () => runModelProfileTransaction(targets, {
      operation: "switch",
      plan: () => ({ canonicalContent: "canonical-second\n", runtimeContent: "runtime-second\n" }),
    }),
    /lock/i,
  );
  releaseFirst();
  await first;
  assert.deepEqual(await pair(targets), ["canonical-first\n", "runtime-first\n"]);
});

test("external edit between snapshot and replacement refuses and preserves external bytes", async () => {
  const targets = await tempTargets();
  await assert.rejects(
    () => runModelProfileTransaction(targets, {
      operation: "switch",
      plan: () => ({ canonicalContent: "canonical-after\n", runtimeContent: "runtime-after\n" }),
      faultHook: async (event) => {
        if (event === "before-check:canonical") await writeFile(targets.canonicalPath, "external-canonical\n", "utf8");
      },
    }),
    /changed before replacement/i,
  );
  assert.deepEqual(await pair(targets), ["external-canonical\n", "runtime-before\n"]);
});

test("ordinary replacement failure rolls back only unchanged transaction outputs", async () => {
  const targets = await tempTargets();
  await assert.rejects(
    () => runModelProfileTransaction(targets, {
      operation: "switch",
      plan: () => ({ canonicalContent: "canonical-after\n", runtimeContent: "runtime-after\n" }),
      faultHook: (event) => {
        if (event === "after-replace:canonical") throw new Error("injected failure");
      },
    }),
    /rolled back/i,
  );
  assert.deepEqual(await pair(targets), ["canonical-before\n", "runtime-before\n"]);
});

test("subprocess termination after first rename is inspectable and recoverable", async () => {
  const targets = await tempTargets();
  const script = `
    import { runModelProfileTransaction } from ${JSON.stringify(new URL("../extensions/model-profiles/transaction.ts", import.meta.url).href)};
    await runModelProfileTransaction(${JSON.stringify(targets)}, {
      operation: "switch",
      plan: () => ({ canonicalContent: "canonical-after\\n", runtimeContent: "runtime-after\\n" }),
      faultHook: (event) => { if (event === "after-replace:canonical") process.exit(44); },
    });
  `;
  const child = spawnSync(process.execPath, ["--experimental-strip-types", "--input-type=module", "--eval", script], { encoding: "utf8" });
  assert.equal(child.status, 44, child.stderr);
  assert.deepEqual(await pair(targets), ["canonical-after\n", "runtime-before\n"]);
  const inspected = await inspectModelProfileTransactions(targets);
  assert.equal(inspected.active?.operation, "switch");

  await recoverModelProfileTransaction(targets);
  assert.deepEqual(await pair(targets), ["canonical-after\n", "runtime-after\n"]);
});

test("invalid or mismatched active journal is inspectable and refused without overwriting configured files", async () => {
  const targets = await tempTargets();
  await mkdir(targets.journalDir!, { recursive: true });
  await writeFile(join(targets.journalDir!, "active.json"), JSON.stringify({ schemaVersion: 1, targetIdentity: { canonicalPath: "/tmp/other", runtimePath: targets.runtimePath } }), "utf8");
  const inspected = await inspectModelProfileTransactions(targets);
  assert.equal(inspected.active, null);
  assert.match(inspected.diagnostics.find((item) => item.area === "active")?.message ?? "", /journal|shape|target/i);
  await assert.rejects(() => recoverModelProfileTransaction(targets), /journal|target/i);
  assert.deepEqual(await pair(targets), ["canonical-before\n", "runtime-before\n"]);
});

test("guarded undo restores committed before contents", async () => {
  const targets = await tempTargets();
  await changeBoth(targets);
  await undoLastModelProfileTransaction(targets);
  assert.deepEqual(await pair(targets), ["canonical-before\n", "runtime-before\n"]);
});

test("undo refuses intervening changes to either committed after file", async () => {
  const targets = await tempTargets();
  await changeBoth(targets);
  await writeFile(targets.runtimePath, "intervening-runtime\n", "utf8");
  await assert.rejects(() => undoLastModelProfileTransaction(targets), /intervening changes/i);
  assert.deepEqual(await pair(targets), ["canonical-after\n", "intervening-runtime\n"]);
});

test("interrupted undo can be recovered without destroying prior history", async () => {
  const targets = await tempTargets();
  await changeBoth(targets);
  const script = `
    import { undoLastModelProfileTransaction } from ${JSON.stringify(new URL("../extensions/model-profiles/transaction.ts", import.meta.url).href)};
    await undoLastModelProfileTransaction(${JSON.stringify(targets)}, {
      faultHook: (event) => { if (event === "after-replace:canonical") process.exit(45); },
    });
  `;
  const child = spawnSync(process.execPath, ["--experimental-strip-types", "--input-type=module", "--eval", script], { encoding: "utf8" });
  assert.equal(child.status, 45, child.stderr);
  assert.deepEqual(await pair(targets), ["canonical-before\n", "runtime-after\n"]);
  const inspected = await inspectModelProfileTransactions(targets);
  assert.equal(inspected.history.length, 1);

  await recoverModelProfileTransaction(targets);
  assert.deepEqual(await pair(targets), ["canonical-before\n", "runtime-before\n"]);
  assert.equal((await inspectModelProfileTransactions(targets)).history.length, 2);
});

test("live or ambiguous lock state refuses new mutations", async () => {
  const targets = await tempTargets();
  await mkdir(targets.journalDir!, { recursive: true });
  await writeFile(join(targets.journalDir!, "lock.json"), JSON.stringify({ pid: process.pid, token: "live", targetIdentity: { canonicalPath: targets.canonicalPath, runtimePath: targets.runtimePath } }), "utf8");
  await assert.rejects(
    () => runModelProfileTransaction(targets, { operation: "switch", plan: () => ({ canonicalContent: "x", runtimeContent: "y" }) }),
    /lock/i,
  );
});
