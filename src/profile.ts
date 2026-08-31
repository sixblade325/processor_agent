import { fileURLToPath } from "node:url";
import { dirname, parse as parsePath, resolve } from "node:path";
import { parse } from "yaml";
import { pathExists, readText, sha256 } from "./io.js";
import type {
  CommandSpec,
  ArchitectureRoleSpec,
  CounterRuleSpec,
  DecisionAcceptanceSpec,
  DecisionOption,
  DecisionSpec,
  LoadedProfile,
  GlobalProtocolSpec,
  ModuleSpec,
  ProjectProfile,
  ResearchPolicy,
  SharedFieldSpec,
  ScaffoldFileSpec,
} from "./types.js";

export async function loadProfile(reference: string): Promise<LoadedProfile> {
  const path = await resolveProfilePath(reference);
  const raw = await readText(path);
  const profile = validateProfile(parse(raw));
  return { profile, path, digest: sha256(raw) };
}

async function resolveProfilePath(reference: string): Promise<string> {
  const direct = resolve(reference);
  if (await pathExists(direct)) {
    return direct;
  }
  const packageRoot = await findPackageRoot(dirname(fileURLToPath(import.meta.url)));
  const fromPackage = resolve(packageRoot, "profiles", reference, "profile.yaml");
  if (await pathExists(fromPackage)) {
    return fromPackage;
  }
  throw new Error(`Profile not found: ${reference}`);
}

async function findPackageRoot(start: string): Promise<string> {
  let current = resolve(start);
  const root = parsePath(current).root;
  while (true) {
    if (await pathExists(resolve(current, "package.json"))) {
      return current;
    }
    if (current === root) {
      throw new Error(`Unable to locate processor-agent package root from ${start}`);
    }
    current = dirname(current);
  }
}

export function validateProfile(value: unknown): ProjectProfile {
  const root = object(value, "profile");
  const schemaVersion = number(root.schemaVersion, "schemaVersion");
  const architecture = validateArchitecture(root.architecture, schemaVersion);
  const profile: ProjectProfile = {
    schemaVersion,
    id: string(root.id, "id"),
    version: string(root.version, "version"),
    displayName: string(root.displayName, "displayName"),
    description: string(root.description, "description"),
    defaults: validateDefaults(root.defaults),
    environmentChecks: array(root.environmentChecks, "environmentChecks").map((item, index) =>
      validateCommand(item, `environmentChecks[${index}]`),
    ),
    decisions: array(root.decisions, "decisions").map((item, index) =>
      validateDecision(item, `decisions[${index}]`),
    ),
    architecture,
    verification: validateVerification(root.verification, schemaVersion),
    scaffold: validateScaffold(root.scaffold),
    ...(schemaVersion >= 2
      ? {}
      : { legacyArchitecture: validateLegacyArchitecture(root.architecture) }),
  };
  validateReferences(profile);
  return profile;
}

function validateDefaults(value: unknown): ProjectProfile["defaults"] {
  const item = object(value, "defaults");
  return {
    projectName: string(item.projectName, "defaults.projectName"),
    goal: string(item.goal, "defaults.goal"),
    useCase: string(item.useCase, "defaults.useCase"),
    constraints: stringArray(item.constraints, "defaults.constraints"),
    exclusions: stringArray(item.exclusions, "defaults.exclusions"),
  };
}

function validateDecision(value: unknown, label: string): DecisionSpec {
  const item = object(value, label);
  return {
    id: string(item.id, `${label}.id`),
    topic: string(item.topic, `${label}.topic`),
    question: string(item.question, `${label}.question`),
    whyNow: string(item.whyNow, `${label}.whyNow`),
    blocking: boolean(item.blocking, `${label}.blocking`),
    researchPolicy: validateResearchPolicy(item.researchPolicy, `${label}.researchPolicy`),
    dependsOn: stringArray(item.dependsOn, `${label}.dependsOn`),
    knownFacts: stringArray(item.knownFacts, `${label}.knownFacts`),
    recommendation: string(item.recommendation, `${label}.recommendation`),
    affectedArtifacts: stringArray(item.affectedArtifacts, `${label}.affectedArtifacts`),
    options: array(item.options, `${label}.options`).map((option, index) =>
      validateOption(option, `${label}.options[${index}]`),
    ),
  };
}

