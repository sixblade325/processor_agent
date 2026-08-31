import { spawnSync } from "node:child_process";
import { mkdir, readFile, rm, rmdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { gunzipSync, gzipSync } from "node:zlib";
import { parse, stringify } from "yaml";
import { runCommands } from "./commands.js";
import {
  atomicWriteText,
  atomicWriteBytes,
  pathExists,
  readText,
  resolveWithin,
  sha256,
  sha256Bytes,
  slugify,
  writeNewOrSame,
} from "./io.js";
import { loadProfile, validateProfile } from "./profile.js";
import {
  decisionForCurrentAction,
  decisionRevisionContext,
  hasCurrentSufficientResearch,
  normalizeResearchRequest,
  researchContextFingerprint,
  researchRequestFingerprint,
} from "./research.js";
import { renderFormalDocuments } from "./render.js";
import type {
  DecisionResearchState,
  DecisionRevisionRecord,
  DecisionRevisionSnapshot,
  DecisionSpec,
  InitOptions,
  LoadedProfile,
  ArchitectureReviewReport,
  ArchitectureReviewFinding,
  ProjectProfile,
  ProjectSpecDomainPatch,
  ProjectSpecHistory,
  ProjectSpecHistoryEvent,
  ProjectSpecTarget,
  ReviewCorrectionEvidenceSource,
  ReviewCorrectionRecordV1,
  ReviewCorrectionRecordV2,
  ReviewCorrectionRecord,
  Stage1ArchitectureReworkLink,
  Stage1ProjectSpec,
  Stage1NextAction,
  Stage1ProjectState,
  Stage1Summary,
} from "./types.js";

const STATE_PATH = ".assistant/project.yaml";
const PROJECT_SPEC_HISTORY_PREFIX = ".assistant/project-spec-history-";
const PROJECT_SPEC_HISTORY_PATH_PATTERN = /^\.assistant\/project-spec-history-([a-f0-9]{20})\.json\.gz$/u;

export interface LoadedProject {
  root: string;
  state: Stage1ProjectState;
  loadedProfile: LoadedProfile;
}

export interface ProfileRefreshOptions {
  adoptProfileDefaults?: boolean;
  resetChangedAdvice?: boolean;
}

export interface ReopenDecisionResult {
  loaded: LoadedProject;
  invalidatedDecisionIds: string[];
}

export interface ReviewCorrectionInput {
  findingCodes: string[];
  patch: unknown;
  rationale: string;
  evidenceSources: ReviewCorrectionEvidenceSource[];
  evidenceCoverage: Partial<Record<ProjectSpecTarget, string[]>>;
}

export interface ReviewCorrectionProposal {
  patch: unknown;
  rationale: string;
  evidenceSources: ReviewCorrectionEvidenceSource[];
  evidenceCoverage: Partial<Record<ProjectSpecTarget, string[]>>;
}

export interface ReviewCorrectionMigrationReport {
  project: string;
  sourceProtocolVersion: 1 | 2;
  targetProtocolVersion: 2;
  correctionCount: number;
  eventCount: number;
  legacyUnresolvedCount: number;
  beforeBytes: number;
  afterBytes: number;
  compressedHistoryBytes: number;
  totalAfterBytes: number;
  reductionRatio: number;
  beforeHistoryBytes: number;
  afterHistoryBytes: number;
  historyReductionRatio: number;
  currentProjectSpecSha256: string;
  replayedProjectSpecSha256: string;
  documentHashesUnchanged: boolean;
  approvalHashUnchanged: boolean;
  applied: boolean;
}

export interface BeginStage1ArchitectureReworkInput {
  id: string;
  sourceStage2Revision: number;
  repairKind: "decision" | "project_spec";
  repairTarget: string;
  summary: string;
  requiredClosure: string[];
  startedAt: string;
}

const PROJECT_SPEC_TARGETS = [
  "architecture.systemBoundary",
  "architecture.supportedInstructions",
  "architecture.invariants",
  "architecture.sharedFields",
  "architecture.globalProtocols",
  "architecture.counterRules",
  "architecture.modules",
  "architecture.stage2Order",
  "verification.referenceModel",
  "verification.layers",
  "verification.requiredScenarios",
  "verification.counters",
  "verification.decisionAcceptance",
] as const satisfies readonly ProjectSpecTarget[];

const PROJECT_SPEC_TARGET_SET = new Set<string>(PROJECT_SPEC_TARGETS);

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
  const initialProjectSpec: Stage1ProjectSpec = structuredClone({
    architecture: profile.architecture,
    verification: profile.verification,
  });
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
      projectSpec: initialProjectSpec,
      projectSpecHistory: {
        protocolVersion: 2,
        baseline: {
          profileDigest: loadedProfile.digest,
          projectSpecSha256: valueSha256(initialProjectSpec),
          value: structuredClone(initialProjectSpec),
        },
        events: [],
      },
      overriddenTargets: [],
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
  const openFinding = currentOpenReviewFinding(state);
  if (openFinding !== undefined && openFinding.repairKind !== "profile") {
    throw new Error(
      `Profile refresh cannot repair ${openFinding.repairKind} finding ${openFinding.code}`,
    );
  }
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
    const carriesUserState = decisionState.status !== "pending"
      || decisionState.advicePath !== undefined
      || decisionState.research !== undefined
      || decisionState.revisions !== undefined;
    if (!carriesUserState) {
      continue;
    }
    const previous = previousSpecs.get(decisionId);
    const replacement = nextSpecs.get(decisionId);
    if (
      previous === undefined
      || replacement === undefined
      || !sameDecisionContract(previous, replacement)
    ) {
      if (
        options.resetChangedAdvice === true
        && decisionState.status === "pending"
        && (decisionState.advicePath !== undefined || decisionState.research !== undefined)
        && replacement !== undefined
      ) {
        if (decisionState.advicePath !== undefined) {
          staleAdvicePaths.push(decisionState.advicePath);
        }
        delete decisionState.advicePath;
        delete decisionState.research;
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
  const previousProfileDigest = state.project.profile.digest;
  const previousProjectSpec = effectiveProjectSpec(state, loaded.loadedProfile.profile);
  const rebasedProjectSpec = rebaseProjectSpec(state, next.profile);
  state.stage1.decisions = decisions;
  state.project.profile.version = next.profile.version;
  state.project.profile.digest = next.digest;
  state.stage1.projectSpec = rebasedProjectSpec;
  if (!sameValue(previousProjectSpec, rebasedProjectSpec)) {
    appendProjectSpecEvent(state, {
      kind: "profile_refresh",
      before: previousProjectSpec,
      after: rebasedProjectSpec,
      fromProfileDigest: previousProfileDigest,
      toProfileDigest: next.digest,
    });
  }
  archiveCurrentReview(state);
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
      return status === "answered";
    });
  });
}

export function getNextStage1Action(
  state: Stage1ProjectState,
  profile: ProjectProfile,
): Stage1NextAction | undefined {
  const openFinding = state.stage1.review?.findings.find(
    (finding) => finding.status === "open" || finding.status === undefined,
  );
  if (openFinding !== undefined) {
    if (!hasReviewRepairMetadata(openFinding)) {
      return {
        kind: "audit_refresh_required",
        reason: "当前 audit 报告缺少 repairKind、repairTarget、requiredClosure 或 status，必须重新运行 audit。",
      };
    }
    return { kind: "review_finding", finding: openFinding };
  }
  const decision = findNextDecision(state, profile);
  if (decision === undefined) {
    return undefined;
  }
  const actionDecision = decisionForCurrentAction(decision, state);
  const revision = decisionRevisionContext(decision, state);
  if (decision.researchPolicy !== "required" || hasCurrentSufficientResearch(decision, state)) {
    return {
      kind: "decision_ready",
      decision: actionDecision,
      ...(revision === undefined ? {} : { revision }),
    };
  }
  const request = normalizeResearchRequest(decision);
  const contextFingerprint = researchContextFingerprint(decision, state);
  return {
    kind: "research_required",
    decision: actionDecision,
    request,
    fingerprint: researchRequestFingerprint(contextFingerprint, request),
    ...(revision === undefined ? {} : { revision }),
  };
}

export async function reopenDecision(
  projectPath: string,
  decisionId: string,
  reason: string,
): Promise<ReopenDecisionResult> {
  const normalizedReason = reason.trim();
  if (normalizedReason === "") {
    throw new Error("Reopening a Decision requires a reason");
  }
  const loaded = await loadStage1(projectPath);
  const { root, state } = loaded;
  const profile = loaded.loadedProfile.profile;
  assertDecisionMutationAllowed(state, decisionId);
  await assertGeneratedDocumentsCurrent(root, state);
  const decision = requireDecision(profile, decisionId);
  const current = state.stage1.decisions[decision.id];
  if (current === undefined) {
    throw new Error(`Decision state missing: ${decision.id}`);
  }
  if (current.status === "pending") {
    throw new Error(`Decision ${decision.id} is already pending`);
  }

  const { invalidatedDecisionIds, staleAdvicePaths } = reopenDecisionInState(
    state,
    profile,
    decision.id,
    normalizedReason,
  );
  await syncFormalDocuments(root, state, profile, true);
  for (const path of staleAdvicePaths) {
    await removeFileAndEmptyParents(root, path);
  }
  await saveState(root, state);
  return { loaded, invalidatedDecisionIds };
}

