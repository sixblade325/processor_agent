import { randomUUID } from "node:crypto";
import type {
  Stage2AgentSlot,
  Stage2WorkPackageStateV4,
  Stage2WorkspaceAgentAssignment,
  Stage2WorkspaceStage,
} from "../types.js";
import { isEmptySharedInterfaceChange } from "./design-revision.js";
import { areImplementationDependenciesComplete, isPackageDesignable } from "./work-package.js";

export function idleWorkspaceAssignment(slot: Stage2AgentSlot): Stage2WorkspaceAgentAssignment {
  return {
    slot,
    role: "idle",
    status: "idle",
    lease: randomUUID(),
    baseRevision: 0,
    allowedPaths: [],
  };
}

export function assignNextShadow(
  stage2: Stage2WorkspaceStage,
  preferredSlot?: Stage2AgentSlot,
): Stage2WorkPackageStateV4 | undefined {
  const alreadyAssigned = new Set(
    Object.values(stage2.agents).flatMap((assignment) =>
      assignment.workPackageId === undefined ? [] : [assignment.workPackageId]
    ),
  );
  const repair = stage2.workPackageOrder
    .map((id) => requireWorkPackage(stage2, id))
    .find((workPackage) =>
      workPackage.status === "DESIGNING"
      && workPackage.design !== undefined
      && !alreadyAssigned.has(workPackage.id)
      && isPackageDesignable(stage2, workPackage)
    );
  const next = repair ?? stage2.workPackageOrder
    .map((id) => requireWorkPackage(stage2, id))
    .find((workPackage) =>
      workPackage.status === "PENDING"
      && !alreadyAssigned.has(workPackage.id)
      && isPackageDesignable(stage2, workPackage)
    );
  if (next === undefined) {
    return undefined;
  }
  const assignment = chooseIdleSlot(stage2, preferredSlot);
  if (assignment === undefined) {
    return undefined;
  }
  const approval = requireSystemApproval(stage2);
  assignment.role = "shadow";
  assignment.status = "assigned";
  assignment.lease = randomUUID();
  assignment.baseRevision = stage2.workspaceRevision;
  assignment.workPackageId = next.id;
  assignment.designHash = next.design?.documentSha256 ?? stage2.systemDesign.documentSha256;
  assignment.interfaceHash = approval.interfaceSha256;
  assignment.allowedPaths = [next.plan.designPath];
  next.status = "DESIGNING";
  if (repair === undefined) {
    next.blockers = [];
  }
  return next;
}

export function assignBlockedImplementationRepair(
  stage2: Stage2WorkspaceStage,
  workPackageId?: string,
  preferredSlot?: Stage2AgentSlot,
): Stage2WorkPackageStateV4 | undefined {
  const candidate = stage2.workPackageOrder
    .map((id) => requireWorkPackage(stage2, id))
    .find((workPackage) =>
      workPackage.status === "BLOCKED"
      && (workPackageId === undefined || workPackage.id === workPackageId)
      && workPackage.design?.approval !== undefined
      && workPackage.implementation !== undefined
      && areImplementationDependenciesComplete(stage2, workPackage)
    );
  if (candidate === undefined) {
    return undefined;
  }
  const existing = Object.values(stage2.agents).find((assignment) =>
    assignment.workPackageId === candidate.id
  );
  const active = Object.values(stage2.agents).find((assignment) => assignment.role === "active");
  if (active !== undefined && active !== existing) {
    return undefined;
  }
  if (existing !== undefined && existing.role !== "active") {
    return undefined;
  }
  const assignment = existing ?? chooseIdleSlot(stage2, preferredSlot);
  if (assignment === undefined) {
    return undefined;
  }
  const approval = requireSystemApproval(stage2);
  assignment.role = "active";
  assignment.status = "assigned";
  assignment.lease = randomUUID();
  assignment.baseRevision = stage2.workspaceRevision;
  assignment.workPackageId = candidate.id;
  assignment.runtimeRef = candidate.implementation!.runtimeRef;
  assignment.designHash = candidate.design!.documentSha256;
  assignment.interfaceHash = approval.interfaceSha256;
  assignment.allowedPaths = [
    ...candidate.plan.allowedSourcePaths,
    ...candidate.plan.allowedTestPaths,
  ];
  candidate.status = "IMPLEMENTING";
  return candidate;
}

