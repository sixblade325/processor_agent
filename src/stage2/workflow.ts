import { basename } from "node:path";
import { randomUUID } from "node:crypto";
import { runCommands } from "../commands.js";
import {
  atomicWriteText,
  pathExists,
  readText,
  resolveWithin,
  sha256,
} from "../io.js";
import { loadStage2TaskSkills, renderSkillContext, skillReferences } from "../skill-registry.js";
import {
  assertApprovalCurrent,
  loadStage1,
  saveProjectState,
  type LoadedProject,
} from "../stage1.js";
import {
  assertVerificationInputsUnchanged,
  cancelDiscoveredStage2AgentRun,
  createStage2RunDirectory,
  createVerificationWorkspace,
  discoverStage2RunStatuses,
  snapshotVerificationInputs,
  type Stage2AgentExecutor,
} from "../stage2-runtime.js";
import type {
  CommandResult,
  CommandSpec,
  Stage1ProjectState,
  Stage2AgentSlot,
  Stage2ArchitectureReworkRecord,
  Stage2DecisionRequestState,
  Stage2DesignPatch,
  Stage2LegacyEvidence,
  Stage2PackageDesignProposal,
  Stage2PackageImplementationProposal,
  Stage2ProjectStage,
  Stage2RuntimeRegistryEntry,
  Stage2RuntimeRunRecord,
  Stage2SystemDesignRevisionRequest,
  Stage2SystemDesignProposal,
  Stage2WorkPackageStateV4,
  Stage2WorkspaceAgentAssignment,
  Stage2WorkspaceArchitectureReworkRecord,
  Stage2WorkspaceNextAction,
  Stage2WorkspaceStage,
  Stage2WorkspaceSummary,
  Stage2WorkspaceTaskEnvelope,
  Stage2WorkspaceStageV4,
} from "../types.js";
import {
  createWorkPackageStates,
  mergeDecisionRequests,
  systemDesignHashes,
  validateSystemDesignProposal,
  validateSystemDesignReviewReport,
  valueHash,
} from "./design-package.js";
import {
  assertPackageDesignCurrent,
  assertPackageImplementationCurrent,
  assertSystemDesignAuthorityCurrent,
  assertWorkspaceAssignmentStillCurrent,
  assertAllowedPathsDisjoint,
  applyPackageImplementation,
  snapshotWorkspaceAssignment,
  type WorkspaceAssignmentSnapshot,
} from "./gates.js";
import {
  renderPackageDesignDocument,
  renderPackageVerificationDocument,
  renderSystemDesignDocument,
} from "./presentation.js";
import {
  assignBlockedImplementationRepair,
  assignNextShadow,
  findWorkspaceAssignment,
  idleWorkspaceAssignment,
  promoteReadyShadow,
  releaseWorkspaceAssignment,
  workPackageAgentRole,
} from "./rotation.js";
import {
  CodexCliRuntime,
  setRunStatus,
  stage2TaskPhase,
  type AgentRuntime,
  type AgentRun,
  type AgentRunHandle,
} from "./runtime-port.js";
import {
  assertIndependentCommandEvidence,
  packageReviewFailures,
  packageWorkerEvidence,
  requiredCommandFailures,
} from "./evidence.js";
import {
  areIntegrationDependenciesComplete,
  areImplementationDependenciesComplete,
  isPackageDesignable,
  packageDesignIssues,
  transitivePackageConsumers,
  validatePackageDesignProposal,
  validatePackageImplementationProposal,
  validatePackageReviewReport,
} from "./work-package.js";
import {
  buildPackageDesignPatchPrompt,
  buildPackageDesignPrompt,
  buildPackageImplementationPrompt,
  buildPackageStaticReviewPrompt,
  buildPackageVerificationPrompt,
  buildSystemDesignDraftPrompt,
  buildSystemDesignReviewPrompt,
  packageDesignPatchSchema,
  packageDesignSchema,
  packageImplementationSchema,
  packageReviewSchema,
  systemDesignReviewSchema,
  systemDesignSchema,
} from "./worker-contracts.js";
import {
  applyDesignPatch,
  canonicalizePackageDesignProposal,
  packageDesignRevisionIssues,
  proposalHash,
  validateDesignPatch,
} from "./design-revision.js";
import { buildStage2ReadManifest } from "./read-manifest.js";
import { withStage2WorkspaceLock } from "./workspace-lock.js";

export interface LoadedStage2Workspace extends Omit<LoadedProject, "state"> {
  state: Stage1ProjectState & { stage2: Stage2WorkspaceStage };
}

export type Stage2WorkspaceCommandRunner = (
  specs: CommandSpec[],
  projectRoot: string,
) => CommandResult[] | Promise<CommandResult[]>;

export interface Stage2WorkspaceExecutionOptions {
  executor?: Stage2AgentExecutor;
  commandRunner?: Stage2WorkspaceCommandRunner;
  runtimeFactory?: (
    registry: Record<string, Stage2RuntimeRegistryEntry>,
    runs: Record<string, Stage2RuntimeRunRecord>,
  ) => AgentRuntime;
  now?: () => Date;
}

export interface Stage2WorkspaceRunResult<T> {
  loaded: LoadedStage2Workspace;
  output: T;
  runId: string;
  runtimeRef: string;
}

export interface Stage2WorkspaceMigrationReport {
  project: string;
  applied: boolean;
  sourceSchemaVersion: number;
  targetSchemaVersion: 5;
  sourceRevision: number;
  targetRevision: number;
  sourceStatus: string;
  targetStatus: Stage2WorkspaceStage["status"];
  retainedEvidence: Stage2LegacyEvidence[];
  retiredMechanisms: string[];
  nextRequiredAction: string;
}

export function sanitizeStage2BusinessProviderMetadata(stage2: Stage2WorkspaceStage): number {
  let removed = 0;
  const visit = (value: unknown): void => {
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    if (typeof value !== "object" || value === null) {
      return;
    }
    const record = value as Record<string, unknown>;
    for (const key of ["threadId", "externalSessionId"]) {
      if (key in record) {
        delete record[key];
        removed += 1;
      }
    }
    Object.values(record).forEach(visit);
  };
  for (const [key, value] of Object.entries(stage2)) {
    if (key !== "runtimeRegistry" && key !== "runtimeRuns") {
      visit(value);
    }
  }
  return removed;
}

export async function initStage2Workspace(
  projectPath: string,
  options: Stage2WorkspaceExecutionOptions = {},
): Promise<LoadedStage2Workspace> {
  const loaded = await loadStage1(projectPath);
  if (loaded.state.stage1.status !== "STAGE1_COMPLETE") {
    throw new Error(`Stage2 requires STAGE1_COMPLETE, current state is ${loaded.state.stage1.status}`);
  }
  if (loaded.state.stage2 !== undefined) {
    throw new Error(`Stage2 is already initialized at ${loaded.root}`);
  }
  await assertApprovalCurrent(loaded.root, loaded.state);
  const timestamp = now(options).toISOString();
  const stage2 = createEmptyWorkspaceStage(timestamp);
  loaded.state.stage2 = stage2;
  recordWorkspaceEvent(stage2, "STAGE2_WORKSPACE_INITIALIZED", undefined, undefined, options);
  const content = renderSystemDesignDocument(loaded.state, stage2, "待生成");
  stage2.systemDesign.documentSha256 = sha256(content);
  await atomicWriteText(resolveWithin(loaded.root, stage2.systemDesign.path), content);
  await saveProjectState(loaded.root, loaded.state);
  return refineWorkspace(loaded);
}

export async function loadStage2Workspace(projectPath: string): Promise<LoadedStage2Workspace> {
  const loaded = await loadStage1(projectPath);
  if (loaded.state.stage2 === undefined || loaded.state.stage2.schemaVersion !== 5) {
    const schema = loaded.state.stage2?.schemaVersion;
    throw new Error(
      schema === undefined
        ? "Stage2 is not initialized"
        : `Stage2 schema ${String(schema)} requires \`stage2 migrate --apply\` before using the current workflow`,
    );
  }
  sanitizeStage2BusinessProviderMetadata(loaded.state.stage2);
  validateWorkspaceStage(loaded.state.stage2);
  return refineWorkspace(loaded);
}

export async function migrateStage2Workspace(
  projectPath: string,
  apply: boolean,
  options: Stage2WorkspaceExecutionOptions = {},
): Promise<Stage2WorkspaceMigrationReport> {
  const loaded = await loadStage1(projectPath);
  const source = loaded.state.stage2;
  if (source === undefined) {
    throw new Error("Stage2 migration requires an initialized Stage2");
  }
  if (source.schemaVersion === 5) {
    const normalized = structuredClone(source);
    const removedMetadata = sanitizeStage2BusinessProviderMetadata(normalized);
    const normalizedAssignments = normalizeDuplicateWorkspaceRoles(normalized);
    validateWorkspaceStage(normalized);
    if (removedMetadata > 0 || normalizedAssignments > 0) {
      recordWorkspaceEvent(
        normalized,
        "STAGE2_SCHEMA_5_NORMALIZED",
        undefined,
        `providerMetadata=${String(removedMetadata)}; assignments=${String(normalizedAssignments)}`,
        options,
      );
    }
    if (apply && (removedMetadata > 0 || normalizedAssignments > 0)) {
      loaded.state.stage2 = normalized;
      await saveProjectState(loaded.root, loaded.state);
    }
    return {
      project: loaded.state.project.name,
      applied: apply && (removedMetadata > 0 || normalizedAssignments > 0),
      sourceSchemaVersion: 5,
      targetSchemaVersion: 5,
      sourceRevision: source.revision,
      targetRevision: normalized.revision,
      sourceStatus: source.status,
      targetStatus: normalized.status,
      retainedEvidence: structuredClone(normalized.systemDesign.legacyEvidence),
      retiredMechanisms: [
        ...(removedMetadata > 0 ? ["provider session IDs outside Runtime Registry"] : []),
        ...(normalizedAssignments > 0 ? ["duplicate persistent Agent roles"] : []),
      ],
      nextRequiredAction: "Run stage2 next to continue the current schema 5 workflow.",
    };
  }
  if (source.schemaVersion === 4) {
    const stage2 = migrateWorkspaceSchema4(source, now(options).toISOString());
    const content = renderSystemDesignDocument(
      loaded.state,
      stage2,
      stage2.systemDesign.approval === undefined ? "待批准" : "已批准",
    );
    stage2.systemDesign.documentSha256 = sha256(content);
    if (stage2.systemDesign.approval !== undefined) {
      const hashes = systemDesignHashes(requireSystemDesignProposal(stage2));
      stage2.systemDesign.approval.documentSha256 = stage2.systemDesign.documentSha256;
      stage2.systemDesign.approval.workPackagePlanSha256 = hashes.workPackages;
      for (const workPackage of Object.values(stage2.workPackages)) {
        if (workPackage.design?.approval !== undefined) {
          workPackage.design.approval.systemDesignSha256 = stage2.systemDesign.documentSha256;
        }
      }
    }
    recordWorkspaceEvent(
      stage2,
      "STAGE2_SCHEMA_5_MIGRATED",
      undefined,
      `schema=4; sourceRevision=${String(source.revision)}`,
      options,
    );
    if (apply) {
      loaded.state.stage2 = stage2;
      await atomicWriteText(resolveWithin(loaded.root, stage2.systemDesign.path), content);
      await saveProjectState(loaded.root, loaded.state);
    }
    return {
      project: loaded.state.project.name,
      applied: apply,
      sourceSchemaVersion: 4,
      targetSchemaVersion: 5,
      sourceRevision: source.revision,
      targetRevision: stage2.revision,
      sourceStatus: source.status,
      targetStatus: stage2.status,
      retainedEvidence: structuredClone(stage2.systemDesign.legacyEvidence),
      retiredMechanisms: [
        "single Work Package dependsOn",
        "mutable runtime entry as run history",
        "System Design session reuse in Package Loop",
      ],
      nextRequiredAction: "Run stage2 status and stage2 next to continue the migrated Package Loop.",
    };
  }
  if (source.schemaVersion !== 3) {
    throw new Error(`Unsupported Stage2 schema ${String(source.schemaVersion)}`);
  }
  if (loaded.state.stage1.status !== "STAGE1_COMPLETE") {
    throw new Error(`Stage2 schema 5 migration requires STAGE1_COMPLETE, current state is ${loaded.state.stage1.status}`);
  }
  await assertApprovalCurrent(loaded.root, loaded.state);
  const timestamp = now(options).toISOString();
  const retainedEvidence = collectLegacyEvidence(source);
  const activeRework = isLegacyActiveStage1Rework(source.architectureRework)
    ? convertLegacyRework(source.architectureRework, source)
    : undefined;
  const historicalRework = [
    ...(source.architectureReworkHistory ?? []),
    ...(
      source.architectureRework === undefined || activeRework !== undefined
        ? []
        : [source.architectureRework]
    ),
  ].map((record) => convertLegacyRework(record, source));
  const stage2 = createEmptyWorkspaceStage(timestamp);
  stage2.status = activeRework === undefined ? "SYSTEM_DESIGN_DRAFT" : "BLOCKED";
  stage2.revision = source.revision + 1;
  stage2.workspaceRevision = 1;
  stage2.systemDesign.legacyEvidence = retainedEvidence;
  const legacyRuntimes = collectLegacyRuntimes(source, timestamp);
  stage2.runtimeRegistry = legacyRuntimes.registry;
  stage2.runtimeRuns = legacyRuntimes.runs;
  stage2.migration = {
    migratedAt: timestamp,
    sourceSchemaVersion: 3,
    sourceRevision: source.revision,
    sourceStatus: source.status,
    sourcePlanSha256: source.topology.planDocumentSha256,
    retainedEvidenceIds: retainedEvidence.map((evidence) => evidence.id),
  };
  if (activeRework !== undefined) {
    stage2.architectureRework = activeRework;
    stage2.blockers = [
      `Architecture Rework ${activeRework.id} must return to a current Stage1 approval before System Design`,
    ];
  }
  if (historicalRework.length > 0) {
    stage2.architectureReworkHistory = historicalRework;
  }
  const content = renderSystemDesignDocument(loaded.state, stage2, "待生成");
  stage2.systemDesign.documentSha256 = sha256(content);
  stage2.history.push({
    at: timestamp,
    revision: stage2.revision,
    workspaceRevision: stage2.workspaceRevision,
    event: "STAGE2_SCHEMA_5_MIGRATED",
    detail: `schema=3; sourceRevision=${String(source.revision)}; evidence=${String(retainedEvidence.length)}`,
  });
  if (apply) {
    loaded.state.stage2 = stage2;
    await atomicWriteText(resolveWithin(loaded.root, stage2.systemDesign.path), content);
    await saveProjectState(loaded.root, loaded.state);
  }
  return {
    project: loaded.state.project.name,
    applied: apply,
    sourceSchemaVersion: 3,
    targetSchemaVersion: 5,
    sourceRevision: source.revision,
    targetRevision: stage2.revision,
    sourceStatus: source.status,
    targetStatus: stage2.status,
    retainedEvidence,
    retiredMechanisms: [
      "fixed_topology_decision_loop",
      "planner_role",
      "required_topology_research",
      "implementation_unit_as_design_topology",
      "per_unit_verification_mode",
    ],
    nextRequiredAction: activeRework === undefined
      ? "运行 stage2 start 生成 System Design Draft 和独立审查。"
      : `先闭合并恢复 Architecture Rework ${activeRework.id}。`,
  };
}