export async function beginStage1ArchitectureRework(
  loaded: LoadedProject,
  input: BeginStage1ArchitectureReworkInput,
): Promise<void> {
  const { root, state } = loaded;
  const profile = loaded.loadedProfile.profile;
  if (state.stage1.status !== "STAGE1_COMPLETE") {
    throw new Error(`Architecture rework requires STAGE1_COMPLETE, current state is ${state.stage1.status}`);
  }
  if (state.stage1.architectureRework !== undefined) {
    throw new Error(`Stage1 already has Architecture Rework ${state.stage1.architectureRework.id}`);
  }
  if (input.summary.trim() === "" || input.requiredClosure.length === 0) {
    throw new Error("Architecture rework requires a summary and closure conditions");
  }
  await assertApprovalCurrent(root, state);
  await assertGeneratedDocumentsCurrent(root, state);
  const approval = state.stage1.approval!;
  const link: Stage1ArchitectureReworkLink = {
    id: input.id,
    status: "active",
    sourceStage2Revision: input.sourceStage2Revision,
    previousStatus: state.stage1.status,
    previousApprovalSha256: approval.aggregateSha256,
    repairKind: input.repairKind,
    repairTarget: input.repairTarget,
    startedAt: input.startedAt,
  };
  state.stage1.approvalHistory = [
    ...(state.stage1.approvalHistory ?? []),
    structuredClone(approval),
  ];
  delete state.stage1.approval;
  archiveCurrentReview(state);
  state.stage1.architectureRework = link;

  if (input.repairKind === "decision") {
    requireDecision(profile, input.repairTarget);
    const result = reopenDecisionInState(
      state,
      profile,
      input.repairTarget,
      `Stage2 ${input.id}: ${input.summary.trim()}`,
    );
    await syncFormalDocuments(root, state, profile, true);
    for (const path of result.staleAdvicePaths) {
      await removeFileAndEmptyParents(root, path);
    }
  } else {
    requireProjectSpecHistoryV2(state);
    if (!isProjectSpecTarget(input.repairTarget)) {
      throw new Error(`Architecture rework has unsupported ProjectSpec target ${input.repairTarget}`);
    }
    state.stage1.status = "REVIEW_CORRECTION";
    state.stage1.blockers = [];
    await syncFormalDocuments(root, state, profile, true);
    const reviewedAggregateSha256 = aggregateHashes(state.stage1.generatedDocumentHashes);
    const reportPath = ".assistant/reviews/stage1.json";
    const report: ArchitectureReviewReport = {
      reviewedAggregateSha256,
      verdict: "fail",
      summary: input.summary.trim(),
      findings: [{
        severity: "error",
        code: `${input.id}_PROJECT_SPEC`,
        message: input.summary.trim(),
        artifact: projectSpecTargetArtifact(input.repairTarget),
        relatedDecision: "",
        repairKind: "project_spec",
        repairTarget: input.repairTarget,
        requiredClosure: [...input.requiredClosure],
        status: "open",
      }],
    };
    await atomicWriteText(resolveWithin(root, reportPath), `${JSON.stringify(report, null, 2)}\n`);
    state.stage1.review = {
      ...report,
      reviewedAt: input.startedAt,
      revision: state.stage1.revision,
      reportPath,
    };
  }
  recordEvent(state, "ARCHITECTURE_REWORK_STARTED", input.id);
}

function projectSpecTargetArtifact(target: string): string {
  if (target === "architecture.modules" || target === "architecture.stage2Order") {
    return "architecture/modules.yaml";
  }
  return target.startsWith("verification.")
    ? "verification/plan.md"
    : "architecture/overview.md";
}

export function closeStage1ArchitectureRework(
  state: Stage1ProjectState,
  reworkId: string,
): void {
  const rework = state.stage1.architectureRework;
  if (rework?.id !== reworkId || rework.status !== "reapproved") {
    throw new Error(`Stage1 Architecture Rework ${reworkId} has not been reapproved`);
  }
  state.stage1.architectureReworkHistory = [
    ...(state.stage1.architectureReworkHistory ?? []),
    structuredClone(rework),
  ];
  delete state.stage1.architectureRework;
  recordEvent(state, "ARCHITECTURE_REWORK_RETURNED_TO_STAGE2", reworkId);
}

export async function answerDecision(
  projectPath: string,
  decisionId: string,
  optionId: string,
  note?: string,
): Promise<LoadedProject> {
  const loaded = await loadStage1(projectPath);
  const { root, state } = loaded;
  const profile = loaded.loadedProfile.profile;
  assertDecisionMutationAllowed(state);
  await assertGeneratedDocumentsCurrent(root, state);
  const decision = requireDecision(profile, decisionId);
  assertDependenciesClosed(state, decision);
  assertDecisionPending(state, decision);
  await assertRequiredResearchComplete(root, state, decision);
  const option = decision.options.find((candidate) => candidate.id === optionId);
  if (option === undefined) {
    throw new Error(`Unknown option ${optionId} for ${decisionId}`);
  }
  const current = state.stage1.decisions[decisionId];
  const advicePath = current?.advicePath;
  const research = current?.research;
  const revisions = current?.revisions;
  state.stage1.decisions[decisionId] = {
    status: "answered",
    selectedOption: optionId,
    answeredAt: new Date().toISOString(),
    ...(note === undefined ? {} : { note }),
    ...(advicePath === undefined ? {} : { advicePath }),
    ...(research === undefined ? {} : { research }),
    ...(revisions === undefined ? {} : { revisions }),
  };
  archiveCurrentReview(state);
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
  assertDecisionPending(state, decision);
  await assertRequiredResearchComplete(root, state, decision);
  const current = state.stage1.decisions[decisionId];
  const advicePath = current?.advicePath;
  const research = current?.research;
  const revisions = current?.revisions;
  state.stage1.decisions[decisionId] = {
    status: "answered",
    customAnswer: answer.trim(),
    answeredAt: new Date().toISOString(),
    ...(note === undefined ? {} : { note }),
    ...(advicePath === undefined ? {} : { advicePath }),
    ...(research === undefined ? {} : { research }),
    ...(revisions === undefined ? {} : { revisions }),
  };
  archiveCurrentReview(state);
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
  assertDecisionPending(state, decision);
  await assertRequiredResearchComplete(root, state, decision);
  const current = state.stage1.decisions[decisionId];
  const advicePath = current?.advicePath;
  const research = current?.research;
  const revisions = current?.revisions;
  state.stage1.decisions[decisionId] = {
    status: "deferred",
    deferredUntil: deferredUntil.trim(),
    note: note.trim(),
    answeredAt: new Date().toISOString(),
    ...(advicePath === undefined ? {} : { advicePath }),
    ...(research === undefined ? {} : { research }),
    ...(revisions === undefined ? {} : { revisions }),
  };
  archiveCurrentReview(state);
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
  assertNoOpenReviewFinding(state, "Environment probing");
  await assertGeneratedDocumentsCurrent(root, state);
  state.stage1.environment = runCommands(profile.environmentChecks, root);
  archiveCurrentReview(state);
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
  assertNoOpenReviewFinding(state, "Stage1 review");
  await assertGeneratedDocumentsCurrent(root, state);
  const blockers = stage1GateBlockers(state, profile);
  if (blockers.length > 0) {
    throw new Error(`Stage1 review blocked:\n${blockers.map((item) => `- ${item}`).join("\n")}`);
  }
  state.stage1.status = "ARCHITECTURE_REVIEW";
  archiveCurrentReview(state);
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
  const unverifiedCorrections = (state.stage1.reviewCorrections ?? []).filter(
    (correction) => correction.status === "applied",
  );
  if (unverifiedCorrections.length > 0) {
    throw new Error(
      `Stage1 has unverified Review Corrections: ${unverifiedCorrections.map((item) => item.id).join(", ")}`,
    );
  }
  const architectureRework = state.stage1.architectureRework;
  if (architectureRework?.status === "active") {
    state.stage1.status = architectureRework.previousStatus === "STAGE1_COMPLETE"
      ? "STAGE1_COMPLETE"
      : "ARCHITECTURE_APPROVED";
    architectureRework.status = "reapproved";
    architectureRework.reapprovedAt = new Date().toISOString();
    recordEvent(state, "ARCHITECTURE_REWORK_REAPPROVED", architectureRework.id);
  } else {
    state.stage1.status = "ARCHITECTURE_APPROVED";
    recordEvent(state, "ARCHITECTURE_APPROVED");
  }
  const hashes = await syncFormalDocuments(root, state, profile, true);
  state.stage1.approval = {
    approvedAt: new Date().toISOString(),
    revision: state.stage1.revision,
    aggregateSha256: aggregateHashes(hashes),
    documentHashes: hashes,
  };
  if (architectureRework?.status === "reapproved") {
    architectureRework.newApprovalSha256 = state.stage1.approval.aggregateSha256;
    if (
      state.stage2?.schemaVersion === 2
      && state.stage2.architectureRework?.id === architectureRework.id
      && state.stage2.architectureRework.status === "stage1_rework"
    ) {
      state.stage2.architectureRework.status = "stage1_reapproved";
      state.stage2.architectureRework.newStage1ApprovalSha256 = state.stage1.approval.aggregateSha256;
      state.stage2.architectureRework.updatedAt = architectureRework.reapprovedAt!;
    }
  }
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
    answered: values.filter((item) => item.status === "answered").length,
    pending: values.filter((item) => item.status === "pending").length,
    deferred: values.filter((item) => item.status === "deferred").length,
    blockers: effectiveBlockers,
    approvalCurrent,
    projectSpecProtocolVersion: state.stage1.projectSpecHistory?.protocolVersion === 2 ? 2 : 1,
    projectSpecHistoryEvents: state.stage1.projectSpecHistory?.events.length ?? 0,
    legacyUnresolvedCorrections: (state.stage1.reviewCorrections ?? []).filter(
      (correction) => correction.status === "legacy_unresolved",
    ).length,
    ...(state.stage1.architectureRework === undefined
      ? {}
      : { architectureRework: structuredClone(state.stage1.architectureRework) }),
  };
  const nextAction = getNextStage1Action(state, profile);
  if (nextAction !== undefined) {
    summary.nextAction = nextAction;
    if (nextAction.kind === "decision_ready" || nextAction.kind === "research_required") {
      summary.nextDecision = nextAction.decision;
    }
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
  research?: DecisionResearchState,
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
  if (research !== undefined) {
    current.research = research;
  }
  archiveCurrentReview(state);
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
  const profile = loaded.loadedProfile.profile;
  if (state.stage1.status !== "ARCHITECTURE_REVIEW") {
    throw new Error(`Architecture audit requires ARCHITECTURE_REVIEW, current state is ${state.stage1.status}`);
  }
  await assertGeneratedDocumentsCurrent(root, state);
  const currentHash = aggregateHashes(state.stage1.generatedDocumentHashes);
  if (report.reviewedAggregateSha256 !== currentHash) {
    throw new Error("Architecture audit does not match the current Stage1 documents");
  }
  validateArchitectureReviewReport(report, profile);
  const reportPath = ".assistant/reviews/stage1.json";
  await atomicWriteText(
    resolveWithin(root, reportPath),
    `${JSON.stringify(report, null, 2)}\n`,
  );
  archiveCurrentReview(state);
  state.stage1.review = {
    ...report,
    reviewedAt: new Date().toISOString(),
    revision: state.stage1.revision,
    reportPath,
  };
  if (report.verdict === "pass") {
    for (const correction of state.stage1.reviewCorrections ?? []) {
      if (correction.status === "applied") {
        correction.status = "verified";
        correction.verifiedByAuditAggregateSha256 = currentHash;
      }
    }
    state.stage1.status = "ARCHITECTURE_REVIEW";
    state.stage1.blockers = [];
  } else {
    setStatusForReviewFinding(state, report.findings[0]);
  }
  recordEvent(state, "ARCHITECTURE_AUDITED", report.verdict);
  await saveState(root, state);
  return loaded;
}

