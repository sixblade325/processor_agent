import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  listProjectFiles,
  readProjectFile,
  searchProjectText,
} from "../src/project-reader-mcp.js";
import {
  cancelDiscoveredStage2AgentRun,
  discoverStage2RunStatuses,
} from "../src/stage2-runtime.js";
import {
  createWorkPackageStates,
  mergeDecisionRequests,
  systemDesignHashes,
  validateSystemDesignProposal,
} from "../src/stage2/design-package.js";
import { assertIndependentCommandEvidence, packageReviewFailures } from "../src/stage2/evidence.js";
import {
  assignBlockedImplementationRepair,
  assignNextShadow,
  idleWorkspaceAssignment,
  promoteReadyShadow,
  releaseWorkspaceAssignment,
} from "../src/stage2/rotation.js";
import { packageDesignIssues, validatePackageDesignProposal } from "../src/stage2/work-package.js";
import {
  applyDesignPatch,
  canonicalizePackageDesignProposal,
  proposalHash,
  validateDesignPatch,
} from "../src/stage2/design-revision.js";
import { finalizeReadManifest } from "../src/stage2/read-manifest.js";
import {
  packageDesignPatchSchema,
  packageDesignSchema,
  packageImplementationSchema,
  packageReviewSchema,
  systemDesignReviewSchema,
  systemDesignSchema,
} from "../src/stage2/worker-contracts.js";
import { sanitizeStage2BusinessProviderMetadata } from "../src/stage2/workflow.js";
import type {
  ArchitectureRoleSpec,
  Stage2PackageDesignProposal,
  Stage2PackageDesignRecord,
  Stage2PackageReviewReport,
  Stage2SystemDesignProposal,
  Stage2WorkPackageStateV4,
  Stage2WorkspaceStage,
} from "../src/types.js";

test("Stage2 System Design validates hierarchy, role coverage, and exclusive path ownership", () => {
  const proposal = systemProposal();
  const validated = validateSystemDesignProposal(proposal, architectureRoles());
  assert.equal(validated.components.find((component) => component.id === "frontend")?.parentId, "core");

  const cycle = structuredClone(proposal);
  cycle.components.find((component) => component.id === "core")!.parentId = "frontend";
  assert.throws(
    () => validateSystemDesignProposal(cycle, architectureRoles()),
    /parent cycle/u,
  );

  const overlappingPaths = structuredClone(proposal);
  overlappingPaths.workPackages[1]!.allowedTestPaths = [
    overlappingPaths.workPackages[0]!.allowedTestPaths[0]!,
  ];
  assert.throws(
    () => validateSystemDesignProposal(overlappingPaths, architectureRoles()),
    /owned by both/u,
  );

  const wildcardPaths = structuredClone(proposal);
  wildcardPaths.workPackages[0]!.allowedSourcePaths = ["src/main/scala/demo/**"];
  assert.throws(
    () => validateSystemDesignProposal(wildcardPaths, architectureRoles()),
    /must name one exact file/u,
  );
});

test("Stage2 Worker output Schemas satisfy strict structured-output object requirements", () => {
  const schemas = [
    systemDesignSchema(),
    systemDesignReviewSchema("design"),
    packageDesignSchema("wp_frontend"),
    packageDesignPatchSchema("base", ["/openQuestions"]),
    packageImplementationSchema("wp_frontend", "design"),
    packageReviewSchema("wp_frontend", "design", "implementation", "static"),
    packageReviewSchema("wp_frontend", "design", "implementation", "verification"),
  ];
  schemas.forEach((schema) => assertStrictObjectSchemas(schema));

  const nullableRoot = systemProposal();
  (nullableRoot.components[0]! as unknown as { parentId: string | null }).parentId = null;
  const normalized = validateSystemDesignProposal(nullableRoot, architectureRoles());
  assert.equal(normalized.components[0]?.parentId, undefined);
});

test("Stage2 validates the three Work Package dependency DAGs independently", () => {
  for (const kind of ["design", "implementation", "integration"] as const) {
    const proposal = systemProposal();
    const left = proposal.workPackages[0]!;
    const right = proposal.workPackages[1]!;
    left[`${kind}DependsOn`] = [right.id];
    right[`${kind}DependsOn`] = [left.id];
    assert.throws(
      () => validateSystemDesignProposal(proposal, architectureRoles()),
      new RegExp(`Work Package ${kind} dependency cycle`, "u"),
    );
  }
});