export async function runSystemDesignDraft(
  projectPath: string,
  instruction?: string,
  options: Stage2WorkspaceExecutionOptions = {},
): Promise<Stage2WorkspaceRunResult<Stage2SystemDesignProposal>> {
  const loaded = await loadStage2Workspace(projectPath);
  if (
    loaded.state.stage2.status !== "SYSTEM_DESIGN_DRAFT"
    && loaded.state.stage2.status !== "SYSTEM_DESIGN_DECISIONS"
  ) {
    throw new Error(`System Design cannot run from ${loaded.state.stage2.status}`);
  }
  await assertApprovalCurrent(loaded.root, loaded.state);
  const recordedRevision = latestSystemDesignRevisionRequest(loaded.state.stage2);
  const explicitInstruction = instruction?.trim();
  if (
    recordedRevision !== undefined
    && explicitInstruction !== undefined
    && explicitInstruction !== ""
    && explicitInstruction !== recordedRevision.instruction
  ) {
    throw new Error(
      `System Design revision ${recordedRevision.id} already has a recorded instruction; rerun draft without --instruction`,
    );
  }
  const effectiveInstruction = recordedRevision?.instruction ?? instruction;
  const snapshotRevision = loaded.state.stage2.workspaceRevision;
  const working = structuredClone(loaded.state.stage2);
  const runtime = createAgentRuntime(working.runtimeRegistry, working.runtimeRuns, options);
  const draftSkills = await loadStage2TaskSkills("system_design_draft");
  const draftSkillRefs = skillReferences(draftSkills);
  const draftEnvelope = await buildWorkspaceEnvelope(
    loaded,
    working,
    "system_design_draft",
    "A",
    draftSkillRefs,
  );
  const draftRuntimeRoot = await createStage2RunDirectory(
    loaded.root,
    "system",
    "system_design_draft",
  );
  await writeTaskEnvelope(draftRuntimeRoot, draftEnvelope);
  const draftRequest = {
    task: "system_design_draft" as const,
    projectRoot: loaded.root,
    runtimeRoot: draftRuntimeRoot,
    prompt: buildSystemDesignDraftPrompt(
      draftEnvelope,
      loaded.state,
      effectiveInstruction,
      renderSkillContext(draftSkills),
    ),
    schema: systemDesignSchema(),
    readManifest: draftEnvelope.readManifest,
    persistent: true,
    sandbox: "read-only" as const,
    inputArtifactHashes: inputHashes(loaded.state, working),
    slot: "A" as const,
  };
  const draftHandle = working.systemDesign.runtimeRef === undefined
    ? await runtime.start(draftRequest)
    : await runtime.resume(working.systemDesign.runtimeRef, draftRequest);
  const draftRun = await draftHandle.completion;
  await writeAgentRun(draftRuntimeRoot, draftRun);
  const architectureRoles = loaded.state.stage1.projectSpec?.architecture.roles ?? [];
  const proposal = validateSystemDesignProposal(draftRun.output, architectureRoles);
  setRunStatus(working.runtimeRuns[draftRun.runId]!, "applied", now(options));
  await assertProjectReferencesExist(loaded.root, proposal.architectureReferences);

  working.systemDesign.revision += 1;
  working.systemDesign.draftedAt = now(options).toISOString();
  working.systemDesign.runtimeRef = draftRun.runtimeRef;
  working.systemDesign.runId = draftRun.runId;
  working.systemDesign.proposal = proposal;
  const appliedRevision = recordedRevision === undefined
    ? undefined
    : working.systemDesign.revisionRequests?.find((request) => request.id === recordedRevision.id);
  if (appliedRevision !== undefined) {
    appliedRevision.status = "applied";
    appliedRevision.appliedDesignRevision = working.systemDesign.revision;
    appliedRevision.appliedProposalSha256 = valueHash(proposal);
  }
  delete working.systemDesign.approval;
  delete working.systemDesign.review;
  const proposalDecisions = mergeDecisionRequests(
    loaded.state.stage2.systemDesign.decisions,
    proposal.decisionRequests,
  );
  working.systemDesign.decisionOrder = proposalDecisions.order;
  working.systemDesign.decisions = proposalDecisions.decisions;
  working.status = "SYSTEM_DESIGN_DRAFT";
  working.blockers = ["等待独立 System Design Review"];
  let draftContent = renderSystemDesignDocument(
    loaded.state,
    working,
    "待独立审查",
  );
  working.systemDesign.documentSha256 = sha256(draftContent);

  const currentAfterDraft = await loadStage2Workspace(projectPath);
  if (currentAfterDraft.state.stage2.workspaceRevision !== snapshotRevision) {
    throw new Error("Stale System Design result; Stage2 changed while Agent A was running");
  }
  currentAfterDraft.state.stage2 = working;
  recordWorkspaceEvent(
    currentAfterDraft.state.stage2,
    "SYSTEM_DESIGN_DRAFTED",
    undefined,
    `designRuntime=${draftRun.runtimeRef}`,
    options,
  );
  draftContent = renderSystemDesignDocument(
    currentAfterDraft.state,
    currentAfterDraft.state.stage2,
    "待独立审查",
  );
  currentAfterDraft.state.stage2.systemDesign.documentSha256 = sha256(draftContent);
  await atomicWriteText(
    resolveWithin(currentAfterDraft.root, currentAfterDraft.state.stage2.systemDesign.path),
    draftContent,
  );
  await saveProjectState(currentAfterDraft.root, currentAfterDraft.state);
  const reviewSnapshotRevision = currentAfterDraft.state.stage2.workspaceRevision;

  const reviewSkills = await loadStage2TaskSkills("system_design_review");
  const reviewSkillRefs = skillReferences(reviewSkills);
  const reviewEnvelope = await buildWorkspaceEnvelope(
    currentAfterDraft,
    working,
    "system_design_review",
    "B",
    reviewSkillRefs,
  );
  const reviewRuntimeRoot = await createStage2RunDirectory(
    loaded.root,
    "system",
    "system_design_review",
  );
  await writeTaskEnvelope(reviewRuntimeRoot, reviewEnvelope);
  const previousReviewRuntime = working.systemDesign.reviewRuntimeRef;
  const reviewRequest = {
    task: "system_design_review" as const,
    projectRoot: loaded.root,
    runtimeRoot: reviewRuntimeRoot,
    prompt: buildSystemDesignReviewPrompt(
      reviewEnvelope,
      working.systemDesign.documentSha256,
      renderSkillContext(reviewSkills),
    ),
    schema: systemDesignReviewSchema(working.systemDesign.documentSha256),
    readManifest: reviewEnvelope.readManifest,
    persistent: true,
    sandbox: "read-only" as const,
    inputArtifactHashes: {
      ...inputHashes(currentAfterDraft.state, working),
      systemDesign: working.systemDesign.documentSha256,
    },
    slot: "B" as const,
  };
  const reviewHandle = previousReviewRuntime === undefined
    ? await runtime.start(reviewRequest)
    : await runtime.resume(previousReviewRuntime, reviewRequest);
  const reviewRun = await reviewHandle.completion;
  await writeAgentRun(reviewRuntimeRoot, reviewRun);
  const review = validateSystemDesignReviewReport(
    reviewRun.output,
    working.systemDesign.documentSha256,
  );
  setRunStatus(working.runtimeRuns[reviewRun.runId]!, "applied", now(options));
  const mergedDecisions = mergeDecisionRequests(
    working.systemDesign.decisions,
    [...proposal.decisionRequests, ...review.decisionRequests],
  );
  working.systemDesign.decisionOrder = mergedDecisions.order;
  working.systemDesign.decisions = mergedDecisions.decisions;
  working.systemDesign.review = {
    reviewedAt: now(options).toISOString(),
    runtimeRef: reviewRun.runtimeRef,
    runId: reviewRun.runId,
    report: review,
  };
  working.systemDesign.reviewRuntimeRef = reviewRun.runtimeRef;
  const reviewErrors = review.findings
    .filter((finding) => finding.severity === "error")
    .map((finding) => `${finding.code}: ${finding.message}`);
  const openDecisions = mergedDecisions.order.filter((id) =>
    mergedDecisions.decisions[id]?.status === "open"
  );
  if (review.verdict === "fail" || reviewErrors.length > 0) {
    working.status = "SYSTEM_DESIGN_DRAFT";
    working.blockers = reviewErrors.length > 0 ? reviewErrors : [review.summary];
  } else if (openDecisions.length > 0) {
    working.status = "SYSTEM_DESIGN_DECISIONS";
    working.blockers = [];
  } else {
    working.status = "SYSTEM_DESIGN_APPROVAL";
    working.blockers = [];
  }
  return withStage2WorkspaceLock(loaded.root, async () => {
  const current = await loadStage2Workspace(projectPath);
  if (current.state.stage2.workspaceRevision !== reviewSnapshotRevision) {
    throw new Error("Stale System Design review; Stage2 changed while Agent B was running");
  }
  current.state.stage2 = working;
  recordWorkspaceEvent(
    current.state.stage2,
    "SYSTEM_DESIGN_REVIEWED",
    undefined,
    `designRuntime=${draftRun.runtimeRef}; reviewRuntime=${reviewRun.runtimeRef}`,
    options,
  );
  const finalContent = renderSystemDesignDocument(
    current.state,
    current.state.stage2,
    current.state.stage2.status === "SYSTEM_DESIGN_DRAFT"
      ? "需修订"
      : current.state.stage2.status === "SYSTEM_DESIGN_DECISIONS"
      ? "待决策"
      : "待批准",
  );
  current.state.stage2.systemDesign.documentSha256 = sha256(finalContent);
  await atomicWriteText(resolveWithin(current.root, current.state.stage2.systemDesign.path), finalContent);
  await saveProjectState(current.root, current.state);
  return {
    loaded: current,
    output: proposal,
    runId: draftRun.runId,
    runtimeRef: draftRun.runtimeRef,
  };
  });
}

export async function answerStage2DecisionRequest(
  projectPath: string,
  decisionId: string,
  answer: { optionId?: string; customConclusion?: string; note?: string },
  options: Stage2WorkspaceExecutionOptions = {},
): Promise<LoadedStage2Workspace> {
  const loaded = await loadStage2Workspace(projectPath);
  const target = findDecisionRequest(loaded.state.stage2, decisionId);
  const decision = target.decision;
  if (decision.status !== "open") {
    throw new Error(`DecisionRequest ${decisionId} is already answered`);
  }
  const hasOption = answer.optionId !== undefined;
  const hasCustom = answer.customConclusion !== undefined;
  if (hasOption === hasCustom) {
    throw new Error("DecisionRequest answer requires exactly one optionId or customConclusion");
  }
  let conclusion: string;
  if (answer.optionId !== undefined) {
    const selected = decision.spec.options.find((option) => option.id === answer.optionId);
    if (selected === undefined) {
      throw new Error(`Unknown option ${answer.optionId} for DecisionRequest ${decisionId}`);
    }
    conclusion = `${selected.label}：${selected.summary}`;
  } else {
    conclusion = answer.customConclusion!.trim();
    if (conclusion === "") {
      throw new Error("Custom DecisionRequest conclusion cannot be empty");
    }
  }
  decision.status = "answered";
  decision.resolution = {
    ...(answer.optionId === undefined ? {} : { selectedOption: answer.optionId }),
    ...(answer.customConclusion === undefined
      ? {}
      : { customConclusion: answer.customConclusion.trim() }),
    conclusion,
    ...(answer.note?.trim() ? { note: answer.note.trim() } : {}),
    answeredAt: now(options).toISOString(),
    workspaceRevision: loaded.state.stage2.workspaceRevision,
  };
  recordWorkspaceEvent(
    loaded.state.stage2,
    "DECISION_REQUEST_ANSWERED",
    target.workPackage?.id,
    decisionId,
    options,
  );
  if (target.scope === "system") {
    loaded.state.stage2.status = "SYSTEM_DESIGN_DRAFT";
    delete loaded.state.stage2.systemDesign.review;
    delete loaded.state.stage2.systemDesign.approval;
    const content = renderSystemDesignDocument(loaded.state, loaded.state.stage2, "需修订");
    loaded.state.stage2.systemDesign.documentSha256 = sha256(content);
    await atomicWriteText(resolveWithin(loaded.root, loaded.state.stage2.systemDesign.path), content);
  } else {
    const workPackage = target.workPackage!;
    workPackage.status = "DESIGNING";
    if (workPackage.design !== undefined) {
      delete workPackage.design.approval;
      const content = renderPackageDesignDocument(
        workPackage,
        workPackage.design.proposal,
        workPackage.design.revision,
        "需修订",
        workPackage.design.skills,
      );
      workPackage.design.documentSha256 = sha256(content);
      await atomicWriteText(resolveWithin(loaded.root, workPackage.design.path), content);
    }
  }
  await saveProjectState(loaded.root, loaded.state);
  return loaded;
}

export async function requestSystemDesignRevision(
  projectPath: string,
  expectedDesignRevision: number,
  instruction: string,
  options: Stage2WorkspaceExecutionOptions = {},
): Promise<LoadedStage2Workspace> {
  const loaded = await loadStage2Workspace(projectPath);
  const stage2 = loaded.state.stage2;
  const pendingRequest = latestSystemDesignRevisionRequest(stage2);
  const updatesPendingRequest = stage2.status === "SYSTEM_DESIGN_DRAFT"
    && pendingRequest?.status === "pending";
  if (stage2.status !== "SYSTEM_DESIGN_APPROVAL" && !updatesPendingRequest) {
    throw new Error(`System Design revision cannot be requested from ${stage2.status}`);
  }
  const currentDesignRevision = updatesPendingRequest
    ? pendingRequest.baseDesignRevision
    : stage2.systemDesign.revision;
  if (currentDesignRevision !== expectedDesignRevision) {
    throw new Error(
      `System Design revision changed: expected ${String(expectedDesignRevision)}, current ${String(currentDesignRevision)}`,
    );
  }
  const normalizedInstruction = instruction.trim();
  if (normalizedInstruction === "") {
    throw new Error("System Design revision instruction cannot be empty");
  }
  requireSystemDesignProposal(stage2);
  if (!updatesPendingRequest && stage2.systemDesign.review?.report.verdict !== "pass") {
    throw new Error("Only a reviewed System Design candidate can be returned for user revision");
  }
  if (Object.values(stage2.agents).some((assignment) => assignment.status === "working")) {
    throw new Error("System Design revision cannot be requested while a Stage2 Agent is working");
  }
  await assertApprovalCurrent(loaded.root, loaded.state);
  const currentContent = await readText(resolveWithin(loaded.root, stage2.systemDesign.path));
  if (sha256(currentContent) !== stage2.systemDesign.documentSha256) {
    throw new Error("System Design document changed before the revision request");
  }

  if (updatesPendingRequest) {
    pendingRequest.instruction = normalizedInstruction;
    stage2.blockers = [`${pendingRequest.id}: 等待 Agent A 应用用户修订要求`];
    recordWorkspaceEvent(
      stage2,
      "SYSTEM_DESIGN_REVISION_REQUEST_UPDATED",
      undefined,
      `${pendingRequest.id}; baseDesignRevision=${String(pendingRequest.baseDesignRevision)}`,
      options,
    );
    const content = renderSystemDesignDocument(loaded.state, stage2, "需修订");
    stage2.systemDesign.documentSha256 = sha256(content);
    await atomicWriteText(resolveWithin(loaded.root, stage2.systemDesign.path), content);
    await saveProjectState(loaded.root, loaded.state);
    return loaded;
  }

  const requests = stage2.systemDesign.revisionRequests ?? [];
  const request: Stage2SystemDesignRevisionRequest = {
    id: nextSystemDesignRevisionRequestId(requests),
    requestedAt: now(options).toISOString(),
    baseDesignRevision: stage2.systemDesign.revision,
    baseDocumentSha256: stage2.systemDesign.documentSha256,
    instruction: normalizedInstruction,
    status: "pending",
  };
  stage2.systemDesign.revisionRequests = [...requests, request];
  delete stage2.systemDesign.review;
  delete stage2.systemDesign.approval;
  stage2.status = "SYSTEM_DESIGN_DRAFT";
  stage2.blockers = [`${request.id}: 等待 Agent A 应用用户修订要求`];
  recordWorkspaceEvent(
    stage2,
    "SYSTEM_DESIGN_REVISION_REQUESTED",
    undefined,
    `${request.id}; baseDesignRevision=${String(request.baseDesignRevision)}; baseDocumentSha256=${request.baseDocumentSha256}`,
    options,
  );
  const content = renderSystemDesignDocument(loaded.state, stage2, "需修订");
  stage2.systemDesign.documentSha256 = sha256(content);
  await atomicWriteText(resolveWithin(loaded.root, stage2.systemDesign.path), content);
  await saveProjectState(loaded.root, loaded.state);
  return loaded;
}

