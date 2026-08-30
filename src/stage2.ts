import { randomUUID } from "node:crypto";
import { basename, posix } from "node:path";
import { runCommands } from "./commands.js";
import {
  assertSafeRelativePath,
  atomicWriteText,
  pathExists,
  readText,
  resolveWithin,
  shellQuote,
  sha256,
  toWslPath,
} from "./io.js";
import { loadStage2TaskSkills, renderSkillContext, skillReferences } from "./skill-registry.js";
import {
  assertVerificationInputsUnchanged,
  createStage2RunDirectory,
  createVerificationWorkspace,
  defaultStage2AgentExecutor,
  snapshotVerificationInputs,
  type Stage2AgentExecutor,
} from "./stage2-runtime.js";
import {
  assertApprovalCurrent,
  loadStage1,
  saveProjectState,
  type LoadedProject,
} from "./stage1.js";
import type {
  CommandResult,
  CommandSpec,
  ModuleSpec,
  Stage1ProjectState,
  Stage2AgentAssignment,
  Stage2AgentSlot,
  Stage2AgentTask,
  Stage2DesignProposal,
  Stage2ImplementationProposal,
  Stage2ModuleState,
  Stage2NextAction,
  Stage2ProjectStage,
  Stage2ReviewReport,
  Stage2SkillReference,
  Stage2Summary,
  Stage2TaskEnvelope,
  Stage2VerificationMode,
  Stage2WorkerEvidence,
} from "./types.js";

export interface LoadedStage2Project extends Omit<LoadedProject, "state"> {
  state: Stage1ProjectState & { stage2: Stage2ProjectStage };
}

export type Stage2CommandRunner = (
  specs: CommandSpec[],
  projectRoot: string,
) => CommandResult[] | Promise<CommandResult[]>;

export interface Stage2ExecutionOptions {
  executor?: Stage2AgentExecutor;
  commandRunner?: Stage2CommandRunner;
  now?: () => Date;
}

export interface Stage2AgentRunResult<T> {
  loaded: LoadedStage2Project;
  output: T;
  runId: string;
  threadId: string;
}

interface AssignmentSnapshot {
  slot: Stage2AgentSlot;
  role: Stage2AgentAssignment["role"];
  assignmentStatus: Stage2AgentAssignment["status"];
  moduleId: string;
  moduleStatus: Stage2ModuleState["status"];
  designRevision?: number;
  implementationAggregateSha256?: string;
  lease: string;
  stateEpoch: number;
  threadId?: string;
}

export async function initStage2(projectPath: string): Promise<LoadedStage2Project> {
  const loaded = await loadStage1(projectPath);
  if (loaded.state.stage1.status !== "STAGE1_COMPLETE") {
    throw new Error(`Stage2 requires STAGE1_COMPLETE, current state is ${loaded.state.stage1.status}`);
  }
  if (loaded.state.stage2 !== undefined) {
    throw new Error(`Stage2 is already initialized at ${loaded.root}`);
  }
  await assertApprovalCurrent(loaded.root, loaded.state);
  const architecture = loaded.state.stage1.projectSpec?.architecture
    ?? loaded.loadedProfile.profile.architecture;
  const modules = new Map(architecture.modules.map((module) => [module.id, module]));
  for (const moduleId of architecture.stage2Order) {
    if (!modules.has(moduleId)) {
      throw new Error(`Stage2 order references unknown module ${moduleId}`);
    }
  }
  if (architecture.stage2Order.length !== modules.size) {
    throw new Error("Stage2 order must contain every architecture module exactly once");
  }

  const timestamp = new Date().toISOString();
  const moduleStates = Object.fromEntries(
    architecture.stage2Order.map((moduleId, order) => {
      const module = modules.get(moduleId);
      if (module === undefined) {
        throw new Error(`Missing module ${moduleId}`);
      }
      const state: Stage2ModuleState = {
        id: moduleId,
        order,
        status: "PENDING",
        architecture: structuredClone(module),
        blockers: [],
        reopened: [],
      };
      return [moduleId, state];
    }),
  );
  const stage2: Stage2ProjectStage = {
    schemaVersion: 1,
    status: "MODULE_LOOP",
    revision: 0,
    stateEpoch: 1,
    initializedAt: timestamp,
    updatedAt: timestamp,
    moduleOrder: [...architecture.stage2Order],
    modules: moduleStates,
    agents: {
      A: idleAssignment("A"),
      B: idleAssignment("B"),
    },
    blockers: [],
    history: [],
  };
  loaded.state.stage2 = stage2;
  const firstModule = stage2.moduleOrder[0];
  if (firstModule === undefined) {
    stage2.status = "BASELINE_READY";
  } else {
    assign(stage2.agents.A, "shadow", firstModule);
    stage2.modules[firstModule]!.status = "DESIGNING";
  }
  recordEvent(stage2, "STAGE2_INITIALIZED", firstModule);
  await saveProjectState(loaded.root, loaded.state);
  return refineLoaded(loaded);
}

export async function loadStage2(projectPath: string): Promise<LoadedStage2Project> {
  const loaded = await loadStage1(projectPath);
  if (loaded.state.stage2 === undefined) {
    throw new Error(`Stage2 is not initialized at ${loaded.root}`);
  }
  validateStage2State(loaded.state.stage2);
  return refineLoaded(loaded);
}

export function getReadyStage2Actions(state: Stage1ProjectState): Stage2NextAction[] {
  const stage2 = requireStage2(state);
  if (stage2.status === "BASELINE_READY") {
    return [{ kind: "baseline_complete" }];
  }
  const actions: Stage2NextAction[] = [];
  for (const moduleId of stage2.moduleOrder) {
    const module = requireModule(stage2, moduleId);
    if (module.status === "BLOCKED" || module.status === "NEEDS_REALIGN") {
      actions.push({ kind: "blocked", moduleId, blockers: [...module.blockers] });
    }
  }
  for (const slot of agentSlots()) {
    const assignment = stage2.agents[slot];
    if (assignment.moduleId === undefined || assignment.role === "idle") {
      continue;
    }
    const module = requireModule(stage2, assignment.moduleId);
    if (assignment.role === "shadow") {
      if (module.status === "DESIGNING") {
        actions.push({ kind: "shadow_design", moduleId: module.id, slot });
      } else if (module.status === "AWAITING_APPROVAL" && module.design?.approval === undefined) {
        const design = requireDesign(module);
        const issues = designClosureIssues(stage2, design.proposal);
        actions.push(issues.length > 0
          ? {
              kind: "design_revision",
              moduleId: module.id,
              slot,
              designPath: design.path,
              designSha256: design.documentSha256,
              issues,
            }
          : {
              kind: "design_approval",
              moduleId: module.id,
              slot,
              designPath: design.path,
              designSha256: design.documentSha256,
            });
      } else if (module.status === "AWAITING_APPROVAL" && module.design?.approval !== undefined) {
        actions.push({ kind: "waiting_for_rotation", moduleId: module.id, slot });
      }
    } else if (assignment.role === "active") {
      if (module.status === "IMPLEMENTING") {
        actions.push({ kind: "active_implementation", moduleId: module.id, slot });
      } else if (module.status === "VERIFYING") {
        actions.push({
          kind: "verification",
          moduleId: module.id,
          slot,
          mode: requireDesignApproval(module).verificationMode,
        });
      }
    }
  }
  return actions.sort((left, right) => actionPriority(left) - actionPriority(right));
}

export async function summarizeStage2(loaded: LoadedStage2Project): Promise<Stage2Summary> {
  const stage2 = loaded.state.stage2;
  const values = Object.values(stage2.modules);
  let effectiveStatus = stage2.status;
  const blockers = [...stage2.blockers];
  blockers.push(...values
    .filter((module) => ["BLOCKED", "NEEDS_REALIGN", "IMPLEMENTING"].includes(module.status))
    .flatMap((module) => module.blockers.map((item) => `${module.id}: ${item}`)));
  let readyActions = getReadyStage2Actions(loaded.state);
  try {
    await assertStage2AuthorityCurrent(loaded);
  } catch (error) {
    effectiveStatus = "BLOCKED";
    blockers.push(error instanceof Error ? error.message : String(error));
    readyActions = [];
  }
  const active = agentSlots().map((slot) => stage2.agents[slot]).find((item) => item.role === "active");
  const shadow = agentSlots().map((slot) => stage2.agents[slot]).find((item) => item.role === "shadow");
  return {
    projectName: loaded.state.project.name,
    status: effectiveStatus,
    revision: stage2.revision,
    stateEpoch: stage2.stateEpoch,
    complete: values.filter((module) => module.status === "COMPLETE").length,
    total: values.length,
    ...(active === undefined ? {} : { active: structuredClone(active) }),
    ...(shadow === undefined ? {} : { shadow: structuredClone(shadow) }),
    readyActions,
    blockers,
  };
}

export function buildStage2TaskEnvelope(
  loaded: LoadedStage2Project,
  assignment: Stage2AgentAssignment,
  task: Stage2AgentTask,
  skills: Stage2SkillReference[],
): Stage2TaskEnvelope {
  if (assignment.moduleId === undefined || assignment.role === "idle") {
    throw new Error(`Agent ${assignment.slot} has no Stage2 module assignment`);
  }
  const module = requireModule(loaded.state.stage2, assignment.moduleId);
  const design = module.design;
  const proposal = design?.proposal;
  const allowedPaths = task === "shadow_design"
    ? [`design/${module.id}.md`]
    : task === "active_implementation"
      ? [...(proposal?.implementation.sourcePaths ?? []), ...(proposal?.implementation.testPaths ?? [])]
      : [];
  const authority: Stage2TaskEnvelope["authority"] = {
    repositoryRules: "AGENTS.md",
    architectureHashes: { ...(loaded.state.stage1.approval?.documentHashes ?? {}) },
    ...(design === undefined
      ? {}
      : { designPath: design.path, designSha256: design.documentSha256 }),
  };
  return {
    schemaVersion: 1,
    task,
    project: {
      name: loaded.state.project.name,
      root: loaded.root,
    },
    module: structuredClone(module.architecture),
    assignment: {
      slot: assignment.slot,
      role: assignment.role,
      lease: assignment.lease,
      stateEpoch: loaded.state.stage2.stateEpoch,
    },
    authority,
    skills: skills.map((skill) => ({ ...skill })),
    allowedPaths,
    explicitExclusions: proposal?.explicitExclusions ?? loaded.state.stage1.intent.exclusions,
    ...(design?.approval === undefined
      ? {}
      : { verificationMode: design.approval.verificationMode }),
    nextPermittedAction: nextPermittedAction(task),
  };
}