test("Stage2 canonicalizes mechanical Package Design defects without changing semantics", () => {
  const proposal = packageDesign(workspaceStage().workPackages.wp_frontend!);
  proposal.sharedInterfaceChanges = ["无变化。"];
  proposal.affectedWorkPackages = ["wp_backend：同步检查后端接口"];
  proposal.acceptance.commands = [{
    id: "compile",
    description: "compile in WSL",
    runner: "wsl",
    script: "",
    required: true,
    command: "sbt",
    args: ["test"],
  } as unknown as typeof proposal.acceptance.commands[number]];

  const result = canonicalizePackageDesignProposal(
    proposal,
    ["wp_frontend", "wp_backend", "wp_control"],
  );
  const canonical = result.value as Stage2PackageDesignProposal;
  assert.deepEqual(canonical.sharedInterfaceChanges, []);
  assert.deepEqual(canonical.affectedWorkPackages, ["wp_backend"]);
  assert.equal(canonical.acceptance.commands[0]?.runner, "wsl");
  assert.equal(
    (canonical.acceptance.commands[0] as { script?: string }).script,
    "sbt test",
  );
  assert.deepEqual(result.changes.map((change) => change.ruleId), [
    "canonical_empty_shared_interface_changes",
    "canonical_work_package_references",
    "canonical_wsl_command_script",
  ]);
});

test("Stage2 Design Patch is base-hash and target bound", () => {
  const proposal = packageDesign(workspaceStage().workPackages.wp_frontend!);
  proposal.openQuestions = ["已由批准文档闭合"];
  const base = proposalHash(proposal);
  const patch = validateDesignPatch({
    baseProposalSha256: base,
    operations: [{ op: "replace", target: "/openQuestions", value: [] }],
  }, base, ["/openQuestions"]);
  assert.deepEqual(applyDesignPatch(proposal, patch).openQuestions, []);
  assert.throws(
    () => validateDesignPatch({
      baseProposalSha256: base,
      operations: [{ op: "replace", target: "/risks", value: [] }],
    }, base, ["/openQuestions"]),
    /not authorized/u,
  );
  const drifted = structuredClone(proposal);
  drifted.summary = "drifted";
  assert.throws(() => applyDesignPatch(drifted, patch), /base hash drifted/u);
});

test("Stage2 Project Reader enforces the Read Manifest", async () => {
  const root = await mkdtemp(join(tmpdir(), "processor-agent-manifest-"));
  await mkdir(join(root, "src", "main"), { recursive: true });
  await mkdir(join(root, "target"), { recursive: true });
  await writeFile(join(root, "AGENTS.md"), "project rules\n", "utf8");
  await writeFile(join(root, "src", "main", "Core.scala"), "object Core\n", "utf8");
  await writeFile(join(root, "target", "secret.txt"), "excluded\n", "utf8");
  const manifest = finalizeReadManifest({
    entryFiles: ["AGENTS.md"],
    allowedRoots: ["src/main"],
    excludedRoots: ["target"],
    affectedIds: ["wp_core"],
    maxListedFiles: 10,
  });

  await assert.rejects(() => listProjectFiles(root, ".", 10, manifest), /read_scope_gap/u);
  assert.match(await readProjectFile(root, "AGENTS.md", 1, 10, manifest), /project rules/u);
  assert.match(await searchProjectText(root, "Core", { path: "src/main" }, manifest), /Core\.scala/u);
  await assert.rejects(
    () => readProjectFile(root, "target/secret.txt", 1, 10, manifest),
    /read_scope_gap/u,
  );
  await assert.rejects(
    () => searchProjectText(root, "Core", {}, manifest),
    /search_path_required/u,
  );
});

test("Stage2 Runtime discovers abandoned runs and persists cancellation", async () => {
  const root = await mkdtemp(join(tmpdir(), "processor-agent-runtime-"));
  const project = join(root, "project");
  const runtime = join(
    root,
    ".runtime",
    "processor_agent",
    "project",
    "stage2",
    "system",
    "system_design_draft",
    "run-orphan",
  );
  await mkdir(project, { recursive: true });
  await mkdir(runtime, { recursive: true });
  await writeFile(join(runtime, "run-status.json"), `${JSON.stringify({
    runId: "run-orphan",
    runtimeRef: "runtime-orphan",
    task: "system_design_draft",
    status: "queued",
    startedAt: "2000-01-01T00:00:00.000Z",
    lastEventAt: "2000-01-01T00:00:00.000Z",
    eventCount: 0,
  }, null, 2)}\n`, "utf8");

  const [orphan] = await discoverStage2RunStatuses(project);
  assert.equal(orphan?.status, "orphaned");
  const cancelled = await cancelDiscoveredStage2AgentRun(project, "runtime-orphan");
  assert.equal(cancelled.status, "cancelled");
  const [persisted] = await discoverStage2RunStatuses(project);
  assert.equal(persisted?.status, "cancelled");
});

