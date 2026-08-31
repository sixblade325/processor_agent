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
import { effectiveProjectSpec, isProjectSpecTarget } from "./stage1/project-spec.js";
import {
  renderDesignDocument,
  renderImplementationPlanDocument,
  renderVerificationDocument,
} from "./stage2/presentation.js";
import {
  buildImplementationPrompt,
  buildIndependentVerificationPrompt,
  buildReviewPrompt,
  buildShadowPrompt,
  buildTopologyPlannerPrompt,
  buildTopologyResearchPrompt,
  designSchema,
  implementationSchema,
  reviewSchema,
  topologyProposalSchema,
  topologyResearchSchema,
} from "./stage2/worker-contracts.js";
import {
  buildUnitArchitectureContext,
  validateArchitectureRoleMapping,
} from "./stage2/topology-model.js";
import {
  objectValue,
  requireStringArray,
  requireText,
  validateDesignProposal,
  validateImplementationProposal,
  validateReviewReport,
} from "./stage2/proposal-validation.js";
import {
  assertApprovalCurrent,
  beginStage1ArchitectureRework,
  closeStage1ArchitectureRework,
  loadStage1,
  saveProjectState,
  type LoadedProject,
} from "./stage1.js";
import type {
  CommandResult,
  CommandSpec,
  ReviewCorrectionEvidenceSource,
  Stage1ProjectState,
  Stage2AgentAssignment,
  Stage2AgentSlot,
  Stage2AgentTask,
  Stage2ArchitectureReworkProposal,
  Stage2ArchitectureReworkRecord,
  Stage2DesignProposal,
  Stage2ImplementationProposal,
  Stage2ImplementationPlan,
  Stage2ImplementationUnitPlan,
  Stage2ModuleState,
  Stage2NextAction,
  Stage2ProjectStage,
  Stage2ReviewReport,
  Stage2SkillReference,
  Stage2Summary,
  Stage2TaskEnvelope,
  Stage2TopologyDecisionKind,
  Stage2TopologyDecisionSpec,
  Stage2TopologyPlanPatch,
  Stage2TopologyProposal,
  Stage2TopologyResearchEvidence,
  Stage2TopologyState,
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
  refreshResearch?: boolean;
}