export async function runShadowDesign(
  projectPath: string,
  moduleId?: string,
  instruction?: string,
  options: Stage2ExecutionOptions = {},
): Promise<Stage2AgentRunResult<Stage2DesignProposal>> {
  const loaded = await loadStage2(projectPath);
  await assertStage2AuthorityCurrent(loaded);
  const assignment = findAssignment(loaded.state.stage2, "shadow", moduleId);
  const module = requireModule(loaded.state.stage2, requireAssignmentModule(assignment));
  if (module.status !== "DESIGNING" && !(module.status === "AWAITING_APPROVAL" && module.design?.approval === undefined)) {
    throw new Error(`Module ${module.id} cannot run Shadow Design from ${module.status}`);
  }
  const snapshot = snapshotAssignment(loaded.state.stage2, assignment);
  const skillBundles = await loadStage2TaskSkills("shadow_design");
  const skills = skillReferences(skillBundles);
  const envelope = buildStage2TaskEnvelope(loaded, assignment, "shadow_design", skills);
  const runtimeRoot = await createStage2RunDirectory(loaded.root, module.id, "shadow_design");
  await writeTaskEnvelope(runtimeRoot, envelope);
  const executor = options.executor ?? defaultStage2AgentExecutor;
  const response = await executor({
    task: "shadow_design",
    projectRoot: loaded.root,
    runtimeRoot,
    prompt: buildShadowPrompt(envelope, module, instruction, renderSkillContext(skillBundles)),
    schema: designSchema(module.id),
    persistent: true,
    sandbox: "read-only",
    ...(assignment.threadId === undefined ? {} : { sessionId: assignment.threadId }),
  });
  await writeAgentResponse(runtimeRoot, response.output, response.events);
  const proposal = validateDesignProposal(response.output, module.id);
  const current = await assertAssignmentStillCurrent(projectPath, snapshot);
  const currentAssignment = current.state.stage2.agents[snapshot.slot];
  const currentModule = requireModule(current.state.stage2, module.id);
  const threadId = response.threadId ?? currentAssignment.threadId;
  if (threadId === undefined) {
    throw new Error(`Persistent Shadow Agent ${snapshot.slot} did not expose a thread id`);
  }
  await assertProposalReferencesExist(current.root, [
    ...proposal.architectureReferences,
    ...proposal.sourceReferences,
  ]);
  const revision = (currentModule.design?.revision ?? 0) + 1;
  const path = `design/${module.id}.md`;
  const content = renderDesignDocument(currentModule, proposal, revision, "待确认", skills);
  await atomicWriteText(resolveWithin(current.root, path), content);
  currentModule.design = {
    revision,
    draftedAt: now(options).toISOString(),
    path,
    documentSha256: sha256(content),
    runId: basename(runtimeRoot),
    threadId,
    skills,
    proposal,
  };
  currentModule.status = "AWAITING_APPROVAL";
  currentModule.blockers = designClosureIssues(current.state.stage2, proposal);
  currentAssignment.threadId = threadId;
  currentAssignment.observedEpoch = current.state.stage2.stateEpoch;
  currentAssignment.status = "waiting";
  recordEvent(current.state.stage2, "DESIGN_DRAFTED", module.id, `revision ${String(revision)}`, options);
  await saveStage2(current, options);
  return { loaded: current, output: proposal, runId: basename(runtimeRoot), threadId };
}

export async function approveModuleDesign(
  projectPath: string,
  moduleId: string,
  verificationMode: Stage2VerificationMode,
  options: Stage2ExecutionOptions = {},
): Promise<LoadedStage2Project> {
  if (verificationMode !== "independent_workers" && verificationMode !== "active_only") {
    throw new Error(`Unknown Stage2 verification mode: ${String(verificationMode)}`);
  }
  const loaded = await loadStage2(projectPath);
  await assertStage2AuthorityCurrent(loaded);
  const module = requireModule(loaded.state.stage2, moduleId);
  const design = requireDesign(module);
  if (module.status !== "AWAITING_APPROVAL" || design.approval !== undefined) {
    throw new Error(`Module ${moduleId} is not awaiting Design approval`);
  }
  await assertDesignCurrent(loaded.root, module);
  const closureIssues = designClosureIssues(loaded.state.stage2, design.proposal);
  if (closureIssues.length > 0) {
    throw new Error(`Module ${moduleId} Design is not closed: ${closureIssues.join("; ")}`);
  }
  const content = renderDesignDocument(
    module,
    design.proposal,
    design.revision,
    "已批准",
    design.skills,
    verificationMode,
  );
  await atomicWriteText(resolveWithin(loaded.root, design.path), content);
  design.documentSha256 = sha256(content);
  design.approval = {
    approvedAt: now(options).toISOString(),
    designRevision: design.revision,
    designSha256: design.documentSha256,
    architectureHashes: { ...(loaded.state.stage1.approval?.documentHashes ?? {}) },
    verificationMode,
  };
  module.blockers = [];
  recordEvent(
    loaded.state.stage2,
    "DESIGN_APPROVED",
    module.id,
    `verificationMode=${verificationMode}`,
    options,
  );
  applySharedInterfaceInvalidation(loaded.state.stage2, module, options);
  activateApprovedShadowIfPossible(loaded.state.stage2, options, module.id);
  await saveStage2(loaded, options);
  return loaded;
}

export async function runActiveImplementation(
  projectPath: string,
  moduleId?: string,
  options: Stage2ExecutionOptions = {},
): Promise<Stage2AgentRunResult<Stage2ImplementationProposal>> {
  const loaded = await loadStage2(projectPath);
  await assertStage2AuthorityCurrent(loaded);
  const assignment = findAssignment(loaded.state.stage2, "active", moduleId);
  const module = requireModule(loaded.state.stage2, requireAssignmentModule(assignment));
  if (module.status !== "IMPLEMENTING") {
    throw new Error(`Module ${module.id} cannot run Active Implementation from ${module.status}`);
  }
  const design = requireDesign(module);
  const approval = requireDesignApproval(module);
  await assertDesignCurrent(loaded.root, module);
  const snapshot = snapshotAssignment(loaded.state.stage2, assignment);
  const skillBundles = await loadStage2TaskSkills("active_implementation");
  const skills = skillReferences(skillBundles);
  const envelope = buildStage2TaskEnvelope(loaded, assignment, "active_implementation", skills);
  const runtimeRoot = await createStage2RunDirectory(loaded.root, module.id, "active_implementation");
  await writeTaskEnvelope(runtimeRoot, envelope);
  const executor = options.executor ?? defaultStage2AgentExecutor;
  const response = await executor({
    task: "active_implementation",
    projectRoot: loaded.root,
    runtimeRoot,
    prompt: buildImplementationPrompt(envelope, design.proposal, renderSkillContext(skillBundles)),
    schema: implementationSchema(module.id, approval.designSha256),
    persistent: true,
    sandbox: "read-only",
    ...(assignment.threadId === undefined ? {} : { sessionId: assignment.threadId }),
  });
  await writeAgentResponse(runtimeRoot, response.output, response.events);
  const proposal = validateImplementationProposal(response.output, module, approval.designSha256);
  const current = await assertAssignmentStillCurrent(projectPath, snapshot);
  const currentAssignment = current.state.stage2.agents[snapshot.slot];
  const currentModule = requireModule(current.state.stage2, module.id);
  await assertDesignCurrent(current.root, currentModule);
  const threadId = response.threadId ?? currentAssignment.threadId;
  if (threadId === undefined) {
    throw new Error(`Persistent Active Agent ${snapshot.slot} did not expose a thread id`);
  }
  currentAssignment.threadId = threadId;
  currentAssignment.observedEpoch = current.state.stage2.stateEpoch;
  if (proposal.designGap !== null) {
    reopenModuleInState(
      current.state.stage2,
      currentModule,
      currentAssignment,
      `${proposal.designGap.reason}; counterexample: ${proposal.designGap.counterexample}`,
      options,
    );
    const reopenedDesign = requireDesign(currentModule);
    const content = renderDesignDocument(
      currentModule,
      reopenedDesign.proposal,
      reopenedDesign.revision,
      "需修订",
      reopenedDesign.skills,
    );
    await atomicWriteText(resolveWithin(current.root, reopenedDesign.path), content);
    reopenedDesign.documentSha256 = sha256(content);
    await saveStage2(current, options);
    return { loaded: current, output: proposal, runId: basename(runtimeRoot), threadId };
  }

  const applied = await validateAndApplyImplementation(current.root, currentModule, proposal);
  const fileHashes = applied.fileHashes;
  const changedPaths = applied.changedPaths;
  currentModule.implementation = {
    appliedAt: now(options).toISOString(),
    designSha256: approval.designSha256,
    aggregateSha256: aggregateHashes(fileHashes),
    fileHashes,
    changedPaths,
    summary: proposal.summary,
    runId: basename(runtimeRoot),
    threadId,
    skills,
  };
  const commandRunner = options.commandRunner ?? runCommands;
  const primaryCommands = await commandRunner(design.proposal.acceptance.commands, current.root);
  const failed = requiredFailures(primaryCommands);
  currentModule.verification = {
    mode: approval.verificationMode,
    primaryRanAt: now(options).toISOString(),
    primaryCommands,
    independent: false,
    waivedByUser: approval.verificationMode === "active_only",
    documentPath: `verification/${module.id}.md`,
  };
  if (failed.length > 0) {
    currentModule.status = "IMPLEMENTING";
    currentModule.blockers = failed;
    currentAssignment.status = "blocked";
    recordEvent(current.state.stage2, "PRIMARY_VERIFICATION_FAILED", module.id, failed.join("; "), options);
  } else {
    currentModule.status = "VERIFYING";
    currentModule.blockers = [];
    currentAssignment.status = "waiting";
    recordEvent(current.state.stage2, "PRIMARY_VERIFIED", module.id, undefined, options);
  }
  await syncVerificationDocument(current.root, currentModule);
  await saveStage2(current, options);
  return { loaded: current, output: proposal, runId: basename(runtimeRoot), threadId };
}

