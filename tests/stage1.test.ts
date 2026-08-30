import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { parse, stringify } from "yaml";
import {
  adviseDecision,
  buildWorkspaceAgentPrompt,
  researchDecision,
  type StructuredWorkerExecutor,
} from "../src/agent-runtime.js";
import { toWslPath } from "../src/io.js";
import { loadProfile } from "../src/profile.js";
import {
  answerCustomDecision,
  answerDecision,
  approveStage1,
  completeStage1,
  currentGeneratedAggregate,
  deferDecision,
  findNextDecision,
  getNextStage1Action,
  initStage1,
  loadStage1,
  probeEnvironment,
  refreshStage1Profile,
  reviewStage1,
  saveDecisionAdvice,
  saveArchitectureReview,
  scaffoldStage1,
  summarizeStage1,
} from "../src/stage1.js";
import type {
  DecisionAdvice,
  DecisionSynthesis,
  ResearchEvidence,
  Stage1ProjectState,
} from "../src/types.js";

test("Stage1 completes a deterministic profile-driven workflow", async () => {
  const fixture = await createFixture();
  await writeFile(join(fixture.project, "AGENTS.md"), "# Existing project rules\n", "utf8");
  const initialized = await initStage1(fixture.project, fixture.profile, {
    projectName: "test_core",
  });

  assert.equal(initialized.state.stage1.status, "DECISION_LOOP");
  assert.equal((await readFile(join(fixture.project, "AGENTS.md"), "utf8")), "# Existing project rules\n");
  assert.equal(findNextDecision(initialized.state, initialized.loadedProfile.profile)?.id, "D1");

  await answerDecision(fixture.project, "D1", "a");
  let loaded = await loadStage1(fixture.project);
  assert.equal(findNextDecision(loaded.state, loaded.loadedProfile.profile)?.id, "D2");

  await answerDecision(fixture.project, "D2", "b");
  loaded = await reviewStage1(fixture.project);
  assert.equal(loaded.state.stage1.status, "ARCHITECTURE_REVIEW");

  await assert.rejects(approveStage1(fixture.project), /audit has not been recorded/u);
  await savePassingReview(fixture.project);

  loaded = await approveStage1(fixture.project);
  assert.equal(loaded.state.stage1.status, "ARCHITECTURE_APPROVED");
  assert.ok(loaded.state.stage1.approval?.aggregateSha256);

  loaded = await scaffoldStage1(fixture.project);
  assert.equal(loaded.state.stage1.status, "PROJECT_SCAFFOLDED");
  assert.equal(await readFile(join(fixture.project, "build.fixture"), "utf8"), "fixture\n");

  loaded = await completeStage1(fixture.project);
  assert.equal(loaded.state.stage1.status, "STAGE1_COMPLETE");
  const summary = await summarizeStage1(loaded);
  assert.equal(summary.approvalCurrent, true);
  assert.equal(summary.pending, 0);

  const overview = await readFile(join(fixture.project, "architecture", "overview.md"), "utf8");
  assert.match(overview, /状态：已批准/u);
  assert.match(overview, /结论：Option A/u);
  const verification = await readFile(join(fixture.project, "verification", "plan.md"), "utf8");
  assert.match(verification, /决策对应要求/u);
});

test("Stage1 enforces decision dependencies", async () => {
  const fixture = await createFixture();
  await initStage1(fixture.project, fixture.profile);
  await assert.rejects(
    answerDecision(fixture.project, "D2", "b"),
    /unresolved dependencies/u,
  );
});

test("Stage1 approval detects formal document drift", async () => {
  const fixture = await createFixture();
  await initStage1(fixture.project, fixture.profile);
  await answerDecision(fixture.project, "D1", "a");
  await answerDecision(fixture.project, "D2", "b");
  await reviewStage1(fixture.project);
  await savePassingReview(fixture.project);
  await approveStage1(fixture.project);
  const overview = join(fixture.project, "architecture", "overview.md");
  await writeFile(overview, `${await readFile(overview, "utf8")}\nexternal edit\n`, "utf8");
  await assert.rejects(scaffoldStage1(fixture.project), /approval is no longer valid/u);
  const summary = await summarizeStage1(await loadStage1(fixture.project));
  assert.equal(summary.approvalCurrent, false);
  assert.equal(summary.status, "NEEDS_REVISION");
});

