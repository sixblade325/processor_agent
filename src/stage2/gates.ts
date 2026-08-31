import { atomicWriteText, pathExists, readText, resolveWithin, sha256 } from "../io.js";
import type {
  Stage1ProjectState,
  Stage2PackageImplementationProposal,
  Stage2WorkPackageStateV4,
  Stage2WorkspaceAgentAssignment,
  Stage2WorkspaceStage,
} from "../types.js";
import { systemDesignHashes } from "./design-package.js";

export interface WorkspaceAssignmentSnapshot {
  slot: Stage2WorkspaceAgentAssignment["slot"];
  role: Stage2WorkspaceAgentAssignment["role"];
  status: Stage2WorkspaceAgentAssignment["status"];
  lease: string;
  baseRevision: number;
  workspaceRevision: number;
  stateEpoch: number;
  workPackageRevision?: number;
  workPackageId?: string;
  runtimeRef?: string;
  runId?: string;
  designHash?: string;
  interfaceHash?: string;
}

export interface AppliedPackageFiles {
  fileHashes: Record<string, string>;
  changedPaths: string[];
  aggregateSha256: string;
}

export async function assertSystemDesignAuthorityCurrent(
  root: string,
  state: Stage1ProjectState,
  stage2: Stage2WorkspaceStage,
): Promise<void> {
  const approval = stage2.systemDesign.approval;
  const proposal = stage2.systemDesign.proposal;
  if (approval === undefined || proposal === undefined) {
    throw new Error("Stage2 System Design is not approved");
  }
  const content = await readText(resolveWithin(root, stage2.systemDesign.path));
  if (sha256(content) !== approval.documentSha256) {
    throw new Error("Stage2 System Design document drifted after approval");
  }
  for (const [path, expected] of Object.entries(approval.architectureHashes)) {
    if (!(await pathExists(resolveWithin(root, path)))) {
      throw new Error(`Approved Architecture document is missing: ${path}`);
    }
    const actual = sha256(await readText(resolveWithin(root, path)));
    if (actual !== expected) {
      throw new Error(`Approved Architecture document drifted: ${path}`);
    }
  }
  const hashes = systemDesignHashes(proposal);
  if (
    hashes.components !== approval.componentTopologySha256
    || hashes.interfaces !== approval.interfaceSha256
    || hashes.workPackages !== approval.workPackagePlanSha256
  ) {
    throw new Error("Stage2 System Design state drifted after approval");
  }
  if (state.stage1.approval === undefined) {
    throw new Error("Stage2 requires a current Stage1 Architecture approval");
  }
  if (!sameHashes(state.stage1.approval.documentHashes, approval.architectureHashes)) {
    throw new Error("Stage1 Architecture approval changed after System Design approval");
  }
}

export async function assertPackageDesignCurrent(
  root: string,
  workPackage: Stage2WorkPackageStateV4,
): Promise<void> {
  const design = workPackage.design;
  if (design === undefined) {
    throw new Error(`Work Package ${workPackage.id} has no Design`);
  }
  const content = await readText(resolveWithin(root, design.path));
  const actual = sha256(content);
  if (actual !== design.documentSha256) {
    throw new Error(`Work Package ${workPackage.id} Design drifted`);
  }
  if (design.approval !== undefined && design.approval.designSha256 !== actual) {
    throw new Error(`Work Package ${workPackage.id} Design approval is stale`);
  }
}

export async function assertPackageImplementationCurrent(
  root: string,
  workPackage: Stage2WorkPackageStateV4,
): Promise<void> {
  const implementation = workPackage.implementation;
  if (implementation === undefined) {
    throw new Error(`Work Package ${workPackage.id} has no implementation`);
  }
  const current: Record<string, string> = {};
  for (const [path, expected] of Object.entries(implementation.fileHashes)) {
    if (!(await pathExists(resolveWithin(root, path)))) {
      throw new Error(`Implemented file is missing: ${path}`);
    }
    const actual = sha256(await readText(resolveWithin(root, path)));
    if (actual !== expected) {
      throw new Error(`Implemented file drifted: ${path}`);
    }
    current[path] = actual;
  }
  if (aggregateFileHashes(current) !== implementation.aggregateSha256) {
    throw new Error(`Work Package ${workPackage.id} implementation aggregate drifted`);
  }
}

