import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { buildWorkspaceAgentPrompt } from "../src/agent-runtime.js";
import { sha256 } from "../src/io.js";
import { validateArchitectureRoleMapping } from "../src/stage2/topology-model.js";
import {
  buildStage2CodexArguments,
  type Stage2AgentCall,
  type Stage2AgentExecutor,
} from "../src/stage2-runtime.js";
import {
  answerCustomDecision,
  answerDecision,
  applyReviewCorrection,
  approveStage1,
  completeStage1,
  currentGeneratedAggregate,
  initStage1,
  loadStage1,
  reviewStage1,
  saveArchitectureReview,
  saveProjectState,
  scaffoldStage1,
} from "../src/stage1.js";
import {
  answerTopologyDecision,
  approveModuleDesign,
  approveTopologyPlan,
  getReadyStage2Actions,
  initStage2,
  loadStage2,
  migrateLegacyStage2,
  reopenModuleDesign,
  reopenTopologyDecision,
  reviewTopologyPlan,
  runActiveImplementation,
  runModuleVerification,
  runShadowDesign,
  runTopologyPlanning,
  startStage2ArchitectureRework,
  resumeStage2ArchitectureRework,
  summarizeStage2,
} from "../src/stage2.js";
import { renderSystemDesignDocument } from "../src/stage2/presentation.js";
import {
  advanceStage2Workspace,
  approvePackageDesign,
  approveSystemDesign,
  initStage2Workspace,
  loadStage2Workspace,
  migrateStage2Workspace,
  requestSystemDesignRevision,
  runPackageDesign,
  runPackageVerification,
  summarizeStage2Workspace,
} from "../src/stage2/workflow.js";
import type {
  CommandResult,
  CommandSpec,
  Stage2DesignProposal,
  Stage2ImplementationProposal,
  Stage2LegacyProjectStage,
  Stage2ReviewReport,
  Stage1ProjectSpec,
  Stage2ImplementationUnitPlan,
  Stage2TaskEnvelope,
  Stage2TopologyPlanPatch,
  Stage2TopologyProposal,
  Stage2SystemDesignProposal,
  Stage2PackageDesignProposal,
} from "../src/types.js";

test("One Stage1 Architecture can support different legal Stage2 Unit topologies", () => {
  const architecture = topologyArchitectureFixture();
  const split = [
    topologyUnit("frontend", ["fetch"]),
    topologyUnit("backend", ["execute"]),
  ];
  const merged = [topologyUnit("core", ["fetch", "execute"])];

  assert.deepEqual(validateArchitectureRoleMapping(architecture, split), []);
  assert.deepEqual(validateArchitectureRoleMapping(architecture, merged), []);
});

test("Stage2 can return an unapproved System Design candidate for a recorded revision", async () => {
  const fixture = await createCompletedStage1Fixture(["regfile"]);
  const initialized = await initStage2Workspace(fixture.project);
  const stage2 = initialized.state.stage2;
  stage2.status = "SYSTEM_DESIGN_APPROVAL";
  stage2.systemDesign.revision = 1;
  stage2.systemDesign.proposal = workspaceSystemProposalFixture();
  stage2.systemDesign.review = {
    reviewedAt: "2026-08-31T00:00:00.000Z",
    runtimeRef: "runtime-review",
    runId: "run-review",
    report: {
      schemaVersion: 1,
      systemDesignSha256: "pending",
      verdict: "pass",
      summary: "fixture review passed",
      findings: [],
      decisionRequests: [],
    },
  };
  const candidate = renderSystemDesignDocument(initialized.state, stage2, "待批准");
  stage2.systemDesign.documentSha256 = sha256(candidate);
  stage2.systemDesign.review.report.systemDesignSha256 = stage2.systemDesign.documentSha256;
  await writeFile(join(fixture.project, "design", "plan.md"), candidate, "utf8");
  await saveProjectState(initialized.root, initialized.state);

  await requestSystemDesignRevision(
    fixture.project,
    1,
    "Issue 逻辑进入 Instruction Queue，删除独立 Issue Component。",
  );
  const revised = await requestSystemDesignRevision(
    fixture.project,
    1,
    "1. Issue 逻辑进入 Instruction Queue。 2. 删除独立 Issue Component。",
  );

  assert.equal(revised.state.stage2.status, "SYSTEM_DESIGN_DRAFT");
  assert.equal(revised.state.stage2.systemDesign.review, undefined);
  assert.equal(revised.state.stage2.systemDesign.proposal?.summary, "fixture System Design");
  assert.equal(revised.state.stage2.systemDesign.revisionRequests?.length, 1);
  assert.equal(revised.state.stage2.systemDesign.revisionRequests?.[0]?.id, "SDR_001");
  assert.equal(revised.state.stage2.systemDesign.revisionRequests?.[0]?.status, "pending");
  assert.equal(
    revised.state.stage2.systemDesign.revisionRequests?.[0]?.instruction,
    "1. Issue 逻辑进入 Instruction Queue。 2. 删除独立 Issue Component。",
  );
  const summary = await summarizeStage2Workspace(revised);
  assert.equal(summary.readyActions[0]?.kind, "system_design_revision");
  assert.match(summary.nextMachineActions[0] ?? "", /修订 System Design/u);
  assert.match(
    await readFile(join(fixture.project, "design", "plan.md"), "utf8"),
    /SDR_001[\s\S]*1\. Issue 逻辑进入 Instruction Queue/u,
  );
  await assert.rejects(
    approveSystemDesign(fixture.project),
    /not awaiting approval/u,
  );
});

test("Stage2 approval records its authority before assigning the first Shadow", async () => {
  const fixture = await createCompletedStage1Fixture(["regfile"]);
  const initialized = await initStage2Workspace(fixture.project);
  const stage2 = initialized.state.stage2;
  stage2.status = "SYSTEM_DESIGN_APPROVAL";
  stage2.systemDesign.revision = 1;
  stage2.systemDesign.proposal = workspaceSystemProposalFixture();
  stage2.systemDesign.review = {
    reviewedAt: "2026-08-31T00:00:00.000Z",
    runtimeRef: "runtime-review",
    runId: "run-review",
    report: {
      schemaVersion: 1,
      systemDesignSha256: "pending",
      verdict: "pass",
      summary: "fixture review passed",
      findings: [],
      decisionRequests: [],
    },
  };
  const candidate = renderSystemDesignDocument(initialized.state, stage2, "待批准");
  stage2.systemDesign.documentSha256 = sha256(candidate);
  stage2.systemDesign.review.report.systemDesignSha256 = stage2.systemDesign.documentSha256;
  await writeFile(join(fixture.project, "design", "plan.md"), candidate, "utf8");
  await saveProjectState(initialized.root, initialized.state);

  const approved = await approveSystemDesign(fixture.project);
  const approval = approved.state.stage2.systemDesign.approval;
  const shadow = approved.state.stage2.agents.A;

  assert.equal(approved.state.stage2.status, "PACKAGE_LOOP");
  assert.ok(approval);
  assert.equal(approval.documentSha256, approved.state.stage2.systemDesign.documentSha256);
  assert.equal(shadow.role, "shadow");
  assert.equal(shadow.status, "assigned");
  assert.equal(shadow.workPackageId, "wp_regfile");
  assert.equal(shadow.designHash, approval.documentSha256);
  assert.equal(shadow.interfaceHash, approval.interfaceSha256);
  assert.deepEqual(shadow.allowedPaths, ["design/packages/wp_regfile.md"]);
  assert.equal(approved.state.stage2.workPackages.wp_regfile?.status, "DESIGNING");

  const persisted = await loadStage1(fixture.project);
  assert.deepEqual(persisted.state.stage2, approved.state.stage2);
  const approvedDocument = await readFile(join(fixture.project, "design", "plan.md"), "utf8");
  assert.match(approvedDocument, /状态：已批准/u);
  assert.equal(sha256(approvedDocument), approval.documentSha256);
});

