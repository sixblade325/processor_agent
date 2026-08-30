import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { buildWorkspaceAgentPrompt } from "../src/agent-runtime.js";
import {
  buildStage2CodexArguments,
  type Stage2AgentCall,
  type Stage2AgentExecutor,
} from "../src/stage2-runtime.js";
import {
  answerDecision,
  approveStage1,
  completeStage1,
  currentGeneratedAggregate,
  initStage1,
  reviewStage1,
  saveArchitectureReview,
  scaffoldStage1,
} from "../src/stage1.js";
import {
  approveModuleDesign,
  getReadyStage2Actions,
  initStage2,
  loadStage2,
  reopenModuleDesign,
  runActiveImplementation,
  runModuleVerification,
  runShadowDesign,
  summarizeStage2,
} from "../src/stage2.js";
import type {
  CommandResult,
  CommandSpec,
  Stage2DesignProposal,
  Stage2ImplementationProposal,
  Stage2ReviewReport,
} from "../src/types.js";

test("Stage2 completes the regfile tracer and rotates persistent Agent roles", async () => {
  const fixture = await createCompletedStage1Fixture(["regfile", "fetch"]);
  let loaded = await initStage2(fixture.project);
  assert.equal(loaded.state.stage2.agents.A.role, "shadow");
  assert.equal(loaded.state.stage2.agents.A.moduleId, "regfile");
  assert.equal(loaded.state.stage2.agents.B.role, "idle");
  assert.deepEqual(getReadyStage2Actions(loaded.state), [
    { kind: "shadow_design", moduleId: "regfile", slot: "A" },
  ]);

  const calls: string[] = [];
  const executor = fixtureExecutor(calls);
  await runShadowDesign(fixture.project, "regfile", undefined, { executor });
  loaded = await loadStage2(fixture.project);
  assert.equal(loaded.state.stage2.modules.regfile?.status, "AWAITING_APPROVAL");
  assert.equal(loaded.state.stage2.modules.regfile?.design?.threadId, "thread-A");
  assert.deepEqual(
    loaded.state.stage2.modules.regfile?.design?.skills.map((skill) => skill.id),
    ["design-chisel-processor"],
  );
  assert.match(
    await readFile(join(fixture.project, "design", "regfile.md"), "utf8"),
    /状态：待确认/u,
  );

  await approveModuleDesign(fixture.project, "regfile", "active_only");
  loaded = await loadStage2(fixture.project);
  assert.equal(loaded.state.stage2.agents.A.role, "active");
  assert.equal(loaded.state.stage2.agents.A.moduleId, "regfile");
  assert.equal(loaded.state.stage2.agents.B.role, "shadow");
  assert.equal(loaded.state.stage2.agents.B.moduleId, "fetch");
  assert.equal(
    loaded.state.stage2.modules.regfile?.design?.approval?.verificationMode,
    "active_only",
  );

  await runShadowDesign(fixture.project, "fetch", undefined, { executor });
  await runActiveImplementation(fixture.project, "regfile", {
    executor,
    commandRunner: passingCommandRunner,
  });
  loaded = await loadStage2(fixture.project);
  assert.equal(loaded.state.stage2.modules.regfile?.status, "VERIFYING");
  assert.deepEqual(
    loaded.state.stage2.modules.regfile?.implementation?.skills.map((skill) => skill.id),
    ["design-chisel-processor", "implement-chisel-processor"],
  );
  assert.equal(
    await readFile(join(fixture.project, "src", "main", "scala", "demo", "Regfile.scala"), "utf8"),
    "package demo\nclass Regfile\n",
  );

  await approveModuleDesign(fixture.project, "fetch", "active_only");
  loaded = await runModuleVerification(fixture.project, "regfile", {
    executor,
    commandRunner: passingCommandRunner,
  });
  assert.equal(loaded.state.stage2.modules.regfile?.status, "COMPLETE");
  assert.equal(loaded.state.stage2.modules.regfile?.verification?.independent, false);
  assert.equal(loaded.state.stage2.modules.regfile?.verification?.waivedByUser, true);
  assert.equal(loaded.state.stage2.agents.B.role, "active");
  assert.equal(loaded.state.stage2.agents.B.moduleId, "fetch");
  assert.equal(loaded.state.stage2.agents.B.threadId, "thread-B");
  assert.equal(loaded.state.stage2.agents.A.role, "idle");
  assert.equal(loaded.state.stage2.agents.A.threadId, "thread-A");
  assert.match(
    await readFile(join(fixture.project, "verification", "regfile.md"), "utf8"),
    /waivedByUser: true/u,
  );
  assert.deepEqual(calls.slice(-2), ["active_static_review", "active_verification_review"]);

  const summary = await summarizeStage2(loaded);
  assert.equal(summary.complete, 1);
  assert.equal(summary.total, 2);
  assert.ok(summary.readyActions.some((action) =>
    action.kind === "active_implementation" && action.moduleId === "fetch"
  ));
});

