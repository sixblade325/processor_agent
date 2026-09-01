import type {
  CommandResult,
  Stage1ProjectState,
  Stage2DesignProposal,
  Stage2ModuleState,
  Stage2ProjectStage,
  Stage2SkillReference,
  Stage2TopologyProposal,
  Stage2VerificationMode,
  Stage2WorkerEvidence,
  Stage2PackageDesignProposal,
  Stage2WorkPackageStateV4,
  Stage2WorkspaceStage,
} from "../types.js";

export function renderImplementationPlanDocument(
  state: Stage1ProjectState,
  stage2: Stage2ProjectStage,
  status: "待决策" | "调研阻塞" | "待批准" | "需修订" | "已批准",
): string {
  const topology = stage2.topology;
  const current = currentTopologyDecision(stage2);
  const lines = [
    "# Stage2 Implementation Plan",
    "",
    `状态：${status}`,
    "",
    `Plan revision：${String(topology.planRevision)}`,
    "",
    `Stage2 revision：${String(stage2.revision)}`,
    "",
    `Architecture approval：\`${state.stage1.approval?.aggregateSha256 ?? "missing"}\``,
    "",
    "## Topology Decisions",
    "",
    "| Decision | 主题 | 状态 | 结论 |",
    "|---|---|---|---|",
    ...topology.decisionOrder.map((id) => {
      const decision = requireTopologyDecision(stage2, id);
      return `| \`${id}\` | ${table(decision.spec.topic)} | ${decision.status} | ${table(decision.resolution?.conclusion ?? "未确认")} |`;
    }),
    "",
  ];
  if (stage2.architectureRework !== undefined) {
    const rework = stage2.architectureRework;
    lines.push(
      "## Architecture Rework",
      "",
      `ID：\`${rework.id}\``,
      "",
      `状态：\`${rework.status}\``,
      "",
      `Stage1 修正目标：\`${rework.repair.kind}:${rework.repair.target}\``,
      "",
      `受影响 Topology Decisions：${rework.affectedTopologyDecisions.map((id) => `\`${id}\``).join("、")}`,
      "",
      `受影响 Units：${rework.affectedUnits.length === 0 ? "尚无已物化 Unit" : rework.affectedUnits.map((id) => `\`${id}\``).join("、")}`,
      "",
      rework.summary,
      "",
    );
  }
  if (current?.proposal !== undefined) {
    lines.push(
      `## 当前 Decision：${current.spec.id}`,
      "",
      current.spec.question,
      "",
      current.proposal.summary,
      "",
      `推荐：\`${current.proposal.recommendation}\``,
      "",
      "| Option | 概要 | 收益 | 成本 | 风险 |",
      "|---|---|---|---|---|",
      ...current.proposal.options.map((option) =>
        `| \`${option.id}\` | ${table(option.summary)} | ${table(option.benefits.join("<br>") || "无")} | ${table(option.costs.join("<br>") || "无")} | ${table(option.risks.join("<br>") || "无")} |`
      ),
      "",
      ...current.proposal.options.flatMap((option) =>
        renderTopologyOptionPatch(option, option.id === current.proposal?.recommendation)
      ),
      ...renderList("推荐理由", current.proposal.rationale),
      ...renderList("已知架构事实", current.proposal.architectureFacts),
      ...renderList("源码与来源证据", current.proposal.sourceEvidence),
      ...renderList("仍未知", current.proposal.unknowns),
      ...renderList("待回答问题", current.proposal.openQuestions),
    );
  }
  lines.push(
    "## Implementation Units",
    "",
    "| Unit | 类型 | Architecture Role 映射 | 职责 |",
    "|---|---|---|---|",
    ...(topology.plan.units.length === 0
      ? ["| 未确定 | | | |"]
      : topology.plan.units.map((unit) =>
        `| \`${unit.id}\` | ${unit.kind} | ${table(unit.architectureRoles.join("、") || "无")} | ${table(unit.responsibility)} |`
      )),
    "",
    "## Shared Ownership",
    "",
    "| 产物 | 类型 | Owner Unit | 消费者 | 路径 |",
    "|---|---|---|---|---|",
    ...(topology.plan.sharedArtifacts.length === 0
      ? ["| 无 | | | | |"]
      : topology.plan.sharedArtifacts.map((artifact) =>
        `| \`${artifact.id}\` | ${artifact.kind} | \`${artifact.ownerUnit}\` | ${table(artifact.consumerUnits.join("、") || "无")} | ${table(artifact.sourcePaths.join("、") || "无")} |`
      )),
    "",
    "## Interface Contracts",
    "",
    "| Interface | Owner | Producer | Consumer | 字段 | 时序边界 |",
    "|---|---|---|---|---|---|",
    ...(topology.plan.interfaces.length === 0
      ? ["| 未确定 | | | | | |"]
      : topology.plan.interfaces.map((contract) =>
        `| \`${contract.id}\` | \`${contract.ownerUnit}\` | ${table(contract.producerUnits.join("、"))} | ${table(contract.consumerUnits.join("、"))} | ${table(contract.fields.join("、"))} | ${table(`${contract.boundary}；${contract.timing}`)} |`
      )),
    "",
    "## 源码、DAG 与完成条件",
    "",
    "| Unit | Design | 源码 | 测试 | 依赖 | Wave | 完成条件 |",
    "|---|---|---|---|---|---:|---|",
    ...(topology.plan.units.length === 0
      ? ["| 未确定 | | | | | | |"]
      : topology.plan.units.map((unit) =>
        `| \`${unit.id}\` | ${table(unit.designPath || "未确定")} | ${table(unit.sourcePaths.join("、") || "未确定")} | ${table(unit.testPaths.join("、") || "未确定")} | ${table(unit.dependsOn.join("、") || "无")} | ${unit.wave === null ? "" : String(unit.wave)} | ${table(unit.completionCriteria.join("、") || "未确定")} |`
      )),
    "",
  );
  if (topology.review !== undefined) {
    lines.push(
      "## Topology Review",
      "",
      `verdict: \`${topology.review.verdict}\``,
      "",
      ...(topology.review.issues.length === 0
        ? ["- 无阻塞项"]
        : topology.review.issues.map((issue) => `- ${issue}`)),
      "",
    );
  }
  if (topology.migration !== undefined) {
    lines.push(
      "## Legacy Migration",
      "",
      `来源 revision：${String(topology.migration.sourceRevision)}`,
      "",
      ...topology.migration.draftIndexes.map((draft) =>
        `- \`${draft.designPath}\`，runId=\`${draft.runId}\`，threadId=\`${draft.threadId}\``
      ),
      "",
    );
  }
  return `${lines.join("\n").replace(/\n{3,}/gu, "\n\n").trimEnd()}\n`;
}