test("Stage2 keeps provider session identifiers only in the Runtime Registry", () => {
  const stage2 = workspaceStage();
  stage2.systemDesign.legacyEvidence.push({
    id: "legacy",
    kind: "worker_run",
    summary: "legacy worker",
    sourceRevision: 1,
    runId: "run-legacy",
  });
  (stage2.systemDesign.legacyEvidence[0] as unknown as Record<string, unknown>).threadId = "thread-legacy";
  (stage2.agents.A as unknown as Record<string, unknown>).externalSessionId = "thread-assignment";
  stage2.runtimeRegistry.runtime_current = {
    runtimeRef: "runtime_current",
    provider: "codex-cli",
    externalSessionId: "thread-current",
    phase: "system_design",
    status: "idle",
    runCount: 1,
    cumulativePromptBytes: 10,
    createdAt: "2026-08-31T00:00:00.000Z",
    updatedAt: "2026-08-31T00:00:00.000Z",
  };

  assert.equal(sanitizeStage2BusinessProviderMetadata(stage2), 2);
  assert.equal("threadId" in (stage2.systemDesign.legacyEvidence[0] as object), false);
  assert.equal("externalSessionId" in (stage2.agents.A as object), false);
  assert.equal(stage2.runtimeRegistry.runtime_current!.externalSessionId, "thread-current");
});

test("Stage2 retires withdrawn open Decisions and retains answered Decisions", () => {
  const request = {
    id: "shared_owner",
    category: "cross_package_interface" as const,
    question: "共享接口由谁拥有？",
    whyUserDecisionIsRequired: "会改变多个 Package。",
    options: [
      { id: "central", label: "集中", summary: "集中 owner", consequences: ["单一入口"] },
      { id: "distributed", label: "分布", summary: "分布 owner", consequences: ["局部自治"] },
    ],
    recommendation: "central",
    affectedComponents: [],
    affectedInterfaces: [],
    affectedPaths: [],
    consequences: ["需要修订 System Design"],
  };
  const current = {
    shared_owner: { spec: request, status: "open" as const },
    accepted_width: {
      spec: { ...request, id: "accepted_width" },
      status: "answered" as const,
      resolution: {
        selectedOption: "central",
        conclusion: "集中 owner",
        answeredAt: "2026-08-31T00:00:00.000Z",
        workspaceRevision: 1,
      },
    },
  };
  const merged = mergeDecisionRequests(current, []);
  assert.equal(merged.decisions.shared_owner, undefined);
  assert.equal(merged.decisions.accepted_width?.status, "answered");
  assert.deepEqual(merged.order, ["accepted_width"]);
});

test("Stage2 Package Design remains unapprovable when it changes a shared interface", () => {
  const system = validateSystemDesignProposal(systemProposal(), architectureRoles());
  const workPackage = createWorkPackageStates(system).wp_frontend!;
  const proposal = packageDesign(workPackage, ["front_to_back 增加 replay 字段"]);
  const validated = validatePackageDesignProposal(proposal, workPackage, system);
  workPackage.design = designRecord(validated);

  assert.deepEqual(packageDesignIssues(workPackage), [
    "Package Design 改变了已批准 shared interface，需要先修订 System Design",
  ]);
});

test("Stage2 ignores descriptive no-change entries in sharedInterfaceChanges", () => {
  const system = validateSystemDesignProposal(systemProposal(), architectureRoles());
  const workPackage = createWorkPackageStates(system).wp_frontend!;
  const proposal = packageDesign(workPackage, [
    "无。完整复用已经批准的 shared interface。",
    "不新增跨 Component 字段。",
  ]);
  const validated = validatePackageDesignProposal(proposal, workPackage, system);
  workPackage.design = designRecord(validated);

  assert.deepEqual(packageDesignIssues(workPackage), []);
});

