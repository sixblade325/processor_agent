import { sha256 } from "../io.js";
import type {
  Stage2DesignPatch,
  Stage2DesignRevisionIssue,
  Stage2PackageDesignProposal,
  Stage2WorkPackageStateV4,
} from "../types.js";
import { objectValue, requireText } from "./proposal-validation.js";

const EMPTY_CHANGE_MARKERS = new Set([
  "none",
  "no change",
  "no changes",
  "无",
  "无变化",
  "无变更",
  "无共享接口变化",
  "无 shared interface 变化",
]);

export interface CanonicalizationChange {
  ruleId: string;
  target: string;
  oldValue: unknown;
  newValue: unknown;
}

export function canonicalizePackageDesignProposal(
  value: unknown,
  knownWorkPackageIds: string[],
): { value: unknown; changes: CanonicalizationChange[] } {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return { value, changes: [] };
  }
  const proposal = structuredClone(value) as Record<string, unknown>;
  const changes: CanonicalizationChange[] = [];
  const shared = proposal.sharedInterfaceChanges;
  if (
    Array.isArray(shared)
    && shared.length > 0
    && shared.every((item) => typeof item === "string" && isEmptyChangeMarker(item))
  ) {
    changes.push({
      ruleId: "canonical_empty_shared_interface_changes",
      target: "/sharedInterfaceChanges",
      oldValue: structuredClone(shared),
      newValue: [],
    });
    proposal.sharedInterfaceChanges = [];
  }

  const affected = proposal.affectedWorkPackages;
  if (Array.isArray(affected) && affected.every((item) => typeof item === "string")) {
    const canonical = canonicalWorkPackageIds(affected as string[], knownWorkPackageIds);
    if (canonical !== undefined && JSON.stringify(canonical) !== JSON.stringify(affected)) {
      changes.push({
        ruleId: "canonical_work_package_references",
        target: "/affectedWorkPackages",
        oldValue: structuredClone(affected),
        newValue: canonical,
      });
      proposal.affectedWorkPackages = canonical;
    }
  }

  const acceptance = proposal.acceptance;
  if (typeof acceptance === "object" && acceptance !== null && !Array.isArray(acceptance)) {
    const commands = (acceptance as Record<string, unknown>).commands;
    if (Array.isArray(commands)) {
      commands.forEach((command, index) => {
        if (typeof command !== "object" || command === null || Array.isArray(command)) {
          return;
        }
        const record = command as Record<string, unknown>;
        if (
          record.runner === "wsl"
          && (typeof record.script !== "string" || record.script.trim() === "")
          && typeof record.command === "string"
          && record.command.trim() !== ""
          && Array.isArray(record.args)
          && record.args.every((arg) => typeof arg === "string")
        ) {
          const oldValue = structuredClone(record);
          record.script = [record.command, ...(record.args as string[])]
            .map(posixShellQuote)
            .join(" ");
          changes.push({
            ruleId: "canonical_wsl_command_script",
            target: `/acceptance/commands/${String(index)}`,
            oldValue,
            newValue: structuredClone(record),
          });
        }
      });
    }
  }
  return { value: proposal, changes };
}

export function packageDesignRevisionIssues(
  workPackage: Stage2WorkPackageStateV4,
): Stage2DesignRevisionIssue[] {
  const proposal = workPackage.design?.proposal;
  if (proposal === undefined) {
    return [{
      code: "package_design_missing",
      target: "",
      message: "Package Design 尚未生成",
      repairClass: "full_redraft",
    }];
  }
  const issues: Stage2DesignRevisionIssue[] = [];
  if (proposal.openQuestions.length > 0) {
    issues.push({
      code: "open_questions",
      target: "/openQuestions",
      message: `仍有 ${String(proposal.openQuestions.length)} 个未闭合问题`,
      repairClass: "local_patch",
    });
  }
  if (proposal.sharedInterfaceChanges.length > 0) {
    issues.push({
      code: "shared_interface_change",
      target: "/sharedInterfaceChanges",
      message: "Package Design 改变了已批准 shared interface",
      repairClass: "full_redraft",
    });
  }
  if (!samePathSet(proposal.implementation.sourcePaths, workPackage.plan.allowedSourcePaths)) {
    issues.push({
      code: "source_paths_mismatch",
      target: "/implementation/sourcePaths",
      message: "源码路径未完整等于批准的 Work Package 路径",
      repairClass: "local_patch",
    });
  }
  if (!samePathSet(proposal.implementation.testPaths, workPackage.plan.allowedTestPaths)) {
    issues.push({
      code: "test_paths_mismatch",
      target: "/implementation/testPaths",
      message: "测试路径未完整等于批准的 Work Package 路径",
      repairClass: "local_patch",
    });
  }
  return issues;
}

