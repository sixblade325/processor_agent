import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { parse, stringify } from "yaml";
import {
  adviseDecision,
  buildWorkspaceAgentPrompt,
  isolatedCodexWorkerArguments,
  researchDecision,
  type StructuredWorkerExecutor,
} from "../src/agent-runtime.js";
import { toWslPath } from "../src/io.js";
import { loadProfile } from "../src/profile.js";
import { renderDecisionPacket } from "../src/render.js";
import {
  PROJECT_READER_TOOLS,
  listProjectFiles,
  readProjectFile,
  searchProjectText,
} from "../src/project-reader-mcp.js";
import {
  answerCustomDecision,
  answerDecision,
  applyReviewCorrection,
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
  reopenDecision,
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

test("Isolated Codex Workers ignore interactive execpolicy and retain the read-only sandbox", () => {
  const args = isolatedCodexWorkerArguments();
  assert.deepEqual(args, [
    "exec",
    "--ignore-user-config",
    "--ignore-rules",
    "--ephemeral",
    "--json",
    "--skip-git-repo-check",
    "--sandbox",
    "read-only",
  ]);
  assert.equal(args.includes("--dangerously-bypass-approvals-and-sandbox"), false);
  const researchArgs = isolatedCodexWorkerArguments("C:\\project");
  assert.match(researchArgs.join(" "), /mcp_servers\.processor_project\.command/u);
  assert.match(researchArgs.join(" "), /project-reader-mcp\.js/u);
});

test("Project Reader MCP exposes bounded read-only project evidence", async () => {
  const root = await mkdtemp(join(tmpdir(), "processor-agent-reader-"));
  await mkdir(join(root, "src"), { recursive: true });
  await mkdir(join(root, "target"), { recursive: true });
  await writeFile(join(root, "src", "Core.scala"), "class Core\nval redirect = true\n", "utf8");
  await writeFile(join(root, "target", "Generated.scala"), "val redirect = false\n", "utf8");

  assert.equal(await listProjectFiles(root), "src/Core.scala");
  assert.equal(await readProjectFile(root, "src/Core.scala", 2, 2), "2: val redirect = true");
  assert.equal(
    await searchProjectText(root, "redirect"),
    "src/Core.scala:2:val redirect = true",
  );
  assert.equal(PROJECT_READER_TOOLS.every((tool) => tool.annotations.readOnlyHint), true);
  assert.equal(PROJECT_READER_TOOLS.some((tool) => tool.annotations.destructiveHint), false);
  await assert.rejects(readProjectFile(root, "../outside"), /Unsafe relative path/u);
  await assert.rejects(
    readProjectFile(root, "target/Generated.scala"),
    /excluded from research/u,
  );
});

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

test("Review Correction updates structured project facts and requires a fresh audit", async () => {
  const fixture = await createFixture();
  await initStage1(fixture.project, fixture.profile);
  await answerDecision(fixture.project, "D1", "a");
  await answerDecision(fixture.project, "D2", "b");
  await reviewStage1(fixture.project);
  let loaded = await loadStage1(fixture.project);
  await saveArchitectureReview(fixture.project, {
    reviewedAggregateSha256: currentGeneratedAggregate(loaded.state),
    verdict: "fail",
    summary: "Module Manifest 缺少独立 queue 所有权。",
    findings: [
      {
        severity: "error",
        code: "MODULE_QUEUE_MISSING",
        message: "Module Manifest 未记录 queue 模块及状态所有权。",
        artifact: "architecture/modules.yaml",
        relatedDecision: "D2",
        repairKind: "project_spec",
        repairTarget: "architecture.modules",
        requiredClosure: ["queue 责任和状态所有权", "Stage2 实施顺序"],
        status: "open",
      },
    ],
  });

  loaded = await loadStage1(fixture.project);
  assert.equal(loaded.state.stage1.status, "REVIEW_CORRECTION");
  const action = getNextStage1Action(loaded.state, loaded.loadedProfile.profile);
  assert.equal(action?.kind, "review_finding");
  await assert.rejects(reviewStage1(fixture.project), /open audit finding MODULE_QUEUE_MISSING/u);

  const patch = {
    architecture: {
      modules: [
        {
          id: "core",
          responsibility: "Test core.",
          stateOwnership: [],
          dependsOn: [],
          interfaces: ["test"],
        },
        {
          id: "queue",
          responsibility: "Hold test instructions.",
          stateOwnership: ["entries", "valid"],
          dependsOn: ["core"],
          interfaces: ["enqueue", "dequeue"],
        },
      ],
      stage2Order: ["core", "queue"],
    },
  };
  const correctionResult = spawnSync(
    process.execPath,
    [
      resolve("dist", "src", "cli.js"),
      "stage1",
      "correct",
      fixture.project,
      "MODULE_QUEUE_MISSING",
      "--patch-json",
      JSON.stringify(patch),
      "--reason",
      "独立 queue 是当前项目已确认的流水边界。",
      "--source",
      "architecture/overview.md#架构决策",
    ],
    { encoding: "utf8" },
  );
  assert.equal(correctionResult.status, 0, correctionResult.stderr);
  assert.match(correctionResult.stdout, /Applied Review Correction: S1_CORR_001/u);
  loaded = await loadStage1(fixture.project);

  assert.equal(loaded.state.stage1.status, "ARCHITECTURE_REVIEW");
  assert.equal(loaded.state.stage1.review, undefined);
  assert.equal(loaded.state.stage1.reviewCorrections?.[0]?.status, "applied");
  assert.equal(loaded.state.stage1.reviewHistory?.[0]?.findings[0]?.status, "superseded");
  assert.equal(loaded.loadedProfile.profile.architecture.modules.length, 1);
  const manifest = parse(
    await readFile(join(fixture.project, "architecture", "modules.yaml"), "utf8"),
  ) as { modules: Array<{ id: string }>; stage2Order: string[] };
  assert.deepEqual(manifest.modules.map((module) => module.id), ["core", "queue"]);
  assert.deepEqual(manifest.stage2Order, ["core", "queue"]);

  await assert.rejects(approveStage1(fixture.project), /audit has not been recorded/u);
  await reviewStage1(fixture.project);
  await savePassingReview(fixture.project);
  loaded = await loadStage1(fixture.project);
  assert.equal(loaded.state.stage1.reviewCorrections?.[0]?.status, "verified");
  await approveStage1(fixture.project);
});

test("Review Correction enforces repair ownership and declared targets", async () => {
  const fixture = await createFixture();
  await initStage1(fixture.project, fixture.profile);
  await answerDecision(fixture.project, "D1", "a");
  await answerDecision(fixture.project, "D2", "b");
  await reviewStage1(fixture.project);
  let loaded = await loadStage1(fixture.project);
  await saveArchitectureReview(fixture.project, {
    reviewedAggregateSha256: currentGeneratedAggregate(loaded.state),
    verdict: "fail",
    summary: "D1 结论需要修正。",
    findings: [
      {
        severity: "error",
        code: "D1_SCOPE_WRONG",
        message: "D1 的适用范围与系统边界冲突。",
        artifact: "architecture/overview.md",
        relatedDecision: "D1",
        repairKind: "decision",
        repairTarget: "D1",
        requiredClosure: ["重新确认 D1 适用范围"],
        status: "open",
      },
    ],
  });
  loaded = await loadStage1(fixture.project);
  assert.equal(loaded.state.stage1.status, "DECISION_LOOP");
  await assert.rejects(
    applyReviewCorrection(fixture.project, {
      findingCodes: ["D1_SCOPE_WRONG"],
      patch: { architecture: { invariants: ["In order"] } },
      rationale: "错误入口测试。",
      sources: ["architecture/overview.md"],
    }),
    /must be repaired through decision/u,
  );
  const reopened = await reopenDecision(
    fixture.project,
    "D1",
    "按 audit finding 修正 D1 适用范围。",
  );
  assert.equal(reopened.loaded.state.stage1.decisions.D1?.status, "pending");
  assert.equal(reopened.loaded.state.stage1.review, undefined);
  assert.equal(reopened.loaded.state.stage1.reviewHistory?.[0]?.findings[0]?.code, "D1_SCOPE_WRONG");
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
  assert.match(agents, /每个源码和测试路径只允许一个 Module ID 拥有/u);
  assert.match(agents, /禁止自行补协议、字段、身份保护和保守机制/u);
  assert.match(agents, /processor-agent open <path>/u);
  assert.match(agents, /不得用直接编辑替代 Harness 命令/u);
  assert.match(agents, /processor-agent stage1 reopen/u);
  assert.doesNotMatch(agents, /delegated/u);
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
  assert.match(prompt, /processor-agent stage1 reopen \. <decision-id> --reason/u);
  assert.match(prompt, /processor-agent stage1 correct \. <finding-code>/u);
  assert.match(prompt, /repairKind=decision/u);
  assert.match(prompt, /影响正式决策的来源调研不得由 Workspace Agent 在主上下文中直接完成/u);
  assert.match(prompt, /nextAction=decision_ready/u);
  assert.match(prompt, /不得手工修改 `\.assistant\/`/u);
  assert.match(prompt, /不得一次要求用户确认多个架构决策/u);
  assert.match(prompt, /不得.*再次调用 `processor-agent open`/u);
  assert.doesNotMatch(prompt, /delegated|--delegated/u);
  assert.match(prompt, /Stage1=DECISION_LOOP/u);
  assert.match(prompt, /nextDecision=D1/u);

  const reloaded = await loadStage1(fixture.project);
  assert.equal(reloaded.state.stage1.revision, revision);
});

test("Stage1 answer rejects the removed delegated option", async () => {
  const fixture = await createFixture();
  await initStage1(fixture.project, fixture.profile);

  const result = spawnSync(
    process.execPath,
    [resolve("dist", "src", "cli.js"), "stage1", "answer", fixture.project, "D1", "a", "--delegated"],
    { encoding: "utf8" },
  );

  assert.equal(result.status, 1);
  assert.match(result.stderr, /Unknown option --delegated/u);
  const loaded = await loadStage1(fixture.project);
  assert.equal(loaded.state.stage1.decisions.D1?.status, "pending");
});

test("Decision answers preserve research evidence and reopening invalidates it", async () => {
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

  await reopenDecision(fixture.project, "D2", "Change the disposition to deferred.");
  await deferDecision(fixture.project, "D2", "Stage2", "Wait for implementation evidence");
  loaded = await loadStage1(fixture.project);
  assert.equal(loaded.state.stage1.decisions.D2?.advicePath, undefined);
  await assert.rejects(readFile(join(fixture.project, ".assistant", "advice", "D2.json"), "utf8"));
});

test("Reopening a Decision preserves its conclusion and invalidates stale advice and dependents", async () => {
  const fixture = await createFixture();
  await writeFile(
    fixture.profile,
    fixtureProfile().replace(
      "architecture:\n",
      `  - id: D3
    topic: Third
    question: Select the third option.
    whyNow: It verifies transitive invalidation.
    blocking: true
    researchPolicy: conditional
    dependsOn: [D2]
    knownFacts: [fact]
    recommendation: a
    affectedArtifacts: [architecture/overview.md]
    options:
      - id: a
        label: Option A
        summary: Third option A.
        consequences: [A consequence]
      - id: b
        label: Option B
        summary: Third option B.
        consequences: [B consequence]
architecture:
`,
    ),
    "utf8",
  );
  await initStage1(fixture.project, fixture.profile);
  await saveDecisionAdvice(
    fixture.project,
    "D1",
    `${JSON.stringify(adviceFixture("D1", "a"), null, 2)}\n`,
  );
  await answerDecision(fixture.project, "D1", "a");
  await saveDecisionAdvice(
    fixture.project,
    "D2",
    `${JSON.stringify(adviceFixture("D2", "b"), null, 2)}\n`,
  );
  await answerDecision(fixture.project, "D2", "b");
  await answerDecision(fixture.project, "D3", "a");

  const result = await reopenDecision(fixture.project, "D1", "The pipeline boundary changed.");
  assert.deepEqual(result.invalidatedDecisionIds, ["D2", "D3"]);
  const loaded = await loadStage1(fixture.project);
  assert.equal(loaded.state.stage1.status, "DECISION_LOOP");
  assert.equal(loaded.state.stage1.decisions.D1?.status, "pending");
  assert.equal(loaded.state.stage1.decisions.D1?.advicePath, undefined);
  assert.equal(loaded.state.stage1.decisions.D1?.revisions?.at(-1)?.kind, "reopened");
  assert.equal(loaded.state.stage1.decisions.D1?.revisions?.at(-1)?.previous.selectedOption, "a");
  assert.equal(loaded.state.stage1.decisions.D2?.status, "pending");
  assert.equal(loaded.state.stage1.decisions.D2?.advicePath, undefined);
  assert.equal(
    loaded.state.stage1.decisions.D2?.revisions?.at(-1)?.kind,
    "dependency_invalidated",
  );
  assert.equal(loaded.state.stage1.decisions.D3?.status, "pending");
  assert.equal(
    loaded.state.stage1.decisions.D3?.revisions?.at(-1)?.causeDecisionId,
    "D1",
  );
  const next = getNextStage1Action(loaded.state, loaded.loadedProfile.profile);
  assert.ok(next?.kind === "decision_ready" || next?.kind === "research_required");
  assert.equal(next.decision.id, "D1");
  assert.equal(next.decision.recommendation, "a");
  assert.match(next.revision?.previousConclusion ?? "", /Option A/u);
  await assert.rejects(readFile(join(fixture.project, ".assistant", "advice", "D1.json"), "utf8"));
  await assert.rejects(readFile(join(fixture.project, ".assistant", "advice", "D2.json"), "utf8"));
  await assert.rejects(readFile(join(fixture.project, "research", "stage1.md"), "utf8"));
  const overview = await readFile(join(fixture.project, "architecture", "overview.md"), "utf8");
  assert.match(overview, /修正记录/u);
  assert.match(overview, /revision \d+，用户重开/u);
  assert.match(overview, /因 D1 修正而失效/u);

  await answerDecision(fixture.project, "D1", "b");
  const corrected = await loadStage1(fixture.project);
  assert.equal(corrected.state.stage1.decisions.D1?.revisions?.length, 1);
  const correctedAction = getNextStage1Action(corrected.state, corrected.loadedProfile.profile);
  assert.ok(
    correctedAction?.kind === "decision_ready"
      || correctedAction?.kind === "research_required",
  );
  assert.equal(correctedAction.decision.id, "D2");
});

test("Reopened custom Decisions use the previous conclusion as the revision baseline", async () => {
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
  const previousConclusion = "PF -> ICache -> IF -> Instruction Queue -> Issue/RR -> EX -> M1 -> M2/Retire。Issue 与组合寄存器读取合并，EX 产生 ALU 结果和 redirect，M1 保持程序年龄对齐，M2/Retire 完成写回与顺序退休，不设置独立 WB，不增加 Completion Queue，末尾约束不得丢失。";
  const correctedConclusion = "PF -> ICache -> IF -> Instruction Queue -> Issue -> RR -> EX -> M1 -> M2/Retire";
  await answerCustomDecision(fixture.project, "D1", previousConclusion, "此前讨论形成的完整流水级方案");
  await answerDecision(fixture.project, "D2", "b");
  await reopenDecision(fixture.project, "D1", "拆分 Issue 与 RR，并保留其余流水边界");

  let loaded = await loadStage1(fixture.project);
  let next = getNextStage1Action(loaded.state, loaded.loadedProfile.profile);
  assert.equal(next?.kind, "research_required");
  assert.equal(next?.decision.recommendation, "revise_previous");
  assert.equal(next?.revision?.previousConclusion, previousConclusion);
  assert.equal(next?.revision?.reason, "拆分 Issue 与 RR，并保留其余流水边界");
  assert.equal(loaded.state.stage1.decisions.D1?.advicePath, undefined);
  const packet = renderDecisionPacket(next?.decision as NonNullable<typeof next>["decision"], loaded.state);
  assert.match(packet, /当前模式：修正此前结论/u);
  assert.match(packet, /PF -> ICache -> IF -> Instruction Queue/u);
  assert.match(packet, /拆分 Issue 与 RR/u);
  const reopenedOverview = await readFile(
    join(fixture.project, "architecture", "overview.md"),
    "utf8",
  );
  assert.match(reopenedOverview, /末尾约束不得丢失/u);

  const prompts: Array<{ task: string; prompt: string }> = [];
  const executor: StructuredWorkerExecutor = async (call) => {
    prompts.push({ task: call.task, prompt: call.prompt });
    if (call.task === "research") {
      return {
        output: {
          decisionId: "D1",
          sources: [{
            kind: "project",
            locator: "architecture/overview.md",
            revision: "fixture-revision",
            accessedAt: "2026-08-30T00:00:00.000Z",
            locations: ["流水级修正记录"],
          }],
          facts: [{
            claim: "此次修正只要求拆分 Issue 与 RR。",
            source: "architecture/overview.md#流水级修正记录",
            confidence: "high",
          }],
          conflicts: [],
          gaps: [],
          evidenceSufficient: true,
          stopReason: "修正范围与既有结论均已定位。",
        },
        threadId: "revision-research-thread",
      };
    }
    return {
      output: {
        decisionId: "D1",
        summary: "保留既有流水边界，只拆分 Issue 与 RR。",
        optionAnalysis: [
          {
            optionId: "revise_previous",
            benefits: ["保留此前已经闭合的边界"],
            costs: ["需要更新 Issue/RR 接口"],
            risks: [],
          },
          { optionId: "a", benefits: [], costs: [], risks: ["会丢失此前自定义边界"] },
          { optionId: "b", benefits: [], costs: [], risks: ["会扩大本次修正范围"] },
        ],
        recommendation: "revise_previous",
        proposedCustomAnswer: correctedConclusion,
        rationale: ["该结论仅修复审查指出的问题。"],
        openQuestions: [],
      },
      threadId: "revision-synthesis-thread",
    };
  };
  await researchDecision(fixture.project, "D1", { executor });

  loaded = await loadStage1(fixture.project);
  next = getNextStage1Action(loaded.state, loaded.loadedProfile.profile);
  assert.equal(next?.kind, "decision_ready");
  assert.equal(next?.decision.recommendation, "revise_previous");
  assert.equal(next?.revision?.proposedCustomAnswer, correctedConclusion);
  assert.equal(loaded.state.stage1.decisions.D1?.research?.recommendation, "revise_previous");
  assert.equal(loaded.state.stage1.decisions.D1?.research?.proposedCustomAnswer, correctedConclusion);
  assert.match(prompts.find((item) => item.task === "research")?.prompt ?? "", /PF -> ICache/u);
  assert.match(prompts.find((item) => item.task === "synthesis")?.prompt ?? "", /拆分 Issue 与 RR/u);
  const memo = await readFile(join(fixture.project, "research", "stage1.md"), "utf8");
  assert.match(memo, new RegExp(correctedConclusion.replaceAll("/", "\\/"), "u"));

  await answerCustomDecision(
    fixture.project,
    "D1",
    next?.revision?.proposedCustomAnswer ?? "",
    "按修订建议确认",
  );
  loaded = await loadStage1(fixture.project);
  assert.equal(loaded.state.stage1.decisions.D1?.customAnswer, correctedConclusion);
});

test("Reopen requires a closed unapproved Decision and an explicit reason", async () => {
  const fixture = await createFixture();
  await initStage1(fixture.project, fixture.profile);
  await assert.rejects(reopenDecision(fixture.project, "D1", "reason"), /already pending/u);
  await answerDecision(fixture.project, "D1", "a");
  await assert.rejects(reopenDecision(fixture.project, "D1", "   "), /requires a reason/u);
  await assert.rejects(
    answerCustomDecision(fixture.project, "D1", "replacement"),
    /run stage1 reopen/u,
  );
  await answerDecision(fixture.project, "D2", "b");
  await reviewStage1(fixture.project);
  await savePassingReview(fixture.project);
  await approveStage1(fixture.project);
  await assert.rejects(reopenDecision(fixture.project, "D1", "reason"), /already approved/u);
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
      proposedCustomAnswer: null,
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
