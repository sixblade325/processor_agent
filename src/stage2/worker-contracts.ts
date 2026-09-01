import { shellQuote, toWslPath } from "../io.js";
import type {
  CommandResult,
  CommandSpec,
  Stage1ProjectState,
  Stage2DesignProposal,
  Stage2DesignRevisionIssue,
  Stage2ModuleState,
  Stage2ReviewReport,
  Stage2TaskEnvelope,
  Stage2TopologyDecisionKind,
  Stage2TopologyDecisionSpec,
  Stage2PackageDesignProposal,
  Stage2PackageReviewReport,
  Stage2WorkspaceTaskEnvelope,
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

export function buildSystemDesignDraftPrompt(
  envelope: Stage2WorkspaceTaskEnvelope,
  state: Stage1ProjectState,
  instruction: string | undefined,
  skillContext: string,
): string {
  return `你是 Stage2 System Design Agent A。读取当前已批准 Architecture、项目规则、已有源码骨架和验证材料，形成一份整核 System Design Draft。只输出结构化提案，不修改项目文件，不替用户批准。

${PROJECT_READER_INSTRUCTION}

System Design 必须完成以下内容：
1. 使用可选 parentId 表达 Design Component 的唯一设计归属层次。parentId 不表达 Chisel 实例化、数据依赖或 Work Package 归属。
2. 每个 Architecture Role 至少映射到一个 Component，每个 Component 只属于一个 Work Package。
3. Interface 只闭合跨 Component 的 owner、生产者、消费者、字段骨架和时序边界。Package 内部精确信号留给 Package Design。
4. Work Package 是 Agent 的 Design、实现、路径权限和验证单位。allowedSourcePaths 与 allowedTestPaths 必须逐项填写精确项目相对文件路径，禁止目录和通配符。源码与测试路径必须有唯一 owner。designDependsOn、implementationDependsOn 与 integrationDependsOn 分别表达 Design、源码实施和集成验证依赖，三组依赖都必须无环。
5. decisionRequests 只允许用于改变 Architecture Role、流水寄存边界、全局跨周期状态、identity/replay、stall/flush/kill/serialization 范围、跨 Package Interface、重大工程取舍或 Stage1 Rework 的问题。命名、helper、普通 Bundle 组织和局部代码布局不得打断用户。
6. 旧 S2_TOP 结论和旧 Unit 只作为候选证据。重新划分 Component 与 Work Package，不能继承旧批准。
7. 缺少待设计的 Bundle、源码或测试不构成 Research blocker。基于 Architecture 先闭合可实现设计。
8. Task Envelope 的 revisionRequest.kind 为 approved_reopen 时，affectedWorkPackages 是本轮唯一允许重新对齐的 Package 集合。集合外的 Work Package plan 必须逐字段保持当前批准值和原顺序，不得改写 acceptance、依赖、路径、Component 归属或 designPath。只读消费者关系修订不得扩大 Bundle ABI、生产者或外部行为。

顶层 Component 的 parentId 使用 null，子 Component 使用父 Component id。architectureReferences 只能填写实际存在的项目相对文件路径，不附加注释、哈希或描述。所有 id 使用 lower_snake_case。自然语言使用简体中文。最终只输出符合 Schema 的 JSON。

Skill Context：
${skillContext}

Task Envelope：
${JSON.stringify(envelope, null, 2)}

Stage1 ProjectSpec：
${JSON.stringify(state.stage1.projectSpec ?? {}, null, 2)}

本轮用户修订指令：
${instruction?.trim() || "首次生成，无附加指令。"}
`;
}

export function buildSystemDesignReviewPrompt(
  envelope: Stage2WorkspaceTaskEnvelope,
  designSha256: string,
  skillContext: string,
): string {
  return `你是 Stage2 System Design Agent B，执行只读独立审查。检查 Architecture Fidelity、Component 层次、状态 owner、跨 Package Interface、路径唯一 owner、实施依赖、验证覆盖和用户决策遗漏。Task Envelope 存在 revisionRequest 时，必须逐项检查当前 Proposal 是否落实该用户修订要求，遗漏或冲突必须形成 error finding。不得修改文件，不得直接重写方案，不得替用户批准。

${PROJECT_READER_INSTRUCTION}

审查对象是磁盘中当前未批准的 design/plan.md，哈希为 ${designSha256}。Task Envelope 中的 proposal 与该文件是同一冻结草案。error finding 必须给出具体缺口、涉及产物和恢复动作。revisionRequest.kind 为 approved_reopen 时，必须检查 affectedWorkPackages 之外的 Work Package plan 保持当前批准值和顺序。legacyEvidence 只提供历史候选和问题索引，不具有当前 approval 权威，不能仅因新草案偏离旧 S2_TOP、旧 Unit 或旧 Plan 而报告 error。草案必须在每个开放 DecisionRequest 的 recommendation 下内部一致；备选项可能改变 Component、Interface 或 Work Package，由用户回答后触发新草案。不得仅因存在这种备选项报告 error。新增 decisionRequests 只允许覆盖高风险用户决策类别。可由 Agent 在 Package Design 中闭合的问题写 finding，不生成用户 DecisionRequest。最终只输出符合 Schema 的 JSON。

Skill Context：
${skillContext}

Task Envelope：
${JSON.stringify(envelope, null, 2)}
`;
}

export function buildPackageDesignPrompt(
  envelope: Stage2WorkspaceTaskEnvelope,
  instruction: string | undefined,
  skillContext: string,
): string {
  const workPackage = envelope.workPackage?.plan;
  if (workPackage === undefined) {
    throw new Error("Package Design Task Envelope is missing a Work Package");
  }
  return `你是 Stage2 Shadow Agent。只闭合 Work Package ${workPackage.id} 的 Package Design，不修改文件，不实现 RTL，不改变已批准 System Design。

${PROJECT_READER_INSTRUCTION}

读取 AGENTS.md、Architecture、System Design、批准的上游 Package Design、相关源码和测试。闭合接口字段、生产者、寄存边界、消费者、状态生命周期、同拍优先级、stall、flush、redirect、kill、retry、late response、reset、复用、不变量、组合路径、断言、定向测试和可执行命令。

implementation 路径必须完整等于 Work Package 已批准路径。architectureReferences 和 sourceReferences 只能包含实际存在的项目相对路径。sharedInterfaceChanges 只记录相对当前已批准 System Design 的新增偏差。复述、细化或实现 System Design 已批准的 Interface owner、生产者、消费者、字段和时序关系不属于变化，此时 sharedInterfaceChanges 必须为 []，没有新偏差时 affectedWorkPackages 也必须为 []。decisionRequests 只用于高风险用户决策；局部实现选择由你写入 Design。存在普通待设计问题时继续闭合，无法闭合的正确性缺口进入 openQuestions。自然语言使用简体中文，最终只输出符合 Schema 的 JSON。

Skill Context：
${skillContext}

Task Envelope：
${JSON.stringify(envelope, null, 2)}

本轮用户修订指令：
${instruction?.trim() || "首次闭合，无附加指令。"}
`;
}

export function buildPackageDesignPatchPrompt(
  envelope: Stage2WorkspaceTaskEnvelope,
  proposal: Stage2PackageDesignProposal,
  issues: Stage2DesignRevisionIssue[],
  baseProposalSha256: string,
  instruction: string | undefined,
  skillContext: string,
): string {
  return `你是 Stage2 Shadow Agent 的局部修订任务。只修复 issues 指定字段，返回 RFC 6902 风格的有限 Patch，不重写完整 Package Design，不修改项目文件，不改变已批准 System Design。

${PROJECT_READER_INSTRUCTION}

每个 operation.target 必须严格等于 issues 中 repairClass=local_patch 的 target。baseProposalSha256 必须原样返回。remove 操作的 value 使用 null。修订后应消除对应问题，保留未涉及字段。无法在允许字段内闭合时返回空 operations，由 Harness 保持原草案。自然语言使用简体中文，最终只输出符合 Schema 的 JSON。

Skill Context：
${skillContext}

Task Envelope：
${JSON.stringify(envelope, null, 2)}

Base Proposal SHA-256：${baseProposalSha256}

Issues：
${JSON.stringify(issues, null, 2)}

Base Proposal：
${JSON.stringify(proposal, null, 2)}

本轮用户修订指令：
${instruction?.trim() || "按结构化 issues 局部闭合。"}
`;
}

export function buildPackageImplementationPrompt(
  envelope: Stage2WorkspaceTaskEnvelope,
  design: Stage2PackageDesignProposal,
  skillContext: string,
): string {
  return `你是 Stage2 Active Agent。已批准的 System Design 和 Package Design 对你只读。读取项目证据后形成最小 Chisel 实现提案。

${PROJECT_READER_INSTRUCTION}

你没有项目写权限。files 必须给出允许路径中文件的完整内容。已有文件的 baseSha256 使用当前内容 SHA-256，新文件使用 null。不得返回允许范围外的路径，不得修改 Architecture、Design 或 .assistant。发现 Design 缺口时 files 必须为空，并填写 designGap 的原因和具体反例。不得自行增加协议、状态、流水级、tag、generation 或扩大串行化。自然语言使用简体中文，最终只输出符合 Schema 的 JSON。

Skill Context：
${skillContext}

Task Envelope：
${JSON.stringify(envelope, null, 2)}

Approved Package Design：
${JSON.stringify(design, null, 2)}
`;
}

export function buildPackageStaticReviewPrompt(
  envelope: Stage2WorkspaceTaskEnvelope,
  design: Stage2PackageDesignProposal,
  implementationSha256: string,
  skillContext: string,
): string {
  return `你是短生命周期 Static Review Worker。使用冻结版本执行只读 Architecture Fidelity 与 Design 实现一致性审查，不运行命令，不修改任何文件，不读取另一个 Verification Worker 的输出。

${PROJECT_READER_INSTRUCTION}

Task Envelope 的 readManifest.entryFiles 和 readManifest.allowedRoots 是完整审查范围。项目根目录枚举被有意禁止，不构成审查缺口。使用精确入口文件和获准目录检查当前 Package，不要求扩大到其他 Work Package。

检查接口、字段、状态生命周期、同拍优先级、禁止行为、路径权限、无关 diff、断言和测试遗漏。实现聚合哈希为 ${implementationSha256}。最终只输出符合 Schema 的 JSON。

Skill Context：
${skillContext}

Task Envelope：
${JSON.stringify(envelope, null, 2)}

Approved Package Design：
${JSON.stringify(design, null, 2)}
`;
}

export function buildPackageVerificationPrompt(
  envelope: Stage2WorkspaceTaskEnvelope,
  design: Stage2PackageDesignProposal,
  verificationWorkspace: string,
  commandResults: CommandResult[],
  skillContext: string,
): string {
  return `你是短生命周期 Verification Worker。冻结副本位于 ${verificationWorkspace}。批准命令已经由 Harness 在该冻结副本中执行。你只读审查源码、测试和 Harness Command Evidence，不调用 Shell，不修改任何文件，不读取 Static Review Worker 输出。

Task Envelope 的 readManifest.entryFiles 和 readManifest.allowedRoots 是完整审查范围。项目根目录枚举被有意禁止，不构成验证缺口。使用精确入口文件和获准目录检查当前 Package，不要求扩大到其他 Work Package。

commandResults 必须逐项原样回传 Harness Command Evidence，保留 id、description、runner、command、required、ok、exitCode、output 和 checkedAt。不得省略、改写或追加命令。结合批准的 Package Design 判断命令覆盖、失败含义和验证缺口。最终只输出符合 Schema 的 JSON。

Harness Command Evidence：
${JSON.stringify(commandResults, null, 2)}

Skill Context：
${skillContext}

Task Envelope：
${JSON.stringify(envelope, null, 2)}

Approved Package Design：
${JSON.stringify(design, null, 2)}
`;
}

export function systemDesignSchema(): object {
  return {
    type: "object",
    additionalProperties: false,
    required: [
      "schemaVersion", "summary", "architectureReferences", "components", "interfaces",
      "workPackages", "globalInvariants", "acceptancePlan", "decisionRequests", "risks",
    ],
    properties: {
      schemaVersion: { type: "integer", enum: [1] },
      summary: { type: "string" },
      architectureReferences: projectPathArraySchema(),
      components: {
        type: "array",
        minItems: 1,
        items: {
          type: "object",
          additionalProperties: false,
          required: [
            "id", "parentId", "architectureRoles", "responsibility", "stateOwnership", "interfaceIds",
          ],
          properties: {
            id: lowerSnakeIdSchema(),
            parentId: {
              anyOf: [lowerSnakeIdSchema(), { type: "null" }],
            },
            architectureRoles: stringArraySchema(),
            responsibility: { type: "string" },
            stateOwnership: stringArraySchema(),
            interfaceIds: stringArraySchema(),
          },
        },
      },
      interfaces: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: [
            "id", "ownerComponentId", "producerComponentIds", "consumerComponentIds",
            "fields", "boundary", "timing",
          ],
          properties: {
            id: lowerSnakeIdSchema(),
            ownerComponentId: lowerSnakeIdSchema(),
            producerComponentIds: stringArraySchema(),
            consumerComponentIds: stringArraySchema(),
            fields: stringArraySchema(),
            boundary: { type: "string" },
            timing: { type: "string" },
          },
        },
      },
      workPackages: {
        type: "array",
        minItems: 1,
        items: {
          type: "object",
          additionalProperties: false,
          required: [
            "id", "componentIds", "designDependsOn", "implementationDependsOn",
            "integrationDependsOn", "allowedSourcePaths", "allowedTestPaths", "designPath",
            "acceptance",
          ],
          properties: {
            id: lowerSnakeIdSchema(),
            componentIds: stringArraySchema(),
            designDependsOn: stringArraySchema(),
            implementationDependsOn: stringArraySchema(),
            integrationDependsOn: stringArraySchema(),
            allowedSourcePaths: projectPathArraySchema(),
            allowedTestPaths: projectPathArraySchema(),
            designPath: { type: "string" },
            acceptance: stringArraySchema(),
          },
        },
      },
      globalInvariants: stringArraySchema(),
      acceptancePlan: stringArraySchema(),
      decisionRequests: { type: "array", items: decisionRequestSchema() },
      risks: stringArraySchema(),
    },
  };
}