function renderTopologyOptionPatch(
  option: Stage2TopologyProposal["options"][number],
  recommended: boolean,
): string[] {
  const heading = `### Option \`${option.id}\`${recommended ? "（推荐）" : ""}`;
  const patch = option.patch;
  switch (patch.kind) {
    case "unit_mapping":
      return [
        heading,
        "",
        "| Unit | 类型 | Architecture Role 映射 | 职责 | 理由 |",
        "|---|---|---|---|---|",
        ...patch.units.map((unit) =>
          `| \`${unit.id}\` | ${unit.kind} | ${table(unit.architectureRoles.join("、") || "无")} | ${table(unit.responsibility)} | ${table(unit.rationale)} |`
        ),
        "",
      ];
    case "shared_ownership":
      return [
        heading,
        "",
        "| 共享产物 | 类型 | Owner | 消费者 | 路径 | 理由 |",
        "|---|---|---|---|---|---|",
        ...(patch.sharedArtifacts.length === 0
          ? ["| 无 | | | | | |"]
          : patch.sharedArtifacts.map((artifact) =>
            `| \`${artifact.id}\` | ${artifact.kind} | \`${artifact.ownerUnit}\` | ${table(artifact.consumerUnits.join("、") || "无")} | ${table(artifact.sourcePaths.join("、") || "无")} | ${table(artifact.rationale)} |`
          )),
        "",
      ];
    case "interface_ownership":
      return [
        heading,
        "",
        "| Interface | Owner | Producer | Consumer | 字段 | 边界与时序 |",
        "|---|---|---|---|---|---|",
        ...patch.interfaces.map((contract) =>
          `| \`${contract.id}\` | \`${contract.ownerUnit}\` | ${table(contract.producerUnits.join("、"))} | ${table(contract.consumerUnits.join("、"))} | ${table(contract.fields.join("、"))} | ${table(`${contract.boundary}；${contract.timing}`)} |`
        ),
        "",
      ];
    case "source_topology":
      return [
        heading,
        "",
        "| Unit | Package | Design | 源码 | 测试 | 集成 |",
        "|---|---|---|---|---|---|",
        ...patch.units.map((unit) =>
          `| \`${unit.id}\` | \`${unit.packageName}\` | ${table(unit.designPath)} | ${table(unit.sourcePaths.join("、") || "无")} | ${table(unit.testPaths.join("、") || "无")} | ${table(unit.integrationPaths.join("、") || "无")} |`
        ),
        "",
      ];
    case "unit_dag":
      return [
        heading,
        "",
        "| Unit | 前置 Unit | 集成消费者 |",
        "|---|---|---|",
        ...patch.units.map((unit) =>
          `| \`${unit.id}\` | ${table(unit.dependsOn.join("、") || "无")} | ${table(unit.integrationConsumers.join("、") || "无")} |`
        ),
        "",
      ];
    case "completion":
      return [
        heading,
        "",
        "| Unit | 完成条件 | 验证责任 |",
        "|---|---|---|",
        ...patch.units.map((unit) =>
          `| \`${unit.id}\` | ${table(unit.completionCriteria.join("<br>"))} | ${table(unit.verificationResponsibility)} |`
        ),
        "",
      ];
  }
}

