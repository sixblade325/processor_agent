import { assertSafeRelativePath, sha256 } from "../io.js";
import type {
  ArchitectureRoleSpec,
  Stage2DecisionRequestSpec,
  Stage2DecisionRequestState,
  Stage2DesignComponent,
  Stage2InterfaceSkeleton,
  Stage2SystemDesignProposal,
  Stage2SystemDesignReviewReport,
  Stage2WorkPackagePlanV5,
  Stage2WorkPackageStateV4,
} from "../types.js";
import { objectValue, requireStringArray, requireText } from "./proposal-validation.js";

const DECISION_CATEGORIES = new Set([
  "architecture_role",
  "pipeline_boundary",
  "global_state",
  "identity_or_replay",
  "control_scope",
  "cross_package_interface",
  "engineering_tradeoff",
  "stage1_rework",
]);

export interface SystemDesignHashes {
  components: string;
  interfaces: string;
  workPackages: string;
}

export function validateSystemDesignProposal(
  value: unknown,
  architectureRoles: ArchitectureRoleSpec[],
): Stage2SystemDesignProposal {
  const record = objectValue(value, "Stage2 System Design proposal");
  if (record.schemaVersion !== 1) {
    throw new Error("Stage2 System Design proposal requires schemaVersion 1");
  }
  const proposal = structuredClone(value) as Stage2SystemDesignProposal;
  for (const component of proposal.components ?? []) {
    const normalized = component as Stage2DesignComponent & { parentId?: string | null };
    if (normalized.parentId === null) {
      delete normalized.parentId;
    }
  }
  requireText(proposal.summary, "System Design summary");
  requireStringArray(proposal.architectureReferences, "architectureReferences", true);
  requireStringArray(proposal.globalInvariants, "globalInvariants", true);
  requireStringArray(proposal.acceptancePlan, "acceptancePlan", true);
  requireStringArray(proposal.risks, "risks");
  if (
    !Array.isArray(proposal.components)
    || !Array.isArray(proposal.interfaces)
    || !Array.isArray(proposal.workPackages)
    || !Array.isArray(proposal.decisionRequests)
  ) {
    throw new Error("System Design components, interfaces, workPackages and decisionRequests must be arrays");
  }
  validateComponents(proposal.components, architectureRoles);
  validateInterfaces(proposal.interfaces, proposal.components);
  validateWorkPackages(proposal.workPackages, proposal.components);
  validateDecisionRequestSpecs(proposal.decisionRequests);
  return proposal;
}

export function validateSystemDesignReviewReport(
  value: unknown,
  designSha256: string,
): Stage2SystemDesignReviewReport {
  const record = objectValue(value, "Stage2 System Design review");
  if (record.schemaVersion !== 1 || record.systemDesignSha256 !== designSha256) {
    throw new Error("System Design review does not match the current draft");
  }
  const report = value as Stage2SystemDesignReviewReport;
  if (report.verdict !== "pass" && report.verdict !== "fail") {
    throw new Error("System Design review verdict must be pass or fail");
  }
  requireText(report.summary, "System Design review summary");
  if (!Array.isArray(report.findings) || !Array.isArray(report.decisionRequests)) {
    throw new Error("System Design review findings and decisionRequests must be arrays");
  }
  for (const finding of report.findings) {
    if (!new Set(["error", "warning", "note"]).has(finding.severity)) {
      throw new Error(`Invalid System Design finding severity: ${String(finding.severity)}`);
    }
    requireText(finding.code, "System Design finding code");
    requireText(finding.message, `System Design finding ${finding.code} message`);
    requireText(finding.artifact, `System Design finding ${finding.code} artifact`);
    requireText(finding.requiredAction, `System Design finding ${finding.code} requiredAction`);
  }
  if (report.verdict === "pass" && report.findings.some((finding) => finding.severity === "error")) {
    throw new Error("System Design review passed with error findings");
  }
  validateDecisionRequestSpecs(report.decisionRequests);
  return structuredClone(report);
}

