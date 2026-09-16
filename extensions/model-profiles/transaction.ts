import { createHash, randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { mkdir, open, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve, sep } from "node:path";

export type ModelProfileTransactionTargets = {
  canonicalPath: string;
  runtimePath: string;
  journalDir?: string;
};

export type ModelProfileTransactionFaultEvent =
  | "after-lock"
  | "after-journal"
  | "before-check:canonical"
  | "before-check:runtime"
  | "before-replace:canonical"
  | "before-replace:runtime"
  | "after-replace:canonical"
  | "after-replace:runtime";

export type ModelProfileTransactionFaultHook = (event: ModelProfileTransactionFaultEvent) => void | Promise<void>;

export type ModelProfileTransactionPlan = (current: {
  canonicalContent: string;
  runtimeContent: string;
}) =>
  | { canonicalContent: string; runtimeContent: string }
  | null
  | undefined
  | Promise<{ canonicalContent: string; runtimeContent: string } | null | undefined>;

export type ModelProfileTransactionOperation = "switch" | "undo";

export type ModelProfileTransactionInspection = {
  targets: { canonicalPath: string; runtimePath: string; journalDir: string };
  active: null | { id: string; operation: ModelProfileTransactionOperation; phase: string; createdAt: string };
  lock: { state: "none" } | { state: "present"; pid?: number; createdAt?: string } | { state: "ambiguous"; reason: string };
  history: Array<{ id: string; operation: ModelProfileTransactionOperation; committedAt: string }>;
  diagnostics: Array<{ area: "active" | "history"; message: string }>;
};

type FileKey = "canonical" | "runtime";
type TransactionPhase = "prepared" | "canonical-replaced" | "runtime-replaced" | "committed";

type TargetIdentity = {
  canonicalPath: string;
  runtimePath: string;
};

type JournalFileEntry = {
  path: string;
  beforeHash: string;
  beforeContent: string;
  afterHash: string;
  afterContent: string;
};

type JournalRecord = {
  schemaVersion: 1;
  id: string;
  operation: ModelProfileTransactionOperation;
  phase: TransactionPhase;
  createdAt: string;
  committedAt?: string;
  targetIdentity: TargetIdentity;
  files: Record<FileKey, JournalFileEntry>;
};

type ResolvedTargets = {
  canonicalPath: string;
  runtimePath: string;
  journalDir: string;
  activePath: string;
  historyPath: string;
  lockPath: string;
};

type LockState = {
  pid: number;
  token: string;
  createdAt: string;
  targetIdentity: TargetIdentity;
};

const schemaVersion = 1;

function sha256(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function assertInside(root: string, candidate: string, label: string): string {
  const resolvedRoot = resolve(root);
  const resolvedCandidate = resolve(candidate);
  if (resolvedCandidate !== resolvedRoot && !resolvedCandidate.startsWith(`${resolvedRoot}${sep}`)) {
    throw new Error(`${label} must stay inside ${resolvedRoot}.`);
  }
  return resolvedCandidate;
}

function resolveTargets(targets: ModelProfileTransactionTargets): ResolvedTargets {
  const canonicalPath = resolve(targets.canonicalPath);
  const runtimePath = resolve(targets.runtimePath);
  if (canonicalPath === runtimePath) throw new Error("Canonical and runtime targets must be different files.");
  const canonicalDir = dirname(canonicalPath);
  const journalDir = assertInside(canonicalDir, resolve(targets.journalDir ?? join(canonicalDir, ".model-profiles-transactions")), "Journal directory");
  return {
    canonicalPath,
    runtimePath,
    journalDir,
    activePath: join(journalDir, "active.json"),
    historyPath: join(journalDir, "history.json"),
    lockPath: join(journalDir, "lock.json"),
  };
}

function targetIdentity(targets: ResolvedTargets): TargetIdentity {
  return { canonicalPath: targets.canonicalPath, runtimePath: targets.runtimePath };
}

function assertTargetIdentity(record: JournalRecord, targets: ResolvedTargets): void {
  const expected = targetIdentity(targets);
  if (record.targetIdentity.canonicalPath !== expected.canonicalPath || record.targetIdentity.runtimePath !== expected.runtimePath) {
    throw new Error("Transaction journal target identity does not match the configured targets.");
  }
  if (record.files.canonical.path !== expected.canonicalPath || record.files.runtime.path !== expected.runtimePath) {
    throw new Error("Transaction journal file paths do not match the configured targets.");
  }
}

async function syncPath(path: string): Promise<void> {
  let handle;
  try {
    handle = await open(path, constants.O_RDONLY);
    await handle.sync();
  } catch (error) {
    const code = isObject(error) && typeof error.code === "string" ? error.code : "";
    if (!["EINVAL", "ENOTSUP", "EISDIR", "EPERM", "ENOENT"].includes(code)) throw error;
  } finally {
    await handle?.close().catch(() => undefined);
  }
}

async function ensureJournalDir(targets: ResolvedTargets): Promise<void> {
  await mkdir(targets.journalDir, { recursive: true, mode: 0o700 });
}

async function writeDurableFile(path: string, content: string): Promise<void> {
  const temp = join(dirname(path), `.${basename(path)}.${process.pid}.${Date.now()}.${Math.random().toString(16).slice(2)}.tmp`);
  let handle;
  try {
    handle = await open(temp, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY, 0o600);
    await handle.writeFile(content, "utf8");
    await handle.sync();
    await handle.close();
    handle = undefined;
    await rename(temp, path);
    await syncPath(dirname(path));
  } catch (error) {
    await handle?.close().catch(() => undefined);
    await unlink(temp).catch(() => undefined);
    throw error;
  }
}

async function readJsonFile(path: string): Promise<unknown> {
  return JSON.parse(await readFile(path, "utf8"));
}

function parseLock(value: unknown): LockState {
  if (!isObject(value) || typeof value.pid !== "number" || typeof value.token !== "string" || typeof value.createdAt !== "string" || !isObject(value.targetIdentity)) {
    throw new Error("Transaction lock is ambiguous or malformed.");
  }
  const target = value.targetIdentity;
  if (typeof target.canonicalPath !== "string" || typeof target.runtimePath !== "string") {
    throw new Error("Transaction lock target identity is ambiguous.");
  }
  return {
    pid: value.pid,
    token: value.token,
    createdAt: value.createdAt,
    targetIdentity: { canonicalPath: target.canonicalPath, runtimePath: target.runtimePath },
  };
}

async function readLock(path: string): Promise<LockState> {
  return parseLock(await readJsonFile(path));
}

function assertLockTargets(lock: LockState, targets: ResolvedTargets): void {
  const expected = targetIdentity(targets);
  if (lock.targetIdentity.canonicalPath !== expected.canonicalPath || lock.targetIdentity.runtimePath !== expected.runtimePath) {
    throw new Error("Transaction lock belongs to different targets.");
  }
}

function processIsAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    const code = isObject(error) && typeof error.code === "string" ? error.code : "";
    if (code === "ESRCH") return false;
    return true;
  }
}