export function renderDesignDocument(
  module: Stage2ModuleState,
  proposal: Stage2DesignProposal,
  revision: number,
  status: "待确认" | "已批准" | "需修订",
  skills: Stage2SkillReference[],
  verificationMode?: Stage2VerificationMode,
): string {
  const lines = [
    `# ${module.id} Implementation Unit Design`,
    "",
    `状态：${status}`,
    "",
    `Design revision：${String(revision)}`,
    "",
    `Unit ID：\`${module.id}\``,
    "",
    "## 职责与范围",
    "",
    proposal.summary,
    "",
    `Architecture 职责：${module.architecture.responsibility}`,
    "",
    ...renderList("Architecture 引用", proposal.architectureReferences),
    ...renderList("源码参考", proposal.sourceReferences),
    ...renderList("显式排除", proposal.explicitExclusions),
    ...renderList("接口", proposal.interfaces),
    "## 字段与所有权",
    "",
    "| 字段 | 语义 | 生产者 | 存储点 | 消费者 | 有效期 |",
    "|---|---|---|---|---|---|",
    ...proposal.fields.map((field) =>
      `| ${table(field.name)} | ${table(field.semantics)} | ${table(field.producer)} | ${table(field.storage)} | ${table(field.consumers.join("、"))} | ${table(field.lifetime)} |`
    ),
    "",
    "## 事件与优先级",
    "",
    ...proposal.events.flatMap((event) => [
      `### ${event.name}`,
      "",
      `条件：${event.condition}`,
      "",
      `优先级：${event.priority}`,
      "",
      ...event.effects.map((effect) => `- ${effect}`),
      "",
    ]),
    ...renderList("周期行为", proposal.cycleBehavior),
    ...renderList("异常与控制路径", proposal.exceptionalBehavior),
    ...renderList("不变量", proposal.invariants),
    ...renderList("共享接口变化", proposal.sharedInterfaceChanges),
    ...renderList("受影响 Unit", proposal.affectedModules),
    "## 实现范围",
    "",
    "源码路径：",
    "",
    ...proposal.implementation.sourcePaths.map((path) => `- \`${path}\``),
    "",
    "测试路径：",
    "",
    ...proposal.implementation.testPaths.map((path) => `- \`${path}\``),
    "",
    ...renderList("断言", proposal.acceptance.assertions),
    ...renderList("定向测试", proposal.acceptance.directedTests),
    ...renderList("预期结果", proposal.acceptance.expectedResults),
    "## 验证命令",
    "",
    ...proposal.acceptance.commands.map((command) =>
      `- \`${command.id}\` [${command.runner}] ${command.description}，required=${String(command.required)}，${command.runner === "wsl" ? command.script : [command.command, ...(command.args ?? [])].join(" ")}`
    ),
    "",
    "## 方法来源",
    "",
    ...skills.map((skill) => `- \`${skill.id}\`：\`${skill.contentHash}\``),
    "",
    ...(verificationMode === undefined
      ? []
      : ["## 用户确认", "", `验证模式：\`${verificationMode}\``, ""]),
    ...renderList("风险", proposal.risks),
    ...renderList("未决问题", proposal.openQuestions),
  ];
  return `${lines.join("\n").replace(/\n{3,}/gu, "\n\n").trimEnd()}\n`;
}