export interface Stage2ProductMigrationResult {
  migrated: boolean;
  sourceSchemaVersion?: number;
  targetSchemaVersion?: number;
  sourceRevision?: number;
  targetRevision?: number;
  invalidatedDrafts: string[];
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

interface TopologyAssignmentSnapshot {
  slot: Stage2AgentSlot;
  decisionId: string;
  decisionStatus: "pending" | "proposed";
  lease: string;
  stateEpoch: number;
  planRevision: number;
  planDocumentSha256: string;
  threadId?: string;
}

const TOPOLOGY_DECISIONS: Stage2TopologyDecisionSpec[] = [
  {
    id: "S2_TOP_001",
    kind: "unit_mapping",
    topic: "Implementation Unit 边界",
    question: "Architecture Role 应如何映射为 Implementation Unit，哪些职责需要合并或拆分？",
    whyNow: "Unit 边界决定后续所有 owner、路径和实施依赖。",
    blocking: true,
    researchPolicy: "required",
    dependsOn: [],
  },
  {
    id: "S2_TOP_002",
    kind: "shared_ownership",
    topic: "共享基础设施归属",
    question: "共享 Bundle、pipeline payload、配置和工具代码由哪个 Unit 拥有？",
    whyNow: "共享产物的唯一 owner 是接口和源码路径规划的前置条件。",
    blocking: true,
    researchPolicy: "required",
    dependsOn: ["S2_TOP_001"],
  },
  {
    id: "S2_TOP_003",
    kind: "interface_ownership",
    topic: "Interface Contract 所有权",
    question: "跨 Unit 接口的 owner、生产者、消费者、字段和时序边界如何确定？",
    whyNow: "稳定接口边界后才能安全规划源码拓扑。",
    blocking: true,
    researchPolicy: "required",
    dependsOn: ["S2_TOP_001", "S2_TOP_002"],
  },
  {
    id: "S2_TOP_004",
    kind: "source_topology",
    topic: "Scala 与测试拓扑",
    question: "每个 Unit 的 package、Design、源码、测试和顶层集成路径如何组织？",
    whyNow: "路径 owner 决定 Agent 写权限和后续 Design 产物位置。",
    blocking: true,
    researchPolicy: "required",
    dependsOn: ["S2_TOP_001", "S2_TOP_002", "S2_TOP_003"],
  },
  {
    id: "S2_TOP_005",
    kind: "unit_dag",
    topic: "实施 DAG 与 wave",
    question: "Implementation Unit 的实施前置关系、并行 wave 和集成消费者如何确定？",
    whyNow: "无环实施依赖决定第一个 ready Unit 和双 Agent 轮转。",
    blocking: true,
    researchPolicy: "required",
    dependsOn: ["S2_TOP_001", "S2_TOP_003", "S2_TOP_004"],
  },
  {
    id: "S2_TOP_006",
    kind: "completion",
    topic: "Unit 完成条件",
    question: "每个 Unit 的 Design、实现、测试、集成和验证责任何时算闭合？",
    whyNow: "完成条件是 Implementation Plan 批准和 Module Loop 启动的最后门禁。",
    blocking: true,
    researchPolicy: "none",
    dependsOn: ["S2_TOP_001", "S2_TOP_003", "S2_TOP_004", "S2_TOP_005"],
  },
];

export async function initStage2(projectPath: string): Promise<LoadedStage2Project> {
  const loaded = await loadStage1(projectPath);
  if (loaded.state.stage1.status !== "STAGE1_COMPLETE") {
    throw new Error(`Stage2 requires STAGE1_COMPLETE, current state is ${loaded.state.stage1.status}`);
  }
  if (loaded.state.stage2 !== undefined) {
    throw new Error(`Stage2 is already initialized at ${loaded.root}`);
  }
  await assertApprovalCurrent(loaded.root, loaded.state);
  const timestamp = new Date().toISOString();
  const topology = createTopologyState();
  const stage2: Stage2ProjectStage = {
    schemaVersion: 3,
    status: "TOPOLOGY_DISCOVERY",
    revision: 0,
    stateEpoch: 1,
    initializedAt: timestamp,
    updatedAt: timestamp,
    topology,
    moduleOrder: [],
    modules: {},
    agents: {
      A: idleAssignment("A"),
      B: idleAssignment("B"),
    },
    blockers: [],
    history: [],
  };
  loaded.state.stage2 = stage2;
  assignPlanner(stage2.agents.A, topology.decisionOrder[0]);
  recordEvent(stage2, "STAGE2_INITIALIZED");
  const content = renderImplementationPlanDocument(loaded.state, stage2, "待决策");
  topology.planDocumentSha256 = sha256(content);
  await atomicWriteText(resolveWithin(loaded.root, topology.planPath), content);
  await saveProjectState(loaded.root, loaded.state);
  return refineLoaded(loaded);
}

export async function loadStage2(projectPath: string): Promise<LoadedStage2Project> {
  const loaded = await loadStage1(projectPath);
  if (loaded.state.stage2 === undefined) {
    throw new Error(`Stage2 is not initialized at ${loaded.root}`);
  }
  const schemaVersion = (loaded.state.stage2 as { schemaVersion: number }).schemaVersion;
  if (schemaVersion === 1) {
    throw new Error("Legacy Stage2 state requires explicit `processor-agent stage2 migrate <path>`");
  }
  if (schemaVersion === 2) {
    throw new Error("Stage2 schemaVersion 2 requires explicit product migration");
  }
  validateStage2State(loaded.state.stage2 as Stage2ProjectStage);
  return refineLoaded(loaded);
}

export async function migrateLegacyStage2(
  projectPath: string,
  options: Stage2ExecutionOptions = {},
): Promise<LoadedStage2Project> {
  const loaded = await loadStage1(projectPath);
  const legacy = loaded.state.stage2;
  if (legacy === undefined) {
    throw new Error(`Stage2 is not initialized at ${loaded.root}`);
  }
  if (legacy.schemaVersion !== 1) {
    throw new Error("Stage2 migration only accepts legacy schemaVersion 1 state");
  }
  await assertApprovalCurrent(loaded.root, loaded.state);
  const unsafe = Object.values(legacy.modules).filter((module) =>
    module.design?.approval !== undefined
    || module.implementation !== undefined
    || module.verification !== undefined
  );
  if (unsafe.length > 0) {
    throw new Error(
      `Legacy Stage2 migration requires manual closure because approved or implemented modules exist: ${unsafe.map((item) => item.id).join(", ")}`,
    );
  }
  const draftIndexes = Object.values(legacy.modules).flatMap((module) => {
    const design = module.design;
    if (design === undefined) {
      return [];
    }
    return [{
      moduleId: module.id,
      designPath: design.path,
      designSha256: design.documentSha256,
      runId: design.runId,
      threadId: design.threadId,
    }];
  });
  for (const draft of draftIndexes) {
    const absolute = resolveWithin(loaded.root, draft.designPath);
    if (!(await pathExists(absolute))) {
      continue;
    }
    const current = await readText(absolute);
    if (sha256(current) !== draft.designSha256) {
      throw new Error(`Legacy Design changed outside Harness: ${draft.designPath}`);
    }
    const invalidated = [
      "> 迁移状态：本草案产生于 Implementation Topology 批准之前，已失效，仅作迁移来源参考。",
      "",
      current.trimEnd(),
      "",
    ].join("\n");
    await atomicWriteText(absolute, invalidated);
  }
  const timestamp = now(options).toISOString();
  const topology = createTopologyState();
  topology.migration = {
    migratedAt: timestamp,
    sourceRevision: legacy.revision,
    sourceStateEpoch: legacy.stateEpoch,
    draftIndexes,
  };
  const stage2: Stage2ProjectStage = {
    schemaVersion: 3,
    status: "TOPOLOGY_DISCOVERY",
    revision: legacy.revision,
    stateEpoch: legacy.stateEpoch + 1,
    initializedAt: legacy.initializedAt,
    updatedAt: timestamp,
    topology,
    moduleOrder: [],
    modules: {},
    agents: { A: idleAssignment("A"), B: idleAssignment("B") },
    blockers: [],
    history: [...legacy.history],
  };
  loaded.state.stage2 = stage2;
  assignPlanner(stage2.agents.A, topology.decisionOrder[0]);
  recordEvent(stage2, "LEGACY_STAGE2_MIGRATED", undefined, `source revision ${String(legacy.revision)}`, options);
  const content = renderImplementationPlanDocument(loaded.state, stage2, "待决策");
  topology.planDocumentSha256 = sha256(content);
  await atomicWriteText(resolveWithin(loaded.root, topology.planPath), content);
  await saveProjectState(loaded.root, loaded.state);
  return refineLoaded(loaded);
}

export async function migrateStage2ProductSchema(
  root: string,
  state: Stage1ProjectState,
  migratedAt: string,
  apply: boolean,
): Promise<Stage2ProductMigrationResult> {
  const raw = state.stage2 as unknown as {
    schemaVersion: number;
    status: Stage2ProjectStage["status"];
    revision: number;
    stateEpoch: number;
    initializedAt: string;
    topology?: Stage2TopologyState;
    modules?: Record<string, Stage2ModuleState>;
    architectureRework?: Stage2ArchitectureReworkRecord;
    architectureReworkHistory?: Stage2ArchitectureReworkRecord[];
    blockers?: string[];
    history?: Stage2ProjectStage["history"];
  } | undefined;
  if (raw === undefined) {
    return { migrated: false, invalidatedDrafts: [] };
  }
  if (raw.schemaVersion === 3) {
    return {
      migrated: false,
      sourceSchemaVersion: 3,
      targetSchemaVersion: 3,
      sourceRevision: raw.revision,
      targetRevision: raw.revision,
      invalidatedDrafts: [],
    };
  }
  if (raw.schemaVersion !== 2) {
    throw new Error(
      `Product migration requires Stage2 schemaVersion 2 or 3, current ${String(raw.schemaVersion)}`,
    );
  }
  const modules = Object.values(raw.modules ?? {});
  const unsafe = modules.filter((module) =>
    module.design?.approval !== undefined
    || module.implementation !== undefined
    || module.verification !== undefined
  );
  if (unsafe.length > 0) {
    throw new Error(
      `Product migration requires manual closure for approved or implemented Units: ${unsafe.map((module) => module.id).join(", ")}`,
    );
  }
  const draftIndexes = modules.flatMap((module) => {
    const design = module.design;
    return design === undefined
      ? []
      : [{
          moduleId: module.id,
          designPath: design.path,
          designSha256: design.documentSha256,
          runId: design.runId,
          threadId: design.threadId,
        }];
  });
  for (const draft of draftIndexes) {
    const absolute = resolveWithin(root, draft.designPath);
    if (!(await pathExists(absolute))) {
      continue;
    }
    const current = await readText(absolute);
    if (sha256(current) !== draft.designSha256) {
      throw new Error(`Stage2 migration found Design drift: ${draft.designPath}`);
    }
    if (apply) {
      await atomicWriteText(
        absolute,
        [
          "> 迁移状态：本草案依赖已退役的 Stage1 Module Manifest，已失效，仅作迁移来源参考。",
          "",
          current.trimEnd(),
          "",
        ].join("\n"),
      );
    }
  }

  const sourceRevision = raw.revision;
  const targetRevision = sourceRevision + 1;
  const topology = createTopologyState();
  topology.migration = {
    migratedAt,
    sourceRevision,
    sourceStateEpoch: raw.stateEpoch,
    draftIndexes,
  };
  const architectureRework = raw.architectureRework === undefined
    ? undefined
    : structuredClone(raw.architectureRework);
  if (architectureRework !== undefined) {
    architectureRework.baseline.stage2Revision += 1;
    architectureRework.baseline.planRevision = 0;
    architectureRework.baseline.unitPlanHashes = {};
    delete architectureRework.baseline.planApprovalSha256;
    architectureRework.updatedAt = migratedAt;
  }
  const stage2: Stage2ProjectStage = {
    schemaVersion: 3,
    status: architectureRework === undefined ? "TOPOLOGY_DISCOVERY" : "BLOCKED",
    revision: targetRevision,
    stateEpoch: raw.stateEpoch + 1,
    initializedAt: raw.initializedAt,
    updatedAt: migratedAt,
    topology,
    moduleOrder: [],
    modules: {},
    agents: { A: idleAssignment("A"), B: idleAssignment("B") },
    ...(architectureRework === undefined ? {} : { architectureRework }),
    ...(raw.architectureReworkHistory === undefined
      ? {}
      : { architectureReworkHistory: structuredClone(raw.architectureReworkHistory) }),
    blockers: architectureRework === undefined
      ? []
      : [
          `Architecture Rework ${architectureRework.id} remains active after product migration: ${architectureRework.repair.kind}:${architectureRework.repair.target}`,
        ],
    history: [
      ...(raw.history ?? []),
      {
        at: migratedAt,
        revision: targetRevision,
        stateEpoch: raw.stateEpoch + 1,
        event: "PRODUCT_SCHEMA_MIGRATED",
        detail: "Stage2 schemaVersion 2 -> 3; topology rebuilt from Architecture Roles",
      },
    ],
  };
  if (architectureRework === undefined) {
    assignPlanner(stage2.agents.A, topology.decisionOrder[0]);
  }
  state.stage2 = stage2;
  const content = renderImplementationPlanDocument(
    state,
    stage2,
    architectureRework === undefined ? "待决策" : "需修订",
  );
  topology.planDocumentSha256 = sha256(content);
  if (apply) {
    await atomicWriteText(resolveWithin(root, topology.planPath), content);
  }
  return {
    migrated: true,
    sourceSchemaVersion: 2,
    targetSchemaVersion: 3,
    sourceRevision,
    targetRevision,
    invalidatedDrafts: draftIndexes.map((draft) => draft.designPath),
  };
}

export function getReadyStage2Actions(state: Stage1ProjectState): Stage2NextAction[] {
  const stage2 = requireStage2(state);
  const rework = stage2.architectureRework;
  if (
    rework !== undefined
    && (rework.status === "stage1_rework" || rework.status === "stage1_reapproved")
  ) {
    const stage1Rework = state.stage1.architectureRework;
    if (
      stage1Rework?.id === rework.id
      && stage1Rework.status === "reapproved"
      && state.stage1.status === "STAGE1_COMPLETE"
      && state.stage1.approval !== undefined
    ) {
      return [{ kind: "architecture_rework_resume", reworkId: rework.id }];
    }
    return [{
      kind: "architecture_rework_stage1",
      reworkId: rework.id,
      repairKind: rework.repair.kind,
      repairTarget: rework.repair.target,
    }];
  }
  if (stage2.status === "BASELINE_READY") {
    return [{ kind: "baseline_complete" }];
  }
  if (isTopologyStatus(stage2.status)) {
    return getTopologyReadyActions(stage2);
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
  const waitingForStage1 = stage2.architectureRework !== undefined
    && ["stage1_rework", "stage1_reapproved"].includes(stage2.architectureRework.status);
  if (!waitingForStage1) {
    try {
      await assertStage2AuthorityCurrent(loaded);
    } catch (error) {
      effectiveStatus = "BLOCKED";
      blockers.push(error instanceof Error ? error.message : String(error));
      readyActions = [];
    }
  }
  const active = agentSlots().map((slot) => stage2.agents[slot]).find((item) => item.role === "active");
  const shadow = agentSlots().map((slot) => stage2.agents[slot]).find((item) => item.role === "shadow");
  const nextTopologyDecision = currentTopologyDecision(stage2);
  const plannedIds = new Set(stage2.topology.plan.units.map((unit) => unit.id));
  const boardUnits = [
    ...stage2.topology.plan.units,
    ...Object.values(stage2.modules)
      .filter((module) => !plannedIds.has(module.id))
      .map((module): Stage2ImplementationUnitPlan => ({
        id: module.id,
        kind: "implementation",
        architectureRoles: [],
        responsibility: module.architecture.responsibility,
        rationale: "Architecture Rework 前的 Unit，等待 Topology 重新闭合。",
        packageName: "",
        designPath: module.design?.path ?? "",
        sourcePaths: [...(module.design?.proposal.implementation.sourcePaths ?? [])],
        testPaths: [...(module.design?.proposal.implementation.testPaths ?? [])],
        integrationPaths: [],
        dependsOn: [...module.architecture.dependsOn],
        wave: null,
        integrationConsumers: [],
        completionCriteria: [],
        verificationResponsibility: "",
      })),
  ];
  const board = boardUnits.map((unit) => {
    const module = stage2.modules[unit.id];
    const assignment = agentSlots()
      .map((slot) => stage2.agents[slot])
      .find((item) => item.moduleId === unit.id);
    const verificationStatus = module?.verification?.completedAt !== undefined
      ? "complete" as const
      : module?.status === "VERIFYING"
        ? "review_pending" as const
        : module?.status === "IMPLEMENTING"
          ? "primary_pending" as const
          : "not_started" as const;
    const status: Stage2Summary["board"][number]["status"] = module?.status ?? "PLANNED";
    return {
      unitId: unit.id,
      architectureRoles: [...unit.architectureRoles],
      dependsOn: [...unit.dependsOn],
      wave: unit.wave,
      status,
      agentRole: assignment?.role ?? "idle",
      ...(module?.design === undefined ? {} : { designRevision: module.design.revision }),
      designPath: unit.designPath,
      sourcePaths: [...unit.sourcePaths],
      testPaths: [...unit.testPaths],
      verificationStatus,
      blockers: [...(module?.blockers ?? [])],
    };
  });
  const userAction = readyActions.find((action) => [
    "architecture_rework_stage1",
    "topology_decision",
    "topology_approval",
    "design_revision",
    "design_approval",
  ].includes(action.kind));
  const machineActions = readyActions
    .filter((action) => ![
      "topology_decision",
      "architecture_rework_stage1",
      "topology_approval",
      "design_revision",
      "design_approval",
    ].includes(action.kind))
    .map(describeStage2Action);
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
    plan: {
      path: stage2.topology.planPath,
      revision: stage2.topology.planRevision,
      status: effectiveStatus,
      answeredDecisions: Object.values(stage2.topology.decisions)
        .filter((decision) => decision.status === "answered").length,
      totalDecisions: stage2.topology.decisionOrder.length,
      ...(nextTopologyDecision === undefined ? {} : { currentDecisionId: nextTopologyDecision.spec.id }),
      approvalCurrent: stage2.topology.approval !== undefined
        && stage2.topology.approval.planDocumentSha256 === stage2.topology.planDocumentSha256,
    },
    board,
    ...(userAction === undefined ? {} : { currentUserGate: describeStage2Action(userAction) }),
    nextMachineActions: machineActions,
    ...(stage2.architectureRework === undefined
      ? {}
      : { architectureRework: structuredClone(stage2.architectureRework) }),
  };
}

export function buildStage2TaskEnvelope(
  loaded: LoadedStage2Project,
  assignment: Stage2AgentAssignment,
  task: Stage2AgentTask,
  skills: Stage2SkillReference[],
): Stage2TaskEnvelope {
  if (assignment.role === "idle") {
    throw new Error(`Agent ${assignment.slot} has no Stage2 assignment`);
  }
  const topologyTask = task === "topology_research" || task === "topology_planning";
  if (topologyTask) {
    const decisionId = assignment.decisionId;
    if (assignment.role !== "planner" || decisionId === undefined) {
      throw new Error(`Agent ${assignment.slot} has no Topology Planner assignment`);
    }
    const decision = requireTopologyDecision(loaded.state.stage2, decisionId);
    return {
      schemaVersion: 3,
      task,
      project: { name: loaded.state.project.name, root: loaded.root },
      topology: {
        decision: structuredClone(decision.spec),
        architectureRoles: structuredClone(
          effectiveProjectSpec(loaded.state, loaded.loadedProfile.profile).architecture.roles,
        ),
        confirmedDecisions: loaded.state.stage2.topology.decisionOrder.flatMap((id) => {
          const item = requireTopologyDecision(loaded.state.stage2, id);
          return item.resolution === undefined
            ? []
            : [{ id, conclusion: item.resolution.conclusion }];
        }),
        plan: structuredClone(loaded.state.stage2.topology.plan),
        planRevision: loaded.state.stage2.topology.planRevision,
        planPath: loaded.state.stage2.topology.planPath,
        planDocumentSha256: loaded.state.stage2.topology.planDocumentSha256,
        ...(decision.evidence === undefined ? {} : { evidence: structuredClone(decision.evidence) }),
      },
      assignment: {
        slot: assignment.slot,
        role: assignment.role,
        lease: assignment.lease,
        stateEpoch: loaded.state.stage2.stateEpoch,
      },
      authority: {
        repositoryRules: "AGENTS.md",
        architectureHashes: { ...(loaded.state.stage1.approval?.documentHashes ?? {}) },
        planPath: loaded.state.stage2.topology.planPath,
        planSha256: loaded.state.stage2.topology.planDocumentSha256,
      },
      skills: skills.map((skill) => ({ ...skill })),
      allowedPaths: [loaded.state.stage2.topology.planPath],
      explicitExclusions: effectiveProjectSpec(
        loaded.state,
        loaded.loadedProfile.profile,
      ).intent.exclusions,
      nextPermittedAction: nextPermittedAction(task),
    };
  }
  if (assignment.moduleId === undefined) {
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
    planPath: loaded.state.stage2.topology.planPath,
    ...(loaded.state.stage2.topology.approval === undefined
      ? {}
      : { planSha256: loaded.state.stage2.topology.approval.planDocumentSha256 }),
    ...(design === undefined
      ? {}
      : { designPath: design.path, designSha256: design.documentSha256 }),
  };
  return {
    schemaVersion: 3,
    task,
    project: {
      name: loaded.state.project.name,
      root: loaded.root,
    },
    module: structuredClone(module.architecture),
    unit: structuredClone(requirePlannedUnit(loaded.state.stage2, module.id)),
    assignment: {
      slot: assignment.slot,
      role: assignment.role,
      lease: assignment.lease,
      stateEpoch: loaded.state.stage2.stateEpoch,
    },
    authority,
    skills: skills.map((skill) => ({ ...skill })),
    allowedPaths,
    explicitExclusions: proposal?.explicitExclusions ?? effectiveProjectSpec(
      loaded.state,
      loaded.loadedProfile.profile,
    ).intent.exclusions,
    ...(design?.approval === undefined
      ? {}
      : { verificationMode: design.approval.verificationMode }),
    nextPermittedAction: nextPermittedAction(task),
  };
}

export async function runTopologyPlanning(
  projectPath: string,
  decisionId?: string,
  instruction?: string,
  options: Stage2ExecutionOptions = {},
): Promise<Stage2AgentRunResult<Stage2TopologyProposal>> {
  return runTopologyPlanningInternal(projectPath, decisionId, instruction, undefined, options);
}

export async function answerTopologyDecision(
  projectPath: string,
  decisionId: string,
  optionId: string,
  note?: string,
  options: Stage2ExecutionOptions = {},
): Promise<LoadedStage2Project> {
  return applyTopologyDecisionOption(projectPath, decisionId, optionId, note, undefined, options);
}

export async function answerTopologyCustom(
  projectPath: string,
  decisionId: string,
  conclusion: string,
  note?: string,
  options: Stage2ExecutionOptions = {},
): Promise<LoadedStage2Project> {
  const normalized = conclusion.trim();
  if (normalized === "") {
    throw new Error("Topology custom conclusion is required");
  }
  const result = await runTopologyPlanningInternal(
    projectPath,
    decisionId,
    `用户已明确给出自定义结论，请将其无损转换为当前 Decision 的唯一结构化选项：${normalized}`,
    normalized,
    options,
  );
  return applyTopologyDecisionOption(
    projectPath,
    decisionId,
    result.output.recommendation,
    note,
    normalized,
    options,
  );
}

export async function reviewTopologyPlan(
  projectPath: string,
  options: Stage2ExecutionOptions = {},
): Promise<LoadedStage2Project> {
  const loaded = await loadStage2(projectPath);
  await assertStage2AuthorityCurrent(loaded);
  await assertPlanCurrent(loaded.root, loaded.state.stage2);
  const unanswered = loaded.state.stage2.topology.decisionOrder.filter((id) =>
    requireTopologyDecision(loaded.state.stage2, id).status !== "answered"
  );
  if (unanswered.length > 0) {
    throw new Error(`Topology review requires all blocking Decisions: ${unanswered.join(", ")}`);
  }
  const issues = validateCompleteTopologyPlan(loaded.state);
  loaded.state.stage2.status = "TOPOLOGY_REVIEW";
  loaded.state.stage2.blockers = [...issues];
  loaded.state.stage2.topology.review = {
    reviewedAt: now(options).toISOString(),
    planRevision: loaded.state.stage2.topology.planRevision,
    planDocumentSha256: "",
    verdict: issues.length === 0 ? "pass" : "fail",
    issues,
  };
  delete loaded.state.stage2.topology.approval;
  recordEvent(
    loaded.state.stage2,
    issues.length === 0 ? "TOPOLOGY_REVIEW_PASSED" : "TOPOLOGY_REVIEW_FAILED",
    undefined,
    issues.join("; ") || undefined,
    options,
  );
  const content = renderImplementationPlanDocument(
    loaded.state,
    loaded.state.stage2,
    issues.length === 0 ? "待批准" : "需修订",
  );
  const hash = sha256(content);
  loaded.state.stage2.topology.planDocumentSha256 = hash;
  loaded.state.stage2.topology.review.planDocumentSha256 = hash;
  await atomicWriteText(resolveWithin(loaded.root, loaded.state.stage2.topology.planPath), content);
  await saveStage2(loaded, options);
  return loaded;
}

export async function approveTopologyPlan(
  projectPath: string,
  options: Stage2ExecutionOptions = {},
): Promise<LoadedStage2Project> {
  const loaded = await loadStage2(projectPath);
  await assertStage2AuthorityCurrent(loaded);
  await assertPlanCurrent(loaded.root, loaded.state.stage2);
  const topology = loaded.state.stage2.topology;
  const review = topology.review;
  if (
    loaded.state.stage2.status !== "TOPOLOGY_REVIEW"
    || review?.verdict !== "pass"
    || review.planRevision !== topology.planRevision
    || review.planDocumentSha256 !== topology.planDocumentSha256
  ) {
    throw new Error("Implementation Plan requires a current passing Topology review");
  }
  const issues = validateCompleteTopologyPlan(loaded.state);
  if (issues.length > 0) {
    throw new Error(`Implementation Plan is not closed: ${issues.join("; ")}`);
  }
  initializeModuleLoopFromPlan(loaded.state.stage2, loaded.state);
  loaded.state.stage2.status = "TOPOLOGY_APPROVED";
  loaded.state.stage2.blockers = [];
  recordEvent(loaded.state.stage2, "TOPOLOGY_APPROVED", undefined, undefined, options);
  const activeRework = loaded.state.stage2.architectureRework?.status === "topology_rework"
    ? loaded.state.stage2.architectureRework
    : undefined;
  for (const assignment of Object.values(loaded.state.stage2.agents)) {
    releaseAssignment(assignment);
  }
  let restoredActive: Stage2ModuleState | undefined;
  if (activeRework !== undefined) {
    const affected = new Set([
      ...activeRework.affectedUnits,
      ...activeRework.invalidatedArtifacts.map((artifact) => artifact.unitId),
    ]);
    const suspended = activeRework.suspendedAssignments.find((assignment) =>
      assignment.role === "active"
      && !affected.has(assignment.moduleId)
      && loaded.state.stage2.modules[assignment.moduleId]?.status === assignment.moduleStatus
      && (assignment.moduleStatus === "IMPLEMENTING" || assignment.moduleStatus === "VERIFYING")
    );
    if (suspended !== undefined) {
      const assignment = loaded.state.stage2.agents[suspended.slot];
      restoredActive = requireModule(loaded.state.stage2, suspended.moduleId);
      assign(assignment, "active", suspended.moduleId);
      assignment.observedEpoch = loaded.state.stage2.stateEpoch;
      if (suspended.threadId !== undefined) {
        assignment.threadId = suspended.threadId;
      }
    }
  }
  const first = firstReadyPlannedUnit(loaded.state.stage2);
  const shadow = Object.values(loaded.state.stage2.agents).find((assignment) =>
    assignment.role === "idle"
  );
  if (first === undefined && restoredActive === undefined) {
    loaded.state.stage2.status = "BASELINE_READY";
    recordEvent(loaded.state.stage2, "BASELINE_READY", undefined, undefined, options);
  } else if (first !== undefined) {
    if (shadow === undefined) {
      throw new Error(`No idle Agent is available to realign Unit ${first.id}`);
    }
    assign(shadow, "shadow", first.id);
    shadow.observedEpoch = loaded.state.stage2.stateEpoch;
    first.status = "DESIGNING";
    first.blockers = [];
    loaded.state.stage2.status = "MODULE_LOOP";
    recordEvent(loaded.state.stage2, "MODULE_LOOP_STARTED", first.id, undefined, options);
  } else {
    loaded.state.stage2.status = "MODULE_LOOP";
    recordEvent(
      loaded.state.stage2,
      "MODULE_LOOP_RESUMED",
      restoredActive?.id,
      undefined,
      options,
    );
  }
  const rework = activeRework;
  if (rework?.status === "topology_rework") {
    const timestamp = now(options).toISOString();
    rework.status = "resumed";
    rework.resumedAt = timestamp;
    rework.updatedAt = timestamp;
    loaded.state.stage2.architectureReworkHistory = [
      ...(loaded.state.stage2.architectureReworkHistory ?? []),
      structuredClone(rework),
    ];
    delete loaded.state.stage2.architectureRework;
    recordEvent(
      loaded.state.stage2,
      "ARCHITECTURE_REWORK_RESUMED",
      undefined,
      rework.id,
      options,
    );
  }
  const content = renderImplementationPlanDocument(loaded.state, loaded.state.stage2, "已批准");
  const hash = sha256(content);
  topology.planDocumentSha256 = hash;
  topology.approval = {
    approvedAt: now(options).toISOString(),
    planRevision: topology.planRevision,
    planDocumentSha256: hash,
    architectureHashes: { ...(loaded.state.stage1.approval?.documentHashes ?? {}) },
  };
  await atomicWriteText(resolveWithin(loaded.root, topology.planPath), content);
  await saveStage2(loaded, options);
  return loaded;
}

export async function reopenTopologyDecision(
  projectPath: string,
  decisionId: string,
  reason: string,
  options: Stage2ExecutionOptions = {},
): Promise<LoadedStage2Project> {
  const normalizedReason = reason.trim();
  if (normalizedReason === "") {
    throw new Error("Topology reopen reason is required");
  }
  const loaded = await loadStage2(projectPath);
  await assertStage2AuthorityCurrent(loaded);
  await assertPlanCurrent(loaded.root, loaded.state.stage2);
  const target = requireTopologyDecision(loaded.state.stage2, decisionId);
  if (target.status === "pending") {
    throw new Error(`Topology Decision ${decisionId} is already pending`);
  }
  const materialized = Object.values(loaded.state.stage2.modules).filter((module) =>
    module.design !== undefined || module.implementation !== undefined || module.verification !== undefined
  );
  if (materialized.length > 0) {
    throw new Error(
      `Topology reopen requires impact closure because Unit work exists: ${materialized.map((item) => item.id).join(", ")}`,
    );
  }
  const invalidated = topologyDependents(loaded.state.stage2, decisionId);
  for (const id of invalidated) {
    const decision = requireTopologyDecision(loaded.state.stage2, id);
    if (decision.resolution !== undefined) {
      decision.revisions.push({
        at: now(options).toISOString(),
        reason: id === decisionId ? normalizedReason : `依赖 ${decisionId} 的结论已失效`,
        previousConclusion: decision.resolution.conclusion,
        previousPlanDocumentSha256: decision.resolution.planDocumentSha256,
      });
    }
    decision.status = "pending";
    delete decision.proposal;
    delete decision.evidence;
    delete decision.resolution;
  }
  loaded.state.stage2.topology.planRevision += 1;
  loaded.state.stage2.topology.plan = rebuildTopologyPlan(loaded.state.stage2);
  delete loaded.state.stage2.topology.review;
  delete loaded.state.stage2.topology.approval;
  loaded.state.stage2.moduleOrder = [];
  loaded.state.stage2.modules = {};
  loaded.state.stage2.status = "TOPOLOGY_DECISION_LOOP";
  loaded.state.stage2.blockers = [];
  const plannerThread = agentSlots()
    .map((slot) => loaded.state.stage2.agents[slot].threadId)
    .find((threadId) => threadId !== undefined);
  loaded.state.stage2.agents = { A: idleAssignment("A"), B: idleAssignment("B") };
  if (plannerThread !== undefined) {
    loaded.state.stage2.agents.A.threadId = plannerThread;
  }
  assignPlanner(loaded.state.stage2.agents.A, decisionId);
  loaded.state.stage2.stateEpoch += 1;
  recordEvent(
    loaded.state.stage2,
    "TOPOLOGY_DECISION_REOPENED",
    undefined,
    `${decisionId}: ${normalizedReason}`,
    options,
  );
  const content = renderImplementationPlanDocument(loaded.state, loaded.state.stage2, "待决策");
  loaded.state.stage2.topology.planDocumentSha256 = sha256(content);
  await atomicWriteText(resolveWithin(loaded.root, loaded.state.stage2.topology.planPath), content);
  await saveStage2(loaded, options);
  return loaded;
}

export async function startStage2ArchitectureRework(
  projectPath: string,
  proposal: Stage2ArchitectureReworkProposal,
  options: Stage2ExecutionOptions = {},
): Promise<LoadedStage2Project> {
  const loaded = await loadStage2(projectPath);
  await assertStage2AuthorityCurrent(loaded);
  if (
    loaded.state.stage2.architectureRework !== undefined
    && loaded.state.stage2.architectureRework.status !== "resumed"
  ) {
    throw new Error(
      `Stage2 already has Architecture Rework ${loaded.state.stage2.architectureRework.id}`,
    );
  }
  const normalized = await validateArchitectureReworkProposal(loaded, proposal);
  const number = (loaded.state.stage2.architectureReworkHistory?.length ?? 0) + 1;
  const id = `S2_ARW_${String(number).padStart(3, "0")}`;
  const timestamp = now(options).toISOString();
  const approval = loaded.state.stage1.approval;
  if (approval === undefined) {
    throw new Error("Stage2 Architecture Rework requires a current Stage1 approval");
  }
  const currentStage2Status = loaded.state.stage2.status;
  const affectedAtStart = transitiveIntegrationConsumers(
    loaded.state.stage2.topology.plan,
    normalized.affectedUnits,
  );
  const suspendedAssignments = Object.values(loaded.state.stage2.agents).flatMap((assignment) => {
    if (
      (assignment.role !== "shadow" && assignment.role !== "active")
      || assignment.moduleId === undefined
    ) {
      return [];
    }
    const module = requireModule(loaded.state.stage2, assignment.moduleId);
    return [{
      slot: assignment.slot,
      role: assignment.role,
      moduleId: assignment.moduleId,
      moduleStatus: module.status,
      ...(assignment.threadId === undefined ? {} : { threadId: assignment.threadId }),
    }];
  });
  const record: Stage2ArchitectureReworkRecord = {
    ...normalized,
    id,
    status: "stage1_rework",
    startedAt: timestamp,
    updatedAt: timestamp,
    baseline: {
      stage1ApprovalSha256: approval.aggregateSha256,
      stage2Revision: loaded.state.stage2.revision,
      stage2Status: currentStage2Status,
      planRevision: loaded.state.stage2.topology.planRevision,
      unitPlanHashes: Object.fromEntries(
        loaded.state.stage2.topology.plan.units.map((unit) => [unit.id, planUnitSha256(unit)]),
      ),
      ...(loaded.state.stage2.topology.approval === undefined
        ? {}
        : { planApprovalSha256: loaded.state.stage2.topology.approval.planDocumentSha256 }),
    },
    invalidatedArtifacts: [],
    suspendedAssignments,
  };
  await beginStage1ArchitectureRework(loaded, {
    id,
    sourceStage2Revision: loaded.state.stage2.revision,
    repairKind: normalized.repair.kind,
    repairTarget: normalized.repair.target,
    summary: normalized.summary,
    requiredClosure: normalized.requiredClosure,
    startedAt: timestamp,
  });
  loaded.state.stage2.architectureRework = record;
  loaded.state.stage2.status = "BLOCKED";
  loaded.state.stage2.blockers = [
    `Architecture Rework ${id} is active in Stage1: ${normalized.repair.kind}:${normalized.repair.target}`,
  ];
  for (const assignment of Object.values(loaded.state.stage2.agents)) {
    if (
      assignment.role === "shadow"
      && assignment.moduleId !== undefined
      && !affectedAtStart.has(assignment.moduleId)
    ) {
      const module = requireModule(loaded.state.stage2, assignment.moduleId);
      if (module.status === "DESIGNING" || module.status === "AWAITING_APPROVAL") {
        module.status = "PENDING";
        module.blockers = [];
      }
    }
    releaseAssignment(assignment);
  }
  loaded.state.stage2.stateEpoch += 1;
  recordEvent(
    loaded.state.stage2,
    "ARCHITECTURE_REWORK_STARTED",
    undefined,
    `${id}: ${normalized.repair.kind}:${normalized.repair.target}`,
    options,
  );
  await saveStage2(loaded, options);
  return loaded;
}

export async function resumeStage2ArchitectureRework(
  projectPath: string,
  options: Stage2ExecutionOptions = {},
): Promise<LoadedStage2Project> {
  const loaded = await loadStage2(projectPath);
  const stage2 = loaded.state.stage2;
  const rework = stage2.architectureRework;
  if (
    rework === undefined
    || (rework.status !== "stage1_rework" && rework.status !== "stage1_reapproved")
  ) {
    throw new Error("Stage2 has no Stage1 Architecture Rework ready to resume");
  }
  await assertPlanCurrent(loaded.root, stage2);
  if (stage2.revision !== rework.baseline.stage2Revision + 1) {
    throw new Error(
      `Stage2 changed during Architecture Rework ${rework.id}; expected revision ${String(rework.baseline.stage2Revision + 1)}, current ${String(stage2.revision)}`,
    );
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
  const previousPlan = structuredClone(stage2.topology.plan);
  const invalidatedDecisionIds = new Set<string>();
  for (const decisionId of rework.affectedTopologyDecisions) {
    for (const affected of topologyDependents(stage2, decisionId)) {
      invalidatedDecisionIds.add(affected);
    }
  }
  for (const id of stage2.topology.decisionOrder) {
    if (!invalidatedDecisionIds.has(id)) {
      continue;
    }
    const decision = requireTopologyDecision(stage2, id);
    if (decision.resolution !== undefined) {
      decision.revisions.push({
        at: now(options).toISOString(),
        reason: `Stage1 Architecture Rework ${rework.id} invalidated this conclusion`,
        previousConclusion: decision.resolution.conclusion,
        previousPlanDocumentSha256: decision.resolution.planDocumentSha256,
        previousPatch: structuredClone(decision.resolution.patch),
      });
    }
    decision.status = "pending";
    delete decision.proposal;
    delete decision.evidence;
    delete decision.resolution;
  }
  stage2.topology.planRevision += 1;
  stage2.topology.plan = rebuildTopologyPlan(stage2);
  delete stage2.topology.review;
  delete stage2.topology.approval;

  const affectedUnits = transitiveIntegrationConsumers(previousPlan, rework.affectedUnits);
  rework.invalidatedArtifacts = [];
  for (const [unitId, module] of Object.entries(stage2.modules)) {
    if (!affectedUnits.has(unitId)) {
      continue;
    }
    rework.invalidatedArtifacts.push({
      unitId,
      ...(module.design === undefined ? {} : { designSha256: module.design.documentSha256 }),
      ...(module.implementation === undefined
        ? {}
        : { implementationSha256: module.implementation.aggregateSha256 }),
      ...(module.verification?.documentSha256 === undefined
        ? {}
        : { verificationSha256: module.verification.documentSha256 }),
    });
    module.reopened.push({
      at: now(options).toISOString(),
      reason: `Stage1 Architecture Rework ${rework.id}`,
      ...(module.design === undefined ? {} : { previousDesignSha256: module.design.documentSha256 }),
    });
    if (module.design !== undefined) {
      delete module.design.approval;
    }
    delete module.implementation;
    delete module.verification;
    module.status = "NEEDS_REALIGN";
    module.blockers = [`Architecture Rework ${rework.id} requires Unit realignment`];
  }
  for (const assignment of Object.values(stage2.agents)) {
    releaseAssignment(assignment);
  }
  stage2.stateEpoch += 1;
  stage2.status = "TOPOLOGY_DECISION_LOOP";
  stage2.blockers = [];
  const current = currentTopologyDecision(stage2);
  if (current !== undefined) {
    assignPlanner(stage2.agents.A, current.spec.id);
  }
  rework.status = "topology_rework";
  rework.newStage1ApprovalSha256 = newApproval.aggregateSha256;
  rework.updatedAt = now(options).toISOString();
  closeStage1ArchitectureRework(loaded.state, rework.id);
  recordEvent(
    stage2,
    "ARCHITECTURE_REWORK_RETURNED_TO_STAGE2",
    undefined,
    `${rework.id}; topology=${[...invalidatedDecisionIds].join(",")}; units=${[...affectedUnits].join(",")}`,
    options,
  );
  const content = renderImplementationPlanDocument(loaded.state, stage2, "待决策");
  stage2.topology.planDocumentSha256 = sha256(content);
  await atomicWriteText(resolveWithin(loaded.root, stage2.topology.planPath), content);
  await saveStage2(loaded, options);
  return loaded;
}

async function validateArchitectureReworkProposal(
  loaded: LoadedStage2Project,
  proposal: Stage2ArchitectureReworkProposal,
): Promise<Stage2ArchitectureReworkProposal> {
  if (typeof proposal !== "object" || proposal === null) {
    throw new Error("Stage2 Architecture Rework Proposal must be an object");
  }
  if (typeof proposal.summary !== "string" || typeof proposal.rationale !== "string") {
    throw new Error("Stage2 Architecture Rework requires a summary and rationale");
  }
  const summary = proposal.summary.trim();
  const rationale = proposal.rationale.trim();
  if (summary === "" || rationale === "") {
    throw new Error("Stage2 Architecture Rework requires a summary and rationale");
  }
  const requiredClosure = normalizeNonemptyStrings(
    proposal.requiredClosure,
    "Architecture Rework requiredClosure",
  );
  const affectedTopologyDecisions = normalizeNonemptyStrings(
    proposal.affectedTopologyDecisions,
    "Architecture Rework affectedTopologyDecisions",
  );
  const affectedUnits = normalizeStringList(proposal.affectedUnits, "Architecture Rework affectedUnits");
  const stage2 = loaded.state.stage2;
  for (const decisionId of affectedTopologyDecisions) {
    requireTopologyDecision(stage2, decisionId);
  }
  const knownUnits = new Set([
    ...stage2.topology.plan.units.map((unit) => unit.id),
    ...Object.keys(stage2.modules),
  ]);
  if (knownUnits.size > 0 && affectedUnits.length === 0) {
    throw new Error("Stage2 Architecture Rework must identify affected Units");
  }
  for (const unitId of affectedUnits) {
    if (!knownUnits.has(unitId)) {
      throw new Error(`Stage2 Architecture Rework references unknown Unit ${unitId}`);
    }
  }

  if (typeof proposal.repair !== "object" || proposal.repair === null) {
    throw new Error("Stage2 Architecture Rework requires a repair target");
  }
  const repairKind = proposal.repair.kind;
  const repairTarget = typeof proposal.repair.target === "string"
    ? proposal.repair.target.trim()
    : "";
  if (repairKind !== "decision" && repairKind !== "project_spec") {
    throw new Error(`Unsupported Stage1 Architecture repair kind ${String(repairKind)}`);
  }
  if (repairTarget === "") {
    throw new Error("Stage2 Architecture Rework requires a repair target");
  }
  if (repairKind === "decision") {
    if (loaded.state.stage1.decisions[repairTarget] === undefined) {
      throw new Error(`Stage2 Architecture Rework references unknown Stage1 Decision ${repairTarget}`);
    }
  } else if (!isProjectSpecTarget(repairTarget)) {
    throw new Error(`Stage2 Architecture Rework references unsupported ProjectSpec target ${repairTarget}`);
  }
  if (typeof proposal.source !== "object" || proposal.source === null) {
    throw new Error("Stage2 Architecture Rework requires a source");
  }
  const sourceKind = proposal.source.kind;
  if (!["topology", "unit_design", "implementation", "verification", "user"].includes(sourceKind)) {
    throw new Error(`Unsupported Stage2 Architecture Rework source ${String(sourceKind)}`);
  }
  const sourceDecisionId = typeof proposal.source.decisionId === "string"
    ? proposal.source.decisionId.trim()
    : undefined;
  const sourceUnitId = typeof proposal.source.unitId === "string"
    ? proposal.source.unitId.trim()
    : undefined;
  if (sourceKind === "topology") {
    if (sourceDecisionId === undefined || sourceDecisionId === "") {
      throw new Error("Topology Architecture Rework source requires decisionId");
    }
    requireTopologyDecision(stage2, sourceDecisionId);
  }
  if (["unit_design", "implementation", "verification"].includes(sourceKind)) {
    if (sourceUnitId === undefined || sourceUnitId === "" || !knownUnits.has(sourceUnitId)) {
      throw new Error(`${sourceKind} Architecture Rework source requires a known unitId`);
    }
  }
  if (sourceDecisionId !== undefined && sourceDecisionId !== "") {
    requireTopologyDecision(stage2, sourceDecisionId);
  }
  if (sourceUnitId !== undefined && sourceUnitId !== "" && !knownUnits.has(sourceUnitId)) {
    throw new Error(`Stage2 Architecture Rework references unknown source Unit ${sourceUnitId}`);
  }

  const evidenceSources = await validateArchitectureReworkEvidence(
    loaded,
    proposal.evidenceSources,
  );
  return {
    summary,
    rationale,
    source: {
      kind: sourceKind,
      ...(sourceDecisionId === undefined || sourceDecisionId === ""
        ? {}
        : { decisionId: sourceDecisionId }),
      ...(sourceUnitId === undefined || sourceUnitId === "" ? {} : { unitId: sourceUnitId }),
    },
    repair: { kind: repairKind, target: repairTarget },
    requiredClosure,
    evidenceSources,
    affectedTopologyDecisions,
    affectedUnits,
  };
}

async function validateArchitectureReworkEvidence(
  loaded: LoadedStage2Project,
  sources: ReviewCorrectionEvidenceSource[],
): Promise<ReviewCorrectionEvidenceSource[]> {
  if (!Array.isArray(sources) || sources.length === 0) {
    throw new Error("Stage2 Architecture Rework requires Evidence sources");
  }
  const allowedKinds = new Set([
    "decision",
    "project_document",
    "research",
    "profile",
    "user_directive",
    "external",
  ]);
  const ids = new Set<string>();
  const normalized: ReviewCorrectionEvidenceSource[] = [];
  for (const source of sources) {
    if (
      typeof source !== "object"
      || source === null
      || typeof source.id !== "string"
      || typeof source.locator !== "string"
      || typeof source.claim !== "string"
    ) {
      throw new Error("Architecture Rework Evidence has an invalid id, locator, or claim");
    }
    const id = source.id?.trim();
    const locator = source.locator?.trim();
    const claim = source.claim?.trim();
    if (id === "" || ids.has(id)) {
      throw new Error(`Architecture Rework Evidence ID is empty or duplicated: ${id}`);
    }
    ids.add(id);
    if (!allowedKinds.has(source.kind) || locator === "" || claim === "") {
      throw new Error(`Architecture Rework Evidence ${id} has an invalid kind, locator, or claim`);
    }
    if (locator.replace(/\\/gu, "/").toLowerCase().includes(".assistant/reviews/")) {
      throw new Error(`Audit report cannot be used as Architecture Rework Evidence: ${locator}`);
    }
    if (
      !Array.isArray(source.locations)
      || source.locations.some((item) => typeof item !== "string")
    ) {
      throw new Error(`Architecture Rework Evidence ${id} requires locations`);
    }
    if (source.kind === "decision") {
      const stage1Decision = loaded.state.stage1.decisions[locator];
      const topologyDecision = loaded.state.stage2.topology.decisions[locator];
      const expectedRevision = stage1Decision === undefined
        ? topologyDecision?.resolution?.revision
        : loaded.state.stage1.revision;
      if (expectedRevision === undefined || source.revision !== expectedRevision) {
        throw new Error(`Architecture Rework Evidence ${id} has a stale Decision revision`);
      }
    } else if (source.kind === "project_document") {
      if (source.digest === undefined) {
        throw new Error(`Architecture Rework Evidence ${id} requires a document digest`);
      }
      const path = resolveWithin(loaded.root, locator);
      if (!(await pathExists(path)) || sha256(await readText(path)) !== source.digest) {
        throw new Error(`Architecture Rework Evidence ${id} has a stale project document digest`);
      }
    } else if (source.kind === "research") {
      const stage1Research = Object.values(loaded.state.stage1.decisions).find((decision) =>
        decision.advicePath === locator || decision.research?.fingerprint === source.fingerprint
      );
      const topologyResearch = Object.values(loaded.state.stage2.topology.decisions).find((decision) =>
        decision.evidence?.contextFingerprint === source.fingerprint
      );
      const stage1Current = source.fingerprint !== undefined
        && stage1Research?.research?.fingerprint === source.fingerprint
        && stage1Research.advicePath !== undefined
        && await pathExists(resolveWithin(loaded.root, stage1Research.advicePath));
      const topologyCurrent = source.fingerprint !== undefined
        && topologyResearch?.evidence?.contextFingerprint === source.fingerprint;
      if (!stage1Current && !topologyCurrent) {
        throw new Error(`Architecture Rework Evidence ${id} has a stale Research fingerprint`);
      }
    } else if (source.kind === "profile") {
      if (
        source.digest !== loaded.state.project.profile.digest
        || locator !== loaded.loadedProfile.profile.id
      ) {
        throw new Error(`Architecture Rework Evidence ${id} has a stale Profile digest`);
      }
    } else if (source.kind === "user_directive" && claim.length < 8) {
      throw new Error(`Architecture Rework Evidence ${id} user_directive claim is not self-contained`);
    }
    normalized.push({
      ...structuredClone(source),
      id,
      locator,
      claim,
      locations: source.locations.map((item) => item.trim()).filter(Boolean),
    });
  }
  return normalized;
}

function normalizeStringList(value: string[], label: string): string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    throw new Error(`${label} must be an array`);
  }
  return [...new Set(value.map((item) => item.trim()).filter(Boolean))];
}

