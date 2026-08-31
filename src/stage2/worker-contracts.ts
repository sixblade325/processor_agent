import { shellQuote, toWslPath } from "../io.js";
import type {
  CommandResult,
  CommandSpec,
  Stage1ProjectState,
  Stage2DesignProposal,
  Stage2ModuleState,
  Stage2ReviewReport,
  Stage2TaskEnvelope,
  Stage2TopologyDecisionKind,
  Stage2TopologyDecisionSpec,
} from "../types.js";

const PROJECT_READER_INSTRUCTION = `项目文件的枚举、搜索和读取必须使用 processor_project MCP 的 list_files、search_text 和 read_file。不得依赖 Shell、PowerShell、cmd 或交互会话 execpolicy 读取项目证据。`;

export function buildTopologyResearchPrompt(
  envelope: Stage2TaskEnvelope,
  state: Stage1ProjectState,
  instruction: string | undefined,
  skillContext: string,
): string {
  const decision = envelope.topology?.decision;
  if (decision === undefined) {
    throw new Error("Topology Research Task Envelope is missing its Decision");
  }
  return `你是 Stage2 的短生命周期 Topology Research Worker。只为 ${decision.id} 收集证据，不提交拓扑方案，不修改任何文件。

${PROJECT_READER_INSTRUCTION}

读取 AGENTS.md、已批准 Architecture、现有源码、测试和构建组织。每个 fact 必须指向 sources 中的 locator，locations 给出可复查的文件与行号或文档位置。找不到支撑当前决策的证据时，evidenceSufficient 必须为 false，并在 gaps 中说明缺口。不使用聊天记忆替代项目证据。自然语言使用简体中文，最终只输出符合 Schema 的 JSON。

本轮用户调研关注点只用于确定证据搜索范围，不能作为已确认事实或拓扑结论：
${instruction?.trim() || "无。"}

Skill Context：
${skillContext}

Task Envelope：
${JSON.stringify(envelope, null, 2)}

Stage1 Architecture：
${JSON.stringify(state.stage1.projectSpec?.architecture ?? {}, null, 2)}
`;
}

export function buildTopologyPlannerPrompt(
  envelope: Stage2TaskEnvelope,
  state: Stage1ProjectState,
  instruction: string | undefined,
  customConclusion: string | undefined,
  skillContext: string,
): string {
  const topology = envelope.topology;
  if (topology === undefined) {
    throw new Error("Topology Planner Task Envelope is missing its Decision");
  }
  const customRule = customConclusion === undefined
    ? "提供 2 到 3 个可明确选择的候选项，userConclusion 返回 null。"
    : `用户已明确给出结论：${customConclusion}\nuserConclusion 必须逐字返回该结论，options 只能包含一个 id=custom 的结构化选项，recommendation 必须为 custom。`;
  return `你是 Stage2 Topology Planner。本轮只处理 ${topology.decision.id} ${topology.decision.topic}，不修改文件，不实现 RTL，不替用户批准。

${PROJECT_READER_INSTRUCTION}

严格使用 Task Envelope 中已确认结论和当前 Plan。researchPolicy=required 时只能基于 envelope.topology.evidence 形成候选。每个 option.patch 只允许修改当前 Decision kind 对应的结构切片，不得提前闭合后续 Decision。${customRule}

对每个候选记录收益、成本、风险、不采用后果，以及受影响 Unit、Interface、路径和 DAG edge。存在无法安全做出选择的信息缺口时写入 openQuestions，Harness 将拒绝提交。自然语言使用简体中文，最终只输出符合 Schema 的 JSON。

Skill Context：
${skillContext}

Task Envelope：
${JSON.stringify(envelope, null, 2)}

Stage1 Architecture：
${JSON.stringify(state.stage1.projectSpec?.architecture ?? {}, null, 2)}

本轮用户指令：
${instruction?.trim() || "无。"}
`;
}

