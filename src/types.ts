export type Stage1Status =
  | "NEW"
  | "WORKSPACE_INITIALIZED"
  | "INTENT_CAPTURED"
  | "BLUEPRINT_DRAFTED"
  | "DECISION_LOOP"
  | "RESEARCHING"
  | "ARCHITECTURE_REVIEW"
  | "REVIEW_CORRECTION"
  | "ARCHITECTURE_APPROVED"
  | "PROJECT_SCAFFOLDED"
  | "STAGE1_COMPLETE"
  | "NEEDS_REVISION"
  | "BLOCKED"
  | "CANCELLED";

export type DecisionStatus = "pending" | "answered" | "deferred";

export type ResearchPolicy = "required" | "conditional" | "none";

export type RunnerKind = "host" | "wsl";

export interface CommandSpec {
  id: string;
  description: string;
  runner: RunnerKind;
  command?: string;
  args?: string[];
  script?: string;
  required: boolean;
}

export interface DecisionOption {
  id: string;
  label: string;
  summary: string;
  consequences: string[];
}

export interface DecisionSpec {
  id: string;
  topic: string;
  question: string;
  whyNow: string;
  blocking: boolean;
  researchPolicy: ResearchPolicy;
  dependsOn: string[];
  knownFacts: string[];
  recommendation: string;
  affectedArtifacts: string[];
  options: DecisionOption[];
}

export interface ModuleSpec {
  id: string;
  responsibility: string;
  stateOwnership: string[];
  dependsOn: string[];
  interfaces: string[];
}

export interface SharedFieldSpec {
  name: string;
  semantics: string;
  producer: string;
  consumers: string[];
  validFrom: string;
  validUntil: string;
}

export interface GlobalProtocolSpec {
  id: string;
  owner: string;
  rules: string[];
}

export interface CounterRuleSpec {
  name: string;
  increment: string;
  exclusions: string[];
}

export interface DecisionAcceptanceSpec {
  decisionId: string;
  criteria: string[];
}

export interface ScaffoldFileSpec {
  path: string;
  content: string;
}

export interface ProjectProfile {
  schemaVersion: number;
  id: string;
  version: string;
  displayName: string;
  description: string;
  defaults: {
    projectName: string;
    goal: string;
    useCase: string;
    constraints: string[];
    exclusions: string[];
  };
  environmentChecks: CommandSpec[];
  decisions: DecisionSpec[];
  architecture: {
    systemBoundary: string[];
    supportedInstructions: string[];
    invariants: string[];
    sharedFields: SharedFieldSpec[];
    globalProtocols: GlobalProtocolSpec[];
    counterRules: CounterRuleSpec[];
    modules: ModuleSpec[];
    stage2Order: string[];
  };
  verification: {
    referenceModel: string;
    layers: string[];
    requiredScenarios: string[];
    counters: string[];
    decisionAcceptance: DecisionAcceptanceSpec[];
  };
  scaffold: {
    files: ScaffoldFileSpec[];
    smokeChecks: CommandSpec[];
  };
}

export interface LoadedProfile {
  profile: ProjectProfile;
  path: string;
  digest: string;
}

export interface ProjectIntent {
  goal: string;
  useCase: string;
  constraints: string[];
  exclusions: string[];
}

export interface CommandResult {
  id: string;
  description: string;
  runner: RunnerKind;
  command: string;
  required: boolean;
  ok: boolean;
  exitCode: number | null;
  output: string;
  checkedAt: string;
}

export interface ResearchRequest {
  decisionId: string;
  question: string;
  sources: string[];
  scope?: string;
}

export interface ResearchSourceEvidence {
  kind: "project" | "url" | "repository" | "paper" | "other";
  locator: string;
  revision: string;
  accessedAt: string;
  locations: string[];
}

export interface ResearchFact {
  claim: string;
  source: string;
  confidence: "low" | "medium" | "high";
}

export interface ResearchEvidence {
  decisionId: string;
  sources: ResearchSourceEvidence[];
  facts: ResearchFact[];
  conflicts: string[];
  gaps: string[];
  evidenceSufficient: boolean;
  stopReason: string;
}

export interface DecisionSynthesis {
  decisionId: string;
  summary: string;
  optionAnalysis: Array<{
    optionId: string;
    benefits: string[];
    costs: string[];
    risks: string[];
  }>;
  recommendation: string;
  proposedCustomAnswer?: string | null;
  rationale: string[];
  openQuestions: string[];
}

