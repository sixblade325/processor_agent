import { assertSafeRelativePath } from "../io.js";
import type {
  CommandResult,
  CommandSpec,
  Stage2DesignProposal,
  Stage2ImplementationProposal,
  Stage2ModuleState,
  Stage2ReviewReport,
} from "../types.js";

export function validateDesignProposal(
  value: unknown,
  moduleId: string,
): Stage2DesignProposal {
  const record = objectValue(value, "Stage2 Design proposal");
  if (record.schemaVersion !== 1 || record.moduleId !== moduleId) {
    throw new Error(`Stage2 Design proposal does not target ${moduleId}`);
  }
  const proposal = value as Stage2DesignProposal;
  requireText(proposal.summary, "Design summary");
  for (const [label, items] of [
    ["architectureReferences", proposal.architectureReferences],
    ["sourceReferences", proposal.sourceReferences],
    ["explicitExclusions", proposal.explicitExclusions],
    ["interfaces", proposal.interfaces],
    ["cycleBehavior", proposal.cycleBehavior],
    ["exceptionalBehavior", proposal.exceptionalBehavior],
    ["invariants", proposal.invariants],
    ["sharedInterfaceChanges", proposal.sharedInterfaceChanges],
    ["affectedModules", proposal.affectedModules],
    ["risks", proposal.risks],
    ["openQuestions", proposal.openQuestions],
  ] as const) {
    requireStringArray(items, label);
  }
  if (!Array.isArray(proposal.fields) || !Array.isArray(proposal.events)) {
    throw new Error("Design fields and events must be arrays");
  }
  for (const field of proposal.fields) {
    requireText(field.name, "Design field name");
    requireText(field.semantics, `Design field ${field.name} semantics`);
    requireText(field.producer, `Design field ${field.name} producer`);
    requireText(field.storage, `Design field ${field.name} storage`);
    requireStringArray(field.consumers, `Design field ${field.name} consumers`);
    requireText(field.lifetime, `Design field ${field.name} lifetime`);
  }
  for (const event of proposal.events) {
    requireText(event.name, "Design event name");
    requireText(event.condition, `Design event ${event.name} condition`);
    requireStringArray(event.effects, `Design event ${event.name} effects`);
    requireText(event.priority, `Design event ${event.name} priority`);
  }
  requireStringArray(proposal.implementation?.sourcePaths, "implementation.sourcePaths");
  requireStringArray(proposal.implementation?.testPaths, "implementation.testPaths");
  for (const path of proposal.implementation.sourcePaths) {
    assertSafeRelativePath(path);
    if (!path.replace(/\\/gu, "/").startsWith("src/main/")) {
      throw new Error(`Stage2 source path must be under src/main: ${path}`);
    }
  }
  for (const path of proposal.implementation.testPaths) {
    assertSafeRelativePath(path);
    if (!path.replace(/\\/gu, "/").startsWith("src/test/")) {
      throw new Error(`Stage2 test path must be under src/test: ${path}`);
    }
  }
  const allPaths = [...proposal.implementation.sourcePaths, ...proposal.implementation.testPaths];
  if (new Set(allPaths.map(portablePathKey)).size !== allPaths.length) {
    throw new Error("Stage2 Design implementation paths must be unique");
  }
  requireStringArray(proposal.acceptance?.assertions, "acceptance.assertions");
  requireStringArray(proposal.acceptance?.directedTests, "acceptance.directedTests");
  requireStringArray(proposal.acceptance?.expectedResults, "acceptance.expectedResults");
  if (!Array.isArray(proposal.acceptance?.commands)) {
    throw new Error("Stage2 Design verification commands must be an array");
  }
  proposal.acceptance.commands.forEach(validateCommandSpec);
  const commandIds = proposal.acceptance.commands.map((command) => command.id);
  if (new Set(commandIds).size !== commandIds.length) {
    throw new Error("Stage2 Design verification command ids must be unique");
  }
  return structuredClone(proposal);
}