export function buildShadowPrompt(
  envelope: Stage2TaskEnvelope,
  module: Stage2ModuleState,
  instruction?: string,
  skillContext?: string,
): string {
  return `你是 Stage2 Shadow Align。只负责闭合 ${module.id} 的模块 Design，不修改任何文件，不实现 RTL。

${PROJECT_READER_INSTRUCTION}

读取 AGENTS.md、Task Envelope 中列出的 Architecture 文档、相关源码和测试。区分已批准事实、当前源码和提议行为。闭合接口、字段、生产者、存储点、消费者、有效期、事件、同拍优先级、周期边界、stall、flush、kill、retry、late response、reset、所有权、复用、不变量、实现路径和验收条件。architectureReferences 和 sourceReferences 的每一项只能填写项目内实际存在的相对路径，不得附加状态、哈希或说明；没有源码引用时返回空数组。

不得改变 Stage1 的 ISA、全局流水边界、Architecture Role 语义和共享协议。不能闭合的正确性或接口问题进入 openQuestions。verification commands 必须可由 Harness 直接执行。host command 填写 command 和 args，script 填空字符串；WSL command 填写 script 并使用 {{projectWslPath}} 占位符，command 填空字符串且 args 填空数组。自然语言使用简体中文。最终只输出符合 Schema 的 JSON。

Task Envelope 的角色、权限、产物和门禁优先于 Skill 中的通用工作流建议。

Skill Context：
${skillContext ?? "无"}

Task Envelope：
${JSON.stringify(envelope, null, 2)}

Unit Architecture Context：
${JSON.stringify(module.architecture, null, 2)}

本轮用户修订指令：
${instruction?.trim() || "首次闭合，无附加修订指令。"}
`;
}

export function buildImplementationPrompt(
  envelope: Stage2TaskEnvelope,
  design: Stage2DesignProposal,
  skillContext: string,
): string {
  return `你是 Stage2 Active Coding。已批准 Design 对你只读。读取 AGENTS.md、Architecture、Design、现有源码和测试，形成最小 Chisel 实现提案。

${PROJECT_READER_INSTRUCTION}

你没有项目写权限。files 必须给出允许路径中文件的完整内容。已有文件的 baseSha256 填当前内容 SHA-256，新文件填 null。不得返回允许范围外的路径，不得修改 Architecture、Design 或 .assistant。发现 Design 缺口时 files 必须为空，并填写 designGap 的原因和具体反例。不得自行增加协议、状态、流水级、tag、generation 或扩大串行化。自然语言使用简体中文。最终只输出符合 Schema 的 JSON。

Task Envelope 的角色、权限、产物和门禁优先于 Skill 中的通用工作流建议。

Skill Context：
${skillContext}

Task Envelope：
${JSON.stringify(envelope, null, 2)}

Approved Design：
${JSON.stringify(design, null, 2)}
`;
}

export function buildReviewPrompt(
  envelope: Stage2TaskEnvelope,
  module: Stage2ModuleState,
  kind: Stage2ReviewReport["kind"],
  commandResults: CommandResult[],
  skillContext: string,
): string {
  return `你是 Stage2 ${kind === "static" ? "Static Review" : "Verification Review"} 执行者。读取 AGENTS.md、已批准 Design、当前实现和测试。不得修改文件。

${PROJECT_READER_INSTRUCTION}

静态审查检查 Architecture 与 Design 一致性、Chisel 语义、状态更新优先级、边界条件、越权改动和测试缺口，commandResults 返回空数组。验证审查检查 Harness 提供的命令证据、定向场景、断言和失败可复现性，并原样保留 commandResults 的 id 顺序和 ok 结果。存在 correctness error 时 verdict 必须为 fail。自然语言使用简体中文。最终只输出符合 Schema 的 JSON。

Task Envelope 的角色、权限、产物和门禁优先于 Skill 中的通用工作流建议。

Skill Context：
${skillContext}

Task Envelope：
${JSON.stringify(envelope, null, 2)}

Module State：
${JSON.stringify(module, null, 2)}

Harness Command Evidence：
${JSON.stringify(commandResults, null, 2)}
`;
}

export function buildIndependentVerificationPrompt(
  envelope: Stage2TaskEnvelope,
  module: Stage2ModuleState,
  commands: CommandSpec[],
  verificationWorkspace: string,
  skillContext: string,
): string {
  const wslWorkspace = shellQuote(toWslPath(verificationWorkspace));
  const executableCommands = commands.map((command) => {
    if (command.runner === "host") {
      return {
        ...command,
        executable: [command.command, ...(command.args ?? [])].join(" "),
      };
    }
    const script = (command.script ?? "").replace(/\{\{projectWslPath\}\}/gu, wslWorkspace);
    return {
      ...command,
      executable: `wsl.exe -e bash -lc ${JSON.stringify(script)}`,
    };
  });
  return `你是独立 Stage2 Verification Worker。当前目录是正式项目的隔离副本。你可以写构建缓存和测试输出，不得修改 Architecture、Design、源码或测试。

项目文件的枚举、搜索和读取使用 processor_project MCP。Shell 只用于执行下方 Approved Commands。

逐项执行下方 executable 命令。记录每项 id、description、runner、实际 command、required、ok、exitCode、output 和 checkedAt。检查测试是否覆盖 Design 验收条件。任何 required command 失败时 verdict 必须为 fail。自然语言使用简体中文。最终只输出符合 Schema 的 JSON。

Task Envelope 的角色、权限、产物和门禁优先于 Skill 中的通用工作流建议。

Skill Context：
${skillContext}

Task Envelope：
${JSON.stringify(envelope, null, 2)}

Module State：
${JSON.stringify(module, null, 2)}

Approved Commands：
${JSON.stringify(executableCommands, null, 2)}
`;
}