export interface DecisionAdvice extends DecisionSynthesis {
  schemaVersion?: number;
  facts: ResearchFact[];
  research?: {
    request: ResearchRequest;
    fingerprint: string;
    contextFingerprint: string;
    evidence: ResearchEvidence;
    completedAt: string;
    runId: string;
    source: "worker" | "legacy";
    researchThreadId?: string;
    synthesisThreadId?: string;
  };
}

export interface DecisionResearchState {
  status: "complete";
  request: ResearchRequest;
  fingerprint: string;
  contextFingerprint: string;
  evidenceSufficient: boolean;
  completedAt: string;
  runId: string;
  source: "worker" | "legacy";
  recommendation?: string;
  proposedCustomAnswer?: string;
  researchThreadId?: string;
  synthesisThreadId?: string;
}

export interface ResearchExecutionResult {
  source: "worker" | "cache" | "legacy_cache";
  cacheHit: boolean;
  decisionId: string;
  fingerprint: string;
  contextFingerprint: string;
  runId: string;
  evidenceSufficient: boolean;
  researchThreadId?: string;
  synthesisThreadId?: string;
  advice: DecisionAdvice;
}

export interface DecisionRevisionSnapshot {
  status: DecisionStatus;
  selectedOption?: string;
  customAnswer?: string;
  note?: string;
  deferredUntil?: string;
  answeredAt?: string;
  advicePath?: string;
  researchFingerprint?: string;
}

export interface DecisionRevisionRecord {
  kind: "reopened" | "dependency_invalidated";
  at: string;
  revision: number;
  reason: string;
  causeDecisionId: string;
  previous: DecisionRevisionSnapshot;
}

export interface DecisionRevisionContext {
  kind: DecisionRevisionRecord["kind"];
  revision: number;
  reason: string;
  causeDecisionId: string;
  previousStatus: DecisionStatus;
  previousConclusion?: string;
  previousNote?: string;
  proposedCustomAnswer?: string;
}

export interface DecisionState {
  status: DecisionStatus;
  selectedOption?: string;
  customAnswer?: string;
  note?: string;
  deferredUntil?: string;
  answeredAt?: string;
  advicePath?: string;
  research?: DecisionResearchState;
  revisions?: DecisionRevisionRecord[];
}

export interface ApprovalRecord {
  approvedAt: string;
  revision: number;
  aggregateSha256: string;
  documentHashes: Record<string, string>;
}

export type ReviewRepairKind = "decision" | "project_spec" | "profile";

export type ReviewFindingStatus = "open" | "superseded";

export type ProjectSpecTarget =
  | "architecture.systemBoundary"
  | "architecture.supportedInstructions"
  | "architecture.invariants"
  | "architecture.sharedFields"
  | "architecture.globalProtocols"
  | "architecture.counterRules"
  | "architecture.modules"
  | "architecture.stage2Order"
  | "verification.referenceModel"
  | "verification.layers"
  | "verification.requiredScenarios"
  | "verification.counters"
  | "verification.decisionAcceptance";

export interface Stage1ProjectSpec {
  architecture: ProjectProfile["architecture"];
  verification: ProjectProfile["verification"];
}

export interface ArchitectureReviewFinding {
  severity: "error" | "warning" | "note";
  code: string;
  message: string;
  artifact: string;
  relatedDecision: string;
  repairKind: ReviewRepairKind;
  repairTarget: string;
  requiredClosure: string[];
  status: ReviewFindingStatus;
}

export interface ArchitectureReviewReport {
  reviewedAggregateSha256: string;
  verdict: "pass" | "fail";
  summary: string;
  findings: ArchitectureReviewFinding[];
}

export interface ArchitectureReviewRecord extends ArchitectureReviewReport {
  reviewedAt: string;
  revision: number;
  reportPath: string;
}

export interface ReviewCorrectionChange {
  target: ProjectSpecTarget;
  previousValue: unknown;
  nextValue: unknown;
}

export interface ReviewCorrectionRecord {
  id: string;
  findingCodes: string[];
  repairKind: "project_spec";
  repairTargets: ProjectSpecTarget[];
  requiredClosure: string[];
  changes: ReviewCorrectionChange[];
  rationale: string;
  sources: string[];
  confirmedAt: string;
  appliedAt: string;
  status: "applied" | "verified";
  sourceAuditAggregateSha256: string;
  verifiedByAuditAggregateSha256?: string;
}

export interface ScaffoldRecord {
  createdAt: string;
  fileHashes: Record<string, string>;
  smokeChecks: CommandResult[];
}

export interface HistoryEvent {
  at: string;
  revision: number;
  event: string;
  detail?: string;
}

export type Stage2Status = "MODULE_LOOP" | "BASELINE_READY" | "BLOCKED" | "CANCELLED";

