import { assertSafeRelativePath } from "../io.js";
import type {
  CommandResult,
  CommandSpec,
  Stage2PackageDesignProposal,
  Stage2PackageImplementationProposal,
  Stage2PackageReviewReport,
  Stage2SystemDesignProposal,
  Stage2WorkPackageStateV4,
  Stage2WorkspaceStage,
} from "../types.js";
import { validateDecisionRequestSpecs } from "./design-package.js";
import { isEmptySharedInterfaceChange } from "./design-revision.js";
import { objectValue, requireStringArray, requireText } from "./proposal-validation.js";

export function validatePackageDesignProposal(
  value: unknown,
  workPackage: Stage2WorkPackageStateV4,
  systemDesign: Stage2SystemDesignProposal,
): Stage2PackageDesignProposal {
  const record = objectValue(value, "Stage2 Package Design proposal");
  if (record.schemaVersion !== 1 || record.workPackageId !== workPackage.id) {
    throw new Error(`Package Design proposal does not target ${workPackage.id}`);
  }
  const proposal = value as Stage2PackageDesignProposal;
  requireStringArray(proposal.componentIds, "Package Design componentIds", true);
  if (!sameSet(proposal.componentIds, workPackage.plan.componentIds)) {
    throw new Error(`Package Design ${workPackage.id} must cover its approved Component set`);
  }
  requireText(proposal.summary, "Package Design summary");
  for (const [label, values] of [
    ["architectureReferences", proposal.architectureReferences],
    ["sourceReferences", proposal.sourceReferences],
    ["explicitExclusions", proposal.explicitExclusions],
    ["interfaces", proposal.interfaces],
    ["cycleBehavior", proposal.cycleBehavior],
    ["exceptionalBehavior", proposal.exceptionalBehavior],
    ["invariants", proposal.invariants],
    ["sharedInterfaceChanges", proposal.sharedInterfaceChanges],
    ["affectedWorkPackages", proposal.affectedWorkPackages],
    ["risks", proposal.risks],
    ["openQuestions", proposal.openQuestions],
  ] as const) {
    requireStringArray(values, label);
  }
  if (!Array.isArray(proposal.fields) || !Array.isArray(proposal.events)) {
    throw new Error("Package Design fields and events must be arrays");
  }
  for (const field of proposal.fields) {
    requireText(field.name, "Package Design field name");
    requireText(field.semantics, `Package Design field ${field.name} semantics`);
    requireText(field.producer, `Package Design field ${field.name} producer`);
    requireText(field.storage, `Package Design field ${field.name} storage`);
    requireStringArray(field.consumers, `Package Design field ${field.name} consumers`);
    requireText(field.lifetime, `Package Design field ${field.name} lifetime`);
  }
  for (const event of proposal.events) {
    requireText(event.name, "Package Design event name");
    requireText(event.condition, `Package Design event ${event.name} condition`);
    requireStringArray(event.effects, `Package Design event ${event.name} effects`);
    requireText(event.priority, `Package Design event ${event.name} priority`);
  }
  requireStringArray(proposal.implementation?.sourcePaths, "implementation.sourcePaths", true);
  requireStringArray(proposal.implementation?.testPaths, "implementation.testPaths", true);
  assertPathSubset(
    proposal.implementation.sourcePaths,
    workPackage.plan.allowedSourcePaths,
    `${workPackage.id} source`,
  );
  assertPathSubset(
    proposal.implementation.testPaths,
    workPackage.plan.allowedTestPaths,
    `${workPackage.id} test`,
  );
  requireStringArray(proposal.acceptance?.assertions, "acceptance.assertions", true);
  requireStringArray(proposal.acceptance?.directedTests, "acceptance.directedTests", true);
  requireStringArray(proposal.acceptance?.expectedResults, "acceptance.expectedResults", true);
  if (!Array.isArray(proposal.acceptance?.commands) || proposal.acceptance.commands.length === 0) {
    throw new Error("Package Design requires at least one verification command");
  }
  proposal.acceptance.commands.forEach(validateCommandSpec);
  assertUnique(proposal.acceptance.commands.map((command) => command.id), "Package command ids");
  if (!Array.isArray(proposal.decisionRequests)) {
    throw new Error("Package Design decisionRequests must be an array");
  }
  validateDecisionRequestSpecs(proposal.decisionRequests);
  const knownPackages = new Set(systemDesign.workPackages.map((item) => item.id));
  for (const affected of proposal.affectedWorkPackages) {
    if (!knownPackages.has(affected)) {
      throw new Error(`Package Design ${workPackage.id} affects unknown Work Package ${affected}`);
    }
  }
  return structuredClone(proposal);
}

