import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  RESERVED_COMMAND_NAMES,
  SUPPORTED_EFFORTS,
  assertProfilesCoverManifest,
  deriveCanonicalProfile,
  deriveRuntimeConfig,
  deriveRuntimeModelProfiles,
  managedAgents,
  registeredProfileNames,
  validateManifest,
  validateNamedProfile,
  validateProfileSet,
  type ModelProfilesManifest,
  type ValidatedModelProfile,
} from "../extensions/model-profiles/core.ts";

const expectedSddAgents = [
  "sdd-init",
  "sdd-explore",
  "sdd-research",
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
];
const expectedOddAgents = ["gentle-ai-explore", "gentle-ai-worker", "gentle-ai-verify"];
const expectedAgents = [...expectedSddAgents, ...expectedOddAgents];

async function readJson(path: string): Promise<unknown> {
  return JSON.parse(await readFile(path, "utf8"));
}

async function packagedManifest(): Promise<ModelProfilesManifest> {
  return validateManifest(await readJson("config/model-profiles.manifest.json"));
}

async function packagedProfiles(manifest: ModelProfilesManifest): Promise<Record<string, ValidatedModelProfile>> {
  return validateProfileSet({
    openai: await readJson("config/models.openai.json"),
    grok: await readJson("config/models.grok.json"),
  }, manifest);
}

function validManifestPatch(patch: Record<string, unknown>): unknown {
  return {
    schemaVersion: 1,
    defaultProfile: "openai",
    managedAgentGroups: {
      sdd: expectedSddAgents,
      odd: expectedOddAgents,
    },
    reservedCommandNames: [...RESERVED_COMMAND_NAMES],
    profiles: [
      { name: "openai", modelsFile: "models.openai.json" },
      { name: "grok", modelsFile: "models.grok.json" },
    ],
    ...patch,
  };
}

function validProfilePatch(patch: Record<string, unknown>): Record<string, unknown> {
  return {
    ...Object.fromEntries(expectedAgents.map((agent) => [agent, { model: "provider/model", thinking: "medium" }])),
    ...patch,
  };
}

test("packaged manifest registers versioned profiles and complete managed agent groups", async () => {
  const manifest = await packagedManifest();

  assert.equal(manifest.schemaVersion, 1);
  assert.equal(manifest.defaultProfile, "openai");
  assert.deepEqual(manifest.managedAgentGroups, {
    sdd: expectedSddAgents,
    odd: expectedOddAgents,
  });
  assert.deepEqual(manifest.reservedCommandNames, [...RESERVED_COMMAND_NAMES]);
  assert.deepEqual(manifest.profiles, [
    { name: "openai", modelsFile: "models.openai.json" },
    { name: "grok", modelsFile: "models.grok.json" },
  ]);
  assert.deepEqual(managedAgents(manifest), expectedAgents);
  assert.deepEqual(registeredProfileNames(manifest), ["openai", "grok"]);
});

test("named packaged profiles contain sdd-research matching sdd-explore and exact managed coverage", async () => {
  const manifest = await packagedManifest();
  const profiles = await packagedProfiles(manifest);
  assertProfilesCoverManifest(profiles, manifest);

  assert.deepEqual(Object.keys(profiles.openai), expectedAgents);
  assert.deepEqual(profiles.openai["sdd-research"], profiles.openai["sdd-explore"]);
  assert.deepEqual(profiles.grok["sdd-research"], profiles.grok["sdd-explore"]);

  assert.deepEqual(profiles.openai["sdd-research"], { model: "openai-codex/gpt-5.6-sol", thinking: "medium" });
  assert.deepEqual(profiles.grok["sdd-research"], { model: "xai/grok-4.6", thinking: "xhigh" });

  for (const profile of Object.values(profiles)) {
    for (const entry of Object.values(profile)) {
      assert.match(entry.model, /^[^/\s]+\/[^/\s]+$/);
      assert.equal(SUPPORTED_EFFORTS.includes(entry.thinking), true);
    }
  }
});