export function systemDesignReviewSchema(designSha256: string): object {
  return {
    type: "object",
    additionalProperties: false,
    required: [
      "schemaVersion", "systemDesignSha256", "verdict", "summary", "findings", "decisionRequests",
    ],
    properties: {
      schemaVersion: { type: "integer", enum: [1] },
      systemDesignSha256: { type: "string", enum: [designSha256] },
      verdict: { type: "string", enum: ["pass", "fail"] },
      summary: { type: "string" },
      findings: findingArraySchema(),
      decisionRequests: { type: "array", items: decisionRequestSchema() },
    },
  };
}

export function packageDesignSchema(workPackageId: string): object {
  return {
    type: "object",
    additionalProperties: false,
    required: [
      "schemaVersion", "workPackageId", "componentIds", "summary", "architectureReferences",
      "sourceReferences", "explicitExclusions", "interfaces", "fields", "events", "cycleBehavior",
      "exceptionalBehavior", "invariants", "sharedInterfaceChanges", "affectedWorkPackages",
      "implementation", "acceptance", "decisionRequests", "risks", "openQuestions",
    ],
    properties: {
      schemaVersion: { type: "integer", enum: [1] },
      workPackageId: { type: "string", enum: [workPackageId] },
      componentIds: stringArraySchema(),
      summary: { type: "string" },
      architectureReferences: projectPathArraySchema(),
      sourceReferences: projectPathArraySchema(),
      explicitExclusions: stringArraySchema(),
      interfaces: stringArraySchema(),
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
            consumers: stringArraySchema(),
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
            effects: stringArraySchema(),
            priority: { type: "string" },
          },
        },
      },
      cycleBehavior: stringArraySchema(),
      exceptionalBehavior: stringArraySchema(),
      invariants: stringArraySchema(),
      sharedInterfaceChanges: stringArraySchema(),
      affectedWorkPackages: stringArraySchema(),
      implementation: {
        type: "object",
        additionalProperties: false,
        required: ["sourcePaths", "testPaths"],
        properties: {
          sourcePaths: projectPathArraySchema(),
          testPaths: projectPathArraySchema(),
        },
      },
      acceptance: {
        type: "object",
        additionalProperties: false,
        required: ["assertions", "directedTests", "commands", "expectedResults"],
        properties: {
          assertions: stringArraySchema(),
          directedTests: stringArraySchema(),
          commands: { type: "array", items: commandSpecSchema() },
          expectedResults: stringArraySchema(),
        },
      },
      decisionRequests: { type: "array", items: decisionRequestSchema() },
      risks: stringArraySchema(),
      openQuestions: stringArraySchema(),
    },
  };
}

