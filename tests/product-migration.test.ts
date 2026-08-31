import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { loadProfile } from "../src/profile.js";
import { migrateProductSchema } from "../src/product-migration.js";
import {
  answerDecision,
  approveStage1,
  completeStage1,
  currentGeneratedAggregate,
  initStage1,
  loadStage1,
  replayProjectSpecHistory,
  reviewStage1,
  saveArchitectureReview,
  saveProjectState,
  scaffoldStage1,
} from "../src/stage1.js";
import { initStage2, loadStage2 } from "../src/stage2.js";
import { sha256 } from "../src/io.js";
import type { Stage1ProjectSpec } from "../src/types.js";

test("Product migration removes Stage1 topology facts and rebuilds Stage2 from Architecture Roles", async () => {
  const root = await mkdtemp(join(tmpdir(), "processor-agent-product-migration-"));
  const project = resolve(root, "project");
  const currentProfilePath = resolve(root, "profile-current.yaml");
  const legacyProfilePath = resolve(root, "profile-legacy.yaml");
  await mkdir(project, { recursive: true });
  await writeFile(currentProfilePath, currentProfile(), "utf8");
  await writeFile(legacyProfilePath, legacyProfile(), "utf8");

  await initStage1(project, currentProfilePath);
  await answerDecision(project, "D1", "approved");
  await reviewStage1(project);
  let loaded = await loadStage1(project);
  await saveArchitectureReview(project, {
    reviewedAggregateSha256: currentGeneratedAggregate(loaded.state),
    verdict: "pass",
    summary: "Fixture Architecture 已闭合。",
    findings: [],
  });
  await approveStage1(project);
  await scaffoldStage1(project);
  await completeStage1(project);
  await initStage2(project);

  loaded = await loadStage1(project);
  const legacyLoadedProfile = await loadProfile(legacyProfilePath);
  const currentSpec = structuredClone(loaded.state.stage1.projectSpec!);
  const legacySpec = toLegacyProjectSpec(currentSpec);
  loaded.state.schemaVersion = 1;
  loaded.state.project.profile.version = legacyLoadedProfile.profile.version;
  loaded.state.project.profile.digest = legacyLoadedProfile.digest;
  loaded.state.stage1.intent = structuredClone(currentSpec.intent);
  loaded.state.stage1.projectSpec = legacySpec as unknown as Stage1ProjectSpec;
  loaded.state.stage1.projectSpecHistory = {
    protocolVersion: 2,
    baseline: {
      profileDigest: legacyLoadedProfile.digest,
      projectSpecSha256: sha256(JSON.stringify(legacySpec)),
      value: legacySpec as unknown as Stage1ProjectSpec,
    },
    events: [],
  };
  (loaded.state.stage2 as unknown as { schemaVersion: number }).schemaVersion = 2;
  const retiredContent = "modules:\n  - id: core\n";
  await writeFile(join(project, "architecture", "modules.yaml"), retiredContent, "utf8");
  loaded.state.stage1.generatedDocumentHashes["architecture/modules.yaml"] = sha256(retiredContent);
  await writeFile(
    join(project, loaded.state.project.profile.snapshot),
    await readFile(legacyProfilePath, "utf8"),
    "utf8",
  );
  await saveProjectState(loaded.root, loaded.state);

  const dryRun = await migrateProductSchema(project, {
    profileReference: currentProfilePath,
    apply: false,
    now: new Date("2026-08-31T00:00:00.000Z"),
  });
  assert.equal(dryRun.applied, false);
  assert.equal(dryRun.stage2.targetSchemaVersion, 3);
  assert.deepEqual(dryRun.retiredArtifacts, ["architecture/modules.yaml"]);
  assert.equal((await loadStage1(project)).state.schemaVersion, 1);
  assert.equal(await readFile(join(project, "architecture", "modules.yaml"), "utf8"), retiredContent);

  const report = await migrateProductSchema(project, {
    profileReference: currentProfilePath,
    apply: true,
    now: new Date("2026-08-31T00:00:00.000Z"),
  });
  assert.equal(report.applied, true);
  assert.equal(report.fromStage1SchemaVersion, 1);
  assert.equal(report.toStage1SchemaVersion, 2);
  assert.equal(report.stage2.migrated, true);
  assert.equal(report.currentProjectSpecSha256, report.replayedProjectSpecSha256);
  assert.match(report.nextRequiredAction, /stage1 scaffold/u);

  loaded = await loadStage1(project);
  assert.equal(loaded.state.schemaVersion, 2);
  assert.equal(loaded.state.stage1.status, "ARCHITECTURE_REVIEW");
  assert.equal(loaded.state.stage1.approval, undefined);
  assert.equal(loaded.state.stage1.approvalHistory?.length, 1);
  assert.equal(loaded.state.stage1.projectSpecHistory?.protocolVersion, 3);
  assert.deepEqual(replayProjectSpecHistory(loaded.state), loaded.state.stage1.projectSpec);
  assert.deepEqual(loaded.state.stage1.projectSpec?.intent.exclusions, ["virtual memory"]);
  assert.equal(loaded.state.stage1.projectSpec?.architecture.roles[0]?.id, "core");
  assert.equal(loaded.state.stage1.projectSpec?.architecture.globalProtocols[0]?.ownerRole, "core");
  assert.deepEqual(
    loaded.state.stage1.projectSpec?.verification.completionCriteria,
    ["All Units have approved Design and passing evidence."],
  );
  await assert.rejects(
    readFile(join(project, "architecture", "modules.yaml"), "utf8"),
    /ENOENT/u,
  );
  const overview = await readFile(join(project, "architecture", "overview.md"), "utf8");
  assert.match(overview, /架构角色/u);
  assert.doesNotMatch(overview, /Cache exclusion/u);

  const stage2 = await loadStage2(project);
  assert.equal(stage2.state.stage2.schemaVersion, 3);
  assert.equal(stage2.state.stage2.status, "TOPOLOGY_DISCOVERY");
  assert.deepEqual(
    stage2.state.stage2.topology.plan.units,
    [],
  );
});