export async function runModuleVerification(
  projectPath: string,
  moduleId?: string,
  options: Stage2ExecutionOptions = {},
): Promise<LoadedStage2Project> {
  const loaded = await loadStage2(projectPath);
  await assertStage2AuthorityCurrent(loaded);
  const assignment = findAssignment(loaded.state.stage2, "active", moduleId);
  const module = requireModule(loaded.state.stage2, requireAssignmentModule(assignment));
  if (module.status !== "VERIFYING") {
    throw new Error(`Module ${module.id} cannot run final verification from ${module.status}`);
  }
  const design = requireDesign(module);
  const approval = requireDesignApproval(module);
  const implementation = requireImplementation(module);
  await assertDesignCurrent(loaded.root, module);
  await assertImplementationCurrent(loaded.root, module);
  const snapshot = snapshotAssignment(loaded.state.stage2, assignment);
  const commandRunner = options.commandRunner ?? runCommands;
  const finalCommands = await commandRunner(design.proposal.acceptance.commands, loaded.root);
  const commandFailures = requiredFailures(finalCommands);
  if (commandFailures.length > 0) {
    module.status = "IMPLEMENTING";
    module.blockers = commandFailures;
    assignment.status = "blocked";
    const verification = requireVerification(module);
    verification.finalCommands = finalCommands;
    recordEvent(loaded.state.stage2, "FINAL_COMMANDS_FAILED", module.id, commandFailures.join("; "), options);
    await syncVerificationDocument(loaded.root, module);
    await saveStage2(loaded, options);
    return loaded;
  }

  const executor = options.executor ?? defaultStage2AgentExecutor;
  const staticRuntime = await createStage2RunDirectory(
    loaded.root,
    module.id,
    approval.verificationMode === "active_only" ? "active_static_review" : "independent_static_review",
  );
  const verificationRuntime = await createStage2RunDirectory(
    loaded.root,
    module.id,
    approval.verificationMode === "active_only"
      ? "active_verification_review"
      : "independent_verification",
  );
  const staticTask: Stage2AgentTask = approval.verificationMode === "active_only"
    ? "active_static_review"
    : "independent_static_review";
  const verificationTask: Stage2AgentTask = approval.verificationMode === "active_only"
    ? "active_verification_review"
    : "independent_verification";
  const [staticSkillBundles, verificationSkillBundles] = await Promise.all([
    loadStage2TaskSkills(staticTask),
    loadStage2TaskSkills(verificationTask),
  ]);
  const staticSkills = skillReferences(staticSkillBundles);
  const verificationSkills = skillReferences(verificationSkillBundles);
  const staticEnvelope = buildStage2TaskEnvelope(loaded, assignment, staticTask, staticSkills);
  const verificationEnvelope = buildStage2TaskEnvelope(loaded, assignment, verificationTask, verificationSkills);
  await Promise.all([
    writeTaskEnvelope(staticRuntime, staticEnvelope),
    writeTaskEnvelope(verificationRuntime, verificationEnvelope),
  ]);

  let staticResponse;
  let verificationResponse;
  let verificationInputGuard: { root: string; snapshot: Record<string, string> } | undefined;
  if (approval.verificationMode === "active_only") {
    staticResponse = await executor({
      task: staticTask,
      projectRoot: loaded.root,
      runtimeRoot: staticRuntime,
      prompt: buildReviewPrompt(
        staticEnvelope,
        module,
        "static",
        [],
        renderSkillContext(staticSkillBundles),
      ),
      schema: reviewSchema(module.id, approval.designSha256, implementation.aggregateSha256, "static"),
      persistent: true,
      sandbox: "read-only",
      ...(assignment.threadId === undefined ? {} : { sessionId: assignment.threadId }),
    });
    verificationResponse = await executor({
      task: verificationTask,
      projectRoot: loaded.root,
      runtimeRoot: verificationRuntime,
      prompt: buildReviewPrompt(
        verificationEnvelope,
        module,
        "verification",
        finalCommands,
        renderSkillContext(verificationSkillBundles),
      ),
      schema: reviewSchema(
        module.id,
        approval.designSha256,
        implementation.aggregateSha256,
        "verification",
      ),
      persistent: true,
      sandbox: "read-only",
      ...(assignment.threadId === undefined ? {} : { sessionId: assignment.threadId }),
    });
  } else {
    const verificationWorkspace = await createVerificationWorkspace(loaded.root, verificationRuntime);
    verificationInputGuard = {
      root: verificationWorkspace,
      snapshot: await snapshotVerificationInputs(verificationWorkspace),
    };
    [staticResponse, verificationResponse] = await Promise.all([
      executor({
        task: staticTask,
        projectRoot: loaded.root,
        runtimeRoot: staticRuntime,
        prompt: buildReviewPrompt(
          staticEnvelope,
          module,
          "static",
          [],
          renderSkillContext(staticSkillBundles),
        ),
        schema: reviewSchema(module.id, approval.designSha256, implementation.aggregateSha256, "static"),
        persistent: false,
        sandbox: "read-only",
      }),
      executor({
        task: verificationTask,
        projectRoot: verificationWorkspace,
        runtimeRoot: verificationRuntime,
        prompt: buildIndependentVerificationPrompt(
          verificationEnvelope,
          module,
          design.proposal.acceptance.commands,
          verificationWorkspace,
          renderSkillContext(verificationSkillBundles),
        ),
        schema: reviewSchema(
          module.id,
          approval.designSha256,
          implementation.aggregateSha256,
          "verification",
        ),
        persistent: false,
        sandbox: "workspace-write",
      }),
    ]);
  }
  await Promise.all([
    writeAgentResponse(staticRuntime, staticResponse.output, staticResponse.events),
    writeAgentResponse(verificationRuntime, verificationResponse.output, verificationResponse.events),
  ]);
  if (verificationInputGuard !== undefined) {
    await assertVerificationInputsUnchanged(verificationInputGuard.root, verificationInputGuard.snapshot);
  }
  const staticReport = validateReviewReport(
    staticResponse.output,
    module,
    "static",
    approval.designSha256,
    implementation.aggregateSha256,
  );
  const verificationReport = validateReviewReport(
    verificationResponse.output,
    module,
    "verification",
    approval.designSha256,
    implementation.aggregateSha256,
  );
  if (approval.verificationMode === "independent_workers") {
    assertIndependentCommandEvidence(design.proposal.acceptance.commands, verificationReport.commandResults);
  } else {
    assertSameCommandEvidence(finalCommands, verificationReport.commandResults);
  }

  const current = await assertAssignmentStillCurrent(projectPath, snapshot);
  const currentModule = requireModule(current.state.stage2, module.id);
  await assertDesignCurrent(current.root, currentModule);
  await assertImplementationCurrent(current.root, currentModule);
  const currentAssignment = current.state.stage2.agents[snapshot.slot];
  const persistentThreadId = verificationResponse.threadId
    ?? staticResponse.threadId
    ?? currentAssignment.threadId;
  if (approval.verificationMode === "active_only" && persistentThreadId === undefined) {
    throw new Error(`Persistent Active Agent ${snapshot.slot} did not expose a thread id`);
  }
  if (persistentThreadId !== undefined && approval.verificationMode === "active_only") {
    currentAssignment.threadId = persistentThreadId;
  }
  currentAssignment.observedEpoch = current.state.stage2.stateEpoch;
  const verification = requireVerification(currentModule);
  verification.finalCommands = finalCommands;
  verification.staticReview = workerEvidence(
    staticTask,
    staticRuntime,
    approval.verificationMode === "active_only" ? "active" : "worker",
    staticResponse.threadId ?? (approval.verificationMode === "active_only" ? currentAssignment.threadId : undefined),
    staticSkills,
    staticReport,
    options,
  );
  verification.verificationReview = workerEvidence(
    verificationTask,
    verificationRuntime,
    approval.verificationMode === "active_only" ? "active" : "worker",
    verificationResponse.threadId
      ?? (approval.verificationMode === "active_only" ? currentAssignment.threadId : undefined),
    verificationSkills,
    verificationReport,
    options,
  );
  verification.independent = approval.verificationMode === "independent_workers";
  verification.waivedByUser = approval.verificationMode === "active_only";
  const reviewFailures = reportFailures(staticReport, verificationReport);
  if (reviewFailures.length > 0) {
    currentModule.status = "IMPLEMENTING";
    currentModule.blockers = reviewFailures;
    currentAssignment.status = "blocked";
    recordEvent(current.state.stage2, "VERIFICATION_REVIEW_FAILED", module.id, reviewFailures.join("; "), options);
  } else {
    currentModule.status = "COMPLETE";
    currentModule.blockers = [];
    currentAssignment.status = "idle";
    verification.completedAt = now(options).toISOString();
    recordEvent(current.state.stage2, "MODULE_COMPLETE", module.id, undefined, options);
    releaseAssignment(currentAssignment);
    activateApprovedShadowIfPossible(current.state.stage2, options);
    if (Object.values(current.state.stage2.modules).every((item) => item.status === "COMPLETE")) {
      current.state.stage2.status = "BASELINE_READY";
      recordEvent(current.state.stage2, "BASELINE_READY", undefined, undefined, options);
    }
  }
  await syncVerificationDocument(current.root, currentModule);
  await saveStage2(current, options);
  return current;
}