function validateResearchPolicy(value: unknown, label: string): ResearchPolicy {
  if (value === undefined) {
    return "conditional";
  }
  if (value !== "required" && value !== "conditional" && value !== "none") {
    throw new Error(`${label} must be required, conditional, or none`);
  }
  return value;
}

function validateOption(value: unknown, label: string): DecisionOption {
  const item = object(value, label);
  return {
    id: string(item.id, `${label}.id`),
    label: string(item.label, `${label}.label`),
    summary: string(item.summary, `${label}.summary`),
    consequences: stringArray(item.consequences, `${label}.consequences`),
  };
}

function validateArchitecture(
  value: unknown,
  schemaVersion: number,
): ProjectProfile["architecture"] {
  const item = object(value, "architecture");
  if (schemaVersion >= 2 && (item.modules !== undefined || item.stage2Order !== undefined)) {
    throw new Error("Profile schemaVersion 2 removes architecture.modules and architecture.stage2Order");
  }
  return {
    roles: validateArchitectureRoles(item, schemaVersion),
    systemBoundary: optionalStringArray(item.systemBoundary, "architecture.systemBoundary"),
    supportedInstructions: optionalStringArray(
      item.supportedInstructions,
      "architecture.supportedInstructions",
    ),
    invariants: stringArray(item.invariants, "architecture.invariants"),
    sharedFields: optionalArray(item.sharedFields, "architecture.sharedFields").map((field, index) =>
      validateSharedField(field, `architecture.sharedFields[${index}]`),
    ),
    globalProtocols: optionalArray(item.globalProtocols, "architecture.globalProtocols").map(
      (protocol, index) => validateGlobalProtocol(protocol, `architecture.globalProtocols[${index}]`),
    ),
    counterRules: optionalArray(item.counterRules, "architecture.counterRules").map((rule, index) =>
      validateCounterRule(rule, `architecture.counterRules[${index}]`),
    ),
  };
}

function validateArchitectureRoles(
  item: Record<string, unknown>,
  schemaVersion: number,
): ArchitectureRoleSpec[] {
  const source = schemaVersion >= 2 ? item.roles : item.modules;
  return array(source, "architecture.roles").map((value, index) => {
    const role = object(value, `architecture.roles[${index}]`);
    return {
      id: string(role.id, `architecture.roles[${index}].id`),
      responsibility: string(
        role.responsibility,
        `architecture.roles[${index}].responsibility`,
      ),
    };
  });
}

function validateLegacyArchitecture(
  value: unknown,
): NonNullable<ProjectProfile["legacyArchitecture"]> {
  const item = object(value, "architecture");
  return {
    modules: array(item.modules, "architecture.modules").map((module, index) =>
      validateModule(module, `architecture.modules[${index}]`),
    ),
    stage2Order: stringArray(item.stage2Order, "architecture.stage2Order"),
  };
}

function validateSharedField(value: unknown, label: string): SharedFieldSpec {
  const item = object(value, label);
  return {
    name: string(item.name, `${label}.name`),
    semantics: string(item.semantics, `${label}.semantics`),
    producer: string(item.producer, `${label}.producer`),
    consumers: stringArray(item.consumers, `${label}.consumers`),
    validFrom: string(item.validFrom, `${label}.validFrom`),
    validUntil: string(item.validUntil, `${label}.validUntil`),
  };
}

function validateGlobalProtocol(value: unknown, label: string): GlobalProtocolSpec {
  const item = object(value, label);
  const ownerRole = item.ownerRole === undefined
    ? string(item.owner, `${label}.owner`)
    : string(item.ownerRole, `${label}.ownerRole`);
  return {
    id: string(item.id, `${label}.id`),
    ownerRole,
    producerRoles: item.producerRoles === undefined
      ? [ownerRole]
      : stringArray(item.producerRoles, `${label}.producerRoles`),
    consumerRoles: optionalStringArray(item.consumerRoles, `${label}.consumerRoles`),
    affectedResources: optionalStringArray(item.affectedResources, `${label}.affectedResources`),
    rules: stringArray(item.rules, `${label}.rules`),
  };
}

