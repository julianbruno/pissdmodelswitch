export const SUPPORTED_SCHEMA_VERSION = 1;
export const REQUIRED_MANAGED_AGENT_GROUPS = ["sdd", "odd"] as const;
export const KNOWN_OPPOSITE_PROVIDER_JUDGES = [
  "review-risk",
  "review-resilience",
  "review-readability",
  "review-reliability",
  "jd-judge-a",
  "jd-judge-b",
] as const;
export const SUPPORTED_EFFORTS = ["low", "medium", "high", "xhigh"] as const;
export const RESERVED_COMMAND_NAMES = ["status", "list", "preview", "doctor", "undo", "recover"] as const;

export type ManagedAgentGroupName = (typeof REQUIRED_MANAGED_AGENT_GROUPS)[number];
export type ModelEffort = (typeof SUPPORTED_EFFORTS)[number];
export type JsonObject = Record<string, unknown>;

export type ModelProfileEntry = {
  model: string;
  thinking: ModelEffort;
};

export type RuntimeModelProfileEntry = {
  model: string;
  effort: ModelEffort;
};

export type ProfileRegistration = {
  name: string;
  modelsFile: string;
};

export type OppositeProviderJudgesConfig = {
  enabled: boolean;
  agents: string[];
  profilePairs: Record<string, string>;
};

export type ModelProfilesManifest = {
  schemaVersion: typeof SUPPORTED_SCHEMA_VERSION;
  defaultProfile: string;
  managedAgentGroups: Record<ManagedAgentGroupName, string[]>;
  reservedCommandNames: string[];
  oppositeProviderJudges: OppositeProviderJudgesConfig;
  profiles: ProfileRegistration[];
};

export type ValidatedModelProfile = Record<string, ModelProfileEntry>;
export type RuntimeModelProfiles = Record<string, RuntimeModelProfileEntry>;

const safeNamePattern = /^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)*$/;
const providerModelPattern = /^[^/\s]+\/[^/\s]+$/;
const supportedEffortSet = new Set<string>(SUPPORTED_EFFORTS);
const builtInReservedCommandSet = new Set<string>(RESERVED_COMMAND_NAMES);
const knownOppositeProviderJudgeSet = new Set<string>(KNOWN_OPPOSITE_PROVIDER_JUDGES);

export class ModelProfileValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ModelProfileValidationError";
  }
}

function fail(message: string): never {
  throw new ModelProfileValidationError(message);
}

export function isJsonObject(value: unknown): value is JsonObject {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function assertJsonObject(value: unknown, label: string): JsonObject {
  if (!isJsonObject(value)) fail(`${label} must be a JSON object.`);
  return value;
}

function assertString(value: unknown, label: string): string {
  if (typeof value !== "string") fail(`${label} must be a string.`);
  return value;
}

function assertBoolean(value: unknown, label: string): boolean {
  if (typeof value !== "boolean") fail(`${label} must be a boolean.`);
  return value;
}

function assertStringArray(value: unknown, label: string): string[] {
  if (!Array.isArray(value)) fail(`${label} must be an array.`);
  return value.map((item, index) => assertString(item, `${label}[${index}]`));
}

function assertSafeName(value: string, label: string): void {
  if (!safeNamePattern.test(value)) fail(`${label} must be a safe lowercase command name.`);
}

function assertUnique(values: readonly string[], label: string): void {
  const seen = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) fail(`${label} contains duplicate value '${value}'.`);
    seen.add(value);
  }
}

function objectKeys(value: JsonObject): string[] {
  return Object.keys(value);
}

function sorted(values: Iterable<string>): string[] {
  return [...values].sort((left, right) => left.localeCompare(right));
}

function describeSet(values: Iterable<string>): string {
  return sorted(values).join(", ");
}