export async function approveSystemDesign(
  projectPath: string,
  options: Stage2WorkspaceExecutionOptions = {},
): Promise<LoadedStage2Workspace> {
  const loaded = await loadStage2Workspace(projectPath);
  const stage2 = loaded.state.stage2;
  if (stage2.status !== "SYSTEM_DESIGN_APPROVAL") {
    throw new Error(`System Design is not awaiting approval: ${stage2.status}`);
  }
  const proposal = requireSystemDesignProposal(stage2);
  const review = stage2.systemDesign.review;
  if (review?.report.verdict !== "pass") {
    throw new Error("System Design requires a passing independent review");
  }
  const open = stage2.systemDesign.decisionOrder.filter((id) =>
    stage2.systemDesign.decisions[id]?.status === "open"
  );
  if (open.length > 0) {
    throw new Error(`System Design has open DecisionRequests: ${open.join(", ")}`);
  }
  await assertApprovalCurrent(loaded.root, loaded.state);
  const currentContent = await readText(resolveWithin(loaded.root, stage2.systemDesign.path));
  if (sha256(currentContent) !== stage2.systemDesign.documentSha256) {
    throw new Error("System Design document changed before approval");
  }
  const previousPackages = stage2.workPackages;
  const nextPackages = createWorkPackageStates(proposal);
  const rework = stage2.architectureRework;
  const affectedByRework = new Set(rework?.affectedWorkPackages ?? []);
  for (const [id, nextPackage] of Object.entries(nextPackages)) {
    const previous = previousPackages[id];
    if (
      previous === undefined
      || valueHash(previous.plan) !== valueHash(nextPackage.plan)
      || affectedByRework.has(id)
    ) {
      if (previous !== undefined) {
        nextPackage.reopened = [...previous.reopened];
        if (previous.design !== undefined) {
          nextPackage.design = structuredClone(previous.design);
          delete nextPackage.design.approval;
        }
      }
      continue;
    }
    nextPackages[id] = structuredClone(previous);
    nextPackages[id]!.order = nextPackage.order;
    nextPackages[id]!.plan = structuredClone(nextPackage.plan);
  }
  stage2.workPackages = nextPackages;
  stage2.workPackageOrder = proposal.workPackages.map((workPackage) => workPackage.id);
  stage2.status = "PACKAGE_LOOP";
  stage2.blockers = [];
  const hashes = systemDesignHashes(proposal);
  if (rework?.status === "system_design_rework") {
    const resumedAt = now(options).toISOString();
    rework.status = "resumed";
    rework.resumedAt = resumedAt;
    rework.updatedAt = resumedAt;
    stage2.architectureReworkHistory = [
      ...(stage2.architectureReworkHistory ?? []),
      structuredClone(rework),
    ];
    delete stage2.architectureRework;
  }
  for (const assignment of Object.values(stage2.agents)) {
    delete assignment.runtimeRef;
    delete assignment.runId;
  }
  recordWorkspaceEvent(stage2, "SYSTEM_DESIGN_APPROVED", undefined, undefined, options);
  const approvedContent = renderSystemDesignDocument(loaded.state, stage2, "已批准");
  stage2.systemDesign.documentSha256 = sha256(approvedContent);
  stage2.systemDesign.approval = {
    approvedAt: now(options).toISOString(),
    designRevision: stage2.systemDesign.revision,
    documentSha256: stage2.systemDesign.documentSha256,
    architectureHashes: { ...(loaded.state.stage1.approval?.documentHashes ?? {}) },
    componentTopologySha256: hashes.components,
    interfaceSha256: hashes.interfaces,
    workPackagePlanSha256: hashes.workPackages,
  };
  stage2.stateEpoch += 1;
  assignNextShadow(stage2, "A");
  for (const workPackage of Object.values(stage2.workPackages)) {
    const packageApproval = workPackage.design?.approval;
    if (packageApproval === undefined) {
      continue;
    }
    packageApproval.systemDesignSha256 = stage2.systemDesign.documentSha256;
    packageApproval.interfaceSha256 = hashes.interfaces;
    packageApproval.architectureHashes = {
      ...(loaded.state.stage1.approval?.documentHashes ?? {}),
    };
  }
  await atomicWriteText(resolveWithin(loaded.root, stage2.systemDesign.path), approvedContent);
  await saveProjectState(loaded.root, loaded.state);
  return loaded;
}

export async function summarizeStage2Workspace(
  loaded: LoadedStage2Workspace,
): Promise<Stage2WorkspaceSummary> {
  const stage2 = loaded.state.stage2;
  const actions = getReadyWorkspaceActions(stage2);
  const active = Object.values(stage2.agents).find((assignment) => assignment.role === "active");
  const shadow = Object.values(stage2.agents).find((assignment) => assignment.role === "shadow");
  const proposal = stage2.systemDesign.proposal;
  const materializedBoard = stage2.workPackageOrder.map((id) => {
    const workPackage = requireWorkPackage(stage2, id);
    return {
      workPackageId: id,
      componentIds: [...workPackage.plan.componentIds],
      designDependsOn: [...workPackage.plan.designDependsOn],
      implementationDependsOn: [...workPackage.plan.implementationDependsOn],
      integrationDependsOn: [...workPackage.plan.integrationDependsOn],
      status: workPackage.status,
      agentRole: workPackageAgentRole(stage2, id),
      ...(workPackage.design === undefined ? {} : { designRevision: workPackage.design.revision }),
      designPath: workPackage.plan.designPath,
      sourcePaths: [...workPackage.plan.allowedSourcePaths],
      testPaths: [...workPackage.plan.allowedTestPaths],
      verificationStatus: workPackage.status === "COMPLETE"
        ? "complete" as const
        : workPackage.verification?.staticReview !== undefined
          || workPackage.verification?.verificationReview !== undefined
        ? "workers_pending" as const
        : workPackage.verification !== undefined
        ? "primary_pending" as const
        : "not_started" as const,
      blockers: [...workPackage.blockers],
    };
  });
  const board = materializedBoard.length > 0 || proposal === undefined
    ? materializedBoard
    : proposal.workPackages.map((plan) => ({
      workPackageId: plan.id,
      componentIds: [...plan.componentIds],
      designDependsOn: [...plan.designDependsOn],
      implementationDependsOn: [...plan.implementationDependsOn],
      integrationDependsOn: [...plan.integrationDependsOn],
      status: "PLANNED" as const,
      agentRole: "idle" as const,
      designPath: plan.designPath,
      sourcePaths: [...plan.allowedSourcePaths],
      testPaths: [...plan.allowedTestPaths],
      verificationStatus: "not_started" as const,
      blockers: [],
    }));
  const runViews = new Map(
    Object.values(stage2.runtimeRuns).map((run) => [run.runId, {
      runId: run.runId,
      runtimeRef: run.runtimeRef,
      task: run.task,
      status: run.status,
      ...(run.workPackageId === undefined ? {} : { workPackageId: run.workPackageId }),
      ...(run.slot === undefined ? {} : { slot: run.slot }),
      ...(run.startedAt === undefined ? {} : { startedAt: run.startedAt }),
      ...(run.lastEventAt === undefined ? {} : { lastEventAt: run.lastEventAt }),
      ...(run.deadlineAt === undefined ? {} : { deadlineAt: run.deadlineAt }),
      ...(run.noEventTimeoutMs === undefined ? {} : { noEventTimeoutMs: run.noEventTimeoutMs }),
      ...(run.completedAt === undefined ? {} : { completedAt: run.completedAt }),
      eventCount: run.eventCount,
      ...(run.pid === undefined ? {} : { pid: run.pid }),
      runtimePath: run.runtimePath,
      ...(run.error === undefined ? {} : { error: run.error }),
    }]),
  );
  for (const discovered of await discoverStage2RunStatuses(loaded.root)) {
    const persisted = runViews.get(discovered.runId);
    const persistedIsFinal = persisted?.status === "applied"
      || persisted?.status === "validation_failed"
      || persisted?.status === "failed"
      || persisted?.status === "cancelled";
    runViews.set(discovered.runId, {
      ...(persisted ?? {
        runId: discovered.runId,
        runtimeRef: discovered.runtimeRef,
        task: discovered.task,
        status: discovered.status,
        eventCount: discovered.eventCount,
        runtimePath: discovered.runtimePath,
      }),
      status: persistedIsFinal ? persisted!.status : discovered.status,
      ...(discovered.workPackageId === undefined
        ? {}
        : { workPackageId: discovered.workPackageId }),
      ...(discovered.slot === undefined ? {} : { slot: discovered.slot }),
      ...(discovered.startedAt === undefined ? {} : { startedAt: discovered.startedAt }),
      ...(discovered.lastEventAt === undefined ? {} : { lastEventAt: discovered.lastEventAt }),
      ...(discovered.deadlineAt === undefined ? {} : { deadlineAt: discovered.deadlineAt }),
      ...(discovered.noEventTimeoutMs === undefined
        ? {}
        : { noEventTimeoutMs: discovered.noEventTimeoutMs }),
      ...(discovered.completedAt === undefined ? {} : { completedAt: discovered.completedAt }),
      eventCount: discovered.eventCount,
      ...(discovered.pid === undefined ? {} : { pid: discovered.pid }),
      runtimePath: discovered.runtimePath,
    });
  }
  const runs = [...runViews.values()]
    .sort((left, right) => (right.startedAt ?? "").localeCompare(left.startedAt ?? ""))
    .slice(0, 20)
    .map((run) => structuredClone(run));
  return {
    projectName: loaded.state.project.name,
    schemaVersion: 5,
    status: stage2.status,
    revision: stage2.revision,
    workspaceRevision: stage2.workspaceRevision,
    complete: Object.values(stage2.workPackages).filter((workPackage) =>
      workPackage.status === "COMPLETE"
    ).length,
    total: board.length,
    ...(active === undefined ? {} : { active: structuredClone(active) }),
    ...(shadow === undefined ? {} : { shadow: structuredClone(shadow) }),
    readyActions: actions,
    blockers: [...stage2.blockers],
    systemDesign: {
      path: stage2.systemDesign.path,
      revision: stage2.systemDesign.revision,
      drafted: proposal !== undefined,
      ...(stage2.systemDesign.review === undefined
        ? {}
        : { reviewVerdict: stage2.systemDesign.review.report.verdict }),
      openDecisions: stage2.systemDesign.decisionOrder.filter((id) =>
        stage2.systemDesign.decisions[id]?.status === "open"
      ).length,
      approvalCurrent: stage2.systemDesign.approval?.documentSha256
        === stage2.systemDesign.documentSha256,
      ...(latestSystemDesignRevisionRequest(stage2) === undefined
        ? {}
        : { revisionRequest: structuredClone(latestSystemDesignRevisionRequest(stage2)!) }),
    },
    board,
    runs,
    ...(actions.find(isUserGateAction) === undefined
      ? {}
      : { currentUserGate: describeUserGate(actions.find(isUserGateAction)!) }),
    nextMachineActions: actions.filter((action) => isMachineAction(action)).map(describeMachineAction),
    ...(stage2.architectureRework === undefined
      ? {}
      : { architectureRework: structuredClone(stage2.architectureRework) }),
  };
}

export function getReadyWorkspaceActions(stage2: Stage2WorkspaceStage): Stage2WorkspaceNextAction[] {
  if (stage2.architectureRework !== undefined && isActiveStage1Rework(stage2.architectureRework)) {
    return [{
      kind: "architecture_rework_stage1",
      reworkId: stage2.architectureRework.id,
      repairKind: stage2.architectureRework.repair.kind,
      repairTarget: stage2.architectureRework.repair.target,
    }];
  }
  if (stage2.status === "BLOCKED") {
    return [{ kind: "blocked", blockers: [...stage2.blockers] }];
  }
  if (stage2.status === "SYSTEM_DESIGN_DRAFT") {
    return [{
      kind: stage2.systemDesign.proposal === undefined
        ? "system_design_draft"
        : "system_design_revision",
      slot: "A",
      ...(stage2.systemDesign.proposal === undefined ? {} : { issues: [...stage2.blockers] }),
    } as Stage2WorkspaceNextAction];
  }
  if (stage2.status === "SYSTEM_DESIGN_DECISIONS") {
    const id = stage2.systemDesign.decisionOrder.find((decisionId) =>
      stage2.systemDesign.decisions[decisionId]?.status === "open"
    );
    if (id === undefined) {
      return [{ kind: "system_design_revision", slot: "A", issues: [] }];
    }
    return [{ kind: "decision_request", scope: "system", decision: stage2.systemDesign.decisions[id]!.spec }];
  }
  if (stage2.status === "SYSTEM_DESIGN_APPROVAL") {
    return [{
      kind: "system_design_approval",
      path: stage2.systemDesign.path,
      revision: stage2.systemDesign.revision,
      documentSha256: stage2.systemDesign.documentSha256,
    }];
  }
  if (stage2.status === "BASELINE_READY") {
    return [{ kind: "baseline_complete" }];
  }
  if (stage2.status !== "PACKAGE_LOOP") {
    return [{ kind: "blocked", blockers: [`Unsupported Stage2 status ${stage2.status}`] }];
  }
  for (const id of stage2.workPackageOrder) {
    const workPackage = requireWorkPackage(stage2, id);
    const decisionId = workPackage.decisionOrder.find((candidate) =>
      workPackage.decisions[candidate]?.status === "open"
    );
    if (decisionId !== undefined) {
      return [{
        kind: "decision_request",
        scope: "package",
        workPackageId: id,
        decision: workPackage.decisions[decisionId]!.spec,
      }];
    }
  }
  const actions: Stage2WorkspaceNextAction[] = [];
  const shadow = Object.values(stage2.agents).find((assignment) => assignment.role === "shadow");
  if (shadow?.workPackageId !== undefined) {
    const workPackage = requireWorkPackage(stage2, shadow.workPackageId);
    if (shadow.status === "working") {
      // The run is visible through runtimeRuns; do not dispatch it twice.
    } else if (workPackage.status === "DESIGNING") {
      actions.push({ kind: "package_design", workPackageId: workPackage.id, slot: shadow.slot });
    } else if (workPackage.status === "AWAITING_APPROVAL") {
      const issues = packageDesignIssues(workPackage);
      actions.push(issues.length === 0
        ? {
          kind: "package_design_approval",
          workPackageId: workPackage.id,
          path: workPackage.design!.path,
          designSha256: workPackage.design!.documentSha256,
        }
        : {
          kind: "package_design_revision",
          workPackageId: workPackage.id,
          slot: shadow.slot,
          issues,
        });
    } else if (workPackage.status === "READY") {
      actions.push({ kind: "waiting_for_rotation", workPackageId: workPackage.id, slot: shadow.slot });
    }
  }
  const active = Object.values(stage2.agents).find((assignment) => assignment.role === "active");
  if (active?.workPackageId !== undefined) {
    const workPackage = requireWorkPackage(stage2, active.workPackageId);
    if (active.status !== "working" && workPackage.status === "IMPLEMENTING") {
      actions.push({ kind: "active_implementation", workPackageId: workPackage.id, slot: active.slot });
    }
  }
  const verifying = stage2.workPackageOrder
    .map((id) => requireWorkPackage(stage2, id))
    .find((workPackage) => workPackage.status === "VERIFYING");
  if (verifying !== undefined) {
    actions.push({ kind: "verification", workPackageId: verifying.id });
  }
  const blocked = stage2.workPackageOrder
    .map((id) => requireWorkPackage(stage2, id))
    .find((workPackage) => workPackage.status === "BLOCKED" || workPackage.status === "NEEDS_REALIGN");
  if (blocked !== undefined) {
    actions.push({ kind: "blocked", blockers: [...blocked.blockers] });
  }
  if (actions.length > 0) {
    return actions;
  }
  const running = [...new Set([
    ...Object.values(stage2.runtimeRuns)
      .filter((run) => run.status === "queued" || run.status === "running")
      .map((run) => run.runId),
    ...Object.values(stage2.agents)
      .filter((assignment) => assignment.status === "working" && assignment.runId !== undefined)
      .map((assignment) => assignment.runId!),
  ])];
  return running.length > 0
    ? [{ kind: "runs_in_progress", runIds: running }]
    : [{ kind: "blocked", blockers: ["Stage2 has no schedulable action"] }];
}

export interface Stage2AdvanceResult {
  project: string;
  dispatchId: string;
  startedAt: string;
  completedAt: string;
  claimed: Array<{
    kind: "package_design" | "package_design_revision" | "active_implementation" | "verification" | "system_design";
    workPackageId?: string;
    slot?: Stage2AgentSlot;
  }>;
  results: Array<{
    kind: string;
    workPackageId?: string;
    status: "fulfilled" | "rejected";
    runId?: string;
    runtimeRef?: string;
    error?: string;
  }>;
}

export interface Stage2CancelResult {
  project: string;
  runId: string;
  runtimeRef: string;
  status: "cancelled";
  workPackageId?: string;
  slot?: Stage2AgentSlot;
}

