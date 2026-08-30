import { sha256 } from "./io.js";
import type {
  DecisionSpec,
  ResearchRequest,
  Stage1ProjectState,
} from "./types.js";

export const RESEARCH_PROMPT_VERSION = "stage1-research-v1";

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
    return true;
  }
  return current.research.status === "complete"
    && current.research.evidenceSufficient
    && current.research.contextFingerprint === researchContextFingerprint(decision, state);
}