function exactKeys(value: JsonObject, expected: readonly string[], label: string): void {
  const actual = objectKeys(value);
  const expectedSet = new Set(expected);
  const actualSet = new Set(actual);
  const missing = expected.filter((key) => !actualSet.has(key));
  const extra = actual.filter((key) => !expectedSet.has(key));
  if (missing.length || extra.length || actual.length !== expected.length) {
    const details = [
      missing.length ? `missing: ${missing.join(", ")}` : "",
      extra.length ? `extra: ${extra.join(", ")}` : "",
    ].filter(Boolean).join("; ");
    fail(`${label} must contain exactly ${expected.length} expected keys${details ? ` (${details})` : ""}.`);
  }
}

function assertProfileRegistration(value: unknown, index: number): ProfileRegistration {
  const object = assertJsonObject(value, `profiles[${index}]`);
  exactKeys(object, ["name", "modelsFile"], `profiles[${index}]`);
  const name = assertString(object.name, `profiles[${index}].name`);
  const modelsFile = assertString(object.modelsFile, `profiles[${index}].modelsFile`);
  assertSafeName(name, `profiles[${index}].name`);
  if (modelsFile !== `models.${name}.json`) {
    fail(`profiles[${index}].modelsFile must be models.${name}.json.`);
  }
  return { name, modelsFile };
}

function assertManifestReservedNames(value: unknown): string[] {
  const reserved = value === undefined ? [...RESERVED_COMMAND_NAMES] : assertStringArray(value, "reservedCommandNames");
  for (const [index, name] of reserved.entries()) assertSafeName(name, `reservedCommandNames[${index}]`);
  assertUnique(reserved, "reservedCommandNames");
  return reserved;
}

function assertOppositeProviderJudges(
  value: unknown,
  managedAgentGroups: Record<ManagedAgentGroupName, string[]>,
  profileNames: readonly string[],
): OppositeProviderJudgesConfig {
  if (value === undefined) return { enabled: true, agents: [], profilePairs: {} };
  const object = assertJsonObject(value, "oppositeProviderJudges");
  const expectedKeys = new Set(["enabled", "agents", "profilePairs"]);
  const extra = objectKeys(object).filter((key) => !expectedKeys.has(key));
  if (extra.length) fail(`oppositeProviderJudges contains unsupported key${extra.length === 1 ? "" : "s"}: ${extra.join(", ")}.`);

  const enabled = object.enabled === undefined ? true : assertBoolean(object.enabled, "oppositeProviderJudges.enabled");
  const agents = object.agents === undefined ? [] : assertStringArray(object.agents, "oppositeProviderJudges.agents");
  for (const [index, agent] of agents.entries()) {
    assertSafeName(agent, `oppositeProviderJudges.agents[${index}]`);
    if (!knownOppositeProviderJudgeSet.has(agent)) fail(`oppositeProviderJudges.agents[${index}] must be a known judge/reviewer agent.`);
  }
  assertUnique(agents, "oppositeProviderJudges.agents");
  const groupedAgents = new Set(Object.values(managedAgentGroups).flat());
  for (const agent of agents) {
    if (groupedAgents.has(agent)) fail(`oppositeProviderJudges.agents contains managed agent '${agent}'.`);
  }

  const profilePairsInput = object.profilePairs === undefined ? {} : assertJsonObject(object.profilePairs, "oppositeProviderJudges.profilePairs");
  const profileNameSet = new Set(profileNames);
  const profilePairs: Record<string, string> = {};
  for (const [source, targetValue] of Object.entries(profilePairsInput)) {
    assertSafeName(source, `oppositeProviderJudges.profilePairs.${source}`);
    const target = assertString(targetValue, `oppositeProviderJudges.profilePairs.${source}`);
    assertSafeName(target, `oppositeProviderJudges.profilePairs.${source}`);
    if (!profileNameSet.has(source)) fail(`oppositeProviderJudges.profilePairs source '${source}' is not registered.`);
    if (!profileNameSet.has(target)) fail(`oppositeProviderJudges.profilePairs target '${target}' is not registered.`);
    profilePairs[source] = target;
  }

  return { enabled, agents, profilePairs };
}