async function writeLock(targets: ResolvedTargets): Promise<LockState> {
  const lock: LockState = { pid: process.pid, token: randomUUID(), createdAt: new Date().toISOString(), targetIdentity: targetIdentity(targets) };
  let handle;
  try {
    handle = await open(targets.lockPath, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY, 0o600);
    await handle.writeFile(JSON.stringify(lock, null, 2), "utf8");
    await handle.sync();
    await handle.close();
    handle = undefined;
    await syncPath(targets.journalDir);
    return lock;
  } catch (error) {
    await handle?.close().catch(() => undefined);
    const code = isObject(error) && typeof error.code === "string" ? error.code : "";
    if (code === "EEXIST") {
      const existing = await readLock(targets.lockPath);
      assertLockTargets(existing, targets);
      throw new Error(`Model profile transaction lock is already held by pid ${existing.pid}. Run recover only after that process exits.`);
    }
    throw error;
  }
}

async function acquireLock(targets: ResolvedTargets, faultHook?: ModelProfileTransactionFaultHook): Promise<LockState> {
  await ensureJournalDir(targets);
  const lock = await writeLock(targets);
  await faultHook?.("after-lock");
  return lock;
}

async function acquireRecoveryLock(targets: ResolvedTargets): Promise<LockState> {
  await ensureJournalDir(targets);
  try {
    return await writeLock(targets);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!/lock is already held/.test(message)) throw error;
    const existing = await readLock(targets.lockPath);
    assertLockTargets(existing, targets);
    if (processIsAlive(existing.pid)) {
      throw new Error(`Model profile transaction lock is live for pid ${existing.pid}; recovery refused.`);
    }
    await unlink(targets.lockPath);
    await syncPath(targets.journalDir);
    return await writeLock(targets);
  }
}