export function validatePackageImplementationProposal(
  value: unknown,
  workPackage: Stage2WorkPackageStateV4,
  designSha256: string,
): Stage2PackageImplementationProposal {
  const record = objectValue(value, "Stage2 Package implementation proposal");
  if (
    record.schemaVersion !== 1
    || record.workPackageId !== workPackage.id
    || record.designSha256 !== designSha256
  ) {
    throw new Error(`Package implementation proposal does not match ${workPackage.id} Design`);
  }
  const proposal = value as Stage2PackageImplementationProposal;
  requireText(proposal.summary, "Package implementation summary");
  requireStringArray(proposal.notes, "Package implementation notes");
  if (!Array.isArray(proposal.files)) {
    throw new Error("Package implementation files must be an array");
  }
  const allowed = new Set([
    ...workPackage.plan.allowedSourcePaths,
    ...workPackage.plan.allowedTestPaths,
  ].map(portablePath));
  const seen = new Set<string>();
  for (const file of proposal.files) {
    requireText(file.path, "Package implementation file path");
    assertSafeRelativePath(file.path);
    const normalized = portablePath(file.path);
    if (!allowed.has(normalized)) {
      throw new Error(`Implementation path is outside Work Package ${workPackage.id}: ${file.path}`);
    }
    if (seen.has(normalized)) {
      throw new Error(`Implementation proposal repeats path: ${file.path}`);
    }
    seen.add(normalized);
    if (file.kind !== "source" && file.kind !== "test") {
      throw new Error(`Invalid implementation kind for ${file.path}`);
    }
    if (file.baseSha256 !== null && !/^[a-f0-9]{64}$/u.test(file.baseSha256)) {
      throw new Error(`Invalid baseSha256 for ${file.path}`);
    }
    if (typeof file.content !== "string") {
      throw new Error(`Implementation file ${file.path} has no content`);
    }
    requireText(file.purpose, `Implementation file ${file.path} purpose`);
  }
  if (proposal.designGap !== null) {
    requireText(proposal.designGap.reason, "Design gap reason");
    requireText(proposal.designGap.counterexample, "Design gap counterexample");
    if (proposal.files.length > 0) {
      throw new Error("An implementation proposal with a Design gap cannot include writes");
    }
  }
  return structuredClone(proposal);
}

export function validatePackageReviewReport(
  value: unknown,
  workPackageId: string,
  kind: Stage2PackageReviewReport["kind"],
  designSha256: string,
  implementationSha256: string,
): Stage2PackageReviewReport {
  const record = objectValue(value, "Stage2 Package review report");
  if (
    record.schemaVersion !== 1
    || record.kind !== kind
    || record.workPackageId !== workPackageId
    || record.designSha256 !== designSha256
    || record.implementationAggregateSha256 !== implementationSha256
  ) {
    throw new Error(`Package ${kind} report does not match ${workPackageId}`);
  }
  const report = value as Stage2PackageReviewReport;
  if (report.verdict !== "pass" && report.verdict !== "fail") {
    throw new Error(`Invalid Package ${kind} verdict`);
  }
  requireText(report.summary, `Package ${kind} summary`);
  if (!Array.isArray(report.findings) || !Array.isArray(report.commandResults)) {
    throw new Error(`Package ${kind} report is incomplete`);
  }
  for (const finding of report.findings) {
    if (!new Set(["error", "warning", "note"]).has(finding.severity)) {
      throw new Error(`Invalid finding severity in Package ${kind} report`);
    }
    requireText(finding.code, "Package review finding code");
    requireText(finding.message, `Package review finding ${finding.code} message`);
    requireText(finding.artifact, `Package review finding ${finding.code} artifact`);
    requireText(finding.requiredAction, `Package review finding ${finding.code} requiredAction`);
  }
  if (report.verdict === "pass" && report.findings.some((finding) => finding.severity === "error")) {
    throw new Error(`Package ${kind} review passed with error findings`);
  }
  report.commandResults.forEach(validateCommandResult);
  if (kind === "static" && report.commandResults.length > 0) {
    throw new Error("Package Static Review must not include command results");
  }
  if (
    kind === "verification"
    && report.verdict === "pass"
    && report.commandResults.some((result) => result.required && !result.ok)
  ) {
    throw new Error("Package Verification passed with a failed required command");
  }
  return structuredClone(report);
}