function assertManagedAgentGroups(value: unknown): Record<ManagedAgentGroupName, string[]> {
  const groups = assertJsonObject(value, "managedAgentGroups");
  exactKeys(groups, [...REQUIRED_MANAGED_AGENT_GROUPS], "managedAgentGroups");

  const result = {} as Record<ManagedAgentGroupName, string[]>;
  const allAgents: string[] = [];
  for (const groupName of REQUIRED_MANAGED_AGENT_GROUPS) {
    const agents = assertStringArray(groups[groupName], `managedAgentGroups.${groupName}`);
    if (!agents.length) fail(`managedAgentGroups.${groupName} must not be empty.`);
    agents.forEach((agent, index) => assertSafeName(agent, `managedAgentGroups.${groupName}[${index}]`));
    assertUnique(agents, `managedAgentGroups.${groupName}`);
    result[groupName] = agents;
    allAgents.push(...agents);
  }
  assertUnique(allAgents, "managedAgentGroups");
  return result;
}

export function managedAgentGroups(manifest: ModelProfilesManifest): string[] {
  return REQUIRED_MANAGED_AGENT_GROUPS.flatMap((groupName) => manifest.managedAgentGroups[groupName]);
}

export function configuredOppositeProviderJudgeAgents(manifest: ModelProfilesManifest): string[] {
  return manifest.oppositeProviderJudges.agents;
}

export function activeOppositeProviderJudgeAgents(manifest: ModelProfilesManifest): string[] {
  return manifest.oppositeProviderJudges.enabled ? configuredOppositeProviderJudgeAgents(manifest) : [];
}

export function managedAgents(manifest: ModelProfilesManifest): string[] {
  return [...managedAgentGroups(manifest), ...configuredOppositeProviderJudgeAgents(manifest)];
}

export function registeredProfileNames(manifest: ModelProfilesManifest): string[] {
  return manifest.profiles.map((profile) => profile.name);
}

export function validateManifest(input: unknown): ModelProfilesManifest {
  const object = assertJsonObject(input, "manifest");
  const schemaVersion = object.schemaVersion;
  if (schemaVersion !== SUPPORTED_SCHEMA_VERSION) {
    fail(`manifest.schemaVersion must be ${SUPPORTED_SCHEMA_VERSION}.`);
  }

  const reservedCommandNames = assertManifestReservedNames(object.reservedCommandNames);
  const reserved = new Set([...builtInReservedCommandSet, ...reservedCommandNames]);
  const managedAgentGroups = assertManagedAgentGroups(object.managedAgentGroups);

  if (!Array.isArray(object.profiles) || object.profiles.length === 0) {
    fail("profiles must be a non-empty array.");
  }
  const profiles = object.profiles.map(assertProfileRegistration);
  const profileNames = profiles.map((profile) => profile.name);
  assertUnique(profileNames, "profiles.name");
  for (const name of profileNames) {
    if (reserved.has(name)) fail(`profile name '${name}' is reserved for commands.`);
  }

  const oppositeProviderJudges = assertOppositeProviderJudges(object.oppositeProviderJudges, managedAgentGroups, profileNames);

  const defaultProfile = assertString(object.defaultProfile, "defaultProfile");
  assertSafeName(defaultProfile, "defaultProfile");
  if (!profileNames.includes(defaultProfile)) fail(`defaultProfile '${defaultProfile}' is not registered.`);

  return {
    schemaVersion,
    defaultProfile,
    managedAgentGroups,
    reservedCommandNames,
    oppositeProviderJudges,
    profiles,
  };
}

function validateEntry(value: unknown, label: string): ModelProfileEntry {
  const object = assertJsonObject(value, label);
  exactKeys(object, ["model", "thinking"], label);
  const model = assertString(object.model, `${label}.model`);
  const thinking = assertString(object.thinking, `${label}.thinking`);

  if (model !== model.trim() || !providerModelPattern.test(model)) {
    fail(`${label}.model must be a non-empty provider/model identifier.`);
  }
  if (!supportedEffortSet.has(thinking)) {
    fail(`${label}.thinking must be one of: ${SUPPORTED_EFFORTS.join(", ")}.`);
  }
  return { model, thinking: thinking as ModelEffort };
}