export function mergeDecisionRequests(
  current: Record<string, Stage2DecisionRequestState>,
  requests: Stage2DecisionRequestSpec[],
): { order: string[]; decisions: Record<string, Stage2DecisionRequestState> } {
  const requestedIds = new Set(requests.map((request) => request.id));
  const order = Object.keys(current).filter((id) =>
    current[id]?.status === "answered" || requestedIds.has(id)
  );
  const decisions: Record<string, Stage2DecisionRequestState> = Object.fromEntries(
    Object.entries(current)
      .filter(([id, decision]) => decision.status === "answered" || requestedIds.has(id))
      .map(([id, decision]) => [id, structuredClone(decision)]),
  );
  for (const request of requests) {
    if (decisions[request.id] !== undefined) {
      const existing = decisions[request.id]!.spec;
      if (sha256(JSON.stringify(existing)) === sha256(JSON.stringify(request))) {
        continue;
      }
      decisions[request.id] = { spec: structuredClone(request), status: "open" };
    } else {
      order.push(request.id);
      decisions[request.id] = { spec: structuredClone(request), status: "open" };
    }
  }
  return { order, decisions };
}

export function systemDesignHashes(proposal: Stage2SystemDesignProposal): SystemDesignHashes {
  return {
    components: valueHash(proposal.components),
    interfaces: valueHash(proposal.interfaces),
    workPackages: valueHash(proposal.workPackages),
  };
}

export function createWorkPackageStates(
  proposal: Stage2SystemDesignProposal,
): Record<string, Stage2WorkPackageStateV4> {
  return Object.fromEntries(proposal.workPackages.map((plan, order) => [
    plan.id,
    {
      id: plan.id,
      order,
      revision: 0,
      status: "PENDING" as const,
      plan: structuredClone(plan),
      decisionOrder: [],
      decisions: {},
      blockers: [],
      reopened: [],
    },
  ]));
}

export function valueHash(value: unknown): string {
  return sha256(JSON.stringify(value));
}

function validateComponents(
  components: Stage2DesignComponent[],
  architectureRoles: ArchitectureRoleSpec[],
): void {
  if (components.length === 0) {
    throw new Error("System Design requires at least one Design Component");
  }
  assertUniqueIds(components, "Design Component");
  const ids = new Set(components.map((component) => component.id));
  const knownRoles = new Set(architectureRoles.map((role) => role.id));
  const mappedRoles = new Set<string>();
  for (const component of components) {
    assertIdentifier(component.id, "Design Component id");
    requireStringArray(component.architectureRoles, `Component ${component.id} architectureRoles`);
    requireText(component.responsibility, `Component ${component.id} responsibility`);
    requireStringArray(component.stateOwnership, `Component ${component.id} stateOwnership`);
    requireStringArray(component.interfaceIds, `Component ${component.id} interfaceIds`);
    if (component.parentId !== undefined) {
      assertIdentifier(component.parentId, `Component ${component.id} parentId`);
      if (!ids.has(component.parentId)) {
        throw new Error(`Component ${component.id} has unknown parent ${component.parentId}`);
      }
      if (component.parentId === component.id) {
        throw new Error(`Component ${component.id} cannot be its own parent`);
      }
    }
    for (const role of component.architectureRoles) {
      if (!knownRoles.has(role)) {
        throw new Error(`Component ${component.id} maps unknown Architecture Role ${role}`);
      }
      mappedRoles.add(role);
    }
  }
  const missing = [...knownRoles].filter((role) => !mappedRoles.has(role));
  if (missing.length > 0) {
    throw new Error(`System Design does not map Architecture Roles: ${missing.join(", ")}`);
  }
  for (const component of components) {
    const visited = new Set<string>([component.id]);
    let parent = component.parentId;
    while (parent !== undefined) {
      if (visited.has(parent)) {
        throw new Error(`Design Component parent cycle contains ${component.id}`);
      }
      visited.add(parent);
      parent = components.find((candidate) => candidate.id === parent)?.parentId;
    }
  }
}

function validateInterfaces(
  interfaces: Stage2InterfaceSkeleton[],
  components: Stage2DesignComponent[],
): void {
  assertUniqueIds(interfaces, "Interface");
  const componentIds = new Set(components.map((component) => component.id));
  const interfaceIds = new Set(interfaces.map((contract) => contract.id));
  for (const contract of interfaces) {
    assertIdentifier(contract.id, "Interface id");
    assertKnownComponent(contract.ownerComponentId, componentIds, `Interface ${contract.id} owner`);
    requireStringArray(contract.producerComponentIds, `Interface ${contract.id} producers`, true);
    requireStringArray(contract.consumerComponentIds, `Interface ${contract.id} consumers`, true);
    requireStringArray(contract.fields, `Interface ${contract.id} fields`);
    requireText(contract.boundary, `Interface ${contract.id} boundary`);
    requireText(contract.timing, `Interface ${contract.id} timing`);
    for (const id of [...contract.producerComponentIds, ...contract.consumerComponentIds]) {
      assertKnownComponent(id, componentIds, `Interface ${contract.id} endpoint`);
    }
  }
  for (const component of components) {
    for (const id of component.interfaceIds) {
      if (!interfaceIds.has(id)) {
        throw new Error(`Component ${component.id} references unknown Interface ${id}`);
      }
    }
  }
}

