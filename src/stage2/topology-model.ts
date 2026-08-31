import { architectureRoles } from "../stage1/project-spec.js";
import type {
  Stage1ProjectSpec,
  Stage2ImplementationPlan,
  Stage2ImplementationUnitPlan,
  Stage2UnitArchitectureContext,
} from "../types.js";

export function requiredArchitectureRoles(spec: Stage1ProjectSpec): string[] {
  return architectureRoles(spec);
}

export function validateArchitectureRoleMapping(
  spec: Stage1ProjectSpec,
  units: Stage2ImplementationUnitPlan[],
): string[] {
  const required = new Set(requiredArchitectureRoles(spec));
  const mapped = new Map<string, string>();
  const issues: string[] = [];
  for (const unit of units) {
    if (unit.kind === "implementation" && unit.architectureRoles.length === 0) {
      issues.push(`Implementation Unit ${unit.id} must map at least one Architecture Role`);
    }
    if (unit.kind === "shared" && unit.architectureRoles.length > 0) {
      issues.push(`Shared Unit ${unit.id} cannot claim Architecture Roles`);
    }
    for (const role of unit.architectureRoles) {
      if (!required.has(role)) {
        issues.push(`Unit ${unit.id} maps unknown Architecture Role ${role}`);
      }
      const existing = mapped.get(role);
      if (existing !== undefined) {
        issues.push(`Architecture Role ${role} is mapped to ${existing} and ${unit.id}`);
      }
      mapped.set(role, unit.id);
    }
  }
  for (const role of required) {
    if (!mapped.has(role)) {
      issues.push(`Architecture Role ${role} has no implementation owner`);
    }
  }
  return issues;
}

export function buildUnitArchitectureContext(
  spec: Stage1ProjectSpec,
  plan: Stage2ImplementationPlan,
  unit: Stage2ImplementationUnitPlan,
): Stage2UnitArchitectureContext {
  const roles = new Set(unit.architectureRoles);
  const interfaces = plan.interfaces
    .filter((contract) =>
      contract.ownerUnit === unit.id
      || contract.producerUnits.includes(unit.id)
      || contract.consumerUnits.includes(unit.id)
    )
    .map((contract) => contract.id);
  return {
    id: unit.id,
    architectureRoles: [...unit.architectureRoles],
    responsibility: unit.responsibility,
    dependsOn: [...unit.dependsOn],
    interfaces,
    systemBoundary: [...spec.architecture.systemBoundary],
    invariants: [...spec.architecture.invariants],
    sharedFields: structuredClone(spec.architecture.sharedFields.filter((field) =>
      roles.has(field.producer) || field.consumers.some((consumer) => roles.has(consumer))
    )),
    globalProtocols: structuredClone(spec.architecture.globalProtocols.filter((protocol) =>
      [
        protocol.ownerRole,
        ...protocol.producerRoles,
        ...protocol.consumerRoles,
      ].some((role) => roles.has(role))
    )),
  };
}