test("Stage2 independent mode records two short-lived verification Workers", async () => {
  const fixture = await createCompletedStage1Fixture(["regfile"]);
  const calls: string[] = [];
  const executor = fixtureExecutor(calls);
  await initStage2(fixture.project);
  await runShadowDesign(fixture.project, "regfile", undefined, { executor });
  await approveModuleDesign(fixture.project, "regfile", "independent_workers");
  await runActiveImplementation(fixture.project, "regfile", {
    executor,
    commandRunner: passingCommandRunner,
  });
  const loaded = await runModuleVerification(fixture.project, "regfile", {
    executor,
    commandRunner: passingCommandRunner,
  });

  const verification = loaded.state.stage2.modules.regfile?.verification;
  assert.equal(loaded.state.stage2.status, "BASELINE_READY");
  assert.equal(verification?.independent, true);
  assert.equal(verification?.waivedByUser, false);
  assert.equal(verification?.staticReview?.performedBy, "worker");
  assert.equal(verification?.verificationReview?.performedBy, "worker");
  assert.equal(verification?.staticReview?.threadId, "worker-static");
  assert.equal(verification?.verificationReview?.threadId, "worker-verification");
  assert.ok(calls.includes("independent_static_review"));
  assert.ok(calls.includes("independent_verification"));
  assert.deepEqual(getReadyStage2Actions(loaded.state), [{ kind: "baseline_complete" }]);
});

test("Stage2 persists an incomplete Design and rejects approval until closure", async () => {
  const fixture = await createCompletedStage1Fixture(["regfile"]);
  await initStage2(fixture.project);
  const executor: Stage2AgentExecutor = async (call) => {
    const proposal = designProposal("regfile");
    proposal.implementation.sourcePaths = [];
    proposal.implementation.testPaths = [];
    proposal.acceptance.assertions = [];
    proposal.acceptance.directedTests = [];
    proposal.acceptance.commands = [];
    proposal.acceptance.expectedResults = [];
    proposal.openQuestions = ["请确认 regfile 的实现与测试路径。"];
    return { output: proposal, events: "", threadId: "thread-A" };
  };

  await runShadowDesign(fixture.project, "regfile", undefined, { executor });
  const loaded = await loadStage2(fixture.project);
  assert.equal(loaded.state.stage2.modules.regfile?.status, "AWAITING_APPROVAL");
  assert.equal(getReadyStage2Actions(loaded.state)[0]?.kind, "design_revision");
  assert.match(
    await readFile(join(fixture.project, "design", "regfile.md"), "utf8"),
    /请确认 regfile 的实现与测试路径/u,
  );
  await assert.rejects(
    approveModuleDesign(fixture.project, "regfile", "active_only"),
    /Design is not closed.*Open design question/u,
  );
});

test("Stage2 gives every source and test path one Module owner", async () => {
  const fixture = await createCompletedStage1Fixture(["regfile", "fetch"]);
  const executor = fixtureExecutor([]);
  await initStage2(fixture.project);
  await runShadowDesign(fixture.project, "regfile", undefined, { executor });
  await approveModuleDesign(fixture.project, "regfile", "active_only");

  const overlappingExecutor: Stage2AgentExecutor = async (call) => {
    const proposal = designProposal(moduleIdFromCall(call));
    proposal.implementation.sourcePaths = ["src/main/scala/demo/Regfile.scala"];
    return { output: proposal, events: "", threadId: "thread-B" };
  };
  await runShadowDesign(fixture.project, "fetch", undefined, {
    executor: overlappingExecutor,
  });

  const loaded = await loadStage2(fixture.project);
  assert.match(
    loaded.state.stage2.modules.fetch?.blockers.join("\n") ?? "",
    /Implementation path .*Regfile\.scala is already owned by module regfile/u,
  );
  await assert.rejects(
    approveModuleDesign(fixture.project, "fetch", "active_only"),
    /Design is not closed.*already owned by module regfile/u,
  );
});