function normalizeNonemptyStrings(value: string[], label: string): string[] {
  const normalized = normalizeStringList(value, label);
  if (normalized.length === 0) {
    throw new Error(`${label} must not be empty`);
  }
  return normalized;
}

function transitiveIntegrationConsumers(
  plan: Stage2ImplementationPlan,
  initial: string[],
): Set<string> {
  const affected = new Set(initial);
  let changed = true;
  while (changed) {
    changed = false;
    for (const unit of plan.units) {
      if (affected.has(unit.id)) {
        continue;
      }
      const dependsOnAffected = unit.dependsOn.some((dependency) => affected.has(dependency));
      const namedByAffected = plan.units.some((producer) =>
        affected.has(producer.id) && producer.integrationConsumers.includes(unit.id)
      );
      if (dependsOnAffected || namedByAffected) {
        affected.add(unit.id);
        changed = true;
      }
    }
  }
  return affected;
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
  const path = requirePlannedUnit(current.state.stage2, module.id).designPath;
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

async function runTopologyPlanningInternal(
  projectPath: string,
  decisionId: string | undefined,
  instruction: string | undefined,
  customConclusion: string | undefined,
  options: Stage2ExecutionOptions,
): Promise<Stage2AgentRunResult<Stage2TopologyProposal>> {
  const loaded = await loadStage2(projectPath);
  await assertStage2AuthorityCurrent(loaded);
  if (!isTopologyStatus(loaded.state.stage2.status) || loaded.state.stage2.status === "TOPOLOGY_REVIEW") {
    throw new Error(`Topology Planner cannot run from ${loaded.state.stage2.status}`);
  }
  const currentDecision = currentTopologyDecision(loaded.state.stage2);
  if (currentDecision === undefined) {
    throw new Error("All Topology Decisions are answered; run stage2 review");
  }
  if (decisionId !== undefined && decisionId !== currentDecision.spec.id) {
    throw new Error(`Current Topology Decision is ${currentDecision.spec.id}, not ${decisionId}`);
  }
  if (
    currentDecision.status === "proposed"
    && (instruction?.trim() ?? "") === ""
    && customConclusion === undefined
  ) {
    throw new Error(`Topology Decision ${currentDecision.spec.id} already has a proposal`);
  }
  const assignment = loaded.state.stage2.agents.A;
  if (assignment.role !== "planner" || assignment.decisionId !== currentDecision.spec.id) {
    assignPlanner(assignment, currentDecision.spec.id);
  }
  const snapshot = snapshotTopologyAssignment(loaded.state.stage2, assignment, currentDecision.spec.id);
  const executor = options.executor ?? defaultStage2AgentExecutor;
  const contextFingerprint = topologyContextFingerprint(loaded.state, currentDecision.spec);
  let evidence = currentDecision.evidence;
  if (
    currentDecision.spec.researchPolicy === "required"
    && (
      evidence === undefined
      || evidence.contextFingerprint !== contextFingerprint
      || !evidence.evidenceSufficient
      || options.refreshResearch === true
    )
  ) {
    const researchTask: Stage2AgentTask = "topology_research";
    const researchSkills = await loadStage2TaskSkills(researchTask);
    const researchReferences = skillReferences(researchSkills);
    const researchEnvelope = buildStage2TaskEnvelope(loaded, assignment, researchTask, researchReferences);
    const researchRuntime = await createStage2RunDirectory(
      loaded.root,
      currentDecision.spec.id,
      researchTask,
    );
    await writeTaskEnvelope(researchRuntime, researchEnvelope);
    const researchResponse = await executor({
      task: researchTask,
      projectRoot: loaded.root,
      runtimeRoot: researchRuntime,
      prompt: buildTopologyResearchPrompt(
        researchEnvelope,
        loaded.state,
        instruction,
        renderSkillContext(researchSkills),
      ),
      schema: topologyResearchSchema(currentDecision.spec.id),
      persistent: false,
      sandbox: "read-only",
    });
    await writeAgentResponse(researchRuntime, researchResponse.output, researchResponse.events);
    const research = validateTopologyResearchEvidence(
      researchResponse.output,
      currentDecision.spec.id,
    );
    evidence = {
      ...research,
      completedAt: now(options).toISOString(),
      runId: basename(researchRuntime),
      ...(researchResponse.threadId === undefined ? {} : { threadId: researchResponse.threadId }),
      contextFingerprint,
    };
  }
  if (currentDecision.spec.researchPolicy === "required" && evidence?.evidenceSufficient !== true) {
    const current = await assertTopologyAssignmentStillCurrent(projectPath, snapshot);
    const decision = requireTopologyDecision(current.state.stage2, currentDecision.spec.id);
    if (evidence !== undefined) {
      decision.evidence = evidence;
    }
    current.state.stage2.status = "TOPOLOGY_DECISION_LOOP";
    current.state.stage2.blockers = [
      `Topology research evidence is insufficient for ${currentDecision.spec.id}`,
      ...(evidence?.gaps ?? []),
    ];
    current.state.stage2.agents.A.status = "blocked";
    recordEvent(
      current.state.stage2,
      "TOPOLOGY_RESEARCH_INSUFFICIENT",
      undefined,
      current.state.stage2.blockers.join("; "),
      options,
    );
    const content = renderImplementationPlanDocument(current.state, current.state.stage2, "调研阻塞");
    current.state.stage2.topology.planDocumentSha256 = sha256(content);
    await atomicWriteText(resolveWithin(current.root, current.state.stage2.topology.planPath), content);
    await saveStage2(current, options);
    throw new Error(current.state.stage2.blockers.join("; "));
  }

  if (evidence !== undefined) {
    currentDecision.evidence = evidence;
    await saveProjectState(loaded.root, loaded.state);
  }
  const plannerTask: Stage2AgentTask = "topology_planning";
  const plannerSkills = await loadStage2TaskSkills(plannerTask);
  const plannerReferences = skillReferences(plannerSkills);
  const plannerEnvelope = buildStage2TaskEnvelope(loaded, assignment, plannerTask, plannerReferences);
  const plannerRuntime = await createStage2RunDirectory(
    loaded.root,
    currentDecision.spec.id,
    plannerTask,
  );
  await writeTaskEnvelope(plannerRuntime, plannerEnvelope);
  const plannerResponse = await executor({
    task: plannerTask,
    projectRoot: loaded.root,
    runtimeRoot: plannerRuntime,
    prompt: buildTopologyPlannerPrompt(
      plannerEnvelope,
      loaded.state,
      instruction,
      customConclusion,
      renderSkillContext(plannerSkills),
    ),
    schema: topologyProposalSchema(currentDecision.spec, customConclusion),
    persistent: true,
    sandbox: "read-only",
    ...(assignment.threadId === undefined ? {} : { sessionId: assignment.threadId }),
  });
  await writeAgentResponse(plannerRuntime, plannerResponse.output, plannerResponse.events);
  const proposal = validateTopologyProposal(
    plannerResponse.output,
    loaded.state,
    currentDecision.spec,
    customConclusion,
  );
  const current = await assertTopologyAssignmentStillCurrent(projectPath, snapshot);
  const currentAssignment = current.state.stage2.agents.A;
  const currentState = requireTopologyDecision(current.state.stage2, currentDecision.spec.id);
  const threadId = plannerResponse.threadId ?? currentAssignment.threadId;
  if (threadId === undefined) {
    throw new Error("Persistent Topology Planner did not expose a thread id");
  }
  if (evidence !== undefined) {
    currentState.evidence = evidence;
  }
  currentState.proposal = proposal;
  currentState.status = "proposed";
  currentAssignment.threadId = threadId;
  currentAssignment.status = "waiting";
  currentAssignment.observedEpoch = current.state.stage2.stateEpoch;
  current.state.stage2.status = "TOPOLOGY_DECISION_LOOP";
  current.state.stage2.blockers = [];
  recordEvent(
    current.state.stage2,
    "TOPOLOGY_PROPOSED",
    undefined,
    currentDecision.spec.id,
    options,
  );
  const content = renderImplementationPlanDocument(current.state, current.state.stage2, "待决策");
  current.state.stage2.topology.planDocumentSha256 = sha256(content);
  await atomicWriteText(resolveWithin(current.root, current.state.stage2.topology.planPath), content);
  await saveStage2(current, options);
  return {
    loaded: current,
    output: proposal,
    runId: basename(plannerRuntime),
    threadId,
  };
}

async function applyTopologyDecisionOption(
  projectPath: string,
  decisionId: string,
  optionId: string,
  note: string | undefined,
  customAnswer: string | undefined,
  options: Stage2ExecutionOptions,
): Promise<LoadedStage2Project> {
  const loaded = await loadStage2(projectPath);
  await assertStage2AuthorityCurrent(loaded);
  await assertPlanCurrent(loaded.root, loaded.state.stage2);
  const current = currentTopologyDecision(loaded.state.stage2);
  if (current?.spec.id !== decisionId) {
    throw new Error(`Current Topology Decision is ${current?.spec.id ?? "none"}, not ${decisionId}`);
  }
  if (current.status !== "proposed" || current.proposal === undefined) {
    throw new Error(`Topology Decision ${decisionId} has no proposal to answer`);
  }
  if (current.proposal.openQuestions.length > 0) {
    throw new Error(
      `Topology Decision ${decisionId} still has open questions: ${current.proposal.openQuestions.join("; ")}`,
    );
  }
  const selected = current.proposal.options.find((option) => option.id === optionId);
  if (selected === undefined) {
    throw new Error(`Unknown option ${optionId} for Topology Decision ${decisionId}`);
  }
  if (customAnswer !== undefined && current.proposal.userConclusion !== customAnswer) {
    throw new Error("Topology Planner did not preserve the explicit custom conclusion");
  }
  applyTopologyPatch(loaded.state.stage2.topology.plan, selected.patch, loaded.state);
  loaded.state.stage2.topology.planRevision += 1;
  current.status = "answered";
  current.resolution = {
    selectedOption: selected.id,
    conclusion: customAnswer ?? selected.summary,
    ...(note?.trim() ? { note: note.trim() } : {}),
    ...(customAnswer === undefined ? {} : { userCustomAnswer: customAnswer }),
    answeredAt: now(options).toISOString(),
    revision: loaded.state.stage2.topology.planRevision,
    patch: structuredClone(selected.patch),
    planDocumentSha256: "",
  };
  delete loaded.state.stage2.topology.review;
  delete loaded.state.stage2.topology.approval;
  loaded.state.stage2.status = "TOPOLOGY_DECISION_LOOP";
  loaded.state.stage2.blockers = [];
  loaded.state.stage2.stateEpoch += 1;
  const next = currentTopologyDecision(loaded.state.stage2);
  const planner = loaded.state.stage2.agents.A;
  if (next === undefined) {
    planner.status = "waiting";
    planner.lease = randomUUID();
    planner.observedEpoch = loaded.state.stage2.stateEpoch;
    delete planner.decisionId;
    delete planner.moduleId;
  } else {
    assignPlanner(planner, next.spec.id);
    planner.observedEpoch = loaded.state.stage2.stateEpoch;
  }
  recordEvent(
    loaded.state.stage2,
    "TOPOLOGY_DECISION_ANSWERED",
    undefined,
    `${decisionId}=${selected.id}`,
    options,
  );
  const content = renderImplementationPlanDocument(loaded.state, loaded.state.stage2, "待决策");
  const hash = sha256(content);
  loaded.state.stage2.topology.planDocumentSha256 = hash;
  current.resolution.planDocumentSha256 = hash;
  await atomicWriteText(resolveWithin(loaded.root, loaded.state.stage2.topology.planPath), content);
  await saveStage2(loaded, options);
  return loaded;
}

function createTopologyState(): Stage2TopologyState {
  return {
    planPath: "design/plan.md",
    planRevision: 0,
    planDocumentSha256: "",
    decisionOrder: TOPOLOGY_DECISIONS.map((decision) => decision.id),
    decisions: Object.fromEntries(TOPOLOGY_DECISIONS.map((decision) => [
      decision.id,
      {
        spec: structuredClone(decision),
        status: "pending",
        revisions: [],
      },
    ])),
    plan: emptyImplementationPlan(),
  };
}

function emptyImplementationPlan(): Stage2ImplementationPlan {
  return { units: [], sharedArtifacts: [], interfaces: [] };
}

function isTopologyStatus(status: Stage2ProjectStage["status"]): boolean {
  return [
    "TOPOLOGY_DISCOVERY",
    "TOPOLOGY_DECISION_LOOP",
    "TOPOLOGY_REVIEW",
    "TOPOLOGY_APPROVED",
  ].includes(status);
}

function requireTopologyDecision(
  stage2: Stage2ProjectStage,
  decisionId: string,
): Stage2TopologyState["decisions"][string] {
  const decision = stage2.topology.decisions[decisionId];
  if (decision === undefined) {
    throw new Error(`Unknown Topology Decision: ${decisionId}`);
  }
  return decision;
}

function currentTopologyDecision(
  stage2: Stage2ProjectStage,
): Stage2TopologyState["decisions"][string] | undefined {
  for (const id of stage2.topology.decisionOrder) {
    const decision = requireTopologyDecision(stage2, id);
    if (decision.status === "answered") {
      continue;
    }
    const dependenciesClosed = decision.spec.dependsOn.every((dependency) =>
      requireTopologyDecision(stage2, dependency).status === "answered"
    );
    if (dependenciesClosed) {
      return decision;
    }
  }
  return undefined;
}

function topologyDependents(stage2: Stage2ProjectStage, decisionId: string): string[] {
  requireTopologyDecision(stage2, decisionId);
  const affected = new Set([decisionId]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const id of stage2.topology.decisionOrder) {
      if (affected.has(id)) {
        continue;
      }
      const decision = requireTopologyDecision(stage2, id);
      if (decision.spec.dependsOn.some((dependency) => affected.has(dependency))) {
        affected.add(id);
        changed = true;
      }
    }
  }
  return stage2.topology.decisionOrder.filter((id) => affected.has(id));
}