function validateCounterRule(value: unknown, label: string): CounterRuleSpec {
  const item = object(value, label);
  return {
    name: string(item.name, `${label}.name`),
    increment: string(item.increment, `${label}.increment`),
    exclusions: stringArray(item.exclusions, `${label}.exclusions`),
  };
}

function validateModule(value: unknown, label: string): ModuleSpec {
  const item = object(value, label);
  return {
    id: string(item.id, `${label}.id`),
    responsibility: string(item.responsibility, `${label}.responsibility`),
    stateOwnership: stringArray(item.stateOwnership, `${label}.stateOwnership`),
    dependsOn: stringArray(item.dependsOn, `${label}.dependsOn`),
    interfaces: stringArray(item.interfaces, `${label}.interfaces`),
  };
}

function validateVerification(
  value: unknown,
  schemaVersion: number,
): ProjectProfile["verification"] {
  const item = object(value, "verification");
  return {
    referenceModel: string(item.referenceModel, "verification.referenceModel"),
    layers: stringArray(item.layers, "verification.layers"),
    requiredScenarios: stringArray(item.requiredScenarios, "verification.requiredScenarios"),
    counters: stringArray(item.counters, "verification.counters"),
    decisionAcceptance: optionalArray(
      item.decisionAcceptance,
      "verification.decisionAcceptance",
    ).map((entry, index) =>
      validateDecisionAcceptance(entry, `verification.decisionAcceptance[${index}]`),
    ),
    completionCriteria: schemaVersion >= 2
      ? stringArray(item.completionCriteria, "verification.completionCriteria")
      : legacyCompletionCriteria(item),
  };
}

function legacyCompletionCriteria(item: Record<string, unknown>): string[] {
  const layers = stringArray(item.layers, "verification.layers");
  const explicit = layers.filter((entry) => /^(?:门禁\d|A_[A-Z0-9_]+_GATE)/u.test(entry));
  if (explicit.length > 0) {
    return explicit;
  }
  return [
    "每个 baseline Implementation Unit 都通过对应定向测试。",
    "架构轨迹与选定参考策略一致。",
    "必需计数器均可观测并遵守已批准的计数规则。",
    "集成测试覆盖已批准的 stall、redirect、trap 和双发射行为。",
  ];
}

function validateDecisionAcceptance(value: unknown, label: string): DecisionAcceptanceSpec {
  const item = object(value, label);
  return {
    decisionId: string(item.decisionId, `${label}.decisionId`),
    criteria: stringArray(item.criteria, `${label}.criteria`),
  };
}

function validateScaffold(value: unknown): ProjectProfile["scaffold"] {
  const item = object(value, "scaffold");
  return {
    files: array(item.files, "scaffold.files").map((file, index) =>
      validateScaffoldFile(file, `scaffold.files[${index}]`),
    ),
    smokeChecks: array(item.smokeChecks, "scaffold.smokeChecks").map((check, index) =>
      validateCommand(check, `scaffold.smokeChecks[${index}]`),
    ),
  };
}

function validateScaffoldFile(value: unknown, label: string): ScaffoldFileSpec {
  const item = object(value, label);
  return {
    path: string(item.path, `${label}.path`),
    content: string(item.content, `${label}.content`),
  };
}

function validateCommand(value: unknown, label: string): CommandSpec {
  const item = object(value, label);
  const runner = string(item.runner, `${label}.runner`);
  if (runner !== "host" && runner !== "wsl") {
    throw new Error(`${label}.runner must be host or wsl`);
  }
  const result: CommandSpec = {
    id: string(item.id, `${label}.id`),
    description: string(item.description, `${label}.description`),
    runner,
    required: boolean(item.required, `${label}.required`),
  };
  if (item.command !== undefined) {
    result.command = string(item.command, `${label}.command`);
  }
  if (item.args !== undefined) {
    result.args = stringArray(item.args, `${label}.args`);
  }
  if (item.script !== undefined) {
    result.script = string(item.script, `${label}.script`);
  }
  if (runner === "host" && result.command === undefined) {
    throw new Error(`${label}.command is required for host commands`);
  }
  if (runner === "wsl" && result.script === undefined) {
    throw new Error(`${label}.script is required for WSL commands`);
  }
  return result;
}