export async function reopenModuleDesign(
  projectPath: string,
  moduleId: string,
  reason: string,
  options: Stage2ExecutionOptions = {},
): Promise<LoadedStage2Project> {
  if (reason.trim() === "") {
    throw new Error("Design reopen reason is required");
  }
  const loaded = await loadStage2(projectPath);
  await assertStage2AuthorityCurrent(loaded);
  const module = requireModule(loaded.state.stage2, moduleId);
  const design = requireDesign(module);
  if (design.approval === undefined) {
    throw new Error(`Module ${moduleId} Design is not approved`);
  }
  let assignment = agentSlots()
    .map((slot) => loaded.state.stage2.agents[slot])
    .find((item) => item.moduleId === moduleId);
  if (assignment === undefined) {
    assignment = agentSlots()
      .map((slot) => loaded.state.stage2.agents[slot])
      .find((item) => item.role === "idle");
    if (assignment === undefined) {
      throw new Error(`No Agent slot is available to reopen ${moduleId}`);
    }
    assign(assignment, "shadow", moduleId);
  }
  reopenModuleInState(loaded.state.stage2, module, assignment, reason, options);
  const content = renderDesignDocument(module, design.proposal, design.revision, "需修订", design.skills);
  await atomicWriteText(resolveWithin(loaded.root, design.path), content);
  design.documentSha256 = sha256(content);
  await saveStage2(loaded, options);
  return loaded;
}

function refineLoaded(loaded: LoadedProject): LoadedStage2Project {
  if (loaded.state.stage2 === undefined) {
    throw new Error("Stage2 state is missing");
  }
  return loaded as LoadedStage2Project;
}

function requireStage2(state: Stage1ProjectState): Stage2ProjectStage {
  if (state.stage2 === undefined) {
    throw new Error("Stage2 is not initialized");
  }
  return state.stage2;
}

function validateStage2State(stage2: Stage2ProjectStage): void {
  if (
    stage2.schemaVersion !== 1
    || !Array.isArray(stage2.moduleOrder)
    || stage2.agents?.A === undefined
    || stage2.agents.B === undefined
  ) {
    throw new Error("Invalid Stage2 state");
  }
  for (const moduleId of stage2.moduleOrder) {
    if (stage2.modules[moduleId] === undefined) {
      throw new Error(`Stage2 state is missing module ${moduleId}`);
    }
  }
}

function idleAssignment(slot: Stage2AgentSlot): Stage2AgentAssignment {
  return {
    slot,
    role: "idle",
    status: "idle",
    lease: randomUUID(),
    observedEpoch: 0,
  };
}

function assign(
  assignment: Stage2AgentAssignment,
  role: Exclude<Stage2AgentAssignment["role"], "idle">,
  moduleId: string,
): void {
  assignment.role = role;
  assignment.moduleId = moduleId;
  assignment.status = "assigned";
  assignment.lease = randomUUID();
}

function releaseAssignment(assignment: Stage2AgentAssignment): void {
  assignment.role = "idle";
  assignment.status = "idle";
  assignment.lease = randomUUID();
  delete assignment.moduleId;
}

function activateApprovedShadowIfPossible(
  stage2: Stage2ProjectStage,
  options: Stage2ExecutionOptions,
  preferredModuleId?: string,
): void {
  const hasActive = agentSlots().some((slot) => stage2.agents[slot].role === "active");
  if (hasActive) {
    return;
  }
  const eligible = agentSlots()
    .map((slot) => stage2.agents[slot])
    .filter((assignment) => {
      if (assignment.role !== "shadow" || assignment.moduleId === undefined) {
        return false;
      }
      const module = requireModule(stage2, assignment.moduleId);
      return module.status === "AWAITING_APPROVAL" && module.design?.approval !== undefined;
    });
  const shadow = eligible.find((assignment) => assignment.moduleId === preferredModuleId) ?? eligible[0];
  if (shadow === undefined || shadow.moduleId === undefined) {
    return;
  }
  const activeModule = requireModule(stage2, shadow.moduleId);
  assign(shadow, "active", activeModule.id);
  activeModule.status = "IMPLEMENTING";
  const idle = agentSlots()
    .map((slot) => stage2.agents[slot])
    .find((assignment) => assignment.role === "idle");
  if (idle !== undefined) {
    const next = stage2.moduleOrder
      .map((id) => requireModule(stage2, id))
      .find((module) => module.status === "PENDING");
    if (next !== undefined) {
      assign(idle, "shadow", next.id);
      next.status = "DESIGNING";
    }
  }
  stage2.stateEpoch += 1;
  recordEvent(stage2, "AGENT_ROLES_ROTATED", activeModule.id, undefined, options);
}

function applySharedInterfaceInvalidation(
  stage2: Stage2ProjectStage,
  source: Stage2ModuleState,
  options: Stage2ExecutionOptions,
): void {
  const proposal = requireDesign(source).proposal;
  if (proposal.sharedInterfaceChanges.length === 0) {
    return;
  }
  for (const affectedId of proposal.affectedModules) {
    if (affectedId === source.id) {
      continue;
    }
    const affected = stage2.modules[affectedId];
    if (affected === undefined || ["PENDING", "DESIGNING", "AWAITING_APPROVAL"].includes(affected.status)) {
      continue;
    }
    affected.status = "NEEDS_REALIGN";
    affected.blockers = [`Shared interface changed in ${source.id}: ${proposal.sharedInterfaceChanges.join("; ")}`];
    recordEvent(stage2, "MODULE_NEEDS_REALIGN", affected.id, source.id, options);
  }
}

function findAssignment(
  stage2: Stage2ProjectStage,
  role: "shadow" | "active",
  moduleId?: string,
): Stage2AgentAssignment {
  const matches = agentSlots()
    .map((slot) => stage2.agents[slot])
    .filter((assignment) => assignment.role === role && (moduleId === undefined || assignment.moduleId === moduleId));
  if (matches.length !== 1) {
    const target = moduleId === undefined ? "current module" : moduleId;
    throw new Error(`Expected one ${role} assignment for ${target}, found ${String(matches.length)}`);
  }
  return matches[0]!;
}

function requireAssignmentModule(assignment: Stage2AgentAssignment): string {
  if (assignment.moduleId === undefined) {
    throw new Error(`Agent ${assignment.slot} has no module assignment`);
  }
  return assignment.moduleId;
}

function snapshotAssignment(
  stage2: Stage2ProjectStage,
  assignment: Stage2AgentAssignment,
): AssignmentSnapshot {
  const moduleId = requireAssignmentModule(assignment);
  const module = requireModule(stage2, moduleId);
  return {
    slot: assignment.slot,
    role: assignment.role,
    assignmentStatus: assignment.status,
    moduleId,
    moduleStatus: module.status,
    ...(module.design === undefined ? {} : { designRevision: module.design.revision }),
    ...(module.implementation === undefined
      ? {}
      : { implementationAggregateSha256: module.implementation.aggregateSha256 }),
    lease: assignment.lease,
    stateEpoch: stage2.stateEpoch,
    ...(assignment.threadId === undefined ? {} : { threadId: assignment.threadId }),
  };
}

async function assertAssignmentStillCurrent(
  projectPath: string,
  snapshot: AssignmentSnapshot,
): Promise<LoadedStage2Project> {
  const loaded = await loadStage2(projectPath);
  const current = loaded.state.stage2.agents[snapshot.slot];
  const module = requireModule(loaded.state.stage2, snapshot.moduleId);
  if (
    current.role !== snapshot.role
    || current.status !== snapshot.assignmentStatus
    || current.moduleId !== snapshot.moduleId
    || module.status !== snapshot.moduleStatus
    || module.design?.revision !== snapshot.designRevision
    || module.implementation?.aggregateSha256 !== snapshot.implementationAggregateSha256
    || current.lease !== snapshot.lease
    || loaded.state.stage2.stateEpoch !== snapshot.stateEpoch
  ) {
    throw new Error(
      `Stale Stage2 Agent result for slot ${snapshot.slot}; assignment, lease, or state epoch changed`,
    );
  }
  return loaded;
}

async function assertStage2AuthorityCurrent(loaded: LoadedStage2Project): Promise<void> {
  if (loaded.state.stage1.status !== "STAGE1_COMPLETE") {
    throw new Error(`Stage2 is blocked because Stage1 is ${loaded.state.stage1.status}`);
  }
  await assertApprovalCurrent(loaded.root, loaded.state);
}

async function assertDesignCurrent(root: string, module: Stage2ModuleState): Promise<void> {
  const design = requireDesign(module);
  const path = resolveWithin(root, design.path);
  if (!(await pathExists(path))) {
    throw new Error(`Approved Design is missing: ${design.path}`);
  }
  const current = sha256(await readText(path));
  if (current !== design.documentSha256) {
    throw new Error(`Design changed outside Harness: ${design.path}`);
  }
  if (design.approval !== undefined && current !== design.approval.designSha256) {
    throw new Error(`Approved Design hash is stale: ${design.path}`);
  }
}