export async function applyReviewCorrection(
  projectPath: string,
  input: ReviewCorrectionInput,
): Promise<LoadedProject> {
  const findingCodes = [...new Set(input.findingCodes.map((code) => code.trim()))].filter(Boolean);
  const rationale = input.rationale.trim();
  if (findingCodes.length === 0) {
    throw new Error("Review Correction requires at least one finding code");
  }
  if (rationale === "") {
    throw new Error("Review Correction requires a rationale");
  }

  const loaded = await loadStage1(projectPath);
  const { root, state } = loaded;
  const profile = loaded.loadedProfile.profile;
  requireProjectSpecHistoryV2(state);
  assertArchitectureNotApproved(state, "Review Correction");
  await assertGeneratedDocumentsCurrent(root, state);
  const review = state.stage1.review;
  if (review === undefined || review.verdict !== "fail") {
    throw new Error("Review Correction requires a failed architecture audit");
  }
  const currentFinding = currentOpenReviewFinding(state);
  if (currentFinding === undefined || !findingCodes.includes(currentFinding.code)) {
    throw new Error(
      `Current open audit finding ${currentFinding?.code ?? "missing"} must be handled first`,
    );
  }
  const findings = findingCodes.map((code) => {
    const finding = review.findings.find((item) => item.code === code);
    if (finding === undefined) {
      throw new Error(`Unknown audit finding: ${code}`);
    }
    if (finding.status !== "open") {
      throw new Error(`Audit finding ${code} is not open`);
    }
    if (finding.repairKind !== "project_spec") {
      throw new Error(`Audit finding ${code} must be repaired through ${finding.repairKind}`);
    }
    if (!isProjectSpecTarget(finding.repairTarget)) {
      throw new Error(`Audit finding ${code} has invalid project_spec target ${finding.repairTarget}`);
    }
    return finding;
  });

  const patchEntries = normalizeProjectSpecPatch(input.patch);
  const patchedTargets = new Set(patchEntries.map((entry) => entry.target));
  for (const finding of findings) {
    if (!patchedTargets.has(finding.repairTarget as ProjectSpecTarget)) {
      throw new Error(
        `Review Correction for ${finding.code} must update ${finding.repairTarget}`,
      );
    }
  }

  const currentSpec = effectiveProjectSpec(state, profile);
  const candidate = structuredClone(currentSpec);
  for (const entry of patchEntries) {
    setProjectSpecTarget(candidate, entry.target, entry.value);
  }
  const normalizedProfile = validateProfile({
    ...structuredClone(profile),
    architecture: candidate.architecture,
    verification: candidate.verification,
  });
  const normalizedSpec: Stage1ProjectSpec = {
    architecture: normalizedProfile.architecture,
    verification: normalizedProfile.verification,
  };
  const changedTargets = patchEntries
    .filter((entry) => !sameValue(
      getProjectSpecTarget(currentSpec, entry.target),
      getProjectSpecTarget(normalizedSpec, entry.target),
    ))
    .map((entry) => entry.target);
  if (changedTargets.length === 0) {
    throw new Error("Review Correction patch does not change project facts");
  }
  const evidenceSources = await validateCorrectionEvidenceSources(
    root,
    state,
    profile,
    input.evidenceSources,
  );
  const evidenceCoverage = validateEvidenceCoverage(
    changedTargets,
    evidenceSources,
    input.evidenceCoverage,
  );

  const timestamp = new Date().toISOString();
  const correctionNumber = (state.stage1.reviewCorrections?.length ?? 0) + 1;
  const correctionId = `S1_CORR_${String(correctionNumber).padStart(3, "0")}`;
  const event = appendProjectSpecEvent(state, {
    kind: "review_correction",
    before: currentSpec,
    after: normalizedSpec,
    correctionId,
    at: timestamp,
  });
  const correction: ReviewCorrectionRecordV2 = {
    schemaVersion: 2,
    id: correctionId,
    findingCodes,
    repairKind: "project_spec",
    changedTargets,
    requiredClosure: [...new Set(findings.flatMap((finding) => finding.requiredClosure))],
    eventId: event.id,
    rationale,
    findingSource: {
      reportPath: review.reportPath,
      reviewedAggregateSha256: review.reviewedAggregateSha256,
      findingCodes,
    },
    evidenceSources,
    evidenceCoverage,
    confirmedAt: timestamp,
    appliedAt: timestamp,
    status: "applied",
    legacy: false,
  };
  state.stage1.projectSpec = normalizedSpec;
  state.stage1.overriddenTargets = [...new Set([
    ...(state.stage1.overriddenTargets ?? []),
    ...changedTargets,
  ])];
  state.stage1.reviewCorrections = [...(state.stage1.reviewCorrections ?? []), correction];
  for (const finding of findings) {
    finding.status = "superseded";
  }
  recordEvent(
    state,
    "REVIEW_CORRECTION_APPLIED",
    JSON.stringify({ correctionId: correction.id, findingCodes, targets: correction.changedTargets }),
  );
  await syncFormalDocuments(root, state, profile, true);

  const nextFinding = review.findings.find((finding) => finding.status === "open");
  await atomicWriteText(
    resolveWithin(root, review.reportPath),
    `${JSON.stringify(reviewReportPayload(review), null, 2)}\n`,
  );
  if (nextFinding === undefined) {
    archiveCurrentReview(state);
    state.stage1.status = "ARCHITECTURE_REVIEW";
    state.stage1.blockers = [];
  } else {
    setStatusForReviewFinding(state, nextFinding);
  }
  await saveState(root, state);
  return loaded;
}

export function currentGeneratedAggregate(state: Stage1ProjectState): string {
  return aggregateHashes(state.stage1.generatedDocumentHashes);
}

function effectiveProjectSpec(
  state: Stage1ProjectState,
  profile: ProjectProfile,
): Stage1ProjectSpec {
  return structuredClone(state.stage1.projectSpec ?? {
    architecture: profile.architecture,
    verification: profile.verification,
  });
}

function rebaseProjectSpec(
  state: Stage1ProjectState,
  profile: ProjectProfile,
): Stage1ProjectSpec {
  const candidate: Stage1ProjectSpec = structuredClone({
    architecture: profile.architecture,
    verification: profile.verification,
  });
  const current = effectiveProjectSpec(state, profile);
  if (state.stage1.projectSpecHistory?.protocolVersion === 2) {
    for (const target of state.stage1.overriddenTargets ?? []) {
      setProjectSpecTarget(candidate, target, structuredClone(getProjectSpecTarget(current, target)));
    }
  } else {
    for (const correction of state.stage1.reviewCorrections ?? []) {
      if (isReviewCorrectionV2(correction)) {
        continue;
      }
      for (const change of correction.changes) {
        setProjectSpecTarget(candidate, change.target, structuredClone(change.nextValue));
      }
    }
  }
  const normalized = validateProfile({
    ...structuredClone(profile),
    architecture: candidate.architecture,
    verification: candidate.verification,
  });
  return {
    architecture: normalized.architecture,
    verification: normalized.verification,
  };
}

const PROJECT_SPEC_COLLECTION_KEYS: Partial<Record<
  ProjectSpecTarget,
  "id" | "name" | "decisionId"
>> = {
  "architecture.modules": "id",
  "architecture.sharedFields": "name",
  "architecture.globalProtocols": "id",
  "architecture.counterRules": "name",
  "verification.decisionAcceptance": "decisionId",
};

function valueSha256(value: unknown): string {
  return sha256(JSON.stringify(value));
}

