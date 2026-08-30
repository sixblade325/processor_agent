import { sha256 } from "./io.js";
import type {
  DecisionOption,
  DecisionRevisionContext,
  DecisionRevisionRecord,
  DecisionSpec,
  ResearchRequest,
  Stage1ProjectState,
} from "./types.js";

export const RESEARCH_PROMPT_VERSION = "stage1-research-v3";
export const REVISE_PREVIOUS_OPTION_ID = "revise_previous";

export interface ResearchRequestInput {
  question?: string;
  sources?: string[];
  scope?: string;
}

export function normalizeResearchRequest(
  decision: DecisionSpec,
  input: ResearchRequestInput = {},
): ResearchRequest {
  const question = input.question?.trim() || decision.question;
  const sources = [...new Set((input.sources ?? []).map((source) => source.trim()).filter(Boolean))]
    .sort((left, right) => left.localeCompare(right));
  const scope = input.scope?.trim();
  return {
    decisionId: decision.id,
    question,
    sources,
    ...(scope === undefined || scope === "" ? {} : { scope }),
  };
}

export function isDefaultResearchRequest(
  decision: DecisionSpec,
  request: ResearchRequest,
): boolean {
  return request.question === decision.question
    && request.sources.length === 0
    && request.scope === undefined;
}

export function researchContextFingerprint(
  decision: DecisionSpec,
  state: Stage1ProjectState,
): string {
  const dependencies = Object.fromEntries(
    decision.dependsOn.map((id) => {
      const current = state.stage1.decisions[id];
      return [id, {
        status: current?.status ?? "missing",
        selectedOption: current?.selectedOption ?? null,
        customAnswer: current?.customAnswer ?? null,
      }];
    }),
  );
  const documents = Object.fromEntries(
    [...decision.affectedArtifacts]
      .sort((left, right) => left.localeCompare(right))
      .map((path) => [path, state.stage1.generatedDocumentHashes[path] ?? null]),
  );
  return sha256(JSON.stringify({
    promptVersion: RESEARCH_PROMPT_VERSION,
    decision,
    dependencies,
    documents,
    revision: activeDecisionRevisionRecord(decision, state) ?? null,
  }));
}

export function researchRequestFingerprint(
  contextFingerprint: string,
  request: ResearchRequest,
): string {
  return sha256(JSON.stringify({ contextFingerprint, request }));
}

export function hasCurrentSufficientResearch(
  decision: DecisionSpec,
  state: Stage1ProjectState,
): boolean {
  const current = state.stage1.decisions[decision.id];
  if (current?.advicePath === undefined) {
    return false;
  }
  if (current.research === undefined) {
    return activeDecisionRevisionRecord(decision, state) === undefined;
  }
  return current.research.status === "complete"
    && current.research.evidenceSufficient
    && current.research.contextFingerprint === researchContextFingerprint(decision, state);
}

export function activeDecisionRevisionRecord(
  decision: DecisionSpec,
  state: Stage1ProjectState,
): DecisionRevisionRecord | undefined {
  const current = state.stage1.decisions[decision.id];
  if (current?.status !== "pending") {
    return undefined;
  }
  return current.revisions?.at(-1);
}

export function decisionRevisionContext(
  decision: DecisionSpec,
  state: Stage1ProjectState,
): DecisionRevisionContext | undefined {
  const revision = activeDecisionRevisionRecord(decision, state);
  if (revision === undefined) {
    return undefined;
  }
  const previousConclusion = revision.previous.customAnswer
    ?? previousSelectedOptionConclusion(decision, revision.previous.selectedOption);
  const proposedCustomAnswer = state.stage1.decisions[decision.id]?.research?.proposedCustomAnswer;
  return {
    kind: revision.kind,
    revision: revision.revision,
    reason: revision.reason,
    causeDecisionId: revision.causeDecisionId,
    previousStatus: revision.previous.status,
    ...(previousConclusion === undefined ? {} : { previousConclusion }),
    ...(revision.previous.note === undefined ? {} : { previousNote: revision.previous.note }),
    ...(proposedCustomAnswer === undefined ? {} : { proposedCustomAnswer }),
  };
}

export function decisionForCurrentAction(
  decision: DecisionSpec,
  state: Stage1ProjectState,
): DecisionSpec {
  const revision = decisionRevisionContext(decision, state);
  if (revision?.previousConclusion === undefined) {
    return decision;
  }
  const revisionOption: DecisionOption = {
    id: REVISE_PREVIOUS_OPTION_ID,
    label: "修订此前结论",
    summary: revision.proposedCustomAnswer ?? revision.previousConclusion,
    consequences: [
      `只处理本次修正原因：${revision.reason}`,
      "此前结论中未被新证据否定的内容继续保留。",
      revision.proposedCustomAnswer === undefined
        ? "需要形成一份完整的新结论后再提交。"
        : "该候选是 Research 与 Synthesis 形成的完整修订结论。",
    ],
  };
  const options = [
    revisionOption,
    ...decision.options.filter((option) => option.id !== REVISE_PREVIOUS_OPTION_ID),
  ];
  const researchRecommendation = state.stage1.decisions[decision.id]?.research?.recommendation;
  const previousSelectedOption = activeDecisionRevisionRecord(decision, state)?.previous.selectedOption;
  const baselineRecommendation = options.some((option) => option.id === previousSelectedOption)
    ? previousSelectedOption as string
    : REVISE_PREVIOUS_OPTION_ID;
  const recommendation = options.some((option) => option.id === researchRecommendation)
    ? researchRecommendation as string
    : baselineRecommendation;
  return {
    ...decision,
    recommendation,
    options,
  };
}

function previousSelectedOptionConclusion(
  decision: DecisionSpec,
  selectedOption: string | undefined,
): string | undefined {
  if (selectedOption === undefined) {
    return undefined;
  }
  const option = decision.options.find((candidate) => candidate.id === selectedOption);
  if (option === undefined) {
    return selectedOption;
  }
  return `${option.id}: ${option.label}\n${option.summary}`;
}