export function topologyResearchSchema(decisionId: string): object {
  const stringArray = { type: "array", items: { type: "string" } };
  return {
    type: "object",
    additionalProperties: false,
    required: [
      "schemaVersion",
      "decisionId",
      "sources",
      "facts",
      "conflicts",
      "gaps",
      "evidenceSufficient",
      "stopReason",
    ],
    properties: {
      schemaVersion: { type: "integer", enum: [1] },
      decisionId: { type: "string", enum: [decisionId] },
      sources: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["kind", "locator", "revision", "accessedAt", "locations"],
          properties: {
            kind: { type: "string", enum: ["project", "url", "repository", "paper", "other"] },
            locator: { type: "string" },
            revision: { type: "string" },
            accessedAt: { type: "string" },
            locations: stringArray,
          },
        },
      },
      facts: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["claim", "source", "confidence"],
          properties: {
            claim: { type: "string" },
            source: { type: "string" },
            confidence: { type: "string", enum: ["low", "medium", "high"] },
          },
        },
      },
      conflicts: stringArray,
      gaps: stringArray,
      evidenceSufficient: { type: "boolean" },
      stopReason: { type: "string" },
    },
  };
}

export function topologyProposalSchema(
  decision: Stage2TopologyDecisionSpec,
  customConclusion: string | undefined,
): object {
  const stringArray = { type: "array", items: { type: "string" } };
  const required = [
    "schemaVersion",
    "decisionId",
    "kind",
    "summary",
    "architectureFacts",
    "sourceEvidence",
    "unknowns",
    "options",
    "recommendation",
    "rationale",
    "openQuestions",
    "affectedDecisions",
    "userConclusion",
  ];
  return {
    type: "object",
    additionalProperties: false,
    required,
    properties: {
      schemaVersion: { type: "integer", enum: [1] },
      decisionId: { type: "string", enum: [decision.id] },
      kind: { type: "string", enum: [decision.kind] },
      summary: { type: "string" },
      architectureFacts: stringArray,
      sourceEvidence: stringArray,
      unknowns: stringArray,
      options: {
        type: "array",
        minItems: customConclusion === undefined ? 2 : 1,
        maxItems: customConclusion === undefined ? 3 : 1,
        items: {
          type: "object",
          additionalProperties: false,
          required: [
            "id",
            "label",
            "summary",
            "benefits",
            "costs",
            "risks",
            "notChoosingConsequences",
            "affectedUnits",
            "affectedInterfaces",
            "affectedSourcePaths",
            "affectedDagEdges",
            "patch",
          ],
          properties: {
            id: customConclusion === undefined ? { type: "string" } : { type: "string", enum: ["custom"] },
            label: { type: "string" },
            summary: { type: "string" },
            benefits: stringArray,
            costs: stringArray,
            risks: stringArray,
            notChoosingConsequences: stringArray,
            affectedUnits: stringArray,
            affectedInterfaces: stringArray,
            affectedSourcePaths: stringArray,
            affectedDagEdges: stringArray,
            patch: topologyPatchSchema(decision.kind),
          },
        },
      },
      recommendation: customConclusion === undefined
        ? { type: "string" }
        : { type: "string", enum: ["custom"] },
      rationale: stringArray,
      openQuestions: stringArray,
      affectedDecisions: stringArray,
      userConclusion: customConclusion === undefined
        ? { type: ["string", "null"] }
        : { type: "string", enum: [customConclusion] },
    },
  };
}