async function assertImplementationCurrent(root: string, module: Stage2ModuleState): Promise<void> {
  const implementation = requireImplementation(module);
  const current: Record<string, string> = {};
  for (const [path, expected] of Object.entries(implementation.fileHashes)) {
    const absolute = resolveWithin(root, path);
    if (!(await pathExists(absolute))) {
      throw new Error(`Implementation file is missing: ${path}`);
    }
    current[path] = sha256(await readText(absolute));
    if (current[path] !== expected) {
      throw new Error(`Implementation changed after verification: ${path}`);
    }
  }
  if (aggregateHashes(current) !== implementation.aggregateSha256) {
    throw new Error(`Implementation aggregate changed for ${module.id}`);
  }
}

async function validateAndApplyImplementation(
  root: string,
  module: Stage2ModuleState,
  proposal: Stage2ImplementationProposal,
): Promise<{ fileHashes: Record<string, string>; changedPaths: string[] }> {
  const design = requireDesign(module).proposal;
  const allowedSource = new Set(design.implementation.sourcePaths);
  const allowedTest = new Set(design.implementation.testPaths);
  if (proposal.files.length === 0) {
    throw new Error(`Implementation proposal for ${module.id} contains no files`);
  }
  const seen = new Set<string>();
  for (const file of proposal.files) {
    assertSafeRelativePath(file.path);
    if (seen.has(file.path)) {
      throw new Error(`Implementation proposal repeats path ${file.path}`);
    }
    seen.add(file.path);
    const allowed = file.kind === "source" ? allowedSource : allowedTest;
    if (!allowed.has(file.path)) {
      throw new Error(`Implementation proposal exceeds allowed ${file.kind} paths: ${file.path}`);
    }
    const absolute = resolveWithin(root, file.path);
    const currentHash = await pathExists(absolute) ? sha256(await readText(absolute)) : null;
    if (currentHash !== file.baseSha256) {
      throw new Error(`Implementation base changed for ${file.path}`);
    }
  }
  for (const path of [...design.implementation.sourcePaths, ...design.implementation.testPaths]) {
    if (!seen.has(path) && !(await pathExists(resolveWithin(root, path)))) {
      throw new Error(`Implementation proposal omitted missing approved path: ${path}`);
    }
  }
  for (const file of proposal.files) {
    const content = ensureFinalNewline(file.content);
    await atomicWriteText(resolveWithin(root, file.path), content);
  }
  const fileHashes: Record<string, string> = {};
  for (const path of [...design.implementation.sourcePaths, ...design.implementation.testPaths]) {
    const absolute = resolveWithin(root, path);
    if (!(await pathExists(absolute))) {
      throw new Error(`Approved implementation path is missing after apply: ${path}`);
    }
    fileHashes[path] = sha256(await readText(absolute));
  }
  return { fileHashes, changedPaths: [...seen].sort((left, right) => left.localeCompare(right)) };
}

function reopenModuleInState(
  stage2: Stage2ProjectStage,
  module: Stage2ModuleState,
  assignment: Stage2AgentAssignment,
  reason: string,
  options: Stage2ExecutionOptions,
): void {
  const design = requireDesign(module);
  module.reopened.push({
    at: now(options).toISOString(),
    reason,
    ...(design.approval === undefined ? {} : { previousDesignSha256: design.approval.designSha256 }),
  });
  delete design.approval;
  delete module.implementation;
  delete module.verification;
  module.status = "DESIGNING";
  module.blockers = [reason];
  assign(assignment, "shadow", module.id);
  stage2.stateEpoch += 1;
  recordEvent(stage2, "DESIGN_REOPENED", module.id, reason, options);
}

function requireModule(stage2: Stage2ProjectStage, moduleId: string): Stage2ModuleState {
  const module = stage2.modules[moduleId];
  if (module === undefined) {
    throw new Error(`Unknown Stage2 module: ${moduleId}`);
  }
  return module;
}

function requireDesign(module: Stage2ModuleState): NonNullable<Stage2ModuleState["design"]> {
  if (module.design === undefined) {
    throw new Error(`Module ${module.id} has no Design`);
  }
  return module.design;
}

function requireDesignApproval(
  module: Stage2ModuleState,
): NonNullable<NonNullable<Stage2ModuleState["design"]>["approval"]> {
  const approval = requireDesign(module).approval;
  if (approval === undefined) {
    throw new Error(`Module ${module.id} Design is not approved`);
  }
  return approval;
}

function requireImplementation(
  module: Stage2ModuleState,
): NonNullable<Stage2ModuleState["implementation"]> {
  if (module.implementation === undefined) {
    throw new Error(`Module ${module.id} has no implementation record`);
  }
  return module.implementation;
}

function requireVerification(
  module: Stage2ModuleState,
): NonNullable<Stage2ModuleState["verification"]> {
  if (module.verification === undefined) {
    throw new Error(`Module ${module.id} has no verification record`);
  }
  return module.verification;
}

function designClosureIssues(
  stage2: Stage2ProjectStage,
  proposal: Stage2DesignProposal,
): string[] {
  const issues = proposal.openQuestions.map((item) => `Open design question: ${item}`);
  const requiredArrays: Array<[string, string[]]> = [
    ["architectureReferences", proposal.architectureReferences],
    ["interfaces", proposal.interfaces],
    ["cycleBehavior", proposal.cycleBehavior],
    ["exceptionalBehavior", proposal.exceptionalBehavior],
    ["invariants", proposal.invariants],
    ["implementation.sourcePaths", proposal.implementation.sourcePaths],
    ["implementation.testPaths", proposal.implementation.testPaths],
    ["acceptance.assertions", proposal.acceptance.assertions],
    ["acceptance.directedTests", proposal.acceptance.directedTests],
    ["acceptance.expectedResults", proposal.acceptance.expectedResults],
  ];
  for (const [label, values] of requiredArrays) {
    if (values.length === 0) {
      issues.push(`${label} is empty`);
    }
  }
  if (!proposal.acceptance.commands.some((command) => command.required)) {
    issues.push("No required verification command");
  }
  if (proposal.sharedInterfaceChanges.length > 0 && proposal.affectedModules.length === 0) {
    issues.push("Shared interface changes have no affectedModules");
  }
  for (const moduleId of proposal.affectedModules) {
    if (stage2.modules[moduleId] === undefined) {
      issues.push(`Unknown affected module: ${moduleId}`);
    }
  }
  const ownedPaths = new Map<string, { moduleId: string; path: string }>();
  for (const module of Object.values(stage2.modules)) {
    if (module.id === proposal.moduleId || module.design === undefined) {
      continue;
    }
    for (const path of [
      ...module.design.proposal.implementation.sourcePaths,
      ...module.design.proposal.implementation.testPaths,
    ]) {
      ownedPaths.set(portablePathKey(path), { moduleId: module.id, path });
    }
  }
  for (const path of [
    ...proposal.implementation.sourcePaths,
    ...proposal.implementation.testPaths,
  ]) {
    const owner = ownedPaths.get(portablePathKey(path));
    if (owner !== undefined) {
      issues.push(
        `Implementation path ${path} is already owned by module ${owner.moduleId}: ${owner.path}`,
      );
    }
  }
  return issues;
}

function portablePathKey(path: string): string {
  return posix.normalize(path.replace(/\\/gu, "/")).toLowerCase();
}

function recordEvent(
  stage2: Stage2ProjectStage,
  event: string,
  moduleId?: string,
  detail?: string,
  options: Stage2ExecutionOptions = {},
): void {
  stage2.revision += 1;
  stage2.updatedAt = now(options).toISOString();
  stage2.history.push({
    at: stage2.updatedAt,
    revision: stage2.revision,
    stateEpoch: stage2.stateEpoch,
    event,
    ...(moduleId === undefined ? {} : { moduleId }),
    ...(detail === undefined ? {} : { detail }),
  });
}

async function saveStage2(
  loaded: LoadedStage2Project,
  options: Stage2ExecutionOptions,
): Promise<void> {
  loaded.state.stage2.updatedAt = now(options).toISOString();
  await saveProjectState(loaded.root, loaded.state);
}

function now(options: Stage2ExecutionOptions): Date {
  return options.now?.() ?? new Date();
}

function agentSlots(): Stage2AgentSlot[] {
  return ["A", "B"];
}

function actionPriority(action: Stage2NextAction): number {
  switch (action.kind) {
    case "design_revision":
      return 0;
    case "design_approval":
      return 1;
    case "verification":
      return 2;
    case "active_implementation":
      return 3;
    case "shadow_design":
      return 4;
    case "waiting_for_rotation":
      return 5;
    case "blocked":
      return 6;
    case "baseline_complete":
      return 7;
  }
}

function nextPermittedAction(task: Stage2AgentTask): string {
  switch (task) {
    case "shadow_design":
      return "提交 Design 提案并等待用户批准";
    case "active_implementation":
      return "提交受允许路径约束的源码与测试提案";
    case "active_static_review":
    case "independent_static_review":
      return "提交静态审查报告";
    case "active_verification_review":
    case "independent_verification":
      return "提交验证报告";
  }
}

async function writeTaskEnvelope(runtimeRoot: string, envelope: Stage2TaskEnvelope): Promise<void> {
  await atomicWriteText(
    resolveWithinRuntime(runtimeRoot, "task-envelope.json"),
    `${JSON.stringify(envelope, null, 2)}\n`,
  );
}

async function writeAgentResponse(runtimeRoot: string, output: unknown, events: string): Promise<void> {
  const resultPath = resolveWithinRuntime(runtimeRoot, "result.json");
  const eventsPath = resolveWithinRuntime(runtimeRoot, "codex.jsonl");
  const writes: Array<Promise<void>> = [];
  if (!(await pathExists(resultPath))) {
    writes.push(atomicWriteText(resultPath, `${JSON.stringify(output, null, 2)}\n`));
  }
  if (events !== "" && !(await pathExists(eventsPath))) {
    writes.push(atomicWriteText(eventsPath, events));
  }
  await Promise.all(writes);
}