export async function cancelStage2WorkspaceRun(
  projectPath: string,
  runtimeRefOrRunId: string,
  options: Stage2WorkspaceExecutionOptions = {},
): Promise<Stage2CancelResult> {
  const initial = await loadStage2Workspace(projectPath);
  const cancelled = await cancelDiscoveredStage2AgentRun(initial.root, runtimeRefOrRunId);
  return withStage2WorkspaceLock(initial.root, async () => {
    const loaded = await loadStage2Workspace(projectPath);
    const stage2 = loaded.state.stage2;
    const timestamp = now(options).toISOString();
    const session = stage2.runtimeRegistry[cancelled.runtimeRef] ?? {
      runtimeRef: cancelled.runtimeRef,
      provider: "codex-cli",
      phase: stage2TaskPhase(cancelled.task),
      status: "cancelled" as const,
      latestRunId: cancelled.runId,
      runCount: 1,
      cumulativePromptBytes: 0,
      createdAt: cancelled.startedAt ?? timestamp,
      updatedAt: timestamp,
    };
    session.status = "cancelled";
    session.latestRunId = cancelled.runId;
    session.updatedAt = timestamp;
    stage2.runtimeRegistry[cancelled.runtimeRef] = session;
    const run = stage2.runtimeRuns[cancelled.runId] ?? {
      runId: cancelled.runId,
      runtimeRef: cancelled.runtimeRef,
      task: cancelled.task,
      ...(cancelled.slot === undefined ? {} : { slot: cancelled.slot }),
      ...(cancelled.workPackageId === undefined
        ? {}
        : { workPackageId: cancelled.workPackageId }),
      status: "cancelled" as const,
      promptDigest: "runtime-file",
      inputArtifactHashes: {},
      outputArtifactHashes: {},
      toolPolicy: "read-only" as const,
      runtimePath: cancelled.runtimePath,
      ...(cancelled.startedAt === undefined ? {} : { startedAt: cancelled.startedAt }),
      ...(cancelled.lastEventAt === undefined ? {} : { lastEventAt: cancelled.lastEventAt }),
      ...(cancelled.deadlineAt === undefined ? {} : { deadlineAt: cancelled.deadlineAt }),
      ...(cancelled.noEventTimeoutMs === undefined
        ? {}
        : { noEventTimeoutMs: cancelled.noEventTimeoutMs }),
      eventCount: cancelled.eventCount,
      ...(cancelled.pid === undefined ? {} : { pid: cancelled.pid }),
    };
    setRunStatus(run, "cancelled", now(options), "Cancelled by Harness");
    stage2.runtimeRuns[cancelled.runId] = run;
    const assignment = cancelled.slot === undefined ? undefined : stage2.agents[cancelled.slot];
    if (
      assignment !== undefined
      && assignment.status === "working"
      && (
        assignment.runId === cancelled.runId
        || (
          assignment.workPackageId === cancelled.workPackageId
          && (assignment.runtimeRef === undefined || assignment.runtimeRef === cancelled.runtimeRef)
        )
      )
    ) {
      assignment.status = "assigned";
      delete assignment.runId;
      delete assignment.runtimeRef;
    }
    recordWorkspaceEvent(
      stage2,
      "RUNTIME_RUN_CANCELLED",
      cancelled.workPackageId,
      `run=${cancelled.runId}; runtime=${cancelled.runtimeRef}`,
      options,
    );
    await saveProjectState(loaded.root, loaded.state);
    return {
      project: loaded.state.project.name,
      runId: cancelled.runId,
      runtimeRef: cancelled.runtimeRef,
      status: "cancelled",
      ...(cancelled.workPackageId === undefined
        ? {}
        : { workPackageId: cancelled.workPackageId }),
      ...(cancelled.slot === undefined ? {} : { slot: cancelled.slot }),
    };
  });
}

export async function advanceStage2Workspace(
  projectPath: string,
  options: Stage2WorkspaceExecutionOptions = {},
): Promise<Stage2AdvanceResult> {
  const startedAt = now(options).toISOString();
  const dispatchId = `dispatch_${randomUUID()}`;
  const initial = await loadStage2Workspace(projectPath);
  const ready = getReadyWorkspaceActions(initial.state.stage2);
  const systemAction = ready.find((action) =>
    action.kind === "system_design_draft" || action.kind === "system_design_revision"
  );
  if (systemAction !== undefined) {
    const result = await runSystemDesignDraft(projectPath, undefined, options);
    return {
      project: result.loaded.state.project.name,
      dispatchId,
      startedAt,
      completedAt: now(options).toISOString(),
      claimed: [{ kind: "system_design", slot: systemAction.slot }],
      results: [{
        kind: systemAction.kind,
        status: "fulfilled",
        runId: result.runId,
        runtimeRef: result.runtimeRef,
      }],
    };
  }

  const designAction = ready.find((action) =>
    action.kind === "package_design" || action.kind === "package_design_revision"
  );
  const implementationAction = ready.find((action) => action.kind === "active_implementation");
  const verificationAction = designAction === undefined && implementationAction === undefined
    ? ready.find((action) => action.kind === "verification")
    : undefined;
  const packageActions = [designAction, implementationAction].filter((action) =>
    action !== undefined
  ) as Array<Extract<Stage2WorkspaceNextAction,
    { kind: "package_design" | "package_design_revision" | "active_implementation" }>>;

  if (packageActions.length === 2) {
    const current = initial.state.stage2;
    assertAllowedPathsDisjoint(
      current.agents[packageActions[0]!.slot],
      current.agents[packageActions[1]!.slot],
    );
  }
  if (packageActions.length === 0 && verificationAction === undefined) {
    throw new Error(`Stage2 advance requires a machine action; current action is ${ready[0]?.kind ?? "none"}`);
  }

  if (packageActions.length > 0) {
    await withStage2WorkspaceLock(initial.root, async () => {
      const claimed = await loadStage2Workspace(projectPath);
      for (const action of packageActions) {
        const assignment = claimed.state.stage2.agents[action.slot];
        if (
          assignment.workPackageId !== action.workPackageId
          || assignment.status === "working"
        ) {
          throw new Error(`Stage2 action changed before claim: ${action.kind}/${action.workPackageId}`);
        }
        assignment.status = "working";
        assignment.runId = `${dispatchId}_${action.slot}`;
      }
      recordWorkspaceEvent(
        claimed.state.stage2,
        "STAGE2_ADVANCE_CLAIMED",
        undefined,
        packageActions.map((action) => `${action.kind}:${action.workPackageId}:${action.slot}`).join(","),
        options,
      );
      await saveProjectState(claimed.root, claimed.state);
    });
  }

  const executions: Array<{
    action: Stage2WorkspaceNextAction;
    promise: Promise<Stage2WorkspaceRunResult<unknown> | LoadedStage2Workspace>;
  }> = packageActions.map((action) => ({
    action,
    promise: action.kind === "active_implementation"
      ? runPackageImplementation(projectPath, action.workPackageId, options)
      : runPackageDesign(projectPath, action.workPackageId, undefined, options),
  }));
  if (verificationAction !== undefined) {
    executions.push({
      action: verificationAction,
      promise: runPackageVerification(projectPath, verificationAction.workPackageId, options),
    });
  }
  const settled = await Promise.allSettled(executions.map((item) => item.promise));
  const results: Stage2AdvanceResult["results"] = [];
  for (let index = 0; index < settled.length; index += 1) {
    const action = executions[index]!.action;
    const result = settled[index]!;
    if (result.status === "fulfilled") {
      const value = result.value;
      results.push({
        kind: action.kind,
        ...(action.kind === "verification" ? { workPackageId: action.workPackageId } : {}),
        ...(action.kind === "package_design"
          || action.kind === "package_design_revision"
          || action.kind === "active_implementation"
          ? { workPackageId: action.workPackageId }
          : {}),
        status: "fulfilled",
        ...("runId" in value ? { runId: value.runId, runtimeRef: value.runtimeRef } : {}),
      });
      continue;
    }
    const message = result.reason instanceof Error ? result.reason.message : String(result.reason);
    results.push({
      kind: action.kind,
      ...(action.kind === "verification" ? { workPackageId: action.workPackageId } : {}),
      ...(action.kind === "package_design"
        || action.kind === "package_design_revision"
        || action.kind === "active_implementation"
        ? { workPackageId: action.workPackageId }
        : {}),
      status: "rejected",
      error: message,
    });
    if (
      action.kind === "package_design"
      || action.kind === "package_design_revision"
      || action.kind === "active_implementation"
    ) {
      await releaseFailedAdvanceClaim(initial.root, action.slot, dispatchId, message, options);
    }
  }
  const final = await loadStage2Workspace(projectPath);
  return {
    project: final.state.project.name,
    dispatchId,
    startedAt,
    completedAt: now(options).toISOString(),
    claimed: [
      ...packageActions.map((action) => ({
        kind: action.kind,
        workPackageId: action.workPackageId,
        slot: action.slot,
      })),
      ...(verificationAction === undefined
        ? []
        : [{ kind: "verification" as const, workPackageId: verificationAction.workPackageId }]),
    ],
    results,
  };
}

async function releaseFailedAdvanceClaim(
  projectPath: string,
  slot: Stage2AgentSlot,
  dispatchId: string,
  error: string,
  options: Stage2WorkspaceExecutionOptions,
): Promise<void> {
  await withStage2WorkspaceLock(projectPath, async () => {
    const loaded = await loadStage2Workspace(projectPath);
    const assignment = loaded.state.stage2.agents[slot];
    if (assignment.runId !== `${dispatchId}_${slot}` || assignment.status !== "working") {
      return;
    }
    assignment.status = "assigned";
    delete assignment.runId;
    recordWorkspaceEvent(
      loaded.state.stage2,
      "STAGE2_ADVANCE_RUN_FAILED",
      assignment.workPackageId,
      error,
      options,
    );
    await saveProjectState(loaded.root, loaded.state);
  });
}

export async function runPackageDesign(
  projectPath: string,
  workPackageId?: string,
  instruction?: string,
  options: Stage2WorkspaceExecutionOptions = {},
): Promise<Stage2WorkspaceRunResult<Stage2PackageDesignProposal>> {
  const loaded = await loadStage2Workspace(projectPath);
  await assertSystemDesignAuthorityCurrent(loaded.root, loaded.state, loaded.state.stage2);
  const assignment = findWorkspaceAssignment(loaded.state.stage2, "shadow", workPackageId);
  if (assignment.workPackageId === undefined) {
    throw new Error(`Shadow slot ${assignment.slot} has no Work Package`);
  }
  const workPackage = requireWorkPackage(loaded.state.stage2, assignment.workPackageId);
  if (workPackage.status !== "DESIGNING" && workPackage.status !== "AWAITING_APPROVAL") {
    throw new Error(`Work Package ${workPackage.id} cannot run Design from ${workPackage.status}`);
  }
  if (!isPackageDesignable(loaded.state.stage2, workPackage)) {
    throw new Error(`Work Package ${workPackage.id} has unapproved upstream Designs`);
  }
  if (workPackage.status === "AWAITING_APPROVAL" && workPackage.design !== undefined) {
    const openDecision = workPackage.decisionOrder.find((id) =>
      workPackage.decisions[id]?.status === "open"
    );
    if (openDecision !== undefined) {
      throw new Error(`Work Package ${workPackage.id} is waiting for DecisionRequest ${openDecision}`);
    }
    const issues = packageDesignRevisionIssues(workPackage);
    const localIssues = issues.filter((issue) => issue.repairClass === "local_patch");
    const fullRedraft = issues.some((issue) => issue.repairClass === "full_redraft");
    if (localIssues.length > 0 && !fullRedraft) {
      return runPackageDesignPatch(
        loaded,
        assignment,
        workPackage,
        localIssues,
        instruction,
        options,
      );
    }
    if (fullRedraft && (instruction?.trim() ?? "") === "") {
      throw new Error(
        `Work Package ${workPackage.id} requires an explicit full-redraft instruction`,
      );
    }
  }
  let snapshot = snapshotWorkspaceAssignment(loaded.state.stage2, assignment);
  const working = structuredClone(loaded.state.stage2);
  const workingAssignment = working.agents[assignment.slot];
  const workingPackage = requireWorkPackage(working, workPackage.id);
  const runtime = createAgentRuntime(working.runtimeRegistry, working.runtimeRuns, options);
  const skillBundles = await loadStage2TaskSkills("package_design");
  const skills = skillReferences(skillBundles);
  const envelope = await buildWorkspaceEnvelope(
    loaded,
    working,
    "package_design",
    assignment.slot,
    skills,
    workPackage.id,
  );
  const runtimeRoot = await createStage2RunDirectory(loaded.root, workPackage.id, "package_design");
  await writeTaskEnvelope(runtimeRoot, envelope);
  const request = {
    task: "package_design" as const,
    projectRoot: loaded.root,
    runtimeRoot,
    prompt: buildPackageDesignPrompt(
      envelope,
      instruction,
      renderSkillContext(skillBundles),
    ),
    schema: packageDesignSchema(workPackage.id),
    readManifest: envelope.readManifest,
    persistent: true,
    sandbox: "read-only" as const,
    inputArtifactHashes: inputHashes(loaded.state, working),
    slot: assignment.slot,
    workPackageId: workPackage.id,
  };
  workingAssignment.status = "working";
  const handle = workingAssignment.runtimeRef === undefined
    ? await runtime.start(request)
    : await runtime.resume(workingAssignment.runtimeRef, request);
  workingAssignment.runtimeRef = handle.runtimeRef;
  workingAssignment.runId = handle.runId;
  snapshot = await persistWorkspaceRunDispatch(
    loaded.root,
    snapshot,
    working,
    handle,
    options,
  );
  let run: AgentRun;
  try {
    run = await handle.completion;
  } catch (error) {
    await persistWorkspaceRunFailure(loaded.root, snapshot, working, error, options);
    throw error;
  }
  await writeAgentRun(runtimeRoot, run);
  let proposal: Stage2PackageDesignProposal;
  try {
    const systemProposal = requireSystemDesignProposal(working);
    const canonical = canonicalizePackageDesignProposal(
      run.output,
      systemProposal.workPackages.map((item) => item.id),
    );
    if (canonical.changes.length > 0) {
      await atomicWriteText(
        resolveWithin(runtimeRoot, "canonicalization.json"),
        `${JSON.stringify(canonical.changes, null, 2)}\n`,
      );
    }
    proposal = validatePackageDesignProposal(canonical.value, workingPackage, systemProposal);
    await assertProjectReferencesExist(loaded.root, [
      ...proposal.architectureReferences,
      ...proposal.sourceReferences,
    ]);
  } catch (error) {
    setRunStatus(working.runtimeRuns[run.runId]!, "validation_failed", now(options), errorMessage(error));
    await persistWorkspaceRunFailure(loaded.root, snapshot, working, error, options);
    throw error;
  }
  setRunStatus(working.runtimeRuns[run.runId]!, "applied", now(options));

  return withStage2WorkspaceLock(loaded.root, async () => {
  const current = await loadStage2Workspace(projectPath);
  const currentAssignment = assertWorkspaceAssignmentStillCurrent(current.state.stage2, snapshot);
  mergeRuntimeRegistry(current.state.stage2.runtimeRegistry, working.runtimeRegistry);
  mergeRuntimeRuns(current.state.stage2.runtimeRuns, working.runtimeRuns);
  const currentPackage = requireWorkPackage(current.state.stage2, workPackage.id);
  const decisions = mergeDecisionRequests(currentPackage.decisions, proposal.decisionRequests);
  currentPackage.decisionOrder = decisions.order;
  currentPackage.decisions = decisions.decisions;
  const revision = (currentPackage.design?.revision ?? 0) + 1;
  currentPackage.design = {
    revision,
    draftedAt: now(options).toISOString(),
    path: currentPackage.plan.designPath,
    documentSha256: "",
    runtimeRef: run.runtimeRef,
    runId: run.runId,
    skills,
    proposal,
  };
  currentPackage.status = "AWAITING_APPROVAL";
  currentPackage.blockers = packageDesignIssues(currentPackage);
  currentAssignment.runtimeRef = run.runtimeRef;
  currentAssignment.status = "waiting";
  delete currentAssignment.runId;
  const content = renderPackageDesignDocument(
    currentPackage,
    proposal,
    revision,
    currentPackage.blockers.length === 0 ? "待确认" : "需修订",
    skills,
  );
  currentPackage.design.documentSha256 = sha256(content);
  recordWorkspaceEvent(
    current.state.stage2,
    "PACKAGE_DESIGN_DRAFTED",
    currentPackage.id,
    `revision=${String(revision)}; runtime=${run.runtimeRef}`,
    options,
  );
  await atomicWriteText(resolveWithin(current.root, currentPackage.design.path), content);
  await saveProjectState(current.root, current.state);
  return {
    loaded: current,
    output: proposal,
    runId: run.runId,
    runtimeRef: run.runtimeRef,
  };
  });
}

