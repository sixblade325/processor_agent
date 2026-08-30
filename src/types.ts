export type Stage1Status =
  | "NEW"
  | "WORKSPACE_INITIALIZED"
  | "INTENT_CAPTURED"
  | "BLUEPRINT_DRAFTED"
  | "DECISION_LOOP"
  | "RESEARCHING"
  | "ARCHITECTURE_REVIEW"
  | "ARCHITECTURE_APPROVED"
  | "PROJECT_SCAFFOLDED"
  | "STAGE1_COMPLETE"
  | "NEEDS_REVISION"
  | "BLOCKED"
  | "CANCELLED";

export type DecisionStatus = "pending" | "answered" | "deferred" | "delegated";

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

export interface DecisionState {
  status: DecisionStatus;
  selectedOption?: string;
  customAnswer?: string;
  note?: string;
  deferredUntil?: string;
  answeredAt?: string;
  advicePath?: string;
  research?: DecisionResearchState;
}

export interface ApprovalRecord {
  approvedAt: string;
  revision: number;
  aggregateSha256: string;
  documentHashes: Record<string, string>;
}

export interface ArchitectureReviewFinding {
  severity: "error" | "warning" | "note";
  code: string;
  message: string;
  artifact: string;
  relatedDecision: string;
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
    generatedDocumentHashes: Record<string, string>;
    review?: ArchitectureReviewRecord;
    approval?: ApprovalRecord;
    scaffold?: ScaffoldRecord;
    blockers: string[];
    history: HistoryEvent[];
  };
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
      kind: "research_required";
      decision: DecisionSpec;
      request: ResearchRequest;
      fingerprint: string;
    }
  | {
      kind: "decision_ready";
      decision: DecisionSpec;
    };