test("Stage2 rejects Design references that are not project files", async () => {
  const fixture = await createCompletedStage1Fixture(["regfile"]);
  await initStage2(fixture.project);
  const executor: Stage2AgentExecutor = async () => {
    const proposal = designProposal("regfile");
    proposal.sourceReferences = ["src/main/scala/demo/Missing.scala"];
    return { output: proposal, events: "", threadId: "thread-A" };
  };
  await assert.rejects(
    runShadowDesign(fixture.project, "regfile", undefined, { executor }),
    /Design references missing authority/u,
  );
});

test("Stage2 rejects a stale concurrent Shadow result for the same module", async () => {
  const fixture = await createCompletedStage1Fixture(["regfile"]);
  await initStage2(fixture.project);
  const firstGate = deferred();
  const secondGate = deferred();
  const firstEntered = deferred();
  const secondEntered = deferred();
  let calls = 0;
  const executor: Stage2AgentExecutor = async () => {
    const index = calls;
    calls += 1;
    if (index === 0) {
      firstEntered.resolve();
      await firstGate.promise;
    } else {
      secondEntered.resolve();
      await secondGate.promise;
    }
    return { output: designProposal("regfile"), events: "", threadId: "thread-A" };
  };

  const first = runShadowDesign(fixture.project, "regfile", undefined, { executor });
  await firstEntered.promise;
  const second = runShadowDesign(fixture.project, "regfile", undefined, { executor });
  await secondEntered.promise;
  firstGate.resolve();
  await first;
  secondGate.resolve();
  await assert.rejects(second, /Stale Stage2 Agent result/u);
});

test("Stage2 rejects protected input changes from an independent Verification Worker", async () => {
  const fixture = await createCompletedStage1Fixture(["regfile"]);
  const baseExecutor = fixtureExecutor([]);
  const executor: Stage2AgentExecutor = async (call) => {
    const response = await baseExecutor(call);
    if (call.task === "independent_verification") {
      await writeFile(
        join(call.projectRoot, "src", "main", "scala", "demo", "Regfile.scala"),
        "package demo\nclass TamperedRegfile\n",
        "utf8",
      );
    }
    return response;
  };
  await initStage2(fixture.project);
  await runShadowDesign(fixture.project, "regfile", undefined, { executor });
  await approveModuleDesign(fixture.project, "regfile", "independent_workers");
  await runActiveImplementation(fixture.project, "regfile", {
    executor,
    commandRunner: passingCommandRunner,
  });

  await assert.rejects(
    runModuleVerification(fixture.project, "regfile", {
      executor,
      commandRunner: passingCommandRunner,
    }),
    /modified protected inputs.*Regfile\.scala/u,
  );
  const loaded = await loadStage2(fixture.project);
  assert.equal(loaded.state.stage2.modules.regfile?.status, "VERIFYING");
});

test("Stage2 rejects implementation paths outside the approved Design", async () => {
  const fixture = await createCompletedStage1Fixture(["regfile"]);
  const executor = fixtureExecutor([]);
  await initStage2(fixture.project);
  await runShadowDesign(fixture.project, "regfile", undefined, { executor });
  await approveModuleDesign(fixture.project, "regfile", "active_only");
  const before = await readFile(join(fixture.project, "architecture", "overview.md"), "utf8");
  const badExecutor: Stage2AgentExecutor = async (call) => {
    if (call.task !== "active_implementation") {
      return executor(call);
    }
    const moduleId = moduleIdFromCall(call);
    const proposal: Stage2ImplementationProposal = {
      schemaVersion: 1,
      moduleId,
      designSha256: designShaFromCall(call),
      summary: "越权修改。",
      files: [
        {
          path: "architecture/overview.md",
          kind: "source",
          baseSha256: null,
          content: "invalid\n",
          purpose: "不允许的修改。",
        },
      ],
      notes: [],
      designGap: null,
    };
    return { output: proposal, events: "", threadId: "thread-A" };
  };

  await assert.rejects(
    runActiveImplementation(fixture.project, "regfile", {
      executor: badExecutor,
      commandRunner: passingCommandRunner,
    }),
    /exceeds allowed source paths/u,
  );
  assert.equal(await readFile(join(fixture.project, "architecture", "overview.md"), "utf8"), before);
  assert.equal((await loadStage2(fixture.project)).state.stage2.modules.regfile?.status, "IMPLEMENTING");
});