async function runPackageDesignPatch(
  loaded: LoadedStage2Workspace,
  assignment: Stage2WorkspaceAgentAssignment,
  workPackage: Stage2WorkPackageStateV4,
  issues: ReturnType<typeof packageDesignRevisionIssues>,
  instruction: string | undefined,
  options: Stage2WorkspaceExecutionOptions,
): Promise<Stage2WorkspaceRunResult<Stage2PackageDesignProposal>> {
  const design = requirePackageDesign(workPackage);
  const baseHash = proposalHash(design.proposal);
  const allowedTargets = [...new Set(issues.map((issue) => issue.target))];
  let snapshot = snapshotWorkspaceAssignment(loaded.state.stage2, assignment);
  const working = structuredClone(loaded.state.stage2);
  const workingAssignment = working.agents[assignment.slot];
  const runtime = createAgentRuntime(working.runtimeRegistry, working.runtimeRuns, options);
  const skillBundles = await loadStage2TaskSkills("package_design_patch");
  const skills = skillReferences(skillBundles);
  const envelope = await buildWorkspaceEnvelope(
    loaded,
    working,
    "package_design_patch",
    assignment.slot,
    skills,
    workPackage.id,
  );
  const runtimeRoot = await createStage2RunDirectory(
    loaded.root,
    workPackage.id,
    "package_design_patch",
  );
  await Promise.all([
    writeTaskEnvelope(runtimeRoot, envelope),
    atomicWriteText(
      resolveWithin(runtimeRoot, "revision-issues.json"),
      `${JSON.stringify(issues, null, 2)}\n`,
    ),
  ]);
  const request = {
    task: "package_design_patch" as const,
    projectRoot: loaded.root,
    runtimeRoot,
    prompt: buildPackageDesignPatchPrompt(
      envelope,
      design.proposal,
      issues,
      baseHash,
      instruction,
      renderSkillContext(skillBundles),
    ),
    schema: packageDesignPatchSchema(baseHash, allowedTargets),
    readManifest: envelope.readManifest,
    persistent: true,
    sandbox: "read-only" as const,
    inputArtifactHashes: {
      ...inputHashes(loaded.state, working),
      baseProposal: baseHash,
    },
    slot: assignment.slot,
    workPackageId: workPackage.id,
  };
  workingAssignment.status = "working";
  const handle = workingAssignment.runtimeRef === undefined
    ? await runtime.start(request)
    : await runtime.resume(workingAssignment.runtimeRef, request);
  workingAssignment.runtimeRef = handle.runtimeRef;
  workingAssignment.runId = handle.runId;
  snapshot = await persistWorkspaceRunDispatch(
    loaded.root,
    snapshot,
    working,
    handle,
    options,
  );
  let run: AgentRun;
  try {
    run = await handle.completion;
  } catch (error) {
    await persistWorkspaceRunFailure(loaded.root, snapshot, working, error, options);
    throw error;
  }
  await writeAgentRun(runtimeRoot, run);
  let patch: Stage2DesignPatch;
  let proposal: Stage2PackageDesignProposal;
  try {
    patch = validateDesignPatch(run.output, baseHash, allowedTargets);
    await atomicWriteText(
      resolveWithin(runtimeRoot, "design-patch.json"),
      `${JSON.stringify(patch, null, 2)}\n`,
    );
    const patched = applyDesignPatch(design.proposal, patch);
    const systemProposal = requireSystemDesignProposal(working);
    proposal = validatePackageDesignProposal(
      patched,
      requireWorkPackage(working, workPackage.id),
      systemProposal,
    );
    await assertProjectReferencesExist(loaded.root, [
      ...proposal.architectureReferences,
      ...proposal.sourceReferences,
    ]);
  } catch (error) {
    setRunStatus(working.runtimeRuns[run.runId]!, "validation_failed", now(options), errorMessage(error));
    await persistWorkspaceRunFailure(loaded.root, snapshot, working, error, options);
    throw error;
  }
  setRunStatus(working.runtimeRuns[run.runId]!, "applied", now(options));

  return withStage2WorkspaceLock(loaded.root, async () => {
  const current = await loadStage2Workspace(loaded.root);
  const currentAssignment = assertWorkspaceAssignmentStillCurrent(current.state.stage2, snapshot);
  const currentPackage = requireWorkPackage(current.state.stage2, workPackage.id);
  const currentDesign = requirePackageDesign(currentPackage);
  if (proposalHash(currentDesign.proposal) !== baseHash) {
    throw new Error(`Design Patch base drifted for Work Package ${workPackage.id}`);
  }
  mergeRuntimeRegistry(current.state.stage2.runtimeRegistry, working.runtimeRegistry);
  mergeRuntimeRuns(current.state.stage2.runtimeRuns, working.runtimeRuns);
  const decisions = mergeDecisionRequests(currentPackage.decisions, proposal.decisionRequests);
  currentPackage.decisionOrder = decisions.order;
  currentPackage.decisions = decisions.decisions;
  const revision = currentDesign.revision + 1;
  currentPackage.design = {
    revision,
    draftedAt: now(options).toISOString(),
    path: currentPackage.plan.designPath,
    documentSha256: "",
    runtimeRef: run.runtimeRef,
    runId: run.runId,
    skills,
    proposal,
  };
  currentPackage.status = "AWAITING_APPROVAL";
  currentPackage.blockers = packageDesignIssues(currentPackage);
  currentAssignment.runtimeRef = run.runtimeRef;
  currentAssignment.status = "waiting";
  delete currentAssignment.runId;
  const content = renderPackageDesignDocument(
    currentPackage,
    proposal,
    revision,
    currentPackage.blockers.length === 0 ? "待确认" : "需修订",
    skills,
  );
  currentPackage.design.documentSha256 = sha256(content);
  recordWorkspaceEvent(
    current.state.stage2,
    "PACKAGE_DESIGN_PATCH_APPLIED",
    currentPackage.id,
    `revision=${String(revision)}; run=${run.runId}; operations=${String(patch.operations.length)}`,
    options,
  );
  await atomicWriteText(resolveWithin(current.root, currentPackage.design.path), content);
  await saveProjectState(current.root, current.state);
  return {
    loaded: current,
    output: proposal,
    runId: run.runId,
    runtimeRef: run.runtimeRef,
  };
  });
}

export async function approvePackageDesign(
  projectPath: string,
  workPackageId: string,
  options: Stage2WorkspaceExecutionOptions = {},
): Promise<LoadedStage2Workspace> {
  const loaded = await loadStage2Workspace(projectPath);
  await assertSystemDesignAuthorityCurrent(loaded.root, loaded.state, loaded.state.stage2);
  const workPackage = requireWorkPackage(loaded.state.stage2, workPackageId);
  const design = requirePackageDesign(workPackage);
  if (workPackage.status !== "AWAITING_APPROVAL" || design.approval !== undefined) {
    throw new Error(`Work Package ${workPackageId} is not awaiting Design approval`);
  }
  await assertPackageDesignCurrent(loaded.root, workPackage);
  const issues = packageDesignIssues(workPackage);
  if (issues.length > 0) {
    throw new Error(`Work Package ${workPackageId} Design is not closed: ${issues.join("; ")}`);
  }
  const systemApproval = loaded.state.stage2.systemDesign.approval!;
  const content = renderPackageDesignDocument(
    workPackage,
    design.proposal,
    design.revision,
    "已批准",
    design.skills,
  );
  design.documentSha256 = sha256(content);
  design.approval = {
    approvedAt: now(options).toISOString(),
    designRevision: design.revision,
    designSha256: design.documentSha256,
    systemDesignSha256: systemApproval.documentSha256,
    interfaceSha256: systemApproval.interfaceSha256,
    architectureHashes: { ...systemApproval.architectureHashes },
  };
  workPackage.status = "READY";
  workPackage.blockers = [];
  promoteReadyShadow(loaded.state.stage2);
  assignNextShadow(loaded.state.stage2);
  recordWorkspaceEvent(
    loaded.state.stage2,
    "PACKAGE_DESIGN_APPROVED",
    workPackage.id,
    undefined,
    options,
  );
  await atomicWriteText(resolveWithin(loaded.root, design.path), content);
  await saveProjectState(loaded.root, loaded.state);
  return loaded;
}

export async function runPackageImplementation(
  projectPath: string,
  workPackageId?: string,
  options: Stage2WorkspaceExecutionOptions = {},
): Promise<Stage2WorkspaceRunResult<Stage2PackageImplementationProposal>> {
  const loaded = await loadStage2Workspace(projectPath);
  await assertSystemDesignAuthorityCurrent(loaded.root, loaded.state, loaded.state.stage2);
  const assignment = findWorkspaceAssignment(loaded.state.stage2, "active", workPackageId);
  if (assignment.workPackageId === undefined) {
    throw new Error(`Active slot ${assignment.slot} has no Work Package`);
  }
  const workPackage = requireWorkPackage(loaded.state.stage2, assignment.workPackageId);
  if (workPackage.status !== "IMPLEMENTING") {
    throw new Error(`Work Package ${workPackage.id} cannot implement from ${workPackage.status}`);
  }
  if (!areImplementationDependenciesComplete(loaded.state.stage2, workPackage)) {
    throw new Error(`Work Package ${workPackage.id} has incomplete implementation dependencies`);
  }
  await assertPackageDesignCurrent(loaded.root, workPackage);
  const design = requirePackageDesign(workPackage);
  const designApproval = requirePackageDesignApproval(workPackage);
  let snapshot = snapshotWorkspaceAssignment(loaded.state.stage2, assignment);
  const working = structuredClone(loaded.state.stage2);
  const workingAssignment = working.agents[assignment.slot];
  const runtime = createAgentRuntime(working.runtimeRegistry, working.runtimeRuns, options);
  const skillBundles = await loadStage2TaskSkills("package_implementation");
  const skills = skillReferences(skillBundles);
  const envelope = await buildWorkspaceEnvelope(
    loaded,
    working,
    "package_implementation",
    assignment.slot,
    skills,
    workPackage.id,
  );
  const runtimeRoot = await createStage2RunDirectory(
    loaded.root,
    workPackage.id,
    "package_implementation",
  );
  await writeTaskEnvelope(runtimeRoot, envelope);
  const request = {
    task: "package_implementation" as const,
    projectRoot: loaded.root,
    runtimeRoot,
    prompt: buildPackageImplementationPrompt(
      envelope,
      design.proposal,
      renderSkillContext(skillBundles),
    ),
    schema: packageImplementationSchema(workPackage.id, designApproval.designSha256),
    readManifest: envelope.readManifest,
    persistent: true,
    sandbox: "read-only" as const,
    inputArtifactHashes: inputHashes(loaded.state, working),
    slot: assignment.slot,
    workPackageId: workPackage.id,
  };
  workingAssignment.status = "working";
  const handle = workingAssignment.runtimeRef === undefined
    ? await runtime.start(request)
    : await runtime.resume(workingAssignment.runtimeRef, request);
  workingAssignment.runtimeRef = handle.runtimeRef;
  workingAssignment.runId = handle.runId;
  snapshot = await persistWorkspaceRunDispatch(
    loaded.root,
    snapshot,
    working,
    handle,
    options,
  );
  let run: AgentRun;
  try {
    run = await handle.completion;
  } catch (error) {
    await persistWorkspaceRunFailure(loaded.root, snapshot, working, error, options);
    throw error;
  }
  await writeAgentRun(runtimeRoot, run);
  let proposal: Stage2PackageImplementationProposal;
  try {
    proposal = validatePackageImplementationProposal(
      run.output,
      workPackage,
      designApproval.designSha256,
    );
  } catch (error) {
    setRunStatus(working.runtimeRuns[run.runId]!, "validation_failed", now(options), errorMessage(error));
    await persistWorkspaceRunFailure(loaded.root, snapshot, working, error, options);
    throw error;
  }
  setRunStatus(working.runtimeRuns[run.runId]!, "applied", now(options));

  const appliedSnapshot = await withStage2WorkspaceLock(loaded.root, async () => {
    const current = await loadStage2Workspace(projectPath);
    const currentAssignment = assertWorkspaceAssignmentStillCurrent(
      current.state.stage2,
      snapshot,
    );
    mergeRuntimeRegistry(current.state.stage2.runtimeRegistry, working.runtimeRegistry);
    mergeRuntimeRuns(current.state.stage2.runtimeRuns, working.runtimeRuns);
    const currentPackage = requireWorkPackage(current.state.stage2, workPackage.id);
    await assertSystemDesignAuthorityCurrent(current.root, current.state, current.state.stage2);
    await assertPackageDesignCurrent(current.root, currentPackage);
    currentAssignment.runtimeRef = run.runtimeRef;
    if (proposal.designGap !== null) {
      delete currentAssignment.runId;
      reopenPackageInState(
        current.state.stage2,
        currentPackage,
        `${proposal.designGap.reason}; counterexample: ${proposal.designGap.counterexample}`,
        options,
      );
      releaseWorkspaceAssignment(currentAssignment);
      const reopenedDesign = requirePackageDesign(currentPackage);
      const content = renderPackageDesignDocument(
        currentPackage,
        reopenedDesign.proposal,
        reopenedDesign.revision,
        "需修订",
        reopenedDesign.skills,
      );
      reopenedDesign.documentSha256 = sha256(content);
      recordWorkspaceEvent(
        current.state.stage2,
        "PACKAGE_DESIGN_GAP_REOPENED",
        currentPackage.id,
        proposal.designGap.reason,
        options,
      );
      await atomicWriteText(resolveWithin(current.root, reopenedDesign.path), content);
      await saveProjectState(current.root, current.state);
      return undefined;
    }

    const applied = await applyPackageImplementation(current.root, currentPackage, proposal);
    currentPackage.implementation = {
      appliedAt: now(options).toISOString(),
      designSha256: designApproval.designSha256,
      aggregateSha256: applied.aggregateSha256,
      fileHashes: applied.fileHashes,
      changedPaths: applied.changedPaths,
      summary: proposal.summary,
      runtimeRef: run.runtimeRef,
      runId: run.runId,
      skills,
    };
    currentPackage.blockers = ["Primary verification is running"];
    recordWorkspaceEvent(
      current.state.stage2,
      "PACKAGE_IMPLEMENTATION_APPLIED",
      currentPackage.id,
      `run=${run.runId}; files=${String(applied.changedPaths.length)}`,
      options,
    );
    await saveProjectState(current.root, current.state);
    return snapshotWorkspaceAssignment(current.state.stage2, currentAssignment);
  });
  if (appliedSnapshot === undefined) {
    return {
      loaded: await loadStage2Workspace(projectPath),
      output: proposal,
      runId: run.runId,
      runtimeRef: run.runtimeRef,
    };
  }

  const commandRunner = options.commandRunner ?? runCommands;
  let primaryCommands: CommandResult[];
  try {
    primaryCommands = await commandRunner(design.proposal.acceptance.commands, loaded.root);
  } catch (error) {
    await withStage2WorkspaceLock(loaded.root, async () => {
      const current = await loadStage2Workspace(projectPath);
      const currentAssignment = assertWorkspaceAssignmentStillCurrent(
        current.state.stage2,
        appliedSnapshot,
      );
      const currentPackage = requireWorkPackage(current.state.stage2, workPackage.id);
      currentPackage.status = "IMPLEMENTING";
      currentPackage.blockers = [`Primary verification runner failed: ${errorMessage(error)}`];
      currentAssignment.status = "blocked";
      delete currentAssignment.runId;
      recordWorkspaceEvent(
        current.state.stage2,
        "PACKAGE_PRIMARY_RUNNER_FAILED",
        currentPackage.id,
        errorMessage(error),
        options,
      );
      await saveProjectState(current.root, current.state);
    });
    throw error;
  }
  const failures = requiredCommandFailures(primaryCommands);
  return withStage2WorkspaceLock(loaded.root, async () => {
    const current = await loadStage2Workspace(projectPath);
    const currentAssignment = assertWorkspaceAssignmentStillCurrent(
      current.state.stage2,
      appliedSnapshot,
    );
    const currentPackage = requireWorkPackage(current.state.stage2, workPackage.id);
    await assertSystemDesignAuthorityCurrent(current.root, current.state, current.state.stage2);
    await assertPackageDesignCurrent(current.root, currentPackage);
    await assertPackageImplementationCurrent(current.root, currentPackage);
    delete currentAssignment.runId;
    currentPackage.verification = {
      primaryRanAt: now(options).toISOString(),
      primaryCommands,
      documentPath: `verification/${currentPackage.id}.md`,
    };
    if (failures.length > 0) {
      currentPackage.status = "IMPLEMENTING";
      currentPackage.blockers = failures;
      currentAssignment.status = "blocked";
    } else {
      currentPackage.status = "VERIFYING";
      currentPackage.blockers = [];
      currentAssignment.status = "waiting";
      scheduleAfterActiveVerification(current.state.stage2, currentAssignment);
    }
    recordWorkspaceEvent(
      current.state.stage2,
      failures.length === 0 ? "PACKAGE_PRIMARY_VERIFIED" : "PACKAGE_PRIMARY_VERIFICATION_FAILED",
      currentPackage.id,
      failures.join("; ") || undefined,
      options,
    );
    await syncPackageVerificationDocument(current.root, currentPackage);
    await saveProjectState(current.root, current.state);
    return {
      loaded: current,
      output: proposal,
      runId: run.runId,
      runtimeRef: run.runtimeRef,
    };
  });
}