test("Stage1 refuses to overwrite existing formal architecture", async () => {
  const fixture = await createFixture();
  await mkdir(join(fixture.project, "architecture"), { recursive: true });
  await writeFile(join(fixture.project, "architecture", "overview.md"), "# User architecture\n", "utf8");
  await assert.rejects(
    initStage1(fixture.project, fixture.profile),
    /would overwrite existing files/u,
  );
});

test("Windows drive paths convert to WSL mount paths", () => {
  assert.equal(toWslPath("E:\\107\\dual_issue_demo"), "/mnt/e/107/dual_issue_demo");
});

test("Stage1 refreshes an unapproved profile without losing active decisions", async () => {
  const fixture = await createFixture();
  await initStage1(fixture.project, fixture.profile);
  await answerDecision(fixture.project, "D1", "a");

  const refreshedProfile = join(fixture.root, "profile-v2.yaml");
  await writeFile(
    refreshedProfile,
    fixtureProfile()
      .replace("version: 1.0.0", "version: 2.0.0")
      .replace("systemBoundary: [Test boundary]", "systemBoundary: [Test boundary, Added boundary]"),
    "utf8",
  );
  const loaded = await refreshStage1Profile(fixture.project, refreshedProfile);

  assert.equal(loaded.state.project.profile.version, "2.0.0");
  assert.equal(loaded.state.stage1.decisions.D1?.selectedOption, "a");
  assert.equal(loaded.state.stage1.status, "DECISION_LOOP");
  const overview = await readFile(join(fixture.project, "architecture", "overview.md"), "utf8");
  assert.match(overview, /Added boundary/u);
});

test("Stage1 profile refresh rejects changes to an active decision", async () => {
  const fixture = await createFixture();
  await initStage1(fixture.project, fixture.profile);
  await answerDecision(fixture.project, "D1", "a");

  const changedProfile = join(fixture.root, "profile-changed.yaml");
  await writeFile(
    changedProfile,
    fixtureProfile()
      .replace("version: 1.0.0", "version: 2.0.0")
      .replace("First option A.", "Changed first option A."),
    "utf8",
  );

  await assert.rejects(
    refreshStage1Profile(fixture.project, changedProfile),
    /changes active decision D1/u,
  );
});

test("Stage1 profile refresh can add research policy without invalidating an active decision", async () => {
  const fixture = await createFixture();
  await initStage1(fixture.project, fixture.profile);
  await answerDecision(fixture.project, "D1", "a");

  const policyProfile = join(fixture.root, "profile-policy.yaml");
  await writeFile(
    policyProfile,
    fixtureProfile()
      .replace("version: 1.0.0", "version: 2.0.0")
      .replace("researchPolicy: conditional", "researchPolicy: required"),
    "utf8",
  );
  const loaded = await refreshStage1Profile(fixture.project, policyProfile);

  assert.equal(loaded.state.project.profile.version, "2.0.0");
  assert.equal(loaded.state.stage1.decisions.D1?.selectedOption, "a");
  assert.equal(loaded.loadedProfile.profile.decisions[0]?.researchPolicy, "required");
});

test("Stage1 can discard stale pending advice during an explicit profile migration", async () => {
  const fixture = await createFixture();
  await initStage1(fixture.project, fixture.profile);
  await saveDecisionAdvice(
    fixture.project,
    "D1",
    `${JSON.stringify({
      decisionId: "D1",
      summary: "Old advice",
      facts: [],
      optionAnalysis: [],
      recommendation: "a",
      rationale: [],
      openQuestions: [],
    })}\n`,
  );

  const changedProfile = join(fixture.root, "profile-localized.yaml");
  await writeFile(
    changedProfile,
    fixtureProfile()
      .replace("version: 1.0.0", "version: 2.0.0")
      .replace("First option A.", "Localized first option A."),
    "utf8",
  );
  const loaded = await refreshStage1Profile(
    fixture.project,
    changedProfile,
    { resetChangedAdvice: true },
  );

  assert.equal(loaded.state.stage1.decisions.D1?.advicePath, undefined);
  await assert.rejects(readFile(join(fixture.project, "research", "stage1.md"), "utf8"));
  await assert.rejects(readFile(join(fixture.project, ".assistant", "advice", "D1.json"), "utf8"));
});