function resolveWithinRuntime(runtimeRoot: string, path: string): string {
  return resolveWithin(runtimeRoot, path);
}

async function assertProposalReferencesExist(root: string, paths: string[]): Promise<void> {
  for (const path of paths) {
    assertSafeRelativePath(path);
    if (!(await pathExists(resolveWithin(root, path)))) {
      throw new Error(`Design references missing authority: ${path}`);
    }
  }
}

function validateDesignProposal(value: unknown, moduleId: string): Stage2DesignProposal {
  const record = objectValue(value, "Stage2 Design proposal");
  if (record.schemaVersion !== 1 || record.moduleId !== moduleId) {
    throw new Error(`Stage2 Design proposal does not target ${moduleId}`);
  }
  const proposal = value as Stage2DesignProposal;
  requireText(proposal.summary, "Design summary");
  for (const [label, items] of [
    ["architectureReferences", proposal.architectureReferences],
    ["sourceReferences", proposal.sourceReferences],
    ["explicitExclusions", proposal.explicitExclusions],
    ["interfaces", proposal.interfaces],
    ["cycleBehavior", proposal.cycleBehavior],
    ["exceptionalBehavior", proposal.exceptionalBehavior],
    ["invariants", proposal.invariants],
    ["sharedInterfaceChanges", proposal.sharedInterfaceChanges],
    ["affectedModules", proposal.affectedModules],
    ["risks", proposal.risks],
    ["openQuestions", proposal.openQuestions],
  ] as const) {
    requireStringArray(items, label);
  }
  if (!Array.isArray(proposal.fields) || !Array.isArray(proposal.events)) {
    throw new Error("Design fields and events must be arrays");
  }
  for (const field of proposal.fields) {
    requireText(field.name, "Design field name");
    requireText(field.semantics, `Design field ${field.name} semantics`);
    requireText(field.producer, `Design field ${field.name} producer`);
    requireText(field.storage, `Design field ${field.name} storage`);
    requireStringArray(field.consumers, `Design field ${field.name} consumers`);
    requireText(field.lifetime, `Design field ${field.name} lifetime`);
  }
  for (const event of proposal.events) {
    requireText(event.name, "Design event name");
    requireText(event.condition, `Design event ${event.name} condition`);
    requireStringArray(event.effects, `Design event ${event.name} effects`);
    requireText(event.priority, `Design event ${event.name} priority`);
  }
  requireStringArray(proposal.implementation?.sourcePaths, "implementation.sourcePaths");
  requireStringArray(proposal.implementation?.testPaths, "implementation.testPaths");
  for (const path of proposal.implementation.sourcePaths) {
    assertSafeRelativePath(path);
    if (!path.replace(/\\/gu, "/").startsWith("src/main/")) {
      throw new Error(`Stage2 source path must be under src/main: ${path}`);
    }
  }
  for (const path of proposal.implementation.testPaths) {
    assertSafeRelativePath(path);
    if (!path.replace(/\\/gu, "/").startsWith("src/test/")) {
      throw new Error(`Stage2 test path must be under src/test: ${path}`);
    }
  }
  const allPaths = [...proposal.implementation.sourcePaths, ...proposal.implementation.testPaths];
  if (new Set(allPaths.map(portablePathKey)).size !== allPaths.length) {
    throw new Error("Stage2 Design implementation paths must be unique");
  }
  requireStringArray(proposal.acceptance?.assertions, "acceptance.assertions");
  requireStringArray(proposal.acceptance?.directedTests, "acceptance.directedTests");
  requireStringArray(proposal.acceptance?.expectedResults, "acceptance.expectedResults");
  if (!Array.isArray(proposal.acceptance?.commands)) {
    throw new Error("Stage2 Design verification commands must be an array");
  }
  proposal.acceptance.commands.forEach(validateCommandSpec);
  const commandIds = proposal.acceptance.commands.map((command) => command.id);
  if (new Set(commandIds).size !== commandIds.length) {
    throw new Error("Stage2 Design verification command ids must be unique");
  }
  return structuredClone(proposal);
}

function validateImplementationProposal(
  value: unknown,
  module: Stage2ModuleState,
  designSha256: string,
): Stage2ImplementationProposal {
  const record = objectValue(value, "Stage2 implementation proposal");
  if (
    record.schemaVersion !== 1
    || record.moduleId !== module.id
    || record.designSha256 !== designSha256
  ) {
    throw new Error(`Stage2 implementation proposal does not match ${module.id} Design`);
  }
  const proposal = value as Stage2ImplementationProposal;
  requireText(proposal.summary, "Implementation summary");
  requireStringArray(proposal.notes, "Implementation notes");
  if (!Array.isArray(proposal.files)) {
    throw new Error("Implementation files must be an array");
  }
  for (const file of proposal.files) {
    requireText(file.path, "Implementation file path");
    if (file.kind !== "source" && file.kind !== "test") {
      throw new Error(`Invalid implementation file kind for ${file.path}`);
    }
    if (file.baseSha256 !== null && !/^[a-f0-9]{64}$/u.test(file.baseSha256)) {
      throw new Error(`Invalid baseSha256 for ${file.path}`);
    }
    if (typeof file.content !== "string") {
      throw new Error(`Implementation file ${file.path} has no content`);
    }
    requireText(file.purpose, `Implementation file ${file.path} purpose`);
  }
  if (proposal.designGap !== null) {
    requireText(proposal.designGap.reason, "Design gap reason");
    requireText(proposal.designGap.counterexample, "Design gap counterexample");
    if (proposal.files.length > 0) {
      throw new Error("An implementation proposal with a Design gap cannot include file writes");
    }
  }
  return structuredClone(proposal);
}

function validateReviewReport(
  value: unknown,
  module: Stage2ModuleState,
  kind: Stage2ReviewReport["kind"],
  designSha256: string,
  implementationSha256: string,
): Stage2ReviewReport {
  const record = objectValue(value, "Stage2 review report");
  if (
    record.schemaVersion !== 1
    || record.kind !== kind
    || record.moduleId !== module.id
    || record.designSha256 !== designSha256
    || record.implementationAggregateSha256 !== implementationSha256
  ) {
    throw new Error(`Stage2 ${kind} report does not match ${module.id}`);
  }
  const report = value as Stage2ReviewReport;
  if (report.verdict !== "pass" && report.verdict !== "fail") {
    throw new Error(`Invalid ${kind} verdict`);
  }
  requireText(report.summary, `${kind} summary`);
  if (!Array.isArray(report.findings) || !Array.isArray(report.commandResults)) {
    throw new Error(`${kind} report is incomplete`);
  }
  for (const finding of report.findings) {
    if (!["error", "warning", "note"].includes(finding.severity)) {
      throw new Error(`Invalid finding severity in ${kind} report`);
    }
    requireText(finding.code, "Review finding code");
    requireText(finding.message, `Review finding ${finding.code} message`);
    requireText(finding.artifact, `Review finding ${finding.code} artifact`);
    requireText(finding.requiredAction, `Review finding ${finding.code} required action`);
  }
  if (report.verdict === "pass" && report.findings.some((finding) => finding.severity === "error")) {
    throw new Error(`${kind} report passed with error findings`);
  }
  report.commandResults.forEach(validateCommandResult);
  if (kind === "static" && report.commandResults.length > 0) {
    throw new Error("Static review report must not contain command results");
  }
  if (
    kind === "verification"
    && report.verdict === "pass"
    && report.commandResults.some((result) => result.required && !result.ok)
  ) {
    throw new Error("Verification report passed while a required command failed");
  }
  return structuredClone(report);
}

function validateCommandSpec(value: CommandSpec): void {
  requireText(value.id, "Command id");
  requireText(value.description, `Command ${value.id} description`);
  if (value.runner !== "host" && value.runner !== "wsl") {
    throw new Error(`Invalid runner for ${value.id}`);
  }
  if (typeof value.required !== "boolean") {
    throw new Error(`Command ${value.id} required must be boolean`);
  }
  if (value.runner === "host") {
    requireText(value.command, `Command ${value.id} command`);
  } else {
    requireText(value.script, `Command ${value.id} script`);
  }
}

function validateCommandResult(value: CommandResult): void {
  requireText(value.id, "Command result id");
  requireText(value.description, `Command result ${value.id} description`);
  requireText(value.command, `Command result ${value.id} command`);
  requireText(value.checkedAt, `Command result ${value.id} checkedAt`);
  if (value.runner !== "host" && value.runner !== "wsl") {
    throw new Error(`Invalid command result runner for ${value.id}`);
  }
  if (typeof value.ok !== "boolean" || typeof value.required !== "boolean") {
    throw new Error(`Invalid command result booleans for ${value.id}`);
  }
}