export function renderVerificationDocument(module: Stage2ModuleState): string {
  const verification = requireVerification(module);
  const lines = [
    `# ${module.id} 验证记录`,
    "",
    `模块状态：${module.status}`,
    "",
    `验证模式：\`${verification.mode}\``,
    "",
    `independent: ${String(verification.independent)}`,
    "",
    `waivedByUser: ${String(verification.waivedByUser)}`,
    "",
    "## 主验证",
    "",
    ...renderCommandResults(verification.primaryCommands),
    ...(verification.finalCommands === undefined
      ? []
      : ["", "## 最终命令复验", "", ...renderCommandResults(verification.finalCommands)]),
    ...renderWorkerReport("静态审查", verification.staticReview),
    ...renderWorkerReport("验证审查", verification.verificationReview),
    "",
    "## 阻塞项",
    "",
    ...(module.blockers.length === 0 ? ["- 无"] : module.blockers.map((item) => `- ${item}`)),
    "",
    `完成时间：${verification.completedAt ?? "未完成"}`,
  ];
  return `${lines.join("\n").replace(/\n{3,}/gu, "\n\n").trimEnd()}\n`;
}

export function renderSystemDesignDocument(
  state: Stage1ProjectState,
  stage2: Stage2WorkspaceStage,
  status: "待生成" | "待独立审查" | "待决策" | "需修订" | "待批准" | "已批准",
): string {
  const systemDesign = stage2.systemDesign;
  const proposal = systemDesign.proposal;
  const revisionRequest = systemDesign.revisionRequests?.at(-1);
  const lines = [
    "# Stage2 System Design",
    "",
    `状态：${status}`,
    "",
    `System Design revision：${String(systemDesign.revision)}`,
    "",
    `Stage2 workspace revision：${String(stage2.workspaceRevision)}`,
    "",
    `Architecture approval：\`${state.stage1.approval?.aggregateSha256 ?? "missing"}\``,
    "",
  ];
  if (revisionRequest !== undefined) {
    lines.push(
      "## 当前修订请求",
      "",
      `Request：\`${revisionRequest.id}\``,
      "",
      `状态：${revisionRequest.status === "pending" ? "待应用" : "已应用"}`,
      "",
      `类型：${revisionRequest.kind === "approved_reopen" ? "已批准 System Design 重新打开" : "待批准草案修订"}`,
      "",
      `基线：System Design revision ${String(revisionRequest.baseDesignRevision)}，sha256=\`${revisionRequest.baseDocumentSha256}\``,
      "",
      ...(revisionRequest.affectedWorkPackages === undefined
        ? []
        : [
          `受影响 Work Package：${revisionRequest.affectedWorkPackages.map((id) => `\`${id}\``).join("、")}`,
          "",
        ]),
      ...(revisionRequest.baseApproval === undefined
        ? []
        : [
          `旧审批：revision ${String(revisionRequest.baseApproval.designRevision)}，sha256=\`${revisionRequest.baseApproval.documentSha256}\``,
          "",
        ]),
      revisionRequest.instruction,
      "",
    );
  }
  if (proposal === undefined) {
    lines.push(
      "## 迁移证据",
      "",
      ...(systemDesign.legacyEvidence.length === 0
        ? ["- 无"]
        : systemDesign.legacyEvidence.map((item) =>
          `- \`${item.id}\` [${item.kind}]：${item.summary}`
        )),
      "",
      "尚未生成新的 System Design Draft。",
      "",
    );
    return `${lines.join("\n").trimEnd()}\n`;
  }
  lines.push(
    "## 总体方案",
    "",
    proposal.summary,
    "",
    ...renderList("Architecture 引用", proposal.architectureReferences),
    "## Design Components",
    "",
    "| Component | Parent | Architecture Roles | 职责 | 状态所有权 | Interfaces |",
    "|---|---|---|---|---|---|",
    ...proposal.components.map((component) =>
      `| \`${component.id}\` | ${component.parentId === undefined ? "顶层" : `\`${component.parentId}\``} | ${table(component.architectureRoles.join("、") || "无")} | ${table(component.responsibility)} | ${table(component.stateOwnership.join("、") || "无")} | ${table(component.interfaceIds.join("、") || "无")} |`
    ),
    "",
    "## Interface Skeletons",
    "",
    "| Interface | Owner | Producer | Consumer | 字段骨架 | 边界 | 时序 |",
    "|---|---|---|---|---|---|---|",
    ...(proposal.interfaces.length === 0
      ? ["| 无 | | | | | | |"]
      : proposal.interfaces.map((contract) =>
        `| \`${contract.id}\` | \`${contract.ownerComponentId}\` | ${table(contract.producerComponentIds.join("、"))} | ${table(contract.consumerComponentIds.join("、"))} | ${table(contract.fields.join("、") || "Package Design 闭合")} | ${table(contract.boundary)} | ${table(contract.timing)} |`
      )),
    "",
    "## Work Packages",
    "",
    "| Package | Components | Design 依赖 | 实施依赖 | 集成依赖 | Design | 源码路径 | 测试路径 | 验收 |",
    "|---|---|---|---|---|---|---|---|---|",
    ...proposal.workPackages.map((workPackage) =>
      `| \`${workPackage.id}\` | ${table(workPackage.componentIds.join("、"))} | ${table(workPackage.designDependsOn.join("、") || "无")} | ${table(workPackage.implementationDependsOn.join("、") || "无")} | ${table(workPackage.integrationDependsOn.join("、") || "无")} | \`${workPackage.designPath}\` | ${table(workPackage.allowedSourcePaths.join("、"))} | ${table(workPackage.allowedTestPaths.join("、"))} | ${table(workPackage.acceptance.join("、"))} |`
    ),
    "",
    ...renderList("全局不变量", proposal.globalInvariants),
    ...renderList("整体验收计划", proposal.acceptancePlan),
    "## Decision Requests",
    "",
    ...(systemDesign.decisionOrder.length === 0
      ? ["- 无"]
      : systemDesign.decisionOrder.flatMap((id) => {
        const decision = systemDesign.decisions[id]!;
        return [
          `### \`${id}\` ${decision.status === "answered" ? "已回答" : "待回答"}`,
          "",
          decision.spec.question,
          "",
          `需要用户决定的原因：${decision.spec.whyUserDecisionIsRequired}`,
          "",
          `推荐：\`${decision.spec.recommendation}\``,
          "",
          ...(decision.resolution === undefined
            ? decision.spec.options.map((option) =>
              `- \`${option.id}\` ${option.label}：${option.summary}`
            )
            : [`结论：${decision.resolution.conclusion}`]),
          "",
        ];
      })),
    "",
  );
  if (systemDesign.review !== undefined) {
    lines.push(
      "## 独立审查",
      "",
      `verdict：\`${systemDesign.review.report.verdict}\``,
      "",
      systemDesign.review.report.summary,
      "",
      ...(systemDesign.review.report.findings.length === 0
        ? ["- 无 finding"]
        : systemDesign.review.report.findings.map((finding) =>
          `- [${finding.severity}] ${finding.code}：${finding.message}，action=${finding.requiredAction}`
        )),
      "",
    );
  }
  lines.push(
    ...renderList("风险", proposal.risks),
    "## 迁移证据",
    "",
    ...(systemDesign.legacyEvidence.length === 0
      ? ["- 无"]
      : systemDesign.legacyEvidence.map((item) =>
        `- \`${item.id}\` [${item.kind}]：${item.summary}`
      )),
    "",
  );
  return `${lines.join("\n").replace(/\n{3,}/gu, "\n\n").trimEnd()}\n`;
}

