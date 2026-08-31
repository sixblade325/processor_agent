import { basename } from "node:path";
import type {
  CommandResult,
  CommandSpec,
  Stage2PackageReviewReport,
  Stage2PackageWorkerEvidence,
  Stage2SkillReference,
} from "../types.js";

export function requiredCommandFailures(results: CommandResult[]): string[] {
  return results
    .filter((result) => result.required && !result.ok)
    .map((result) => `${result.id}: ${result.output || `exitCode=${String(result.exitCode)}`}`);
}

export function packageReviewFailures(
  staticReport: Stage2PackageReviewReport,
  verificationReport: Stage2PackageReviewReport,
): string[] {
  return [staticReport, verificationReport].flatMap((report) => {
    const findings = report.findings
      .filter((finding) => finding.severity === "error")
      .map((finding) => `${finding.code}: ${finding.message}`);
    if (report.verdict === "fail" && findings.length === 0) {
      findings.push(`${report.kind} review failed: ${report.summary}`);
    }
    return findings;
  });
}

export function assertIndependentCommandEvidence(
  specs: CommandSpec[],
  results: CommandResult[],
): void {
  const expected = new Map(specs.map((spec) => [spec.id, spec]));
  const actual = new Map(results.map((result) => [result.id, result]));
  for (const [id, spec] of expected) {
    const result = actual.get(id);
    if (result === undefined) {
      throw new Error(`Independent Verification omitted command ${id}`);
    }
    if (result.runner !== spec.runner || result.required !== spec.required) {
      throw new Error(`Independent Verification changed command metadata for ${id}`);
    }
  }
  const unexpected = [...actual.keys()].filter((id) => !expected.has(id));
  if (unexpected.length > 0) {
    throw new Error(`Independent Verification reported unexpected commands: ${unexpected.join(", ")}`);
  }
}

export function packageWorkerEvidence(
  task: Stage2PackageWorkerEvidence["task"],
  runtimeRef: string,
  runtimeRoot: string,
  skills: Stage2SkillReference[],
  report: Stage2PackageReviewReport,
  now: Date,
): Stage2PackageWorkerEvidence {
  return {
    task,
    runtimeRef,
    runId: basename(runtimeRoot),
    completedAt: now.toISOString(),
    skills: skills.map((skill) => ({ ...skill })),
    report: structuredClone(report),
  };
}