function getTopologyReadyActions(stage2: Stage2ProjectStage): Stage2NextAction[] {
  if (stage2.status === "TOPOLOGY_REVIEW") {
    const review = stage2.topology.review;
    if (review?.verdict === "pass") {
      return [{
        kind: "topology_approval",
        planPath: stage2.topology.planPath,
        planRevision: stage2.topology.planRevision,
        planDocumentSha256: stage2.topology.planDocumentSha256,
      }];
    }
    return [{
      kind: "topology_review",
      planPath: stage2.topology.planPath,
      planRevision: stage2.topology.planRevision,
      issues: [...(review?.issues ?? [])],
    }];
  }
  const decision = currentTopologyDecision(stage2);
  if (decision === undefined) {
    return [{
      kind: "topology_review",
      planPath: stage2.topology.planPath,
      planRevision: stage2.topology.planRevision,
      issues: [],
    }];
  }
  if (decision.status === "pending") {
    return [{
      kind: "topology_planning",
      decisionId: decision.spec.id,
      topic: decision.spec.topic,
      slot: "A",
      researchPolicy: decision.spec.researchPolicy,
    }];
  }
  if (decision.proposal === undefined) {
    throw new Error(`Topology Decision ${decision.spec.id} is proposed without a proposal`);
  }
  return [{
    kind: "topology_decision",
    decision: structuredClone(decision.spec),
    proposal: structuredClone(decision.proposal),
    planPath: stage2.topology.planPath,
    planRevision: stage2.topology.planRevision,
  }];
}

