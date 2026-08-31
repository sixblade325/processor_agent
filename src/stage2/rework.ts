import { randomUUID } from "node:crypto";
import { atomicWriteText, resolveWithin, sha256 } from "../io.js";
import {
  assertApprovalCurrent,
  beginStage1ArchitectureRework,
  closeStage1ArchitectureRework,
  saveProjectState,
} from "../stage1.js";
import type {
  Stage2WorkspaceArchitectureReworkProposal,
  Stage2WorkspaceArchitectureReworkRecord,
} from "../types.js";
import { assertSystemDesignAuthorityCurrent } from "./gates.js";
import { renderSystemDesignDocument } from "./presentation.js";
import { releaseWorkspaceAssignment } from "./rotation.js";
import { transitivePackageConsumers } from "./work-package.js";
import {
  loadStage2Workspace,
  type LoadedStage2Workspace,
  type Stage2WorkspaceExecutionOptions,
} from "./workflow.js";
import { requireStringArray, requireText } from "./proposal-validation.js";

export async function startStage2WorkspaceArchitectureRework(
  projectPath: string,
  proposal: Stage2WorkspaceArchitectureReworkProposal,
  options: Stage2WorkspaceExecutionOptions = {},
): Promise<LoadedStage2Workspace> {
  const loaded = await loadStage2Workspace(projectPath);
  await assertSystemDesignAuthorityCurrent(loaded.root, loaded.state, loaded.state.stage2);
  if (
    loaded.state.stage2.architectureRework !== undefined
    && loaded.state.stage2.architectureRework.status !== "resumed"
  ) {
    throw new Error(`Stage2 already has Architecture Rework ${loaded.state.stage2.architectureRework.id}`);
  }
  validateProposal(loaded, proposal);
  const stage2 = loaded.state.stage2;
  const approval = loaded.state.stage1.approval;
  if (approval === undefined) {
    throw new Error("Architecture Rework requires a current Stage1 approval");
  }
  const count = (stage2.architectureReworkHistory?.length ?? 0) + 1;
  const id = `S2_ARW_${String(count).padStart(3, "0")}`;
  const timestamp = now(options).toISOString();
  const affected = transitivePackageConsumers(stage2, proposal.affectedWorkPackages);
  const suspendedAssignments = Object.values(stage2.agents)
    .filter((assignment) => assignment.role !== "idle")
    .map((assignment) => structuredClone(assignment));
  const record: Stage2WorkspaceArchitectureReworkRecord = {
    ...structuredClone(proposal),
    id,
    status: "stage1_rework",
    startedAt: timestamp,
    updatedAt: timestamp,
    baseline: {
      stage1ApprovalSha256: approval.aggregateSha256,
      stage2Revision: stage2.revision,
      workspaceRevision: stage2.workspaceRevision,
      systemDesignSha256: stage2.systemDesign.documentSha256,
      ...(stage2.systemDesign.approval === undefined
        ? {}
        : { interfaceSha256: stage2.systemDesign.approval.interfaceSha256 }),
      workPackageDesignHashes: Object.fromEntries(
        Object.values(stage2.workPackages).flatMap((workPackage) =>
          workPackage.design === undefined
            ? []
            : [[workPackage.id, workPackage.design.documentSha256]]
        ),
      ),
    },
    suspendedAssignments,
    invalidatedWorkPackages: [...affected].map((workPackageId) => {
      const workPackage = stage2.workPackages[workPackageId];
      if (workPackage === undefined) {
        throw new Error(`Architecture Rework references unknown Work Package ${workPackageId}`);
      }
      return {
        workPackageId,
        ...(workPackage.design === undefined
          ? {}
          : { designSha256: workPackage.design.documentSha256 }),
        ...(workPackage.implementation === undefined
          ? {}
          : { implementationSha256: workPackage.implementation.aggregateSha256 }),
        ...(workPackage.verification?.documentSha256 === undefined
          ? {}
          : { verificationSha256: workPackage.verification.documentSha256 }),
      };
    }),
  };
  await beginStage1ArchitectureRework(loaded, {
    id,
    sourceStage2Revision: stage2.revision,
    repairKind: proposal.repair.kind,
    repairTarget: proposal.repair.target,
    summary: proposal.summary,
    requiredClosure: [...proposal.requiredClosure],
    startedAt: timestamp,
  });
  stage2.architectureRework = record;
  stage2.status = "BLOCKED";
  stage2.blockers = [
    `Architecture Rework ${id} is active in Stage1: ${proposal.repair.kind}:${proposal.repair.target}`,
  ];
  for (const assignment of Object.values(stage2.agents)) {
    releaseWorkspaceAssignment(assignment);
  }
  advance(stage2, "ARCHITECTURE_REWORK_STARTED", id, options);
  await saveProjectState(loaded.root, loaded.state);
  return loaded;
}