function validateWorkPackages(
  workPackages: Stage2WorkPackagePlanV5[],
  components: Stage2DesignComponent[],
): void {
  if (workPackages.length === 0) {
    throw new Error("System Design requires at least one Work Package");
  }
  assertUniqueIds(workPackages, "Work Package");
  const packageIds = new Set(workPackages.map((workPackage) => workPackage.id));
  const componentIds = new Set(components.map((component) => component.id));
  const componentOwners = new Map<string, string>();
  const pathOwners = new Map<string, string>();
  for (const workPackage of workPackages) {
    assertIdentifier(workPackage.id, "Work Package id");
    requireStringArray(workPackage.componentIds, `Work Package ${workPackage.id} componentIds`, true);
    requireStringArray(workPackage.designDependsOn, `Work Package ${workPackage.id} designDependsOn`);
    requireStringArray(
      workPackage.implementationDependsOn,
      `Work Package ${workPackage.id} implementationDependsOn`,
    );
    requireStringArray(
      workPackage.integrationDependsOn,
      `Work Package ${workPackage.id} integrationDependsOn`,
    );
    requireStringArray(workPackage.allowedSourcePaths, `Work Package ${workPackage.id} allowedSourcePaths`, true);
    requireStringArray(workPackage.allowedTestPaths, `Work Package ${workPackage.id} allowedTestPaths`, true);
    requireText(workPackage.designPath, `Work Package ${workPackage.id} designPath`);
    requireStringArray(workPackage.acceptance, `Work Package ${workPackage.id} acceptance`, true);
    assertSafeRelativePath(workPackage.designPath);
    if (!portablePath(workPackage.designPath).startsWith("design/")) {
      throw new Error(`Work Package Design must be under design/: ${workPackage.designPath}`);
    }
    for (const componentId of workPackage.componentIds) {
      if (!componentIds.has(componentId)) {
        throw new Error(`Work Package ${workPackage.id} owns unknown Component ${componentId}`);
      }
      const owner = componentOwners.get(componentId);
      if (owner !== undefined) {
        throw new Error(`Component ${componentId} is owned by both ${owner} and ${workPackage.id}`);
      }
      componentOwners.set(componentId, workPackage.id);
    }
    for (const [kind, dependencies] of dependencyGroups(workPackage)) {
      for (const dependency of dependencies) {
        if (!packageIds.has(dependency)) {
          throw new Error(
            `Work Package ${workPackage.id} has unknown ${kind} dependency ${dependency}`,
          );
        }
        if (dependency === workPackage.id) {
          throw new Error(`Work Package ${workPackage.id} cannot depend on itself in ${kind}`);
        }
      }
    }
    for (const [kind, paths] of [
      ["source", workPackage.allowedSourcePaths],
      ["test", workPackage.allowedTestPaths],
    ] as const) {
      for (const path of paths) {
        assertSafeRelativePath(path);
        const normalized = portablePath(path);
        if (/[*?\[\]]/u.test(normalized) || normalized.endsWith("/")) {
          throw new Error(`Work Package ${kind} path must name one exact file: ${path}`);
        }
        const requiredPrefix = kind === "source" ? "src/main/" : "src/test/";
        if (!normalized.startsWith(requiredPrefix)) {
          throw new Error(`Work Package ${kind} path must be under ${requiredPrefix}: ${path}`);
        }
        const owner = pathOwners.get(normalized);
        if (owner !== undefined) {
          throw new Error(`Path ${path} is owned by both ${owner} and ${workPackage.id}`);
        }
        pathOwners.set(normalized, workPackage.id);
      }
    }
  }
  const unowned = [...componentIds].filter((id) => !componentOwners.has(id));
  if (unowned.length > 0) {
    throw new Error(`Design Components have no Work Package owner: ${unowned.join(", ")}`);
  }
  for (const kind of ["design", "implementation", "integration"] as const) {
    assertAcyclicWorkPackages(workPackages, kind);
  }
}