test("Stage2 rotates early only to an independent approved Package and keeps runtime handles", () => {
  const independent = workspaceStage();
  prepareVerifyingActive(independent, "wp_frontend", "runtime-active");
  prepareReadyShadow(independent, "wp_backend", "runtime-shadow");

  assert.equal(promoteReadyShadow(independent), true);
  assert.equal(independent.agents.A.role, "idle");
  assert.equal(independent.agents.A.runtimeRef, "runtime-active");
  assert.equal(independent.agents.B.role, "active");
  assert.equal(independent.agents.B.runtimeRef, "runtime-shadow");
  assert.equal(independent.workPackages.wp_backend?.status, "IMPLEMENTING");

  const dependent = workspaceStage();
  prepareVerifyingActive(dependent, "wp_frontend", "runtime-active");
  prepareReadyShadow(dependent, "wp_control", "runtime-shadow");

  assert.equal(promoteReadyShadow(dependent), false);
  assert.equal(dependent.agents.A.role, "active");
  assert.equal(dependent.agents.B.role, "shadow");
  assert.equal(dependent.workPackages.wp_control?.status, "READY");
});

test("Stage2 assigns an unowned Design repair before a new pending Package", () => {
  const stage2 = workspaceStage();
  const repair = stage2.workPackages.wp_frontend!;
  repair.design = designRecord(packageDesign(repair));
  delete repair.design.approval;
  repair.status = "DESIGNING";
  repair.blockers = ["Design gap requires repair"];

  assert.equal(assignNextShadow(stage2, "B")?.id, "wp_frontend");
  assert.equal(stage2.agents.B.workPackageId, "wp_frontend");
  assert.deepEqual(repair.blockers, ["Design gap requires repair"]);
});

test("Stage2 gives a blocked implementation repair priority and restores its provider context", () => {
  const stage2 = workspaceStage();
  prepareVerifyingActive(stage2, "wp_backend", "runtime-current");
  prepareReadyShadow(stage2, "wp_control", "runtime-shadow");
  const blocked = stage2.workPackages.wp_frontend!;
  blocked.design = designRecord(packageDesign(blocked));
  blocked.implementation = {
    appliedAt: "2026-08-31T00:00:00.000Z",
    designSha256: blocked.design.documentSha256,
    aggregateSha256: "implementation-wp_frontend",
    fileHashes: {},
    changedPaths: [],
    summary: "first implementation",
    runtimeRef: "runtime-blocked-implementation",
    runId: "run-blocked-implementation",
    skills: [],
  };
  blocked.status = "BLOCKED";
  blocked.blockers = ["independent verification failed"];

  assert.equal(assignBlockedImplementationRepair(stage2), undefined);
  releaseWorkspaceAssignment(stage2.agents.A);
  assert.equal(assignBlockedImplementationRepair(stage2, undefined, "A")?.id, "wp_frontend");
  assert.equal(stage2.agents.A.role, "active");
  assert.equal(stage2.agents.A.runtimeRef, "runtime-blocked-implementation");
  assert.equal(stage2.agents.B.role, "shadow");
  assert.equal(blocked.status, "IMPLEMENTING");
  assert.deepEqual(blocked.blockers, ["independent verification failed"]);
});

test("Stage2 completion evidence requires both independent Worker reports and exact commands", () => {
  const command = {
    id: "compile",
    description: "compile project",
    runner: "host" as const,
    command: "npm test",
    required: true,
  };
  assert.throws(
    () => assertIndependentCommandEvidence([command], []),
    /omitted command compile/u,
  );
  assert.doesNotThrow(() => assertIndependentCommandEvidence([command], [{
    ...command,
    ok: true,
    exitCode: 0,
    output: "ok",
    checkedAt: "2026-08-31T00:00:00.000Z",
  }]));

  const staticReport = reviewReport("static", "pass");
  const verificationReport = reviewReport("verification", "fail");
  assert.deepEqual(packageReviewFailures(staticReport, verificationReport), [
    "verification review failed: verification failed",
  ]);
});

function architectureRoles(): ArchitectureRoleSpec[] {
  return [
    { id: "frontend", responsibility: "取指和译码" },
    { id: "backend", responsibility: "执行和退休" },
    { id: "control", responsibility: "全局控制" },
  ];
}