test("manifest validation rejects unsupported versions, missing groups, duplicate names, and reserved commands", () => {
  assert.throws(() => validateManifest(validManifestPatch({ schemaVersion: 2 })), /schemaVersion must be 1/);
  assert.throws(() => validateManifest(validManifestPatch({ managedAgentGroups: { sdd: expectedSddAgents } })), /managedAgentGroups.*expected keys/);
  assert.throws(() => validateManifest(validManifestPatch({
    managedAgentGroups: { sdd: ["sdd-init", "sdd-init"], odd: expectedOddAgents },
  })), /duplicate value 'sdd-init'/);
  assert.throws(() => validateManifest(validManifestPatch({
    profiles: [
      { name: "openai", modelsFile: "models.openai.json" },
      { name: "openai", modelsFile: "models.openai.json" },
    ],
  })), /duplicate value 'openai'/);
  assert.throws(() => validateManifest(validManifestPatch({
    profiles: [{ name: "status", modelsFile: "models.status.json" }],
    defaultProfile: "status",
  })), /reserved for commands/);
  assert.throws(() => validateManifest(validManifestPatch({ defaultProfile: "missing" })), /not registered/);
  assert.throws(() => validateManifest(validManifestPatch({
    profiles: [{ name: "Unsafe_Name", modelsFile: "models.Unsafe_Name.json" }],
  })), /safe lowercase command name/);
});

test("profile validation rejects malformed objects, coverage drift, invalid identifiers, and invalid effort values", () => {
  const manifest = validateManifest(validManifestPatch({}));
  assert.throws(() => validateNamedProfile([], manifest, "arrayProfile"), /must be a JSON object/);

  const missing = validProfilePatch({});
  delete (missing as Record<string, unknown>)["sdd-research"];
  assert.throws(() => validateNamedProfile(missing, manifest, "missingProfile"), /missing: sdd-research/);

  const extra = validProfilePatch({ "unknown-agent": { model: "provider/model", thinking: "medium" } });
  assert.throws(() => validateNamedProfile(extra, manifest, "extraProfile"), /extra: unknown-agent/);

  assert.throws(() => validateNamedProfile(validProfilePatch({ "sdd-init": [] }), manifest, "badEntry"), /must be a JSON object/);
  assert.throws(() => validateNamedProfile(validProfilePatch({ "sdd-init": { model: "provider/model", thinking: "medium", extra: true } }), manifest, "badEntry"), /expected keys/);
  assert.throws(() => validateNamedProfile(validProfilePatch({ "sdd-init": { model: "provider-only", thinking: "medium" } }), manifest, "badModel"), /provider\/model identifier/);
  assert.throws(() => validateNamedProfile(validProfilePatch({ "sdd-init": { model: "provider/model", thinking: "extreme" } }), manifest, "badEffort"), /must be one of/);

  assert.throws(() => validateProfileSet({ openai: validProfilePatch({}) }, manifest), /missing: grok/);
  assert.throws(() => validateProfileSet({ openai: validProfilePatch({}), grok: validProfilePatch({}), other: validProfilePatch({}) }, manifest), /extra: other/);
});

test("canonical and runtime derivation are pure and map thinking to effort", async () => {
  const manifest = await packagedManifest();
  const profiles = await packagedProfiles(manifest);
  const canonical = deriveCanonicalProfile(profiles.openai, manifest);
  const runtimeProfiles = deriveRuntimeModelProfiles(profiles.openai, manifest);
  const runtimeConfig = deriveRuntimeConfig(profiles.openai, manifest, {
    preserved: true,
    model_profiles: {
      unrelatedAgent: { model: "keep/runtime", effort: "low" },
      "sdd-research": { model: "stale/research", effort: "low" },
    },
  });

  assert.notEqual(canonical, profiles.openai);
  assert.notEqual(canonical["sdd-research"], profiles.openai["sdd-research"]);
  assert.deepEqual(canonical, profiles.openai);
  assert.deepEqual(runtimeProfiles["sdd-research"], { model: "openai-codex/gpt-5.6-sol", effort: "medium" });
  assert.deepEqual(runtimeConfig, {
    preserved: true,
    model_profiles: {
      unrelatedAgent: { model: "keep/runtime", effort: "low" },
      ...runtimeProfiles,
    },
  });

  canonical["sdd-research"].thinking = "low";
  assert.equal(profiles.openai["sdd-research"].thinking, "medium");
});