export function packageDesignPatchSchema(
  baseProposalSha256: string,
  allowedTargets: string[],
): object {
  return {
    type: "object",
    additionalProperties: false,
    required: ["baseProposalSha256", "operations"],
    properties: {
      baseProposalSha256: { type: "string", enum: [baseProposalSha256] },
      operations: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["op", "target", "value"],
          properties: {
            op: { type: "string", enum: ["add", "replace", "remove"] },
            target: { type: "string", enum: allowedTargets },
            value: {
              anyOf: [
                { type: "null" },
                { type: "array", items: { type: "string" } },
              ],
            },
          },
        },
      },
    },
  };
}

export function packageImplementationSchema(workPackageId: string, designSha256: string): object {
  return {
    type: "object",
    additionalProperties: false,
    required: [
      "schemaVersion", "workPackageId", "designSha256", "summary", "files", "notes", "designGap",
    ],
    properties: {
      schemaVersion: { type: "integer", enum: [1] },
      workPackageId: { type: "string", enum: [workPackageId] },
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
      notes: stringArraySchema(),
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

export function packageReviewSchema(
  workPackageId: string,
  designSha256: string,
  implementationSha256: string,
  kind: Stage2PackageReviewReport["kind"],
): object {
  return {
    type: "object",
    additionalProperties: false,
    required: [
      "schemaVersion", "kind", "workPackageId", "designSha256",
      "implementationAggregateSha256", "verdict", "summary", "findings", "commandResults",
    ],
    properties: {
      schemaVersion: { type: "integer", enum: [1] },
      kind: { type: "string", enum: [kind] },
      workPackageId: { type: "string", enum: [workPackageId] },
      designSha256: { type: "string", enum: [designSha256] },
      implementationAggregateSha256: { type: "string", enum: [implementationSha256] },
      verdict: { type: "string", enum: ["pass", "fail"] },
      summary: { type: "string" },
      findings: findingArraySchema(),
      commandResults: { type: "array", items: commandResultSchema() },
    },
  };
}

function decisionRequestSchema(): object {
  return {
    type: "object",
    additionalProperties: false,
    required: [
      "id", "category", "question", "whyUserDecisionIsRequired", "options", "recommendation",
      "affectedComponents", "affectedInterfaces", "affectedPaths", "consequences",
    ],
    properties: {
      id: lowerSnakeIdSchema(),
      category: {
        type: "string",
        enum: [
          "architecture_role", "pipeline_boundary", "global_state", "identity_or_replay",
          "control_scope", "cross_package_interface", "engineering_tradeoff", "stage1_rework",
        ],
      },
      question: { type: "string" },
      whyUserDecisionIsRequired: { type: "string" },
      options: {
        type: "array",
        minItems: 2,
        maxItems: 3,
        items: {
          type: "object",
          additionalProperties: false,
          required: ["id", "label", "summary", "consequences"],
          properties: {
            id: lowerSnakeIdSchema(),
            label: { type: "string" },
            summary: { type: "string" },
            consequences: stringArraySchema(),
          },
        },
      },
      recommendation: lowerSnakeIdSchema(),
      affectedComponents: stringArraySchema(),
      affectedInterfaces: stringArraySchema(),
      affectedPaths: stringArraySchema(),
      consequences: stringArraySchema(),
    },
  };
}

function findingArraySchema(): object {
  return {
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
  };
}

function stringArraySchema(): object {
  return { type: "array", items: { type: "string" } };
}

function projectPathArraySchema(): object {
  return {
    type: "array",
    items: {
      type: "string",
      pattern: "^[A-Za-z0-9._-]+(?:/[A-Za-z0-9._-]+)*$",
    },
  };
}

function lowerSnakeIdSchema(): object {
  return { type: "string", pattern: "^[a-z][a-z0-9_]*$" };
}

function commandSpecSchema(): object {
  return {
    anyOf: [
      {
        type: "object",
        additionalProperties: false,
        required: ["id", "description", "runner", "command", "args", "required"],
        properties: {
          id: { type: "string" },
          description: { type: "string" },
          runner: { type: "string", enum: ["host"] },
          command: { type: "string" },
          args: { type: "array", items: { type: "string" } },
          required: { type: "boolean" },
        },
      },
      {
        type: "object",
        additionalProperties: false,
        required: ["id", "description", "runner", "script", "required"],
        properties: {
          id: { type: "string" },
          description: { type: "string" },
          runner: { type: "string", enum: ["wsl"] },
          script: { type: "string" },
          required: { type: "boolean" },
        },
      },
    ],
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