function describeStage2Action(action: Stage2NextAction): string {
  switch (action.kind) {
    case "architecture_rework_stage1":
      return `完成 ${action.reworkId} 的 Stage1 ${action.repairKind}:${action.repairTarget} 返工`;
    case "architecture_rework_resume":
      return `恢复 ${action.reworkId} 并执行 Stage2 影响失效`;
    case "topology_planning":
      return `Planner 调研 ${action.decisionId}`;
    case "topology_decision":
      return `用户确认 ${action.decision.id}`;
    case "topology_review":
      return action.issues.length === 0 ? "Harness 审查 Implementation Plan" : "修订 Implementation Plan";
    case "topology_approval":
      return `用户批准 ${action.planPath}`;
    case "shadow_design":
      return `Shadow Design ${action.moduleId}`;
    case "design_revision":
      return `用户修订 Design ${action.moduleId}`;
    case "design_approval":
      return `用户批准 Design ${action.moduleId}`;
    case "waiting_for_rotation":
      return `${action.moduleId} 等待轮转`;
    case "active_implementation":
      return `Active Implementation ${action.moduleId}`;
    case "verification":
      return `Verification ${action.moduleId}`;
    case "blocked":
      return `${action.moduleId} blocked`;
    case "baseline_complete":
      return "Baseline complete";
  }
}