export function packageDesignIssues(workPackage: Stage2WorkPackageStateV4): string[] {
  const design = workPackage.design;
  if (design === undefined) {
    return ["Package Design 尚未生成"];
  }
  const proposal = design.proposal;
  const issues: string[] = [];
  if (proposal.openQuestions.length > 0) {
    issues.push(...proposal.openQuestions.map((question) => `未闭合问题：${question}`));
  }
  if (proposal.sharedInterfaceChanges.some((change) => !isEmptySharedInterfaceChange(change))) {
    issues.push("Package Design 改变了已批准 shared interface，需要先修订 System Design");
  }
  for (const id of workPackage.decisionOrder) {
    if (workPackage.decisions[id]?.status === "open") {
      issues.push(`DecisionRequest ${id} 尚未回答`);
    }
  }
  if (!sameSet(proposal.implementation.sourcePaths, workPackage.plan.allowedSourcePaths)) {
    issues.push("Design 源码路径未完整覆盖批准的 Work Package 路径");
  }
  if (!sameSet(proposal.implementation.testPaths, workPackage.plan.allowedTestPaths)) {
    issues.push("Design 测试路径未完整覆盖批准的 Work Package 路径");
  }
  return issues;
}

export function isPackageDesignable(
  stage2: Stage2WorkspaceStage,
  workPackage: Stage2WorkPackageStateV4,
): boolean {
  return workPackage.plan.designDependsOn.every((id) => {
    const dependency = stage2.workPackages[id];
    return dependency?.design?.approval !== undefined;
  });
}

export function areImplementationDependenciesComplete(
  stage2: Stage2WorkspaceStage,
  workPackage: Stage2WorkPackageStateV4,
): boolean {
  return workPackage.plan.implementationDependsOn.every((id) =>
    stage2.workPackages[id]?.status === "COMPLETE"
  );
}

export function areIntegrationDependenciesComplete(
  stage2: Stage2WorkspaceStage,
  workPackage: Stage2WorkPackageStateV4,
): boolean {
  return workPackage.plan.integrationDependsOn.every((id) =>
    stage2.workPackages[id]?.status === "COMPLETE"
  );
}

export function transitivePackageConsumers(
  stage2: Stage2WorkspaceStage,
  roots: Iterable<string>,
): Set<string> {
  const affected = new Set(roots);
  let changed = true;
  while (changed) {
    changed = false;
    for (const workPackage of Object.values(stage2.workPackages)) {
      if (affected.has(workPackage.id)) {
        continue;
      }
      const dependencies = [
        ...workPackage.plan.designDependsOn,
        ...workPackage.plan.implementationDependsOn,
        ...workPackage.plan.integrationDependsOn,
      ];
      if (dependencies.some((dependency) => affected.has(dependency))) {
        affected.add(workPackage.id);
        changed = true;
      }
    }
  }
  return affected;
}

function assertPathSubset(actual: string[], approved: string[], label: string): void {
  const allowed = new Set(approved.map(portablePath));
  const seen = new Set<string>();
  for (const path of actual) {
    assertSafeRelativePath(path);
    const normalized = portablePath(path);
    if (!allowed.has(normalized)) {
      throw new Error(`${label} path is not approved: ${path}`);
    }
    if (seen.has(normalized)) {
      throw new Error(`${label} path is repeated: ${path}`);
    }
    seen.add(normalized);
  }
}

function validateCommandSpec(command: CommandSpec): void {
  requireText(command.id, "Package command id");
  requireText(command.description, `Package command ${command.id} description`);
  if (command.runner !== "host" && command.runner !== "wsl") {
    throw new Error(`Invalid runner for Package command ${command.id}`);
  }
  if (typeof command.required !== "boolean") {
    throw new Error(`Package command ${command.id} required must be boolean`);
  }
  if (command.runner === "host") {
    requireText(command.command, `Package command ${command.id} command`);
  } else {
    requireText(command.script, `Package command ${command.id} script`);
  }
}

function validateCommandResult(result: CommandResult): void {
  requireText(result.id, "Package command result id");
  requireText(result.description, `Package command result ${result.id} description`);
  requireText(result.command, `Package command result ${result.id} command`);
  requireText(result.checkedAt, `Package command result ${result.id} checkedAt`);
  if (result.runner !== "host" && result.runner !== "wsl") {
    throw new Error(`Invalid Package command result runner for ${result.id}`);
  }
  if (typeof result.ok !== "boolean" || typeof result.required !== "boolean") {
    throw new Error(`Invalid Package command result flags for ${result.id}`);
  }
}

function assertUnique(values: string[], label: string): void {
  if (new Set(values).size !== values.length) {
    throw new Error(`${label} must be unique`);
  }
}

function sameSet(left: string[], right: string[]): boolean {
  const leftKeys = [...new Set(left.map(portablePath))].sort();
  const rightKeys = [...new Set(right.map(portablePath))].sort();
  return leftKeys.length === rightKeys.length
    && leftKeys.every((value, index) => value === rightKeys[index]);
}

function portablePath(value: string): string {
  return value.replace(/\\/gu, "/").toLowerCase();
}