function requireProjectSpecHistoryV2(state: Stage1ProjectState): ProjectSpecHistory {
  const history = state.stage1.projectSpecHistory;
  if (history?.protocolVersion !== 2) {
    throw new Error(
      "ProjectSpec history uses Review Correction v1; run `stage1 correction-migrate <path> --dry-run` and then `--apply`",
    );
  }
  return history;
}

function isReviewCorrectionV2(
  correction: ReviewCorrectionRecord,
): correction is ReviewCorrectionRecordV2 {
  return correction.schemaVersion === 2;
}

function createProjectSpecPatches(
  before: Stage1ProjectSpec,
  after: Stage1ProjectSpec,
): ProjectSpecDomainPatch[] {
  const patches: ProjectSpecDomainPatch[] = [];
  for (const target of PROJECT_SPEC_TARGETS) {
    const previous = getProjectSpecTarget(before, target);
    const next = getProjectSpecTarget(after, target);
    if (sameValue(previous, next)) {
      continue;
    }
    const beforeSha256 = valueSha256(previous);
    const afterSha256 = valueSha256(next);
    const keyField = PROJECT_SPEC_COLLECTION_KEYS[target];
    if (keyField !== undefined && Array.isArray(previous) && Array.isArray(next)) {
      const previousItems = keyedObjects(previous, keyField, `${target} before`);
      const nextItems = keyedObjects(next, keyField, `${target} after`);
      const add = [...nextItems]
        .filter(([key]) => !previousItems.has(key))
        .map(([, value]) => structuredClone(value));
      const remove = [...previousItems.keys()].filter((key) => !nextItems.has(key));
      const update: Extract<ProjectSpecDomainPatch, { kind: "keyed_collection" }>["update"] = [];
      for (const [key, nextItem] of nextItems) {
        const previousItem = previousItems.get(key);
        if (previousItem === undefined || sameValue(previousItem, nextItem)) {
          continue;
        }
        const fields: Record<string, unknown> = {};
        const removeFields: string[] = [];
        for (const field of new Set([...Object.keys(previousItem), ...Object.keys(nextItem)])) {
          if (field === keyField) {
            continue;
          }
          if (!(field in nextItem)) {
            removeFields.push(field);
          } else if (!sameValue(previousItem[field], nextItem[field])) {
            fields[field] = structuredClone(nextItem[field]);
          }
        }
        update.push({ key, fields, removeFields });
      }
      patches.push({
        target,
        kind: "keyed_collection",
        keyField,
        beforeSha256,
        afterSha256,
        add,
        remove,
        update,
        order: next.map((item) => String((item as Record<string, unknown>)[keyField])),
      });
      continue;
    }
    if (
      Array.isArray(previous)
      && Array.isArray(next)
      && previous.every((item) => typeof item === "string")
      && next.every((item) => typeof item === "string")
    ) {
      const previousStrings = previous as string[];
      const nextStrings = next as string[];
      patches.push({
        target,
        kind: "string_array",
        beforeSha256,
        afterSha256,
        add: nextStrings.filter((item) => !previousStrings.includes(item)),
        remove: previousStrings.filter((item) => !nextStrings.includes(item)),
        order: [...nextStrings],
      });
      continue;
    }
    patches.push({
      target,
      kind: "replace",
      beforeSha256,
      afterSha256,
      value: structuredClone(next),
    });
  }
  return patches;
}

function keyedObjects(
  value: unknown[],
  keyField: string,
  label: string,
): Map<string, Record<string, unknown>> {
  const result = new Map<string, Record<string, unknown>>();
  for (const raw of value) {
    const item = objectRecord(raw, label);
    const key = item[keyField];
    if (typeof key !== "string" || key.trim() === "" || result.has(key)) {
      throw new Error(`${label} has a missing or duplicate ${keyField}`);
    }
    result.set(key, item);
  }
  return result;
}

function applyProjectSpecPatch(
  spec: Stage1ProjectSpec,
  patch: ProjectSpecDomainPatch,
): void {
  const current = getProjectSpecTarget(spec, patch.target);
  if (valueSha256(current) !== patch.beforeSha256) {
    throw new Error(`ProjectSpec patch before hash mismatch for ${patch.target}`);
  }
  if (patch.kind === "replace") {
    setProjectSpecTarget(spec, patch.target, structuredClone(patch.value));
  } else if (patch.kind === "string_array") {
    if (!Array.isArray(current) || !current.every((item) => typeof item === "string")) {
      throw new Error(`ProjectSpec patch ${patch.target} expected a string array`);
    }
    const available = new Set((current as string[]).filter((item) => !patch.remove.includes(item)));
    for (const item of patch.add) {
      available.add(item);
    }
    if (patch.order.length !== available.size || patch.order.some((item) => !available.has(item))) {
      throw new Error(`ProjectSpec patch ${patch.target} has an invalid final order`);
    }
    setProjectSpecTarget(spec, patch.target, [...patch.order]);
  } else {
    if (!Array.isArray(current)) {
      throw new Error(`ProjectSpec patch ${patch.target} expected a keyed collection`);
    }
    const items = keyedObjects(current, patch.keyField, patch.target);
    for (const key of patch.remove) {
      if (!items.delete(key)) {
        throw new Error(`ProjectSpec patch ${patch.target} cannot remove unknown key ${key}`);
      }
    }
    for (const item of patch.add) {
      const key = item[patch.keyField];
      if (typeof key !== "string" || items.has(key)) {
        throw new Error(`ProjectSpec patch ${patch.target} cannot add key ${String(key)}`);
      }
      items.set(key, structuredClone(item));
    }
    for (const update of patch.update) {
      const item = items.get(update.key);
      if (item === undefined) {
        throw new Error(`ProjectSpec patch ${patch.target} cannot update unknown key ${update.key}`);
      }
      for (const field of update.removeFields) {
        delete item[field];
      }
      for (const [field, value] of Object.entries(update.fields)) {
        item[field] = structuredClone(value);
      }
    }
    if (patch.order.length !== items.size || patch.order.some((key) => !items.has(key))) {
      throw new Error(`ProjectSpec patch ${patch.target} has an invalid keyed order`);
    }
    setProjectSpecTarget(spec, patch.target, patch.order.map((key) => structuredClone(items.get(key)!)));
  }
  if (valueSha256(getProjectSpecTarget(spec, patch.target)) !== patch.afterSha256) {
    throw new Error(`ProjectSpec patch after hash mismatch for ${patch.target}`);
  }
}

interface AppendProjectSpecEventInput {
  kind: ProjectSpecHistoryEvent["kind"];
  before: Stage1ProjectSpec;
  after: Stage1ProjectSpec;
  at?: string;
  correctionId?: string;
  fromProfileDigest?: string;
  toProfileDigest?: string;
  releasedTarget?: ProjectSpecTarget;
}

function appendProjectSpecEvent(
  state: Stage1ProjectState,
  input: AppendProjectSpecEventInput,
): ProjectSpecHistoryEvent {
  const history = requireProjectSpecHistoryV2(state);
  const event: ProjectSpecHistoryEvent = {
    id: `S1_SPEC_EVT_${String(history.events.length + 1).padStart(3, "0")}`,
    kind: input.kind,
    revision: state.stage1.revision + 1,
    at: input.at ?? new Date().toISOString(),
    beforeSha256: valueSha256(input.before),
    afterSha256: valueSha256(input.after),
    patches: createProjectSpecPatches(input.before, input.after),
    ...(input.correctionId === undefined ? {} : { correctionId: input.correctionId }),
    ...(input.fromProfileDigest === undefined ? {} : { fromProfileDigest: input.fromProfileDigest }),
    ...(input.toProfileDigest === undefined ? {} : { toProfileDigest: input.toProfileDigest }),
    ...(input.releasedTarget === undefined ? {} : { releasedTarget: input.releasedTarget }),
  };
  if (event.patches.length === 0 && event.kind !== "override_release") {
    throw new Error(`ProjectSpec event ${event.kind} does not change project facts`);
  }
  const replay = structuredClone(input.before);
  for (const patch of event.patches) {
    applyProjectSpecPatch(replay, patch);
  }
  if (valueSha256(replay) !== event.afterSha256) {
    throw new Error(`ProjectSpec event ${event.id} failed replay validation`);
  }
  history.events.push(event);
  return event;
}

export function replayProjectSpecHistory(
  state: Stage1ProjectState,
  throughEventId?: string,
): Stage1ProjectSpec {
  const history = requireProjectSpecHistoryV2(state);
  const spec = structuredClone(history.baseline.value);
  if (valueSha256(spec) !== history.baseline.projectSpecSha256) {
    throw new Error("ProjectSpec history baseline hash mismatch");
  }
  for (const event of history.events) {
    if (valueSha256(spec) !== event.beforeSha256) {
      throw new Error(`ProjectSpec history before hash mismatch at ${event.id}`);
    }
    for (const patch of event.patches) {
      applyProjectSpecPatch(spec, patch);
    }
    if (valueSha256(spec) !== event.afterSha256) {
      throw new Error(`ProjectSpec history after hash mismatch at ${event.id}`);
    }
    if (event.id === throughEventId) {
      return spec;
    }
  }
  if (throughEventId !== undefined) {
    throw new Error(`Unknown ProjectSpec history event ${throughEventId}`);
  }
  return spec;
}

function assertProjectSpecHistoryCurrent(state: Stage1ProjectState): void {
  if (state.stage1.projectSpecHistory?.protocolVersion !== 2) {
    return;
  }
  if (state.stage1.projectSpec === undefined) {
    throw new Error("Review Correction v2 requires a current ProjectSpec");
  }
  const replayed = replayProjectSpecHistory(state);
  if (valueSha256(replayed) !== valueSha256(state.stage1.projectSpec)) {
    throw new Error("ProjectSpec history does not match the current ProjectSpec");
  }
}