async function releaseLock(targets: ResolvedTargets, lock: LockState): Promise<void> {
  let current: LockState;
  try {
    current = await readLock(targets.lockPath);
  } catch {
    return;
  }
  if (current.token !== lock.token || current.pid !== lock.pid) {
    throw new Error("Transaction lock ownership changed; refusing to remove it.");
  }
  await unlink(targets.lockPath);
  await syncPath(targets.journalDir);
}

function parseJournal(value: unknown): JournalRecord {
  if (!isObject(value) || value.schemaVersion !== schemaVersion || typeof value.id !== "string" || typeof value.operation !== "string" || typeof value.phase !== "string" || typeof value.createdAt !== "string" || !isObject(value.targetIdentity) || !isObject(value.files)) {
    throw new Error("Transaction journal has invalid shape.");
  }
  if (value.operation !== "switch" && value.operation !== "undo") throw new Error("Transaction journal operation is invalid.");
  if (!["prepared", "canonical-replaced", "runtime-replaced", "committed"].includes(value.phase)) throw new Error("Transaction journal phase is invalid.");
  const target = value.targetIdentity;
  if (typeof target.canonicalPath !== "string" || typeof target.runtimePath !== "string") throw new Error("Transaction journal target identity is invalid.");

  const files: Partial<Record<FileKey, JournalFileEntry>> = {};
  for (const key of ["canonical", "runtime"] as const) {
    const file = value.files[key];
    if (!isObject(file) || typeof file.path !== "string" || typeof file.beforeHash !== "string" || typeof file.beforeContent !== "string" || typeof file.afterHash !== "string" || typeof file.afterContent !== "string") {
      throw new Error("Transaction journal file entry is invalid.");
    }
    if (sha256(file.beforeContent) !== file.beforeHash || sha256(file.afterContent) !== file.afterHash) {
      throw new Error("Transaction journal content hash does not match its recorded content.");
    }
    files[key] = file;
  }

  return {
    schemaVersion,
    id: value.id,
    operation: value.operation,
    phase: value.phase as TransactionPhase,
    createdAt: value.createdAt,
    committedAt: typeof value.committedAt === "string" ? value.committedAt : undefined,
    targetIdentity: { canonicalPath: target.canonicalPath, runtimePath: target.runtimePath },
    files: files as Record<FileKey, JournalFileEntry>,
  };
}

async function readActiveJournal(targets: ResolvedTargets): Promise<JournalRecord | null> {
  try {
    const record = parseJournal(await readJsonFile(targets.activePath));
    assertTargetIdentity(record, targets);
    return record;
  } catch (error) {
    const code = isObject(error) && typeof error.code === "string" ? error.code : "";
    if (code === "ENOENT") return null;
    throw error;
  }
}

async function writeActiveJournal(targets: ResolvedTargets, record: JournalRecord): Promise<void> {
  assertTargetIdentity(record, targets);
  await writeDurableFile(targets.activePath, `${JSON.stringify(record, null, 2)}\n`);
}