export function validateDecisionRequestSpecs(requests: Stage2DecisionRequestSpec[]): void {
  assertUniqueIds(requests, "DecisionRequest");
  for (const request of requests) {
    assertIdentifier(request.id, "DecisionRequest id");
    if (!DECISION_CATEGORIES.has(request.category)) {
      throw new Error(`Invalid DecisionRequest category for ${request.id}: ${String(request.category)}`);
    }
    requireText(request.question, `DecisionRequest ${request.id} question`);
    requireText(request.whyUserDecisionIsRequired, `DecisionRequest ${request.id} reason`);
    requireStringArray(request.affectedComponents, `DecisionRequest ${request.id} affectedComponents`);
    requireStringArray(request.affectedInterfaces, `DecisionRequest ${request.id} affectedInterfaces`);
    requireStringArray(request.affectedPaths, `DecisionRequest ${request.id} affectedPaths`);
    requireStringArray(request.consequences, `DecisionRequest ${request.id} consequences`, true);
    if (!Array.isArray(request.options) || request.options.length < 2) {
      throw new Error(`DecisionRequest ${request.id} requires at least two options`);
    }
    assertUniqueIds(request.options, `DecisionRequest ${request.id} option`);
    for (const option of request.options) {
      assertIdentifier(option.id, `DecisionRequest ${request.id} option id`);
      requireText(option.label, `DecisionRequest ${request.id} option ${option.id} label`);
      requireText(option.summary, `DecisionRequest ${request.id} option ${option.id} summary`);
      requireStringArray(option.consequences, `DecisionRequest ${request.id} option ${option.id} consequences`, true);
    }
    if (!request.options.some((option) => option.id === request.recommendation)) {
      throw new Error(`DecisionRequest ${request.id} recommendation is not an option`);
    }
  }
}

function assertAcyclicWorkPackages(
  workPackages: Stage2WorkPackagePlanV5[],
  kind: "design" | "implementation" | "integration",
): void {
  const byId = new Map(workPackages.map((workPackage) => [workPackage.id, workPackage]));
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (id: string): void => {
    if (visited.has(id)) {
      return;
    }
    if (visiting.has(id)) {
      throw new Error(`Work Package ${kind} dependency cycle contains ${id}`);
    }
    visiting.add(id);
    const workPackage = byId.get(id);
    const dependencies = workPackage === undefined ? [] : dependencyList(workPackage, kind);
    for (const dependency of dependencies) {
      visit(dependency);
    }
    visiting.delete(id);
    visited.add(id);
  };
  workPackages.forEach((workPackage) => visit(workPackage.id));
}

function dependencyGroups(
  workPackage: Stage2WorkPackagePlanV5,
): Array<["design" | "implementation" | "integration", string[]]> {
  return [
    ["design", workPackage.designDependsOn],
    ["implementation", workPackage.implementationDependsOn],
    ["integration", workPackage.integrationDependsOn],
  ];
}

function dependencyList(
  workPackage: Stage2WorkPackagePlanV5,
  kind: "design" | "implementation" | "integration",
): string[] {
  switch (kind) {
    case "design":
      return workPackage.designDependsOn;
    case "implementation":
      return workPackage.implementationDependsOn;
    case "integration":
      return workPackage.integrationDependsOn;
  }
}

function assertKnownComponent(id: string, known: Set<string>, label: string): void {
  assertIdentifier(id, label);
  if (!known.has(id)) {
    throw new Error(`${label} references unknown Component ${id}`);
  }
}

function assertIdentifier(value: string, label: string): void {
  requireText(value, label);
  if (!/^[a-z][a-z0-9_]*$/u.test(value)) {
    throw new Error(`${label} must use lower_snake_case: ${value}`);
  }
}

function assertUniqueIds(items: Array<{ id: string }>, label: string): void {
  const ids = items.map((item) => item.id);
  if (new Set(ids).size !== ids.length) {
    throw new Error(`${label} ids must be unique`);
  }
}

function portablePath(path: string): string {
  return path.replace(/\\/gu, "/").toLowerCase();
}