export async function runPackageVerification(
  projectPath: string,
  workPackageId: string,
  options: Stage2WorkspaceExecutionOptions = {},
): Promise<LoadedStage2Workspace> {
  let loaded = await loadStage2Workspace(projectPath);
  await assertSystemDesignAuthorityCurrent(loaded.root, loaded.state, loaded.state.stage2);
  let workPackage = requireWorkPackage(loaded.state.stage2, workPackageId);
  if (hasRetryableVerificationInfrastructureBlocker(workPackage)) {
    loaded = await withStage2WorkspaceLock(loaded.root, async () => {
      const current = await loadStage2Workspace(projectPath);
      const currentPackage = requireWorkPackage(current.state.stage2, workPackageId);
      if (!hasRetryableVerificationInfrastructureBlocker(currentPackage)) {
        throw new Error(`Work Package ${workPackageId} verification retry state changed`);
      }
      const previousBlockers = [...currentPackage.blockers];
      currentPackage.status = "VERIFYING";
      currentPackage.blockers = [];
      recordWorkspaceEvent(
        current.state.stage2,
        "PACKAGE_VERIFICATION_ENVIRONMENT_RETRY",
        currentPackage.id,
        previousBlockers.join("; "),
        options,
      );
      await syncPackageVerificationDocument(current.root, currentPackage);
      await saveProjectState(current.root, current.state);
      return current;
    });
    workPackage = requireWorkPackage(loaded.state.stage2, workPackageId);
  }
  if (workPackage.status !== "VERIFYING") {
    throw new Error(`Work Package ${workPackage.id} cannot verify from ${workPackage.status}`);
  }
  if (!areIntegrationDependenciesComplete(loaded.state.stage2, workPackage)) {
    throw new Error(`Work Package ${workPackage.id} has incomplete integration dependencies`);
  }
  const design = requirePackageDesign(workPackage);
  const designApproval = requirePackageDesignApproval(workPackage);
  const implementation = requirePackageImplementation(workPackage);
  await assertPackageDesignCurrent(loaded.root, workPackage);
  await assertPackageImplementationCurrent(loaded.root, workPackage);
  const verificationAuthority = {
    stateEpoch: loaded.state.stage2.stateEpoch,
    packageRevision: workPackage.revision,
    systemDesignSha256: loaded.state.stage2.systemDesign.approval!.documentSha256,
    interfaceSha256: loaded.state.stage2.systemDesign.approval!.interfaceSha256,
    designSha256: designApproval.designSha256,
    implementationSha256: implementation.aggregateSha256,
  };
  const commandRunner = options.commandRunner ?? runCommands;
  const finalCommands = await commandRunner(design.proposal.acceptance.commands, loaded.root);
  const commandFailures = requiredCommandFailures(finalCommands);
  if (commandFailures.length > 0) {
    workPackage.status = "BLOCKED";
    workPackage.blockers = commandFailures;
    workPackage.verification!.finalCommands = finalCommands;
    assignBlockedImplementationRepair(loaded.state.stage2, workPackage.id);
    recordWorkspaceEvent(
      loaded.state.stage2,
      "PACKAGE_FINAL_COMMANDS_FAILED",
      workPackage.id,
      commandFailures.join("; "),
      options,
    );
    await syncPackageVerificationDocument(loaded.root, workPackage);
    await saveProjectState(loaded.root, loaded.state);
    return loaded;
  }

  const working = structuredClone(loaded.state.stage2);
  const runtime = createAgentRuntime(working.runtimeRegistry, working.runtimeRuns, options);
  const [staticSkillsBundle, verificationSkillsBundle] = await Promise.all([
    loadStage2TaskSkills("package_static_review"),
    loadStage2TaskSkills("package_verification"),
  ]);
  const staticSkills = skillReferences(staticSkillsBundle);
  const verificationSkills = skillReferences(verificationSkillsBundle);
  const slot = runtimeSlotForPackage(working, workPackage.id);
  const staticEnvelope = await buildWorkspaceEnvelope(
    loaded,
    working,
    "package_static_review",
    slot,
    staticSkills,
    workPackage.id,
  );
  const verificationEnvelope = await buildWorkspaceEnvelope(
    loaded,
    working,
    "package_verification",
    slot,
    verificationSkills,
    workPackage.id,
  );
  const staticRuntimeRoot = await createStage2RunDirectory(
    loaded.root,
    workPackage.id,
    "package_static_review",
  );
  const verificationRuntimeRoot = await createStage2RunDirectory(
    loaded.root,
    workPackage.id,
    "package_verification",
  );
  const [staticWorkspace, verificationWorkspace] = await Promise.all([
    createVerificationWorkspace(loaded.root, staticRuntimeRoot),
    createVerificationWorkspace(loaded.root, verificationRuntimeRoot),
  ]);
  const [staticSnapshot, verificationSnapshot] = await Promise.all([
    snapshotVerificationInputs(staticWorkspace),
    snapshotVerificationInputs(verificationWorkspace),
  ]);
  await Promise.all([
    writeTaskEnvelope(staticRuntimeRoot, staticEnvelope),
    writeTaskEnvelope(verificationRuntimeRoot, verificationEnvelope),
  ]);
  const staticRequest = {
    task: "package_static_review" as const,
    projectRoot: staticWorkspace,
    runtimeRoot: staticRuntimeRoot,
    prompt: buildPackageStaticReviewPrompt(
      staticEnvelope,
      design.proposal,
      implementation.aggregateSha256,
      renderSkillContext(staticSkillsBundle),
    ),
    schema: packageReviewSchema(
      workPackage.id,
      designApproval.designSha256,
      implementation.aggregateSha256,
      "static",
    ),
    readManifest: staticEnvelope.readManifest,
    persistent: false,
    sandbox: "read-only" as const,
    inputArtifactHashes: inputHashes(loaded.state, working),
    workPackageId: workPackage.id,
  };
  const staticHandle = await runtime.start(staticRequest);
  let independentCommands: CommandResult[];
  try {
    independentCommands = await commandRunner(
      design.proposal.acceptance.commands,
      verificationWorkspace,
    );
  } catch (error) {
    await runtime.cancel(staticHandle.runId).catch(() => undefined);
    await staticHandle.completion.catch(() => undefined);
    throw error;
  }
  const verificationRequest = {
    task: "package_verification" as const,
    projectRoot: verificationWorkspace,
    runtimeRoot: verificationRuntimeRoot,
    prompt: buildPackageVerificationPrompt(
      verificationEnvelope,
      design.proposal,
      verificationWorkspace,
      independentCommands,
      renderSkillContext(verificationSkillsBundle),
    ),
    schema: packageReviewSchema(
      workPackage.id,
      designApproval.designSha256,
      implementation.aggregateSha256,
      "verification",
    ),
    readManifest: verificationEnvelope.readManifest,
    persistent: false,
    sandbox: "read-only" as const,
    inputArtifactHashes: inputHashes(loaded.state, working),
    workPackageId: workPackage.id,
  };
  const verificationHandle = await runtime.start(verificationRequest);
  const [staticRun, verificationRun] = await Promise.all([
    staticHandle.completion,
    verificationHandle.completion,
  ]);
  await Promise.all([
    writeAgentRun(staticRuntimeRoot, staticRun),
    writeAgentRun(verificationRuntimeRoot, verificationRun),
    assertVerificationInputsUnchanged(staticWorkspace, staticSnapshot),
    assertVerificationInputsUnchanged(verificationWorkspace, verificationSnapshot),
  ]);
  const staticReport = validatePackageReviewReport(
    staticRun.output,
    workPackage.id,
    "static",
    designApproval.designSha256,
    implementation.aggregateSha256,
  );
  const verificationReport = validatePackageReviewReport(
    verificationRun.output,
    workPackage.id,
    "verification",
    designApproval.designSha256,
    implementation.aggregateSha256,
  );
  setRunStatus(working.runtimeRuns[staticRun.runId]!, "applied", now(options));
  setRunStatus(working.runtimeRuns[verificationRun.runId]!, "applied", now(options));
  assertIndependentCommandEvidence(design.proposal.acceptance.commands, verificationReport.commandResults);
  const trustedVerificationReport = {
    ...verificationReport,
    commandResults: structuredClone(independentCommands),
  };

  return withStage2WorkspaceLock(loaded.root, async () => {
  const current = await loadStage2Workspace(projectPath);
  const currentPackage = requireWorkPackage(current.state.stage2, workPackage.id);
  const currentSystemApproval = current.state.stage2.systemDesign.approval;
  if (
    current.state.stage2.stateEpoch !== verificationAuthority.stateEpoch
    || currentPackage.revision !== verificationAuthority.packageRevision
    || currentPackage.status !== "VERIFYING"
    || currentSystemApproval?.documentSha256 !== verificationAuthority.systemDesignSha256
    || currentSystemApproval.interfaceSha256 !== verificationAuthority.interfaceSha256
    || currentPackage.design?.approval?.designSha256 !== verificationAuthority.designSha256
    || currentPackage.implementation?.aggregateSha256 !== verificationAuthority.implementationSha256
  ) {
    throw new Error(`Stale verification result for Work Package ${workPackage.id}`);
  }
  mergeRuntimeRegistry(current.state.stage2.runtimeRegistry, working.runtimeRegistry);
  mergeRuntimeRuns(current.state.stage2.runtimeRuns, working.runtimeRuns);
  await assertPackageDesignCurrent(current.root, currentPackage);
  await assertPackageImplementationCurrent(current.root, currentPackage);
  const verification = currentPackage.verification!;
  verification.finalCommands = finalCommands;
  verification.staticReview = packageWorkerEvidence(
    "package_static_review",
    staticRun.runtimeRef,
    staticRuntimeRoot,
    staticSkills,
    staticReport,
    now(options),
  );
  verification.verificationReview = packageWorkerEvidence(
    "package_verification",
    verificationRun.runtimeRef,
    verificationRuntimeRoot,
    verificationSkills,
    trustedVerificationReport,
    now(options),
  );
  const reviewFailures = [...new Set([
    ...requiredCommandFailures(independentCommands)
      .map((failure) => `Independent Verification ${failure}`),
    ...packageReviewFailures(staticReport, trustedVerificationReport),
  ])];
  if (reviewFailures.length > 0) {
    currentPackage.status = "BLOCKED";
    currentPackage.blockers = reviewFailures;
    assignBlockedImplementationRepair(current.state.stage2, currentPackage.id);
  } else {
    currentPackage.status = "COMPLETE";
    currentPackage.blockers = [];
    verification.completedAt = now(options).toISOString();
    const assigned = Object.values(current.state.stage2.agents).find((assignment) =>
      assignment.workPackageId === currentPackage.id
    );
    if (assigned !== undefined) {
      releaseWorkspaceAssignment(assigned);
    }
    if (assignBlockedImplementationRepair(current.state.stage2) === undefined) {
      promoteReadyShadow(current.state.stage2);
      assignNextShadow(current.state.stage2);
    }
    if (Object.values(current.state.stage2.workPackages).every((item) => item.status === "COMPLETE")) {
      current.state.stage2.status = "BASELINE_READY";
    }
  }
  recordWorkspaceEvent(
    current.state.stage2,
    reviewFailures.length === 0 ? "PACKAGE_COMPLETE" : "PACKAGE_INDEPENDENT_VERIFICATION_FAILED",
    currentPackage.id,
    reviewFailures.join("; ") || undefined,
    options,
  );
  await syncPackageVerificationDocument(current.root, currentPackage);
  await saveProjectState(current.root, current.state);
  return current;
  });
}

export async function reopenPackageDesign(
  projectPath: string,
  workPackageId: string,
  reason: string,
  options: Stage2WorkspaceExecutionOptions = {},
): Promise<LoadedStage2Workspace> {
  if (reason.trim() === "") {
    throw new Error("Package Design reopen reason is required");
  }
  const loaded = await loadStage2Workspace(projectPath);
  const workPackage = requireWorkPackage(loaded.state.stage2, workPackageId);
  const design = requirePackageDesign(workPackage);
  reopenPackageInState(loaded.state.stage2, workPackage, reason.trim(), options);
  const affected = transitivePackageConsumers(loaded.state.stage2, [workPackageId]);
  affected.delete(workPackageId);
  for (const id of affected) {
    const dependent = requireWorkPackage(loaded.state.stage2, id);
    if (dependent.status === "PENDING" || dependent.status === "DESIGNING") {
      continue;
    }
    if (dependent.design !== undefined) {
      delete dependent.design.approval;
    }
    delete dependent.implementation;
    delete dependent.verification;
    dependent.status = "NEEDS_REALIGN";
    dependent.blockers = [`Upstream Work Package ${workPackageId} Design reopened`];
  }
  let assignment = Object.values(loaded.state.stage2.agents).find((candidate) =>
    candidate.workPackageId === workPackageId
  );
  if (assignment === undefined) {
    assignment = Object.values(loaded.state.stage2.agents).find((candidate) => candidate.role === "idle");
    if (assignment === undefined) {
      throw new Error(`No Agent slot is available to reopen Work Package ${workPackageId}`);
    }
  }
  assignment.role = "shadow";
  assignment.status = "assigned";
  assignment.workPackageId = workPackageId;
  assignment.lease = randomUUID();
  assignment.allowedPaths = [workPackage.plan.designPath];
  const content = renderPackageDesignDocument(
    workPackage,
    design.proposal,
    design.revision,
    "需修订",
    design.skills,
  );
  design.documentSha256 = sha256(content);
  recordWorkspaceEvent(
    loaded.state.stage2,
    "PACKAGE_DESIGN_REOPENED",
    workPackageId,
    reason.trim(),
    options,
  );
  await atomicWriteText(resolveWithin(loaded.root, design.path), content);
  await saveProjectState(loaded.root, loaded.state);
  return loaded;
}

function createEmptyWorkspaceStage(timestamp: string): Stage2WorkspaceStage {
  return {
    schemaVersion: 5,
    status: "SYSTEM_DESIGN_DRAFT",
    revision: 0,
    workspaceRevision: 0,
    stateEpoch: 1,
    initializedAt: timestamp,
    updatedAt: timestamp,
    systemDesign: {
      path: "design/plan.md",
      revision: 0,
      documentSha256: "",
      decisionOrder: [],
      decisions: {},
      legacyEvidence: [],
      revisionRequests: [],
    },
    workPackageOrder: [],
    workPackages: {},
    agents: {
      A: idleWorkspaceAssignment("A"),
      B: idleWorkspaceAssignment("B"),
    },
    runtimeRegistry: {},
    runtimeRuns: {},
    blockers: [],
    history: [],
  };
}

function migrateWorkspaceSchema4(
  source: Stage2WorkspaceStageV4,
  timestamp: string,
): Stage2WorkspaceStage {
  const { proposal: _legacyProposal, ...legacySystemDesign } = source.systemDesign;
  const proposal = source.systemDesign.proposal === undefined
    ? undefined
    : {
      ...structuredClone(source.systemDesign.proposal),
      workPackages: source.systemDesign.proposal.workPackages.map(migrateWorkPackagePlan),
    };
  const workPackages: Stage2WorkspaceStage["workPackages"] = Object.fromEntries(
    Object.entries(source.workPackages).map(([id, workPackage]) => [id, {
      ...structuredClone(workPackage),
      revision: workPackage.design?.revision ?? 0,
      plan: migrateWorkPackagePlan(workPackage.plan),
    }]),
  );
  const runtimeRegistry: Record<string, Stage2RuntimeRegistryEntry> = {};
  const runtimeRuns: Record<string, Stage2RuntimeRunRecord> = {};
  for (const legacy of Object.values(source.runtimeRegistry)) {
    const runId = `migrated_${sha256(`${legacy.runtimeRef}:${legacy.startedAt}`).slice(0, 24)}`;
    runtimeRegistry[legacy.runtimeRef] = {
      runtimeRef: legacy.runtimeRef,
      provider: legacy.provider,
      ...(legacy.model === undefined ? {} : { model: legacy.model }),
      ...(legacy.runtimeVersion === undefined ? {} : { runtimeVersion: legacy.runtimeVersion }),
      ...(legacy.externalSessionId === undefined
        ? {}
        : { externalSessionId: legacy.externalSessionId }),
      phase: stage2TaskPhase(legacy.task),
      status: legacy.status === "cancelled"
        ? "cancelled"
        : legacy.status === "failed"
        ? "failed"
        : "idle",
      latestRunId: runId,
      runCount: 1,
      cumulativePromptBytes: 0,
      createdAt: legacy.startedAt,
      updatedAt: legacy.completedAt ?? timestamp,
    };
    runtimeRuns[runId] = {
      runId,
      runtimeRef: legacy.runtimeRef,
      task: legacy.task,
      ...(legacy.slot === undefined ? {} : { slot: legacy.slot }),
      ...(legacy.workPackageId === undefined ? {} : { workPackageId: legacy.workPackageId }),
      status: legacy.status === "running"
        ? "orphaned"
        : legacy.status === "completed"
        ? "applied"
        : legacy.status,
      promptDigest: legacy.promptDigest,
      inputArtifactHashes: { ...legacy.inputArtifactHashes },
      outputArtifactHashes: { ...legacy.outputArtifactHashes },
      toolPolicy: legacy.toolPolicy,
      runtimePath: "",
      startedAt: legacy.startedAt,
      lastEventAt: legacy.completedAt ?? legacy.startedAt,
      ...(legacy.completedAt === undefined ? {} : { completedAt: legacy.completedAt }),
      eventCount: 0,
      ...(legacy.status === "running" ? { error: "Migrated in-flight run has no live process" } : {}),
    };
  }
  const stage2: Stage2WorkspaceStage = {
    schemaVersion: 5,
    status: source.status,
    revision: source.revision,
    workspaceRevision: source.workspaceRevision,
    stateEpoch: 1,
    initializedAt: source.initializedAt,
    updatedAt: timestamp,
    systemDesign: {
      ...structuredClone(legacySystemDesign),
      ...(proposal === undefined ? {} : { proposal }),
    },
    workPackageOrder: [...source.workPackageOrder],
    workPackages,
    agents: structuredClone(source.agents),
    runtimeRegistry,
    runtimeRuns,
    migration: {
      migratedAt: timestamp,
      sourceSchemaVersion: 4,
      sourceRevision: source.revision,
      sourceStatus: source.status,
      sourcePlanSha256: source.systemDesign.documentSha256,
      retainedEvidenceIds: source.systemDesign.legacyEvidence.map((item) => item.id),
    },
    ...(source.architectureRework === undefined
      ? {}
      : { architectureRework: structuredClone(source.architectureRework) }),
    ...(source.architectureReworkHistory === undefined
      ? {}
      : { architectureReworkHistory: structuredClone(source.architectureReworkHistory) }),
    blockers: [...source.blockers],
    history: structuredClone(source.history),
  };
  for (const assignment of Object.values(stage2.agents)) {
    delete assignment.runId;
    const session = assignment.runtimeRef === undefined
      ? undefined
      : stage2.runtimeRegistry[assignment.runtimeRef];
    if (session?.phase === "system_design" && stage2.status === "PACKAGE_LOOP") {
      delete assignment.runtimeRef;
    }
  }
  validateWorkspaceStage(stage2);
  return stage2;
}