test("Stage1 remains blocked until skipped environment checks are probed", async () => {
  const fixture = await createFixture();
  await writeFile(
    fixture.profile,
    fixtureProfile().replace(
      "environmentChecks: []",
      `environmentChecks:
  - id: node
    description: Node runtime
    runner: host
    command: node
    args: ["--version"]
    required: true`,
    ),
    "utf8",
  );

  let loaded = await initStage1(fixture.project, fixture.profile, { skipProbe: true });
  assert.equal(loaded.state.stage1.status, "BLOCKED");
  await answerDecision(fixture.project, "D1", "a");
  loaded = await loadStage1(fixture.project);
  assert.equal(loaded.state.stage1.status, "BLOCKED");

  loaded = await probeEnvironment(fixture.project);
  assert.equal(loaded.state.stage1.status, "DECISION_LOOP");
});

test("Stage1 prohibits document-changing operations after approval", async () => {
  const fixture = await createFixture();
  await initStage1(fixture.project, fixture.profile);
  await answerDecision(fixture.project, "D1", "a");
  await answerDecision(fixture.project, "D2", "b");
  await reviewStage1(fixture.project);
  await savePassingReview(fixture.project);
  await approveStage1(fixture.project);

  await assert.rejects(probeEnvironment(fixture.project), /prohibited after Stage1 approval/u);
  await assert.rejects(reviewStage1(fixture.project), /prohibited after Stage1 approval/u);
});

test("Dual-issue production profile passes structural validation", async () => {
  const loaded = await loadProfile("dual_issue_demo");
  assert.equal(loaded.profile.version, "0.7.0");
  assert.deepEqual(
    loaded.profile.decisions.map((decision) => decision.researchPolicy),
    ["required", "none", "required", "conditional", "conditional", "required", "required", "required"],
  );
  assert.ok(loaded.profile.architecture.globalProtocols.length >= 8);
  assert.ok(loaded.profile.architecture.modules.some((module) => module.id === "issue"));
  assert.equal(loaded.profile.verification.decisionAcceptance.length, 8);
  assert.equal(loaded.profile.scaffold.files[0]?.path, "build.sbt");
});

