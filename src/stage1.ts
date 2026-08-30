import { spawnSync } from "node:child_process";
import { mkdir, rm, rmdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { parse, stringify } from "yaml";
import { runCommands } from "./commands.js";
import {
  atomicWriteText,
  pathExists,
  readText,
  resolveWithin,
  sha256,
  slugify,
  writeNewOrSame,
} from "./io.js";
import { loadProfile } from "./profile.js";
import { renderFormalDocuments } from "./render.js";
import type {
  DecisionSpec,
  InitOptions,
  LoadedProfile,
  ArchitectureReviewReport,
  ProjectProfile,
  Stage1ProjectState,
  Stage1Summary,
} from "./types.js";

const STATE_PATH = ".assistant/project.yaml";

export interface LoadedProject {
  root: string;
  state: Stage1ProjectState;
  loadedProfile: LoadedProfile;
}

export interface ProfileRefreshOptions {
  adoptProfileDefaults?: boolean;
  resetChangedAdvice?: boolean;
}

export async function initStage1(
  projectPath: string,
  profileReference: string,
  options: InitOptions = {},
): Promise<LoadedProject> {
  const root = resolve(projectPath);
  await mkdir(root, { recursive: true });
  const statePath = resolveWithin(root, STATE_PATH);
  if (await pathExists(statePath)) {
    throw new Error(`Stage1 is already initialized at ${root}`);
  }

  const loadedProfile = await loadProfile(profileReference);
  const { profile } = loadedProfile;
  await assertFormalFilesAbsent(root);
  await ensureGitRepository(root);
  await ensureProjectRules(root);
  await ensureProjectGitignore(root);
  const profileSnapshot = ".assistant/profile.yaml";
  await atomicWriteText(
    resolveWithin(root, profileSnapshot),
    await readText(loadedProfile.path),
  );

  const timestamp = new Date().toISOString();
  const state: Stage1ProjectState = {
    schemaVersion: 1,
    project: {
      id: slugify(options.projectName ?? profile.defaults.projectName),
      name: options.projectName ?? profile.defaults.projectName,
      root: ".",
      profile: {
        id: profile.id,
        version: profile.version,
        digest: loadedProfile.digest,
        snapshot: profileSnapshot,
      },
    },
    stage1: {
      status: "WORKSPACE_INITIALIZED",
      revision: 0,
      createdAt: timestamp,
      updatedAt: timestamp,
      intent: {
        goal: options.goal ?? profile.defaults.goal,
        useCase: options.useCase ?? profile.defaults.useCase,
        constraints: options.constraints ?? profile.defaults.constraints,
        exclusions: options.exclusions ?? profile.defaults.exclusions,
      },
      decisions: Object.fromEntries(
        profile.decisions.map((decision) => [decision.id, { status: "pending" }]),
      ),
      environment: [],
      generatedDocumentHashes: {},
      blockers: [],
      history: [],
    },
  };
  recordEvent(state, "WORKSPACE_INITIALIZED");
  state.stage1.status = "INTENT_CAPTURED";
  recordEvent(state, "INTENT_CAPTURED");

  if (!options.skipProbe) {
    state.stage1.environment = runCommands(profile.environmentChecks, root);
  }
  const environmentBlockers = environmentGateBlockers(state, profile);
  if (environmentBlockers.length > 0) {
    state.stage1.status = "BLOCKED";
    state.stage1.blockers = environmentBlockers;
    recordEvent(state, "ENVIRONMENT_BLOCKED", environmentBlockers.join("; "));
  } else {
    state.stage1.status = "BLUEPRINT_DRAFTED";
    recordEvent(state, "BLUEPRINT_DRAFTED");
    state.stage1.status = "DECISION_LOOP";
    recordEvent(state, "DECISION_LOOP_STARTED");
  }

  await syncFormalDocuments(root, state, profile, false);
  await saveState(root, state);
  return { root, state, loadedProfile };
}

export async function loadStage1(projectPath: string): Promise<LoadedProject> {
  const root = resolve(projectPath);
  const state = await readState(root);
  const loadedProfile = await loadProfile(resolveWithin(root, state.project.profile.snapshot));
  if (loadedProfile.profile.version !== state.project.profile.version) {
    throw new Error(
      `Profile version drift: project=${state.project.profile.version}, installed=${loadedProfile.profile.version}`,
    );
  }
  if (loadedProfile.digest !== state.project.profile.digest) {
    throw new Error(
      `Profile content drift for ${state.project.profile.id}; an explicit migration is required`,
    );
  }
  return { root, state, loadedProfile };
}

export async function refreshStage1Profile(
  projectPath: string,
  profileReference?: string,
  options: ProfileRefreshOptions = {},
): Promise<LoadedProject> {
  const loaded = await loadStage1(projectPath);
  const { root, state } = loaded;
  if (state.stage1.approval !== undefined || state.stage1.scaffold !== undefined) {
    throw new Error("Profile refresh is prohibited after Stage1 approval or scaffolding");
  }
  await assertGeneratedDocumentsCurrent(root, state);
  const next = await loadProfile(profileReference ?? state.project.profile.id);
  if (next.digest === state.project.profile.digest && options.adoptProfileDefaults !== true) {
    return loaded;
  }
  if (next.profile.id !== loaded.loadedProfile.profile.id) {
    throw new Error("Profile refresh changed the profile id");
  }
  const previousSpecs = new Map(
    loaded.loadedProfile.profile.decisions.map((decision) => [decision.id, decision]),
  );
  const nextSpecs = new Map(next.profile.decisions.map((decision) => [decision.id, decision]));
  const staleAdvicePaths: string[] = [];
  for (const [decisionId, decisionState] of Object.entries(state.stage1.decisions)) {
    const carriesUserState = decisionState.status !== "pending" || decisionState.advicePath !== undefined;
    if (!carriesUserState) {
      continue;
    }
    const previous = previousSpecs.get(decisionId);
    const replacement = nextSpecs.get(decisionId);
    if (previous === undefined || replacement === undefined || !sameValue(previous, replacement)) {
      if (
        options.resetChangedAdvice === true
        && decisionState.status === "pending"
        && decisionState.advicePath !== undefined
        && replacement !== undefined
      ) {
        staleAdvicePaths.push(decisionState.advicePath);
        delete decisionState.advicePath;
        continue;
      }
      throw new Error(`Profile refresh changes active decision ${decisionId}`);
    }
  }
  const decisions: Stage1ProjectState["stage1"]["decisions"] = {};
  for (const decision of next.profile.decisions) {
    decisions[decision.id] = state.stage1.decisions[decision.id] ?? { status: "pending" };
  }
  migrateDefaultIntent(
    state,
    loaded.loadedProfile.profile,
    next.profile,
    options.adoptProfileDefaults === true,
  );
  migrateEnvironmentEvidence(state, loaded.loadedProfile.profile, next.profile);
  state.stage1.decisions = decisions;
  state.project.profile.version = next.profile.version;
  state.project.profile.digest = next.digest;
  delete state.stage1.review;
  updateDecisionLoopState(state, next.profile);
  await atomicWriteText(
    resolveWithin(root, state.project.profile.snapshot),
    await readText(next.path),
  );
  recordEvent(
    state,
    "PROFILE_REFRESHED",
    `${loaded.loadedProfile.profile.version}->${next.profile.version}`,
  );
  await syncFormalDocuments(root, state, next.profile, true);
  for (const path of staleAdvicePaths) {
    await removeFileAndEmptyParents(root, path);
  }
  await saveState(root, state);
  loaded.loadedProfile = next;
  return loaded;
}

export function findNextDecision(
  state: Stage1ProjectState,
  profile: ProjectProfile,
): DecisionSpec | undefined {
  return profile.decisions.find((decision) => {
    if (state.stage1.decisions[decision.id]?.status !== "pending") {
      return false;
    }
    return decision.dependsOn.every((dependency) => {
      const status = state.stage1.decisions[dependency]?.status;
      return status === "answered" || status === "delegated";
    });
  });
}

export async function answerDecision(
  projectPath: string,
  decisionId: string,
  optionId: string,
  options: { note?: string; delegated?: boolean } = {},
): Promise<LoadedProject> {
  const loaded = await loadStage1(projectPath);
  const { root, state } = loaded;
  const profile = loaded.loadedProfile.profile;
  assertDecisionMutationAllowed(state);
  await assertGeneratedDocumentsCurrent(root, state);
  const decision = requireDecision(profile, decisionId);
  assertDependenciesClosed(state, decision);
  const option = decision.options.find((candidate) => candidate.id === optionId);
  if (option === undefined) {
    throw new Error(`Unknown option ${optionId} for ${decisionId}`);
  }
  const advicePath = state.stage1.decisions[decisionId]?.advicePath;
  state.stage1.decisions[decisionId] = {
    status: options.delegated ? "delegated" : "answered",
    selectedOption: optionId,
    answeredAt: new Date().toISOString(),
    ...(options.note === undefined ? {} : { note: options.note }),
    ...(advicePath === undefined ? {} : { advicePath }),
  };
  delete state.stage1.review;
  updateDecisionLoopState(state, profile);
  recordEvent(state, "DECISION_ANSWERED", `${decisionId}=${optionId}`);
  await syncFormalDocuments(root, state, profile, true);
  await saveState(root, state);
  return loaded;
}

export async function answerCustomDecision(
  projectPath: string,
  decisionId: string,
  answer: string,
  note?: string,
): Promise<LoadedProject> {
  if (answer.trim() === "") {
    throw new Error("Custom answer must not be empty");
  }
  const loaded = await loadStage1(projectPath);
  const { root, state } = loaded;
  const profile = loaded.loadedProfile.profile;
  assertDecisionMutationAllowed(state);
  await assertGeneratedDocumentsCurrent(root, state);
  const decision = requireDecision(profile, decisionId);
  assertDependenciesClosed(state, decision);
  const advicePath = state.stage1.decisions[decisionId]?.advicePath;
  state.stage1.decisions[decisionId] = {
    status: "answered",
    customAnswer: answer.trim(),
    answeredAt: new Date().toISOString(),
    ...(note === undefined ? {} : { note }),
    ...(advicePath === undefined ? {} : { advicePath }),
  };
  delete state.stage1.review;
  updateDecisionLoopState(state, profile);
  recordEvent(state, "DECISION_ANSWERED_CUSTOM", decisionId);
  await syncFormalDocuments(root, state, profile, true);
  await saveState(root, state);
  return loaded;
}

export async function deferDecision(
  projectPath: string,
  decisionId: string,
  deferredUntil: string,
  note: string,
): Promise<LoadedProject> {
  if (deferredUntil.trim() === "" || note.trim() === "") {
    throw new Error("Deferred decisions require a decision point and a note");
  }
  const loaded = await loadStage1(projectPath);
  const { root, state } = loaded;
  const profile = loaded.loadedProfile.profile;
  assertDecisionMutationAllowed(state);
  await assertGeneratedDocumentsCurrent(root, state);
  const decision = requireDecision(profile, decisionId);
  assertDependenciesClosed(state, decision);
  const advicePath = state.stage1.decisions[decisionId]?.advicePath;
  state.stage1.decisions[decisionId] = {
    status: "deferred",
    deferredUntil: deferredUntil.trim(),
    note: note.trim(),
    answeredAt: new Date().toISOString(),
    ...(advicePath === undefined ? {} : { advicePath }),
  };
  delete state.stage1.review;
  updateDecisionLoopState(state, profile);
  recordEvent(state, "DECISION_DEFERRED", decisionId);
  await syncFormalDocuments(root, state, profile, true);
  await saveState(root, state);
  return loaded;
}

export async function probeEnvironment(projectPath: string): Promise<LoadedProject> {
  const loaded = await loadStage1(projectPath);
  const { root, state } = loaded;
  const profile = loaded.loadedProfile.profile;
  assertArchitectureNotApproved(state, "Environment probing");
  await assertGeneratedDocumentsCurrent(root, state);
  state.stage1.environment = runCommands(profile.environmentChecks, root);
  delete state.stage1.review;
  const failures = requiredFailures(state.stage1.environment);
  state.stage1.blockers = failures;
  if (failures.length > 0) {
    state.stage1.status = "BLOCKED";
    recordEvent(state, "ENVIRONMENT_BLOCKED", failures.join("; "));
  } else if (state.stage1.status === "BLOCKED") {
    updateDecisionLoopState(state, profile);
    recordEvent(state, "ENVIRONMENT_RECOVERED");
  } else {
    recordEvent(state, "ENVIRONMENT_PROBED");
  }
  await syncFormalDocuments(root, state, profile, true);
  await saveState(root, state);
  return loaded;
}

export async function reviewStage1(projectPath: string): Promise<LoadedProject> {
  const loaded = await loadStage1(projectPath);
  const { root, state } = loaded;
  const profile = loaded.loadedProfile.profile;
  assertArchitectureNotApproved(state, "Stage1 review");
  await assertGeneratedDocumentsCurrent(root, state);
  const blockers = stage1GateBlockers(state, profile);
  if (blockers.length > 0) {
    throw new Error(`Stage1 review blocked:\n${blockers.map((item) => `- ${item}`).join("\n")}`);
  }
  state.stage1.status = "ARCHITECTURE_REVIEW";
  delete state.stage1.review;
  state.stage1.blockers = [];
  recordEvent(state, "ARCHITECTURE_REVIEW_READY");
  await syncFormalDocuments(root, state, profile, true);
  await saveState(root, state);
  return loaded;
}

export async function approveStage1(projectPath: string): Promise<LoadedProject> {
  const loaded = await loadStage1(projectPath);
  const { root, state } = loaded;
  const profile = loaded.loadedProfile.profile;
  if (state.stage1.status !== "ARCHITECTURE_REVIEW") {
    throw new Error(`Stage1 must be in ARCHITECTURE_REVIEW, current state is ${state.stage1.status}`);
  }
  await assertGeneratedDocumentsCurrent(root, state);
  const blockers = stage1GateBlockers(state, profile);
  if (blockers.length > 0) {
    throw new Error(`Stage1 approval blocked:\n${blockers.map((item) => `- ${item}`).join("\n")}`);
  }
  const review = state.stage1.review;
  if (review === undefined) {
    throw new Error("Independent Stage1 architecture audit has not been recorded");
  }
  if (review.verdict !== "pass") {
    throw new Error("Independent Stage1 architecture audit did not pass");
  }
  const currentReviewHash = aggregateHashes(state.stage1.generatedDocumentHashes);
  if (review.reviewedAggregateSha256 !== currentReviewHash) {
    throw new Error("Stage1 documents changed after the independent architecture audit");
  }
  state.stage1.status = "ARCHITECTURE_APPROVED";
  recordEvent(state, "ARCHITECTURE_APPROVED");
  const hashes = await syncFormalDocuments(root, state, profile, true);
  state.stage1.approval = {
    approvedAt: new Date().toISOString(),
    revision: state.stage1.revision,
    aggregateSha256: aggregateHashes(hashes),
    documentHashes: hashes,
  };
  await saveState(root, state);
  return loaded;
}

export async function scaffoldStage1(projectPath: string): Promise<LoadedProject> {
  const loaded = await loadStage1(projectPath);
  const { root, state } = loaded;
  const profile = loaded.loadedProfile.profile;
  if (state.stage1.status !== "ARCHITECTURE_APPROVED") {
    throw new Error(`Stage1 must be ARCHITECTURE_APPROVED, current state is ${state.stage1.status}`);
  }
  await assertApprovalCurrent(root, state);
  const fileHashes: Record<string, string> = {};
  for (const file of profile.scaffold.files) {
    const path = resolveWithin(root, file.path);
    const content = ensureFinalNewline(file.content);
    await writeNewOrSame(path, content);
    fileHashes[file.path] = sha256(content);
  }
  state.stage1.status = "PROJECT_SCAFFOLDED";
  state.stage1.scaffold = {
    createdAt: new Date().toISOString(),
    fileHashes,
    smokeChecks: [],
  };
  recordEvent(state, "PROJECT_SCAFFOLDED");
  await saveState(root, state);
  return loaded;
}

export async function completeStage1(projectPath: string): Promise<LoadedProject> {
  const loaded = await loadStage1(projectPath);
  const { root, state } = loaded;
  const profile = loaded.loadedProfile.profile;
  if (state.stage1.scaffold === undefined) {
    throw new Error("Project scaffold has not been created");
  }
  if (state.stage1.status !== "PROJECT_SCAFFOLDED" && state.stage1.status !== "BLOCKED") {
    throw new Error(`Stage1 cannot complete from ${state.stage1.status}`);
  }
  await assertApprovalCurrent(root, state);
  await assertScaffoldCurrent(root, state);
  const results = runCommands(profile.scaffold.smokeChecks, root);
  state.stage1.scaffold.smokeChecks = results;
  const failures = requiredFailures(results);
  if (failures.length > 0) {
    state.stage1.status = "BLOCKED";
    state.stage1.blockers = failures;
    recordEvent(state, "SCAFFOLD_SMOKE_BLOCKED", failures.join("; "));
    await saveState(root, state);
    throw new Error(`Stage1 completion blocked:\n${failures.map((item) => `- ${item}`).join("\n")}`);
  }
  state.stage1.status = "STAGE1_COMPLETE";
  state.stage1.blockers = [];
  recordEvent(state, "STAGE1_COMPLETE");
  await saveState(root, state);
  return loaded;
}

export async function summarizeStage1(loaded: LoadedProject): Promise<Stage1Summary> {
  const { state } = loaded;
  const profile = loaded.loadedProfile.profile;
  const values = Object.values(state.stage1.decisions);
  let approvalCurrent = false;
  let effectiveStatus = state.stage1.status;
  const effectiveBlockers = [...state.stage1.blockers];
  if (state.stage1.approval !== undefined) {
    try {
      await assertApprovalCurrent(loaded.root, state);
      approvalCurrent = true;
    } catch {
      approvalCurrent = false;
      effectiveStatus = "NEEDS_REVISION";
      effectiveBlockers.push("Approved Stage1 documents changed and require a new review and approval");
    }
  }
  const summary: Stage1Summary = {
    projectName: state.project.name,
    profile: `${state.project.profile.id}@${state.project.profile.version}`,
    status: effectiveStatus,
    revision: state.stage1.revision,
    answered: values.filter((item) => item.status === "answered" || item.status === "delegated").length,
    pending: values.filter((item) => item.status === "pending").length,
    deferred: values.filter((item) => item.status === "deferred").length,
    blockers: effectiveBlockers,
    approvalCurrent,
  };
  const nextDecision = findNextDecision(state, profile);
  if (nextDecision !== undefined) {
    summary.nextDecision = nextDecision;
  }
  return summary;
}

export async function assertApprovalCurrent(
  root: string,
  state: Stage1ProjectState,
): Promise<void> {
  const approval = state.stage1.approval;
  if (approval === undefined) {
    throw new Error("Stage1 has no architecture approval");
  }
  const current = await hashExistingDocuments(root, Object.keys(approval.documentHashes));
  if (aggregateHashes(current) !== approval.aggregateSha256) {
    throw new Error("Approved Stage1 documents changed; architecture approval is no longer valid");
  }
}

export async function saveDecisionAdvice(
  projectPath: string,
  decisionId: string,
  adviceContent: string,
): Promise<LoadedProject> {
  const loaded = await loadStage1(projectPath);
  const { root, state } = loaded;
  const profile = loaded.loadedProfile.profile;
  assertDecisionMutationAllowed(state);
  await assertGeneratedDocumentsCurrent(root, state);
  requireDecision(profile, decisionId);
  const advicePath = `.assistant/advice/${decisionId}.json`;
  await atomicWriteText(resolveWithin(root, advicePath), ensureFinalNewline(adviceContent));
  const current = state.stage1.decisions[decisionId];
  if (current === undefined) {
    throw new Error(`Decision state missing: ${decisionId}`);
  }
  current.advicePath = advicePath;
  delete state.stage1.review;
  recordEvent(state, "DECISION_ADVICE_RECORDED", decisionId);
  await syncFormalDocuments(root, state, profile, true);
  await saveState(root, state);
  return loaded;
}

export async function saveArchitectureReview(
  projectPath: string,
  report: ArchitectureReviewReport,
): Promise<LoadedProject> {
  const loaded = await loadStage1(projectPath);
  const { root, state } = loaded;
  if (state.stage1.status !== "ARCHITECTURE_REVIEW") {
    throw new Error(`Architecture audit requires ARCHITECTURE_REVIEW, current state is ${state.stage1.status}`);
  }
  await assertGeneratedDocumentsCurrent(root, state);
  const currentHash = aggregateHashes(state.stage1.generatedDocumentHashes);
  if (report.reviewedAggregateSha256 !== currentHash) {
    throw new Error("Architecture audit does not match the current Stage1 documents");
  }
  const reportPath = ".assistant/reviews/stage1.json";
  await atomicWriteText(
    resolveWithin(root, reportPath),
    `${JSON.stringify(report, null, 2)}\n`,
  );
  state.stage1.review = {
    ...report,
    reviewedAt: new Date().toISOString(),
    revision: state.stage1.revision,
    reportPath,
  };
  recordEvent(state, "ARCHITECTURE_AUDITED", report.verdict);
  await saveState(root, state);
  return loaded;
}

export function currentGeneratedAggregate(state: Stage1ProjectState): string {
  return aggregateHashes(state.stage1.generatedDocumentHashes);
}

async function assertFormalFilesAbsent(root: string): Promise<void> {
  const paths = [
    "architecture/overview.md",
    "architecture/modules.yaml",
    "verification/plan.md",
  ];
  const conflicts: string[] = [];
  for (const path of paths) {
    if (await pathExists(resolveWithin(root, path))) {
      conflicts.push(path);
    }
  }
  if (conflicts.length > 0) {
    throw new Error(`Stage1 initialization would overwrite existing files: ${conflicts.join(", ")}`);
  }
}

async function ensureGitRepository(root: string): Promise<void> {
  if (await pathExists(resolve(root, ".git"))) {
    return;
  }
  const result = spawnSync("git", ["init"], {
    cwd: root,
    encoding: "utf8",
    windowsHide: true,
  });
  if (result.status !== 0) {
    throw new Error(`git init failed: ${(result.stderr || result.stdout).trim()}`);
  }
}

async function ensureProjectRules(root: string): Promise<void> {
  const path = resolve(root, "AGENTS.md");
  if (await pathExists(path)) {
    return;
  }
  const content = `# 处理器项目协作约束

## 1. 最高优先级

1. 用户最新明确指令优先。
2. 回答技术问题或修改文件前，先读取直接相关的 Architecture、Design、源码、测试和本文件。
3. 目标行为以已批准的 \`architecture/\` 为准，具体实现约束以已闭合的 \`design/\` 为准，当前行为以源码和测试为准。
4. 未完成材料读取和源码追踪时，不输出确定性技术结论。
5. 无法核验时，明确写出缺少的文件、路径、信号或输入条件。
6. 默认使用中文撰写人类可读文档和交付说明。模块名、信号名、文件名、命令和代码保持英文。

## 2. 文档与维护权

1. \`architecture/\` 由用户批准。Agent 可以生成草案，不能自行把草案标记为已批准。
2. \`design/\` 由用户和 Agent 共同维护，负责把架构要求落实到模块、字段、接口、周期和验证点。
3. \`src/\` 与 \`verification/\` 是正式项目资产。源码修改必须关联已闭合的 Design 和验收条件。
4. \`experiments/\` 只保存可复现并经过确认的结论。
5. \`.assistant/\` 由 Processor Agent 维护。用户和普通实现任务不得手工修改其中的状态、哈希和审批记录。
6. 同一事实只保留一个权威正文，其他位置使用摘要和链接。

## 3. 设计闭合要求

1. 每项设计结论必须说明字段、生产者、寄存边界、消费者、副作用和不变量。
2. 状态字段必须说明设置、保持、清除、释放、复用和 reset 行为。
3. 同拍事件必须给出完整优先级，集中表达仲裁关系。
4. 必须覆盖 stall、flush、redirect、kill、retry、迟到 response 和索引复用。
5. 分别说明正确性约束与时序代价。
6. 新增状态字段、跨模块接口、流水级、generation、tag 或宽泛串行化机制前，必须取得用户确认。
7. 发现 Architecture、Design 和源码冲突时，分别记录目标架构、当前设计、当前实现和迁移影响。

## 4. Chisel 与时序规则

1. 按硬件结构分析 Chisel，优先检查事件、mask、one-hot、寄存边界、扇出、组合深度和关键路径。
2. 多写口更新先形成事件或写使能，再集中仲裁。
3. 候选集合优先使用 \`UInt\` mask，最终选择使用 one-hot。
4. \`Mux1H\` 输入必须满足 one-hot 或 zero-hot，并添加对应断言。
5. 发射和前递路径只 mux 必需字段，避免整包宽 Bundle mux。
6. 所有 \`for\`、\`map\`、\`fold\`、\`reduce\`、递归和多端口分配逻辑都要判断综合后形成并行网络还是依赖链。
7. 禁止无说明地引入串行优先译码链、高扇出控制和长距离组合前递。
8. 不能依赖 Scala 源码层级保证 FPGA 布局。需要硬时序边界时使用寄存器并同步 Architecture 或 Design。

## 5. 实现流程

1. 读取相关 Architecture、Design、源码和测试。
2. 使用源码搜索追踪定义、生产端、寄存边界、消费端和副作用。
3. 写代码前闭合当前任务的字段语义、事件表、不变量和验收标准。
4. 实现范围保持最小，优先复用现有结构和信号。
5. 同步更新 Design、断言和定向测试。
6. 运行规定的编译、测试和仿真命令。
7. 发现全局架构或接口缺口时停止实现，返回 Design 或 Architecture。
8. 保存命令、结果、随机种子和失败证据。

## 6. 验证门禁

1. 编译通过不能替代功能验证。
2. 至少覆盖正常路径、边界条件、同拍冲突、stall、flush、kill、迟到 response 和 reset。
3. 测试失败时记录测试名、复现命令、随机种子、失败周期、信号、实际行为、期望行为和根因。
4. 必需测试未通过时，任务不能标记完成。
5. 性能结论必须绑定 workload、配置、命令、计数器定义和 baseline。

## 7. 防膨胀

1. 未满足独立职责、独立生命周期或固定加载边界时，不新增目录、Schema 或抽象。
2. 文档按稳定机制和模块组织，不按对话或 Agent 组织。
3. Git 管理版本，不创建 \`v1\`、\`v2\`、\`final\` 和重复备份目录。
4. 默认不为每个源码文件生成旁路说明文档。
5. 缓存、生成 RTL、波形和原始日志进入工作区级 \`.runtime/\`。
6. 草案晋升为正式事实后，删除重复正文。

## 8. 禁止事项

1. 禁止未读相关文档直接修改源码。
2. 禁止用外部项目经验覆盖当前项目事实。
3. 禁止自行补协议、字段、身份保护和保守机制。
4. 禁止为了通过测试扩大 stall、flush 或串行化范围。
5. 禁止在未说明时序风险时引入依赖链或宽比较网络。
6. 禁止修改未授权路径和手工伪造审批、测试或实验结果。

## 9. 交付要求

每次交付说明修改文件、对应 Architecture 或 Design、字段变化、关键优先级、断言、测试命令、测试结果、时序风险和未解决问题。

## 10. Workspace Agent 与 Harness

1. 项目存在 \`.assistant/project.yaml\` 时，通过 \`processor-agent open <path>\` 启动面向用户的 Workspace Agent。
2. Stage1 状态查询、决策提交、审查、批准和骨架生成必须调用 \`processor-agent stage1 ...\`，不得用直接编辑替代 Harness 命令。
3. Workspace Agent 每轮根据磁盘中的 \`status\` 和 \`next\` 解释用户自然语言，只处理一个 ready Decision。
4. Agent 推荐不能视为用户批准。\`approve\`、delegated decision 和自定义架构结论都要求用户明确授权。
5. Harness 命令失败时保留当前状态并报告恢复条件，不得手工修改状态或哈希。
6. Workspace Agent 内不得递归调用 \`processor-agent open\`。
`;
  await writeNewOrSame(path, content);
}

async function ensureProjectGitignore(root: string): Promise<void> {
  const path = resolve(root, ".gitignore");
  if (await pathExists(path)) {
    return;
  }
  const content = `.bloop/
.bsp/
.metals/
target/
project/target/
test_run_dir/
out/
*.vcd
*.fst
*.log
`;
  await writeNewOrSame(path, content);
}

async function syncFormalDocuments(
  root: string,
  state: Stage1ProjectState,
  profile: ProjectProfile,
  verifyCurrent: boolean,
): Promise<Record<string, string>> {
  if (verifyCurrent) {
    await assertGeneratedDocumentsCurrent(root, state);
  }
  const documents = await renderFormalDocuments(root, state, profile);
  const previousPaths = Object.keys(state.stage1.generatedDocumentHashes);
  const hashes: Record<string, string> = {};
  for (const [path, content] of Object.entries(documents)) {
    await atomicWriteText(resolveWithin(root, path), content);
    hashes[path] = sha256(content);
  }
  for (const path of previousPaths) {
    if (!(path in documents)) {
      await removeFileAndEmptyParents(root, path);
    }
  }
  state.stage1.generatedDocumentHashes = hashes;
  return hashes;
}

async function removeFileAndEmptyParents(root: string, relativePath: string): Promise<void> {
  const absoluteRoot = resolve(root);
  const absolutePath = resolveWithin(absoluteRoot, relativePath);
  if (await pathExists(absolutePath)) {
    await rm(absolutePath);
  }
  let parent = dirname(absolutePath);
  while (parent !== absoluteRoot) {
    try {
      await rmdir(parent);
    } catch (error) {
      if (isNodeErrorWithCode(error, "ENOTEMPTY") || isNodeErrorWithCode(error, "ENOENT")) {
        return;
      }
      throw error;
    }
    parent = dirname(parent);
  }
}

async function assertGeneratedDocumentsCurrent(
  root: string,
  state: Stage1ProjectState,
): Promise<void> {
  const expected = state.stage1.generatedDocumentHashes;
  for (const [path, hash] of Object.entries(expected)) {
    const absolute = resolveWithin(root, path);
    if (!(await pathExists(absolute))) {
      throw new Error(`Generated Stage1 document is missing: ${path}`);
    }
    if (sha256(await readText(absolute)) !== hash) {
      throw new Error(`Generated Stage1 document changed outside the workflow: ${path}`);
    }
  }
}

async function assertScaffoldCurrent(root: string, state: Stage1ProjectState): Promise<void> {
  const scaffold = state.stage1.scaffold;
  if (scaffold === undefined) {
    throw new Error("Project scaffold is missing from state");
  }
  const current = await hashExistingDocuments(root, Object.keys(scaffold.fileHashes));
  for (const [path, hash] of Object.entries(scaffold.fileHashes)) {
    if (current[path] !== hash) {
      throw new Error(`Scaffold file changed before Stage1 completion: ${path}`);
    }
  }
}

async function hashExistingDocuments(
  root: string,
  paths: string[],
): Promise<Record<string, string>> {
  const hashes: Record<string, string> = {};
  for (const path of [...paths].sort()) {
    const absolute = resolveWithin(root, path);
    if (!(await pathExists(absolute))) {
      throw new Error(`Required document is missing: ${path}`);
    }
    hashes[path] = sha256(await readText(absolute));
  }
  return hashes;
}

async function readState(root: string): Promise<Stage1ProjectState> {
  const path = resolveWithin(root, STATE_PATH);
  if (!(await pathExists(path))) {
    throw new Error(`Stage1 state not found at ${path}`);
  }
  const value = parse(await readText(path)) as Stage1ProjectState;
  if (value.schemaVersion !== 1 || value.project?.root !== "." || value.stage1 === undefined) {
    throw new Error(`Unsupported or invalid Stage1 state at ${path}`);
  }
  return value;
}

async function saveState(root: string, state: Stage1ProjectState): Promise<void> {
  state.stage1.updatedAt = new Date().toISOString();
  await atomicWriteText(
    resolveWithin(root, STATE_PATH),
    stringify(state, { lineWidth: 0 }),
  );
}

function updateDecisionLoopState(state: Stage1ProjectState, profile: ProjectProfile): void {
  const environmentBlockers = environmentGateBlockers(state, profile);
  if (environmentBlockers.length > 0) {
    state.stage1.status = "BLOCKED";
    state.stage1.blockers = environmentBlockers;
    return;
  }
  const allDecisionsClosed = profile.decisions.every((decision) => {
    const status = state.stage1.decisions[decision.id]?.status;
    return status === "answered" || status === "delegated" || (!decision.blocking && status === "deferred");
  });
  state.stage1.status = allDecisionsClosed ? "ARCHITECTURE_REVIEW" : "DECISION_LOOP";
  state.stage1.blockers = [];
}

function stage1GateBlockers(state: Stage1ProjectState, profile: ProjectProfile): string[] {
  const blockers = environmentGateBlockers(state, profile);
  for (const decision of profile.decisions) {
    const status = state.stage1.decisions[decision.id]?.status;
    if (decision.blocking && status !== "answered" && status !== "delegated") {
      blockers.push(`${decision.id} is a blocking decision with status ${status ?? "missing"}`);
    }
    if (!decision.blocking && status === "pending") {
      blockers.push(`${decision.id} must be answered, delegated, or explicitly deferred`);
    }
    if (status === "deferred") {
      const item = state.stage1.decisions[decision.id];
      if (item?.deferredUntil === undefined || item.note === undefined) {
        blockers.push(`${decision.id} is deferred without a decision point and rationale`);
      }
    }
  }
  return blockers;
}

function environmentGateBlockers(
  state: Stage1ProjectState,
  profile: ProjectProfile,
): string[] {
  const blockers: string[] = [];
  if (state.stage1.environment.length !== profile.environmentChecks.length) {
    blockers.push("Required environment checks have not been completed");
  }
  blockers.push(...requiredFailures(state.stage1.environment));
  return blockers;
}

function requiredFailures(results: Stage1ProjectState["stage1"]["environment"]): string[] {
  return results
    .filter((result) => result.required && !result.ok)
    .map((result) => `${result.id}: ${result.output || `exit ${String(result.exitCode)}`}`);
}

function assertDecisionMutationAllowed(state: Stage1ProjectState): void {
  if (state.stage1.approval !== undefined) {
    throw new Error("Architecture is already approved; reopen Stage1 before changing decisions");
  }
  if (["PROJECT_SCAFFOLDED", "STAGE1_COMPLETE", "CANCELLED"].includes(state.stage1.status)) {
    throw new Error(`Decisions cannot change in state ${state.stage1.status}`);
  }
}

function assertArchitectureNotApproved(state: Stage1ProjectState, action: string): void {
  if (state.stage1.approval !== undefined || state.stage1.scaffold !== undefined) {
    throw new Error(`${action} is prohibited after Stage1 approval`);
  }
}

function assertDependenciesClosed(state: Stage1ProjectState, decision: DecisionSpec): void {
  const open = decision.dependsOn.filter((dependency) => {
    const status = state.stage1.decisions[dependency]?.status;
    return status !== "answered" && status !== "delegated";
  });
  if (open.length > 0) {
    throw new Error(`Decision ${decision.id} has unresolved dependencies: ${open.join(", ")}`);
  }
}

function requireDecision(profile: ProjectProfile, decisionId: string): DecisionSpec {
  const decision = profile.decisions.find((item) => item.id === decisionId);
  if (decision === undefined) {
    throw new Error(`Unknown decision: ${decisionId}`);
  }
  return decision;
}

function aggregateHashes(hashes: Record<string, string>): string {
  const canonical = Object.entries(hashes)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([path, hash]) => `${path}\0${hash}`)
    .join("\n");
  return sha256(canonical);
}