export function promoteReadyShadow(stage2: Stage2WorkspaceStage): boolean {
  const shadow = Object.values(stage2.agents).find((assignment) => assignment.role === "shadow");
  if (shadow?.workPackageId === undefined) {
    return false;
  }
  const shadowPackage = requireWorkPackage(stage2, shadow.workPackageId);
  if (shadowPackage.status !== "READY" || shadowPackage.design?.approval === undefined) {
    return false;
  }
  const active = Object.values(stage2.agents).find((assignment) => assignment.role === "active");
  if (active === undefined) {
    if (!areImplementationDependenciesComplete(stage2, shadowPackage)) {
      return false;
    }
    makeActive(stage2, shadow, shadowPackage);
    return true;
  }
  if (active.workPackageId === undefined) {
    throw new Error(`Active assignment ${active.slot} has no Work Package`);
  }
  const activePackage = requireWorkPackage(stage2, active.workPackageId);
  if (activePackage.status !== "VERIFYING" && activePackage.status !== "COMPLETE") {
    return false;
  }
  if (activePackage.status === "VERIFYING") {
    if (dependsTransitively(stage2, shadowPackage.id, activePackage.id)) {
      return false;
    }
    if (
      activePackage.design?.proposal.sharedInterfaceChanges.some((change) =>
        !isEmptySharedInterfaceChange(change)
      ) === true
    ) {
      return false;
    }
    const otherDependenciesComplete = shadowPackage.plan.implementationDependsOn.every((id) =>
      id === activePackage.id || stage2.workPackages[id]?.status === "COMPLETE"
    );
    if (!otherDependenciesComplete) {
      return false;
    }
  } else if (!areImplementationDependenciesComplete(stage2, shadowPackage)) {
    return false;
  }
  releaseWorkspaceAssignment(active);
  makeActive(stage2, shadow, shadowPackage);
  return true;
}

export function releaseWorkspaceAssignment(assignment: Stage2WorkspaceAgentAssignment): void {
  assignment.role = "idle";
  assignment.status = "idle";
  assignment.lease = randomUUID();
  assignment.baseRevision = 0;
  assignment.allowedPaths = [];
  delete assignment.workPackageId;
  delete assignment.runId;
  delete assignment.designHash;
  delete assignment.interfaceHash;
}

export function findWorkspaceAssignment(
  stage2: Stage2WorkspaceStage,
  role: "shadow" | "active",
  workPackageId?: string,
): Stage2WorkspaceAgentAssignment {
  const assignment = Object.values(stage2.agents).find((candidate) =>
    candidate.role === role
    && (workPackageId === undefined || candidate.workPackageId === workPackageId)
  );
  if (assignment === undefined) {
    throw new Error(
      workPackageId === undefined
        ? `Stage2 has no ${role} assignment`
        : `Stage2 has no ${role} assignment for ${workPackageId}`,
    );
  }
  return assignment;
}

export function workPackageAgentRole(
  stage2: Stage2WorkspaceStage,
  workPackageId: string,
): "idle" | "shadow" | "active" {
  return Object.values(stage2.agents).find((assignment) =>
    assignment.workPackageId === workPackageId
  )?.role ?? "idle";
}

export function dependsTransitively(
  stage2: Stage2WorkspaceStage,
  workPackageId: string,
  dependencyId: string,
): boolean {
  const visited = new Set<string>();
  const pending = [
    ...requireWorkPackage(stage2, workPackageId).plan.implementationDependsOn,
  ];
  while (pending.length > 0) {
    const current = pending.pop()!;
    if (current === dependencyId) {
      return true;
    }
    if (visited.has(current)) {
      continue;
    }
    visited.add(current);
    pending.push(...requireWorkPackage(stage2, current).plan.implementationDependsOn);
  }
  return false;
}

function makeActive(
  stage2: Stage2WorkspaceStage,
  assignment: Stage2WorkspaceAgentAssignment,
  workPackage: Stage2WorkPackageStateV4,
): void {
  const approval = requireSystemApproval(stage2);
  assignment.role = "active";
  assignment.status = "assigned";
  assignment.lease = randomUUID();
  assignment.baseRevision = stage2.workspaceRevision;
  assignment.designHash = workPackage.design!.documentSha256;
  assignment.interfaceHash = approval.interfaceSha256;
  assignment.allowedPaths = [
    ...workPackage.plan.allowedSourcePaths,
    ...workPackage.plan.allowedTestPaths,
  ];
  workPackage.status = "IMPLEMENTING";
  workPackage.blockers = [];
}

function chooseIdleSlot(
  stage2: Stage2WorkspaceStage,
  preferredSlot?: Stage2AgentSlot,
): Stage2WorkspaceAgentAssignment | undefined {
  if (preferredSlot !== undefined && stage2.agents[preferredSlot].role === "idle") {
    return stage2.agents[preferredSlot];
  }
  return Object.values(stage2.agents)
    .sort((left, right) => left.slot.localeCompare(right.slot))
    .find((assignment) => assignment.role === "idle");
}

function requireSystemApproval(stage2: Stage2WorkspaceStage) {
  const approval = stage2.systemDesign.approval;
  if (approval === undefined) {
    throw new Error("Stage2 System Design is not approved");
  }
  return approval;
}

function requireWorkPackage(
  stage2: Stage2WorkspaceStage,
  id: string,
): Stage2WorkPackageStateV4 {
  const workPackage = stage2.workPackages[id];
  if (workPackage === undefined) {
    throw new Error(`Unknown Work Package: ${id}`);
  }
  return workPackage;
}