function snapshotTopologyAssignment(
  stage2: Stage2ProjectStage,
  assignment: Stage2AgentAssignment,
  decisionId: string,
): TopologyAssignmentSnapshot {
  const decision = requireTopologyDecision(stage2, decisionId);
  if (decision.status !== "pending" && decision.status !== "proposed") {
    throw new Error(`Topology Decision ${decisionId} cannot be planned from ${decision.status}`);
  }
  return {
    slot: assignment.slot,
    decisionId,
    decisionStatus: decision.status,
    lease: assignment.lease,
    stateEpoch: stage2.stateEpoch,
    planRevision: stage2.topology.planRevision,
    planDocumentSha256: stage2.topology.planDocumentSha256,
    ...(assignment.threadId === undefined ? {} : { threadId: assignment.threadId }),
  };
}

async function assertTopologyAssignmentStillCurrent(
  projectPath: string,
  snapshot: TopologyAssignmentSnapshot,
): Promise<LoadedStage2Project> {
  const loaded = await loadStage2(projectPath);
  const assignment = loaded.state.stage2.agents[snapshot.slot];
  const decision = requireTopologyDecision(loaded.state.stage2, snapshot.decisionId);
  if (
    assignment.role !== "planner"
    || assignment.decisionId !== snapshot.decisionId
    || assignment.lease !== snapshot.lease
    || loaded.state.stage2.stateEpoch !== snapshot.stateEpoch
    || loaded.state.stage2.topology.planRevision !== snapshot.planRevision
    || loaded.state.stage2.topology.planDocumentSha256 !== snapshot.planDocumentSha256
    || decision.status !== snapshot.decisionStatus
  ) {
    throw new Error(`Stale Topology Planner result for ${snapshot.decisionId}`);
  }
  return loaded;
}

function topologyContextFingerprint(
  state: Stage1ProjectState,
  decision: Stage2TopologyDecisionSpec,
): string {
  const stage2 = requireStage2(state);
  return sha256(JSON.stringify({
    architectureHashes: state.stage1.approval?.documentHashes ?? {},
    decision,
    plan: stage2.topology.plan,
    confirmed: stage2.topology.decisionOrder.map((id) => {
      const item = requireTopologyDecision(stage2, id);
      return [id, item.resolution?.conclusion ?? null];
    }),
  }));
}

function rebuildTopologyPlan(stage2: Stage2ProjectStage): Stage2ImplementationPlan {
  const plan = emptyImplementationPlan();
  for (const id of stage2.topology.decisionOrder) {
    const resolution = requireTopologyDecision(stage2, id).resolution;
    if (resolution !== undefined) {
      applyTopologyPatch(plan, resolution.patch);
    }
  }
  return plan;
}

function applyTopologyPatch(
  plan: Stage2ImplementationPlan,
  patch: Stage2TopologyPlanPatch,
  state?: Stage1ProjectState,
): void {
  if (patch.kind === "unit_mapping") {
    const seen = new Set<string>();
    const mappedArchitecture = new Set<string>();
    for (const unit of patch.units) {
      assertTopologyId(unit.id, "Implementation Unit");
      if (seen.has(unit.id)) {
        throw new Error(`Duplicate Implementation Unit ID: ${unit.id}`);
      }
      seen.add(unit.id);
      if (unit.responsibility.trim() === "" || unit.rationale.trim() === "") {
        throw new Error(`Implementation Unit ${unit.id} requires responsibility and rationale`);
      }
      if (unit.kind === "implementation" && unit.architectureRoles.length === 0) {
        throw new Error(`Implementation Unit ${unit.id} must map at least one Architecture Role`);
      }
      if (unit.kind === "shared" && unit.architectureRoles.length > 0) {
        throw new Error(`Shared Unit ${unit.id} cannot claim Architecture Roles`);
      }
      for (const role of unit.architectureRoles) {
        if (mappedArchitecture.has(role)) {
          throw new Error(`Architecture Role ${role} has more than one primary Unit`);
        }
        mappedArchitecture.add(role);
      }
    }
    if (patch.units.length === 0) {
      throw new Error("Implementation Plan requires at least one Unit");
    }
    if (state !== undefined) {
      const issues = validateArchitectureRoleMapping(requireCurrentProjectSpec(state), patch.units.map(
        (unit): Stage2ImplementationUnitPlan => ({
          ...structuredClone(unit),
          packageName: "",
          designPath: "",
          sourcePaths: [],
          testPaths: [],
          integrationPaths: [],
          dependsOn: [],
          wave: null,
          integrationConsumers: [],
          completionCriteria: [],
          verificationResponsibility: "",
        }),
      ));
      if (issues.length > 0) {
        throw new Error(issues.join("; "));
      }
    }
    plan.units = patch.units.map((unit) => ({
      ...structuredClone(unit),
      packageName: "",
      designPath: "",
      sourcePaths: [],
      testPaths: [],
      integrationPaths: [],
      dependsOn: [],
      wave: null,
      integrationConsumers: [],
      completionCriteria: [],
      verificationResponsibility: "",
    }));
    plan.sharedArtifacts = [];
    plan.interfaces = [];
    return;
  }
  const units = new Map(plan.units.map((unit) => [unit.id, unit]));
  if (units.size === 0) {
    throw new Error(`${patch.kind} requires an approved Unit mapping`);
  }
  if (patch.kind === "shared_ownership") {
    assertUniqueIds(patch.sharedArtifacts, "Shared artifact");
    for (const artifact of patch.sharedArtifacts) {
      assertTopologyOwner(units, artifact.ownerUnit, `Shared artifact ${artifact.id}`);
      assertKnownUnits(units, artifact.consumerUnits, `Shared artifact ${artifact.id} consumers`);
      assertUniqueStrings(artifact.consumerUnits, `Shared artifact ${artifact.id} consumers`);
      if (artifact.rationale.trim() === "") {
        throw new Error(`Shared artifact ${artifact.id} requires a rationale`);
      }
      assertUniquePortablePaths(artifact.sourcePaths, `Shared artifact ${artifact.id} paths`);
      for (const path of artifact.sourcePaths) {
        assertSafeRelativePath(path);
      }
    }
    plan.sharedArtifacts = structuredClone(patch.sharedArtifacts);
    return;
  }
  if (patch.kind === "interface_ownership") {
    assertUniqueIds(patch.interfaces, "Interface Contract");
    for (const contract of patch.interfaces) {
      assertTopologyOwner(units, contract.ownerUnit, `Interface ${contract.id}`);
      assertKnownUnits(units, contract.producerUnits, `Interface ${contract.id} producers`);
      assertKnownUnits(units, contract.consumerUnits, `Interface ${contract.id} consumers`);
      if (
        contract.producerUnits.length === 0
        || contract.consumerUnits.length === 0
        ||
        contract.fields.length === 0
        || contract.boundary.trim() === ""
        || contract.timing.trim() === ""
      ) {
        throw new Error(`Interface ${contract.id} requires fields, boundary, and timing`);
      }
    }
    plan.interfaces = structuredClone(patch.interfaces);
    return;
  }
  assertPatchUnitCoverage(units, patch.kind, patch.units.map((unit) => unit.id));
  if (patch.kind === "source_topology") {
    for (const update of patch.units) {
      const unit = units.get(update.id)!;
      if (update.designPath !== `design/${unit.id}.md`) {
        throw new Error(`Unit ${unit.id} Design path must be design/${unit.id}.md`);
      }
      if (update.packageName.trim() === "") {
        throw new Error(`Unit ${unit.id} requires a Scala package`);
      }
      if (update.sourcePaths.length === 0 || update.testPaths.length === 0) {
        throw new Error(`Unit ${unit.id} requires source and test paths`);
      }
      for (const path of [...update.sourcePaths, ...update.testPaths, ...update.integrationPaths]) {
        assertSafeRelativePath(path);
      }
      assertUniquePortablePaths(
        [...update.sourcePaths, ...update.testPaths, ...update.integrationPaths],
        `Unit ${unit.id} paths`,
      );
      if (update.sourcePaths.some((path) => !path.replace(/\\/gu, "/").startsWith("src/main/"))) {
        throw new Error(`Unit ${unit.id} source paths must be under src/main/`);
      }
      if (update.testPaths.some((path) => !path.replace(/\\/gu, "/").startsWith("src/test/"))) {
        throw new Error(`Unit ${unit.id} test paths must be under src/test/`);
      }
      if (update.integrationPaths.some((path) => !path.replace(/\\/gu, "/").startsWith("src/main/"))) {
        throw new Error(`Unit ${unit.id} integration paths must be under src/main/`);
      }
      Object.assign(unit, structuredClone(update));
    }
  } else if (patch.kind === "unit_dag") {
    for (const update of patch.units) {
      const unit = units.get(update.id)!;
      assertKnownUnits(units, update.dependsOn, `Unit ${unit.id} dependencies`);
      assertKnownUnits(units, update.integrationConsumers, `Unit ${unit.id} consumers`);
      if (update.dependsOn.includes(unit.id)) {
        throw new Error(`Unit ${unit.id} cannot depend on itself`);
      }
      unit.dependsOn = [...update.dependsOn];
      unit.integrationConsumers = [...update.integrationConsumers];
    }
    assignPlanWaves(plan.units);
  } else {
    for (const update of patch.units) {
      const unit = units.get(update.id)!;
      if (update.completionCriteria.length === 0 || update.verificationResponsibility.trim() === "") {
        throw new Error(`Unit ${unit.id} requires completion criteria and verification responsibility`);
      }
      unit.completionCriteria = [...update.completionCriteria];
      unit.verificationResponsibility = update.verificationResponsibility;
    }
  }
  validatePlanPathOwnership(plan);
}