export function validateNamedProfile(input: unknown, manifest: ModelProfilesManifest, profileName = "profile"): ValidatedModelProfile {
  const object = assertJsonObject(input, profileName);
  const agents = managedAgents(manifest);
  exactKeys(object, agents, profileName);
  return Object.fromEntries(agents.map((agent) => [agent, validateEntry(object[agent], `${profileName}.${agent}`)]));
}

export function validateProfileSet(input: unknown, manifest: ModelProfilesManifest): Record<string, ValidatedModelProfile> {
  const object = assertJsonObject(input, "profilesByName");
  const expectedNames = registeredProfileNames(manifest);
  exactKeys(object, expectedNames, "profilesByName");
  return Object.fromEntries(expectedNames.map((name) => [name, validateNamedProfile(object[name], manifest, name)]));
}

export function deriveCanonicalProfile(profile: ValidatedModelProfile, manifest: ModelProfilesManifest): ValidatedModelProfile {
  return Object.fromEntries(managedAgents(manifest).map((agent) => [agent, { ...profile[agent] }]));
}

export function deriveRuntimeModelProfiles(profile: ValidatedModelProfile, manifest: ModelProfilesManifest): RuntimeModelProfiles {
  return Object.fromEntries(
    managedAgents(manifest).map((agent) => [agent, { model: profile[agent].model, effort: profile[agent].thinking }]),
  );
}

export function deriveRuntimeConfig(profile: ValidatedModelProfile, manifest: ModelProfilesManifest, base: JsonObject = {}): JsonObject {
  const preservedModelProfiles = isJsonObject(base.model_profiles) ? base.model_profiles : {};
  return {
    ...base,
    model_profiles: {
      ...preservedModelProfiles,
      ...deriveRuntimeModelProfiles(profile, manifest),
    },
  };
}

export function deriveCanonicalProfileForSelection(
  profileName: string,
  profiles: Record<string, ValidatedModelProfile>,
  manifest: ModelProfilesManifest,
): ValidatedModelProfile {
  const selected = profiles[profileName];
  if (!selected) fail(`profile '${profileName}' is not registered.`);
  const oppositeName = manifest.oppositeProviderJudges.enabled ? manifest.oppositeProviderJudges.profilePairs[profileName] : undefined;
  const opposite = oppositeName ? profiles[oppositeName] : undefined;
  const judgeAgents = new Set(activeOppositeProviderJudgeAgents(manifest));

  return Object.fromEntries(managedAgents(manifest).map((agent) => {
    const source = judgeAgents.has(agent) && opposite ? opposite : selected;
    return [agent, { ...source[agent] }];
  }));
}

export function deriveRuntimeModelProfilesForSelection(
  profileName: string,
  profiles: Record<string, ValidatedModelProfile>,
  manifest: ModelProfilesManifest,
): RuntimeModelProfiles {
  return deriveRuntimeModelProfiles(deriveCanonicalProfileForSelection(profileName, profiles, manifest), manifest);
}

export function deriveRuntimeConfigForSelection(
  profileName: string,
  profiles: Record<string, ValidatedModelProfile>,
  manifest: ModelProfilesManifest,
  base: JsonObject = {},
): JsonObject {
  return deriveRuntimeConfig(deriveCanonicalProfileForSelection(profileName, profiles, manifest), manifest, base);
}

export function assertProfilesCoverManifest(profileByName: Record<string, ValidatedModelProfile>, manifest: ModelProfilesManifest): void {
  const names = registeredProfileNames(manifest);
  exactKeys(profileByName, names, "validatedProfiles");
  const requiredAgents = new Set(managedAgents(manifest));
  for (const name of names) {
    const actualAgents = new Set(Object.keys(profileByName[name]));
    if (actualAgents.size !== requiredAgents.size || describeSet(actualAgents) !== describeSet(requiredAgents)) {
      fail(`profile '${name}' does not match manifest managed agents.`);
    }
  }
}