test("Stage2 blocks approval on Design drift and supports explicit Design reopen", async () => {
  const fixture = await createCompletedStage1Fixture(["regfile"]);
  const executor = fixtureExecutor([]);
  await initStage2(fixture.project);
  await runShadowDesign(fixture.project, "regfile", undefined, { executor });
  const designPath = join(fixture.project, "design", "regfile.md");
  await writeFile(designPath, `${await readFile(designPath, "utf8")}manual drift\n`, "utf8");
  await assert.rejects(
    approveModuleDesign(fixture.project, "regfile", "active_only"),
    /Design changed outside Harness/u,
  );

  await runShadowDesign(fixture.project, "regfile", "恢复 Harness 管理的 Design。", { executor });
  await approveModuleDesign(fixture.project, "regfile", "active_only");
  let loaded = await reopenModuleDesign(fixture.project, "regfile", "需要补充同拍写后读优先级。");
  assert.equal(loaded.state.stage2.modules.regfile?.status, "DESIGNING");
  assert.equal(loaded.state.stage2.modules.regfile?.design?.approval, undefined);
  assert.equal(loaded.state.stage2.agents.A.role, "shadow");
  assert.equal(loaded.state.stage2.modules.regfile?.reopened.length, 1);

  const gapExecutor: Stage2AgentExecutor = async (call) => {
    if (call.task !== "active_implementation") {
      return executor(call);
    }
    const proposal: Stage2ImplementationProposal = {
      schemaVersion: 1,
      moduleId: "regfile",
      designSha256: designShaFromCall(call),
      summary: "发现 Design 缺口。",
      files: [],
      notes: [],
      designGap: {
        reason: "写口冲突优先级未闭合",
        counterexample: "两个退休 Lane 同拍写同一寄存器时没有规定结果",
      },
    };
    return { output: proposal, events: "", threadId: "thread-A" };
  };
  await runShadowDesign(fixture.project, "regfile", "补充同拍写口冲突规则。", { executor });
  await approveModuleDesign(fixture.project, "regfile", "active_only");
  loaded = (await runActiveImplementation(fixture.project, "regfile", {
    executor: gapExecutor,
    commandRunner: passingCommandRunner,
  })).loaded;
  assert.equal(loaded.state.stage2.modules.regfile?.status, "DESIGNING");
  assert.equal(loaded.state.stage2.modules.regfile?.reopened.length, 2);
});

test("Stage2 CLI and Workspace prompt expose the Harness workflow", async () => {
  const fixture = await createCompletedStage1Fixture(["regfile"]);
  await initStage2(fixture.project);
  const result = spawnSync(
    process.execPath,
    [resolve("dist", "src", "cli.js"), "stage2", "status", fixture.project, "--json"],
    { encoding: "utf8" },
  );
  assert.equal(result.status, 0, result.stderr);
  const summary = JSON.parse(result.stdout) as { active?: unknown; shadow?: { moduleId?: string } };
  assert.equal(summary.shadow?.moduleId, "regfile");

  const prompt = await buildWorkspaceAgentPrompt(fixture.project);
  assert.match(prompt, /processor-agent stage2 status/u);
  assert.match(prompt, /independent_workers/u);
  assert.match(prompt, /不得继承上一模块选择/u);
});

test("Stage2 Codex Runtime distinguishes persistent, resumed, and ephemeral sessions", () => {
  const base: Stage2AgentCall = {
    task: "shadow_design",
    projectRoot: "C:\\project",
    runtimeRoot: "C:\\runtime",
    prompt: "prompt",
    schema: { type: "object" },
    persistent: true,
    sandbox: "read-only",
  };
  const persistent = buildStage2CodexArguments(base);
  assert.equal(persistent.includes("--ephemeral"), false);
  assert.equal(persistent.includes("--output-schema"), true);
  assert.equal(persistent.includes("--ignore-user-config"), true);
  assert.equal(persistent.includes("--ignore-rules"), true);
  assert.equal(persistent.includes("C:\\project"), true);
  const ephemeral = buildStage2CodexArguments({
    ...base,
    task: "independent_static_review",
    persistent: false,
  });
  assert.equal(ephemeral.includes("--ephemeral"), true);
  const resumed = buildStage2CodexArguments({ ...base, sessionId: "thread-id" });
  assert.deepEqual(resumed.slice(0, 2), ["exec", "resume"]);
  assert.equal(resumed.includes("--output-schema"), true);
  assert.equal(resumed.includes("--ignore-user-config"), true);
  assert.equal(resumed.includes("--ignore-rules"), true);
});

