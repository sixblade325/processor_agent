import type {
  FactSourceEntry,
  ProjectIntent,
  ProjectProfile,
  ProjectSpecTarget,
  Stage1ProjectSpec,
  Stage1ProjectState,
} from "../types.js";
import { validateProfile } from "../profile.js";

export const PROJECT_SPEC_TARGETS = [
  "intent.goal",
  "intent.useCase",
  "intent.constraints",
  "intent.exclusions",
  "architecture.roles",
  "architecture.systemBoundary",
  "architecture.supportedInstructions",
  "architecture.invariants",
  "architecture.sharedFields",
  "architecture.globalProtocols",
  "architecture.counterRules",
  "verification.referenceModel",
  "verification.layers",
  "verification.requiredScenarios",
  "verification.counters",
  "verification.decisionAcceptance",
  "verification.completionCriteria",
] as const satisfies readonly ProjectSpecTarget[];

const PROJECT_SPEC_TARGET_SET = new Set<string>(PROJECT_SPEC_TARGETS);

export function isProjectSpecTarget(value: string): value is ProjectSpecTarget {
  return PROJECT_SPEC_TARGET_SET.has(value);
}

export function profileProjectSpec(
  profile: ProjectProfile,
  intent: ProjectIntent = {
    goal: profile.defaults.goal,
    useCase: profile.defaults.useCase,
    constraints: [...profile.defaults.constraints],
    exclusions: [...profile.defaults.exclusions],
  },
): Stage1ProjectSpec {
  return structuredClone({
    intent,
    architecture: profile.architecture,
    verification: profile.verification,
  });
}

export function validateProjectSpec(
  spec: Stage1ProjectSpec,
  profile: ProjectProfile,
): Stage1ProjectSpec {
  const intent = validateIntent(spec.intent);
  const normalizedProfile = validateProfile({
    ...structuredClone(profile),
    architecture: spec.architecture,
    verification: spec.verification,
  });
  return {
    intent,
    architecture: normalizedProfile.architecture,
    verification: normalizedProfile.verification,
  };
}

function validateIntent(value: ProjectIntent): ProjectIntent {
  if (typeof value !== "object" || value === null) {
    throw new Error("ProjectSpec intent must be an object");
  }
  if (typeof value.goal !== "string" || typeof value.useCase !== "string") {
    throw new Error("ProjectSpec intent goal and useCase must be strings");
  }
  if (
    !Array.isArray(value.constraints)
    || value.constraints.some((item) => typeof item !== "string")
    || !Array.isArray(value.exclusions)
    || value.exclusions.some((item) => typeof item !== "string")
  ) {
    throw new Error("ProjectSpec intent constraints and exclusions must be string arrays");
  }
  return structuredClone(value);
}

export function effectiveProjectSpec(
  state: Stage1ProjectState,
  profile: ProjectProfile,
): Stage1ProjectSpec {
  if (state.stage1.projectSpec !== undefined && state.stage1.projectSpec.intent !== undefined) {
    return structuredClone(state.stage1.projectSpec);
  }
  const legacyIntent = state.stage1.intent ?? {
    goal: profile.defaults.goal,
    useCase: profile.defaults.useCase,
    constraints: [...profile.defaults.constraints],
    exclusions: [...profile.defaults.exclusions],
  };
  const legacy = state.stage1.projectSpec as unknown as {
    architecture?: ProjectProfile["architecture"];
    verification?: ProjectProfile["verification"];
  } | undefined;
  return structuredClone({
    intent: legacyIntent,
    architecture: legacy?.architecture ?? profile.architecture,
    verification: legacy?.verification ?? profile.verification,
  });
}

export function getProjectSpecTarget(
  spec: Stage1ProjectSpec,
  target: ProjectSpecTarget,
): unknown {
  const [domain, field] = target.split(".") as [keyof Stage1ProjectSpec, string];
  return (spec[domain] as unknown as Record<string, unknown>)[field];
}

export function setProjectSpecTarget(
  spec: Stage1ProjectSpec,
  target: ProjectSpecTarget,
  value: unknown,
): void {
  const [domain, field] = target.split(".") as [keyof Stage1ProjectSpec, string];
  (spec[domain] as unknown as Record<string, unknown>)[field] = value;
}

export function projectSpecTargetArtifact(target: ProjectSpecTarget): string {
  if (target.startsWith("verification.")) {
    return "verification/plan.md";
  }
  return "architecture/overview.md";
}

export function projectSpecTargetSection(target: ProjectSpecTarget): string {
  const sections: Record<ProjectSpecTarget, string> = {
    "intent.goal": "项目意图/目标",
    "intent.useCase": "项目意图/使用场景",
    "intent.constraints": "项目意图/约束",
    "intent.exclusions": "项目意图/排除项",
    "architecture.roles": "架构角色",
    "architecture.systemBoundary": "系统边界",
    "architecture.supportedInstructions": "支持的指令",
    "architecture.invariants": "全局不变量",
    "architecture.sharedFields": "共享字段",
    "architecture.globalProtocols": "全局协议",
    "architecture.counterRules": "性能计数器规则",
    "verification.referenceModel": "参考模型",
    "verification.layers": "验证层级",
    "verification.requiredScenarios": "必测场景",
    "verification.counters": "性能计数器",
    "verification.decisionAcceptance": "决策对应要求",
    "verification.completionCriteria": "Stage2 完成门禁",
  };
  return sections[target];
}

export function architectureRoles(spec: Stage1ProjectSpec): string[] {
  return spec.architecture.roles.map((role) => role.id);
}

export function buildFactSourceIndex(
  state: Stage1ProjectState,
  profile: ProjectProfile,
): FactSourceEntry[] {
  const entries: FactSourceEntry[] = PROJECT_SPEC_TARGETS.map((target) => {
    return {
      factKey: target,
      ownerKind: "project_spec",
      ownerPath: `stage1.projectSpec.${target}`,
      sourceRevisionOrDigest: String(state.stage1.revision),
      renderedLocations: [{
        artifact: projectSpecTargetArtifact(target),
        section: projectSpecTargetSection(target),
      }],
      mutableThrough: "project_spec",
    };
  });
  for (const decision of profile.decisions) {
    entries.push({
      factKey: `decision.${decision.id}`,
      ownerKind: "decision",
      ownerPath: `stage1.decisions.${decision.id}`,
      sourceRevisionOrDigest: String(state.stage1.revision),
      renderedLocations: [
        {
          artifact: "architecture/overview.md",
          section: `架构决策/${decision.id}`,
        },
        {
          artifact: "verification/plan.md",
          section: `决策对应要求/${decision.id}`,
        },
      ],
      mutableThrough: "decision",
    });
  }
  return entries;
}