export function validateImplementationProposal(
  value: unknown,
  module: Stage2ModuleState,
  designSha256: string,
): Stage2ImplementationProposal {
  const record = objectValue(value, "Stage2 implementation proposal");
  if (
    record.schemaVersion !== 1
    || record.moduleId !== module.id
    || record.designSha256 !== designSha256
  ) {
    throw new Error(`Stage2 implementation proposal does not match ${module.id} Design`);
  }
  const proposal = value as Stage2ImplementationProposal;
  requireText(proposal.summary, "Implementation summary");
  requireStringArray(proposal.notes, "Implementation notes");
  if (!Array.isArray(proposal.files)) {
    throw new Error("Implementation files must be an array");
  }
  for (const file of proposal.files) {
    requireText(file.path, "Implementation file path");
    if (file.kind !== "source" && file.kind !== "test") {
      throw new Error(`Invalid implementation file kind for ${file.path}`);
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
      throw new Error("An implementation proposal with a Design gap cannot include file writes");
    }
  }
  return structuredClone(proposal);
}

export function validateReviewReport(
  value: unknown,
  module: Stage2ModuleState,
  kind: Stage2ReviewReport["kind"],
  designSha256: string,
  implementationSha256: string,
): Stage2ReviewReport {
  const record = objectValue(value, "Stage2 review report");
  if (
    record.schemaVersion !== 1
    || record.kind !== kind
    || record.moduleId !== module.id
    || record.designSha256 !== designSha256
    || record.implementationAggregateSha256 !== implementationSha256
  ) {
    throw new Error(`Stage2 ${kind} report does not match ${module.id}`);
  }
  const report = value as Stage2ReviewReport;
  if (report.verdict !== "pass" && report.verdict !== "fail") {
    throw new Error(`Invalid ${kind} verdict`);
  }
  requireText(report.summary, `${kind} summary`);
  if (!Array.isArray(report.findings) || !Array.isArray(report.commandResults)) {
    throw new Error(`${kind} report is incomplete`);
  }
  for (const finding of report.findings) {
    if (!["error", "warning", "note"].includes(finding.severity)) {
      throw new Error(`Invalid finding severity in ${kind} report`);
    }
    requireText(finding.code, "Review finding code");
    requireText(finding.message, `Review finding ${finding.code} message`);
    requireText(finding.artifact, `Review finding ${finding.code} artifact`);
    requireText(finding.requiredAction, `Review finding ${finding.code} required action`);
  }
  if (report.verdict === "pass" && report.findings.some((finding) => finding.severity === "error")) {
    throw new Error(`${kind} report passed with error findings`);
  }
  report.commandResults.forEach(validateCommandResult);
  if (kind === "static" && report.commandResults.length > 0) {
    throw new Error("Static review report must not contain command results");
  }
  if (
    kind === "verification"
    && report.verdict === "pass"
    && report.commandResults.some((result) => result.required && !result.ok)
  ) {
    throw new Error("Verification report passed while a required command failed");
  }
  return structuredClone(report);
}

export function requireText(value: unknown, label: string): asserts value is string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${label} is required`);
  }
}

export function requireStringArray(
  value: unknown,
  label: string,
  nonempty = false,
): asserts value is string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string" || item.trim() === "")) {
    throw new Error(`${label} must be a string array`);
  }
  if (nonempty && value.length === 0) {
    throw new Error(`${label} cannot be empty`);
  }
}

export function objectValue(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function validateCommandSpec(value: CommandSpec): void {
  requireText(value.id, "Command id");
  requireText(value.description, `Command ${value.id} description`);
  if (value.runner !== "host" && value.runner !== "wsl") {
    throw new Error(`Invalid runner for ${value.id}`);
  }
  if (typeof value.required !== "boolean") {
    throw new Error(`Command ${value.id} required must be boolean`);
  }
  if (value.runner === "host") {
    requireText(value.command, `Command ${value.id} command`);
  } else {
    requireText(value.script, `Command ${value.id} script`);
  }
}

function validateCommandResult(value: CommandResult): void {
  requireText(value.id, "Command result id");
  requireText(value.description, `Command result ${value.id} description`);
  requireText(value.command, `Command result ${value.id} command`);
  requireText(value.checkedAt, `Command result ${value.id} checkedAt`);
  if (value.runner !== "host" && value.runner !== "wsl") {
    throw new Error(`Invalid command result runner for ${value.id}`);
  }
  if (typeof value.ok !== "boolean" || typeof value.required !== "boolean") {
    throw new Error(`Invalid command result booleans for ${value.id}`);
  }
}

function portablePathKey(path: string): string {
  return path.replace(/\\/gu, "/").toLowerCase();
}