async function createCompletedStage1Fixture(
  moduleOrder: string[],
): Promise<{ root: string; project: string; profile: string }> {
  const root = await mkdtemp(join(tmpdir(), "processor-agent-stage2-"));
  const project = resolve(root, "project");
  const profile = resolve(root, "profile.yaml");
  await mkdir(project, { recursive: true });
  await writeFile(profile, stage2FixtureProfile(moduleOrder), "utf8");
  await initStage1(project, profile, { projectName: "stage2_fixture" });
  await answerDecision(project, "D1", "approved");
  await reviewStage1(project);
  const loaded = await import("../src/stage1.js").then(({ loadStage1 }) => loadStage1(project));
  await saveArchitectureReview(project, {
    reviewedAggregateSha256: currentGeneratedAggregate(loaded.state),
    verdict: "pass",
    summary: "Stage2 fixture architecture is closed.",
    findings: [],
  });
  await approveStage1(project);
  await scaffoldStage1(project);
  await completeStage1(project);
  return { root, project, profile };
}

function stage2FixtureProfile(moduleOrder: string[]): string {
  const owner = moduleOrder[0] ?? "regfile";
  const modules = moduleOrder.map((id) => `    - id: ${id}
      responsibility: Implement ${id}.
      stateOwnership: [${id}_state]
      dependsOn: []
      interfaces: [${id}_interface]`).join("\n");
  return `schemaVersion: 1
id: stage2_fixture
version: 1.0.0
displayName: Stage2 Fixture
description: Deterministic Stage2 test profile.
defaults:
  projectName: stage2_fixture
  goal: Test Stage2.
  useCase: Automated verification.
  constraints: [small]
  exclusions: [optimization]
environmentChecks: []
decisions:
  - id: D1
    topic: Architecture
    question: Approve fixture architecture.
    whyNow: It gates Stage2.
    blocking: true
    researchPolicy: none
    dependsOn: []
    knownFacts: [fixture]
    recommendation: approved
    affectedArtifacts: [architecture/overview.md]
    options:
      - id: approved
        label: Approved
        summary: Use fixture architecture.
        consequences: [Stage2 may start.]
architecture:
  systemBoundary: [Fixture boundary]
  supportedInstructions: [Fixture instruction]
  invariants: [In order]
  sharedFields:
    - name: valid
      semantics: Fixture valid.
      producer: core
      consumers: [core]
      validFrom: input
      validUntil: output
  globalProtocols:
    - id: fixture_protocol
      owner: ${owner}
      rules: [Fixture rule]
  counterRules:
    - name: cycles
      increment: Every cycle.
      exclusions: [reset]
  modules:
${modules}
  stage2Order: [${moduleOrder.join(", ")}]
verification:
  referenceModel: Fixture model.
  layers: [unit]
  requiredScenarios: [smoke]
  counters: [cycles]
  decisionAcceptance:
    - decisionId: D1
      criteria: [Fixture architecture remains unchanged.]
scaffold:
  files:
    - path: build.fixture
      content: |
        fixture
  smokeChecks: []
`;
}

function fixtureExecutor(calls: string[]): Stage2AgentExecutor {
  return async (call) => {
    calls.push(call.task);
    const moduleId = moduleIdFromCall(call);
    const slot = slotFromCall(call);
    if (call.task === "shadow_design") {
      return {
        output: designProposal(moduleId),
        events: "",
        threadId: `thread-${slot}`,
      };
    }
    if (call.task === "active_implementation") {
      const className = capitalize(moduleId);
      const proposal: Stage2ImplementationProposal = {
        schemaVersion: 1,
        moduleId,
        designSha256: designShaFromCall(call),
        summary: `实现 ${moduleId}。`,
        files: [
          {
            path: `src/main/scala/demo/${className}.scala`,
            kind: "source",
            baseSha256: null,
            content: `package demo\nclass ${className}\n`,
            purpose: `${moduleId} 实现。`,
          },
          {
            path: `src/test/scala/demo/${className}Spec.scala`,
            kind: "test",
            baseSha256: null,
            content: `package demo\nclass ${className}Spec\n`,
            purpose: `${moduleId} 定向测试。`,
          },
        ],
        notes: [],
        designGap: null,
      };
      return { output: proposal, events: "", threadId: `thread-${slot}` };
    }
    const kind = call.task.includes("static") ? "static" : "verification";
    const report: Stage2ReviewReport = {
      schemaVersion: 1,
      kind,
      moduleId,
      designSha256: designShaFromCall(call),
      implementationAggregateSha256: implementationShaFromCall(call),
      verdict: "pass",
      summary: `${kind} pass。`,
      findings: [],
      commandResults: kind === "static" ? [] : passingCommandResults(),
    };
    const threadId = call.task === "independent_static_review"
      ? "worker-static"
      : call.task === "independent_verification"
        ? "worker-verification"
        : `thread-${slot}`;
    return { output: report, events: "", threadId };
  };
}

