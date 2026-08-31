import { readFile } from "node:fs/promises";
import { renderFormalDocuments } from "./render.js";
import { atomicWriteText, resolveWithin, sha256 } from "./io.js";
import { loadProfile } from "./profile.js";
import {
  createProjectSpecPatches,
  loadStage1,
  replayProjectSpecHistory,
  saveProjectState,
  syncFormalDocuments,
} from "./stage1.js";
import {
  PROJECT_SPEC_TARGETS,
  getProjectSpecTarget,
  profileProjectSpec,
  validateProjectSpec,
} from "./stage1/project-spec.js";
import {
  migrateStage2ProductSchema,
  type Stage2ProductMigrationResult,
} from "./stage2.js";
import type {
  GlobalProtocolSpec,
  ProductSchemaMigrationRecord,
  ProjectIntent,
  ProjectProfile,
  ProjectSpecHistory,
  ProjectSpecTarget,
  Stage1ProjectSpec,
  Stage1ProjectState,
} from "./types.js";

export interface ProductMigrationOptions {
  profileReference: string;
  apply: boolean;
  now?: Date;
}

export interface ProductMigrationReport {
  project: string;
  applied: boolean;
  fromStage1SchemaVersion: number;
  toStage1SchemaVersion: 2;
  fromProfileVersion: string;
  toProfileVersion: string;
  sourceStage1Revision: number;
  targetStage1Revision: number;
  stage2: Stage2ProductMigrationResult;
  retainedDecisionCount: number;
  retainedCorrectionCount: number;
  ineffectiveCorrectionIds: string[];
  retiredArtifacts: string[];
  generatedArtifacts: string[];
  currentProjectSpecSha256: string;
  replayedProjectSpecSha256: string;
  nextRequiredAction: string;
}