test("Stage2 advance overlaps Active Implementation and Shadow Package Design", async () => {
  const fixture = await createCompletedStage1Fixture(["regfile", "fetch"]);
  const initialized = await initStage2Workspace(fixture.project);
  const stage2 = initialized.state.stage2;
  stage2.status = "SYSTEM_DESIGN_APPROVAL";
  stage2.systemDesign.revision = 1;
  stage2.systemDesign.proposal = parallelWorkspaceSystemProposalFixture();
  stage2.systemDesign.review = {
    reviewedAt: "2026-08-31T00:00:00.000Z",
    runtimeRef: "runtime-review",
    runId: "run-review",
    report: {
      schemaVersion: 1,
      systemDesignSha256: "pending",
      verdict: "pass",
      summary: "parallel fixture review passed",
      findings: [],
      decisionRequests: [],
    },
  };
  const candidate = renderSystemDesignDocument(initialized.state, stage2, "待批准");
  stage2.systemDesign.documentSha256 = sha256(candidate);
  stage2.systemDesign.review.report.systemDesignSha256 = stage2.systemDesign.documentSha256;
  await writeFile(join(fixture.project, "design", "plan.md"), candidate, "utf8");
  await saveProjectState(initialized.root, initialized.state);
  await approveSystemDesign(fixture.project);

  await runPackageDesign(fixture.project, "wp_regfile", undefined, {
    executor: async () => ({
      output: parallelPackageDesign("wp_regfile"),
      events: "",
      threadId: "thread-design-regfile",
    }),
  });
  const approved = await approvePackageDesign(fixture.project, "wp_regfile");
  const designSha256 = approved.state.stage2.workPackages.wp_regfile!.design!.approval!.designSha256;
  assert.equal(approved.state.stage2.agents.A.role, "active");
  assert.equal(approved.state.stage2.agents.B.role, "shadow");

  let running = 0;
  let maximumRunning = 0;
  const starts: Record<string, number> = {};
  const finishes: Record<string, number> = {};
  const executor: Stage2AgentExecutor = async (call) => {
    running += 1;
    maximumRunning = Math.max(maximumRunning, running);
    starts[call.task] = Date.now();
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 200));
    finishes[call.task] = Date.now();
    running -= 1;
    if (call.task === "package_design") {
      return {
        output: parallelPackageDesign("wp_fetch"),
        events: "",
        threadId: "thread-design-fetch",
      };
    }
    if (call.task === "package_implementation") {
      return {
        output: {
          schemaVersion: 1,
          workPackageId: "wp_regfile",
          designSha256,
          summary: "Implement the approved RegFile contract.",
          files: [{
            path: "src/main/scala/demo/RegFile.scala",
            kind: "source",
            baseSha256: null,
            content: "package demo\nobject RegFile\n",
            purpose: "RegFile implementation",
          }],
          notes: [],
          designGap: null,
        },
        events: "",
        threadId: "thread-implementation-regfile",
      };
    }
    throw new Error(`Unexpected task ${call.task}`);
  };

  const report = await advanceStage2Workspace(fixture.project, {
    executor,
    commandRunner: async () => [],
  });
  assert.equal(maximumRunning, 2);
  assert.ok(starts.package_design! < finishes.package_implementation!);
  assert.ok(starts.package_implementation! < finishes.package_design!);
  assert.deepEqual(report.results.map((result) => result.status), ["fulfilled", "fulfilled"]);
  const loaded = await loadStage2Workspace(fixture.project);
  assert.equal(loaded.state.stage2.workPackages.wp_regfile?.status, "VERIFYING");
  assert.equal(loaded.state.stage2.workPackages.wp_fetch?.status, "AWAITING_APPROVAL");
  const appliedRuns = Object.values(loaded.state.stage2.runtimeRuns)
    .filter((run) => run.workPackageId === "wp_regfile" || run.workPackageId === "wp_fetch")
    .filter((run) => run.status === "applied");
  assert.equal(appliedRuns.length, 3);
  loaded.state.stage2.workPackages.wp_regfile!.status = "IMPLEMENTING";
  loaded.state.stage2.workPackages.wp_regfile!.blockers = [
    "COMMAND_EXECUTION_BLOCKED: isolated Worker could not create the approved process",
    "REVIEW_SCOPE_INCOMPLETE: approved Package directories were not readable",
  ];
  await saveProjectState(loaded.root, loaded.state);

  const verificationCommandRoots: string[] = [];
  let independentCommandResults: CommandResult[] = [];
  const verificationExecutor: Stage2AgentExecutor = async (call) => {
    assert.equal(call.sandbox, "read-only");
    assert.ok(call.readManifest);
    assert.ok(call.readManifest.allowedRoots.includes("src/main/scala/demo"));
    if (call.task === "package_static_review") {
      return {
        output: {
          schemaVersion: 1,
          kind: "static",
          workPackageId: "wp_regfile",
          designSha256,
          implementationAggregateSha256: loaded.state.stage2.workPackages.wp_regfile!
            .implementation!.aggregateSha256,
          verdict: "pass",
          summary: "Static review passed.",
          findings: [],
          commandResults: [],
        },
        events: "",
        threadId: "thread-static-regfile",
      };
    }
    if (call.task === "package_verification") {
      assert.match(call.prompt, /Harness Command Evidence/u);
      return {
        output: {
          schemaVersion: 1,
          kind: "verification",
          workPackageId: "wp_regfile",
          designSha256,
          implementationAggregateSha256: loaded.state.stage2.workPackages.wp_regfile!
            .implementation!.aggregateSha256,
          verdict: "pass",
          summary: "Independent command evidence passed.",
          findings: [],
          commandResults: structuredClone(independentCommandResults),
        },
        events: "",
        threadId: "thread-verification-regfile",
      };
    }
    throw new Error(`Unexpected verification task ${call.task}`);
  };
  const verified = await runPackageVerification(fixture.project, "wp_regfile", {
    executor: verificationExecutor,
    commandRunner: async (specs, projectRoot) => {
      verificationCommandRoots.push(projectRoot);
      const results = specs.map((spec): CommandResult => ({
        id: spec.id,
        description: spec.description,
        runner: spec.runner,
        command: spec.runner === "host"
          ? [spec.command, ...(spec.args ?? [])].join(" ")
          : spec.script ?? "",
        required: spec.required,
        ok: true,
        exitCode: 0,
        output: "ok",
        checkedAt: "2026-08-31T00:00:00.000Z",
      }));
      independentCommandResults = results;
      return results;
    },
  });
  assert.equal(verified.state.stage2.workPackages.wp_regfile?.status, "COMPLETE");
  assert.equal(verificationCommandRoots.length, 2);
  assert.equal(resolve(verificationCommandRoots[0]!), resolve(fixture.project));
  assert.notEqual(resolve(verificationCommandRoots[1]!), resolve(fixture.project));
  assert.match(verificationCommandRoots[1]!, /package_verification/u);
});