export function renderPackageDesignDocument(
  workPackage: Stage2WorkPackageStateV4,
  proposal: Stage2PackageDesignProposal,
  revision: number,
  status: "待确认" | "已批准" | "需修订",
  skills: Stage2SkillReference[],
): string {
  const lines = [
    `# ${workPackage.id} Work Package Design`,
    "",
    `状态：${status}`,
    "",
    `Design revision：${String(revision)}`,
    "",
    `Work Package：\`${workPackage.id}\``,
    "",
    `Design Components：${proposal.componentIds.map((id) => `\`${id}\``).join("、")}`,
    "",
    "## 职责与范围",
    "",
    proposal.summary,
    "",
    ...renderList("Architecture 引用", proposal.architectureReferences),
    ...renderList("源码参考", proposal.sourceReferences),
    ...renderList("显式排除", proposal.explicitExclusions),
    ...renderList("接口", proposal.interfaces),
    "## 字段与所有权",
    "",
    "| 字段 | 语义 | 生产者 | 存储点 | 消费者 | 有效期 |",
    "|---|---|---|---|---|---|",
    ...proposal.fields.map((field) =>
      `| ${table(field.name)} | ${table(field.semantics)} | ${table(field.producer)} | ${table(field.storage)} | ${table(field.consumers.join("、"))} | ${table(field.lifetime)} |`
    ),
    "",
    "## 事件与优先级",
    "",
    ...proposal.events.flatMap((event) => [
      `### ${event.name}`,
      "",
      `条件：${event.condition}`,
      "",
      `优先级：${event.priority}`,
      "",
      ...event.effects.map((effect) => `- ${effect}`),
      "",
    ]),
    ...renderList("周期行为", proposal.cycleBehavior),
    ...renderList("异常与控制路径", proposal.exceptionalBehavior),
    ...renderList("不变量", proposal.invariants),
    ...renderList("共享接口变化", proposal.sharedInterfaceChanges),
    ...renderList("受影响 Work Package", proposal.affectedWorkPackages),
    "## 实现路径",
    "",
    ...proposal.implementation.sourcePaths.map((path) => `- \`${path}\``),
    "",
    ...proposal.implementation.testPaths.map((path) => `- \`${path}\``),
    "",
    ...renderList("断言", proposal.acceptance.assertions),
    ...renderList("定向测试", proposal.acceptance.directedTests),
    ...renderList("预期结果", proposal.acceptance.expectedResults),
    "## 验证命令",
    "",
    ...proposal.acceptance.commands.map((command) =>
      `- \`${command.id}\` [${command.runner}] ${command.description}，required=${String(command.required)}`
    ),
    "",
    "## Decision Requests",
    "",
    ...(workPackage.decisionOrder.length === 0
      ? ["- 无"]
      : workPackage.decisionOrder.map((id) => {
        const decision = workPackage.decisions[id]!;
        return `- \`${id}\` ${decision.status}：${decision.spec.question}`;
      })),
    "",
    "## 方法来源",
    "",
    ...skills.map((skill) => `- \`${skill.id}\`：\`${skill.contentHash}\``),
    "",
    ...renderList("风险", proposal.risks),
    ...renderList("未决问题", proposal.openQuestions),
  ];
  return `${lines.join("\n").replace(/\n{3,}/gu, "\n\n").trimEnd()}\n`;
}