function designProposal(moduleId: string): Stage2DesignProposal {
  const className = capitalize(moduleId);
  return {
    schemaVersion: 1,
    moduleId,
    summary: `${moduleId} 的闭合模块设计。`,
    architectureReferences: [
      "architecture/overview.md",
      "architecture/modules.yaml",
      "verification/plan.md",
    ],
    sourceReferences: [],
    explicitExclusions: ["不改变全局流水边界。"],
    interfaces: [`${moduleId}_interface`],
    fields: [
      {
        name: `${moduleId}_state`,
        semantics: "模块状态。",
        producer: moduleId,
        storage: `${className} register`,
        consumers: [moduleId],
        lifetime: "reset 到更新事件。",
      },
    ],
    events: [
      {
        name: "update",
        condition: "输入有效。",
        effects: ["更新模块状态。"],
        priority: "reset 高于 update。",
      },
    ],
    cycleBehavior: ["周期边界更新状态。"],
    exceptionalBehavior: ["reset 清零状态。"],
    invariants: ["状态只由模块所有者更新。"],
    sharedInterfaceChanges: [],
    affectedModules: [],
    implementation: {
      sourcePaths: [`src/main/scala/demo/${className}.scala`],
      testPaths: [`src/test/scala/demo/${className}Spec.scala`],
    },
    acceptance: {
      assertions: ["reset 后状态为零。"],
      directedTests: ["正常更新和 reset。"],
      commands: [fixtureCommandSpec()],
      expectedResults: ["命令成功且无断言失败。"],
    },
    risks: [],
    openQuestions: [],
  };
}

function fixtureCommandSpec(): CommandSpec {
  return {
    id: "fixture_test",
    description: "Run fixture verification.",
    runner: "host",
    command: "node",
    args: ["--version"],
    required: true,
  };
}

function passingCommandRunner(specs: CommandSpec[]): CommandResult[] {
  return specs.map((spec) => ({
    id: spec.id,
    description: spec.description,
    runner: spec.runner,
    command: spec.script ?? [spec.command, ...(spec.args ?? [])].join(" "),
    required: spec.required,
    ok: true,
    exitCode: 0,
    output: "pass",
    checkedAt: "2026-08-30T00:00:00.000Z",
  }));
}

function passingCommandResults(): CommandResult[] {
  return passingCommandRunner([fixtureCommandSpec()]);
}

function moduleIdFromCall(call: Stage2AgentCall): string {
  const match = /"module"\s*:\s*\{\s*"id"\s*:\s*"([^"]+)"/u.exec(call.prompt);
  if (match?.[1] === undefined) {
    throw new Error(`No module in ${call.task} prompt`);
  }
  return match[1];
}

function slotFromCall(call: Stage2AgentCall): string {
  return /"slot"\s*:\s*"([AB])"/u.exec(call.prompt)?.[1] ?? "A";
}

function designShaFromCall(call: Stage2AgentCall): string {
  const match = /"designSha256"\s*:\s*"([a-f0-9]+)"/u.exec(call.prompt);
  if (match?.[1] === undefined) {
    throw new Error(`No Design SHA in ${call.task} prompt`);
  }
  return match[1];
}

function implementationShaFromCall(call: Stage2AgentCall): string {
  const match = /"aggregateSha256"\s*:\s*"([a-f0-9]+)"/u.exec(call.prompt);
  if (match?.[1] === undefined) {
    throw new Error(`No implementation SHA in ${call.task} prompt`);
  }
  return match[1];
}

function capitalize(value: string): string {
  return `${value.slice(0, 1).toUpperCase()}${value.slice(1)}`;
}

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolvePromise: (() => void) | undefined;
  const promise = new Promise<void>((resolve) => {
    resolvePromise = resolve;
  });
  return {
    promise,
    resolve: () => {
      resolvePromise?.();
    },
  };
}