async function removeActiveJournal(targets: ResolvedTargets): Promise<void> {
  await unlink(targets.activePath).catch((error) => {
    const code = isObject(error) && typeof error.code === "string" ? error.code : "";
    if (code !== "ENOENT") throw error;
  });
  await syncPath(targets.journalDir);
}

async function readHistory(targets: ResolvedTargets): Promise<JournalRecord[]> {
  try {
    const value = await readJsonFile(targets.historyPath);
    if (!Array.isArray(value)) throw new Error("Transaction history has invalid shape.");
    return value.map((item) => {
      const record = parseJournal(item);
      assertTargetIdentity(record, targets);
      if (record.phase !== "committed" || !record.committedAt) throw new Error("Transaction history contains an uncommitted record.");
      return record;
    });
  } catch (error) {
    const code = isObject(error) && typeof error.code === "string" ? error.code : "";
    if (code === "ENOENT") return [];
    throw error;
  }
}

async function writeHistory(targets: ResolvedTargets, history: JournalRecord[]): Promise<void> {
  for (const record of history) assertTargetIdentity(record, targets);
  await writeDurableFile(targets.historyPath, `${JSON.stringify(history, null, 2)}\n`);
}

function makeRecord(targets: ResolvedTargets, operation: ModelProfileTransactionOperation, before: { canonicalContent: string; runtimeContent: string }, after: { canonicalContent: string; runtimeContent: string }): JournalRecord {
  return {
    schemaVersion,
    id: randomUUID(),
    operation,
    phase: "prepared",
    createdAt: new Date().toISOString(),
    targetIdentity: targetIdentity(targets),
    files: {
      canonical: {
        path: targets.canonicalPath,
        beforeContent: before.canonicalContent,
        beforeHash: sha256(before.canonicalContent),
        afterContent: after.canonicalContent,
        afterHash: sha256(after.canonicalContent),
      },
      runtime: {
        path: targets.runtimePath,
        beforeContent: before.runtimeContent,
        beforeHash: sha256(before.runtimeContent),
        afterContent: after.runtimeContent,
        afterHash: sha256(after.runtimeContent),
      },
    },
  };
}

async function replaceFile(
  path: string,
  expectedContent: string,
  nextContent: string,
  key: FileKey,
  faultHook?: ModelProfileTransactionFaultHook,
): Promise<void> {
  await faultHook?.(`before-check:${key}`);
  const current = await readFile(path, "utf8");
  if (current !== expectedContent) throw new Error(`${key} changed before replacement; refusing to overwrite external bytes.`);
  await faultHook?.(`before-replace:${key}`);
  await writeDurableFile(path, nextContent);
}

async function currentStates(record: JournalRecord, targets: ResolvedTargets): Promise<Record<FileKey, "before" | "after" | "unknown">> {
  const [canonical, runtime] = await Promise.all([readFile(targets.canonicalPath, "utf8"), readFile(targets.runtimePath, "utf8")]);
  const states = {} as Record<FileKey, "before" | "after" | "unknown">;
  for (const [key, content] of [["canonical", canonical], ["runtime", runtime]] as const) {
    const hash = sha256(content);
    const file = record.files[key];
    states[key] = hash === file.beforeHash ? "before" : hash === file.afterHash ? "after" : "unknown";
  }
  return states;
}

async function rollbackAfterFailure(record: JournalRecord, targets: ResolvedTargets): Promise<string> {
  const states = await currentStates(record, targets);
  const mutationObserved = states.canonical === "after" || states.runtime === "after";
  if (mutationObserved && (states.canonical === "unknown" || states.runtime === "unknown")) {
    throw new Error("Rollback refused because current content is unknown; no files were overwritten.");
  }
  if (states.runtime === "after") await replaceFile(targets.runtimePath, record.files.runtime.afterContent, record.files.runtime.beforeContent, "runtime");
  if (states.canonical === "after") await replaceFile(targets.canonicalPath, record.files.canonical.afterContent, record.files.canonical.beforeContent, "canonical");
  await removeActiveJournal(targets);
  return mutationObserved ? "rolled back" : "aborted before replacement";
}