export function renderPackageVerificationDocument(workPackage: Stage2WorkPackageStateV4): string {
  const verification = workPackage.verification;
  if (verification === undefined) {
    throw new Error(`Work Package ${workPackage.id} has no verification record`);
  }
  const renderPackageWorker = (
    title: string,
    evidence: typeof verification.staticReview,
  ): string[] => evidence === undefined
    ? ["", `## ${title}`, "", "- 尚未执行"]
    : [
      "",
      `## ${title}`,
      "",
      `- runtimeRef: \`${evidence.runtimeRef}\``,
      `- runId: \`${evidence.runId}\``,
      `- verdict: ${evidence.report.verdict}`,
      `- summary: ${evidence.report.summary}`,
      ...evidence.report.findings.map((finding) =>
        `- [${finding.severity}] ${finding.code}：${finding.message}，action=${finding.requiredAction}`
      ),
    ];
  const lines = [
    `# ${workPackage.id} 验证记录`,
    "",
    `Package 状态：${workPackage.status}`,
    "",
    "## Active 主验证",
    "",
    ...renderCommandResults(verification.primaryCommands),
    ...(verification.finalCommands === undefined
      ? []
      : ["", "## Harness 最终复验", "", ...renderCommandResults(verification.finalCommands)]),
    ...renderPackageWorker("独立 Static Review", verification.staticReview),
    ...renderPackageWorker("独立 Verification", verification.verificationReview),
    "",
    "## 阻塞项",
    "",
    ...(workPackage.blockers.length === 0
      ? ["- 无"]
      : workPackage.blockers.map((blocker) => `- ${blocker}`)),
    "",
    `完成时间：${verification.completedAt ?? "未完成"}`,
  ];
  return `${lines.join("\n").replace(/\n{3,}/gu, "\n\n").trimEnd()}\n`;
}