export function snapshotWorkspaceAssignment(
  stage2: Stage2WorkspaceStage,
  assignment: Stage2WorkspaceAgentAssignment,
): WorkspaceAssignmentSnapshot {
  return {
    slot: assignment.slot,
    role: assignment.role,
    status: assignment.status,
    lease: assignment.lease,
    baseRevision: assignment.baseRevision,
    workspaceRevision: stage2.workspaceRevision,
    stateEpoch: stage2.stateEpoch,
    ...(assignment.workPackageId === undefined
      ? {}
      : { workPackageRevision: stage2.workPackages[assignment.workPackageId]!.revision }),
    ...(assignment.workPackageId === undefined ? {} : { workPackageId: assignment.workPackageId }),
    ...(assignment.runtimeRef === undefined ? {} : { runtimeRef: assignment.runtimeRef }),
    ...(assignment.runId === undefined ? {} : { runId: assignment.runId }),
    ...(assignment.designHash === undefined ? {} : { designHash: assignment.designHash }),
    ...(assignment.interfaceHash === undefined ? {} : { interfaceHash: assignment.interfaceHash }),
  };
}

export function assertWorkspaceAssignmentStillCurrent(
  stage2: Stage2WorkspaceStage,
  snapshot: WorkspaceAssignmentSnapshot,
): Stage2WorkspaceAgentAssignment {
  const assignment = stage2.agents[snapshot.slot];
  if (
    assignment.role !== snapshot.role
    || assignment.status !== snapshot.status
    || assignment.lease !== snapshot.lease
    || assignment.workPackageId !== snapshot.workPackageId
    || assignment.runtimeRef !== snapshot.runtimeRef
    || assignment.runId !== snapshot.runId
    || assignment.designHash !== snapshot.designHash
    || assignment.interfaceHash !== snapshot.interfaceHash
    || stage2.stateEpoch !== snapshot.stateEpoch
    || (
      snapshot.workPackageId !== undefined
      && stage2.workPackages[snapshot.workPackageId]?.revision !== snapshot.workPackageRevision
    )
  ) {
    throw new Error(
      `Stale Stage2 result for slot ${snapshot.slot}; workspace or assignment changed during Agent execution`,
    );
  }
  return assignment;
}

export async function applyPackageImplementation(
  root: string,
  workPackage: Stage2WorkPackageStateV4,
  proposal: Stage2PackageImplementationProposal,
): Promise<AppliedPackageFiles> {
  const pending: Array<{ path: string; absolute: string; content: string; hash: string; changed: boolean }> = [];
  for (const file of proposal.files) {
    const absolute = resolveWithin(root, file.path);
    const exists = await pathExists(absolute);
    const current = exists ? await readText(absolute) : undefined;
    const currentHash = current === undefined ? null : sha256(current);
    if (currentHash !== file.baseSha256) {
      throw new Error(
        `Implementation base hash mismatch for ${file.path}: expected ${String(file.baseSha256)}, current ${String(currentHash)}`,
      );
    }
    pending.push({
      path: file.path,
      absolute,
      content: ensureFinalNewline(file.content),
      hash: sha256(ensureFinalNewline(file.content)),
      changed: current !== ensureFinalNewline(file.content),
    });
  }
  for (const file of pending) {
    if (file.changed) {
      await atomicWriteText(file.absolute, file.content);
    }
  }
  const fileHashes = Object.fromEntries(pending.map((file) => [file.path, file.hash]));
  return {
    fileHashes,
    changedPaths: pending.filter((file) => file.changed).map((file) => file.path),
    aggregateSha256: aggregateFileHashes(fileHashes),
  };
}

export function aggregateFileHashes(hashes: Record<string, string>): string {
  return sha256(
    Object.entries(hashes)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([path, hash]) => `${path}:${hash}`)
      .join("\n"),
  );
}

export function assertAllowedPathsDisjoint(
  left: Stage2WorkspaceAgentAssignment,
  right: Stage2WorkspaceAgentAssignment,
): void {
  const leftPaths = new Set(left.allowedPaths.map(portablePath));
  const overlap = right.allowedPaths.filter((path) => leftPaths.has(portablePath(path)));
  if (overlap.length > 0) {
    throw new Error(`Active and Shadow assignments overlap paths: ${overlap.join(", ")}`);
  }
}

function sameHashes(left: Record<string, string>, right: Record<string, string>): boolean {
  const keys = [...new Set([...Object.keys(left), ...Object.keys(right)])].sort();
  return keys.every((key) => left[key] === right[key]);
}

function ensureFinalNewline(content: string): string {
  return content.endsWith("\n") ? content : `${content}\n`;
}

function portablePath(path: string): string {
  return path.replace(/\\/gu, "/").toLowerCase();
}