async function commitRecord(record: JournalRecord, targets: ResolvedTargets): Promise<void> {
  const committed: JournalRecord = { ...record, phase: "committed", committedAt: new Date().toISOString() };
  await writeHistory(targets, [...await readHistory(targets), committed]);
  await removeActiveJournal(targets);
}

export async function runModelProfileTransaction(
  inputTargets: ModelProfileTransactionTargets,
  options: { operation: ModelProfileTransactionOperation; plan: ModelProfileTransactionPlan; faultHook?: ModelProfileTransactionFaultHook },
): Promise<"changed" | "noop"> {
  const targets = resolveTargets(inputTargets);
  const lock = await acquireLock(targets, options.faultHook);
  let record: JournalRecord | undefined;
  try {
    if (await readActiveJournal(targets)) throw new Error("A model profile transaction is already active; run recover before starting another mutation.");
    const before = {
      canonicalContent: await readFile(targets.canonicalPath, "utf8"),
      runtimeContent: await readFile(targets.runtimePath, "utf8"),
    };
    const planned = await options.plan(before);
    if (!planned || (planned.canonicalContent === before.canonicalContent && planned.runtimeContent === before.runtimeContent)) return "noop";

    record = makeRecord(targets, options.operation, before, planned);
    await writeActiveJournal(targets, record);
    await options.faultHook?.("after-journal");

    await replaceFile(targets.canonicalPath, record.files.canonical.beforeContent, record.files.canonical.afterContent, "canonical", options.faultHook);
    record.phase = "canonical-replaced";
    await writeActiveJournal(targets, record);
    await options.faultHook?.("after-replace:canonical");

    await replaceFile(targets.runtimePath, record.files.runtime.beforeContent, record.files.runtime.afterContent, "runtime", options.faultHook);
    record.phase = "runtime-replaced";
    await writeActiveJournal(targets, record);
    await options.faultHook?.("after-replace:runtime");

    await commitRecord(record, targets);
    return "changed";
  } catch (error) {
    if (record) {
      try {
        const outcome = await rollbackAfterFailure(record, targets);
        const detail = error instanceof Error ? error.message : String(error);
        throw new Error(`Transaction failed (${detail}) and was ${outcome}.`);
      } catch (rollbackError) {
        if (rollbackError instanceof Error && rollbackError.message.startsWith("Transaction failed")) throw rollbackError;
        const detail = error instanceof Error ? error.message : String(error);
        throw new Error(`Transaction failed (${detail}). ${rollbackError instanceof Error ? rollbackError.message : String(rollbackError)}`);
      }
    }
    throw error;
  } finally {
    await releaseLock(targets, lock);
  }
}

export async function recoverModelProfileTransaction(inputTargets: ModelProfileTransactionTargets): Promise<"none" | "finished" | "already-complete" | "rolled-back"> {
  const targets = resolveTargets(inputTargets);
  const lock = await acquireRecoveryLock(targets);
  try {
    const record = await readActiveJournal(targets);
    if (!record) return "none";
    const states = await currentStates(record, targets);
    if (states.canonical === "unknown" || states.runtime === "unknown") {
      throw new Error("Recovery refused because current content is unknown; no files were overwritten.");
    }
    if (states.canonical === "after" && states.runtime === "after") {
      await commitRecord(record, targets);
      return "already-complete";
    }
    if (states.canonical === "before" && states.runtime === "before") {
      await removeActiveJournal(targets);
      return "rolled-back";
    }
    if (states.canonical === "before") await replaceFile(targets.canonicalPath, record.files.canonical.beforeContent, record.files.canonical.afterContent, "canonical");
    if (states.runtime === "before") await replaceFile(targets.runtimePath, record.files.runtime.beforeContent, record.files.runtime.afterContent, "runtime");
    await commitRecord(record, targets);
    return "finished";
  } finally {
    await releaseLock(targets, lock);
  }
}