test("Dual-issue production profile generates Chinese documents and strict project rules", async () => {
  const root = await mkdtemp(join(tmpdir(), "processor-agent-zh-project-"));
  const project = resolve(root, "project");
  await initStage1(project, "dual_issue_demo", { skipProbe: true });

  const overview = await readFile(join(project, "architecture", "overview.md"), "utf8");
  const manifest = await readFile(join(project, "architecture", "modules.yaml"), "utf8");
  const agents = await readFile(join(project, "AGENTS.md"), "utf8");
  assert.match(overview, /^# 架构总览/mu);
  assert.match(overview, /构建一个正确、可检查的顺序双发射 baseline/u);
  assert.match(manifest, /documentLanguage: zh-CN/u);
  assert.match(agents, /默认使用中文撰写人类可读文档/u);
  assert.match(agents, /禁止自行补协议、字段、身份保护和保守机制/u);
  assert.match(agents, /processor-agent open <path>/u);
  assert.match(agents, /不得用直接编辑替代 Harness 命令/u);
});

test("Workspace Agent prompt routes natural language through the Harness", async () => {
  const fixture = await createFixture();
  const initialized = await initStage1(fixture.project, fixture.profile);
  const revision = initialized.state.stage1.revision;

  const prompt = await buildWorkspaceAgentPrompt(fixture.project);

  assert.match(prompt, /processor-agent stage1 status \. --json/u);
  assert.match(prompt, /processor-agent stage1 next \. --json/u);
  assert.match(prompt, /processor-agent stage1 answer \. <decision-id> <option-id>/u);
  assert.match(prompt, /processor-agent stage1 research \. <decision-id>/u);
  assert.match(prompt, /影响正式决策的来源调研不得由 Workspace Agent 在主上下文中直接完成/u);
  assert.match(prompt, /nextAction=decision_ready/u);
  assert.match(prompt, /不得手工修改 `\.assistant\/`/u);
  assert.match(prompt, /不得一次要求用户确认多个架构决策/u);
  assert.match(prompt, /不得.*再次调用 `processor-agent open`/u);
  assert.match(prompt, /Stage1=DECISION_LOOP/u);
  assert.match(prompt, /nextDecision=D1/u);

  const reloaded = await loadStage1(fixture.project);
  assert.equal(reloaded.state.stage1.revision, revision);
});

test("Decision mutations preserve recorded research evidence", async () => {
  const fixture = await createFixture();
  await initStage1(fixture.project, fixture.profile);
  await saveDecisionAdvice(
    fixture.project,
    "D1",
    `${JSON.stringify(adviceFixture("D1", "a"), null, 2)}\n`,
  );

  await answerDecision(fixture.project, "D1", "a");
  let loaded = await loadStage1(fixture.project);
  assert.equal(loaded.state.stage1.decisions.D1?.advicePath, ".assistant/advice/D1.json");
  assert.match(await readFile(join(fixture.project, "research", "stage1.md"), "utf8"), /## D1:/u);

  await saveDecisionAdvice(
    fixture.project,
    "D2",
    `${JSON.stringify(adviceFixture("D2", "b"), null, 2)}\n`,
  );
  await answerCustomDecision(fixture.project, "D2", "Custom answer", "Custom rationale");
  loaded = await loadStage1(fixture.project);
  assert.equal(loaded.state.stage1.decisions.D2?.advicePath, ".assistant/advice/D2.json");

  await deferDecision(fixture.project, "D2", "Stage2", "Wait for implementation evidence");
  loaded = await loadStage1(fixture.project);
  assert.equal(loaded.state.stage1.decisions.D2?.advicePath, ".assistant/advice/D2.json");
});

test("Advise reattaches valid orphan advice without invoking Codex", async () => {
  const fixture = await createFixture();
  await initStage1(fixture.project, fixture.profile);
  const expected = adviceFixture("D1", "a");
  await saveDecisionAdvice(fixture.project, "D1", `${JSON.stringify(expected, null, 2)}\n`);

  const statePath = join(fixture.project, ".assistant", "project.yaml");
  const state = parse(await readFile(statePath, "utf8")) as Stage1ProjectState;
  delete state.stage1.decisions.D1?.advicePath;
  await writeFile(statePath, stringify(state, { lineWidth: 0 }), "utf8");

  const advice = await adviseDecision(fixture.project, "D1");
  assert.deepEqual(advice, expected);
  const loaded = await loadStage1(fixture.project);
  assert.equal(loaded.state.stage1.decisions.D1?.advicePath, ".assistant/advice/D1.json");
  assert.equal(loaded.state.stage1.history.at(-1)?.event, "DECISION_ADVICE_RECORDED");
});

test("Required research blocks a Decision until sufficient evidence is recorded", async () => {
  const fixture = await createFixture();
  await writeFile(
    fixture.profile,
    fixtureProfile().replace("researchPolicy: conditional", "researchPolicy: required"),
    "utf8",
  );
  const initialized = await initStage1(fixture.project, fixture.profile);
  assert.equal(getNextStage1Action(initialized.state, initialized.loadedProfile.profile)?.kind, "research_required");
  await assert.rejects(answerDecision(fixture.project, "D1", "a"), /requires current sufficient research/u);

  const tasks: string[] = [];
  await researchDecision(
    fixture.project,
    "D1",
    { executor: fixtureResearchExecutor(tasks, false) },
  );
  let loaded = await loadStage1(fixture.project);
  assert.equal(getNextStage1Action(loaded.state, loaded.loadedProfile.profile)?.kind, "research_required");
  await assert.rejects(answerDecision(fixture.project, "D1", "a"), /requires current sufficient research/u);

  await researchDecision(
    fixture.project,
    "D1",
    { refresh: true, executor: fixtureResearchExecutor(tasks, true) },
  );
  loaded = await loadStage1(fixture.project);
  assert.equal(getNextStage1Action(loaded.state, loaded.loadedProfile.profile)?.kind, "decision_ready");
  await answerDecision(fixture.project, "D1", "a");
  assert.deepEqual(tasks, ["research", "synthesis", "research", "synthesis"]);
});

test("Research policy none keeps a Decision ready and rejects a Research Task", async () => {
  const fixture = await createFixture();
  await writeFile(
    fixture.profile,
    fixtureProfile().replace("researchPolicy: conditional", "researchPolicy: none"),
    "utf8",
  );
  const initialized = await initStage1(fixture.project, fixture.profile);
  assert.equal(getNextStage1Action(initialized.state, initialized.loadedProfile.profile)?.kind, "decision_ready");
  await assert.rejects(
    researchDecision(fixture.project, "D1", { executor: fixtureResearchExecutor([], true) }),
    /researchPolicy=none/u,
  );
  await answerDecision(fixture.project, "D1", "a");
});

test("Research Task uses isolated evidence and synthesis workers with fingerprint cache", async () => {
  const fixture = await createFixture();
  await initStage1(fixture.project, fixture.profile);
  const tasks: string[] = [];
  const request = {
    question: "比较两个候选方案。",
    sources: ["https://example.com/core"],
    scope: "只检查发射路径。",
  };
  const first = await researchDecision(
    fixture.project,
    "D1",
    { request, executor: fixtureResearchExecutor(tasks, true) },
  );

  assert.equal(first.source, "worker");
  assert.equal(first.cacheHit, false);
  assert.equal(first.researchThreadId, "research-thread");
  assert.equal(first.synthesisThreadId, "synthesis-thread");
  assert.deepEqual(tasks, ["research", "synthesis"]);
  const loaded = await loadStage1(fixture.project);
  assert.equal(loaded.state.stage1.decisions.D1?.research?.fingerprint, first.fingerprint);
  assert.equal(loaded.state.stage1.decisions.D1?.research?.evidenceSufficient, true);

  const memo = await readFile(join(fixture.project, "research", "stage1.md"), "utf8");
  assert.match(memo, /Research Request：比较两个候选方案/u);
  assert.match(memo, /https:\/\/example\.com\/core/u);
  assert.match(memo, /Research Worker：`research-thread`/u);
  assert.match(memo, /成本：增加组合路径/u);

  const runtimeParent = join(
    fixture.root,
    ".runtime",
    "processor_agent",
    "project",
    "stage1",
    "D1",
  );
  const runs = await readdir(runtimeParent);
  assert.equal(runs.length, 1);
  assert.deepEqual(
    (await readdir(join(runtimeParent, runs[0] ?? ""))).sort(),
    [
      "evidence.json",
      "request.json",
      "research.codex.jsonl",
      "research.schema.json",
      "synthesis.codex.jsonl",
      "synthesis.json",
      "synthesis.schema.json",
    ],
  );

  const cached = await researchDecision(
    fixture.project,
    "D1",
    { request, executor: fixtureResearchExecutor(tasks, true) },
  );
  assert.equal(cached.source, "cache");
  assert.equal(cached.cacheHit, true);
  assert.equal(cached.runId, first.runId);
  assert.deepEqual(tasks, ["research", "synthesis"]);
  assert.equal((await readdir(runtimeParent)).length, 1);
});

test("Legacy advice satisfies a required research gate during profile migration", async () => {
  const fixture = await createFixture();
  await writeFile(
    fixture.profile,
    fixtureProfile().replace("researchPolicy: conditional", "researchPolicy: required"),
    "utf8",
  );
  await initStage1(fixture.project, fixture.profile);
  await saveDecisionAdvice(
    fixture.project,
    "D1",
    `${JSON.stringify(adviceFixture("D1", "a"), null, 2)}\n`,
  );
  const loaded = await loadStage1(fixture.project);
  assert.equal(getNextStage1Action(loaded.state, loaded.loadedProfile.profile)?.kind, "decision_ready");
  await answerDecision(fixture.project, "D1", "a");
});

async function createFixture(): Promise<{ root: string; project: string; profile: string }> {
  const root = await mkdtemp(join(tmpdir(), "processor-agent-stage1-"));
  const project = resolve(root, "project");
  const profile = resolve(root, "profile.yaml");
  await mkdir(project, { recursive: true });
  await writeFile(profile, fixtureProfile(), "utf8");
  return { root, project, profile };
}

function fixtureProfile(): string {
  return `schemaVersion: 1
id: test_profile
version: 1.0.0
displayName: Test Profile
description: Deterministic Stage1 test profile.
defaults:
  projectName: test_project
  goal: Test the Stage1 workflow.
  useCase: Automated verification.
  constraints: [small]
  exclusions: [none]
environmentChecks: []
decisions:
  - id: D1
    topic: First
    question: Select the first option.
    whyNow: It gates the second decision.
    blocking: true
    researchPolicy: conditional
    dependsOn: []
    knownFacts: [fact]
    recommendation: a
    affectedArtifacts: [architecture/overview.md]
    options:
      - id: a
        label: Option A
        summary: First option A.
        consequences: [A consequence]
      - id: b
        label: Option B
        summary: First option B.
        consequences: [B consequence]
  - id: D2
    topic: Second
    question: Select the second option.
    whyNow: It closes the test architecture.
    blocking: true
    researchPolicy: conditional
    dependsOn: [D1]
    knownFacts: [fact]
    recommendation: b
    affectedArtifacts: [verification/plan.md]
    options:
      - id: a
        label: Option A
        summary: Second option A.
        consequences: [A consequence]
      - id: b
        label: Option B
        summary: Second option B.
        consequences: [B consequence]
architecture:
  systemBoundary: [Test boundary]
  supportedInstructions: [Test instruction]
  invariants: [In order]
  sharedFields:
    - name: valid
      semantics: Test valid bit.
      producer: core
      consumers: [core]
      validFrom: input
      validUntil: output
  globalProtocols:
    - id: test_protocol
      owner: core
      rules: [Test rule]
  counterRules:
    - name: cycles
      increment: Increment every test cycle.
      exclusions: [reset]
  modules:
    - id: core
      responsibility: Test core.
      stateOwnership: []
      dependsOn: []
      interfaces: [test]
  stage2Order: [core]
verification:
  referenceModel: Test model.
  layers: [unit]
  requiredScenarios: [smoke]
  counters: [cycles]
scaffold:
  files:
    - path: build.fixture
      content: |
        fixture
  smokeChecks: []
`;
}

function adviceFixture(decisionId: string, recommendation: "a" | "b"): DecisionAdvice {
  return {
    decisionId,
    summary: `Advice for ${decisionId}`,
    facts: [],
    optionAnalysis: [
      { optionId: "a", benefits: [], costs: [], risks: [] },
      { optionId: "b", benefits: [], costs: [], risks: [] },
    ],
    recommendation,
    rationale: ["Fixture rationale"],
    openQuestions: [],
  };
}

function fixtureResearchExecutor(
  tasks: string[],
  evidenceSufficient: boolean,
): StructuredWorkerExecutor {
  return async ({ task }) => {
    tasks.push(task);
    if (task === "research") {
      const evidence: ResearchEvidence = {
        decisionId: "D1",
        sources: [
          {
            kind: "url",
            locator: "https://example.com/core",
            revision: "example-revision",
            accessedAt: "2026-08-30T00:00:00.000Z",
            locations: ["Issue path"],
          },
        ],
        facts: [
          {
            claim: "方案 a 的发射路径更短。",
            source: "https://example.com/core#issue",
            confidence: "high",
          },
        ],
        conflicts: [],
        gaps: evidenceSufficient ? [] : ["缺少完整时序数据。"],
        evidenceSufficient,
        stopReason: evidenceSufficient ? "关键事实已经覆盖。" : "缺少可访问的时序报告。",
      };
      return { output: evidence, threadId: "research-thread" };
    }
    const synthesis: DecisionSynthesis = {
      decisionId: "D1",
      summary: "基于已核验证据比较两个候选项。",
      optionAnalysis: [
        { optionId: "a", benefits: ["发射路径更短"], costs: ["增加组合路径"], risks: [] },
        { optionId: "b", benefits: [], costs: [], risks: ["性能收益较低"] },
      ],
      recommendation: "a",
      rationale: ["现有证据支持 a。"],
      openQuestions: evidenceSufficient ? [] : ["需要补充时序报告。"],
    };
    return { output: synthesis, threadId: "synthesis-thread" };
  };
}

async function savePassingReview(project: string): Promise<void> {
  const loaded = await loadStage1(project);
  await saveArchitectureReview(project, {
    reviewedAggregateSha256: currentGeneratedAggregate(loaded.state),
    verdict: "pass",
    summary: "Fixture architecture is ready for Stage2.",
    findings: [],
  });
}