function migrateWorkPackagePlan(
  plan: Stage2WorkspaceStageV4["workPackages"][string]["plan"],
) {
  return {
    id: plan.id,
    componentIds: [...plan.componentIds],
    designDependsOn: [...plan.dependsOn],
    implementationDependsOn: [...plan.dependsOn],
    integrationDependsOn: [...plan.dependsOn],
    allowedSourcePaths: [...plan.allowedSourcePaths],
    allowedTestPaths: [...plan.allowedTestPaths],
    designPath: plan.designPath,
    acceptance: [...plan.acceptance],
  };
}

function collectLegacyEvidence(stage2: Stage2ProjectStage): Stage2LegacyEvidence[] {
  const evidence: Stage2LegacyEvidence[] = [];
  for (const id of stage2.topology.decisionOrder) {
    const decision = stage2.topology.decisions[id];
    if (decision === undefined) {
      continue;
    }
    evidence.push({
      id,
      kind: "topology_decision",
      summary: decision.resolution?.conclusion
        ?? decision.proposal?.summary
        ?? `${decision.spec.topic} 尚未形成结论`,
      sourceRevision: stage2.revision,
      ...(decision.resolution?.planDocumentSha256 === undefined
        ? {}
        : { contentSha256: decision.resolution.planDocumentSha256 }),
    });
    if (decision.evidence !== undefined) {
      evidence.push({
        id: `${id}_research`,
        kind: "worker_run",
        summary: `Topology Research evidenceSufficient=${String(decision.evidence.evidenceSufficient)}`,
        sourceRevision: stage2.revision,
        contentSha256: decision.evidence.contextFingerprint,
        runId: decision.evidence.runId,
      });
    }
  }
  evidence.push({
    id: "legacy_topology_plan",
    kind: "topology_plan",
    summary: `旧 Plan 包含 ${String(stage2.topology.plan.units.length)} 个 Implementation Unit，只作为新 System Design 的候选输入`,
    sourceRevision: stage2.revision,
    contentSha256: stage2.topology.planDocumentSha256,
  });
  if (stage2.architectureRework !== undefined) {
    evidence.push({
      id: stage2.architectureRework.id,
      kind: "architecture_rework",
      summary: stage2.architectureRework.summary,
      sourceRevision: stage2.revision,
      contentSha256: valueHash(stage2.architectureRework),
    });
  }
  return evidence;
}

function collectLegacyRuntimes(
  stage2: Stage2ProjectStage,
  timestamp: string,
): {
  registry: Record<string, Stage2RuntimeRegistryEntry>;
  runs: Record<string, Stage2RuntimeRunRecord>;
} {
  const registry: Record<string, Stage2RuntimeRegistryEntry> = {};
  const runs: Record<string, Stage2RuntimeRunRecord> = {};
  const add = (
    runtimeRef: string,
    task: Stage2RuntimeRunRecord["task"],
    at: string,
    externalSessionId: string,
    inputArtifactHashes: Record<string, string>,
    slot?: Stage2AgentSlot,
    workPackageId?: string,
  ): void => {
    const runId = `migrated_${sha256(`${runtimeRef}:${at}`).slice(0, 24)}`;
    registry[runtimeRef] = {
      runtimeRef,
      provider: "codex-cli",
      externalSessionId,
      phase: "legacy",
      status: "idle",
      latestRunId: runId,
      runCount: 1,
      cumulativePromptBytes: 0,
      createdAt: at,
      updatedAt: at,
    };
    runs[runId] = {
      runId,
      runtimeRef,
      task,
      ...(slot === undefined ? {} : { slot }),
      ...(workPackageId === undefined ? {} : { workPackageId }),
      status: "applied",
      promptDigest: "legacy",
      inputArtifactHashes,
      outputArtifactHashes: {},
      toolPolicy: "read-only",
      runtimePath: "",
      startedAt: at,
      lastEventAt: at,
      completedAt: at,
      eventCount: 0,
    };
  };
  for (const id of stage2.topology.decisionOrder) {
    const decision = stage2.topology.decisions[id];
    if (decision?.evidence?.threadId === undefined) {
      continue;
    }
    const runtimeRef = `legacy_${id.toLowerCase()}_research`;
    add(
      runtimeRef,
      "topology_research",
      decision.evidence.completedAt,
      decision.evidence.threadId,
      { contextFingerprint: decision.evidence.contextFingerprint },
    );
  }
  for (const assignment of Object.values(stage2.agents)) {
    if (assignment.threadId === undefined) {
      continue;
    }
    const runtimeRef = `legacy_slot_${assignment.slot.toLowerCase()}`;
    add(
      runtimeRef,
      assignment.role === "active" ? "active_implementation" : "topology_planning",
      timestamp,
      assignment.threadId,
      {},
      assignment.slot,
      assignment.moduleId,
    );
  }
  return { registry, runs };
}

function isLegacyActiveStage1Rework(
  rework: Stage2ArchitectureReworkRecord | undefined,
): rework is Stage2ArchitectureReworkRecord {
  return rework?.status === "stage1_rework" || rework?.status === "stage1_reapproved";
}

function isActiveStage1Rework(
  rework: Stage2WorkspaceArchitectureReworkRecord | undefined,
): rework is Stage2WorkspaceArchitectureReworkRecord {
  return rework?.status === "stage1_rework" || rework?.status === "stage1_reapproved";
}

function convertLegacyRework(
  legacy: Stage2ArchitectureReworkRecord,
  source: Stage2ProjectStage,
): Stage2WorkspaceArchitectureReworkRecord {
  const packageIds = source.topology.plan.units
    .filter((unit) => legacy.affectedUnits.includes(unit.id))
    .map((unit) => unit.id);
  return {
    summary: legacy.summary,
    rationale: legacy.rationale,
    source: {
      kind: legacy.source.kind,
      ...(legacy.source.decisionId === undefined ? {} : { decisionId: legacy.source.decisionId }),
      ...(legacy.source.unitId === undefined ? {} : { workPackageId: legacy.source.unitId }),
    },
    repair: structuredClone(legacy.repair),
    requiredClosure: [...legacy.requiredClosure],
    evidenceSources: structuredClone(legacy.evidenceSources),
    affectedComponents: [...legacy.affectedUnits],
    affectedWorkPackages: packageIds,
    id: legacy.id,
    status: legacy.status === "stage1_rework" || legacy.status === "stage1_reapproved"
      ? legacy.status
      : legacy.status === "resumed"
      ? "resumed"
      : "system_design_rework",
    startedAt: legacy.startedAt,
    updatedAt: legacy.updatedAt,
    baseline: {
      stage1ApprovalSha256: legacy.baseline.stage1ApprovalSha256,
      stage2Revision: legacy.baseline.stage2Revision,
      workspaceRevision: 0,
      systemDesignSha256: source.topology.planDocumentSha256,
      ...(legacy.baseline.planApprovalSha256 === undefined
        ? {}
        : { interfaceSha256: legacy.baseline.planApprovalSha256 }),
      workPackageDesignHashes: Object.fromEntries(
        legacy.invalidatedArtifacts.flatMap((item) =>
          item.designSha256 === undefined ? [] : [[item.unitId, item.designSha256]]
        ),
      ),
    },
    suspendedAssignments: legacy.suspendedAssignments.map((assignment) => ({
      slot: assignment.slot,
      role: assignment.role,
      status: "waiting",
      lease: randomUUID(),
      baseRevision: 0,
      workPackageId: assignment.moduleId,
      allowedPaths: [],
    })),
    invalidatedWorkPackages: legacy.invalidatedArtifacts.map((item) => ({
      workPackageId: item.unitId,
      ...(item.designSha256 === undefined ? {} : { designSha256: item.designSha256 }),
      ...(item.implementationSha256 === undefined
        ? {}
        : { implementationSha256: item.implementationSha256 }),
      ...(item.verificationSha256 === undefined
        ? {}
        : { verificationSha256: item.verificationSha256 }),
    })),
    ...(legacy.newStage1ApprovalSha256 === undefined
      ? {}
      : { newStage1ApprovalSha256: legacy.newStage1ApprovalSha256 }),
    ...(legacy.resumedAt === undefined ? {} : { resumedAt: legacy.resumedAt }),
  };
}

function validateWorkspaceStage(stage2: Stage2WorkspaceStage): void {
  if (stage2.schemaVersion !== 5) {
    throw new Error(`Unsupported Stage2 workspace schema: ${String(stage2.schemaVersion)}`);
  }
  if (stage2.agents.A.slot !== "A" || stage2.agents.B.slot !== "B") {
    throw new Error("Stage2 workspace Agent slots are corrupted");
  }
  if (new Set(stage2.workPackageOrder).size !== stage2.workPackageOrder.length) {
    throw new Error("Stage2 workspace Work Package order contains duplicates");
  }
  const revisionRequests = stage2.systemDesign.revisionRequests ?? [];
  if (new Set(revisionRequests.map((request) => request.id)).size !== revisionRequests.length) {
    throw new Error("Stage2 System Design revision request IDs contain duplicates");
  }
  if (revisionRequests.filter((request) => request.status === "pending").length > 1) {
    throw new Error("Stage2 has multiple pending System Design revision requests");
  }
  for (const request of revisionRequests) {
    if (request.instruction.trim() === "") {
      throw new Error(`Stage2 System Design revision request ${request.id} has an empty instruction`);
    }
  }
  for (const id of stage2.workPackageOrder) {
    const workPackage = stage2.workPackages[id];
    if (workPackage === undefined || workPackage.id !== id) {
      throw new Error(`Stage2 workspace Work Package state is missing: ${id}`);
    }
    if (!Number.isInteger(workPackage.revision) || workPackage.revision < 0) {
      throw new Error(`Stage2 Work Package ${id} has an invalid revision`);
    }
  }
  const assignedPackages = Object.values(stage2.agents).flatMap((assignment) =>
    assignment.workPackageId === undefined ? [] : [assignment.workPackageId]
  );
  if (new Set(assignedPackages).size !== assignedPackages.length) {
    throw new Error("One Work Package is assigned to multiple persistent Agent slots");
  }
  for (const role of ["active", "shadow"] as const) {
    if (Object.values(stage2.agents).filter((assignment) => assignment.role === role).length > 1) {
      throw new Error(`Stage2 workspace has multiple ${role} assignments`);
    }
  }
  for (const [runId, run] of Object.entries(stage2.runtimeRuns)) {
    if (run.runId !== runId || stage2.runtimeRegistry[run.runtimeRef] === undefined) {
      throw new Error(`Stage2 Runtime Run ${runId} has no valid session`);
    }
  }
}

function normalizeDuplicateWorkspaceRoles(stage2: Stage2WorkspaceStage): number {
  let normalized = 0;
  for (const role of ["active", "shadow"] as const) {
    const assignments = Object.values(stage2.agents)
      .filter((assignment) => assignment.role === role)
      .sort((left, right) => {
        const rank = (status: Stage2WorkspaceAgentAssignment["status"]): number =>
          status === "working" ? 0 : status === "assigned" ? 1 : 2;
        return rank(left.status) - rank(right.status) || left.slot.localeCompare(right.slot);
      });
    for (const duplicate of assignments.slice(1)) {
      releaseWorkspaceAssignment(duplicate);
      normalized += 1;
    }
  }
  return normalized;
}

function refineWorkspace(loaded: LoadedProject): LoadedStage2Workspace {
  if (loaded.state.stage2 === undefined || loaded.state.stage2.schemaVersion !== 5) {
    throw new Error("Stage2 workspace state is unavailable");
  }
  return loaded as LoadedStage2Workspace;
}

async function buildWorkspaceEnvelope(
  loaded: LoadedStage2Workspace,
  stage2: Stage2WorkspaceStage,
  task: Stage2WorkspaceTaskEnvelope["task"],
  slot: Stage2AgentSlot,
  skills: Stage2WorkspaceTaskEnvelope["skills"],
  workPackageId?: string,
): Promise<Stage2WorkspaceTaskEnvelope> {
  const assignment = stage2.agents[slot];
  const proposal = stage2.systemDesign.proposal;
  const workPackage = workPackageId === undefined
    ? undefined
    : requireWorkPackage(stage2, workPackageId);
  const packageContext = workPackage === undefined || proposal === undefined
    ? undefined
    : {
      plan: structuredClone(workPackage.plan),
      componentContext: proposal.components.filter((component) =>
        workPackage.plan.componentIds.includes(component.id)
      ),
      interfaceContext: proposal.interfaces.filter((contract) =>
        workPackage.plan.componentIds.includes(contract.ownerComponentId)
        || contract.producerComponentIds.some((id) => workPackage.plan.componentIds.includes(id))
        || contract.consumerComponentIds.some((id) => workPackage.plan.componentIds.includes(id))
      ),
      upstreamDesigns: workPackage.plan.designDependsOn.flatMap((id) => {
        const dependency = requireWorkPackage(stage2, id);
        return dependency.design?.approval === undefined
          ? []
          : [{
            workPackageId: id,
            path: dependency.design.path,
            designSha256: dependency.design.approval.designSha256,
          }];
      }),
      resolvedDecisions: resolvedDecisions(workPackage.decisions),
    };
  const systemProposal = proposal === undefined || workPackage !== undefined
    ? {}
    : { proposal: structuredClone(proposal) };
  const systemApproval = stage2.systemDesign.approval;
  const packageDesign = workPackage?.design;
  const readManifest = await buildStage2ReadManifest(
    loaded.root,
    loaded.state,
    stage2,
    task,
    workPackage,
  );
  return {
    schemaVersion: 5,
    task,
    project: { name: loaded.state.project.name, root: loaded.root },
    systemDesign: {
      path: stage2.systemDesign.path,
      revision: stage2.systemDesign.revision,
      documentSha256: stage2.systemDesign.documentSha256,
      architectureRoles: structuredClone(loaded.state.stage1.projectSpec?.architecture.roles ?? []),
      legacyEvidence: structuredClone(stage2.systemDesign.legacyEvidence),
      resolvedDecisions: resolvedDecisions(stage2.systemDesign.decisions),
      ...(latestSystemDesignRevisionRequest(stage2) === undefined
        ? {}
        : { revisionRequest: structuredClone(latestSystemDesignRevisionRequest(stage2)!) }),
      ...systemProposal,
    },
    ...(packageContext === undefined ? {} : { workPackage: packageContext }),
    assignment: {
      slot,
      role: assignment.role,
      lease: assignment.lease,
      workspaceRevision: stage2.workspaceRevision,
      stateEpoch: stage2.stateEpoch,
      ...(workPackage === undefined ? {} : { workPackageRevision: workPackage.revision }),
      ...(assignment.runtimeRef === undefined ? {} : { runtimeRef: assignment.runtimeRef }),
    },
    authority: {
      repositoryRules: await readText(resolveWithin(loaded.root, "AGENTS.md")),
      architectureHashes: { ...(loaded.state.stage1.approval?.documentHashes ?? {}) },
      ...(systemApproval === undefined
        ? {}
        : {
          systemDesignSha256: systemApproval.documentSha256,
          interfaceSha256: systemApproval.interfaceSha256,
        }),
      ...(packageDesign?.approval === undefined
        ? {}
        : {
          packageDesignPath: packageDesign.path,
          packageDesignSha256: packageDesign.approval.designSha256,
        }),
    },
    skills: skills.map((skill) => ({ ...skill })),
    readManifest,
    allowedPaths: workPackage === undefined
      ? [stage2.systemDesign.path]
      : task === "package_design"
      ? [workPackage.plan.designPath]
      : task === "package_implementation"
      ? [...workPackage.plan.allowedSourcePaths, ...workPackage.plan.allowedTestPaths]
      : [],
    explicitExclusions: [
      ".assistant/**",
      "architecture/**",
      ...(workPackage === undefined ? ["src/**", "verification/**"] : []),
    ],
    nextPermittedAction: workspaceNextPermittedAction(task),
  };
}