export async function undoLastModelProfileTransaction(
  inputTargets: ModelProfileTransactionTargets,
  options: { faultHook?: ModelProfileTransactionFaultHook } = {},
): Promise<"changed"> {
  const targets = resolveTargets(inputTargets);
  const lock = await acquireLock(targets, options.faultHook);
  try {
    if (await readActiveJournal(targets)) throw new Error("A model profile transaction is already active; run recover before undo.");
    const history = await readHistory(targets);
    const last = history.at(-1);
    if (!last) throw new Error("No model profile transaction history is available to undo.");
    const [canonical, runtime] = await Promise.all([readFile(targets.canonicalPath, "utf8"), readFile(targets.runtimePath, "utf8")]);
    if (sha256(canonical) !== last.files.canonical.afterHash || sha256(runtime) !== last.files.runtime.afterHash) {
      throw new Error("Undo refused because intervening changes exist in one or both profile files.");
    }
    await runUndoUnderHeldLock(targets, last, options.faultHook);
    return "changed";
  } finally {
    await releaseLock(targets, lock);
  }
}

async function runUndoUnderHeldLock(targets: ResolvedTargets, last: JournalRecord, faultHook?: ModelProfileTransactionFaultHook): Promise<void> {
  const record = makeRecord(
    targets,
    "undo",
    { canonicalContent: last.files.canonical.afterContent, runtimeContent: last.files.runtime.afterContent },
    { canonicalContent: last.files.canonical.beforeContent, runtimeContent: last.files.runtime.beforeContent },
  );
  await writeActiveJournal(targets, record);
  await faultHook?.("after-journal");

  await replaceFile(targets.canonicalPath, record.files.canonical.beforeContent, record.files.canonical.afterContent, "canonical", faultHook);
  record.phase = "canonical-replaced";
  await writeActiveJournal(targets, record);
  await faultHook?.("after-replace:canonical");

  await replaceFile(targets.runtimePath, record.files.runtime.beforeContent, record.files.runtime.afterContent, "runtime", faultHook);
  record.phase = "runtime-replaced";
  await writeActiveJournal(targets, record);
  await faultHook?.("after-replace:runtime");

  await commitRecord(record, targets);
}

export async function inspectModelProfileTransactions(inputTargets: ModelProfileTransactionTargets): Promise<ModelProfileTransactionInspection> {
  const targets = resolveTargets(inputTargets);
  const diagnostics: ModelProfileTransactionInspection["diagnostics"] = [];
  let active: ModelProfileTransactionInspection["active"] = null;
  try {
    const record = await readActiveJournal(targets);
    active = record ? { id: record.id, operation: record.operation, phase: record.phase, createdAt: record.createdAt } : null;
  } catch (error) {
    active = null;
    diagnostics.push({ area: "active", message: error instanceof Error ? error.message : String(error) });
  }

  let lock: ModelProfileTransactionInspection["lock"] = { state: "none" };
  try {
    const existing = await readLock(targets.lockPath);
    lock = { state: "present", pid: existing.pid, createdAt: existing.createdAt };
  } catch (error) {
    const code = isObject(error) && typeof error.code === "string" ? error.code : "";
    if (code !== "ENOENT") lock = { state: "ambiguous", reason: error instanceof Error ? error.message : String(error) };
  }

  let history: ModelProfileTransactionInspection["history"] = [];
  try {
    history = (await readHistory(targets)).map((record) => ({ id: record.id, operation: record.operation, committedAt: record.committedAt! }));
  } catch (error) {
    history = [];
    diagnostics.push({ area: "history", message: error instanceof Error ? error.message : String(error) });
  }

  return { targets: { canonicalPath: targets.canonicalPath, runtimePath: targets.runtimePath, journalDir: targets.journalDir }, active, lock, history, diagnostics };
}
