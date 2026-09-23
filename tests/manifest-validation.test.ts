import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";

import {
  RESERVED_COMMAND_NAMES,
  assertProfilesCoverManifest,
  deriveCanonicalProfile,
  deriveCanonicalProfileForSelection,
  deriveRuntimeConfig,
  deriveRuntimeConfigForSelection,
  deriveRuntimeModelProfiles,
  deriveRuntimeModelProfilesForSelection,
  managedAgents,
  registeredProfileNames,
  validateManifest,
  validateNamedProfile,
  validateProfileSet,
  type ModelProfileEntry,
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
const expectedOddAgents = ["gentle-ai-explore", "gentle-ai-worker", "gentle-ai-verify", "orchestrator"];
const expectedJudgeAgents = [
  "review-risk",
  "review-resilience",
  "review-readability",
  "review-reliability",
  "review-refuter",
  "review-validator",
  "jd-judge-a",
  "jd-judge-b",
];
const expectedAgents = [...expectedSddAgents, ...expectedOddAgents, ...expectedJudgeAgents];
const expectedNonJudgeAgents = [...expectedSddAgents, ...expectedOddAgents];
const roleExpansion: Record<string, string[]> = {
  orquestador: ["orchestrator"],
  razonamiento: [
    "sdd-explore",
    "sdd-research",
    "sdd-proposal",
    "sdd-design",
    "sdd-verify",
    "gentle-ai-explore",
    "gentle-ai-verify",
    ...expectedJudgeAgents,
  ],
  codigo: ["sdd-apply", "gentle-ai-worker"],
  liviano: ["sdd-init", "sdd-spec", "sdd-tasks", "sdd-onboard", "sdd-archive", "sdd-status", "sdd-sync"],
};
const expectedOppositePairs: Record<string, string> = {
  "gpt-5.6-low-cost": "grok-low-cost",
  "gpt-5.6-recommended": "grok-recommended",
  "gpt-5.6-powerful": "grok-powerful",
  "gpt-astra-low-cost": "grok-low-cost",
  "gpt-astra-recommended": "grok-recommended",
  "gpt-astra-powerful": "grok-powerful",
  "gpt-astra-only-low-cost": "grok-low-cost",
  "gpt-astra-only-recommended": "grok-recommended",
  "gpt-astra-only-powerful": "grok-powerful",
  "grok-low-cost": "gpt-5.6-low-cost",
  "grok-recommended": "gpt-5.6-recommended",
  "grok-powerful": "gpt-5.6-powerful",
  openai: "grok",
  grok: "openai",
};

type NamedProfilesCatalog = {
  schemaVersion: 1;
  roles: string[];
  profiles: Array<{
    name: string;
    roles: Record<string, ModelProfileEntry>;
  }>;
};

async function readJson(path: string): Promise<any> {
  return JSON.parse(await readFile(path, "utf8"));
}

async function packagedManifest(): Promise<ModelProfilesManifest> {
  return validateManifest(await readJson("config/model-profiles.manifest.json"));
}

async function packagedNamedProfiles(): Promise<NamedProfilesCatalog> {
  return await readJson("config/named-profiles.json");
}

async function packagedProfiles(manifest: ModelProfilesManifest): Promise<Record<string, ValidatedModelProfile>> {
  const inputs: Record<string, unknown> = {};
  for (const profile of manifest.profiles) {
    inputs[profile.name] = await readJson(join("config", profile.modelsFile));
  }
  return validateProfileSet(inputs, manifest);
}

function expectedFullProfile(namedProfile: NamedProfilesCatalog["profiles"][number]): ValidatedModelProfile {
  const entries: Array<[string, ModelProfileEntry]> = [];
  for (const [role, agents] of Object.entries(roleExpansion)) {
    for (const agent of agents) entries.push([agent, { ...namedProfile.roles[role] }]);
  }
  return Object.fromEntries(entries);
}

function validManifestPatch(patch: Record<string, unknown>): unknown {
  return {
    schemaVersion: 1,
    defaultProfile: "gpt-5.6-recommended",
    managedAgentGroups: {
      sdd: expectedSddAgents,
      odd: expectedOddAgents,
    },
    reservedCommandNames: [...RESERVED_COMMAND_NAMES],
    oppositeProviderJudges: {
      enabled: true,
      agents: expectedJudgeAgents,
      profilePairs: {
        "gpt-5.6-recommended": "grok-recommended",
        "grok-recommended": "gpt-5.6-recommended",
      },
    },
    profiles: [
      { name: "gpt-5.6-recommended", modelsFile: "models.gpt-5.6-recommended.json" },
      { name: "grok-recommended", modelsFile: "models.grok-recommended.json" },
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

test("package version is 1.1.0", async () => {
  assert.equal((await readJson("package.json")).version, "1.1.0");
});

test("packaged manifest defaults to openaigentle and registers named profiles plus compatibility aliases", async () => {
  const manifest = await packagedManifest();
  const catalog = await packagedNamedProfiles();
  const namedProfileNames = catalog.profiles.map((profile) => profile.name);
  const expectedRegisteredNames = ["openai", "openaigentle", "grok", ...namedProfileNames];

  assert.equal(manifest.schemaVersion, 1);
  assert.equal(manifest.defaultProfile, "openaigentle");
  assert.deepEqual(manifest.managedAgentGroups, {
    sdd: expectedSddAgents,
    odd: expectedOddAgents,
  });
  assert.deepEqual(manifest.reservedCommandNames, [...RESERVED_COMMAND_NAMES]);
  assert.deepEqual(manifest.oppositeProviderJudges, {
    enabled: true,
    agents: expectedJudgeAgents,
    profilePairs: expectedOppositePairs,
  });
  assert.deepEqual(manifest.profiles, expectedRegisteredNames.map((name) => ({ name, modelsFile: `models.${name}.json` })));
  assert.deepEqual(managedAgents(manifest), expectedAgents);
  assert.deepEqual(registeredProfileNames(manifest), expectedRegisteredNames);
});

test("manifests without configured opposite-provider judges preserve legacy managed coverage", () => {
  const legacyManifest = validateManifest({
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
  });

  assert.deepEqual(legacyManifest.oppositeProviderJudges, { enabled: true, agents: [], profilePairs: {} });
  assert.deepEqual(managedAgents(legacyManifest), expectedNonJudgeAgents);

  const emptyJudgesManifest = validateManifest(validManifestPatch({ oppositeProviderJudges: { agents: [] } }));
  assert.deepEqual(emptyJudgesManifest.oppositeProviderJudges, { enabled: true, agents: [], profilePairs: {} });
  assert.deepEqual(managedAgents(emptyJudgesManifest), expectedNonJudgeAgents);
});

test("generated packaged named profiles equal role expansion from named-profiles.json", async () => {
  const manifest = await packagedManifest();
  const catalog = await packagedNamedProfiles();
  const profiles = await packagedProfiles(manifest);
  assertProfilesCoverManifest(profiles, manifest);

  for (const namedProfile of catalog.profiles) {
    assert.deepEqual(Object.keys(profiles[namedProfile.name]), expectedAgents);
    assert.deepEqual(profiles[namedProfile.name], expectedFullProfile(namedProfile));
  }

  assert.deepEqual(profiles.openai, profiles["gpt-5.6-recommended"]);
  assert.deepEqual(profiles.grok, profiles["grok-recommended"]);

  for (const profile of Object.values(profiles)) {
    for (const entry of Object.values(profile)) {
      assert.match(entry.model, /^[^/\s]+\/[^/\s]+$/);
      assert.equal(typeof entry.thinking, "string");
      assert.notEqual(entry.thinking, "");
      assert.equal(entry.thinking, entry.thinking.trim());
    }
  }
});

test("openaigentle preserves the supplied GPT-6 mapping in canonical and runtime selections", async () => {
  const manifest = await packagedManifest();
  const profiles = await packagedProfiles(manifest);
  const expected = Object.fromEntries([
    ...["sdd-init", "sdd-onboard", "sdd-status", "sdd-sync", "orchestrator"].map((agent) =>
      [agent, { model: "openai-codex/gpt-6-sol", thinking: "medium" }]),
    ...["sdd-explore", "sdd-spec", "sdd-tasks", "gentle-ai-explore"].map((agent) =>
      [agent, { model: "openai-codex/gpt-6-luna", thinking: "high" }]),
    ["sdd-archive", { model: "openai-codex/gpt-6-luna", thinking: "max" }],
    ...["sdd-apply", "gentle-ai-worker"].map((agent) =>
      [agent, { model: "openai-codex/gpt-6-sol", thinking: "low" }]),
    ...["sdd-research", "sdd-proposal", "sdd-design", "sdd-verify", "gentle-ai-verify", ...expectedJudgeAgents].map((agent) =>
      [agent, { model: "openai-codex/gpt-6-sol", thinking: "high" }]),
  ]);

  assert.deepEqual(profiles.openaigentle, expected);
  assert.deepEqual(deriveCanonicalProfileForSelection(manifest.defaultProfile, profiles, manifest), expected);
  assert.deepEqual(deriveRuntimeModelProfilesForSelection(manifest.defaultProfile, profiles, manifest),
    Object.fromEntries(Object.entries(expected).map(([agent, entry]) =>
      [agent, { model: entry.model, effort: entry.thinking }])));
});

test("manifest validation rejects unsupported versions, missing groups, duplicate names, and reserved commands", () => {
  assert.throws(() => validateManifest(validManifestPatch({ schemaVersion: 2 })), /schemaVersion must be 1/);
  assert.throws(() => validateManifest(validManifestPatch({ managedAgentGroups: { sdd: expectedSddAgents } })), /managedAgentGroups.*expected keys/);
  assert.throws(() => validateManifest(validManifestPatch({
    managedAgentGroups: { sdd: ["sdd-init", "sdd-init"], odd: expectedOddAgents },
  })), /duplicate value 'sdd-init'/);
  assert.throws(() => validateManifest(validManifestPatch({
    profiles: [
      { name: "gpt-5.6-recommended", modelsFile: "models.gpt-5.6-recommended.json" },
      { name: "gpt-5.6-recommended", modelsFile: "models.gpt-5.6-recommended.json" },
    ],
  })), /duplicate value 'gpt-5.6-recommended'/);
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

  for (const agent of ["sdd-research", "orchestrator", "review-refuter", "review-validator"]) {
    const missing = validProfilePatch({});
    delete missing[agent];
    assert.throws(() => validateNamedProfile(missing, manifest, "missingProfile"), new RegExp(`missing: ${agent}`));
  }

  const extra = validProfilePatch({ "unknown-agent": { model: "provider/model", thinking: "medium" } });
  assert.throws(() => validateNamedProfile(extra, manifest, "extraProfile"), /extra: unknown-agent/);

  assert.throws(() => validateNamedProfile(validProfilePatch({ "sdd-init": [] }), manifest, "badEntry"), /must be a JSON object/);
  assert.throws(() => validateNamedProfile(validProfilePatch({ "sdd-init": { model: "provider/model", thinking: "medium", extra: true } }), manifest, "badEntry"), /expected keys/);
  assert.throws(() => validateNamedProfile(validProfilePatch({ "sdd-init": { model: "provider-only", thinking: "medium" } }), manifest, "badModel"), /provider\/model identifier/);
  for (const thinking of ["", " ", "\t\n", " max", "max ", 0, false, null, [], {}]) {
    assert.throws(() => validateNamedProfile(validProfilePatch({
      "sdd-init": { model: "provider/model", thinking },
    }), manifest, "badEffort"), /thinking must be (?:a string|a non-empty, trimmed string)/);
  }
  assert.throws(() => validateNamedProfile(validProfilePatch({
    "sdd-init": { model: "provider/model" },
  }), manifest, "missingEffort"), /missing: thinking/);

  assert.throws(() => validateProfileSet({ "gpt-5.6-recommended": validProfilePatch({}) }, manifest), /missing: grok-recommended/);
  assert.throws(() => validateProfileSet({ "gpt-5.6-recommended": validProfilePatch({}), "grok-recommended": validProfilePatch({}), other: validProfilePatch({}) }, manifest), /extra: other/);
});

test("profile validation and derivation preserve arbitrary trimmed effort strings literally", () => {
  const manifest = validateManifest(validManifestPatch({}));
  for (const thinking of ["low", "medium", "high", "xhigh", "max", "extreme", "Provider.Custom-v2", "custom effort"]) {
    const input = validProfilePatch({ "sdd-init": { model: "provider/model", thinking } });
    const validated = validateNamedProfile(input, manifest);
    assert.deepEqual(validated["sdd-init"], input["sdd-init"]);
    assert.deepEqual(deriveCanonicalProfile(validated, manifest)["sdd-init"], input["sdd-init"]);
    assert.deepEqual(deriveRuntimeModelProfiles(validated, manifest)["sdd-init"], {
      model: "provider/model", effort: thinking,
    });
  }
});

test("opposite-provider judge derivation pairs representative named profiles by provider and cost lane", async () => {
  const manifest = await packagedManifest();
  const profiles = await packagedProfiles(manifest);
  const lowCostEffective = deriveCanonicalProfileForSelection("gpt-5.6-low-cost", profiles, manifest);
  const astraOnlyEffective = deriveCanonicalProfileForSelection("gpt-astra-only-powerful", profiles, manifest);
  const grokRuntime = deriveRuntimeModelProfilesForSelection("grok-recommended", profiles, manifest);
  const disabledManifest = validateManifest(validManifestPatch({
    oppositeProviderJudges: {
      enabled: false,
      agents: expectedJudgeAgents,
      profilePairs: { "gpt-5.6-recommended": "grok-recommended", "grok-recommended": "gpt-5.6-recommended" },
    },
  }));
  const disabledOpenaiProfile = Object.fromEntries(expectedAgents.map((agent) => [agent, { model: `openai/${agent}`, thinking: "medium" }]));
  const disabledGrokProfile = Object.fromEntries(expectedAgents.map((agent) => [agent, { model: `xai/${agent}`, thinking: "xhigh" }]));
  assert.throws(() => validateProfileSet({
    "gpt-5.6-recommended": Object.fromEntries(expectedNonJudgeAgents.map((agent) => [agent, { model: `openai/${agent}`, thinking: "medium" }])),
    "grok-recommended": Object.fromEntries(expectedNonJudgeAgents.map((agent) => [agent, { model: `xai/${agent}`, thinking: "xhigh" }])),
  }, disabledManifest), /missing: review-risk/);
  const disabledProfiles = validateProfileSet({
    "gpt-5.6-recommended": disabledOpenaiProfile,
    "grok-recommended": disabledGrokProfile,
  }, disabledManifest);
  const disabledOpenaiEffective = deriveCanonicalProfileForSelection("gpt-5.6-recommended", disabledProfiles, disabledManifest);
  const disabledOpenaiRuntime = deriveRuntimeModelProfilesForSelection("gpt-5.6-recommended", disabledProfiles, disabledManifest);

  assert.deepEqual(lowCostEffective["sdd-init"], profiles["gpt-5.6-low-cost"]["sdd-init"]);
  assert.deepEqual(lowCostEffective.orchestrator, profiles["gpt-5.6-low-cost"].orchestrator);
  for (const agent of expectedJudgeAgents) {
    assert.deepEqual(lowCostEffective[agent], profiles["grok-low-cost"][agent]);
    assert.deepEqual(astraOnlyEffective[agent], profiles["grok-powerful"][agent]);
    assert.deepEqual(disabledOpenaiEffective[agent], disabledProfiles["gpt-5.6-recommended"][agent]);
  }
  assert.deepEqual(astraOnlyEffective["review-risk"], profiles["grok-powerful"]["review-risk"]);
  assert.deepEqual(grokRuntime["gentle-ai-worker"], { model: profiles["grok-recommended"]["gentle-ai-worker"].model, effort: profiles["grok-recommended"]["gentle-ai-worker"].thinking });
  assert.deepEqual(grokRuntime["jd-judge-a"], { model: profiles["gpt-5.6-recommended"]["jd-judge-a"].model, effort: profiles["gpt-5.6-recommended"]["jd-judge-a"].thinking });
  assert.deepEqual(managedAgents(disabledManifest), expectedAgents);
  assert.deepEqual(disabledOpenaiEffective["review-risk"], { model: "openai/review-risk", thinking: "medium" });
  assert.deepEqual(disabledOpenaiRuntime["jd-judge-a"], { model: "openai/jd-judge-a", effort: "medium" });
  assert.deepEqual(deriveRuntimeConfigForSelection("gpt-5.6-recommended", profiles, manifest, {
    model_profiles: { unrelatedAgent: { model: "keep/runtime", effort: "low" } },
  }).model_profiles, {
    unrelatedAgent: { model: "keep/runtime", effort: "low" },
    ...deriveRuntimeModelProfilesForSelection("gpt-5.6-recommended", profiles, manifest),
  });
});

test("canonical and runtime derivation are pure and map thinking to effort", async () => {
  const manifest = await packagedManifest();
  const profiles = await packagedProfiles(manifest);
  const defaultProfile = profiles[manifest.defaultProfile];
  const canonical = deriveCanonicalProfile(defaultProfile, manifest);
  const runtimeProfiles = deriveRuntimeModelProfiles(defaultProfile, manifest);
  const runtimeConfig = deriveRuntimeConfig(defaultProfile, manifest, {
    preserved: true,
    model_profiles: {
      unrelatedAgent: { model: "keep/runtime", effort: "low" },
      "sdd-research": { model: "stale/research", effort: "low" },
    },
  });

  assert.notEqual(canonical, defaultProfile);
  assert.notEqual(canonical["sdd-research"], defaultProfile["sdd-research"]);
  assert.deepEqual(canonical, defaultProfile);
  assert.deepEqual(runtimeProfiles["sdd-research"], { model: defaultProfile["sdd-research"].model, effort: defaultProfile["sdd-research"].thinking });
  assert.deepEqual(runtimeConfig, {
    preserved: true,
    model_profiles: {
      unrelatedAgent: { model: "keep/runtime", effort: "low" },
      ...runtimeProfiles,
    },
  });

  const originalResearchThinking = defaultProfile["sdd-research"].thinking;
  canonical["sdd-research"].thinking = "low";
  assert.equal(defaultProfile["sdd-research"].thinking, originalResearchThinking);
});