function requireText(value: unknown, label: string): asserts value is string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${label} is required`);
  }
}

function requireStringArray(
  value: unknown,
  label: string,
  nonempty = false,
): asserts value is string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string" || item.trim() === "")) {
    throw new Error(`${label} must be a string array`);
  }
  if (nonempty && value.length === 0) {
    throw new Error(`${label} cannot be empty`);
  }
}

function objectValue(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function workerEvidence(
  task: Stage2AgentTask,
  runtimeRoot: string,
  performedBy: Stage2WorkerEvidence["performedBy"],
  threadId: string | undefined,
  skills: Stage2SkillReference[],
  report: Stage2ReviewReport,
  options: Stage2ExecutionOptions,
): Stage2WorkerEvidence {
  return {
    task,
    runId: basename(runtimeRoot),
    completedAt: now(options).toISOString(),
    performedBy,
    ...(threadId === undefined ? {} : { threadId }),
    skills: skills.map((skill) => ({ ...skill })),
    report,
  };
}

function requiredFailures(results: CommandResult[]): string[] {
  return results
    .filter((result) => result.required && !result.ok)
    .map((result) => `${result.id}: ${result.output || `exit ${String(result.exitCode)}`}`);
}

function reportFailures(staticReport: Stage2ReviewReport, verificationReport: Stage2ReviewReport): string[] {
  const failures: string[] = [];
  for (const report of [staticReport, verificationReport]) {
    if (report.verdict === "fail") {
      failures.push(`${report.kind}: ${report.summary}`);
    }
    failures.push(
      ...report.findings
        .filter((finding) => finding.severity === "error")
        .map((finding) => `${finding.code}: ${finding.message}`),
    );
  }
  return [...new Set(failures)];
}

function assertIndependentCommandEvidence(specs: CommandSpec[], results: CommandResult[]): void {
  if (results.length !== specs.length) {
    throw new Error("Independent Verification Worker did not preserve the approved command set");
  }
  for (let index = 0; index < specs.length; index += 1) {
    const spec = specs[index]!;
    const result = results[index]!;
    if (result.id !== spec.id || result.runner !== spec.runner || result.required !== spec.required) {
      throw new Error(`Independent Verification Worker changed command metadata for ${spec.id}`);
    }
  }
}

function assertSameCommandEvidence(expected: CommandResult[], actual: CommandResult[]): void {
  const expectedIds = expected.map((item) => item.id);
  const actualIds = actual.map((item) => item.id);
  if (JSON.stringify(expectedIds) !== JSON.stringify(actualIds)) {
    throw new Error("Active verification report did not preserve Harness command evidence");
  }
  for (let index = 0; index < expected.length; index += 1) {
    const expectedResult = expected[index]!;
    const actualResult = actual[index]!;
    if (
      expectedResult.runner !== actualResult.runner
      || expectedResult.required !== actualResult.required
      || expectedResult.ok !== actualResult.ok
      || expectedResult.exitCode !== actualResult.exitCode
      || expectedResult.command !== actualResult.command
    ) {
      throw new Error(`Active verification report changed result for ${expectedResult.id}`);
    }
  }
}

function aggregateHashes(hashes: Record<string, string>): string {
  return sha256(
    Object.entries(hashes)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([path, hash]) => `${path}\0${hash}`)
      .join("\n"),
  );
}

function ensureFinalNewline(content: string): string {
  return content.endsWith("\n") ? content : `${content}\n`;
}

async function syncVerificationDocument(root: string, module: Stage2ModuleState): Promise<void> {
  const verification = requireVerification(module);
  const content = renderVerificationDocument(module);
  await atomicWriteText(resolveWithin(root, verification.documentPath), content);
  verification.documentSha256 = sha256(content);
}

function renderDesignDocument(
  module: Stage2ModuleState,
  proposal: Stage2DesignProposal,
  revision: number,
  status: "待确认" | "已批准" | "需修订",
  skills: Stage2SkillReference[],
  verificationMode?: Stage2VerificationMode,
): string {
  const lines = [
    `# ${module.id} 模块设计`,
    "",
    `状态：${status}`,
    "",
    `Design revision：${String(revision)}`,
    "",
    `Module ID：\`${module.id}\``,
    "",
    "## 职责与范围",
    "",
    proposal.summary,
    "",
    `Architecture 职责：${module.architecture.responsibility}`,
    "",
    ...renderList("Architecture 引用", proposal.architectureReferences),
    ...renderList("源码参考", proposal.sourceReferences),
    ...renderList("显式排除", proposal.explicitExclusions),
    ...renderList("接口", proposal.interfaces),
    "## 字段与所有权",
    "",
    "| 字段 | 语义 | 生产者 | 存储点 | 消费者 | 有效期 |",
    "|---|---|---|---|---|---|",
    ...proposal.fields.map((field) =>
      `| ${table(field.name)} | ${table(field.semantics)} | ${table(field.producer)} | ${table(field.storage)} | ${table(field.consumers.join("、"))} | ${table(field.lifetime)} |`
    ),
    "",
    "## 事件与优先级",
    "",
    ...proposal.events.flatMap((event) => [
      `### ${event.name}`,
      "",
      `条件：${event.condition}`,
      "",
      `优先级：${event.priority}`,
      "",
      ...event.effects.map((effect) => `- ${effect}`),
      "",
    ]),
    ...renderList("周期行为", proposal.cycleBehavior),
    ...renderList("异常与控制路径", proposal.exceptionalBehavior),
    ...renderList("不变量", proposal.invariants),
    ...renderList("共享接口变化", proposal.sharedInterfaceChanges),
    ...renderList("受影响模块", proposal.affectedModules),
    "## 实现范围",
    "",
    "源码路径：",
    "",
    ...proposal.implementation.sourcePaths.map((path) => `- \`${path}\``),
    "",
    "测试路径：",
    "",
    ...proposal.implementation.testPaths.map((path) => `- \`${path}\``),
    "",
    ...renderList("断言", proposal.acceptance.assertions),
    ...renderList("定向测试", proposal.acceptance.directedTests),
    ...renderList("预期结果", proposal.acceptance.expectedResults),
    "## 验证命令",
    "",
    ...proposal.acceptance.commands.map((command) =>
      `- \`${command.id}\` [${command.runner}] ${command.description}，required=${String(command.required)}，${command.runner === "wsl" ? command.script : [command.command, ...(command.args ?? [])].join(" ")}`
    ),
    "",
    "## 方法来源",
    "",
    ...skills.map((skill) => `- \`${skill.id}\`：\`${skill.contentHash}\``),
    "",
    ...(verificationMode === undefined
      ? []
      : ["## 用户确认", "", `验证模式：\`${verificationMode}\``, ""]),
    ...renderList("风险", proposal.risks),
    ...renderList("未决问题", proposal.openQuestions),
  ];
  return `${lines.join("\n").replace(/\n{3,}/gu, "\n\n").trimEnd()}\n`;
}

function renderVerificationDocument(module: Stage2ModuleState): string {
  const verification = requireVerification(module);
  const lines = [
    `# ${module.id} 验证记录`,
    "",
    `模块状态：${module.status}`,
    "",
    `验证模式：\`${verification.mode}\``,
    "",
    `independent: ${String(verification.independent)}`,
    "",
    `waivedByUser: ${String(verification.waivedByUser)}`,
    "",
    "## 主验证",
    "",
    ...renderCommandResults(verification.primaryCommands),
    ...(verification.finalCommands === undefined
      ? []
      : ["", "## 最终命令复验", "", ...renderCommandResults(verification.finalCommands)]),
    ...renderWorkerReport("静态审查", verification.staticReview),
    ...renderWorkerReport("验证审查", verification.verificationReview),
    "",
    "## 阻塞项",
    "",
    ...(module.blockers.length === 0 ? ["- 无"] : module.blockers.map((item) => `- ${item}`)),
    "",
    `完成时间：${verification.completedAt ?? "未完成"}`,
  ];
  return `${lines.join("\n").replace(/\n{3,}/gu, "\n\n").trimEnd()}\n`;
}

function renderCommandResults(results: CommandResult[]): string[] {
  if (results.length === 0) {
    return ["- 尚无命令证据"];
  }
  return results.flatMap((result) => [
    `- \`${result.id}\`: ${result.ok ? "通过" : "失败"}，runner=${result.runner}，exitCode=${String(result.exitCode)}`,
    `  - command: \`${result.command}\``,
    `  - checkedAt: ${result.checkedAt}`,
    ...(result.output === "" ? [] : [`  - output: ${result.output.replace(/\r?\n/gu, " ")}`]),
  ]);
}

function renderWorkerReport(title: string, evidence: Stage2WorkerEvidence | undefined): string[] {
  if (evidence === undefined) {
    return ["", `## ${title}`, "", "- 尚未执行"];
  }
  return [
    "",
    `## ${title}`,
    "",
    `- performedBy: ${evidence.performedBy}`,
    `- runId: \`${evidence.runId}\``,
    `- threadId: ${evidence.threadId === undefined ? "未记录" : `\`${evidence.threadId}\``}`,
    `- skills: ${evidence.skills.map((skill) => `\`${skill.id}@${skill.contentHash}\``).join("、")}`,
    `- verdict: ${evidence.report.verdict}`,
    `- summary: ${evidence.report.summary}`,
    ...evidence.report.findings.map((finding) =>
      `- [${finding.severity}] ${finding.code}: ${finding.message}，artifact=${finding.artifact}，action=${finding.requiredAction}`
    ),
  ];
}

function renderList(title: string, items: string[]): string[] {
  return [
    `## ${title}`,
    "",
    ...(items.length === 0 ? ["- 无"] : items.map((item) => `- ${item}`)),
    "",
  ];
}

function table(value: string): string {
  return value.replace(/\|/gu, "\\|").replace(/\r?\n/gu, " ");
}

function buildShadowPrompt(
  envelope: Stage2TaskEnvelope,
  module: Stage2ModuleState,
  instruction?: string,
  skillContext?: string,
): string {
  return `你是 Stage2 Shadow Align。只负责闭合 ${module.id} 的模块 Design，不修改任何文件，不实现 RTL。

读取 AGENTS.md、Task Envelope 中列出的 Architecture 文档、相关源码和测试。区分已批准事实、当前源码和提议行为。闭合接口、字段、生产者、存储点、消费者、有效期、事件、同拍优先级、周期边界、stall、flush、kill、retry、late response、reset、所有权、复用、不变量、实现路径和验收条件。architectureReferences 和 sourceReferences 的每一项只能填写项目内实际存在的相对路径，不得附加状态、哈希或说明；没有源码引用时返回空数组。

不得改变 Stage1 的 ISA、全局流水边界、模块职责和共享协议。不能闭合的正确性或接口问题进入 openQuestions。verification commands 必须可由 Harness 直接执行。host command 填写 command 和 args，script 填空字符串；WSL command 填写 script 并使用 {{projectWslPath}} 占位符，command 填空字符串且 args 填空数组。自然语言使用简体中文。最终只输出符合 Schema 的 JSON。

Task Envelope 的角色、权限、产物和门禁优先于 Skill 中的通用工作流建议。

Skill Context：
${skillContext ?? "无"}

Task Envelope：
${JSON.stringify(envelope, null, 2)}

Architecture Module：
${JSON.stringify(module.architecture, null, 2)}

本轮用户修订指令：
${instruction?.trim() || "首次闭合，无附加修订指令。"}
`;
}