function assertPatchUnitCoverage(
  units: Map<string, Stage2ImplementationUnitPlan>,
  kind: string,
  ids: string[],
): void {
  if (ids.length !== units.size || new Set(ids).size !== ids.length) {
    throw new Error(`${kind} must define every Implementation Unit exactly once`);
  }
  for (const id of ids) {
    if (!units.has(id)) {
      throw new Error(`${kind} references unknown Unit ${id}`);
    }
  }
}

function validateCompleteTopologyPlan(state: Stage1ProjectState): string[] {
  const stage2 = requireStage2(state);
  const plan = stage2.topology.plan;
  const issues: string[] = [];
  if (plan.units.length === 0) {
    issues.push("Implementation Plan has no Units");
    return issues;
  }
  try {
    const rebuilt = rebuildTopologyPlan(stage2);
    if (JSON.stringify(rebuilt) !== JSON.stringify(plan)) {
      issues.push("Implementation Plan does not match answered Topology Decisions");
    }
  } catch (error) {
    issues.push(error instanceof Error ? error.message : String(error));
  }
  issues.push(...validateArchitectureRoleMapping(requireCurrentProjectSpec(state), plan.units));
  for (const unit of plan.units) {
    if (unit.designPath !== `design/${unit.id}.md`) {
      issues.push(`Unit ${unit.id} Design path is not closed`);
    }
    if (unit.sourcePaths.length === 0 || unit.testPaths.length === 0) {
      issues.push(`Unit ${unit.id} source or test topology is empty`);
    }
    if (unit.wave === null) {
      issues.push(`Unit ${unit.id} has no implementation wave`);
    }
    if (unit.completionCriteria.length === 0 || unit.verificationResponsibility.trim() === "") {
      issues.push(`Unit ${unit.id} completion conditions are not closed`);
    }
    if (unit.kind === "shared") {
      const hasConsumers = unit.integrationConsumers.length > 0
        || plan.sharedArtifacts.some((artifact) =>
          artifact.ownerUnit === unit.id && artifact.consumerUnits.length > 0
        )
        || plan.interfaces.some((contract) =>
          contract.ownerUnit === unit.id
          && [...contract.producerUnits, ...contract.consumerUnits].some((id) => id !== unit.id)
        );
      if (unit.sourcePaths.length === 0 || !hasConsumers) {
        issues.push(`Shared Unit ${unit.id} requires a source boundary and at least one consumer`);
      }
    }
  }
  if (plan.units.length > 1 && plan.interfaces.length === 0) {
    issues.push("Multi-Unit plan has no Interface Contracts");
  }
  for (const artifact of plan.sharedArtifacts) {
    const owner = plan.units.find((unit) => unit.id === artifact.ownerUnit);
    if (
      owner !== undefined
      && artifact.sourcePaths.some((path) =>
        !samePortablePathSet(
          [path],
          [...owner.sourcePaths, ...owner.integrationPaths].filter((owned) =>
            portablePathKey(owned) === portablePathKey(path)
          ),
        )
      )
    ) {
      issues.push(`Shared artifact ${artifact.id} path is absent from owner Unit ${artifact.ownerUnit}`);
    }
  }
  try {
    assignPlanWaves(structuredClone(plan.units));
    validatePlanPathOwnership(plan);
  } catch (error) {
    issues.push(error instanceof Error ? error.message : String(error));
  }
  issues.push(...validateArchitectureReworkPlanChanges(stage2));
  return [...new Set(issues)];
}

function initializeModuleLoopFromPlan(stage2: Stage2ProjectStage, state: Stage1ProjectState): void {
  const projectSpec = requireCurrentProjectSpec(state);
  const planIndex = new Map(stage2.topology.plan.units.map((unit, index) => [unit.id, index]));
  const ordered = [...stage2.topology.plan.units].sort((left, right) =>
    (left.wave ?? Number.MAX_SAFE_INTEGER) - (right.wave ?? Number.MAX_SAFE_INTEGER)
    || (planIndex.get(left.id) ?? 0) - (planIndex.get(right.id) ?? 0)
  );
  stage2.moduleOrder = ordered.map((unit) => unit.id);
  const plannedModules = Object.fromEntries(ordered.map((unit, order) => {
    const architecture = buildUnitArchitectureContext(
      projectSpec,
      stage2.topology.plan,
      unit,
    );
    const module: Stage2ModuleState = {
      id: unit.id,
      order,
      status: "PENDING",
      architecture,
      blockers: [],
      reopened: [],
    };
    return [unit.id, module];
  }));
  const rework = stage2.architectureRework;
  if (rework?.status !== "topology_rework") {
    stage2.modules = plannedModules;
    return;
  }
  const previous = stage2.modules;
  const affected = new Set([
    ...rework.affectedUnits,
    ...rework.invalidatedArtifacts.map((artifact) => artifact.unitId),
  ]);
  stage2.modules = Object.fromEntries(ordered.map((unit) => {
    const planned = plannedModules[unit.id]!;
    const existing = previous[unit.id];
    if (existing === undefined) {
      return [unit.id, planned];
    }
    existing.order = planned.order;
    existing.architecture = planned.architecture;
    if (affected.has(unit.id)) {
      existing.status = "NEEDS_REALIGN";
      existing.blockers = [`Architecture Rework ${rework.id} requires Unit realignment`];
    }
    return [unit.id, existing];
  }));
}

function firstReadyPlannedUnit(stage2: Stage2ProjectStage): Stage2ModuleState | undefined {
  const modules = stage2.moduleOrder.map((id) => requireModule(stage2, id));
  for (const status of ["NEEDS_REALIGN", "PENDING"] as const) {
    const ready = modules.find((module) =>
      module.status === status
      && module.architecture.dependsOn.every((dependency) =>
        requireModule(stage2, dependency).status === "COMPLETE"
      )
    );
    if (ready !== undefined) {
      return ready;
    }
  }
  return undefined;
}

function validateArchitectureReworkPlanChanges(stage2: Stage2ProjectStage): string[] {
  const rework = stage2.architectureRework;
  if (rework?.status !== "topology_rework") {
    return [];
  }
  const issues: string[] = [];
  const previousHashes = rework.baseline.unitPlanHashes ?? {};
  const currentHashes = Object.fromEntries(
    stage2.topology.plan.units.map((unit) => [unit.id, planUnitSha256(unit)]),
  );
  const affected = new Set([
    ...rework.affectedUnits,
    ...rework.invalidatedArtifacts.map((artifact) => artifact.unitId),
  ]);
  for (const [unitId, previousHash] of Object.entries(previousHashes)) {
    const currentHash = currentHashes[unitId];
    if (currentHash !== previousHash && !affected.has(unitId)) {
      issues.push(
        `Architecture Rework changed or removed undeclared Unit ${unitId}; include it in affectedUnits`,
      );
    }
  }
  const mappingReopened = rework.affectedTopologyDecisions.includes("S2_TOP_001");
  for (const unitId of Object.keys(currentHashes)) {
    if (previousHashes[unitId] === undefined && !mappingReopened) {
      issues.push(
        `Architecture Rework added Unit ${unitId} without invalidating S2_TOP_001`,
      );
    }
  }
  return issues;
}

function planUnitSha256(unit: Stage2ImplementationUnitPlan): string {
  return sha256(JSON.stringify(unit));
}

function assignPlanWaves(units: Stage2ImplementationUnitPlan[]): void {
  const index = new Map(units.map((unit) => [unit.id, unit]));
  const visiting = new Set<string>();
  const resolved = new Map<string, number>();
  const visit = (unitId: string): number => {
    const cached = resolved.get(unitId);
    if (cached !== undefined) {
      return cached;
    }
    if (visiting.has(unitId)) {
      throw new Error(`Implementation Unit DAG contains a cycle at ${unitId}`);
    }
    const unit = index.get(unitId);
    if (unit === undefined) {
      throw new Error(`Implementation Unit DAG references unknown Unit ${unitId}`);
    }
    visiting.add(unitId);
    const wave = unit.dependsOn.length === 0
      ? 0
      : Math.max(...unit.dependsOn.map((dependency) => visit(dependency))) + 1;
    visiting.delete(unitId);
    resolved.set(unitId, wave);
    return wave;
  };
  for (const unit of units) {
    unit.wave = visit(unit.id);
  }
}

function validatePlanPathOwnership(plan: Stage2ImplementationPlan): void {
  const owners = new Map<string, string>();
  const claim = (path: string, owner: string): void => {
    const key = portablePathKey(path);
    const existing = owners.get(key);
    if (existing !== undefined && existing !== owner) {
      throw new Error(`Implementation path ${path} has conflicting owners ${existing} and ${owner}`);
    }
    owners.set(key, owner);
  };
  for (const unit of plan.units) {
    if (unit.designPath !== "") {
      claim(unit.designPath, unit.id);
    }
    for (const path of [...unit.sourcePaths, ...unit.testPaths, ...unit.integrationPaths]) {
      claim(path, unit.id);
    }
  }
  for (const artifact of plan.sharedArtifacts) {
    for (const path of artifact.sourcePaths) {
      claim(path, artifact.ownerUnit);
    }
  }
}

function assertTopologyId(id: string, label: string): void {
  if (!/^[a-z][a-z0-9_]*$/u.test(id)) {
    throw new Error(`${label} ID must match ^[a-z][a-z0-9_]*$: ${id}`);
  }
}

function assertUniqueIds(items: Array<{ id: string }>, label: string): void {
  const seen = new Set<string>();
  for (const item of items) {
    assertTopologyId(item.id, label);
    if (seen.has(item.id)) {
      throw new Error(`${label} ID is duplicated: ${item.id}`);
    }
    seen.add(item.id);
  }
}

function assertUniqueStrings(items: string[], label: string): void {
  if (new Set(items).size !== items.length) {
    throw new Error(`${label} contains duplicates`);
  }
}

function assertUniquePortablePaths(items: string[], label: string): void {
  const seen = new Set<string>();
  for (const path of items) {
    const key = portablePathKey(path);
    if (seen.has(key)) {
      throw new Error(`${label} contains duplicate or aliased path ${path}`);
    }
    seen.add(key);
  }
}

function assertTopologyOwner(
  units: Map<string, Stage2ImplementationUnitPlan>,
  owner: string,
  label: string,
): void {
  if (!units.has(owner)) {
    throw new Error(`${label} references unknown owner Unit ${owner}`);
  }
}

function assertKnownUnits(
  units: Map<string, Stage2ImplementationUnitPlan>,
  values: string[],
  label: string,
): void {
  assertUniqueStrings(values, label);
  for (const unitId of values) {
    if (!units.has(unitId)) {
      throw new Error(`${label} references unknown Unit ${unitId}`);
    }
  }
}

function refineLoaded(loaded: LoadedProject): LoadedStage2Project {
  if (loaded.state.stage2 === undefined || loaded.state.stage2.schemaVersion !== 3) {
    throw new Error("Stage2 state is missing");
  }
  return loaded as LoadedStage2Project;
}

function requireStage2(state: Stage1ProjectState): Stage2ProjectStage {
  if (state.stage2 === undefined) {
    throw new Error("Stage2 is not initialized");
  }
  if (state.stage2.schemaVersion !== 3) {
    throw new Error("Legacy Stage2 state requires explicit migration");
  }
  return state.stage2;
}

function requireCurrentProjectSpec(state: Stage1ProjectState) {
  const projectSpec = state.stage1.projectSpec;
  if (projectSpec === undefined || projectSpec.intent === undefined) {
    throw new Error("Stage2 requires a product schema migration with a current Stage1 ProjectSpec");
  }
  return projectSpec;
}