function topologyPatchSchema(kind: Stage2TopologyDecisionKind): object {
  const stringArray = { type: "array", items: { type: "string" } };
  const item = (required: string[], properties: Record<string, object>): object => ({
    type: "object",
    additionalProperties: false,
    required,
    properties,
  });
  if (kind === "unit_mapping") {
    return topologyPatchListSchema(kind, "units", item(
      ["id", "kind", "architectureRoles", "responsibility", "rationale"],
      {
        id: topologyIdSchema(),
        kind: { type: "string", enum: ["implementation", "shared"] },
        architectureRoles: stringArray,
        responsibility: { type: "string" },
        rationale: { type: "string" },
      },
    ));
  }
  if (kind === "shared_ownership") {
    return topologyPatchListSchema(kind, "sharedArtifacts", item(
      ["id", "kind", "ownerUnit", "consumerUnits", "sourcePaths", "rationale"],
      {
        id: topologyIdSchema(),
        kind: { type: "string", enum: ["bundle", "payload", "config", "utility", "integration", "other"] },
        ownerUnit: topologyIdSchema(),
        consumerUnits: stringArray,
        sourcePaths: topologyPathArraySchema(),
        rationale: { type: "string" },
      },
    ));
  }
  if (kind === "interface_ownership") {
    return topologyPatchListSchema(kind, "interfaces", item(
      ["id", "ownerUnit", "producerUnits", "consumerUnits", "fields", "boundary", "timing"],
      {
        id: topologyIdSchema(),
        ownerUnit: topologyIdSchema(),
        producerUnits: stringArray,
        consumerUnits: stringArray,
        fields: stringArray,
        boundary: { type: "string" },
        timing: { type: "string" },
      },
    ));
  }
  if (kind === "source_topology") {
    return topologyPatchListSchema(kind, "units", item(
      ["id", "packageName", "designPath", "sourcePaths", "testPaths", "integrationPaths"],
      {
        id: topologyIdSchema(),
        packageName: { type: "string" },
        designPath: topologyPathSchema(),
        sourcePaths: topologyPathArraySchema(),
        testPaths: topologyPathArraySchema(),
        integrationPaths: topologyPathArraySchema(),
      },
    ));
  }
  if (kind === "unit_dag") {
    return topologyPatchListSchema(kind, "units", item(
      ["id", "dependsOn", "integrationConsumers"],
      { id: topologyIdSchema(), dependsOn: stringArray, integrationConsumers: stringArray },
    ));
  }
  return topologyPatchListSchema(kind, "units", item(
    ["id", "completionCriteria", "verificationResponsibility"],
    {
      id: topologyIdSchema(),
      completionCriteria: stringArray,
      verificationResponsibility: { type: "string" },
    },
  ));
}

function topologyPatchListSchema(kind: string, field: string, item: object): object {
  return {
    type: "object",
    additionalProperties: false,
    required: ["kind", field],
    properties: {
      kind: { type: "string", enum: [kind] },
      [field]: { type: "array", items: item },
    },
  };
}

function topologyIdSchema(): object {
  return { type: "string", pattern: "^[a-z][a-z0-9_]*$" };
}

function topologyPathSchema(): object {
  return { type: "string", pattern: "^[A-Za-z0-9_. -]+(?:/[A-Za-z0-9_. -]+)*$" };
}

function topologyPathArraySchema(): object {
  return { type: "array", items: topologyPathSchema() };
}

export function designSchema(moduleId: string): object {
  const stringArray = { type: "array", items: { type: "string" } };
  const pathArray = {
    type: "array",
    items: {
      type: "string",
      pattern: "^[A-Za-z0-9_. -]+(?:/[A-Za-z0-9_. -]+)*$",
    },
  };
  return {
    type: "object",
    additionalProperties: false,
    required: [
      "schemaVersion", "moduleId", "summary", "architectureReferences", "sourceReferences",
      "explicitExclusions", "interfaces", "fields", "events", "cycleBehavior",
      "exceptionalBehavior", "invariants", "sharedInterfaceChanges", "affectedModules",
      "implementation", "acceptance", "risks", "openQuestions",
    ],
    properties: {
      schemaVersion: { type: "integer", enum: [1] },
      moduleId: { type: "string", enum: [moduleId] },
      summary: { type: "string" },
      architectureReferences: pathArray,
      sourceReferences: pathArray,
      explicitExclusions: stringArray,
      interfaces: stringArray,
      fields: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["name", "semantics", "producer", "storage", "consumers", "lifetime"],
          properties: {
            name: { type: "string" },
            semantics: { type: "string" },
            producer: { type: "string" },
            storage: { type: "string" },
            consumers: stringArray,
            lifetime: { type: "string" },
          },
        },
      },
      events: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["name", "condition", "effects", "priority"],
          properties: {
            name: { type: "string" },
            condition: { type: "string" },
            effects: stringArray,
            priority: { type: "string" },
          },
        },
      },
      cycleBehavior: stringArray,
      exceptionalBehavior: stringArray,
      invariants: stringArray,
      sharedInterfaceChanges: stringArray,
      affectedModules: stringArray,
      implementation: {
        type: "object",
        additionalProperties: false,
        required: ["sourcePaths", "testPaths"],
        properties: { sourcePaths: pathArray, testPaths: pathArray },
      },
      acceptance: {
        type: "object",
        additionalProperties: false,
        required: ["assertions", "directedTests", "commands", "expectedResults"],
        properties: {
          assertions: stringArray,
          directedTests: stringArray,
          commands: { type: "array", items: commandSpecSchema() },
          expectedResults: stringArray,
        },
      },
      risks: stringArray,
      openQuestions: stringArray,
    },
  };
}