function renderCommandResults(results: CommandResult[]): string[] {
  if (results.length === 0) {
    return ["- 尚无命令证据"];
  }
  return results.flatMap((result) => [
    `- \`${result.id}\`: ${result.ok ? "通过" : "失败"}，runner=${result.runner}，exitCode=${String(result.exitCode)}`,
    `  - command: \`${result.command}\``,
    `  - checkedAt: ${result.checkedAt}`,
    ...(result.output === "" ? [] : [`  - output: ${result.output.replace(/\r?\n/gu, " ")}`]),
  ]);
}

function renderWorkerReport(title: string, evidence: Stage2WorkerEvidence | undefined): string[] {
  if (evidence === undefined) {
    return ["", `## ${title}`, "", "- 尚未执行"];
  }
  return [
    "",
    `## ${title}`,
    "",
    `- performedBy: ${evidence.performedBy}`,
    `- runId: \`${evidence.runId}\``,
    `- threadId: ${evidence.threadId === undefined ? "未记录" : `\`${evidence.threadId}\``}`,
    `- skills: ${evidence.skills.map((skill) => `\`${skill.id}@${skill.contentHash}\``).join("、")}`,
    `- verdict: ${evidence.report.verdict}`,
    `- summary: ${evidence.report.summary}`,
    ...evidence.report.findings.map((finding) =>
      `- [${finding.severity}] ${finding.code}: ${finding.message}，artifact=${finding.artifact}，action=${finding.requiredAction}`
    ),
  ];
}

function renderList(title: string, items: string[]): string[] {
  return [
    `## ${title}`,
    "",
    ...(items.length === 0 ? ["- 无"] : items.map((item) => `- ${item}`)),
    "",
  ];
}

function table(value: string): string {
  return value.replace(/\|/gu, "\\|").replace(/\r?\n/gu, " ");
}

function requireTopologyDecision(
  stage2: Stage2ProjectStage,
  decisionId: string,
) {
  const decision = stage2.topology.decisions[decisionId];
  if (decision === undefined) {
    throw new Error(`Unknown Topology Decision: ${decisionId}`);
  }
  return decision;
}

function currentTopologyDecision(stage2: Stage2ProjectStage) {
  for (const id of stage2.topology.decisionOrder) {
    const decision = requireTopologyDecision(stage2, id);
    if (decision.status === "answered") {
      continue;
    }
    if (decision.spec.dependsOn.every((dependency) =>
      requireTopologyDecision(stage2, dependency).status === "answered"
    )) {
      return decision;
    }
  }
  return undefined;
}

function requireVerification(module: Stage2ModuleState) {
  if (module.verification === undefined) {
    throw new Error(`Stage2 Unit ${module.id} has no verification record`);
  }
  return module.verification;
}