function validateStage2State(stage2: Stage2ProjectStage): void {
  if (
    stage2.schemaVersion !== 3
    || stage2.topology?.planPath !== "design/plan.md"
    || !Array.isArray(stage2.topology.decisionOrder)
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
  role: "shadow" | "active",
  moduleId: string,
): void {
  assignment.role = role;
  assignment.moduleId = moduleId;
  delete assignment.decisionId;
  assignment.status = "assigned";
  assignment.lease = randomUUID();
}

function assignPlanner(assignment: Stage2AgentAssignment, decisionId: string | undefined): void {
  assignment.role = "planner";
  assignment.status = "assigned";
  assignment.lease = randomUUID();
  delete assignment.moduleId;
  if (decisionId === undefined) {
    delete assignment.decisionId;
  } else {
    assignment.decisionId = decisionId;
  }
}

function releaseAssignment(assignment: Stage2AgentAssignment): void {
  assignment.role = "idle";
  assignment.status = "idle";
  assignment.lease = randomUUID();
  delete assignment.moduleId;
  delete assignment.decisionId;
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
  let activeModule: Stage2ModuleState | undefined;
  if (shadow !== undefined && shadow.moduleId !== undefined) {
    activeModule = requireModule(stage2, shadow.moduleId);
    assign(shadow, "active", activeModule.id);
    activeModule.status = "IMPLEMENTING";
  } else if (agentSlots().some((slot) => stage2.agents[slot].role === "shadow")) {
    return;
  }
  let shadowAssigned = false;
  const idle = agentSlots()
    .map((slot) => stage2.agents[slot])
    .find((assignment) => assignment.role === "idle");
  if (idle !== undefined) {
    const next = firstReadyPlannedUnit(stage2);
    if (next !== undefined) {
      assign(idle, "shadow", next.id);
      next.status = "DESIGNING";
      shadowAssigned = true;
    }
  }
  if (activeModule === undefined && !shadowAssigned) {
    return;
  }
  stage2.stateEpoch += 1;
  recordEvent(
    stage2,
    activeModule === undefined ? "SHADOW_ASSIGNED" : "AGENT_ROLES_ROTATED",
    activeModule?.id,
    undefined,
    options,
  );
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
  await assertPlanCurrent(loaded.root, loaded.state.stage2);
  if (["MODULE_LOOP", "BASELINE_READY"].includes(loaded.state.stage2.status)) {
    const approval = loaded.state.stage2.topology.approval;
    if (
      approval === undefined
      || approval.planRevision !== loaded.state.stage2.topology.planRevision
      || approval.planDocumentSha256 !== loaded.state.stage2.topology.planDocumentSha256
    ) {
      throw new Error("Stage2 Module Loop requires a current approved Implementation Plan");
    }
  }
}

async function assertPlanCurrent(root: string, stage2: Stage2ProjectStage): Promise<void> {
  const path = resolveWithin(root, stage2.topology.planPath);
  if (!(await pathExists(path))) {
    throw new Error(`Implementation Plan is missing: ${stage2.topology.planPath}`);
  }
  const current = sha256(await readText(path));
  if (current !== stage2.topology.planDocumentSha256) {
    throw new Error(`Implementation Plan changed outside Harness: ${stage2.topology.planPath}`);
  }
  if (
    stage2.topology.approval !== undefined
    && current !== stage2.topology.approval.planDocumentSha256
  ) {
    throw new Error(`Approved Implementation Plan hash is stale: ${stage2.topology.planPath}`);
  }
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

function requirePlannedUnit(
  stage2: Stage2ProjectStage,
  unitId: string,
): Stage2ImplementationUnitPlan {
  const unit = stage2.topology.plan.units.find((item) => item.id === unitId);
  if (unit === undefined) {
    throw new Error(`Unknown Implementation Unit in approved Plan: ${unitId}`);
  }
  return unit;
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
  const planned = stage2.topology.plan.units.find((unit) => unit.id === proposal.moduleId);
  if (planned === undefined) {
    issues.push(`Unit ${proposal.moduleId} is absent from the approved Implementation Plan`);
  } else {
    if (!samePortablePathSet(
      [...planned.sourcePaths, ...planned.integrationPaths],
      proposal.implementation.sourcePaths,
    )) {
      issues.push(`Unit ${proposal.moduleId} source paths differ from design/plan.md`);
    }
    if (!samePortablePathSet(planned.testPaths, proposal.implementation.testPaths)) {
      issues.push(`Unit ${proposal.moduleId} test paths differ from design/plan.md`);
    }
  }
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

function samePortablePathSet(left: string[], right: string[]): boolean {
  const normalize = (values: string[]): string[] => values.map(portablePathKey).sort();
  return JSON.stringify(normalize(left)) === JSON.stringify(normalize(right));
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
    case "architecture_rework_stage1":
      return 0;
    case "architecture_rework_resume":
      return 1;
    case "topology_decision":
      return 2;
    case "topology_approval":
      return 3;
    case "topology_review":
      return 4;
    case "topology_planning":
      return 5;
    case "design_revision":
      return 6;
    case "design_approval":
      return 7;
    case "verification":
      return 8;
    case "active_implementation":
      return 9;
    case "shadow_design":
      return 10;
    case "waiting_for_rotation":
      return 11;
    case "blocked":
      return 12;
    case "baseline_complete":
      return 13;
  }
}

function nextPermittedAction(task: Stage2AgentTask): string {
  switch (task) {
    case "topology_research":
      return "提交当前 Topology Decision 的来源化证据";
    case "topology_planning":
      return "提交当前单一 Topology Decision Packet 并等待用户确认";
    case "system_design_draft":
      return "提交 System Design Draft 和必要的 Decision Requests";
    case "system_design_review":
      return "提交只读 System Design 审查报告";
    case "shadow_design":
    case "package_design":
      return "提交 Design 提案并等待用户批准";
    case "package_design_patch":
      return "提交受限 Design Patch 并等待 Harness 校验";
    case "active_implementation":
    case "package_implementation":
      return "提交受允许路径约束的源码与测试提案";
    case "active_static_review":
    case "independent_static_review":
    case "package_static_review":
      return "提交静态审查报告";
    case "active_verification_review":
    case "independent_verification":
    case "package_verification":
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

function validateTopologyResearchEvidence(
  value: unknown,
  decisionId: string,
): Stage2TopologyResearchEvidence {
  const object = objectValue(value, "Topology Research evidence");
  if (object.schemaVersion !== 1 || object.decisionId !== decisionId) {
    throw new Error(`Topology Research evidence does not target ${decisionId}`);
  }
  if (!Array.isArray(object.sources) || !Array.isArray(object.facts)) {
    throw new Error("Topology Research evidence requires sources and facts arrays");
  }
  for (const [index, source] of object.sources.entries()) {
    const item = objectValue(source, `Topology source ${String(index)}`);
    requireText(item.kind, `Topology source ${String(index)} kind`);
    if (!["project", "url", "repository", "paper", "other"].includes(item.kind)) {
      throw new Error(`Topology source ${String(index)} has invalid kind`);
    }
    requireText(item.locator, `Topology source ${String(index)} locator`);
    requireText(item.revision, `Topology source ${String(index)} revision`);
    requireText(item.accessedAt, `Topology source ${String(index)} accessedAt`);
    requireStringArray(item.locations, `Topology source ${String(index)} locations`);
  }
  const sourceLocators = new Set(object.sources.map((source) =>
    String((source as Record<string, unknown>).locator)
  ));
  for (const [index, fact] of object.facts.entries()) {
    const item = objectValue(fact, `Topology fact ${String(index)}`);
    requireText(item.claim, `Topology fact ${String(index)} claim`);
    requireText(item.source, `Topology fact ${String(index)} source`);
    if (!sourceLocators.has(item.source)) {
      throw new Error(`Topology fact references unknown source: ${item.source}`);
    }
    if (!['low', 'medium', 'high'].includes(String(item.confidence))) {
      throw new Error(`Topology fact ${String(index)} has invalid confidence`);
    }
  }
  requireStringArray(object.conflicts, "Topology Research conflicts");
  requireStringArray(object.gaps, "Topology Research gaps");
  if (typeof object.evidenceSufficient !== "boolean") {
    throw new Error("Topology Research evidenceSufficient must be boolean");
  }
  requireText(object.stopReason, "Topology Research stopReason");
  if (object.evidenceSufficient && (object.sources.length === 0 || object.facts.length === 0)) {
    throw new Error("Sufficient Topology Research requires at least one source and fact");
  }
  return structuredClone(value) as Stage2TopologyResearchEvidence;
}

function validateTopologyProposal(
  value: unknown,
  state: Stage1ProjectState,
  decision: Stage2TopologyDecisionSpec,
  customConclusion: string | undefined,
): Stage2TopologyProposal {
  const object = objectValue(value, "Topology proposal");
  if (
    object.schemaVersion !== 1
    || object.decisionId !== decision.id
    || object.kind !== decision.kind
  ) {
    throw new Error(`Topology proposal does not target ${decision.id}/${decision.kind}`);
  }
  requireText(object.summary, "Topology proposal summary");
  requireStringArray(object.architectureFacts, "Topology architectureFacts");
  requireStringArray(object.sourceEvidence, "Topology sourceEvidence");
  requireStringArray(object.unknowns, "Topology unknowns");
  requireStringArray(object.rationale, "Topology rationale");
  requireStringArray(object.openQuestions, "Topology openQuestions");
  requireStringArray(object.affectedDecisions, "Topology affectedDecisions");
  if (!Array.isArray(object.options) || object.options.length === 0) {
    throw new Error("Topology proposal requires options");
  }
  const stage2 = requireStage2(state);
  const knownDecisions = new Set(stage2.topology.decisionOrder);
  for (const affected of object.affectedDecisions) {
    if (!knownDecisions.has(affected)) {
      throw new Error(`Topology proposal references unknown affected Decision ${affected}`);
    }
  }
  const optionIds = new Set<string>();
  for (const [index, candidate] of object.options.entries()) {
    const option = objectValue(candidate, `Topology option ${String(index)}`);
    requireText(option.id, `Topology option ${String(index)} id`);
    requireText(option.label, `Topology option ${String(index)} label`);
    requireText(option.summary, `Topology option ${String(index)} summary`);
    if (optionIds.has(option.id)) {
      throw new Error(`Topology option ID is duplicated: ${option.id}`);
    }
    optionIds.add(option.id);
    for (const field of [
      "benefits",
      "costs",
      "risks",
      "notChoosingConsequences",
      "affectedUnits",
      "affectedInterfaces",
      "affectedSourcePaths",
      "affectedDagEdges",
    ]) {
      requireStringArray(option[field], `Topology option ${option.id} ${field}`);
    }
    const patch = validateTopologyPatchShape(option.patch, decision.kind);
    const candidatePlan = structuredClone(stage2.topology.plan);
    applyTopologyPatch(candidatePlan, patch, state);
  }
  requireText(object.recommendation, "Topology recommendation");
  if (!optionIds.has(object.recommendation)) {
    throw new Error(`Topology recommendation references unknown option ${object.recommendation}`);
  }
  if (customConclusion === undefined) {
    if (object.userConclusion !== null) {
      throw new Error("Topology proposal must return userConclusion=null when no custom answer exists");
    }
  } else if (
    object.userConclusion !== customConclusion
    || object.recommendation !== "custom"
    || optionIds.size !== 1
    || !optionIds.has("custom")
  ) {
    throw new Error("Topology custom proposal did not preserve the explicit user conclusion");
  }
  return structuredClone(value) as Stage2TopologyProposal;
}

function validateTopologyPatchShape(
  value: unknown,
  expectedKind: Stage2TopologyDecisionKind,
): Stage2TopologyPlanPatch {
  const patch = objectValue(value, "Topology option patch");
  if (patch.kind !== expectedKind) {
    throw new Error(`Topology patch kind must be ${expectedKind}`);
  }
  const listField = expectedKind === "shared_ownership"
    ? "sharedArtifacts"
    : expectedKind === "interface_ownership"
      ? "interfaces"
      : "units";
  if (!Array.isArray(patch[listField])) {
    throw new Error(`Topology ${expectedKind} patch requires ${listField}`);
  }
  for (const [index, raw] of patch[listField].entries()) {
    const item = objectValue(raw, `${expectedKind} patch item ${String(index)}`);
    requireText(item.id, `${expectedKind} patch item id`);
    if (expectedKind === "unit_mapping") {
      if (item.kind !== "implementation" && item.kind !== "shared") {
        throw new Error(`Unit ${item.id} has invalid kind`);
      }
      requireStringArray(item.architectureRoles, `Unit ${item.id} architectureRoles`);
      requireText(item.responsibility, `Unit ${item.id} responsibility`);
      requireText(item.rationale, `Unit ${item.id} rationale`);
    } else if (expectedKind === "shared_ownership") {
      requireText(item.kind, `Shared artifact ${item.id} kind`);
      requireText(item.ownerUnit, `Shared artifact ${item.id} ownerUnit`);
      requireStringArray(item.consumerUnits, `Shared artifact ${item.id} consumerUnits`);
      requireStringArray(item.sourcePaths, `Shared artifact ${item.id} sourcePaths`);
      requireText(item.rationale, `Shared artifact ${item.id} rationale`);
    } else if (expectedKind === "interface_ownership") {
      requireText(item.ownerUnit, `Interface ${item.id} ownerUnit`);
      requireStringArray(item.producerUnits, `Interface ${item.id} producerUnits`);
      requireStringArray(item.consumerUnits, `Interface ${item.id} consumerUnits`);
      requireStringArray(item.fields, `Interface ${item.id} fields`);
      requireText(item.boundary, `Interface ${item.id} boundary`);
      requireText(item.timing, `Interface ${item.id} timing`);
    } else if (expectedKind === "source_topology") {
      requireText(item.packageName, `Unit ${item.id} packageName`);
      requireText(item.designPath, `Unit ${item.id} designPath`);
      requireStringArray(item.sourcePaths, `Unit ${item.id} sourcePaths`);
      requireStringArray(item.testPaths, `Unit ${item.id} testPaths`);
      requireStringArray(item.integrationPaths, `Unit ${item.id} integrationPaths`);
    } else if (expectedKind === "unit_dag") {
      requireStringArray(item.dependsOn, `Unit ${item.id} dependsOn`);
      requireStringArray(item.integrationConsumers, `Unit ${item.id} integrationConsumers`);
    } else {
      requireStringArray(item.completionCriteria, `Unit ${item.id} completionCriteria`);
      requireText(item.verificationResponsibility, `Unit ${item.id} verificationResponsibility`);
    }
  }
  return structuredClone(value) as Stage2TopologyPlanPatch;
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