test("Stage2 schema 5 migration repairs duplicate persistent roles deterministically", async () => {
  const fixture = await createCompletedStage1Fixture(["regfile", "fetch"]);
  const initialized = await initStage2Workspace(fixture.project);
  const stage2 = initialized.state.stage2;
  stage2.status = "SYSTEM_DESIGN_APPROVAL";
  stage2.systemDesign.revision = 1;
  stage2.systemDesign.proposal = parallelWorkspaceSystemProposalFixture();
  stage2.systemDesign.review = {
    reviewedAt: "2026-08-31T00:00:00.000Z",
    runtimeRef: "runtime-review",
    runId: "run-review",
    report: {
      schemaVersion: 1,
      systemDesignSha256: "pending",
      verdict: "pass",
      summary: "fixture review passed",
      findings: [],
      decisionRequests: [],
    },
  };
  const candidate = renderSystemDesignDocument(initialized.state, stage2, "待批准");
  stage2.systemDesign.documentSha256 = sha256(candidate);
  stage2.systemDesign.review.report.systemDesignSha256 = stage2.systemDesign.documentSha256;
  await writeFile(join(fixture.project, "design", "plan.md"), candidate, "utf8");
  await saveProjectState(initialized.root, initialized.state);
  const approved = await approveSystemDesign(fixture.project);
  approved.state.stage2.agents.B = {
    slot: "B",
    role: "shadow",
    status: "working",
    lease: "working-shadow",
    baseRevision: approved.state.stage2.workspaceRevision,
    workPackageId: "wp_fetch",
    runId: "run-fetch",
    designHash: approved.state.stage2.systemDesign.documentSha256,
    interfaceHash: approved.state.stage2.systemDesign.approval!.interfaceSha256,
    allowedPaths: ["design/packages/wp_fetch.md"],
  };
  approved.state.stage2.workPackages.wp_fetch!.status = "DESIGNING";
  await saveProjectState(approved.root, approved.state);

  const dryRun = await migrateStage2Workspace(fixture.project, false);
  assert.deepEqual(dryRun.retiredMechanisms, ["duplicate persistent Agent roles"]);
  await migrateStage2Workspace(fixture.project, true);
  const normalized = await loadStage2Workspace(fixture.project);
  assert.equal(normalized.state.stage2.agents.B.role, "shadow");
  assert.equal(normalized.state.stage2.agents.B.status, "working");
  assert.equal(normalized.state.stage2.agents.A.role, "idle");
  assert.equal(normalized.state.stage2.workPackages.wp_regfile?.status, "DESIGNING");
});

test("Stage2 rejects a stale System Design revision request without changing the candidate", async () => {
  const fixture = await createCompletedStage1Fixture(["regfile"]);
  const initialized = await initStage2Workspace(fixture.project);
  const stage2 = initialized.state.stage2;
  stage2.status = "SYSTEM_DESIGN_APPROVAL";
  stage2.systemDesign.revision = 2;
  stage2.systemDesign.proposal = workspaceSystemProposalFixture();
  const candidate = renderSystemDesignDocument(initialized.state, stage2, "待批准");
  stage2.systemDesign.documentSha256 = sha256(candidate);
  await writeFile(join(fixture.project, "design", "plan.md"), candidate, "utf8");
  await saveProjectState(initialized.root, initialized.state);

  await assert.rejects(
    requestSystemDesignRevision(fixture.project, 1, "stale request"),
    /revision changed/u,
  );
  const loaded = await loadStage1(fixture.project);
  assert.equal(loaded.state.stage2?.schemaVersion, 5);
  assert.equal(loaded.state.stage2?.status, "SYSTEM_DESIGN_APPROVAL");
});