function toLegacyProjectSpec(spec: Stage1ProjectSpec): Record<string, unknown> {
  const legacy = structuredClone(spec) as unknown as {
    intent?: unknown;
    architecture: {
      roles?: Array<{ id: string; responsibility: string }>;
      modules?: unknown[];
      stage2Order?: string[];
      globalProtocols: Array<Record<string, unknown>>;
    };
    verification: { completionCriteria?: string[] };
  };
  delete legacy.intent;
  legacy.architecture.modules = (legacy.architecture.roles ?? []).map((role) => ({
    ...role,
    stateOwnership: [`${role.id}_state`],
    dependsOn: [],
    interfaces: [`${role.id}_interface`],
  }));
  legacy.architecture.stage2Order = (legacy.architecture.roles ?? []).map((role) => role.id);
  delete legacy.architecture.roles;
  legacy.architecture.globalProtocols = legacy.architecture.globalProtocols.map((protocol) => {
    const migrated: Record<string, unknown> = { ...protocol, owner: protocol.ownerRole };
    delete migrated.ownerRole;
    delete migrated.producerRoles;
    delete migrated.consumerRoles;
    delete migrated.affectedResources;
    return migrated;
  });
  delete legacy.verification.completionCriteria;
  return legacy as unknown as Record<string, unknown>;
}

function currentProfile(): string {
  return `schemaVersion: 2
id: migration_fixture
version: 0.8.0
displayName: Migration Fixture
description: Product migration fixture.
defaults:
  projectName: migration_fixture
  goal: Migrate the product schema.
  useCase: Automated verification.
  constraints: [small]
  exclusions: [virtual memory]
environmentChecks: []
decisions:
  - id: D1
    topic: Architecture
    question: Approve the fixture architecture.
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
        summary: Use the fixture architecture.
        consequences: [Stage2 may start.]
architecture:
  roles:
    - id: core
      responsibility: Own architectural execution behavior.
  systemBoundary: [Fixture boundary]
  supportedInstructions: [Fixture instruction]
  invariants: [In order]
  sharedFields: []
  globalProtocols:
    - id: control
      ownerRole: core
      producerRoles: [core]
      consumerRoles: [core]
      affectedResources: [pipeline]
      rules: [Reset has priority.]
  counterRules: []
verification:
  referenceModel: Fixture model.
  layers: [unit]
  requiredScenarios: [smoke]
  counters: []
  decisionAcceptance: []
  completionCriteria: [All Units have approved Design and passing evidence.]
scaffold:
  files:
    - path: build.fixture
      content: fixture
  smokeChecks: []
`;
}

function legacyProfile(): string {
  return `schemaVersion: 1
id: migration_fixture
version: 0.7.0
displayName: Migration Fixture
description: Legacy product migration fixture.
defaults:
  projectName: migration_fixture
  goal: Migrate the product schema.
  useCase: Automated verification.
  constraints: [small]
  exclusions: [Cache exclusion, virtual memory]
environmentChecks: []
decisions:
  - id: D1
    topic: Architecture
    question: Approve the fixture architecture.
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
        summary: Use the fixture architecture.
        consequences: [Stage2 may start.]
architecture:
  modules:
    - id: core
      responsibility: Own architectural execution behavior.
      stateOwnership: [core_state]
      dependsOn: []
      interfaces: [core_interface]
  stage2Order: [core]
  systemBoundary: [Fixture boundary]
  supportedInstructions: [Fixture instruction]
  invariants: [In order]
  sharedFields: []
  globalProtocols:
    - id: control
      owner: core
      rules: [Reset has priority.]
  counterRules: []
verification:
  referenceModel: Fixture model.
  layers: [unit]
  requiredScenarios: [smoke]
  counters: []
  decisionAcceptance: []
scaffold:
  files:
    - path: build.fixture
      content: fixture
  smokeChecks: []
`;
}