async function validateCorrectionEvidenceSources(
  root: string,
  state: Stage1ProjectState,
  profile: ProjectProfile,
  sources: ReviewCorrectionEvidenceSource[],
): Promise<ReviewCorrectionEvidenceSource[]> {
  if (!Array.isArray(sources) || sources.length === 0) {
    throw new Error("Review Correction requires at least one Evidence source");
  }
  const ids = new Set<string>();
  const allowedKinds = new Set([
    "decision",
    "project_document",
    "research",
    "profile",
    "user_directive",
    "external",
  ]);
  const normalized: ReviewCorrectionEvidenceSource[] = [];
  for (const source of sources) {
    if (typeof source !== "object" || source === null) {
      throw new Error("Review Correction Evidence must be an object");
    }
    if (
      typeof source.id !== "string"
      || typeof source.locator !== "string"
      || typeof source.claim !== "string"
      || !allowedKinds.has(source.kind)
    ) {
      throw new Error("Review Correction Evidence has an invalid id, kind, locator, or claim");
    }
    const id = source.id.trim();
    const locator = source.locator.trim();
    const claim = source.claim.trim();
    if (id === "" || ids.has(id)) {
      throw new Error(`Review Correction Evidence ID is empty or duplicated: ${id}`);
    }
    ids.add(id);
    if (locator === "" || claim === "") {
      throw new Error(`Review Correction Evidence ${id} requires locator and claim`);
    }
    if (locator.replace(/\\/gu, "/").toLowerCase().includes(".assistant/reviews/")) {
      throw new Error(`Audit report cannot be used as Review Correction Evidence: ${locator}`);
    }
    if (
      !Array.isArray(source.locations)
      || source.locations.some((item) => typeof item !== "string")
    ) {
      throw new Error(`Review Correction Evidence ${id} requires locations`);
    }
    if (source.kind === "decision") {
      if (state.stage1.decisions[locator] === undefined) {
        throw new Error(`Review Correction Evidence ${id} references unknown Decision ${locator}`);
      }
      if (source.revision !== state.stage1.revision) {
        throw new Error(`Review Correction Evidence ${id} has a stale Decision revision`);
      }
    } else if (source.kind === "project_document") {
      if (source.digest === undefined) {
        throw new Error(`Review Correction Evidence ${id} requires a document digest`);
      }
      const path = resolveWithin(root, locator);
      if (!(await pathExists(path)) || sha256(await readText(path)) !== source.digest) {
        throw new Error(`Review Correction Evidence ${id} has a stale project document digest`);
      }
    } else if (source.kind === "research") {
      const decision = Object.values(state.stage1.decisions).find((item) =>
        item.advicePath === locator || item.research?.fingerprint === source.fingerprint
      );
      if (
        source.fingerprint === undefined
        || decision?.research?.fingerprint !== source.fingerprint
        || decision.advicePath === undefined
        || !(await pathExists(resolveWithin(root, decision.advicePath)))
      ) {
        throw new Error(`Review Correction Evidence ${id} has a stale Research fingerprint`);
      }
    } else if (source.kind === "profile") {
      if (source.digest !== state.project.profile.digest || locator !== profile.id) {
        throw new Error(`Review Correction Evidence ${id} has a stale Profile digest`);
      }
    } else if (source.kind === "user_directive" && claim.length < 8) {
      throw new Error(`Review Correction Evidence ${id} user_directive claim is not self-contained`);
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

function validateEvidenceCoverage(
  targets: ProjectSpecTarget[],
  sources: ReviewCorrectionEvidenceSource[],
  coverage: Partial<Record<ProjectSpecTarget, string[]>>,
): Partial<Record<ProjectSpecTarget, string[]>> {
  const sourceIds = new Set(sources.map((source) => source.id));
  const targetSet = new Set(targets);
  for (const target of Object.keys(coverage)) {
    if (!targetSet.has(target as ProjectSpecTarget)) {
      throw new Error(`Evidence coverage references unchanged target ${target}`);
    }
  }
  const normalized: Partial<Record<ProjectSpecTarget, string[]>> = {};
  for (const target of targets) {
    const ids = [...new Set(coverage[target] ?? [])];
    if (ids.length === 0) {
      throw new Error(`Review Correction target ${target} has no Evidence coverage`);
    }
    for (const id of ids) {
      if (!sourceIds.has(id)) {
        throw new Error(`Review Correction target ${target} references unknown Evidence ${id}`);
      }
    }
    normalized[target] = ids;
  }
  return normalized;
}

export async function migrateReviewCorrectionsV2(
  projectPath: string,
  apply: boolean,
): Promise<ReviewCorrectionMigrationReport> {
  const loaded = await loadStage1(projectPath);
  const { root, state } = loaded;
  await assertGeneratedDocumentsCurrent(root, state);
  const beforeText = await readText(resolveWithin(root, STATE_PATH));
  const beforeDocumentHashes = structuredClone(state.stage1.generatedDocumentHashes);
  const beforeApproval = structuredClone(state.stage1.approval);
  const sourceProtocolVersion: 1 | 2 = state.stage1.projectSpecHistory?.protocolVersion === 2 ? 2 : 1;
  const migrated = structuredClone(state);

  if (sourceProtocolVersion === 1) {
    const corrections = migrated.stage1.reviewCorrections ?? [];
    if (corrections.some(isReviewCorrectionV2)) {
      throw new Error("Review Correction state mixes v1 and v2 records");
    }
    const legacy = corrections as ReviewCorrectionRecordV1[];
    const currentSpec = effectiveProjectSpec(migrated, loaded.loadedProfile.profile);
    const baseline = structuredClone(currentSpec);
    for (const correction of [...legacy].reverse()) {
      for (const change of [...correction.changes].reverse()) {
        setProjectSpecTarget(baseline, change.target, structuredClone(change.previousValue));
      }
    }
    migrated.stage1.projectSpecHistory = {
      protocolVersion: 2,
      baseline: {
        profileDigest: migrated.project.profile.digest,
        projectSpecSha256: valueSha256(baseline),
        value: structuredClone(baseline),
      },
      events: [],
    };
    const compact: ReviewCorrectionRecordV2[] = [];
    let replay = structuredClone(baseline);
    for (const correction of legacy) {
      const next = structuredClone(replay);
      for (const change of correction.changes) {
        if (!sameValue(getProjectSpecTarget(replay, change.target), change.previousValue)) {
          throw new Error(
            `Review Correction v1 migration found a broken history chain at ${correction.id}:${change.target}`,
          );
        }
        setProjectSpecTarget(next, change.target, structuredClone(change.nextValue));
      }
      const event = appendProjectSpecEvent(migrated, {
        kind: "review_correction",
        before: replay,
        after: next,
        correctionId: correction.id,
        at: correction.appliedAt,
      });
      event.revision = correctionHistoryRevision(migrated, correction.id, event.revision);
      compact.push({
        schemaVersion: 2,
        id: correction.id,
        findingCodes: [...correction.findingCodes],
        repairKind: "project_spec",
        changedTargets: event.patches.map((patch) => patch.target),
        requiredClosure: [...correction.requiredClosure],
        eventId: event.id,
        rationale: correction.rationale,
        findingSource: {
          reportPath: ".assistant/reviews/stage1.json",
          reviewedAggregateSha256: correction.sourceAuditAggregateSha256,
          findingCodes: [...correction.findingCodes],
        },
        evidenceSources: [],
        evidenceCoverage: {},
        confirmedAt: correction.confirmedAt,
        appliedAt: correction.appliedAt,
        status: "legacy_unresolved",
        legacy: true,
        ...(correction.verifiedByAuditAggregateSha256 === undefined
          ? {}
          : { verifiedByAuditAggregateSha256: correction.verifiedByAuditAggregateSha256 }),
      });
      replay = next;
    }
    if (valueSha256(replay) !== valueSha256(currentSpec)) {
      throw new Error("Review Correction v1 migration does not reproduce current ProjectSpec");
    }
    migrated.stage1.reviewCorrections = compact;
    migrated.stage1.overriddenTargets = [...new Set(
      compact.flatMap((correction) => correction.changedTargets),
    )];
    recordEvent(migrated, "REVIEW_CORRECTION_V2_MIGRATED", `${String(compact.length)} corrections`);
  }

  const replayed = replayProjectSpecHistory(migrated);
  const current = effectiveProjectSpec(migrated, loaded.loadedProfile.profile);
  if (valueSha256(replayed) !== valueSha256(current)) {
    throw new Error("Review Correction v2 event chain does not match current ProjectSpec");
  }
  const artifacts = buildProjectStateStorageArtifacts(migrated);
  const beforeBytes = Buffer.byteLength(beforeText, "utf8");
  const afterBytes = Buffer.byteLength(artifacts.stateText, "utf8");
  const compressedHistoryBytes = artifacts.historyContent?.byteLength
    ?? migrated.stage1.projectSpecHistoryStorage?.compressedBytes
    ?? 0;
  const beforeHistoryBytes = projectSpecChangeHistoryBytes(state);
  const afterHistoryBytes = projectSpecChangeHistoryBytes(migrated);
  const report: ReviewCorrectionMigrationReport = {
    project: migrated.project.name,
    sourceProtocolVersion,
    targetProtocolVersion: 2,
    correctionCount: migrated.stage1.reviewCorrections?.length ?? 0,
    eventCount: migrated.stage1.projectSpecHistory?.events.length ?? 0,
    legacyUnresolvedCount: (migrated.stage1.reviewCorrections ?? []).filter(
      (correction) => correction.status === "legacy_unresolved",
    ).length,
    beforeBytes,
    afterBytes,
    compressedHistoryBytes,
    totalAfterBytes: afterBytes + compressedHistoryBytes,
    reductionRatio: beforeBytes === 0
      ? 0
      : (beforeBytes - afterBytes) / beforeBytes,
    beforeHistoryBytes,
    afterHistoryBytes,
    historyReductionRatio: beforeHistoryBytes === 0
      ? 0
      : (beforeHistoryBytes - afterHistoryBytes) / beforeHistoryBytes,
    currentProjectSpecSha256: valueSha256(current),
    replayedProjectSpecSha256: valueSha256(replayed),
    documentHashesUnchanged: sameValue(beforeDocumentHashes, migrated.stage1.generatedDocumentHashes),
    approvalHashUnchanged: sameValue(beforeApproval, migrated.stage1.approval),
    applied: apply && sourceProtocolVersion === 1,
  };
  if (apply && sourceProtocolVersion === 1) {
    await saveProjectState(root, migrated);
  }
  return report;
}

function projectSpecChangeHistoryBytes(state: Stage1ProjectState): number {
  const correctionIndexBytes = Buffer.byteLength(
    JSON.stringify(state.stage1.reviewCorrections ?? []),
    "utf8",
  );
  const history = state.stage1.projectSpecHistory;
  if (history?.protocolVersion !== 2) {
    return correctionIndexBytes;
  }
  const compressedBytes = state.stage1.projectSpecHistoryStorage?.compressedBytes
    ?? gzipSync(Buffer.from(JSON.stringify(history), "utf8"), { level: 9 }).byteLength;
  return correctionIndexBytes + compressedBytes;
}

function correctionHistoryRevision(
  state: Stage1ProjectState,
  correctionId: string,
  fallback: number,
): number {
  for (const event of state.stage1.history) {
    if (event.event !== "REVIEW_CORRECTION_APPLIED" || event.detail === undefined) {
      continue;
    }
    try {
      const detail = JSON.parse(event.detail) as { correctionId?: string };
      if (detail.correctionId === correctionId) {
        return event.revision;
      }
    } catch {
      continue;
    }
  }
  return fallback;
}

export async function releaseProjectSpecOverride(
  projectPath: string,
  target: string,
): Promise<LoadedProject> {
  if (!isProjectSpecTarget(target)) {
    throw new Error(`Unsupported ProjectSpec target ${target}`);
  }
  const loaded = await loadStage1(projectPath);
  const { root, state } = loaded;
  requireProjectSpecHistoryV2(state);
  assertArchitectureNotApproved(state, "ProjectSpec override release");
  await assertGeneratedDocumentsCurrent(root, state);
  if (!(state.stage1.overriddenTargets ?? []).includes(target)) {
    throw new Error(`ProjectSpec target ${target} is not overridden`);
  }
  const before = effectiveProjectSpec(state, loaded.loadedProfile.profile);
  const after = structuredClone(before);
  const profileSpec: Stage1ProjectSpec = {
    architecture: structuredClone(loaded.loadedProfile.profile.architecture),
    verification: structuredClone(loaded.loadedProfile.profile.verification),
  };
  setProjectSpecTarget(after, target, structuredClone(getProjectSpecTarget(profileSpec, target)));
  const normalizedProfile = validateProfile({
    ...structuredClone(loaded.loadedProfile.profile),
    architecture: after.architecture,
    verification: after.verification,
  });
  const normalized: Stage1ProjectSpec = {
    architecture: normalizedProfile.architecture,
    verification: normalizedProfile.verification,
  };
  appendProjectSpecEvent(state, {
    kind: "override_release",
    before,
    after: normalized,
    releasedTarget: target,
  });
  state.stage1.projectSpec = normalized;
  state.stage1.overriddenTargets = (state.stage1.overriddenTargets ?? []).filter(
    (item) => item !== target,
  );
  archiveCurrentReview(state);
  updateDecisionLoopState(state, loaded.loadedProfile.profile);
  recordEvent(state, "PROJECT_SPEC_OVERRIDE_RELEASED", target);
  await syncFormalDocuments(root, state, loaded.loadedProfile.profile, true);
  await saveState(root, state);
  return loaded;
}

function archiveCurrentReview(state: Stage1ProjectState): void {
  const review = state.stage1.review;
  if (review === undefined) {
    return;
  }
  const history = state.stage1.reviewHistory ?? [];
  const duplicate = history.some(
    (item) => item.reviewedAt === review.reviewedAt
      && item.reviewedAggregateSha256 === review.reviewedAggregateSha256,
  );
  if (!duplicate) {
    history.push(structuredClone(review));
  }
  state.stage1.reviewHistory = history;
  delete state.stage1.review;
}

function hasReviewRepairMetadata(finding: ArchitectureReviewFinding): boolean {
  return (
    ["decision", "project_spec", "profile"].includes(finding.repairKind)
    && typeof finding.repairTarget === "string"
    && finding.repairTarget.trim() !== ""
    && Array.isArray(finding.requiredClosure)
    && finding.requiredClosure.length > 0
    && (finding.status === "open" || finding.status === "superseded")
  );
}

function validateArchitectureReviewReport(
  report: ArchitectureReviewReport,
  profile: ProjectProfile,
): void {
  if (report.summary.trim() === "") {
    throw new Error("Architecture audit summary must not be empty");
  }
  if (report.verdict === "pass" && report.findings.length > 0) {
    throw new Error("A passing architecture audit must not contain findings");
  }
  if (report.verdict === "fail" && report.findings.length === 0) {
    throw new Error("A failing architecture audit must contain at least one finding");
  }
  const decisionIds = new Set(profile.decisions.map((decision) => decision.id));
  const codes = new Set<string>();
  for (const finding of report.findings) {
    if (finding.code.trim() === "" || codes.has(finding.code)) {
      throw new Error(`Architecture audit finding code is empty or duplicated: ${finding.code}`);
    }
    codes.add(finding.code);
    if (
      finding.message.trim() === ""
      || finding.artifact.trim() === ""
      || !hasReviewRepairMetadata(finding)
      || finding.status !== "open"
    ) {
      throw new Error(`Architecture audit finding ${finding.code} is incomplete`);
    }
    if (finding.requiredClosure.some((item) => item.trim() === "")) {
      throw new Error(`Architecture audit finding ${finding.code} has an empty closure item`);
    }
    if (finding.repairKind === "decision") {
      if (!decisionIds.has(finding.relatedDecision)) {
        throw new Error(`Architecture audit finding ${finding.code} references an unknown Decision`);
      }
      if (finding.repairTarget !== finding.relatedDecision) {
        throw new Error(`Decision finding ${finding.code} must target ${finding.relatedDecision}`);
      }
    } else if (finding.repairKind === "project_spec") {
      if (!isProjectSpecTarget(finding.repairTarget)) {
        throw new Error(
          `Project-spec finding ${finding.code} has unsupported target ${finding.repairTarget}`,
        );
      }
      if (finding.relatedDecision !== "" && !decisionIds.has(finding.relatedDecision)) {
        throw new Error(`Architecture audit finding ${finding.code} references an unknown Decision`);
      }
    } else if (!finding.repairTarget.startsWith("profile.")) {
      throw new Error(`Profile finding ${finding.code} must use a profile.* target`);
    }
  }
}

function setStatusForReviewFinding(
  state: Stage1ProjectState,
  finding: ArchitectureReviewFinding | undefined,
): void {
  if (finding === undefined) {
    throw new Error("Failed architecture audit has no open finding");
  }
  if (finding.repairKind === "project_spec") {
    state.stage1.status = "REVIEW_CORRECTION";
    state.stage1.blockers = [];
  } else if (finding.repairKind === "decision") {
    state.stage1.status = "DECISION_LOOP";
    state.stage1.blockers = [];
  } else {
    state.stage1.status = "NEEDS_REVISION";
    state.stage1.blockers = [
      `Profile repair required for ${finding.code}: ${finding.repairTarget}`,
    ];
  }
}

function normalizeProjectSpecPatch(
  value: unknown,
): Array<{ target: ProjectSpecTarget; value: unknown }> {
  const root = objectRecord(value, "Review Correction patch");
  const rootKeys = Object.keys(root);
  if (rootKeys.length === 0) {
    throw new Error("Review Correction patch must not be empty");
  }
  const unknownRoot = rootKeys.find((key) => key !== "architecture" && key !== "verification");
  if (unknownRoot !== undefined) {
    throw new Error(`Review Correction patch has unsupported section ${unknownRoot}`);
  }
  const entries: Array<{ target: ProjectSpecTarget; value: unknown }> = [];
  for (const sectionName of rootKeys) {
    const section = objectRecord(root[sectionName], `Review Correction patch.${sectionName}`);
    for (const [field, fieldValue] of Object.entries(section)) {
      const target = `${sectionName}.${field}`;
      if (!isProjectSpecTarget(target)) {
        throw new Error(`Review Correction patch has unsupported target ${target}`);
      }
      entries.push({ target, value: fieldValue });
    }
  }
  if (entries.length === 0) {
    throw new Error("Review Correction patch must update at least one field");
  }
  return entries;
}

export function isProjectSpecTarget(value: string): value is ProjectSpecTarget {
  return PROJECT_SPEC_TARGET_SET.has(value);
}

function getProjectSpecTarget(spec: Stage1ProjectSpec, target: ProjectSpecTarget): unknown {
  const [section, field] = target.split(".") as ["architecture" | "verification", string];
  return (spec[section] as unknown as Record<string, unknown>)[field];
}

function setProjectSpecTarget(
  spec: Stage1ProjectSpec,
  target: ProjectSpecTarget,
  value: unknown,
): void {
  const [section, field] = target.split(".") as ["architecture" | "verification", string];
  (spec[section] as unknown as Record<string, unknown>)[field] = value;
}

function objectRecord(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function reviewReportPayload(review: NonNullable<Stage1ProjectState["stage1"]["review"]>): ArchitectureReviewReport {
  return {
    reviewedAggregateSha256: review.reviewedAggregateSha256,
    verdict: review.verdict,
    summary: review.summary,
    findings: review.findings,
  };
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
4. 每个 Module ID 只对应一份 Design。每个源码和测试路径只允许一个 Module ID 拥有，路径归属由已批准 Design 声明。
5. \`experiments/\` 只保存可复现并经过确认的结论。
6. \`.assistant/\` 由 Processor Agent 维护。用户和普通实现任务不得手工修改其中的状态、哈希和审批记录。
7. 同一事实只保留一个权威正文，其他位置使用摘要和链接。

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
3. Workspace Agent 每轮根据磁盘中的 \`status\` 和 \`next\` 解释用户自然语言，只处理一个 ready Decision 或一个 required Research Task。
4. \`next\` 返回 \`research_required\` 时，必须先调用 \`processor-agent stage1 research\`，证据充分后才能提交该 Decision。
5. 用户要求研究仓库、论文、URL 或源码范围时，必须把问题和来源交给 Harness Research Task。影响正式决策的来源调研不得只存在于 Workspace Agent 主上下文。
6. Research Worker 负责来源与事实，Synthesis Worker 只基于结构化 Evidence 比较候选项。正式输出必须记录 cacheHit、fingerprint、runId、worker thread id 和 evidenceSufficient。
7. 用户修正已关闭 Decision 时必须调用 \`processor-agent stage1 reopen\` 并记录原因。Harness 自动使目标和全部传递依赖 Decision 的旧 advice 失效，随后按 \`next\` 逐项重新确认。
8. 修正模式必须以此前结论为基线，只处理修正原因指出的缺口。Profile 候选项只作参考，未被新证据否定的既有内容继续保留。
9. \`next.decision.recommendation=revise_previous\` 时，用户确认后通过 \`custom\` 提交 \`next.revision.proposedCustomAnswer\`。该字段缺失时先与用户闭合完整修订结论；用户明确确认原结论不变时可以按原结论提交。不得由 Agent 自行选择 Profile 默认项。
10. Agent 推荐不能视为用户回答或 Architecture Approval。推荐选项和自定义架构结论只有在用户明确确认后才能通过 Harness 提交，\`approve\` 也要求用户明确授权。
11. Harness 命令失败时保留当前状态并报告恢复条件，不得手工修改状态或哈希。
12. Workspace Agent 内不得递归调用 \`processor-agent open\`。
13. Stage2 状态、Design 投影、实现写入、验证证据和角色轮转必须调用 \`processor-agent stage2 ...\`，不得手工修改 \`.assistant/project.yaml\`。
14. Shadow Align 无源码和测试写权限。Active Coding 只能提交已批准 Design 中列出的源码和测试路径，已批准 Design 对 Active 只读。
15. 每个模块批准 Design 时都必须由用户明确选择 \`independent_workers\` 或 \`active_only\`，不得继承其他模块的选择。
16. \`independent_workers\` 启动独立 Static Review Worker 与 Verification Worker。\`active_only\` 的证据必须标记为非独立验证。
17. Agent 不能根据模块名、最近修改或对话历史猜测角色。每次执行以 Harness Task Envelope 中的 role、lease、state epoch、哈希和允许路径为准。
18. 实现发现 Design 缺口时必须运行 \`stage2 reopen\`，停止源码写入并记录反例。不得自行补充协议、状态或保守限制。
19. 编译、主验证、静态审查和验证审查全部通过后，模块才能进入 \`COMPLETE\`。
20. 双 Agent 轮转由 Harness 原子更新，Agent 不得直接修改自己或另一 Agent 的 assignment。
21. Review Correction 必须提交包含 patch、rationale、evidenceSources 和 evidenceCoverage 的 Proposal。Audit report 只作为 findingSource，不能作为新值 Evidence。
22. Stage2 暴露 Architecture 错误时必须使用 \`stage2 rework-start\` 返回 Stage1。不得通过 Module Design、源码补丁或手工状态修改掩盖 Architecture 缺口。
23. Architecture Rework 期间 Stage2 Agent 租约全部失效。Stage1 新 approval 后只能使用 \`stage2 rework-resume\` 恢复，并重新闭合失效 Topology Decision 和 \`NEEDS_REALIGN\` Unit。
24. Profile refresh 保留项目覆盖字段。只有用户明确确认后才能使用 \`stage1 release-override\` 交还 Profile 管理。
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
  const storage = value.stage1.projectSpecHistoryStorage;
  if (value.stage1.projectSpecHistory !== undefined && storage !== undefined) {
    throw new Error("ProjectSpec history has ambiguous inline and sidecar storage");
  }
  if (value.stage1.projectSpecHistory === undefined && storage !== undefined) {
    const pathMatch = PROJECT_SPEC_HISTORY_PATH_PATTERN.exec(storage.path);
    if (
      storage.protocolVersion !== 2
      || pathMatch === null
      || !/^[a-f0-9]{64}$/u.test(storage.sha256)
      || pathMatch[1] !== storage.sha256.slice(0, 20)
      || !Number.isSafeInteger(storage.eventCount)
      || storage.eventCount < 0
      || !Number.isSafeInteger(storage.compressedBytes)
      || storage.compressedBytes < 0
      || !Number.isSafeInteger(storage.uncompressedBytes)
      || storage.uncompressedBytes < 0
    ) {
      throw new Error("Invalid ProjectSpec history storage metadata");
    }
    const historyPath = resolveWithin(root, storage.path);
    if (!(await pathExists(historyPath))) {
      throw new Error(`ProjectSpec history sidecar is missing: ${storage.path}`);
    }
    const compressed = await readFile(historyPath);
    if (compressed.byteLength !== storage.compressedBytes) {
      throw new Error(`ProjectSpec history sidecar size mismatch: ${storage.path}`);
    }
    if (sha256Bytes(compressed) !== storage.sha256) {
      throw new Error(`ProjectSpec history sidecar hash mismatch: ${storage.path}`);
    }
    let history: ProjectSpecHistory;
    try {
      const historyText = gunzipSync(compressed).toString("utf8");
      if (Buffer.byteLength(historyText, "utf8") !== storage.uncompressedBytes) {
        throw new Error("uncompressed size does not match metadata");
      }
      history = JSON.parse(historyText) as ProjectSpecHistory;
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      throw new Error(`ProjectSpec history sidecar cannot be decoded: ${detail}`);
    }
    if (
      history === null
      || typeof history !== "object"
      || history.protocolVersion !== 2
      || !Array.isArray(history.events)
      || history.events.length !== storage.eventCount
      || history.baseline === undefined
    ) {
      throw new Error(`ProjectSpec history sidecar metadata mismatch: ${storage.path}`);
    }
    value.stage1.projectSpecHistory = history;
  }
  assertProjectSpecHistoryCurrent(value);
  return value;
}

async function saveState(root: string, state: Stage1ProjectState): Promise<void> {
  state.stage1.updatedAt = new Date().toISOString();
  await saveProjectState(root, state);
}

export async function saveProjectState(root: string, state: Stage1ProjectState): Promise<void> {
  const previousHistoryPath = state.stage1.projectSpecHistoryStorage?.path;
  const artifacts = buildProjectStateStorageArtifacts(state);
  if (artifacts.historyPath !== undefined && artifacts.historyContent !== undefined) {
    const absolute = resolveWithin(root, artifacts.historyPath);
    if (await pathExists(absolute)) {
      if (sha256Bytes(await readFile(absolute)) !== sha256Bytes(artifacts.historyContent)) {
        throw new Error(`Refusing to replace mismatched ProjectSpec history sidecar: ${artifacts.historyPath}`);
      }
    } else {
      await atomicWriteBytes(absolute, artifacts.historyContent);
    }
  }
  await atomicWriteText(
    resolveWithin(root, STATE_PATH),
    artifacts.stateText,
  );
  if (
    previousHistoryPath !== undefined
    && previousHistoryPath !== artifacts.historyPath
    && previousHistoryPath.startsWith(PROJECT_SPEC_HISTORY_PREFIX)
  ) {
    await rm(resolveWithin(root, previousHistoryPath), { force: true });
  }
}

interface ProjectStateStorageArtifacts {
  stateText: string;
  historyPath?: string;
  historyContent?: Buffer;
}

function buildProjectStateStorageArtifacts(state: Stage1ProjectState): ProjectStateStorageArtifacts {
  const stored = structuredClone(state);
  const history = state.stage1.projectSpecHistory;
  if (history === undefined) {
    if (state.stage1.projectSpecHistoryStorage !== undefined) {
      throw new Error("ProjectSpec history storage cannot be saved without hydrated history");
    }
    delete stored.stage1.projectSpecHistoryStorage;
    return { stateText: stringify(stored, { lineWidth: 0 }) };
  }
  if (history.protocolVersion !== 2) {
    throw new Error(`Unsupported ProjectSpec history protocol ${String(history.protocolVersion)}`);
  }
  assertProjectSpecHistoryCurrent(state);
  const historyText = JSON.stringify(history);
  const historyContent = gzipSync(Buffer.from(historyText, "utf8"), { level: 9 });
  const historySha256 = sha256Bytes(historyContent);
  const historyPath = `${PROJECT_SPEC_HISTORY_PREFIX}${historySha256.slice(0, 20)}.json.gz`;
  const storage = {
    protocolVersion: 2 as const,
    path: historyPath,
    sha256: historySha256,
    eventCount: history.events.length,
    compressedBytes: historyContent.byteLength,
    uncompressedBytes: Buffer.byteLength(historyText, "utf8"),
  };
  state.stage1.projectSpecHistoryStorage = storage;
  stored.stage1.projectSpecHistoryStorage = structuredClone(storage);
  delete stored.stage1.projectSpecHistory;
  return {
    stateText: stringify(stored, { lineWidth: 0 }),
    historyPath,
    historyContent,
  };
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
    return status === "answered" || (!decision.blocking && status === "deferred");
  });
  state.stage1.status = allDecisionsClosed ? "ARCHITECTURE_REVIEW" : "DECISION_LOOP";
  state.stage1.blockers = [];
}

function stage1GateBlockers(state: Stage1ProjectState, profile: ProjectProfile): string[] {
  const blockers = environmentGateBlockers(state, profile);
  for (const decision of profile.decisions) {
    const status = state.stage1.decisions[decision.id]?.status;
    if (decision.blocking && status !== "answered") {
      blockers.push(`${decision.id} is a blocking decision with status ${status ?? "missing"}`);
    }
    if (!decision.blocking && status === "pending") {
      blockers.push(`${decision.id} must be answered or explicitly deferred`);
    }
    if (status === "deferred") {
      const item = state.stage1.decisions[decision.id];
      if (item?.deferredUntil === undefined || item.note === undefined) {
        blockers.push(`${decision.id} is deferred without a decision point and rationale`);
      }
    }
    if (decision.researchPolicy === "required" && !hasRecordedSufficientResearch(state, decision)) {
      blockers.push(`${decision.id} requires sufficient research evidence`);
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

function assertDecisionMutationAllowed(
  state: Stage1ProjectState,
  reviewReopenDecisionId?: string,
): void {
  if (state.stage1.approval !== undefined) {
    throw new Error("Architecture is already approved; reopen Stage1 before changing decisions");
  }
  const activeArchitectureRework = state.stage1.architectureRework?.status === "active";
  if (
    ["PROJECT_SCAFFOLDED", "STAGE1_COMPLETE", "CANCELLED"].includes(state.stage1.status)
    && !activeArchitectureRework
  ) {
    throw new Error(`Decisions cannot change in state ${state.stage1.status}`);
  }
  const finding = currentOpenReviewFinding(state);
  if (finding !== undefined) {
    const allowedReopen = reviewReopenDecisionId !== undefined
      && finding.repairKind === "decision"
      && finding.repairTarget === reviewReopenDecisionId;
    if (!allowedReopen) {
      throw new Error(
        `Open audit finding ${finding.code} must be repaired through ${finding.repairKind}`,
      );
    }
  }
}

function assertNoOpenReviewFinding(state: Stage1ProjectState, action: string): void {
  const finding = currentOpenReviewFinding(state);
  if (finding !== undefined) {
    throw new Error(`${action} is blocked by open audit finding ${finding.code}`);
  }
}

function currentOpenReviewFinding(
  state: Stage1ProjectState,
): ArchitectureReviewFinding | undefined {
  return state.stage1.review?.findings.find(
    (finding) => finding.status === "open" || finding.status === undefined,
  );
}

function assertArchitectureNotApproved(state: Stage1ProjectState, action: string): void {
  const activeArchitectureRework = state.stage1.architectureRework?.status === "active";
  if (
    state.stage1.approval !== undefined
    || (state.stage1.scaffold !== undefined && !activeArchitectureRework)
  ) {
    throw new Error(`${action} is prohibited after Stage1 approval`);
  }
}

function assertDependenciesClosed(state: Stage1ProjectState, decision: DecisionSpec): void {
  const open = decision.dependsOn.filter((dependency) => {
    const status = state.stage1.decisions[dependency]?.status;
    return status !== "answered";
  });
  if (open.length > 0) {
    throw new Error(`Decision ${decision.id} has unresolved dependencies: ${open.join(", ")}`);
  }
}

function assertDecisionPending(state: Stage1ProjectState, decision: DecisionSpec): void {
  const status = state.stage1.decisions[decision.id]?.status;
  if (status !== "pending") {
    throw new Error(
      `Decision ${decision.id} has status ${status ?? "missing"}; run stage1 reopen before changing it`,
    );
  }
}

async function assertRequiredResearchComplete(
  root: string,
  state: Stage1ProjectState,
  decision: DecisionSpec,
): Promise<void> {
  if (decision.researchPolicy !== "required") {
    return;
  }
  const current = state.stage1.decisions[decision.id];
  const evidenceExists = current?.advicePath !== undefined
    && await pathExists(resolveWithin(root, current.advicePath));
  if (!evidenceExists || !hasCurrentSufficientResearch(decision, state)) {
    throw new Error(
      `Decision ${decision.id} requires current sufficient research; run stage1 research first`,
    );
  }
}

function hasRecordedSufficientResearch(
  state: Stage1ProjectState,
  decision: DecisionSpec,
): boolean {
  const current = state.stage1.decisions[decision.id];
  if (current?.advicePath === undefined) {
    return false;
  }
  return current.research?.evidenceSufficient ?? true;
}

function requireDecision(profile: ProjectProfile, decisionId: string): DecisionSpec {
  const decision = profile.decisions.find((item) => item.id === decisionId);
  if (decision === undefined) {
    throw new Error(`Unknown decision: ${decisionId}`);
  }
  return decision;
}

function findTransitiveDependents(
  profile: ProjectProfile,
  decisionId: string,
): DecisionSpec[] {
  const affected = new Set<string>();
  let changed = true;
  while (changed) {
    changed = false;
    for (const decision of profile.decisions) {
      if (affected.has(decision.id) || decision.id === decisionId) {
        continue;
      }
      if (decision.dependsOn.some((dependency) => dependency === decisionId || affected.has(dependency))) {
        affected.add(decision.id);
        changed = true;
      }
    }
  }
  return profile.decisions.filter((decision) => affected.has(decision.id));
}

function reopenDecisionInState(
  state: Stage1ProjectState,
  profile: ProjectProfile,
  decisionId: string,
  reason: string,
): { invalidatedDecisionIds: string[]; staleAdvicePaths: Set<string> } {
  const decision = requireDecision(profile, decisionId);
  const current = state.stage1.decisions[decision.id];
  if (current === undefined) {
    throw new Error(`Decision state missing: ${decision.id}`);
  }
  if (current.status === "pending") {
    throw new Error(`Decision ${decision.id} is already pending`);
  }
  const at = new Date().toISOString();
  const revision = state.stage1.revision + 1;
  const dependents = findTransitiveDependents(profile, decision.id);
  const staleAdvicePaths = new Set<string>();
  if (current.advicePath !== undefined) {
    staleAdvicePaths.add(current.advicePath);
  }
  state.stage1.decisions[decision.id] = {
    status: "pending",
    revisions: [
      ...(current.revisions ?? []),
      decisionRevisionRecord("reopened", current, decision.id, reason, at, revision),
    ],
  };
  for (const dependent of dependents) {
    const dependentState = state.stage1.decisions[dependent.id];
    if (dependentState === undefined) {
      throw new Error(`Decision state missing: ${dependent.id}`);
    }
    const carriesInvalidatedState = dependentState.status !== "pending"
      || dependentState.advicePath !== undefined
      || dependentState.research !== undefined;
    if (!carriesInvalidatedState) {
      continue;
    }
    if (dependentState.advicePath !== undefined) {
      staleAdvicePaths.add(dependentState.advicePath);
    }
    state.stage1.decisions[dependent.id] = {
      status: "pending",
      revisions: [
        ...(dependentState.revisions ?? []),
        decisionRevisionRecord(
          "dependency_invalidated",
          dependentState,
          decision.id,
          reason,
          at,
          revision,
        ),
      ],
    };
  }
  archiveCurrentReview(state);
  updateDecisionLoopState(state, profile);
  const invalidatedDecisionIds = dependents.map((item) => item.id);
  recordEvent(
    state,
    "DECISION_REOPENED",
    JSON.stringify({ decisionId, reason, invalidatedDecisionIds }),
  );
  return { invalidatedDecisionIds, staleAdvicePaths };
}

function decisionRevisionRecord(
  kind: DecisionRevisionRecord["kind"],
  previous: Stage1ProjectState["stage1"]["decisions"][string],
  causeDecisionId: string,
  reason: string,
  at: string,
  revision: number,
): DecisionRevisionRecord {
  return {
    kind,
    at,
    revision,
    reason,
    causeDecisionId,
    previous: decisionRevisionSnapshot(previous),
  };
}

function decisionRevisionSnapshot(
  state: Stage1ProjectState["stage1"]["decisions"][string],
): DecisionRevisionSnapshot {
  return {
    status: state.status,
    ...(state.selectedOption === undefined ? {} : { selectedOption: state.selectedOption }),
    ...(state.customAnswer === undefined ? {} : { customAnswer: state.customAnswer }),
    ...(state.note === undefined ? {} : { note: state.note }),
    ...(state.deferredUntil === undefined ? {} : { deferredUntil: state.deferredUntil }),
    ...(state.answeredAt === undefined ? {} : { answeredAt: state.answeredAt }),
    ...(state.advicePath === undefined ? {} : { advicePath: state.advicePath }),
    ...(state.research?.fingerprint === undefined
      ? {}
      : { researchFingerprint: state.research.fingerprint }),
  };
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

function sameDecisionContract(left: DecisionSpec, right: DecisionSpec): boolean {
  return sameValue(
    { ...left, researchPolicy: null },
    { ...right, researchPolicy: null },
  );
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