export type Stage2ModuleStatus =
  | "PENDING"
  | "DESIGNING"
  | "AWAITING_APPROVAL"
  | "IMPLEMENTING"
  | "VERIFYING"
  | "COMPLETE"
  | "NEEDS_REALIGN"
  | "BLOCKED"
  | "CANCELLED";

export type Stage2VerificationMode = "independent_workers" | "active_only";

export type Stage2AgentSlot = "A" | "B";

export type Stage2AgentRole = "shadow" | "active" | "idle";

export type Stage2AgentTask =
  | "shadow_design"
  | "active_implementation"
  | "active_static_review"
  | "active_verification_review"
  | "independent_static_review"
  | "independent_verification";

export interface Stage2SkillReference {
  id: string;
  contentHash: string;
}

export interface Stage2DesignField {
  name: string;
  semantics: string;
  producer: string;
  storage: string;
  consumers: string[];
  lifetime: string;
}

export interface Stage2DesignEvent {
  name: string;
  condition: string;
  effects: string[];
  priority: string;
}

export interface Stage2DesignProposal {
  schemaVersion: 1;
  moduleId: string;
  summary: string;
  architectureReferences: string[];
  sourceReferences: string[];
  explicitExclusions: string[];
  interfaces: string[];
  fields: Stage2DesignField[];
  events: Stage2DesignEvent[];
  cycleBehavior: string[];
  exceptionalBehavior: string[];
  invariants: string[];
  sharedInterfaceChanges: string[];
  affectedModules: string[];
  implementation: {
    sourcePaths: string[];
    testPaths: string[];
  };
  acceptance: {
    assertions: string[];
    directedTests: string[];
    commands: CommandSpec[];
    expectedResults: string[];
  };
  risks: string[];
  openQuestions: string[];
}

export interface Stage2DesignApproval {
  approvedAt: string;
  designRevision: number;
  designSha256: string;
  architectureHashes: Record<string, string>;
  verificationMode: Stage2VerificationMode;
}

export interface Stage2DesignRecord {
  revision: number;
  draftedAt: string;
  path: string;
  documentSha256: string;
  runId: string;
  threadId: string;
  skills: Stage2SkillReference[];
  proposal: Stage2DesignProposal;
  approval?: Stage2DesignApproval;
}

export interface Stage2ImplementationFile {
  path: string;
  kind: "source" | "test";
  baseSha256: string | null;
  content: string;
  purpose: string;
}

export interface Stage2DesignGap {
  reason: string;
  counterexample: string;
}

export interface Stage2ImplementationProposal {
  schemaVersion: 1;
  moduleId: string;
  designSha256: string;
  summary: string;
  files: Stage2ImplementationFile[];
  notes: string[];
  designGap: Stage2DesignGap | null;
}

export interface Stage2ImplementationRecord {
  appliedAt: string;
  designSha256: string;
  aggregateSha256: string;
  fileHashes: Record<string, string>;
  changedPaths: string[];
  summary: string;
  runId: string;
  threadId: string;
  skills: Stage2SkillReference[];
}

export interface Stage2ReviewFinding {
  severity: "error" | "warning" | "note";
  code: string;
  message: string;
  artifact: string;
  requiredAction: string;
}

export interface Stage2ReviewReport {
  schemaVersion: 1;
  kind: "static" | "verification";
  moduleId: string;
  designSha256: string;
  implementationAggregateSha256: string;
  verdict: "pass" | "fail";
  summary: string;
  findings: Stage2ReviewFinding[];
  commandResults: CommandResult[];
}

export interface Stage2WorkerEvidence {
  task: Stage2AgentTask;
  runId: string;
  completedAt: string;
  performedBy: "active" | "worker";
  threadId?: string;
  skills: Stage2SkillReference[];
  report: Stage2ReviewReport;
}

export interface Stage2VerificationRecord {
  mode: Stage2VerificationMode;
  primaryRanAt: string;
  primaryCommands: CommandResult[];
  finalCommands?: CommandResult[];
  staticReview?: Stage2WorkerEvidence;
  verificationReview?: Stage2WorkerEvidence;
  independent: boolean;
  waivedByUser: boolean;
  documentPath: string;
  documentSha256?: string;
  completedAt?: string;
}

export interface Stage2ModuleState {
  id: string;
  order: number;
  status: Stage2ModuleStatus;
  architecture: ModuleSpec;
  design?: Stage2DesignRecord;
  implementation?: Stage2ImplementationRecord;
  verification?: Stage2VerificationRecord;
  blockers: string[];
  reopened: Array<{
    at: string;
    reason: string;
    previousDesignSha256?: string;
  }>;
}