function validateReferences(profile: ProjectProfile): void {
  const decisionIds = new Set<string>();
  for (const decision of profile.decisions) {
    if (decisionIds.has(decision.id)) {
      throw new Error(`Duplicate decision id: ${decision.id}`);
    }
    decisionIds.add(decision.id);
    const optionIds = new Set(decision.options.map((option) => option.id));
    if (!optionIds.has(decision.recommendation)) {
      throw new Error(`Decision ${decision.id} recommends unknown option ${decision.recommendation}`);
    }
  }
  for (const decision of profile.decisions) {
    for (const dependency of decision.dependsOn) {
      if (!decisionIds.has(dependency)) {
        throw new Error(`Decision ${decision.id} depends on unknown decision ${dependency}`);
      }
    }
  }
  assertAcyclic(
    profile.decisions.map((decision) => ({ id: decision.id, dependencies: decision.dependsOn })),
    "decision",
  );
  const architectureRoleIds = new Set<string>();
  for (const role of profile.architecture.roles) {
    if (architectureRoleIds.has(role.id)) {
      throw new Error(`Duplicate Architecture Role id ${role.id}`);
    }
    architectureRoleIds.add(role.id);
  }
  const protocolIds = new Set<string>();
  for (const protocol of profile.architecture.globalProtocols) {
    if (protocolIds.has(protocol.id)) {
      throw new Error(`Duplicate Global Protocol id ${protocol.id}`);
    }
    protocolIds.add(protocol.id);
    if (protocol.ownerRole.trim() === "") {
      throw new Error(`Protocol ${protocol.id} requires an ownerRole`);
    }
    for (const role of [protocol.ownerRole, ...protocol.producerRoles, ...protocol.consumerRoles]) {
      if (!architectureRoleIds.has(role)) {
        throw new Error(`Protocol ${protocol.id} references unknown Architecture Role ${role}`);
      }
    }
  }
  const acceptanceIds = new Set<string>();
  for (const acceptance of profile.verification.decisionAcceptance) {
    if (!decisionIds.has(acceptance.decisionId)) {
      throw new Error(`Verification acceptance references unknown decision ${acceptance.decisionId}`);
    }
    if (acceptanceIds.has(acceptance.decisionId)) {
      throw new Error(`Duplicate verification acceptance for ${acceptance.decisionId}`);
    }
    acceptanceIds.add(acceptance.decisionId);
  }
}

function assertAcyclic(
  nodes: Array<{ id: string; dependencies: string[] }>,
  label: string,
): void {
  const dependencies = new Map(nodes.map((node) => [node.id, node.dependencies]));
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (id: string): void => {
    if (visited.has(id)) {
      return;
    }
    if (visiting.has(id)) {
      throw new Error(`Cyclic ${label} dependency at ${id}`);
    }
    visiting.add(id);
    for (const dependency of dependencies.get(id) ?? []) {
      visit(dependency);
    }
    visiting.delete(id);
    visited.add(id);
  };
  for (const node of nodes) {
    visit(node.id);
  }
}

function object(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function array(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value)) {
    throw new Error(`${label} must be an array`);
  }
  return value;
}

function optionalArray(value: unknown, label: string): unknown[] {
  return value === undefined ? [] : array(value, label);
}

function string(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${label} must be a non-empty string`);
  }
  return value;
}

function stringArray(value: unknown, label: string): string[] {
  return array(value, label).map((item, index) => string(item, `${label}[${index}]`));
}

function optionalStringArray(value: unknown, label: string): string[] {
  return optionalArray(value, label).map((item, index) => string(item, `${label}[${index}]`));
}

function number(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`${label} must be a number`);
  }
  return value;
}

function boolean(value: unknown, label: string): boolean {
  if (typeof value !== "boolean") {
    throw new Error(`${label} must be a boolean`);
  }
  return value;
}