export async function migrateProductSchema(
  projectPath: string,
  options: ProductMigrationOptions,
): Promise<ProductMigrationReport> {
  const loaded = await loadStage1(projectPath);
  const nextProfile = await loadProfile(options.profileReference);
  if (nextProfile.profile.id !== loaded.loadedProfile.profile.id) {
    throw new Error(
      `Product migration cannot change profile id ${loaded.loadedProfile.profile.id} -> ${nextProfile.profile.id}`,
    );
  }
  if (nextProfile.profile.schemaVersion < 2) {
    throw new Error("Product migration requires a schemaVersion 2 Profile");
  }
  if (
    loaded.state.schemaVersion >= 2
    && loaded.state.stage1.projectSpec?.intent !== undefined
    && loaded.state.project.profile.digest === nextProfile.digest
  ) {
    throw new Error("Project already uses the current product schema and Profile");
  }
  const oldHistory = loaded.state.stage1.projectSpecHistory;
  if (oldHistory === undefined || oldHistory.protocolVersion < 2) {
    throw new Error(
      "Product migration requires Review Correction history protocol 2 or newer; run stage1 correction-migrate first",
    );
  }

  const migratedAt = (options.now ?? new Date()).toISOString();
  const migrated = structuredClone(loaded.state);
  const migratedIntent = migrateIntent(
    loaded.state.stage1.intent
      ?? legacyIntentFromSpec(loaded.state.stage1.projectSpec, loaded.loadedProfile.profile),
    loaded.loadedProfile.profile,
    nextProfile.profile,
  );
  const transform = (spec: unknown): Stage1ProjectSpec => migrateProjectSpec(
    spec,
    migratedIntent,
    nextProfile.profile,
  );
  const transformedHistory = transformHistory(
    loaded.state,
    oldHistory,
    transform,
    nextProfile.digest,
  );
  const currentSpec = transform(replayProjectSpecHistory(loaded.state));
  const replayedSpec = replayTransformedHistory(transformedHistory);
  const currentProjectSpecSha256 = valueSha256(currentSpec);
  const replayedProjectSpecSha256 = valueSha256(replayedSpec);
  if (currentProjectSpecSha256 !== replayedProjectSpecSha256) {
    throw new Error("Product migration failed to preserve the ProjectSpec history chain");
  }

  const previousReview = migrated.stage1.review;
  if (previousReview !== undefined) {
    migrated.stage1.reviewHistory = [
      ...(migrated.stage1.reviewHistory ?? []),
      structuredClone(previousReview),
    ];
    delete migrated.stage1.review;
  }
  const ineffectiveCorrectionIds: string[] = [];
  for (const correction of migrated.stage1.reviewCorrections ?? []) {
    if (
      correction.schemaVersion === 2
      && correction.findingCodes.some((code) => /^ARCH_SYSTEM_BOUNDARY_CACHE_/u.test(code))
    ) {
      correction.status = "ineffective";
      ineffectiveCorrectionIds.push(correction.id);
    }
  }

  const sourceStage1Revision = migrated.stage1.revision;
  const targetStage1Revision = sourceStage1Revision + 1;
  const previousApprovalSha256 = migrated.stage1.approval?.aggregateSha256;
  if (migrated.stage1.approval !== undefined) {
    const previousApproval = structuredClone(migrated.stage1.approval);
    const history = migrated.stage1.approvalHistory ?? [];
    if (!history.some((approval) => approval.aggregateSha256 === previousApproval.aggregateSha256)) {
      history.push(previousApproval);
    }
    migrated.stage1.approvalHistory = history;
  }
  migrated.schemaVersion = 2;
  migrated.project.profile = {
    id: nextProfile.profile.id,
    version: nextProfile.profile.version,
    digest: nextProfile.digest,
    snapshot: migrated.project.profile.snapshot,
  };
  delete migrated.stage1.intent;
  migrated.stage1.projectSpec = currentSpec;
  migrated.stage1.projectSpecHistory = transformedHistory;
  migrated.stage1.overriddenTargets = findProjectOverrides(currentSpec, nextProfile.profile);
  migrated.stage1.status = "ARCHITECTURE_REVIEW";
  migrated.stage1.revision = targetStage1Revision;
  migrated.stage1.updatedAt = migratedAt;
  migrated.stage1.blockers = [];
  delete migrated.stage1.approval;
  migrated.stage1.history.push({
    at: migratedAt,
    revision: targetStage1Revision,
    event: "PRODUCT_SCHEMA_MIGRATED",
    detail: `${loaded.loadedProfile.profile.version} -> ${nextProfile.profile.version}`,
  });

  const stage2 = await migrateStage2ProductSchema(
    loaded.root,
    migrated,
    migratedAt,
    options.apply,
  );
  const nextDocuments = await renderFormalDocuments(
    loaded.root,
    migrated,
    nextProfile.profile,
  );
  const retiredArtifacts = Object.keys(loaded.state.stage1.generatedDocumentHashes)
    .filter((path) => !(path in nextDocuments));
  const migrationRecord: ProductSchemaMigrationRecord = {
    id: `PRODUCT_MIG_${String((migrated.stage1.productMigrations?.length ?? 0) + 1).padStart(3, "0")}`,
    migratedAt,
    fromStage1SchemaVersion: loaded.state.schemaVersion,
    toStage1SchemaVersion: 2,
    fromProfileVersion: loaded.loadedProfile.profile.version,
    toProfileVersion: nextProfile.profile.version,
    sourceStage1Revision,
    targetStage1Revision,
    ...(previousApprovalSha256 === undefined ? {} : { previousApprovalSha256 }),
    ...(stage2.sourceSchemaVersion === undefined
      ? {}
      : { sourceStage2SchemaVersion: stage2.sourceSchemaVersion }),
    ...(stage2.targetSchemaVersion === undefined
      ? {}
      : { targetStage2SchemaVersion: stage2.targetSchemaVersion }),
    ...(stage2.sourceRevision === undefined
      ? {}
      : { sourceStage2Revision: stage2.sourceRevision }),
    ...(stage2.targetRevision === undefined
      ? {}
      : { targetStage2Revision: stage2.targetRevision }),
    retiredArtifacts,
  };
  migrated.stage1.productMigrations = [
    ...(migrated.stage1.productMigrations ?? []),
    migrationRecord,
  ];

  if (options.apply) {
    await atomicWriteText(
      resolveWithin(loaded.root, migrated.project.profile.snapshot),
      await readFile(nextProfile.path, "utf8"),
    );
    await syncFormalDocuments(loaded.root, migrated, nextProfile.profile, true);
    await saveProjectState(loaded.root, migrated);
  }

  const nextRequiredAction = migrated.stage1.architectureRework?.status === "active"
    ? "运行 stage1 review、独立 audit 和用户 approve，然后恢复活动的 Stage2 Architecture Rework。"
    : "运行 stage1 review、独立 audit 和用户 approve，再执行 stage1 scaffold 与 stage1 complete。";

  return {
    project: migrated.project.name,
    applied: options.apply,
    fromStage1SchemaVersion: loaded.state.schemaVersion,
    toStage1SchemaVersion: 2,
    fromProfileVersion: loaded.loadedProfile.profile.version,
    toProfileVersion: nextProfile.profile.version,
    sourceStage1Revision,
    targetStage1Revision,
    stage2,
    retainedDecisionCount: Object.keys(migrated.stage1.decisions).length,
    retainedCorrectionCount: migrated.stage1.reviewCorrections?.length ?? 0,
    ineffectiveCorrectionIds,
    retiredArtifacts,
    generatedArtifacts: Object.keys(nextDocuments),
    currentProjectSpecSha256,
    replayedProjectSpecSha256,
    nextRequiredAction,
  };
}