function resolvedDecisions(
  decisions: Record<string, Stage2DecisionRequestState>,
): Array<{ id: string; conclusion: string }> {
  return Object.entries(decisions).flatMap(([id, decision]) =>
    decision.resolution === undefined
      ? []
      : [{ id, conclusion: decision.resolution.conclusion }]
  );
}

function latestSystemDesignRevisionRequest(
  stage2: Stage2WorkspaceStage,
): Stage2SystemDesignRevisionRequest | undefined {
  return stage2.systemDesign.revisionRequests?.at(-1);
}

function nextSystemDesignRevisionRequestId(
  requests: Stage2SystemDesignRevisionRequest[],
): string {
  const next = requests.reduce((maximum, request) => {
    const match = /^SDR_(\d+)$/u.exec(request.id);
    return match === null ? maximum : Math.max(maximum, Number(match[1]));
  }, 0) + 1;
  return `SDR_${String(next).padStart(3, "0")}`;
}

function inputHashes(
  state: Stage1ProjectState,
  stage2: Stage2WorkspaceStage,
): Record<string, string> {
  return {
    architectureApproval: state.stage1.approval?.aggregateSha256 ?? "missing",
    systemDesign: stage2.systemDesign.documentSha256,
    components: valueHash(stage2.systemDesign.proposal?.components ?? []),
    interfaces: valueHash(stage2.systemDesign.proposal?.interfaces ?? []),
    workPackages: valueHash(stage2.systemDesign.proposal?.workPackages ?? []),
  };
}

function recordWorkspaceEvent(
  stage2: Stage2WorkspaceStage,
  event: string,
  workPackageId: string | undefined,
  detail: string | undefined,
  options: Stage2WorkspaceExecutionOptions,
): void {
  stage2.revision += 1;
  stage2.workspaceRevision += 1;
  if (workPackageId !== undefined && stage2.workPackages[workPackageId] !== undefined) {
    stage2.workPackages[workPackageId]!.revision += 1;
  }
  stage2.updatedAt = now(options).toISOString();
  stage2.history.push({
    at: stage2.updatedAt,
    revision: stage2.revision,
    workspaceRevision: stage2.workspaceRevision,
    event,
    ...(workPackageId === undefined ? {} : { workPackageId }),
    ...(detail === undefined || detail === "" ? {} : { detail }),
  });
}

function findDecisionRequest(
  stage2: Stage2WorkspaceStage,
  decisionId: string,
): {
  scope: "system" | "package";
  decision: Stage2DecisionRequestState;
  workPackage?: Stage2WorkPackageStateV4;
} {
  const systemDecision = stage2.systemDesign.decisions[decisionId];
  if (systemDecision !== undefined) {
    return { scope: "system", decision: systemDecision };
  }
  for (const workPackage of Object.values(stage2.workPackages)) {
    const decision = workPackage.decisions[decisionId];
    if (decision !== undefined) {
      return { scope: "package", decision, workPackage };
    }
  }
  throw new Error(`Unknown Stage2 DecisionRequest: ${decisionId}`);
}

function requireSystemDesignProposal(stage2: Stage2WorkspaceStage): Stage2SystemDesignProposal {
  const proposal = stage2.systemDesign.proposal;
  if (proposal === undefined) {
    throw new Error("Stage2 System Design Draft is missing");
  }
  return proposal;
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

function requirePackageDesign(workPackage: Stage2WorkPackageStateV4) {
  if (workPackage.design === undefined) {
    throw new Error(`Work Package ${workPackage.id} has no Design`);
  }
  return workPackage.design;
}

function requirePackageDesignApproval(workPackage: Stage2WorkPackageStateV4) {
  const design = requirePackageDesign(workPackage);
  if (design.approval === undefined) {
    throw new Error(`Work Package ${workPackage.id} Design is not approved`);
  }
  return design.approval;
}

function requirePackageImplementation(workPackage: Stage2WorkPackageStateV4) {
  if (workPackage.implementation === undefined) {
    throw new Error(`Work Package ${workPackage.id} has no implementation`);
  }
  return workPackage.implementation;
}

function reopenPackageInState(
  stage2: Stage2WorkspaceStage,
  workPackage: Stage2WorkPackageStateV4,
  reason: string,
  options: Stage2WorkspaceExecutionOptions,
): void {
  const design = requirePackageDesign(workPackage);
  workPackage.reopened.push({
    at: now(options).toISOString(),
    reason,
    previousDesignSha256: design.documentSha256,
  });
  delete design.approval;
  delete workPackage.implementation;
  delete workPackage.verification;
  workPackage.status = "DESIGNING";
  workPackage.blockers = [reason];
}

function scheduleAfterActiveVerification(
  stage2: Stage2WorkspaceStage,
  currentAssignment: Stage2WorkspaceAgentAssignment,
): void {
  const preferredSlot = currentAssignment.slot;
  const blockedRepairExists = stage2.workPackageOrder.some((id) => {
    const workPackage = stage2.workPackages[id];
    return workPackage?.status === "BLOCKED"
      && workPackage.design?.approval !== undefined
      && workPackage.implementation !== undefined
      && areImplementationDependenciesComplete(stage2, workPackage);
  });
  if (blockedRepairExists) {
    releaseWorkspaceAssignment(currentAssignment);
    if (assignBlockedImplementationRepair(stage2, undefined, preferredSlot) !== undefined) {
      return;
    }
  }
  promoteReadyShadow(stage2);
  assignNextShadow(stage2);
}

async function assertProjectReferencesExist(root: string, paths: string[]): Promise<void> {
  for (const path of paths) {
    if (!(await pathExists(resolveWithin(root, path)))) {
      throw new Error(`Stage2 Agent referenced a missing project file: ${path}`);
    }
  }
}

async function writeTaskEnvelope(
  runtimeRoot: string,
  envelope: Stage2WorkspaceTaskEnvelope,
): Promise<void> {
  await atomicWriteText(
    resolveWithin(runtimeRoot, "task-envelope.json"),
    `${JSON.stringify(envelope, null, 2)}\n`,
  );
}

async function writeAgentRun(runtimeRoot: string, run: AgentRun): Promise<void> {
  await Promise.all([
    atomicWriteText(resolveWithin(runtimeRoot, "result.json"), `${JSON.stringify(run.output, null, 2)}\n`),
    atomicWriteText(resolveWithin(runtimeRoot, "codex.jsonl"), run.events),
  ]);
}

async function persistWorkspaceRunDispatch(
  projectPath: string,
  snapshot: WorkspaceAssignmentSnapshot,
  working: Stage2WorkspaceStage,
  handle: AgentRunHandle,
  options: Stage2WorkspaceExecutionOptions,
): Promise<WorkspaceAssignmentSnapshot> {
  return withStage2WorkspaceLock(projectPath, async () => {
    const loaded = await loadStage2Workspace(projectPath);
    const assignment = assertWorkspaceAssignmentStillCurrent(loaded.state.stage2, snapshot);
    mergeRuntimeEvidenceForRun(loaded.state.stage2, working, handle.runId);
    assignment.runtimeRef = handle.runtimeRef;
    assignment.runId = handle.runId;
    assignment.status = "working";
    recordWorkspaceEvent(
      loaded.state.stage2,
      "RUNTIME_RUN_DISPATCHED",
      assignment.workPackageId,
      `run=${handle.runId}; runtime=${handle.runtimeRef}`,
      options,
    );
    await saveProjectState(loaded.root, loaded.state);
    return snapshotWorkspaceAssignment(loaded.state.stage2, assignment);
  });
}

async function persistWorkspaceRunFailure(
  projectPath: string,
  snapshot: WorkspaceAssignmentSnapshot,
  working: Stage2WorkspaceStage,
  error: unknown,
  options: Stage2WorkspaceExecutionOptions,
): Promise<void> {
  try {
    await withStage2WorkspaceLock(projectPath, async () => {
      const loaded = await loadStage2Workspace(projectPath);
      const assignment = assertWorkspaceAssignmentStillCurrent(loaded.state.stage2, snapshot);
      if (snapshot.runId === undefined) {
        throw new Error("Failed Stage2 run has no persisted runId");
      }
      mergeRuntimeEvidenceForRun(loaded.state.stage2, working, snapshot.runId);
      const run = loaded.state.stage2.runtimeRuns[snapshot.runId];
      if (run !== undefined && run.status !== "cancelled") {
        if (run.status !== "validation_failed") {
          setRunStatus(run, "failed", now(options), errorMessage(error));
        }
      }
      assignment.status = "assigned";
      delete assignment.runId;
      if (run?.status === "failed" || run?.status === "cancelled") {
        delete assignment.runtimeRef;
      }
      recordWorkspaceEvent(
        loaded.state.stage2,
        run?.status === "validation_failed"
          ? "RUNTIME_RUN_VALIDATION_FAILED"
          : "RUNTIME_RUN_FAILED",
        assignment.workPackageId,
        `run=${snapshot.runId}; ${errorMessage(error)}`,
        options,
      );
      await saveProjectState(loaded.root, loaded.state);
    });
  } catch (persistenceError) {
    if (!/Stale Stage2 result/u.test(errorMessage(persistenceError))) {
      throw persistenceError;
    }
  }
}

function mergeRuntimeEvidenceForRun(
  target: Stage2WorkspaceStage,
  source: Stage2WorkspaceStage,
  runId: string,
): void {
  const run = source.runtimeRuns[runId];
  if (run === undefined) {
    throw new Error(`Runtime did not register run ${runId}`);
  }
  const session = source.runtimeRegistry[run.runtimeRef];
  if (session === undefined) {
    throw new Error(`Runtime run ${runId} has no session ${run.runtimeRef}`);
  }
  mergeRuntimeSession(target.runtimeRegistry, session);
  const existing = target.runtimeRuns[runId];
  if (existing !== undefined && existing.runtimeRef !== run.runtimeRef) {
    throw new Error(`Runtime run ID collision: ${runId}`);
  }
  target.runtimeRuns[runId] = structuredClone(run);
}

function mergeRuntimeSession(
  target: Record<string, Stage2RuntimeRegistryEntry>,
  source: Stage2RuntimeRegistryEntry,
): void {
  const existing = target[source.runtimeRef];
  if (existing === undefined) {
    target[source.runtimeRef] = structuredClone(source);
    return;
  }
  if (source.runCount < existing.runCount) {
    return;
  }
  if (
    source.runCount === existing.runCount
    && source.updatedAt < existing.updatedAt
  ) {
    return;
  }
  target[source.runtimeRef] = structuredClone(source);
}

function mergeRuntimeRegistry(
  target: Record<string, Stage2RuntimeRegistryEntry>,
  source: Record<string, Stage2RuntimeRegistryEntry>,
): void {
  for (const entry of Object.values(source)) {
    mergeRuntimeSession(target, entry);
  }
}

function mergeRuntimeRuns(
  target: Record<string, Stage2RuntimeRunRecord>,
  source: Record<string, Stage2RuntimeRunRecord>,
): void {
  for (const [runId, entry] of Object.entries(source)) {
    const existing = target[runId];
    if (existing !== undefined && existing.runtimeRef !== entry.runtimeRef) {
      throw new Error(`Runtime run ID collision: ${runId}`);
    }
    target[runId] = structuredClone(entry);
  }
}

async function syncPackageVerificationDocument(
  root: string,
  workPackage: Stage2WorkPackageStateV4,
): Promise<void> {
  if (workPackage.verification === undefined) {
    return;
  }
  const content = renderPackageVerificationDocument(workPackage);
  workPackage.verification.documentSha256 = sha256(content);
  await atomicWriteText(resolveWithin(root, workPackage.verification.documentPath), content);
}

function runtimeSlotForPackage(stage2: Stage2WorkspaceStage, workPackageId: string): Stage2AgentSlot {
  const assignment = Object.values(stage2.agents).find((candidate) =>
    candidate.workPackageId === workPackageId
  );
  if (assignment !== undefined) {
    return assignment.slot;
  }
  const implementationRuntime = Object.values(stage2.runtimeRuns)
    .filter((entry) => entry.workPackageId === workPackageId && entry.slot !== undefined)
    .sort((left, right) => (right.startedAt ?? "").localeCompare(left.startedAt ?? ""))[0];
  return implementationRuntime?.slot ?? "A";
}

function isMachineAction(action: Stage2WorkspaceNextAction): boolean {
  return new Set([
    "system_design_draft",
    "system_design_revision",
    "package_design",
    "package_design_revision",
    "active_implementation",
    "verification",
    "architecture_rework_resume",
  ]).has(action.kind);
}

function isUserGateAction(action: Stage2WorkspaceNextAction): boolean {
  return new Set([
    "decision_request",
    "system_design_approval",
    "package_design_approval",
    "package_design_revision",
    "waiting_for_rotation",
    "architecture_rework_stage1",
    "blocked",
    "baseline_complete",
  ]).has(action.kind);
}

function describeMachineAction(action: Stage2WorkspaceNextAction): string {
  switch (action.kind) {
    case "system_design_draft":
      return "Agent A 生成 System Design Draft，Agent B 执行独立审查";
    case "system_design_revision":
      return "Agent A 修订 System Design，Agent B 重新独立审查";
    case "package_design":
      return `Shadow ${action.slot} 闭合 ${action.workPackageId} Package Design`;
    case "package_design_revision":
      return `Shadow ${action.slot} 局部修订 ${action.workPackageId} Package Design`;
    case "active_implementation":
      return `Active ${action.slot} 实现 ${action.workPackageId}`;
    case "verification":
      return `两个独立 Worker 验证 ${action.workPackageId}`;
    case "runs_in_progress":
      return `${String(action.runIds.length)} 个 Stage2 run 正在执行`;
    case "architecture_rework_resume":
      return `恢复 Architecture Rework ${action.reworkId}`;
    default:
      return "等待用户门禁";
  }
}

function describeUserGate(action: Stage2WorkspaceNextAction): string {
  switch (action.kind) {
    case "decision_request":
      return `${action.decision.id}: ${action.decision.question}`;
    case "system_design_approval":
      return `确认 ${action.path} revision ${String(action.revision)}`;
    case "package_design_approval":
      return `确认 ${action.workPackageId} Package Design`;
    case "package_design_revision":
      return `${action.workPackageId} Design 仍有 ${String(action.issues.length)} 个缺口`;
    case "waiting_for_rotation":
      return `${action.workPackageId} 已批准，等待前一 Package 满足轮转门禁`;
    case "blocked":
      return action.blockers[0] ?? "Stage2 blocked";
    case "architecture_rework_stage1":
      return `Stage1 Architecture Rework ${action.reworkId}`;
    case "baseline_complete":
      return "Stage2 baseline 已完成";
    case "runs_in_progress":
      return `${String(action.runIds.length)} 个 Stage2 run 正在执行`;
    default:
      return "当前无用户审批门禁";
  }
}

function workspaceNextPermittedAction(task: Stage2WorkspaceTaskEnvelope["task"]): string {
  switch (task) {
    case "system_design_draft":
      return "提交 System Design Draft 和必要 DecisionRequests";
    case "system_design_review":
      return "提交只读独立审查报告";
    case "package_design":
      return "提交 Package Design 并等待用户批准";
    case "package_implementation":
      return "提交受允许路径约束的源码和测试提案";
    case "package_static_review":
      return "提交独立静态审查报告";
    case "package_verification":
      return "提交独立命令验证报告";
    default:
      return "当前 Task 由旧 Stage2 兼容层处理";
  }
}

function hasRetryableVerificationInfrastructureBlocker(
  workPackage: Stage2WorkPackageStateV4,
): boolean {
  return workPackage.status === "IMPLEMENTING"
    && workPackage.design?.approval !== undefined
    && workPackage.implementation !== undefined
    && workPackage.verification !== undefined
    && workPackage.blockers.length > 0
    && workPackage.blockers.every((blocker) =>
      /^(?:COMMAND_EXECUTION_BLOCKED|REVIEW_SCOPE_INCOMPLETE)(?:\s*:|$)/u.test(blocker)
    );
}

function now(options: Stage2WorkspaceExecutionOptions): Date {
  return options.now?.() ?? new Date();
}

function createAgentRuntime(
  registry: Record<string, Stage2RuntimeRegistryEntry>,
  runs: Record<string, Stage2RuntimeRunRecord>,
  options: Stage2WorkspaceExecutionOptions,
): AgentRuntime {
  return options.runtimeFactory?.(registry, runs) ?? new CodexCliRuntime(registry, runs, {
    ...(options.executor === undefined ? {} : { executor: options.executor }),
    now: () => now(options),
  });
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