export async function resumeStage2WorkspaceArchitectureRework(
  projectPath: string,
  options: Stage2WorkspaceExecutionOptions = {},
): Promise<LoadedStage2Workspace> {
  const loaded = await loadStage2Workspace(projectPath);
  const stage2 = loaded.state.stage2;
  const rework = stage2.architectureRework;
  if (
    rework === undefined
    || (rework.status !== "stage1_rework" && rework.status !== "stage1_reapproved")
  ) {
    throw new Error("Stage2 has no Stage1 Architecture Rework ready to resume");
  }
  const stage1Rework = loaded.state.stage1.architectureRework;
  if (stage1Rework?.id !== rework.id || stage1Rework.status !== "reapproved") {
    throw new Error(`Stage1 Architecture Rework ${rework.id} has not been reapproved`);
  }
  if (loaded.state.stage1.status !== "STAGE1_COMPLETE") {
    throw new Error(`Stage1 must return to STAGE1_COMPLETE, current state is ${loaded.state.stage1.status}`);
  }
  await assertApprovalCurrent(loaded.root, loaded.state);
  const newApproval = loaded.state.stage1.approval!;
  if (newApproval.aggregateSha256 === rework.baseline.stage1ApprovalSha256) {
    throw new Error("Stage1 reapproval did not produce a new Architecture approval hash");
  }
  const affected = transitivePackageConsumers(stage2, rework.affectedWorkPackages);
  for (const workPackageId of affected) {
    const workPackage = stage2.workPackages[workPackageId];
    if (workPackage === undefined) {
      continue;
    }
    if (workPackage.design !== undefined) {
      delete workPackage.design.approval;
    }
    delete workPackage.implementation;
    delete workPackage.verification;
    workPackage.status = "NEEDS_REALIGN";
    workPackage.blockers = [`Architecture Rework ${rework.id} requires Package realignment`];
  }
  for (const assignment of Object.values(stage2.agents)) {
    releaseWorkspaceAssignment(assignment);
  }
  delete stage2.systemDesign.approval;
  delete stage2.systemDesign.review;
  stage2.status = "SYSTEM_DESIGN_DRAFT";
  stage2.blockers = [
    `Architecture Rework ${rework.id} requires a revised System Design and independent review`,
  ];
  rework.status = "system_design_rework";
  rework.newStage1ApprovalSha256 = newApproval.aggregateSha256;
  rework.updatedAt = now(options).toISOString();
  closeStage1ArchitectureRework(loaded.state, rework.id);
  advance(stage2, "ARCHITECTURE_REWORK_RETURNED_TO_STAGE2", rework.id, options);
  const content = renderSystemDesignDocument(loaded.state, stage2, "需修订");
  stage2.systemDesign.documentSha256 = sha256(content);
  await atomicWriteText(resolveWithin(loaded.root, stage2.systemDesign.path), content);
  await saveProjectState(loaded.root, loaded.state);
  return loaded;
}

function validateProposal(
  loaded: LoadedStage2Workspace,
  proposal: Stage2WorkspaceArchitectureReworkProposal,
): void {
  requireText(proposal.summary, "Architecture Rework summary");
  requireText(proposal.rationale, "Architecture Rework rationale");
  if (!new Set(["topology", "unit_design", "implementation", "verification", "user"]).has(proposal.source.kind)) {
    throw new Error(`Invalid Architecture Rework source kind: ${String(proposal.source.kind)}`);
  }
  if (proposal.repair.kind !== "decision" && proposal.repair.kind !== "project_spec") {
    throw new Error(`Invalid Architecture Rework repair kind: ${String(proposal.repair.kind)}`);
  }
  requireText(proposal.repair.target, "Architecture Rework repair target");
  requireStringArray(proposal.requiredClosure, "Architecture Rework requiredClosure", true);
  requireStringArray(proposal.affectedComponents, "Architecture Rework affectedComponents", true);
  requireStringArray(proposal.affectedWorkPackages, "Architecture Rework affectedWorkPackages", true);
  if (!Array.isArray(proposal.evidenceSources) || proposal.evidenceSources.length === 0) {
    throw new Error("Architecture Rework requires evidenceSources");
  }
  const systemDesign = loaded.state.stage2.systemDesign.proposal;
  if (systemDesign === undefined) {
    throw new Error("Architecture Rework requires an approved System Design");
  }
  const componentIds = new Set(systemDesign.components.map((component) => component.id));
  const packageIds = new Set(systemDesign.workPackages.map((workPackage) => workPackage.id));
  for (const id of proposal.affectedComponents) {
    if (!componentIds.has(id)) {
      throw new Error(`Architecture Rework affects unknown Component ${id}`);
    }
  }
  for (const id of proposal.affectedWorkPackages) {
    if (!packageIds.has(id)) {
      throw new Error(`Architecture Rework affects unknown Work Package ${id}`);
    }
  }
}

function advance(
  stage2: LoadedStage2Workspace["state"]["stage2"],
  event: string,
  detail: string,
  options: Stage2WorkspaceExecutionOptions,
): void {
  stage2.revision += 1;
  stage2.workspaceRevision += 1;
  stage2.stateEpoch += 1;
  stage2.updatedAt = now(options).toISOString();
  stage2.history.push({
    at: stage2.updatedAt,
    revision: stage2.revision,
    workspaceRevision: stage2.workspaceRevision,
    event,
    detail,
  });
}

function now(options: Stage2WorkspaceExecutionOptions): Date {
  return options.now?.() ?? new Date();
}