function systemProposal(): Stage2SystemDesignProposal {
  return {
    schemaVersion: 1,
    summary: "把 Stage1 架构映射为分层组件、接口骨架和三个 Work Package。",
    architectureReferences: ["architecture/overview.md"],
    components: [
      {
        id: "core",
        architectureRoles: [],
        responsibility: "集成顶层",
        stateOwnership: [],
        interfaceIds: [],
      },
      {
        id: "frontend",
        parentId: "core",
        architectureRoles: ["frontend"],
        responsibility: "取指和译码",
        stateOwnership: ["pc"],
        interfaceIds: ["front_to_back"],
      },
      {
        id: "backend",
        parentId: "core",
        architectureRoles: ["backend"],
        responsibility: "执行和退休",
        stateOwnership: ["pipeline_state"],
        interfaceIds: ["front_to_back", "control_redirect"],
      },
      {
        id: "control",
        parentId: "core",
        architectureRoles: ["control"],
        responsibility: "重定向和清空",
        stateOwnership: ["redirect_priority"],
        interfaceIds: ["control_redirect"],
      },
    ],
    interfaces: [
      {
        id: "front_to_back",
        ownerComponentId: "frontend",
        producerComponentIds: ["frontend"],
        consumerComponentIds: ["backend"],
        fields: ["valid", "instruction"],
        boundary: "frontend/backend",
        timing: "registered",
      },
      {
        id: "control_redirect",
        ownerComponentId: "control",
        producerComponentIds: ["control"],
        consumerComponentIds: ["frontend", "backend"],
        fields: ["valid", "target"],
        boundary: "control/core",
        timing: "same-cycle priority",
      },
    ],
    workPackages: [
      {
        id: "wp_frontend",
        componentIds: ["core", "frontend"],
        designDependsOn: [],
        implementationDependsOn: [],
        integrationDependsOn: [],
        allowedSourcePaths: ["src/main/scala/demo/Frontend.scala"],
        allowedTestPaths: ["src/test/scala/demo/FrontendSpec.scala"],
        designPath: "design/packages/wp_frontend.md",
        acceptance: ["Frontend contract is executable"],
      },
      {
        id: "wp_backend",
        componentIds: ["backend"],
        designDependsOn: [],
        implementationDependsOn: [],
        integrationDependsOn: [],
        allowedSourcePaths: ["src/main/scala/demo/Backend.scala"],
        allowedTestPaths: ["src/test/scala/demo/BackendSpec.scala"],
        designPath: "design/packages/wp_backend.md",
        acceptance: ["Backend contract is executable"],
      },
      {
        id: "wp_control",
        componentIds: ["control"],
        designDependsOn: ["wp_frontend"],
        implementationDependsOn: ["wp_frontend"],
        integrationDependsOn: ["wp_frontend"],
        allowedSourcePaths: ["src/main/scala/demo/Control.scala"],
        allowedTestPaths: ["src/test/scala/demo/ControlSpec.scala"],
        designPath: "design/packages/wp_control.md",
        acceptance: ["Redirect priority is verified"],
      },
    ],
    globalInvariants: ["retirement remains ordered"],
    acceptancePlan: ["all Work Packages pass two independent Workers"],
    decisionRequests: [],
    risks: [],
  };
}

function packageDesign(
  workPackage: Stage2WorkPackageStateV4,
  sharedInterfaceChanges: string[] = [],
): Stage2PackageDesignProposal {
  return {
    schemaVersion: 1,
    workPackageId: workPackage.id,
    componentIds: [...workPackage.plan.componentIds],
    summary: `${workPackage.id} implementation contract`,
    architectureReferences: ["architecture/overview.md"],
    sourceReferences: [],
    explicitExclusions: [],
    interfaces: ["approved System Design interfaces"],
    fields: [],
    events: [],
    cycleBehavior: ["registered transfer"],
    exceptionalBehavior: ["reset clears state"],
    invariants: ["valid guards payload"],
    sharedInterfaceChanges,
    affectedWorkPackages: [],
    implementation: {
      sourcePaths: [...workPackage.plan.allowedSourcePaths],
      testPaths: [...workPackage.plan.allowedTestPaths],
    },
    acceptance: {
      assertions: ["valid guards payload"],
      directedTests: ["reset and one transfer"],
      commands: [{
        id: "compile",
        description: "compile project",
        runner: "host",
        command: "npm test",
        required: true,
      }],
      expectedResults: ["command succeeds"],
    },
    decisionRequests: [],
    risks: [],
    openQuestions: [],
  };
}