function migrateIntent(
  current: ProjectIntent,
  previousProfile: ProjectProfile,
  nextProfile: ProjectProfile,
): ProjectIntent {
  const previous = profileProjectSpec(previousProfile).intent;
  const next = profileProjectSpec(nextProfile).intent;
  return {
    goal: sameValue(current.goal, previous.goal) ? next.goal : current.goal,
    useCase: sameValue(current.useCase, previous.useCase) ? next.useCase : current.useCase,
    constraints: sameValue(current.constraints, previous.constraints)
      ? [...next.constraints]
      : [...current.constraints],
    exclusions: sameValue(current.exclusions, previous.exclusions)
      ? [...next.exclusions]
      : [...current.exclusions],
  };
}

function legacyIntentFromSpec(
  spec: Stage1ProjectSpec | undefined,
  profile: ProjectProfile,
): ProjectIntent {
  const candidate = spec as unknown as { intent?: ProjectIntent } | undefined;
  return structuredClone(candidate?.intent ?? profileProjectSpec(profile).intent);
}

function migrateProjectSpec(
  value: unknown,
  intent: ProjectIntent,
  nextProfile: ProjectProfile,
): Stage1ProjectSpec {
  const source = value as {
    architecture?: Record<string, unknown>;
    verification?: Record<string, unknown>;
  };
  const architecture = source.architecture ?? {};
  const verification = source.verification ?? {};
  const protocolMetadata = new Map(
    nextProfile.architecture.globalProtocols.map((protocol) => [protocol.id, protocol]),
  );
  const roles = new Set(nextProfile.architecture.roles.map((role) => role.id));
  const protocols = Array.isArray(architecture.globalProtocols)
    ? architecture.globalProtocols.map((raw) => {
        const protocol = raw as Record<string, unknown>;
        const id = String(protocol.id ?? "");
        const metadata = protocolMetadata.get(id);
        const legacyOwner = String(protocol.ownerRole ?? protocol.owner ?? "");
        const ownerRole = metadata?.ownerRole
          ?? (roles.has(legacyOwner) ? legacyOwner : nextProfile.architecture.roles[0]?.id ?? legacyOwner);
        return {
          id,
          ownerRole,
          producerRoles: [...(metadata?.producerRoles ?? [ownerRole])],
          consumerRoles: [...(metadata?.consumerRoles ?? [])],
          affectedResources: [...(metadata?.affectedResources ?? [])],
          rules: stringArray(protocol.rules),
        } satisfies GlobalProtocolSpec;
      })
    : [];
  return validateProjectSpec({
    intent: structuredClone(intent),
    architecture: {
      roles: structuredClone(nextProfile.architecture.roles),
      systemBoundary: stringArray(architecture.systemBoundary),
      supportedInstructions: stringArray(architecture.supportedInstructions),
      invariants: stringArray(architecture.invariants),
      sharedFields: structuredClone(
        architecture.sharedFields ?? [],
      ) as ProjectProfile["architecture"]["sharedFields"],
      globalProtocols: protocols,
      counterRules: structuredClone(
        architecture.counterRules ?? [],
      ) as ProjectProfile["architecture"]["counterRules"],
    },
    verification: {
      referenceModel: String(verification.referenceModel ?? nextProfile.verification.referenceModel),
      layers: stringArray(verification.layers),
      requiredScenarios: stringArray(verification.requiredScenarios),
      counters: stringArray(verification.counters),
      decisionAcceptance: structuredClone(
        verification.decisionAcceptance ?? [],
      ) as ProjectProfile["verification"]["decisionAcceptance"],
      completionCriteria: structuredClone(nextProfile.verification.completionCriteria),
    },
  }, nextProfile);
}