function recordEvent(state: Stage1ProjectState, event: string, detail?: string): void {
  state.stage1.revision += 1;
  const item = {
    at: new Date().toISOString(),
    revision: state.stage1.revision,
    event,
    ...(detail === undefined ? {} : { detail }),
  };
  state.stage1.history.push(item);
}

function ensureFinalNewline(content: string): string {
  return `${content.replace(/\s+$/u, "")}\n`;
}

function sameValue(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function migrateDefaultIntent(
  state: Stage1ProjectState,
  previous: ProjectProfile,
  next: ProjectProfile,
  force: boolean,
): void {
  if (force || state.stage1.intent.goal === previous.defaults.goal) {
    state.stage1.intent.goal = next.defaults.goal;
  }
  if (force || state.stage1.intent.useCase === previous.defaults.useCase) {
    state.stage1.intent.useCase = next.defaults.useCase;
  }
  if (force || sameValue(state.stage1.intent.constraints, previous.defaults.constraints)) {
    state.stage1.intent.constraints = [...next.defaults.constraints];
  }
  if (force || sameValue(state.stage1.intent.exclusions, previous.defaults.exclusions)) {
    state.stage1.intent.exclusions = [...next.defaults.exclusions];
  }
}

function migrateEnvironmentEvidence(
  state: Stage1ProjectState,
  previous: ProjectProfile,
  next: ProjectProfile,
): void {
  const previousChecks = new Map(previous.environmentChecks.map((check) => [check.id, check]));
  const nextChecks = new Map(next.environmentChecks.map((check) => [check.id, check]));
  const executionUnchanged = state.stage1.environment.every((result) => {
    const oldCheck = previousChecks.get(result.id);
    const newCheck = nextChecks.get(result.id);
    return oldCheck !== undefined && newCheck !== undefined && sameValue(
      commandExecution(oldCheck),
      commandExecution(newCheck),
    );
  });
  if (!executionUnchanged || state.stage1.environment.length > next.environmentChecks.length) {
    state.stage1.environment = [];
    return;
  }
  state.stage1.environment = state.stage1.environment.map((result) => {
    const check = nextChecks.get(result.id);
    return check === undefined
      ? result
      : { ...result, description: check.description, required: check.required, runner: check.runner };
  });
}

function commandExecution(check: ProjectProfile["environmentChecks"][number]): object {
  return {
    runner: check.runner,
    command: check.command,
    args: check.args,
    script: check.script,
    required: check.required,
  };
}

function isNodeErrorWithCode(error: unknown, code: string): boolean {
  return error instanceof Error && "code" in error && error.code === code;
}