export interface Stage2AgentAssignment {
  slot: Stage2AgentSlot;
  role: Stage2AgentRole;
  status: "idle" | "assigned" | "working" | "waiting" | "blocked";
  lease: string;
  observedEpoch: number;
  moduleId?: string;
  threadId?: string;
}

export interface Stage2HistoryEvent {
  at: string;
  revision: number;
  stateEpoch: number;
  event: string;
  moduleId?: string;
  detail?: string;
}

export interface Stage2ProjectStage {
  schemaVersion: 1;
  status: Stage2Status;
  revision: number;
  stateEpoch: number;
  initializedAt: string;
  updatedAt: string;
  moduleOrder: string[];
  modules: Record<string, Stage2ModuleState>;
  agents: Record<Stage2AgentSlot, Stage2AgentAssignment>;
  blockers: string[];
  history: Stage2HistoryEvent[];
}

export interface Stage2TaskEnvelope {
  schemaVersion: 1;
  task: Stage2AgentTask;
  project: {
    name: string;
    root: string;
  };
  module: ModuleSpec;
  assignment: {
    slot: Stage2AgentSlot;
    role: Stage2AgentRole;
    lease: string;
    stateEpoch: number;
  };
  authority: {
    repositoryRules: string;
    architectureHashes: Record<string, string>;
    designPath?: string;
    designSha256?: string;
  };
  skills: Stage2SkillReference[];
  allowedPaths: string[];
  explicitExclusions: string[];
  verificationMode?: Stage2VerificationMode;
  nextPermittedAction: string;
}

export type Stage2NextAction =
  | {
      kind: "shadow_design";
      moduleId: string;
      slot: Stage2AgentSlot;
    }
  | {
      kind: "design_revision";
      moduleId: string;
      slot: Stage2AgentSlot;
      designPath: string;
      designSha256: string;
      issues: string[];
    }
  | {
      kind: "design_approval";
      moduleId: string;
      slot: Stage2AgentSlot;
      designPath: string;
      designSha256: string;
    }
  | {
      kind: "waiting_for_rotation";
      moduleId: string;
      slot: Stage2AgentSlot;
    }
  | {
      kind: "active_implementation";
      moduleId: string;
      slot: Stage2AgentSlot;
    }
  | {
      kind: "verification";
      moduleId: string;
      slot: Stage2AgentSlot;
      mode: Stage2VerificationMode;
    }
  | {
      kind: "blocked";
      moduleId: string;
      blockers: string[];
    }
  | {
      kind: "baseline_complete";
    };

export interface Stage2Summary {
  projectName: string;
  status: Stage2Status;
  revision: number;
  stateEpoch: number;
  complete: number;
  total: number;
  active?: Stage2AgentAssignment;
  shadow?: Stage2AgentAssignment;
  readyActions: Stage2NextAction[];
  blockers: string[];
}

export interface Stage1ProjectState {
  schemaVersion: number;
  project: {
    id: string;
    name: string;
    root: ".";
    profile: {
      id: string;
      version: string;
      digest: string;
      snapshot: string;
    };
  };
  stage1: {
    status: Stage1Status;
    revision: number;
    createdAt: string;
    updatedAt: string;
    intent: ProjectIntent;
    decisions: Record<string, DecisionState>;
    environment: CommandResult[];
    projectSpec?: Stage1ProjectSpec;
    generatedDocumentHashes: Record<string, string>;
    review?: ArchitectureReviewRecord;
    reviewHistory?: ArchitectureReviewRecord[];
    reviewCorrections?: ReviewCorrectionRecord[];
    approval?: ApprovalRecord;
    scaffold?: ScaffoldRecord;
    blockers: string[];
    history: HistoryEvent[];
  };
  stage2?: Stage2ProjectStage;
}

export interface InitOptions {
  projectName?: string;
  goal?: string;
  useCase?: string;
  constraints?: string[];
  exclusions?: string[];
  skipProbe?: boolean;
}

export interface Stage1Summary {
  projectName: string;
  profile: string;
  status: Stage1Status;
  revision: number;
  answered: number;
  pending: number;
  deferred: number;
  nextDecision?: DecisionSpec;
  nextAction?: Stage1NextAction;
  blockers: string[];
  approvalCurrent: boolean;
}

export type Stage1NextAction =
  | {
      kind: "review_finding";
      finding: ArchitectureReviewFinding;
    }
  | {
      kind: "audit_refresh_required";
      reason: string;
    }
  | {
      kind: "research_required";
      decision: DecisionSpec;
      request: ResearchRequest;
      fingerprint: string;
      revision?: DecisionRevisionContext;
    }
  | {
      kind: "decision_ready";
      decision: DecisionSpec;
      revision?: DecisionRevisionContext;
    };