test("Stage2 exposes one researched Topology Decision and projects the partial Unit board", async () => {
  const fixture = await createCompletedStage1Fixture(["regfile", "fetch"]);
  const calls: string[] = [];
  const executor = fixtureExecutor(calls);
  await initStage2(fixture.project);

  await runTopologyPlanning(fixture.project, "S2_TOP_001", undefined, { executor });
  let loaded = await loadStage2(fixture.project);
  const decisionAction = getReadyStage2Actions(loaded.state);
  assert.equal(decisionAction.length, 1);
  assert.equal(decisionAction[0]?.kind, "topology_decision");
  assert.deepEqual(calls, ["topology_research", "topology_planning"]);
  assert.equal(loaded.state.stage2.topology.decisions.S2_TOP_001?.evidence?.evidenceSufficient, true);
  const projectedPlan = await readFile(join(fixture.project, "design", "plan.md"), "utf8");
  assert.match(projectedPlan, /S2_TOP_001/u);
  assert.match(projectedPlan, /### Option `recommended`（推荐）/u);
  assert.match(projectedPlan, /\| `regfile` \| implementation \| regfile \|/u);

  await answerTopologyDecision(fixture.project, "S2_TOP_001", "recommended");
  loaded = await loadStage2(fixture.project);
  const summary = await summarizeStage2(loaded);
  assert.equal(summary.plan.answeredDecisions, 1);
  assert.deepEqual(summary.board.map((row) => row.unitId), ["regfile", "fetch"]);
  assert.ok(summary.board.every((row) => row.status === "PLANNED"));
  assert.equal(getReadyStage2Actions(loaded.state)[0]?.kind, "topology_planning");
  assert.equal(loaded.state.stage2.agents.A.decisionId, "S2_TOP_002");
});

test("Stage2 refreshes Topology Research and passes the user focus only as a research hint", async () => {
  const fixture = await createCompletedStage1Fixture(["regfile"]);
  const calls: string[] = [];
  const base = fixtureExecutor(calls);
  const researchPrompts: string[] = [];
  const executor: Stage2AgentExecutor = async (call) => {
    if (call.task === "topology_research") {
      researchPrompts.push(call.prompt);
    }
    return base(call);
  };
  await initStage2(fixture.project);

  await runTopologyPlanning(
    fixture.project,
    "S2_TOP_001",
    "优先检查状态 owner 和既定寄存边界。",
    { executor },
  );
  await runTopologyPlanning(
    fixture.project,
    "S2_TOP_001",
    "重新核对现有源码边界。",
    { executor, refreshResearch: true },
  );

  assert.deepEqual(calls, [
    "topology_research",
    "topology_planning",
    "topology_research",
    "topology_planning",
  ]);
  assert.match(researchPrompts[0] ?? "", /优先检查状态 owner 和既定寄存边界/u);
  assert.match(researchPrompts[1] ?? "", /重新核对现有源码边界/u);
  assert.match(researchPrompts[1] ?? "", /不能作为已确认事实或拓扑结论/u);
});

test("Stage2 rejects a Planner-authored user conclusion", async () => {
  const fixture = await createCompletedStage1Fixture(["regfile"]);
  const base = fixtureExecutor([]);
  await initStage2(fixture.project);
  const executor: Stage2AgentExecutor = async (call) => {
    const response = await base(call);
    if (call.task !== "topology_planning") {
      return response;
    }
    const proposal = structuredClone(response.output) as Stage2TopologyProposal;
    proposal.userConclusion = "由 Planner 代替用户确认。";
    return { ...response, output: proposal };
  };

  await assert.rejects(
    runTopologyPlanning(fixture.project, "S2_TOP_001", undefined, { executor }),
    /userConclusion=null/u,
  );
  const loaded = await loadStage2(fixture.project);
  assert.equal(loaded.state.stage2.topology.decisions.S2_TOP_001?.status, "pending");
});

test("Stage2 Topology reopen preserves revision baselines and invalidates transitive dependents", async () => {
  const fixture = await createCompletedStage1Fixture(["regfile", "fetch"]);
  const executor = fixtureExecutor([]);
  await initStage2(fixture.project);
  await closeTopologyDecisions(fixture.project, executor, 3);

  let loaded = await loadStage2(fixture.project);
  assert.equal(loaded.state.stage2.topology.decisions.S2_TOP_003?.status, "answered");
  await reopenTopologyDecision(fixture.project, "S2_TOP_001", "Unit 边界需要重新讨论。");
  loaded = await loadStage2(fixture.project);
  assert.equal(loaded.state.stage2.topology.decisions.S2_TOP_001?.status, "pending");
  assert.equal(loaded.state.stage2.topology.decisions.S2_TOP_002?.status, "pending");
  assert.equal(loaded.state.stage2.topology.decisions.S2_TOP_003?.status, "pending");
  assert.equal(loaded.state.stage2.topology.decisions.S2_TOP_002?.revisions.length, 1);
  assert.match(
    loaded.state.stage2.topology.decisions.S2_TOP_002?.revisions[0]?.previousConclusion ?? "",
    /闭合/u,
  );
  assert.deepEqual(loaded.state.stage2.topology.plan.units, []);
  assert.equal(getReadyStage2Actions(loaded.state)[0]?.kind, "topology_planning");
});

test("Stage2 rejects a cyclic Implementation Unit DAG before user submission", async () => {
  const fixture = await createCompletedStage1Fixture(["regfile", "fetch"]);
  const base = fixtureExecutor([]);
  await initStage2(fixture.project);
  await closeTopologyDecisions(fixture.project, base, 4);
  const cyclic: Stage2AgentExecutor = async (call) => {
    const response = await base(call);
    if (call.task !== "topology_planning") {
      return response;
    }
    const proposal = structuredClone(response.output) as Stage2TopologyProposal;
    const patch: Stage2TopologyPlanPatch = {
      kind: "unit_dag",
      units: [
        { id: "regfile", dependsOn: ["fetch"], integrationConsumers: ["fetch"] },
        { id: "fetch", dependsOn: ["regfile"], integrationConsumers: ["regfile"] },
      ],
    };
    for (const option of proposal.options) {
      option.patch = structuredClone(patch);
    }
    return { ...response, output: proposal };
  };
  await assert.rejects(
    runTopologyPlanning(fixture.project, "S2_TOP_005", undefined, { executor: cyclic }),
    /DAG contains a cycle/u,
  );
  const loaded = await loadStage2(fixture.project);
  assert.equal(loaded.state.stage2.topology.decisions.S2_TOP_005?.status, "pending");
});

test("Stage2 blocks a required Topology Decision when Research evidence is insufficient", async () => {
  const fixture = await createCompletedStage1Fixture(["regfile"]);
  await initStage2(fixture.project);
  const executor: Stage2AgentExecutor = async (call) => {
    assert.equal(call.task, "topology_research");
    return {
      output: {
        schemaVersion: 1,
        decisionId: "S2_TOP_001",
        sources: [],
        facts: [],
        conflicts: [],
        gaps: ["现有源码尚未提供。"],
        evidenceSufficient: false,
        stopReason: "缺少可复查证据。",
      },
      events: "",
      threadId: "research-insufficient",
    };
  };
  await assert.rejects(
    runTopologyPlanning(fixture.project, "S2_TOP_001", undefined, { executor }),
    /evidence is insufficient/u,
  );
  const loaded = await loadStage2(fixture.project);
  assert.equal(loaded.state.stage2.topology.decisions.S2_TOP_001?.status, "pending");
  assert.equal(loaded.state.stage2.topology.decisions.S2_TOP_001?.evidence?.evidenceSufficient, false);
  assert.match(loaded.state.stage2.blockers.join("\n"), /现有源码尚未提供/u);
});

test("Stage2 explicitly migrates an artifact-free legacy Module Loop", async () => {
  const fixture = await createCompletedStage1Fixture(["regfile"]);
  const loaded = await loadStage1(fixture.project);
  const architecture = {
    id: "regfile",
    responsibility: "Implement regfile.",
    stateOwnership: ["regfile_state"],
    dependsOn: [] as string[],
    interfaces: ["regfile_interface"],
  };
  const legacy: Stage2LegacyProjectStage = {
    schemaVersion: 1,
    status: "MODULE_LOOP",
    revision: 7,
    stateEpoch: 3,
    initializedAt: "2026-08-30T00:00:00.000Z",
    updatedAt: "2026-08-30T00:00:00.000Z",
    moduleOrder: ["regfile"],
    modules: {
      regfile: {
        id: "regfile",
        order: 0,
        status: "PENDING",
        architecture,
        blockers: [],
        reopened: [],
      },
    },
    agents: {
      A: { slot: "A", role: "idle", status: "idle", lease: "legacy-a", observedEpoch: 3 },
      B: { slot: "B", role: "idle", status: "idle", lease: "legacy-b", observedEpoch: 3 },
    },
    blockers: [],
    history: [],
  };
  loaded.state.stage2 = legacy;
  await saveProjectState(loaded.root, loaded.state);

  const migrated = await migrateLegacyStage2(fixture.project);
  assert.equal(migrated.state.stage2.schemaVersion, 3);
  assert.equal(migrated.state.stage2.status, "TOPOLOGY_DISCOVERY");
  assert.equal(migrated.state.stage2.topology.migration?.sourceRevision, 7);
  assert.equal(migrated.state.stage2.agents.A.role, "planner");
  assert.equal(getReadyStage2Actions(migrated.state)[0]?.kind, "topology_planning");
});

test("Stage2 completes the regfile tracer and rotates persistent Agent roles", async () => {
  const fixture = await createCompletedStage1Fixture(["regfile", "fetch"]);
  const calls: string[] = [];
  const executor = fixtureExecutor(calls);
  let loaded = await initStage2(fixture.project);
  assert.equal(loaded.state.stage2.agents.A.role, "planner");
  assert.equal(loaded.state.stage2.agents.A.decisionId, "S2_TOP_001");
  assert.equal(loaded.state.stage2.agents.B.role, "idle");
  assert.deepEqual(getReadyStage2Actions(loaded.state), [
    {
      kind: "topology_planning",
      decisionId: "S2_TOP_001",
      topic: "Implementation Unit 边界",
      slot: "A",
      researchPolicy: "required",
    },
  ]);
  await completeFixtureTopology(fixture.project, executor);
  loaded = await loadStage2(fixture.project);
  assert.equal(loaded.state.stage2.agents.A.role, "shadow");
  assert.equal(loaded.state.stage2.agents.A.moduleId, "regfile");
  assert.equal(loaded.state.stage2.topology.approval?.planRevision, 6);

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
  await initializeApprovedStage2(fixture.project, executor);
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
  await initializeApprovedStage2(fixture.project, fixtureExecutor([]));
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

test("Stage2 gives every source and test path one Unit owner", async () => {
  const fixture = await createCompletedStage1Fixture(["regfile", "fetch"]);
  const executor = fixtureExecutor([]);
  await initializeApprovedStage2(fixture.project, executor);
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
  await initializeApprovedStage2(fixture.project, fixtureExecutor([]));
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
  await initializeApprovedStage2(fixture.project, fixtureExecutor([]));
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
  await initializeApprovedStage2(fixture.project, executor);
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
  await initializeApprovedStage2(fixture.project, executor);
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
  await initializeApprovedStage2(fixture.project, executor);
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
  await initializeApprovedStage2(fixture.project, fixtureExecutor([]));
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
  assert.match(prompt, /stage2 advance/u);
  assert.match(prompt, /canonicalization/u);
  assert.match(prompt, /Static Review Worker/u);
  assert.match(prompt, /runtimeRef/u);
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
  assert.match(persistent.join(" "), /mcp_servers\.processor_project\.command/u);
  assert.match(persistent.join(" "), /project-reader-mcp\.js/u);
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
  assert.match(resumed.join(" "), /mcp_servers\.processor_project\.command/u);
  assert.match(resumed.join(" "), /project-reader-mcp\.js/u);
});

test("Stage2 Shadow prompt requires the Project Reader MCP", async () => {
  const fixture = await createCompletedStage1Fixture(["regfile"]);
  const delegate = fixtureExecutor([]);
  await initializeApprovedStage2(fixture.project, delegate);
  let prompt = "";
  await runShadowDesign(fixture.project, "regfile", undefined, {
    executor: async (call) => {
      prompt = call.prompt;
      return delegate(call);
    },
  });
  assert.match(prompt, /processor_project MCP/u);
  assert.match(prompt, /不得依赖 Shell、PowerShell、cmd/u);
});

test("Stage2 Decision rework freezes agents and resumes only after a new Stage1 approval", async () => {
  const fixture = await createCompletedStage1Fixture(["regfile"]);
  let loaded = await initStage2(fixture.project);
  const originalEpoch = loaded.state.stage2.stateEpoch;
  const originalApproval = loaded.state.stage1.approval?.aggregateSha256;

  loaded = await startStage2ArchitectureRework(fixture.project, {
    summary: "Stage2 发现 D1 没有闭合修订后的寄存器文件行为。",
    rationale: "Topology 继续前必须重新批准 Architecture 结论。",
    source: { kind: "user" },
    repair: { kind: "decision", target: "D1" },
    requiredClosure: ["重新确认 D1 的完整架构结论"],
    evidenceSources: [architectureReworkUserEvidence("ARW_DECISION")],
    affectedTopologyDecisions: ["S2_TOP_001"],
    affectedUnits: [],
  });
  assert.equal(loaded.state.stage2.status, "BLOCKED");
  assert.equal(loaded.state.stage1.status, "DECISION_LOOP");
  assert.equal(loaded.state.stage1.approval, undefined);
  assert.ok(loaded.state.stage2.stateEpoch > originalEpoch);
  assert.ok(Object.values(loaded.state.stage2.agents).every((agent) => agent.role === "idle"));
  assert.equal(getReadyStage2Actions(loaded.state)[0]?.kind, "architecture_rework_stage1");
  await assert.rejects(
    resumeStage2ArchitectureRework(fixture.project),
    /has not been reapproved/u,
  );

  await reapproveStage1WithCustomDecision(
    fixture.project,
    "修订后的 D1 结论明确寄存器文件读写和同拍可见性。",
  );
  loaded = await loadStage2(fixture.project);
  assert.equal(loaded.state.stage2.architectureRework?.status, "stage1_reapproved");
  assert.notEqual(loaded.state.stage1.approval?.aggregateSha256, originalApproval);
  assert.equal(getReadyStage2Actions(loaded.state)[0]?.kind, "architecture_rework_resume");

  loaded = await resumeStage2ArchitectureRework(fixture.project);
  assert.equal(loaded.state.stage2.status, "TOPOLOGY_DECISION_LOOP");
  assert.equal(loaded.state.stage2.topology.decisions.S2_TOP_001?.status, "pending");
  assert.equal(loaded.state.stage1.architectureRework, undefined);
  assert.equal(loaded.state.stage1.architectureReworkHistory?.at(-1)?.status, "reapproved");
  assert.equal(getReadyStage2Actions(loaded.state)[0]?.kind, "topology_planning");
});

test("Stage2 ProjectSpec rework uses Review Correction v2 before returning to Topology", async () => {
  const fixture = await createCompletedStage1Fixture(["regfile"]);
  await initStage2(fixture.project);
  await startStage2ArchitectureRework(fixture.project, {
    summary: "Stage2 发现缺少寄存器文件同拍写后读不变量。",
    rationale: "该规则属于已批准 Architecture 的项目级不变量。",
    source: { kind: "user" },
    repair: { kind: "project_spec", target: "architecture.invariants" },
    requiredClosure: ["补齐同拍写后读不变量及依据"],
    evidenceSources: [architectureReworkUserEvidence("ARW_PROJECT_SPEC")],
    affectedTopologyDecisions: ["S2_TOP_006"],
    affectedUnits: [],
  });
  let stage1 = await loadStage1(fixture.project);
  assert.equal(stage1.state.stage1.status, "REVIEW_CORRECTION");
  assert.equal(stage1.state.stage1.review?.findings[0]?.code, "S2_ARW_001_PROJECT_SPEC");

  await applyReviewCorrection(fixture.project, {
    findingCodes: ["S2_ARW_001_PROJECT_SPEC"],
    patch: {
      architecture: {
        invariants: ["In order", "同拍写后读返回本周期写入值。"],
      },
    },
    rationale: "补齐 Stage2 暴露的 Architecture 不变量。",
    evidenceSources: [architectureReworkUserEvidence("ARW_PROJECT_SPEC")],
    evidenceCoverage: { "architecture.invariants": ["ARW_PROJECT_SPEC"] },
  });
  await reviewStage1(fixture.project);
  await savePassingStage1Audit(fixture.project, "ProjectSpec Architecture Rework 已闭合。");
  await approveStage1(fixture.project);

  const loaded = await resumeStage2ArchitectureRework(fixture.project);
  assert.deepEqual(loaded.state.stage1.projectSpec?.architecture.invariants, [
    "In order",
    "同拍写后读返回本周期写入值。",
  ]);
  assert.equal(loaded.state.stage1.reviewCorrections?.at(-1)?.schemaVersion, 2);
  assert.equal(loaded.state.stage1.projectSpecHistory?.events.at(-1)?.kind, "review_correction");
  assert.equal(loaded.state.stage2.architectureRework?.status, "topology_rework");
  assert.equal(loaded.state.stage2.topology.decisions.S2_TOP_006?.status, "pending");
});

test("Stage2 rework invalidates affected Units and transitive consumers while preserving unrelated state", async () => {
  const fixture = await createCompletedStage1Fixture(["regfile", "fetch", "alu"]);
  const executor = fixtureExecutorWithRegfileConsumer([]);
  await initializeApprovedStage2(fixture.project, executor);
  await completeFixtureModules(fixture.project, executor);
  let loaded = await loadStage2(fixture.project);
  loaded.state.stage2.modules.alu!.reopened.push({
    at: "2026-08-30T00:00:00.000Z",
    reason: "unrelated-state-sentinel",
  });
  await saveProjectState(loaded.root, loaded.state);
  const oldRegfileDesign = loaded.state.stage2.modules.regfile?.design?.documentSha256;

  await startStage2ArchitectureRework(fixture.project, {
    summary: "Regfile 接口契约需要返回 Stage1 修订。",
    rationale: "Regfile 的实现证据证明既有 Architecture 结论不完整。",
    source: { kind: "implementation", unitId: "regfile" },
    repair: { kind: "decision", target: "D1" },
    requiredClosure: ["补齐 Regfile 接口时序结论"],
    evidenceSources: [architectureReworkUserEvidence("ARW_MATERIALIZED")],
    affectedTopologyDecisions: ["S2_TOP_003"],
    affectedUnits: ["regfile"],
  });
  await reapproveStage1WithCustomDecision(
    fixture.project,
    "修订后的 D1 结论补齐 Regfile 接口时序和同拍可见性。",
  );
  loaded = await resumeStage2ArchitectureRework(fixture.project);
  assert.deepEqual(
    loaded.state.stage2.architectureRework?.invalidatedArtifacts.map((item) => item.unitId).sort(),
    ["fetch", "regfile"],
  );
  assert.equal(loaded.state.stage2.modules.regfile?.status, "NEEDS_REALIGN");
  assert.equal(loaded.state.stage2.modules.fetch?.status, "NEEDS_REALIGN");
  assert.equal(loaded.state.stage2.modules.regfile?.design?.approval, undefined);
  assert.equal(loaded.state.stage2.modules.regfile?.implementation, undefined);
  assert.equal(loaded.state.stage2.modules.regfile?.verification, undefined);
  assert.equal(
    loaded.state.stage2.modules.regfile?.reopened.at(-1)?.previousDesignSha256,
    oldRegfileDesign,
  );
  assert.equal(
    loaded.state.stage2.modules.alu?.reopened.at(-1)?.reason,
    "unrelated-state-sentinel",
  );

  await completeFixtureTopology(fixture.project, executor);
  loaded = await loadStage2(fixture.project);
  assert.equal(loaded.state.stage2.architectureRework, undefined);
  assert.equal(loaded.state.stage2.architectureReworkHistory?.at(-1)?.status, "resumed");
  assert.equal(loaded.state.stage2.modules.regfile?.status, "DESIGNING");
  assert.equal(loaded.state.stage2.modules.fetch?.status, "NEEDS_REALIGN");
  assert.equal(loaded.state.stage2.modules.alu?.status, "COMPLETE");
  assert.equal(
    loaded.state.stage2.modules.alu?.reopened.at(-1)?.reason,
    "unrelated-state-sentinel",
  );
});

async function initializeApprovedStage2(
  project: string,
  executor: Stage2AgentExecutor,
): Promise<void> {
  await initStage2(project);
  await completeFixtureTopology(project, executor);
}

async function closeTopologyDecisions(
  project: string,
  executor: Stage2AgentExecutor,
  count: number,
): Promise<void> {
  for (let index = 0; index < count; index += 1) {
    const loaded = await loadStage2(project);
    const actions = getReadyStage2Actions(loaded.state);
    const action = actions.find((candidate) => candidate.kind !== "waiting_for_rotation") ?? actions[0];
    assert.equal(action?.kind, "topology_planning");
    if (action?.kind !== "topology_planning") {
      throw new Error("Expected a Topology planning action");
    }
    await runTopologyPlanning(project, action.decisionId, undefined, { executor });
    const proposed = getReadyStage2Actions((await loadStage2(project)).state)[0];
    assert.equal(proposed?.kind, "topology_decision");
    if (proposed?.kind !== "topology_decision") {
      throw new Error("Expected a Topology Decision action");
    }
    await answerTopologyDecision(
      project,
      proposed.decision.id,
      proposed.proposal.recommendation,
    );
  }
}

async function completeFixtureTopology(
  project: string,
  executor: Stage2AgentExecutor,
): Promise<void> {
  for (;;) {
    const loaded = await loadStage2(project);
    const action = getReadyStage2Actions(loaded.state)[0];
    if (action?.kind === "topology_planning") {
      await runTopologyPlanning(project, action.decisionId, undefined, { executor });
      continue;
    }
    if (action?.kind === "topology_decision") {
      await answerTopologyDecision(
        project,
        action.decision.id,
        action.proposal.recommendation,
      );
      continue;
    }
    if (action?.kind === "topology_review") {
      assert.deepEqual(action.issues, []);
      await reviewTopologyPlan(project);
      continue;
    }
    if (action?.kind === "topology_approval") {
      await approveTopologyPlan(project);
      return;
    }
    throw new Error(`Unexpected Topology action: ${JSON.stringify(action)}`);
  }
}

async function completeFixtureModules(
  project: string,
  executor: Stage2AgentExecutor,
): Promise<void> {
  for (let step = 0; step < 50; step += 1) {
    const loaded = await loadStage2(project);
    const action = getReadyStage2Actions(loaded.state)[0];
    if (action?.kind === "shadow_design") {
      await runShadowDesign(project, action.moduleId, undefined, { executor });
      continue;
    }
    if (action?.kind === "design_approval") {
      await approveModuleDesign(project, action.moduleId, "active_only");
      continue;
    }
    if (action?.kind === "active_implementation") {
      await runActiveImplementation(project, action.moduleId, {
        executor,
        commandRunner: passingCommandRunner,
      });
      continue;
    }
    if (action?.kind === "verification") {
      await runModuleVerification(project, action.moduleId, {
        executor,
        commandRunner: passingCommandRunner,
      });
      continue;
    }
    if (action?.kind === "baseline_complete") {
      return;
    }
    throw new Error(`Unexpected Module Loop action: ${JSON.stringify(action)}`);
  }
  throw new Error("Fixture Module Loop did not converge");
}

function architectureReworkUserEvidence(id: string) {
  return {
    id,
    kind: "user_directive" as const,
    locator: id,
    claim: "用户确认 Stage2 暴露的 Architecture 缺口及其明确修订范围。",
    locations: [],
  };
}

async function savePassingStage1Audit(project: string, summary: string): Promise<void> {
  const loaded = await loadStage1(project);
  await saveArchitectureReview(project, {
    reviewedAggregateSha256: currentGeneratedAggregate(loaded.state),
    verdict: "pass",
    summary,
    findings: [],
  });
}

async function reapproveStage1WithCustomDecision(
  project: string,
  conclusion: string,
): Promise<void> {
  await answerCustomDecision(project, "D1", conclusion);
  await reviewStage1(project);
  await savePassingStage1Audit(project, "Stage1 Architecture Rework 已闭合。");
  await approveStage1(project);
}

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

function workspaceSystemProposalFixture(): Stage2SystemDesignProposal {
  return {
    schemaVersion: 1,
    summary: "fixture System Design",
    architectureReferences: ["architecture/overview.md"],
    components: [
      {
        id: "core",
        architectureRoles: [],
        responsibility: "集成",
        stateOwnership: [],
        interfaceIds: [],
      },
      {
        id: "regfile",
        parentId: "core",
        architectureRoles: ["regfile"],
        responsibility: "寄存器文件",
        stateOwnership: ["registers"],
        interfaceIds: [],
      },
    ],
    interfaces: [],
    workPackages: [{
      id: "wp_regfile",
      componentIds: ["core", "regfile"],
      designDependsOn: [],
      implementationDependsOn: [],
      integrationDependsOn: [],
      allowedSourcePaths: ["src/main/scala/demo/RegFile.scala"],
      allowedTestPaths: ["src/test/scala/demo/RegFileSpec.scala"],
      designPath: "design/packages/wp_regfile.md",
      acceptance: ["RegFile contract is executable"],
    }],
    globalInvariants: ["x0 remains zero"],
    acceptancePlan: ["RegFile tests pass"],
    decisionRequests: [],
    risks: [],
  };
}

function parallelWorkspaceSystemProposalFixture(): Stage2SystemDesignProposal {
  return {
    schemaVersion: 1,
    summary: "parallel fixture System Design",
    architectureReferences: ["architecture/overview.md"],
    components: [
      {
        id: "core",
        architectureRoles: [],
        responsibility: "集成",
        stateOwnership: [],
        interfaceIds: [],
      },
      {
        id: "regfile",
        parentId: "core",
        architectureRoles: ["regfile"],
        responsibility: "寄存器文件",
        stateOwnership: ["registers"],
        interfaceIds: [],
      },
      {
        id: "fetch",
        parentId: "core",
        architectureRoles: ["fetch"],
        responsibility: "取指",
        stateOwnership: ["pc"],
        interfaceIds: [],
      },
    ],
    interfaces: [],
    workPackages: [
      {
        id: "wp_regfile",
        componentIds: ["core", "regfile"],
        designDependsOn: [],
        implementationDependsOn: [],
        integrationDependsOn: [],
        allowedSourcePaths: ["src/main/scala/demo/RegFile.scala"],
        allowedTestPaths: ["src/test/scala/demo/RegFileSpec.scala"],
        designPath: "design/packages/wp_regfile.md",
        acceptance: ["RegFile contract is executable"],
      },
      {
        id: "wp_fetch",
        componentIds: ["fetch"],
        designDependsOn: [],
        implementationDependsOn: [],
        integrationDependsOn: [],
        allowedSourcePaths: ["src/main/scala/demo/Fetch.scala"],
        allowedTestPaths: ["src/test/scala/demo/FetchSpec.scala"],
        designPath: "design/packages/wp_fetch.md",
        acceptance: ["Fetch contract is executable"],
      },
    ],
    globalInvariants: ["x0 remains zero"],
    acceptancePlan: ["all packages pass"],
    decisionRequests: [],
    risks: [],
  };
}

function parallelPackageDesign(workPackageId: "wp_regfile" | "wp_fetch"): Stage2PackageDesignProposal {
  const regfile = workPackageId === "wp_regfile";
  return {
    schemaVersion: 1,
    workPackageId,
    componentIds: regfile ? ["core", "regfile"] : ["fetch"],
    summary: `${workPackageId} contract`,
    architectureReferences: ["architecture/overview.md"],
    sourceReferences: [],
    explicitExclusions: [],
    interfaces: ["approved System Design"],
    fields: [],
    events: [],
    cycleBehavior: ["registered behavior"],
    exceptionalBehavior: ["reset clears state"],
    invariants: ["valid guards state"],
    sharedInterfaceChanges: [],
    affectedWorkPackages: [],
    implementation: {
      sourcePaths: [regfile
        ? "src/main/scala/demo/RegFile.scala"
        : "src/main/scala/demo/Fetch.scala"],
      testPaths: [regfile
        ? "src/test/scala/demo/RegFileSpec.scala"
        : "src/test/scala/demo/FetchSpec.scala"],
    },
    acceptance: {
      assertions: ["valid guards state"],
      directedTests: ["reset and one operation"],
      commands: [{
        id: "node_version",
        description: "check fixture runtime",
        runner: "host",
        command: "node",
        args: ["--version"],
        required: true,
      }],
      expectedResults: ["operation succeeds"],
    },
    decisionRequests: [],
    risks: [],
    openQuestions: [],
  };
}

function stage2FixtureProfile(moduleOrder: string[]): string {
  const owner = moduleOrder[0] ?? "regfile";
  return `schemaVersion: 2
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
  roles:
${moduleOrder.map((id) => `    - id: ${id}\n      responsibility: Implement ${id} behavior.`).join("\n")}
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
      ownerRole: ${owner}
      producerRoles: [${moduleOrder.join(", ")}]
      consumerRoles: [${moduleOrder.join(", ")}]
      affectedResources: []
      rules: [Fixture rule]
  counterRules:
    - name: cycles
      increment: Every cycle.
      exclusions: [reset]
verification:
  referenceModel: Fixture model.
  layers: [unit]
  requiredScenarios: [smoke]
  counters: [cycles]
  decisionAcceptance:
    - decisionId: D1
      criteria: [Fixture architecture remains unchanged.]
  completionCriteria: [All fixture units pass.]
scaffold:
  files:
    - path: build.fixture
      content: |
        fixture
  smokeChecks: []
`;
}

function topologyArchitectureFixture(): Stage1ProjectSpec {
  return {
    intent: {
      goal: "Test topology freedom.",
      useCase: "Automated verification.",
      constraints: [],
      exclusions: [],
    },
    architecture: {
      roles: [
        { id: "fetch", responsibility: "Provide instruction delivery semantics." },
        { id: "execute", responsibility: "Provide execution and retirement semantics." },
      ],
      systemBoundary: [],
      supportedInstructions: [],
      invariants: [],
      sharedFields: [],
      globalProtocols: [],
      counterRules: [],
    },
    verification: {
      referenceModel: "Fixture model.",
      layers: [],
      requiredScenarios: [],
      counters: [],
      decisionAcceptance: [],
      completionCriteria: [],
    },
  };
}

function topologyUnit(id: string, architectureRoles: string[]): Stage2ImplementationUnitPlan {
  return {
    id,
    kind: "implementation",
    architectureRoles,
    responsibility: `Implement ${architectureRoles.join(" and ")}.`,
    rationale: "Fixture topology.",
    packageName: "demo",
    designPath: `design/${id}.md`,
    sourcePaths: [],
    testPaths: [],
    integrationPaths: [],
    dependsOn: [],
    wave: 0,
    integrationConsumers: [],
    completionCriteria: [],
    verificationResponsibility: "Fixture verification.",
  };
}

function fixtureExecutor(calls: string[]): Stage2AgentExecutor {
  return async (call) => {
    calls.push(call.task);
    if (call.task === "topology_research") {
      const envelope = taskEnvelopeFromCall(call);
      const decisionId = envelope.topology?.decision.id;
      if (decisionId === undefined) {
        throw new Error("Topology Research fixture is missing a Decision");
      }
      return {
        output: {
          schemaVersion: 1,
          decisionId,
          sources: [
            {
              kind: "project",
              locator: "architecture/overview.md",
              revision: "fixture",
              accessedAt: "2026-08-30T00:00:00.000Z",
              locations: ["architecture/overview.md:1"],
            },
          ],
          facts: [
            {
              claim: `已读取 ${decisionId} 需要的项目架构事实。`,
              source: "architecture/overview.md",
              confidence: "high",
            },
          ],
          conflicts: [],
          gaps: [],
          evidenceSufficient: true,
          stopReason: "已获得当前 Decision 需要的项目证据。",
        },
        events: "",
        threadId: `research-${decisionId}`,
      };
    }
    if (call.task === "topology_planning") {
      const envelope = taskEnvelopeFromCall(call);
      return {
        output: fixtureTopologyProposal(envelope),
        events: "",
        threadId: "thread-A",
      };
    }
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

function fixtureExecutorWithRegfileConsumer(calls: string[]): Stage2AgentExecutor {
  const delegate = fixtureExecutor(calls);
  return async (call) => {
    const response = await delegate(call);
    if (call.task !== "topology_planning") {
      return response;
    }
    const proposal = response.output as Stage2TopologyProposal;
    if (proposal.decisionId !== "S2_TOP_005") {
      return response;
    }
    for (const option of proposal.options) {
      if (option.patch.kind !== "unit_dag") {
        continue;
      }
      for (const unit of option.patch.units) {
        if (unit.id === "regfile") {
          unit.integrationConsumers = ["fetch"];
        } else if (unit.id === "fetch") {
          unit.dependsOn = ["regfile"];
        }
      }
    }
    return response;
  };
}

function fixtureTopologyProposal(envelope: Stage2TaskEnvelope): Stage2TopologyProposal {
  const topology = envelope.topology;
  if (topology === undefined) {
    throw new Error("Topology fixture is missing its Task Envelope section");
  }
  const unitIds = topology.plan.units.map((unit) => unit.id);
  let patch: Stage2TopologyPlanPatch;
  switch (topology.decision.kind) {
    case "unit_mapping":
      patch = {
        kind: "unit_mapping",
        units: topology.architectureRoles.map((role) => ({
          id: role.id,
          kind: "implementation",
          architectureRoles: [role.id],
          responsibility: role.responsibility,
          rationale: "Fixture 使用一对一 Unit 映射。",
        })),
      };
      break;
    case "shared_ownership":
      patch = { kind: "shared_ownership", sharedArtifacts: [] };
      break;
    case "interface_ownership":
      patch = {
        kind: "interface_ownership",
        interfaces: unitIds.map((unitId) => ({
          id: `${unitId}_interface`,
          ownerUnit: unitId,
          producerUnits: [unitId],
          consumerUnits: [unitId],
          fields: [`${unitId}_state`],
          boundary: `${unitId} Unit 边界。`,
          timing: "周期边界稳定。",
        })),
      };
      break;
    case "source_topology":
      patch = {
        kind: "source_topology",
        units: unitIds.map((unitId) => {
          const className = capitalize(unitId);
          return {
            id: unitId,
            packageName: "demo",
            designPath: `design/${unitId}.md`,
            sourcePaths: [`src/main/scala/demo/${className}.scala`],
            testPaths: [`src/test/scala/demo/${className}Spec.scala`],
            integrationPaths: [],
          };
        }),
      };
      break;
    case "unit_dag":
      patch = {
        kind: "unit_dag",
        units: unitIds.map((unitId) => ({
          id: unitId,
          dependsOn: [],
          integrationConsumers: [],
        })),
      };
      break;
    case "completion":
      patch = {
        kind: "completion",
        units: unitIds.map((unitId) => ({
          id: unitId,
          completionCriteria: ["Design、实现、定向测试和验证证据闭合。"],
          verificationResponsibility: `${unitId} 定向与集成验证。`,
        })),
      };
      break;
  }
  const option = {
    id: "recommended",
    label: "Fixture 推荐",
    summary: `闭合 ${topology.decision.topic}。`,
    benefits: ["结构确定。"],
    costs: ["需要维护正式 Plan。"],
    risks: [],
    notChoosingConsequences: ["后续门禁无法启动。"],
    affectedUnits: unitIds,
    affectedInterfaces: [],
    affectedSourcePaths: [],
    affectedDagEdges: [],
    patch,
  };
  return {
    schemaVersion: 1,
    decisionId: topology.decision.id,
    kind: topology.decision.kind,
    summary: `Fixture ${topology.decision.id} 候选。`,
    architectureFacts: ["使用已批准的 Stage1 Architecture Role。"],
    sourceEvidence: topology.evidence?.facts.map((fact) => fact.claim) ?? [],
    unknowns: [],
    options: [option, { ...structuredClone(option), id: "alternative", label: "Fixture 备选" }],
    recommendation: "recommended",
    rationale: ["适合确定性测试。"],
    openQuestions: [],
    affectedDecisions: [],
    userConclusion: null,
  };
}

function taskEnvelopeFromCall(call: Stage2AgentCall): Stage2TaskEnvelope {
  const match = /Task Envelope：\r?\n([\s\S]*?)\r?\n\r?\n(?:Stage1 Architecture|Unit Architecture Context|Approved Design|Module State)/u.exec(call.prompt);
  if (match?.[1] === undefined) {
    throw new Error(`No Task Envelope in ${call.task} prompt`);
  }
  return JSON.parse(match[1]) as Stage2TaskEnvelope;
}

function designProposal(moduleId: string): Stage2DesignProposal {
  const className = capitalize(moduleId);
  return {
    schemaVersion: 1,
    moduleId,
    summary: `${moduleId} 的闭合模块设计。`,
    architectureReferences: [
      "architecture/overview.md",
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