export function proposalHash(proposal: Stage2PackageDesignProposal): string {
  return sha256(JSON.stringify(proposal));
}

export function validateDesignPatch(
  value: unknown,
  baseProposalSha256: string,
  allowedTargets: string[],
): Stage2DesignPatch {
  const record = objectValue(value, "Stage2 Design Patch");
  if (record.baseProposalSha256 !== baseProposalSha256 || !Array.isArray(record.operations)) {
    throw new Error("Design Patch does not match its base proposal");
  }
  const allowed = new Set(allowedTargets);
  const operations = record.operations.map((operation, index) => {
    const item = objectValue(operation, `Design Patch operation ${String(index)}`);
    if (item.op !== "add" && item.op !== "replace" && item.op !== "remove") {
      throw new Error(`Invalid Design Patch operation ${String(item.op)}`);
    }
    requireText(item.target, `Design Patch operation ${String(index)} target`);
    if (!allowed.has(item.target as string)) {
      throw new Error(`Design Patch target is not authorized: ${String(item.target)}`);
    }
    if (item.op !== "remove" && !("value" in item)) {
      throw new Error(`Design Patch ${String(item.op)} requires value at ${String(item.target)}`);
    }
    return {
      op: item.op as "add" | "replace" | "remove",
      target: item.target as string,
      ...(item.op === "remove" ? {} : { value: structuredClone(item.value) }),
    };
  });
  return { baseProposalSha256, operations };
}

export function applyDesignPatch(
  proposal: Stage2PackageDesignProposal,
  patch: Stage2DesignPatch,
): Stage2PackageDesignProposal {
  if (proposalHash(proposal) !== patch.baseProposalSha256) {
    throw new Error("Design Patch base hash drifted");
  }
  const result = structuredClone(proposal) as unknown as Record<string, unknown>;
  for (const operation of patch.operations) {
    applyOperation(result, operation);
  }
  return result as unknown as Stage2PackageDesignProposal;
}

function applyOperation(
  root: Record<string, unknown>,
  operation: Stage2DesignPatch["operations"][number],
): void {
  const segments = operation.target.split("/").slice(1).map(unescapePointer);
  if (segments.length === 0) {
    throw new Error("Design Patch cannot replace the proposal root");
  }
  let parent: Record<string, unknown> = root;
  for (const segment of segments.slice(0, -1)) {
    const child = parent[segment];
    if (typeof child !== "object" || child === null || Array.isArray(child)) {
      throw new Error(`Design Patch parent does not exist: ${operation.target}`);
    }
    parent = child as Record<string, unknown>;
  }
  const key = segments.at(-1)!;
  if (operation.op === "remove") {
    delete parent[key];
  } else {
    parent[key] = structuredClone(operation.value);
  }
}

function canonicalWorkPackageIds(
  values: string[],
  knownIds: string[],
): string[] | undefined {
  const known = new Set(knownIds);
  const result: string[] = [];
  for (const value of values) {
    const trimmed = value.trim();
    if (isEmptyChangeMarker(trimmed)) {
      continue;
    }
    if (known.has(trimmed)) {
      result.push(trimmed);
      continue;
    }
    const candidates = knownIds.filter((id) =>
      trimmed === id || new RegExp(`^${escapeRegex(id)}(?:\\s|[:：,，;；])`, "u").test(trimmed)
    );
    if (candidates.length !== 1) {
      return undefined;
    }
    result.push(candidates[0]!);
  }
  return [...new Set(result)];
}

function isEmptyChangeMarker(value: string): boolean {
  return EMPTY_CHANGE_MARKERS.has(value.trim().toLocaleLowerCase().replace(/[。.]$/u, ""));
}

function posixShellQuote(value: string): string {
  if (/^[A-Za-z0-9_./:=+-]+$/u.test(value)) {
    return value;
  }
  return `'${value.replace(/'/gu, `'"'"'`)}'`;
}

function samePathSet(left: string[], right: string[]): boolean {
  const normalize = (value: string): string => value.replace(/\\/gu, "/").toLowerCase();
  const a = [...new Set(left.map(normalize))].sort();
  const b = [...new Set(right.map(normalize))].sort();
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

function unescapePointer(value: string): string {
  return value.replace(/~1/gu, "/").replace(/~0/gu, "~");
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}