function buildImplementationPrompt(
  envelope: Stage2TaskEnvelope,
  design: Stage2DesignProposal,
  skillContext: string,
): string {
  return `你是 Stage2 Active Coding。已批准 Design 对你只读。读取 AGENTS.md、Architecture、Design、现有源码和测试，形成最小 Chisel 实现提案。

你没有项目写权限。files 必须给出允许路径中文件的完整内容。已有文件的 baseSha256 填当前内容 SHA-256，新文件填 null。不得返回允许范围外的路径，不得修改 Architecture、Design 或 .assistant。发现 Design 缺口时 files 必须为空，并填写 designGap 的原因和具体反例。不得自行增加协议、状态、流水级、tag、generation 或扩大串行化。自然语言使用简体中文。最终只输出符合 Schema 的 JSON。

Task Envelope 的角色、权限、产物和门禁优先于 Skill 中的通用工作流建议。

Skill Context：
${skillContext}

Task Envelope：
${JSON.stringify(envelope, null, 2)}

Approved Design：
${JSON.stringify(design, null, 2)}
`;
}

function buildReviewPrompt(
  envelope: Stage2TaskEnvelope,
  module: Stage2ModuleState,
  kind: Stage2ReviewReport["kind"],
  commandResults: CommandResult[],
  skillContext: string,
): string {
  return `你是 Stage2 ${kind === "static" ? "Static Review" : "Verification Review"} 执行者。读取 AGENTS.md、已批准 Design、当前实现和测试。不得修改文件。

静态审查检查 Architecture 与 Design 一致性、Chisel 语义、状态更新优先级、边界条件、越权改动和测试缺口，commandResults 返回空数组。验证审查检查 Harness 提供的命令证据、定向场景、断言和失败可复现性，并原样保留 commandResults 的 id 顺序和 ok 结果。存在 correctness error 时 verdict 必须为 fail。自然语言使用简体中文。最终只输出符合 Schema 的 JSON。

Task Envelope 的角色、权限、产物和门禁优先于 Skill 中的通用工作流建议。

Skill Context：
${skillContext}

Task Envelope：
${JSON.stringify(envelope, null, 2)}

Module State：
${JSON.stringify(module, null, 2)}

Harness Command Evidence：
${JSON.stringify(commandResults, null, 2)}
`;
}

function buildIndependentVerificationPrompt(
  envelope: Stage2TaskEnvelope,
  module: Stage2ModuleState,
  commands: CommandSpec[],
  verificationWorkspace: string,
  skillContext: string,
): string {
  const wslWorkspace = shellQuote(toWslPath(verificationWorkspace));
  const executableCommands = commands.map((command) => {
    if (command.runner === "host") {
      return {
        ...command,
        executable: [command.command, ...(command.args ?? [])].join(" "),
      };
    }
    const script = (command.script ?? "").replace(/\{\{projectWslPath\}\}/gu, wslWorkspace);
    return {
      ...command,
      executable: `wsl.exe -e bash -lc ${JSON.stringify(script)}`,
    };
  });
  return `你是独立 Stage2 Verification Worker。当前目录是正式项目的隔离副本。你可以写构建缓存和测试输出，不得修改 Architecture、Design、源码或测试。

逐项执行下方 executable 命令。记录每项 id、description、runner、实际 command、required、ok、exitCode、output 和 checkedAt。检查测试是否覆盖 Design 验收条件。任何 required command 失败时 verdict 必须为 fail。自然语言使用简体中文。最终只输出符合 Schema 的 JSON。

Task Envelope 的角色、权限、产物和门禁优先于 Skill 中的通用工作流建议。

Skill Context：
${skillContext}

Task Envelope：
${JSON.stringify(envelope, null, 2)}

Module State：
${JSON.stringify(module, null, 2)}

Approved Commands：
${JSON.stringify(executableCommands, null, 2)}
`;
}

function designSchema(moduleId: string): object {
  const stringArray = { type: "array", items: { type: "string" } };
  const pathArray = {
    type: "array",
    items: {
      type: "string",
      pattern: "^[A-Za-z0-9_. -]+(?:/[A-Za-z0-9_. -]+)*$",
    },
  };
  return {
    type: "object",
    additionalProperties: false,
    required: [
      "schemaVersion", "moduleId", "summary", "architectureReferences", "sourceReferences",
      "explicitExclusions", "interfaces", "fields", "events", "cycleBehavior",
      "exceptionalBehavior", "invariants", "sharedInterfaceChanges", "affectedModules",
      "implementation", "acceptance", "risks", "openQuestions",
    ],
    properties: {
      schemaVersion: { type: "integer", enum: [1] },
      moduleId: { type: "string", enum: [moduleId] },
      summary: { type: "string" },
      architectureReferences: pathArray,
      sourceReferences: pathArray,
      explicitExclusions: stringArray,
      interfaces: stringArray,
      fields: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["name", "semantics", "producer", "storage", "consumers", "lifetime"],
          properties: {
            name: { type: "string" },
            semantics: { type: "string" },
            producer: { type: "string" },
            storage: { type: "string" },
            consumers: stringArray,
            lifetime: { type: "string" },
          },
        },
      },
      events: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["name", "condition", "effects", "priority"],
          properties: {
            name: { type: "string" },
            condition: { type: "string" },
            effects: stringArray,
            priority: { type: "string" },
          },
        },
      },
      cycleBehavior: stringArray,
      exceptionalBehavior: stringArray,
      invariants: stringArray,
      sharedInterfaceChanges: stringArray,
      affectedModules: stringArray,
      implementation: {
        type: "object",
        additionalProperties: false,
        required: ["sourcePaths", "testPaths"],
        properties: { sourcePaths: pathArray, testPaths: pathArray },
      },
      acceptance: {
        type: "object",
        additionalProperties: false,
        required: ["assertions", "directedTests", "commands", "expectedResults"],
        properties: {
          assertions: stringArray,
          directedTests: stringArray,
          commands: { type: "array", items: commandSpecSchema() },
          expectedResults: stringArray,
        },
      },
      risks: stringArray,
      openQuestions: stringArray,
    },
  };
}

function implementationSchema(moduleId: string, designSha256: string): object {
  return {
    type: "object",
    additionalProperties: false,
    required: ["schemaVersion", "moduleId", "designSha256", "summary", "files", "notes", "designGap"],
    properties: {
      schemaVersion: { type: "integer", enum: [1] },
      moduleId: { type: "string", enum: [moduleId] },
      designSha256: { type: "string", enum: [designSha256] },
      summary: { type: "string" },
      files: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["path", "kind", "baseSha256", "content", "purpose"],
          properties: {
            path: { type: "string" },
            kind: { type: "string", enum: ["source", "test"] },
            baseSha256: { type: ["string", "null"] },
            content: { type: "string" },
            purpose: { type: "string" },
          },
        },
      },
      notes: { type: "array", items: { type: "string" } },
      designGap: {
        anyOf: [
          { type: "null" },
          {
            type: "object",
            additionalProperties: false,
            required: ["reason", "counterexample"],
            properties: { reason: { type: "string" }, counterexample: { type: "string" } },
          },
        ],
      },
    },
  };
}

function reviewSchema(
  moduleId: string,
  designSha256: string,
  implementationSha256: string,
  kind: Stage2ReviewReport["kind"],
): object {
  return {
    type: "object",
    additionalProperties: false,
    required: [
      "schemaVersion", "kind", "moduleId", "designSha256", "implementationAggregateSha256",
      "verdict", "summary", "findings", "commandResults",
    ],
    properties: {
      schemaVersion: { type: "integer", enum: [1] },
      kind: { type: "string", enum: [kind] },
      moduleId: { type: "string", enum: [moduleId] },
      designSha256: { type: "string", enum: [designSha256] },
      implementationAggregateSha256: { type: "string", enum: [implementationSha256] },
      verdict: { type: "string", enum: ["pass", "fail"] },
      summary: { type: "string" },
      findings: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["severity", "code", "message", "artifact", "requiredAction"],
          properties: {
            severity: { type: "string", enum: ["error", "warning", "note"] },
            code: { type: "string" },
            message: { type: "string" },
            artifact: { type: "string" },
            requiredAction: { type: "string" },
          },
        },
      },
      commandResults: { type: "array", items: commandResultSchema() },
    },
  };
}

function commandSpecSchema(): object {
  return {
    type: "object",
    additionalProperties: false,
    required: ["id", "description", "runner", "command", "args", "script", "required"],
    properties: {
      id: { type: "string" },
      description: { type: "string" },
      runner: { type: "string", enum: ["host", "wsl"] },
      command: { type: "string" },
      args: { type: "array", items: { type: "string" } },
      script: { type: "string" },
      required: { type: "boolean" },
    },
  };
}

function commandResultSchema(): object {
  return {
    type: "object",
    additionalProperties: false,
    required: [
      "id", "description", "runner", "command", "required", "ok", "exitCode", "output", "checkedAt",
    ],
    properties: {
      id: { type: "string" },
      description: { type: "string" },
      runner: { type: "string", enum: ["host", "wsl"] },
      command: { type: "string" },
      required: { type: "boolean" },
      ok: { type: "boolean" },
      exitCode: { type: ["integer", "null"] },
      output: { type: "string" },
      checkedAt: { type: "string" },
    },
  };
}