function designRecord(proposal: Stage2PackageDesignProposal): Stage2PackageDesignRecord {
  return {
    revision: 1,
    draftedAt: "2026-08-31T00:00:00.000Z",
    path: `design/packages/${proposal.workPackageId}.md`,
    documentSha256: `design-${proposal.workPackageId}`,
    runtimeRef: `runtime-${proposal.workPackageId}`,
    runId: `run-${proposal.workPackageId}`,
    skills: [],
    proposal,
    approval: {
      approvedAt: "2026-08-31T00:00:00.000Z",
      designRevision: 1,
      designSha256: `design-${proposal.workPackageId}`,
      systemDesignSha256: "system-design",
      interfaceSha256: "interfaces",
      architectureHashes: {},
    },
  };
}

function workspaceStage(): Stage2WorkspaceStage {
  const proposal = systemProposal();
  const hashes = systemDesignHashes(proposal);
  const workPackages = createWorkPackageStates(proposal);
  return {
    schemaVersion: 5,
    status: "PACKAGE_LOOP",
    revision: 1,
    workspaceRevision: 1,
    stateEpoch: 1,
    initializedAt: "2026-08-31T00:00:00.000Z",
    updatedAt: "2026-08-31T00:00:00.000Z",
    systemDesign: {
      path: "design/plan.md",
      revision: 1,
      documentSha256: "system-design",
      draftedAt: "2026-08-31T00:00:00.000Z",
      proposal,
      approval: {
        approvedAt: "2026-08-31T00:00:00.000Z",
        designRevision: 1,
        documentSha256: "system-design",
        architectureHashes: {},
        componentTopologySha256: hashes.components,
        interfaceSha256: "interfaces",
        workPackagePlanSha256: hashes.workPackages,
      },
      decisionOrder: [],
      decisions: {},
      legacyEvidence: [],
    },
    workPackageOrder: proposal.workPackages.map((workPackage) => workPackage.id),
    workPackages,
    agents: {
      A: idleWorkspaceAssignment("A"),
      B: idleWorkspaceAssignment("B"),
    },
    runtimeRegistry: {},
    runtimeRuns: {},
    blockers: [],
    history: [],
  };
}

function prepareVerifyingActive(
  stage2: Stage2WorkspaceStage,
  workPackageId: string,
  runtimeRef: string,
): void {
  const workPackage = stage2.workPackages[workPackageId]!;
  workPackage.design = designRecord(packageDesign(workPackage));
  workPackage.status = "VERIFYING";
  stage2.agents.A = {
    slot: "A",
    role: "active",
    status: "working",
    lease: "active-lease",
    baseRevision: stage2.workspaceRevision,
    workPackageId,
    runtimeRef,
    designHash: workPackage.design.documentSha256,
    interfaceHash: "interfaces",
    allowedPaths: [
      ...workPackage.plan.allowedSourcePaths,
      ...workPackage.plan.allowedTestPaths,
    ],
  };
}

function prepareReadyShadow(
  stage2: Stage2WorkspaceStage,
  workPackageId: string,
  runtimeRef: string,
): void {
  const workPackage = stage2.workPackages[workPackageId]!;
  workPackage.design = designRecord(packageDesign(workPackage));
  workPackage.status = "READY";
  stage2.agents.B = {
    slot: "B",
    role: "shadow",
    status: "waiting",
    lease: "shadow-lease",
    baseRevision: stage2.workspaceRevision,
    workPackageId,
    runtimeRef,
    designHash: "system-design",
    interfaceHash: "interfaces",
    allowedPaths: [workPackage.plan.designPath],
  };
}

function reviewReport(
  kind: Stage2PackageReviewReport["kind"],
  verdict: Stage2PackageReviewReport["verdict"],
): Stage2PackageReviewReport {
  return {
    schemaVersion: 1,
    kind,
    workPackageId: "wp_frontend",
    designSha256: "design-wp_frontend",
    implementationAggregateSha256: "implementation",
    verdict,
    summary: verdict === "pass" ? `${kind} passed` : `${kind} failed`,
    findings: [],
    commandResults: [],
  };
}

function assertStrictObjectSchemas(value: unknown): void {
  if (Array.isArray(value)) {
    value.forEach(assertStrictObjectSchemas);
    return;
  }
  if (typeof value !== "object" || value === null) {
    return;
  }
  const record = value as Record<string, unknown>;
  if (record.type === "object") {
    const properties = Object.keys((record.properties ?? {}) as Record<string, unknown>).sort();
    const required = [...((record.required ?? []) as string[])].sort();
    assert.deepEqual(required, properties);
    assert.equal(record.additionalProperties, false);
  }
  Object.values(record).forEach(assertStrictObjectSchemas);
}