export function implementationSchema(moduleId: string, designSha256: string): object {
  return {
    type: "object",
    additionalProperties: false,
    required: ["schemaVersion", "moduleId", "designSha256", "summary", "files", "notes", "designGap"],
    properties: {
      schemaVersion: { type: "integer", enum: [1] },
      moduleId: { type: "string", enum: [moduleId] },
      designSha256: { type: "string", enum: [designSha256] },
      summary: { type: "string" },
      files: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["path", "kind", "baseSha256", "content", "purpose"],
          properties: {
            path: { type: "string" },
            kind: { type: "string", enum: ["source", "test"] },
            baseSha256: { type: ["string", "null"] },
            content: { type: "string" },
            purpose: { type: "string" },
          },
        },
      },
      notes: { type: "array", items: { type: "string" } },
      designGap: {
        anyOf: [
          { type: "null" },
          {
            type: "object",
            additionalProperties: false,
            required: ["reason", "counterexample"],
            properties: { reason: { type: "string" }, counterexample: { type: "string" } },
          },
        ],
      },
    },
  };
}

export function reviewSchema(
  moduleId: string,
  designSha256: string,
  implementationSha256: string,
  kind: Stage2ReviewReport["kind"],
): object {
  return {
    type: "object",
    additionalProperties: false,
    required: [
      "schemaVersion", "kind", "moduleId", "designSha256", "implementationAggregateSha256",
      "verdict", "summary", "findings", "commandResults",
    ],
    properties: {
      schemaVersion: { type: "integer", enum: [1] },
      kind: { type: "string", enum: [kind] },
      moduleId: { type: "string", enum: [moduleId] },
      designSha256: { type: "string", enum: [designSha256] },
      implementationAggregateSha256: { type: "string", enum: [implementationSha256] },
      verdict: { type: "string", enum: ["pass", "fail"] },
      summary: { type: "string" },
      findings: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["severity", "code", "message", "artifact", "requiredAction"],
          properties: {
            severity: { type: "string", enum: ["error", "warning", "note"] },
            code: { type: "string" },
            message: { type: "string" },
            artifact: { type: "string" },
            requiredAction: { type: "string" },
          },
        },
      },
      commandResults: { type: "array", items: commandResultSchema() },
    },
  };
}

function commandSpecSchema(): object {
  return {
    type: "object",
    additionalProperties: false,
    required: ["id", "description", "runner", "command", "args", "script", "required"],
    properties: {
      id: { type: "string" },
      description: { type: "string" },
      runner: { type: "string", enum: ["host", "wsl"] },
      command: { type: "string" },
      args: { type: "array", items: { type: "string" } },
      script: { type: "string" },
      required: { type: "boolean" },
    },
  };
}

function commandResultSchema(): object {
  return {
    type: "object",
    additionalProperties: false,
    required: [
      "id", "description", "runner", "command", "required", "ok", "exitCode", "output", "checkedAt",
    ],
    properties: {
      id: { type: "string" },
      description: { type: "string" },
      runner: { type: "string", enum: ["host", "wsl"] },
      command: { type: "string" },
      required: { type: "boolean" },
      ok: { type: "boolean" },
      exitCode: { type: ["integer", "null"] },
      output: { type: "string" },
      checkedAt: { type: "string" },
    },
  };
}
