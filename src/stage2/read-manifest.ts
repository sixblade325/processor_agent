import { dirname } from "node:path";
import { pathExists, resolveWithin, sha256 } from "../io.js";
import type {
  Stage1ProjectState,
  Stage2AgentTask,
  Stage2ReadManifest,
  Stage2WorkPackageStateV4,
  Stage2WorkspaceStage,
} from "../types.js";

const DEFAULT_EXCLUDED_ROOTS = [
  ".assistant",
  ".runtime",
  ".git",
  ".bloop",
  ".bsp",
  ".metals",
  ".scala-build",
  "node_modules",
  "out",
  "target",
  "test_run_dir",
  "research/reference_sources",
];

const BUILD_ENTRY_CANDIDATES = [
  "AGENTS.md",
  "README.md",
  "build.sbt",
  "Makefile",
  "project/build.properties",
  "project/plugins.sbt",
];

export async function buildStage2ReadManifest(
  root: string,
  state: Stage1ProjectState,
  stage2: Stage2WorkspaceStage,
  task: Stage2AgentTask,
  workPackage?: Stage2WorkPackageStateV4,
): Promise<Stage2ReadManifest> {
  const entryCandidates = new Set<string>([
    ...BUILD_ENTRY_CANDIDATES,
    ...Object.keys(state.stage1.approval?.documentHashes ?? {}),
    stage2.systemDesign.path,
  ]);
  const allowedRoots: string[] = [];
  const affectedIds = workPackage === undefined ? ["system_design"] : [workPackage.id];

  if (workPackage === undefined) {
    allowedRoots.push("architecture", "src/main", "src/test", "verification");
  } else {
    entryCandidates.add(workPackage.plan.designPath);
    for (const path of [
      ...workPackage.plan.allowedSourcePaths,
      ...workPackage.plan.allowedTestPaths,
    ]) {
      entryCandidates.add(path);
    }
    const dependencyIds = new Set([
      ...workPackage.plan.designDependsOn,
      ...workPackage.plan.implementationDependsOn,
      ...workPackage.plan.integrationDependsOn,
    ]);
    for (const dependencyId of dependencyIds) {
      const dependency = stage2.workPackages[dependencyId];
      if (dependency === undefined) {
        continue;
      }
      entryCandidates.add(dependency.plan.designPath);
      for (const path of [
        ...dependency.plan.allowedSourcePaths,
        ...dependency.plan.allowedTestPaths,
      ]) {
        entryCandidates.add(path);
      }
    }
    if (
      task === "package_implementation"
      || task === "package_static_review"
      || task === "package_verification"
    ) {
      for (const path of [
        ...workPackage.plan.allowedSourcePaths,
        ...workPackage.plan.allowedTestPaths,
      ]) {
        const parent = portablePath(dirname(path));
        if (parent !== ".") {
          allowedRoots.push(parent);
        }
      }
    }
  }

  const entryFiles: string[] = [];
  for (const path of [...entryCandidates].map(portablePath).sort()) {
    if (await pathExists(resolveWithin(root, path))) {
      entryFiles.push(path);
    }
  }
  return finalizeReadManifest({
    entryFiles,
    allowedRoots: uniqueSorted(allowedRoots),
    excludedRoots: DEFAULT_EXCLUDED_ROOTS,
    affectedIds,
    maxListedFiles: workPackage === undefined ? 250 : 100,
  });
}

export function finalizeReadManifest(
  value: Omit<Stage2ReadManifest, "manifestSha256">,
): Stage2ReadManifest {
  const payload = {
    entryFiles: uniqueSorted(value.entryFiles),
    allowedRoots: uniqueSorted(value.allowedRoots),
    excludedRoots: uniqueSorted(value.excludedRoots),
    affectedIds: [...new Set(value.affectedIds)].sort(),
    maxListedFiles: value.maxListedFiles,
  };
  return {
    ...payload,
    manifestSha256: sha256(JSON.stringify(payload)),
  };
}

export function assertReadManifestValid(manifest: Stage2ReadManifest): void {
  const expected = finalizeReadManifest({
    entryFiles: manifest.entryFiles,
    allowedRoots: manifest.allowedRoots,
    excludedRoots: manifest.excludedRoots,
    affectedIds: manifest.affectedIds,
    maxListedFiles: manifest.maxListedFiles,
  });
  if (expected.manifestSha256 !== manifest.manifestSha256) {
    throw new Error("Stage2 Read Manifest hash mismatch");
  }
  if (!Number.isInteger(manifest.maxListedFiles) || manifest.maxListedFiles < 1) {
    throw new Error("Stage2 Read Manifest maxListedFiles must be a positive integer");
  }
}

export function manifestAllowsPath(
  manifest: Stage2ReadManifest,
  path: string,
): boolean {
  const normalized = portablePath(path);
  if (isExcluded(manifest, normalized)) {
    return false;
  }
  if (manifest.entryFiles.some((entry) => portablePath(entry) === normalized)) {
    return true;
  }
  return manifest.allowedRoots.some((root) => isWithin(normalized, portablePath(root)));
}

export function manifestAllowsDirectory(
  manifest: Stage2ReadManifest,
  path: string,
): boolean {
  const normalized = portablePath(path);
  if (normalized === "." || normalized === "") {
    return false;
  }
  if (isExcluded(manifest, normalized)) {
    return false;
  }
  return manifest.allowedRoots.some((root) => {
    const allowed = portablePath(root);
    return isWithin(normalized, allowed) || isWithin(allowed, normalized);
  });
}

export function readScopeGap(manifest: Stage2ReadManifest, path: string, reason: string): Error {
  return new Error(
    `read_scope_gap manifest=${manifest.manifestSha256} path=${portablePath(path)} reason=${reason}`,
  );
}

function isExcluded(manifest: Stage2ReadManifest, path: string): boolean {
  return manifest.excludedRoots.some((root) => isWithin(path, portablePath(root)));
}

function isWithin(path: string, root: string): boolean {
  return path === root || path.startsWith(`${root}/`);
}

function uniqueSorted(values: string[]): string[] {
  return [...new Set(values.map(portablePath).filter((value) => value !== "."))].sort();
}

function portablePath(path: string): string {
  return path.replace(/\\/gu, "/").replace(/^\.\//u, "").replace(/\/$/u, "");
}
