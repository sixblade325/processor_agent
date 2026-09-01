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

export interface ArchitectureRoleSpec {
  id: string;
  responsibility: string;
}

export interface GlobalProtocolSpec {
  id: string;
  ownerRole: string;
  producerRoles: string[];
  consumerRoles: string[];
  affectedResources: string[];
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
    roles: ArchitectureRoleSpec[];
    systemBoundary: string[];
    supportedInstructions: string[];
    invariants: string[];
    sharedFields: SharedFieldSpec[];
    globalProtocols: GlobalProtocolSpec[];
    counterRules: CounterRuleSpec[];
  };
  verification: {
    referenceModel: string;
    layers: string[];
    requiredScenarios: string[];
    counters: string[];
    decisionAcceptance: DecisionAcceptanceSpec[];
    completionCriteria: string[];
  };
  scaffold: {
    files: ScaffoldFileSpec[];
    smokeChecks: CommandSpec[];
  };
  legacyArchitecture?: {
    modules: ModuleSpec[];
    stage2Order: string[];
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
  | "intent.goal"
  | "intent.useCase"
  | "intent.constraints"
  | "intent.exclusions"
  | "architecture.roles"
  | "architecture.systemBoundary"
  | "architecture.supportedInstructions"
  | "architecture.invariants"
  | "architecture.sharedFields"
  | "architecture.globalProtocols"
  | "architecture.counterRules"
  | "verification.referenceModel"
  | "verification.layers"
  | "verification.requiredScenarios"
  | "verification.counters"
  | "verification.decisionAcceptance"
  | "verification.completionCriteria";

export interface Stage1ProjectSpec {
  intent: ProjectIntent;
  architecture: ProjectProfile["architecture"];
  verification: ProjectProfile["verification"];
}

export type FactOwnerKind = "decision" | "project_spec" | "profile";

export interface FactSourceEntry {
  factKey: string;
  ownerKind: FactOwnerKind;
  ownerPath: string;
  sourceRevisionOrDigest: string;
  renderedLocations: Array<{
    artifact: string;
    section: string;
  }>;
  mutableThrough: ReviewRepairKind;
}

export interface ArchitectureReviewFinding {
  severity: "error" | "warning" | "note";
  code: string;
  message: string;
  artifact: string;
  factKey: string;
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

export interface ReviewCorrectionRecordV1 {
  schemaVersion?: 1;
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

export type ProjectSpecDomainPatch =
  | {
      target: ProjectSpecTarget;
      kind: "replace";
      beforeSha256: string;
      afterSha256: string;
      value: unknown;
    }
  | {
      target: ProjectSpecTarget;
      kind: "string_array";
      beforeSha256: string;
      afterSha256: string;
      add: string[];
      remove: string[];
      order: string[];
    }
  | {
      target: ProjectSpecTarget;
      kind: "keyed_collection";
      keyField: "id" | "name" | "decisionId";
      beforeSha256: string;
      afterSha256: string;
      add: Array<Record<string, unknown>>;
      remove: string[];
      update: Array<{
        key: string;
        fields: Record<string, unknown>;
        removeFields: string[];
      }>;
      order: string[];
    };

export interface ProjectSpecHistoryBaseline {
  profileDigest: string;
  projectSpecSha256: string;
  value: Stage1ProjectSpec;
}

export interface ProjectSpecHistoryEvent {
  id: string;
  kind: "review_correction" | "profile_refresh" | "override_release";
  revision: number;
  at: string;
  beforeSha256: string;
  afterSha256: string;
  patches: ProjectSpecDomainPatch[];
  correctionId?: string;
  fromProfileDigest?: string;
  toProfileDigest?: string;
  releasedTarget?: ProjectSpecTarget;
}

export interface ProjectSpecHistory {
  protocolVersion: 2 | 3;
  baseline: ProjectSpecHistoryBaseline;
  events: ProjectSpecHistoryEvent[];
}

export interface ProjectSpecHistoryStorage {
  protocolVersion: 2 | 3;
  path: string;
  sha256: string;
  eventCount: number;
  compressedBytes: number;
  uncompressedBytes: number;
}

export type ReviewCorrectionEvidenceKind =
  | "decision"
  | "project_document"
  | "research"
  | "profile"
  | "user_directive"
  | "external";

export interface ReviewCorrectionEvidenceSource {
  id: string;
  kind: ReviewCorrectionEvidenceKind;
  locator: string;
  claim: string;
  locations: string[];
  revision?: number;
  digest?: string;
  fingerprint?: string;
}

export interface ReviewCorrectionFindingSource {
  reportPath: string;
  reviewedAggregateSha256: string;
  findingCodes: string[];
}

export interface ReviewCorrectionRecordV2 {
  schemaVersion: 2;
  id: string;
  findingCodes: string[];
  repairKind: "project_spec";
  changedTargets: ProjectSpecTarget[];
  requiredClosure: string[];
  eventId: string;
  rationale: string;
  findingSource: ReviewCorrectionFindingSource;
  evidenceSources: ReviewCorrectionEvidenceSource[];
  evidenceCoverage: Partial<Record<ProjectSpecTarget, string[]>>;
  confirmedAt: string;
  appliedAt: string;
  status: "applied" | "verified" | "legacy_unresolved" | "ineffective";
  legacy: boolean;
  verifiedByAuditAggregateSha256?: string;
}

export type ReviewCorrectionRecord = ReviewCorrectionRecordV1 | ReviewCorrectionRecordV2;

export interface Stage1ArchitectureReworkLink {
  id: string;
  status: "active" | "reapproved";
  sourceStage2Revision: number;
  previousStatus: Stage1Status;
  previousApprovalSha256: string;
  repairKind: "decision" | "project_spec";
  repairTarget: string;
  startedAt: string;
  reapprovedAt?: string;
  newApprovalSha256?: string;
}

export interface ProductSchemaMigrationRecord {
  id: string;
  migratedAt: string;
  fromStage1SchemaVersion: number;
  toStage1SchemaVersion: number;
  fromProfileVersion: string;
  toProfileVersion: string;
  sourceStage1Revision: number;
  targetStage1Revision: number;
  previousApprovalSha256?: string;
  sourceStage2SchemaVersion?: number;
  targetStage2SchemaVersion?: number;
  sourceStage2Revision?: number;
  targetStage2Revision?: number;
  retiredArtifacts: string[];
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

export type Stage2Status =
  | "TOPOLOGY_DISCOVERY"
  | "TOPOLOGY_DECISION_LOOP"
  | "TOPOLOGY_REVIEW"
  | "TOPOLOGY_APPROVED"
  | "MODULE_LOOP"
  | "BASELINE_READY"
  | "BLOCKED"
  | "CANCELLED";

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

export type Stage2AgentRole = "planner" | "shadow" | "active" | "idle";

export type Stage2AgentTask =
  | "topology_research"
  | "topology_planning"
  | "system_design_draft"
  | "system_design_review"
  | "package_design_patch"
  | "shadow_design"
  | "package_design"
  | "active_implementation"
  | "package_implementation"
  | "active_static_review"
  | "active_verification_review"
  | "independent_static_review"
  | "independent_verification"
  | "package_static_review"
  | "package_verification";

export interface Stage2SkillReference {
  id: string;
  contentHash: string;
}

export type Stage2TopologyDecisionKind =
  | "unit_mapping"
  | "shared_ownership"
  | "interface_ownership"
  | "source_topology"
  | "unit_dag"
  | "completion";

export type Stage2TopologyDecisionStatus = "pending" | "proposed" | "answered";

export interface Stage2TopologyDecisionSpec {
  id: string;
  kind: Stage2TopologyDecisionKind;
  topic: string;
  question: string;
  whyNow: string;
  blocking: boolean;
  researchPolicy: ResearchPolicy;
  dependsOn: string[];
}

export interface Stage2ImplementationUnitPlan {
  id: string;
  kind: "implementation" | "shared";
  architectureRoles: string[];
  responsibility: string;
  rationale: string;
  packageName: string;
  designPath: string;
  sourcePaths: string[];
  testPaths: string[];
  integrationPaths: string[];
  dependsOn: string[];
  wave: number | null;
  integrationConsumers: string[];
  completionCriteria: string[];
  verificationResponsibility: string;
}

export interface Stage2SharedArtifactPlan {
  id: string;
  kind: "bundle" | "payload" | "config" | "utility" | "integration" | "other";
  ownerUnit: string;
  consumerUnits: string[];
  sourcePaths: string[];
  rationale: string;
}

export interface Stage2InterfaceContractPlan {
  id: string;
  ownerUnit: string;
  producerUnits: string[];
  consumerUnits: string[];
  fields: string[];
  boundary: string;
  timing: string;
}

export interface Stage2ImplementationPlan {
  units: Stage2ImplementationUnitPlan[];
  sharedArtifacts: Stage2SharedArtifactPlan[];
  interfaces: Stage2InterfaceContractPlan[];
}

export type Stage2TopologyPlanPatch =
  | {
      kind: "unit_mapping";
      units: Array<Pick<
        Stage2ImplementationUnitPlan,
        "id" | "kind" | "architectureRoles" | "responsibility" | "rationale"
      >>;
    }
  | {
      kind: "shared_ownership";
      sharedArtifacts: Stage2SharedArtifactPlan[];
    }
  | {
      kind: "interface_ownership";
      interfaces: Stage2InterfaceContractPlan[];
    }
  | {
      kind: "source_topology";
      units: Array<Pick<
        Stage2ImplementationUnitPlan,
        "id" | "packageName" | "designPath" | "sourcePaths" | "testPaths" | "integrationPaths"
      >>;
    }
  | {
      kind: "unit_dag";
      units: Array<Pick<Stage2ImplementationUnitPlan, "id" | "dependsOn" | "integrationConsumers">>;
    }
  | {
      kind: "completion";
      units: Array<Pick<
        Stage2ImplementationUnitPlan,
        "id" | "completionCriteria" | "verificationResponsibility"
      >>;
    };

export interface Stage2TopologyOption {
  id: string;
  label: string;
  summary: string;
  benefits: string[];
  costs: string[];
  risks: string[];
  notChoosingConsequences: string[];
  affectedUnits: string[];
  affectedInterfaces: string[];
  affectedSourcePaths: string[];
  affectedDagEdges: string[];
  patch: Stage2TopologyPlanPatch;
}

export interface Stage2TopologyResearchEvidence {
  schemaVersion: 1;
  decisionId: string;
  sources: ResearchSourceEvidence[];
  facts: ResearchFact[];
  conflicts: string[];
  gaps: string[];
  evidenceSufficient: boolean;
  stopReason: string;
}

export interface Stage2TopologyEvidenceRecord extends Stage2TopologyResearchEvidence {
  completedAt: string;
  runId: string;
  threadId?: string;
  contextFingerprint: string;
}

export interface Stage2TopologyProposal {
  schemaVersion: 1;
  decisionId: string;
  kind: Stage2TopologyDecisionKind;
  summary: string;
  architectureFacts: string[];
  sourceEvidence: string[];
  unknowns: string[];
  options: Stage2TopologyOption[];
  recommendation: string;
  rationale: string[];
  openQuestions: string[];
  affectedDecisions: string[];
  userConclusion: string | null;
}

export interface Stage2TopologyDecisionResolution {
  selectedOption: string;
  conclusion: string;
  note?: string;
  userCustomAnswer?: string;
  answeredAt: string;
  revision: number;
  patch: Stage2TopologyPlanPatch;
  planDocumentSha256: string;
}

export interface Stage2TopologyDecisionRevision {
  at: string;
  reason: string;
  previousConclusion: string;
  previousPlanDocumentSha256: string;
  previousPatch?: Stage2TopologyPlanPatch;
}

export interface Stage2TopologyDecisionState {
  spec: Stage2TopologyDecisionSpec;
  status: Stage2TopologyDecisionStatus;
  proposal?: Stage2TopologyProposal;
  evidence?: Stage2TopologyEvidenceRecord;
  resolution?: Stage2TopologyDecisionResolution;
  revisions: Stage2TopologyDecisionRevision[];
}

export interface Stage2TopologyReview {
  reviewedAt: string;
  planRevision: number;
  planDocumentSha256: string;
  verdict: "pass" | "fail";
  issues: string[];
}

export interface Stage2TopologyApproval {
  approvedAt: string;
  planRevision: number;
  planDocumentSha256: string;
  architectureHashes: Record<string, string>;
}

export interface Stage2LegacyMigrationRecord {
  migratedAt: string;
  sourceRevision: number;
  sourceStateEpoch: number;
  draftIndexes: Array<{
    moduleId: string;
    designPath: string;
    designSha256: string;
    runId: string;
    threadId: string;
  }>;
}

export interface Stage2TopologyState {
  planPath: "design/plan.md";
  planRevision: number;
  planDocumentSha256: string;
  decisionOrder: string[];
  decisions: Record<string, Stage2TopologyDecisionState>;
  plan: Stage2ImplementationPlan;
  review?: Stage2TopologyReview;
  approval?: Stage2TopologyApproval;
  migration?: Stage2LegacyMigrationRecord;
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
  architecture: Stage2UnitArchitectureContext;
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

export interface Stage2UnitArchitectureContext {
  id: string;
  architectureRoles: string[];
  responsibility: string;
  dependsOn: string[];
  interfaces: string[];
  systemBoundary: string[];
  invariants: string[];
  sharedFields: SharedFieldSpec[];
  globalProtocols: GlobalProtocolSpec[];
}

export interface Stage2AgentAssignment {
  slot: Stage2AgentSlot;
  role: Stage2AgentRole;
  status: "idle" | "assigned" | "working" | "waiting" | "blocked";
  lease: string;
  observedEpoch: number;
  moduleId?: string;
  decisionId?: string;
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

export type Stage2ArchitectureReworkSourceKind =
  | "topology"
  | "unit_design"
  | "implementation"
  | "verification"
  | "user";

export interface Stage2ArchitectureReworkProposal {
  summary: string;
  rationale: string;
  source: {
    kind: Stage2ArchitectureReworkSourceKind;
    decisionId?: string;
    unitId?: string;
  };
  repair: {
    kind: "decision" | "project_spec";
    target: string;
  };
  requiredClosure: string[];
  evidenceSources: ReviewCorrectionEvidenceSource[];
  affectedTopologyDecisions: string[];
  affectedUnits: string[];
}

export interface Stage2InvalidatedArtifactIndex {
  unitId: string;
  designSha256?: string;
  implementationSha256?: string;
  verificationSha256?: string;
}

export interface Stage2ArchitectureReworkRecord extends Stage2ArchitectureReworkProposal {
  id: string;
  status: "stage1_rework" | "stage1_reapproved" | "topology_rework" | "resumed";
  startedAt: string;
  updatedAt: string;
  baseline: {
    stage1ApprovalSha256: string;
    stage2Revision: number;
    stage2Status: Stage2Status;
    planRevision: number;
    planApprovalSha256?: string;
    unitPlanHashes: Record<string, string>;
  };
  invalidatedArtifacts: Stage2InvalidatedArtifactIndex[];
  suspendedAssignments: Array<{
    slot: Stage2AgentSlot;
    role: "shadow" | "active";
    moduleId: string;
    moduleStatus: Stage2ModuleStatus;
    threadId?: string;
  }>;
  newStage1ApprovalSha256?: string;
  resumedAt?: string;
}

export interface Stage2LegacyProjectStage {
  schemaVersion: 1;
  status: "MODULE_LOOP" | "BASELINE_READY" | "BLOCKED" | "CANCELLED";
  revision: number;
  stateEpoch: number;
  initializedAt: string;
  updatedAt: string;
  moduleOrder: string[];
  modules: Record<string, Omit<Stage2ModuleState, "architecture"> & { architecture: ModuleSpec }>;
  agents: Record<Stage2AgentSlot, Stage2AgentAssignment>;
  blockers: string[];
  history: Stage2HistoryEvent[];
}

export interface Stage2ProjectStage {
  schemaVersion: 3;
  status: Stage2Status;
  revision: number;
  stateEpoch: number;
  initializedAt: string;
  updatedAt: string;
  topology: Stage2TopologyState;
  moduleOrder: string[];
  modules: Record<string, Stage2ModuleState>;
  agents: Record<Stage2AgentSlot, Stage2AgentAssignment>;
  architectureRework?: Stage2ArchitectureReworkRecord;
  architectureReworkHistory?: Stage2ArchitectureReworkRecord[];
  blockers: string[];
  history: Stage2HistoryEvent[];
}

export interface Stage2TaskEnvelope {
  schemaVersion: 3;
  task: Stage2AgentTask;
  project: {
    name: string;
    root: string;
  };
  module?: Stage2UnitArchitectureContext;
  unit?: Stage2ImplementationUnitPlan;
  topology?: {
    decision: Stage2TopologyDecisionSpec;
    architectureRoles: ArchitectureRoleSpec[];
    confirmedDecisions: Array<{
      id: string;
      conclusion: string;
    }>;
    plan: Stage2ImplementationPlan;
    planRevision: number;
    planPath: string;
    planDocumentSha256: string;
    evidence?: Stage2TopologyEvidenceRecord;
  };
  assignment: {
    slot: Stage2AgentSlot;
    role: Stage2AgentRole;
    lease: string;
    stateEpoch: number;
  };
  authority: {
    repositoryRules: string;
    architectureHashes: Record<string, string>;
    planPath?: string;
    planSha256?: string;
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
      kind: "architecture_rework_stage1";
      reworkId: string;
      repairKind: "decision" | "project_spec";
      repairTarget: string;
    }
  | {
      kind: "architecture_rework_resume";
      reworkId: string;
    }
  | {
      kind: "topology_planning";
      decisionId: string;
      topic: string;
      slot: Stage2AgentSlot;
      researchPolicy: ResearchPolicy;
    }
  | {
      kind: "topology_decision";
      decision: Stage2TopologyDecisionSpec;
      proposal: Stage2TopologyProposal;
      planPath: string;
      planRevision: number;
    }
  | {
      kind: "topology_review";
      planPath: string;
      planRevision: number;
      issues: string[];
    }
  | {
      kind: "topology_approval";
      planPath: string;
      planRevision: number;
      planDocumentSha256: string;
    }
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
  plan: {
    path: string;
    revision: number;
    status: Stage2Status;
    answeredDecisions: number;
    totalDecisions: number;
    currentDecisionId?: string;
    approvalCurrent: boolean;
  };
  board: Array<{
    unitId: string;
    architectureRoles: string[];
    dependsOn: string[];
    wave: number | null;
    status: Stage2ModuleStatus | "PLANNED";
    agentRole: Stage2AgentRole;
    designRevision?: number;
    designPath: string;
    sourcePaths: string[];
    testPaths: string[];
    verificationStatus: "not_started" | "primary_pending" | "review_pending" | "complete";
    blockers: string[];
  }>;
  currentUserGate?: string;
  nextMachineActions: string[];
  architectureRework?: Stage2ArchitectureReworkRecord;
}

export type Stage2WorkspaceStatus =
  | "SYSTEM_DESIGN_DRAFT"
  | "SYSTEM_DESIGN_DECISIONS"
  | "SYSTEM_DESIGN_APPROVAL"
  | "PACKAGE_LOOP"
  | "BASELINE_READY"
  | "BLOCKED"
  | "CANCELLED";

export type Stage2WorkPackageStatus =
  | "PENDING"
  | "DESIGNING"
  | "AWAITING_APPROVAL"
  | "READY"
  | "IMPLEMENTING"
  | "VERIFYING"
  | "COMPLETE"
  | "NEEDS_REALIGN"
  | "BLOCKED"
  | "CANCELLED";

export type Stage2DecisionRequestCategory =
  | "architecture_role"
  | "pipeline_boundary"
  | "global_state"
  | "identity_or_replay"
  | "control_scope"
  | "cross_package_interface"
  | "engineering_tradeoff"
  | "stage1_rework";

export interface Stage2DecisionRequestOption {
  id: string;
  label: string;
  summary: string;
  consequences: string[];
}

export interface Stage2DecisionRequestSpec {
  id: string;
  category: Stage2DecisionRequestCategory;
  question: string;
  whyUserDecisionIsRequired: string;
  options: Stage2DecisionRequestOption[];
  recommendation: string;
  affectedComponents: string[];
  affectedInterfaces: string[];
  affectedPaths: string[];
  consequences: string[];
}

export interface Stage2DecisionRequestResolution {
  selectedOption?: string;
  customConclusion?: string;
  conclusion: string;
  note?: string;
  answeredAt: string;
  workspaceRevision: number;
}

export interface Stage2DecisionRequestState {
  spec: Stage2DecisionRequestSpec;
  status: "open" | "answered";
  resolution?: Stage2DecisionRequestResolution;
}

export interface Stage2DesignComponent {
  id: string;
  parentId?: string;
  architectureRoles: string[];
  responsibility: string;
  stateOwnership: string[];
  interfaceIds: string[];
}

export interface Stage2InterfaceSkeleton {
  id: string;
  ownerComponentId: string;
  producerComponentIds: string[];
  consumerComponentIds: string[];
  fields: string[];
  boundary: string;
  timing: string;
}

export interface Stage2WorkPackagePlanV4 {
  id: string;
  componentIds: string[];
  dependsOn: string[];
  allowedSourcePaths: string[];
  allowedTestPaths: string[];
  designPath: string;
  acceptance: string[];
}

export interface Stage2WorkPackagePlanV5 {
  id: string;
  componentIds: string[];
  designDependsOn: string[];
  implementationDependsOn: string[];
  integrationDependsOn: string[];
  allowedSourcePaths: string[];
  allowedTestPaths: string[];
  designPath: string;
  acceptance: string[];
}

export interface Stage2SystemDesignProposalV4
  extends Omit<Stage2SystemDesignProposal, "workPackages"> {
  workPackages: Stage2WorkPackagePlanV4[];
}

export interface Stage2SystemDesignProposal {
  schemaVersion: 1;
  summary: string;
  architectureReferences: string[];
  components: Stage2DesignComponent[];
  interfaces: Stage2InterfaceSkeleton[];
  workPackages: Stage2WorkPackagePlanV5[];
  globalInvariants: string[];
  acceptancePlan: string[];
  decisionRequests: Stage2DecisionRequestSpec[];
  risks: string[];
}

export interface Stage2SystemDesignReviewReport {
  schemaVersion: 1;
  systemDesignSha256: string;
  verdict: "pass" | "fail";
  summary: string;
  findings: Stage2ReviewFinding[];
  decisionRequests: Stage2DecisionRequestSpec[];
}

export interface Stage2SystemDesignReviewRecord {
  reviewedAt: string;
  runtimeRef: string;
  runId: string;
  report: Stage2SystemDesignReviewReport;
}

export interface Stage2SystemDesignApprovalV4 {
  approvedAt: string;
  designRevision: number;
  documentSha256: string;
  architectureHashes: Record<string, string>;
  componentTopologySha256: string;
  interfaceSha256: string;
  workPackagePlanSha256: string;
}

export interface Stage2SystemDesignRevisionRequest {
  id: string;
  requestedAt: string;
  baseDesignRevision: number;
  baseDocumentSha256: string;
  kind?: "candidate_revision" | "approved_reopen";
  affectedWorkPackages?: string[];
  baseApproval?: Stage2SystemDesignApprovalV4;
  instruction: string;
  status: "pending" | "applied";
  appliedDesignRevision?: number;
  appliedProposalSha256?: string;
}

export interface Stage2LegacyEvidence {
  id: string;
  kind: "topology_decision" | "topology_plan" | "worker_run" | "architecture_rework";
  summary: string;
  sourceRevision: number;
  contentSha256?: string;
  runId?: string;
}

export interface Stage2SystemDesignState {
  path: "design/plan.md";
  revision: number;
  documentSha256: string;
  draftedAt?: string;
  runtimeRef?: string;
  reviewRuntimeRef?: string;
  runId?: string;
  proposal?: Stage2SystemDesignProposal;
  review?: Stage2SystemDesignReviewRecord;
  approval?: Stage2SystemDesignApprovalV4;
  decisionOrder: string[];
  decisions: Record<string, Stage2DecisionRequestState>;
  legacyEvidence: Stage2LegacyEvidence[];
  revisionRequests?: Stage2SystemDesignRevisionRequest[];
}

export interface Stage2PackageDesignProposal {
  schemaVersion: 1;
  workPackageId: string;
  componentIds: string[];
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
  affectedWorkPackages: string[];
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
  decisionRequests: Stage2DecisionRequestSpec[];
  risks: string[];
  openQuestions: string[];
}

export interface Stage2PackageDesignApproval {
  approvedAt: string;
  designRevision: number;
  designSha256: string;
  systemDesignSha256: string;
  interfaceSha256: string;
  architectureHashes: Record<string, string>;
}

export interface Stage2PackageDesignRecord {
  revision: number;
  draftedAt: string;
  path: string;
  documentSha256: string;
  runtimeRef: string;
  runId: string;
  skills: Stage2SkillReference[];
  proposal: Stage2PackageDesignProposal;
  approval?: Stage2PackageDesignApproval;
}

export interface Stage2PackageImplementationProposal {
  schemaVersion: 1;
  workPackageId: string;
  designSha256: string;
  summary: string;
  files: Stage2ImplementationFile[];
  notes: string[];
  designGap: Stage2DesignGap | null;
}

export interface Stage2PackageImplementationRecord {
  appliedAt: string;
  designSha256: string;
  aggregateSha256: string;
  fileHashes: Record<string, string>;
  changedPaths: string[];
  summary: string;
  runtimeRef: string;
  runId: string;
  skills: Stage2SkillReference[];
}

export interface Stage2PackageReviewReport {
  schemaVersion: 1;
  kind: "static" | "verification";
  workPackageId: string;
  designSha256: string;
  implementationAggregateSha256: string;
  verdict: "pass" | "fail";
  summary: string;
  findings: Stage2ReviewFinding[];
  commandResults: CommandResult[];
}

export interface Stage2PackageWorkerEvidence {
  task: "package_static_review" | "package_verification";
  runtimeRef: string;
  runId: string;
  completedAt: string;
  skills: Stage2SkillReference[];
  report: Stage2PackageReviewReport;
}

export interface Stage2PackageVerificationRecord {
  primaryRanAt: string;
  primaryCommands: CommandResult[];
  finalCommands?: CommandResult[];
  staticReview?: Stage2PackageWorkerEvidence;
  verificationReview?: Stage2PackageWorkerEvidence;
  documentPath: string;
  documentSha256?: string;
  completedAt?: string;
}

export interface Stage2WorkPackageStateV4 {
  id: string;
  order: number;
  revision: number;
  status: Stage2WorkPackageStatus;
  plan: Stage2WorkPackagePlanV5;
  design?: Stage2PackageDesignRecord;
  implementation?: Stage2PackageImplementationRecord;
  verification?: Stage2PackageVerificationRecord;
  decisionOrder: string[];
  decisions: Record<string, Stage2DecisionRequestState>;
  blockers: string[];
  reopened: Array<{
    at: string;
    reason: string;
    previousDesignSha256?: string;
  }>;
}

export interface Stage2WorkspaceAgentAssignment {
  slot: Stage2AgentSlot;
  role: "idle" | "shadow" | "active";
  status: "idle" | "assigned" | "working" | "waiting" | "blocked";
  lease: string;
  baseRevision: number;
  workPackageId?: string;
  runtimeRef?: string;
  runId?: string;
  designHash?: string;
  interfaceHash?: string;
  allowedPaths: string[];
}

export interface Stage2RuntimeRegistryEntry {
  runtimeRef: string;
  provider: string;
  model?: string;
  runtimeVersion?: string;
  externalSessionId?: string;
  phase: "system_design" | "package" | "verification" | "legacy";
  status: "active" | "idle" | "failed" | "cancelled";
  latestRunId?: string;
  runCount: number;
  cumulativePromptBytes: number;
  createdAt: string;
  updatedAt: string;
}

export type Stage2RuntimeRunStatus =
  | "queued"
  | "running"
  | "model_completed"
  | "validation_failed"
  | "applied"
  | "failed"
  | "cancelled"
  | "orphaned";

export interface Stage2RuntimeRunRecord {
  runId: string;
  runtimeRef: string;
  task: Stage2AgentTask;
  slot?: Stage2AgentSlot;
  workPackageId?: string;
  status: Stage2RuntimeRunStatus;
  promptDigest: string;
  inputArtifactHashes: Record<string, string>;
  outputArtifactHashes: Record<string, string>;
  toolPolicy: "read-only" | "workspace-write";
  runtimePath: string;
  startedAt?: string;
  lastEventAt?: string;
  deadlineAt?: string;
  noEventTimeoutMs?: number;
  completedAt?: string;
  eventCount: number;
  pid?: number;
  error?: string;
}

export interface Stage2ReadManifest {
  entryFiles: string[];
  allowedRoots: string[];
  excludedRoots: string[];
  affectedIds: string[];
  maxListedFiles: number;
  manifestSha256: string;
}

export type Stage2DesignRepairClass = "canonical" | "local_patch" | "full_redraft";

export interface Stage2DesignRevisionIssue {
  code: string;
  target: string;
  message: string;
  repairClass: Stage2DesignRepairClass;
}

export interface Stage2DesignPatchOperation {
  op: "add" | "replace" | "remove";
  target: string;
  value?: unknown;
}

export interface Stage2DesignPatch {
  baseProposalSha256: string;
  operations: Stage2DesignPatchOperation[];
}

export interface Stage2WorkspaceHistoryEvent {
  at: string;
  revision: number;
  workspaceRevision: number;
  event: string;
  workPackageId?: string;
  detail?: string;
}

export interface Stage2WorkspaceMigrationRecord {
  migratedAt: string;
  sourceSchemaVersion: number;
  sourceRevision: number;
  sourceStatus: string;
  sourcePlanSha256?: string;
  retainedEvidenceIds: string[];
}

export interface Stage2WorkspaceArchitectureReworkProposal {
  summary: string;
  rationale: string;
  source: {
    kind: Stage2ArchitectureReworkSourceKind;
    decisionId?: string;
    workPackageId?: string;
  };
  repair: {
    kind: "decision" | "project_spec";
    target: string;
  };
  requiredClosure: string[];
  evidenceSources: ReviewCorrectionEvidenceSource[];
  affectedComponents: string[];
  affectedWorkPackages: string[];
}

export interface Stage2WorkspaceArchitectureReworkRecord
  extends Stage2WorkspaceArchitectureReworkProposal {
  id: string;
  status: "stage1_rework" | "stage1_reapproved" | "system_design_rework" | "resumed";
  startedAt: string;
  updatedAt: string;
  baseline: {
    stage1ApprovalSha256: string;
    stage2Revision: number;
    workspaceRevision: number;
    systemDesignSha256: string;
    interfaceSha256?: string;
    workPackageDesignHashes: Record<string, string>;
  };
  suspendedAssignments: Stage2WorkspaceAgentAssignment[];
  invalidatedWorkPackages: Array<{
    workPackageId: string;
    designSha256?: string;
    implementationSha256?: string;
    verificationSha256?: string;
  }>;
  newStage1ApprovalSha256?: string;
  resumedAt?: string;
}

export interface Stage2WorkspaceStage {
  schemaVersion: 5;
  status: Stage2WorkspaceStatus;
  revision: number;
  workspaceRevision: number;
  stateEpoch: number;
  initializedAt: string;
  updatedAt: string;
  systemDesign: Stage2SystemDesignState;
  workPackageOrder: string[];
  workPackages: Record<string, Stage2WorkPackageStateV4>;
  agents: Record<Stage2AgentSlot, Stage2WorkspaceAgentAssignment>;
  runtimeRegistry: Record<string, Stage2RuntimeRegistryEntry>;
  runtimeRuns: Record<string, Stage2RuntimeRunRecord>;
  migration?: Stage2WorkspaceMigrationRecord;
  architectureRework?: Stage2WorkspaceArchitectureReworkRecord;
  architectureReworkHistory?: Stage2WorkspaceArchitectureReworkRecord[];
  blockers: string[];
  history: Stage2WorkspaceHistoryEvent[];
}

export interface Stage2WorkspaceTaskEnvelope {
  schemaVersion: 5;
  task: Stage2AgentTask;
  project: {
    name: string;
    root: string;
  };
  systemDesign: {
    path: string;
    revision: number;
    documentSha256: string;
    architectureRoles: ArchitectureRoleSpec[];
    legacyEvidence: Stage2LegacyEvidence[];
    resolvedDecisions: Array<{
      id: string;
      conclusion: string;
    }>;
    proposal?: Stage2SystemDesignProposal;
    revisionRequest?: Stage2SystemDesignRevisionRequest;
  };
  workPackage?: {
    plan: Stage2WorkPackagePlanV5;
    componentContext: Stage2DesignComponent[];
    interfaceContext: Stage2InterfaceSkeleton[];
    upstreamDesigns: Array<{
      workPackageId: string;
      path: string;
      designSha256: string;
    }>;
    resolvedDecisions: Array<{
      id: string;
      conclusion: string;
    }>;
  };
  assignment: {
    slot: Stage2AgentSlot;
    role: "idle" | "shadow" | "active";
    lease: string;
    workspaceRevision: number;
    stateEpoch: number;
    workPackageRevision?: number;
    runtimeRef?: string;
  };
  authority: {
    repositoryRules: string;
    architectureHashes: Record<string, string>;
    systemDesignSha256?: string;
    interfaceSha256?: string;
    packageDesignPath?: string;
    packageDesignSha256?: string;
  };
  skills: Stage2SkillReference[];
  readManifest: Stage2ReadManifest;
  allowedPaths: string[];
  explicitExclusions: string[];
  nextPermittedAction: string;
}

export type Stage2WorkspaceNextAction =
  | { kind: "system_design_draft"; slot: Stage2AgentSlot }
  | { kind: "system_design_revision"; slot: Stage2AgentSlot; issues: string[] }
  | {
    kind: "system_design_reopen";
    revision: number;
    affectedWorkPackages: string[];
    changes: string[];
  }
  | { kind: "decision_request"; scope: "system" | "package"; workPackageId?: string; decision: Stage2DecisionRequestSpec }
  | { kind: "system_design_approval"; path: string; revision: number; documentSha256: string }
  | { kind: "package_design"; workPackageId: string; slot: Stage2AgentSlot }
  | { kind: "package_design_revision"; workPackageId: string; slot: Stage2AgentSlot; issues: string[] }
  | { kind: "package_design_approval"; workPackageId: string; path: string; designSha256: string }
  | { kind: "active_implementation"; workPackageId: string; slot: Stage2AgentSlot }
  | { kind: "verification"; workPackageId: string }
  | { kind: "runs_in_progress"; runIds: string[] }
  | { kind: "waiting_for_rotation"; workPackageId: string; slot: Stage2AgentSlot }
  | { kind: "architecture_rework_stage1"; reworkId: string; repairKind: "decision" | "project_spec"; repairTarget: string }
  | { kind: "architecture_rework_resume"; reworkId: string }
  | { kind: "blocked"; blockers: string[] }
  | { kind: "baseline_complete" };

export interface Stage2WorkspaceSummary {
  projectName: string;
  schemaVersion: 5;
  status: Stage2WorkspaceStatus;
  revision: number;
  workspaceRevision: number;
  complete: number;
  total: number;
  active?: Stage2WorkspaceAgentAssignment;
  shadow?: Stage2WorkspaceAgentAssignment;
  readyActions: Stage2WorkspaceNextAction[];
  blockers: string[];
  systemDesign: {
    path: string;
    revision: number;
    drafted: boolean;
    reviewVerdict?: "pass" | "fail";
    openDecisions: number;
    approvalCurrent: boolean;
    revisionRequest?: Stage2SystemDesignRevisionRequest;
  };
  board: Array<{
    workPackageId: string;
    componentIds: string[];
    designDependsOn: string[];
    implementationDependsOn: string[];
    integrationDependsOn: string[];
    status: Stage2WorkPackageStatus | "PLANNED";
    agentRole: "idle" | "shadow" | "active";
    designRevision?: number;
    designPath: string;
    sourcePaths: string[];
    testPaths: string[];
    verificationStatus: "not_started" | "primary_pending" | "workers_pending" | "complete";
    blockers: string[];
  }>;
  runs: Array<{
    runId: string;
    runtimeRef: string;
    task: Stage2AgentTask;
    status: Stage2RuntimeRunStatus;
    workPackageId?: string;
    slot?: Stage2AgentSlot;
    startedAt?: string;
    lastEventAt?: string;
    deadlineAt?: string;
    noEventTimeoutMs?: number;
    completedAt?: string;
    eventCount: number;
    pid?: number;
    runtimePath: string;
    error?: string;
  }>;
  currentUserGate?: string;
  nextMachineActions: string[];
  architectureRework?: Stage2WorkspaceArchitectureReworkRecord;
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
    intent?: ProjectIntent;
    decisions: Record<string, DecisionState>;
    environment: CommandResult[];
    projectSpec?: Stage1ProjectSpec;
    projectSpecHistory?: ProjectSpecHistory;
    projectSpecHistoryStorage?: ProjectSpecHistoryStorage;
    overriddenTargets?: ProjectSpecTarget[];
    generatedDocumentHashes: Record<string, string>;
    review?: ArchitectureReviewRecord;
    reviewHistory?: ArchitectureReviewRecord[];
    reviewCorrections?: ReviewCorrectionRecord[];
    approval?: ApprovalRecord;
    approvalHistory?: ApprovalRecord[];
    architectureRework?: Stage1ArchitectureReworkLink;
    productMigrations?: ProductSchemaMigrationRecord[];
    architectureReworkHistory?: Stage1ArchitectureReworkLink[];
    scaffold?: ScaffoldRecord;
    blockers: string[];
    history: HistoryEvent[];
  };
  stage2?: Stage2ProjectStage | Stage2LegacyProjectStage | Stage2WorkspaceStage | Stage2WorkspaceStageV4;
}

export interface Stage2WorkPackageStateLegacyV4
  extends Omit<Stage2WorkPackageStateV4, "revision" | "plan"> {
  plan: Stage2WorkPackagePlanV4;
}

export interface Stage2WorkspaceStageV4
  extends Omit<
    Stage2WorkspaceStage,
    "schemaVersion" | "stateEpoch" | "systemDesign" | "workPackages" | "runtimeRegistry" | "runtimeRuns"
  > {
  schemaVersion: 4;
  systemDesign: Omit<Stage2SystemDesignState, "proposal"> & {
    proposal?: Stage2SystemDesignProposalV4;
  };
  workPackages: Record<string, Stage2WorkPackageStateLegacyV4>;
  runtimeRegistry: Record<string, LegacyStage2RuntimeRegistryEntry>;
}

export interface LegacyStage2RuntimeRegistryEntry {
  runtimeRef: string;
  provider: string;
  model?: string;
  runtimeVersion?: string;
  task: Stage2AgentTask;
  slot?: Stage2AgentSlot;
  workPackageId?: string;
  externalSessionId?: string;
  promptDigest: string;
  inputArtifactHashes: Record<string, string>;
  outputArtifactHashes: Record<string, string>;
  toolPolicy: "read-only" | "workspace-write";
  status: "running" | "completed" | "failed" | "cancelled";
  startedAt: string;
  completedAt?: string;
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
  projectSpecProtocolVersion: 1 | 2 | 3;
  projectSpecHistoryEvents: number;
  legacyUnresolvedCorrections: number;
  architectureRework?: Stage1ArchitectureReworkLink;
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