function transformHistory(
  state: Stage1ProjectState,
  history: ProjectSpecHistory,
  transform: (spec: unknown) => Stage1ProjectSpec,
  profileDigest: string,
): ProjectSpecHistory {
  const baseline = transform(history.baseline.value);
  const events = history.events.map((event) => {
    const previousIndex = history.events.findIndex((candidate) => candidate.id === event.id) - 1;
    const previousRaw = previousIndex < 0
      ? history.baseline.value
      : replayProjectSpecHistory(state, history.events[previousIndex]!.id);
    const nextRaw = replayProjectSpecHistory(state, event.id);
    const before = transform(previousRaw);
    const after = transform(nextRaw);
    return {
      ...structuredClone(event),
      beforeSha256: valueSha256(before),
      afterSha256: valueSha256(after),
      patches: createProjectSpecPatches(before, after),
    };
  });
  return {
    protocolVersion: 3,
    baseline: {
      profileDigest,
      projectSpecSha256: valueSha256(baseline),
      value: baseline,
    },
    events,
  };
}

function replayTransformedHistory(history: ProjectSpecHistory): Stage1ProjectSpec {
  const current = structuredClone(history.baseline.value);
  for (const event of history.events) {
    if (valueSha256(current) !== event.beforeSha256) {
      throw new Error(`Migrated history before hash mismatch at ${event.id}`);
    }
    for (const patch of event.patches) {
      applyPatch(current, patch);
    }
    if (valueSha256(current) !== event.afterSha256) {
      throw new Error(`Migrated history after hash mismatch at ${event.id}`);
    }
  }
  return current;
}

function applyPatch(
  spec: Stage1ProjectSpec,
  patch: ProjectSpecHistory["events"][number]["patches"][number],
): void {
  const current = getProjectSpecTarget(spec, patch.target);
  if (valueSha256(current) !== patch.beforeSha256) {
    throw new Error(`Migrated patch before hash mismatch for ${patch.target}`);
  }
  if (patch.kind === "replace") {
    setTarget(spec, patch.target, structuredClone(patch.value));
  } else if (patch.kind === "string_array") {
    setTarget(spec, patch.target, [...patch.order]);
  } else {
    const values = new Map(
      (current as Array<Record<string, unknown>>).map((item) => [String(item[patch.keyField]), structuredClone(item)]),
    );
    for (const key of patch.remove) {
      values.delete(key);
    }
    for (const item of patch.add) {
      values.set(String(item[patch.keyField]), structuredClone(item));
    }
    for (const update of patch.update) {
      const item = values.get(update.key);
      if (item === undefined) {
        throw new Error(`Migrated patch references unknown key ${update.key}`);
      }
      for (const field of update.removeFields) {
        delete item[field];
      }
      Object.assign(item, structuredClone(update.fields));
    }
    setTarget(spec, patch.target, patch.order.map((key) => values.get(key)!));
  }
  if (valueSha256(getProjectSpecTarget(spec, patch.target)) !== patch.afterSha256) {
    throw new Error(`Migrated patch after hash mismatch for ${patch.target}`);
  }
}

function setTarget(spec: Stage1ProjectSpec, target: ProjectSpecTarget, value: unknown): void {
  const [domain, field] = target.split(".") as [keyof Stage1ProjectSpec, string];
  (spec[domain] as unknown as Record<string, unknown>)[field] = value;
}

function findProjectOverrides(
  spec: Stage1ProjectSpec,
  profile: ProjectProfile,
): ProjectSpecTarget[] {
  const defaults = profileProjectSpec(profile);
  return PROJECT_SPEC_TARGETS.filter((target) =>
    !sameValue(getProjectSpecTarget(spec, target), getProjectSpecTarget(defaults, target))
  );
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.map((item) => String(item)) : [];
}

function valueSha256(value: unknown): string {
  return sha256(JSON.stringify(value));
}

function sameValue(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}
