import { stringify } from "yaml";
import { readText, resolveWithin } from "./io.js";
import type {
  DecisionAdvice,
  DecisionOption,
  DecisionSpec,
  ProjectProfile,
  Stage1ProjectState,
} from "./types.js";

export const CORE_DOCUMENT_PATHS = [
  "architecture/overview.md",
  "architecture/modules.yaml",
  "verification/plan.md",
] as const;

export async function renderFormalDocuments(
  projectRoot: string,
  state: Stage1ProjectState,
  profile: ProjectProfile,
): Promise<Record<string, string>> {
  const documents: Record<string, string> = {
    "architecture/overview.md": renderArchitectureOverview(state, profile),
    "architecture/modules.yaml": renderModuleManifest(state, profile),
    "verification/plan.md": renderVerificationPlan(state, profile),
  };
  const research = await renderResearchMemo(projectRoot, state, profile);
  if (research !== undefined) {
    documents["research/stage1.md"] = research;
  }
  return documents;
}

export function renderDecisionPacket(
  decision: DecisionSpec,
  state: Stage1ProjectState,
): string {
  const lines = [
    `# ${decision.id}: ${decision.topic}`,
    "",
    decision.question,
    "",
    `为什么现在决定：${decision.whyNow}`,
    `调研策略：${decision.researchPolicy}`,
    "",
    "已知事实：",
    ...decision.knownFacts.map((fact) => `- ${fact}`),
    "",
    "候选方案：",
  ];
  for (const option of decision.options) {
    const marker = option.id === decision.recommendation ? "（推荐）" : "";
    lines.push(`- ${option.id}${marker}: ${option.label}`);
    lines.push(`  ${option.summary}`);
    for (const consequence of option.consequences) {
      lines.push(`  后果：${consequence}`);
    }
  }
  lines.push("");
  lines.push(`影响产物：${decision.affectedArtifacts.join(", ")}`);
  lines.push(`当前项目 revision：${state.stage1.revision}`);
  return `${lines.join("\n")}\n`;
}

export function selectedOption(
  decision: DecisionSpec,
  state: Stage1ProjectState,
): DecisionOption | undefined {
  const selected = state.stage1.decisions[decision.id]?.selectedOption;
  return decision.options.find((option) => option.id === selected);
}

function renderArchitectureOverview(
  state: Stage1ProjectState,
  profile: ProjectProfile,
): string {
  const approved = ["ARCHITECTURE_APPROVED", "PROJECT_SCAFFOLDED", "STAGE1_COMPLETE"].includes(
    state.stage1.status,
  );
  const lines = [
    "# 架构总览",
    "",
    `状态：${approved ? "已批准" : "草案"}`,
    `Profile: ${profile.id} ${profile.version}`,
    "",
    "## 项目意图",
    "",
    `目标：${state.stage1.intent.goal}`,
    "",
    `使用场景：${state.stage1.intent.useCase}`,
    "",
    "约束：",
    ...state.stage1.intent.constraints.map((item) => `- ${item}`),
    "",
    "排除项：",
    ...state.stage1.intent.exclusions.map((item) => `- ${item}`),
    "",
    "## 工程环境",
    "",
    "| 检查项 | 执行端 | 必需 | 结果 | 证据 |",
    "|---|---|---:|---|---|",
  ];
  if (state.stage1.environment.length === 0) {
    lines.push("| 尚未探测 | | | 待执行 | | ");
  } else {
    for (const check of state.stage1.environment) {
      lines.push(
        `| ${escapeTable(check.description)} | ${check.runner} | ${check.required ? "是" : "否"} | ${check.ok ? "通过" : "失败"} | ${escapeTable(oneLine(check.output))} |`,
      );
    }
  }
  lines.push("");
  lines.push("## 系统边界");
  lines.push("");
  lines.push(...profile.architecture.systemBoundary.map((item) => `- ${item}`));
  lines.push("");
  lines.push("## 支持的指令");
  lines.push("");
  lines.push(...profile.architecture.supportedInstructions.map((item) => `- ${item}`));
  lines.push("");
  lines.push("## 架构决策");
  lines.push("");
  for (const decision of profile.decisions) {
    const decisionState = state.stage1.decisions[decision.id];
    const option = selectedOption(decision, state);
    lines.push(`### ${decision.id}: ${decision.topic}`);
    lines.push("");
    if (option !== undefined) {
      lines.push(`结论：${option.label}`);
      lines.push("");
      lines.push(option.summary);
      lines.push("");
      lines.push("后果：");
      lines.push(...option.consequences.map((item) => `- ${item}`));
    } else if (decisionState?.customAnswer !== undefined) {
      lines.push("结论：自定义方案");
      lines.push("");
      lines.push(decisionState.customAnswer);
    } else if (decisionState?.status === "deferred") {
      lines.push(`结论：延期至 ${decisionState.deferredUntil ?? "未指定决策点"}`);
      if (decisionState.note !== undefined) {
        lines.push("");
        lines.push(`说明：${decisionState.note}`);
      }
    } else {
      lines.push("结论：待确认");
      lines.push("");
      lines.push(`推荐：${decision.recommendation}`);
    }
    if (decisionState?.note !== undefined && decisionState.status !== "deferred") {
      lines.push("");
      lines.push(`用户说明：${decisionState.note}`);
    }
    lines.push("");
  }
  lines.push("## 全局不变量");
  lines.push("");
  lines.push(...profile.architecture.invariants.map((item) => `- ${item}`));
  lines.push("");
  lines.push("## 共享流水字段");
  lines.push("");
  lines.push("| 字段 | 语义 | 生产者 | 消费者 | 有效区间 |");
  lines.push("|---|---|---|---|---|");
  for (const field of profile.architecture.sharedFields) {
    lines.push(
      `| ${escapeTable(field.name)} | ${escapeTable(field.semantics)} | ${escapeTable(field.producer)} | ${escapeTable(field.consumers.join(", "))} | ${escapeTable(`${field.validFrom} 至 ${field.validUntil}`)} |`,
    );
  }
  lines.push("");
  lines.push("## 全局协议");
  lines.push("");
  for (const protocol of profile.architecture.globalProtocols) {
    lines.push(`### ${protocol.id}`);
    lines.push("");
    lines.push(`责任模块：${protocol.owner}`);
    lines.push("");
    lines.push(...protocol.rules.map((item) => `- ${item}`));
    lines.push("");
  }
  lines.push("## 性能计数器规则");
  lines.push("");
  for (const counter of profile.architecture.counterRules) {
    lines.push(`- ${counter.name}: ${counter.increment}`);
    for (const exclusion of counter.exclusions) {
      lines.push(`  - 不计入：${exclusion}`);
    }
  }
  lines.push("");
  lines.push("## 流水线与共享协议闭合边界");
  lines.push("");
  lines.push(
    "以上已经确认的流水线、发射、访存、控制、异常和验证决策构成 Stage2 模块设计的 Stage1 边界。",
  );
  lines.push(
    "Stage2 需要在不改变这些决策的前提下，闭合模块内部字段、同拍优先级、所有权、释放、复用和定向测试。",
  );
  lines.push("");
  lines.push("## 未决事项");
  lines.push("");
  const open = profile.decisions.filter((decision) => {
    const status = state.stage1.decisions[decision.id]?.status;
    return status === "pending" || status === "deferred";
  });
  if (open.length === 0) {
    lines.push("无。 ");
  } else {
    for (const decision of open) {
      const decisionState = state.stage1.decisions[decision.id];
      const suffix = decisionState?.status === "deferred"
        ? `，延期至 ${decisionState.deferredUntil ?? "未指定决策点"}`
        : "";
      lines.push(`- ${decision.id}: ${decision.question}${suffix}`);
    }
  }
  return `${lines.join("\n")}\n`;
}

function renderModuleManifest(state: Stage1ProjectState, profile: ProjectProfile): string {
  const approved = ["ARCHITECTURE_APPROVED", "PROJECT_SCAFFOLDED", "STAGE1_COMPLETE"].includes(
    state.stage1.status,
  );
  return stringify(
    {
      schemaVersion: 1,
      documentLanguage: "zh-CN",
      status: approved ? "approved" : "draft",
      profile: {
        id: profile.id,
        version: profile.version,
      },
      systemBoundary: profile.architecture.systemBoundary,
      supportedInstructions: profile.architecture.supportedInstructions,
      decisions: profile.decisions.map((decision) => {
        const decisionState = state.stage1.decisions[decision.id];
        const option = selectedOption(decision, state);
        return {
          id: decision.id,
          topic: decision.topic,
          status: decisionState?.status ?? "pending",
          selection: option?.id ?? (decisionState?.customAnswer === undefined ? null : "custom"),
          summary: option?.summary ?? decisionState?.customAnswer ?? null,
          consequences: option?.consequences ?? [],
        };
      }),
      sharedFields: profile.architecture.sharedFields,
      globalProtocols: profile.architecture.globalProtocols,
      counterRules: profile.architecture.counterRules,
      decisionAcceptance: profile.verification.decisionAcceptance,
      dependencySemantics:
        "dependsOn 记录模块消费的其他模块契约，允许经过寄存边界的反馈依赖；stage2Order 定义实施顺序。",
      modules: profile.architecture.modules,
      stage2Order: profile.architecture.stage2Order,
    },
    { lineWidth: 0 },
  );
}

function renderVerificationPlan(
  state: Stage1ProjectState,
  profile: ProjectProfile,
): string {
  const lines = [
    "# 验证计划",
    "",
    `状态：${["ARCHITECTURE_APPROVED", "PROJECT_SCAFFOLDED", "STAGE1_COMPLETE"].includes(state.stage1.status) ? "已批准" : "草案"}`,
    "",
    "## 参考模型",
    "",
    profile.verification.referenceModel,
    "",
    "## 验证层级",
    "",
    ...profile.verification.layers.map((item) => `- ${item}`),
    "",
    "## 必测场景",
    "",
    ...profile.verification.requiredScenarios.map((item) => `- ${item}`),
    "",
    "## 性能计数器",
    "",
    ...profile.verification.counters.map((item) => `- ${item}`),
    "",
    "## 计数语义",
    "",
    ...profile.architecture.counterRules.flatMap((counter) => [
      `- ${counter.name}: ${counter.increment}`,
      ...counter.exclusions.map((exclusion) => `  - 不计入：${exclusion}`),
    ]),
    "",
    "## 决策对应要求",
    "",
  ];
  for (const decision of profile.decisions) {
    const option = selectedOption(decision, state);
    const custom = state.stage1.decisions[decision.id]?.customAnswer;
    lines.push(`- ${decision.id}: ${option?.label ?? custom ?? "待确认"}`);
    if (option !== undefined) {
      for (const consequence of option.consequences) {
        lines.push(`  - ${consequence}`);
      }
    }
    const acceptance = profile.verification.decisionAcceptance.find(
      (item) => item.decisionId === decision.id,
    );
    if (acceptance !== undefined) {
      for (const criterion of acceptance.criteria) {
        lines.push(`  - 验收：${criterion}`);
      }
    }
  }
  lines.push("");
  lines.push("## Stage2 完成门禁");
  lines.push("");
  lines.push("- 每个 baseline 模块都通过对应定向测试。");
  lines.push("- 架构轨迹与选定参考策略一致。");
  lines.push("- 必需计数器均可观测，并遵守文档规定的计数规则。");
  lines.push("- 集成测试覆盖 stall、redirect、trap 和双发射行为。");
  return `${lines.join("\n")}\n`;
}

async function renderResearchMemo(
  projectRoot: string,
  state: Stage1ProjectState,
  profile: ProjectProfile,
): Promise<string | undefined> {
  const adviceItems: Array<{ decision: DecisionSpec; advice: DecisionAdvice }> = [];
  for (const decision of profile.decisions) {
    const path = state.stage1.decisions[decision.id]?.advicePath;
    if (path === undefined) {
      continue;
    }
    const raw = await readText(resolveWithin(projectRoot, path));
    adviceItems.push({ decision, advice: JSON.parse(raw) as DecisionAdvice });
  }
  if (adviceItems.length === 0) {
    return undefined;
  }
  const lines = [
    "# Stage1 调研备忘录",
    "",
    "本文保存 Stage1 决策的来源化建议。最终架构事实以 `architecture/` 为准。",
    "",
  ];
  for (const { decision, advice } of adviceItems) {
    lines.push(`## ${decision.id}: ${decision.topic}`);
    lines.push("");
    lines.push(advice.summary);
    lines.push("");
    lines.push(`- 调研策略：${decision.researchPolicy}`);
    if (advice.research === undefined) {
      lines.push("- 证据格式：legacy advice");
    } else {
      lines.push(`- Research Request：${advice.research.request.question}`);
      if (advice.research.request.scope !== undefined) {
        lines.push(`- 调研范围：${advice.research.request.scope}`);
      }
      lines.push(`- Fingerprint：\`${advice.research.fingerprint}\``);
      lines.push(`- Run：\`${advice.research.runId}\``);
      lines.push(`- 完成时间：${advice.research.completedAt}`);
      lines.push(`- 证据充分：${advice.research.evidence.evidenceSufficient ? "是" : "否"}`);
      if (advice.research.researchThreadId !== undefined) {
        lines.push(`- Research Worker：\`${advice.research.researchThreadId}\``);
      }
      if (advice.research.synthesisThreadId !== undefined) {
        lines.push(`- Synthesis Worker：\`${advice.research.synthesisThreadId}\``);
      }
      lines.push(`- 停止原因：${advice.research.evidence.stopReason}`);
      lines.push("");
      lines.push("### 来源");
      lines.push("");
      if (advice.research.evidence.sources.length === 0) {
        lines.push("- 无可用来源。");
      }
      for (const source of advice.research.evidence.sources) {
        lines.push(
          `- [${source.kind}] ${source.locator}，revision：${source.revision}，访问时间：${source.accessedAt}`,
        );
        lines.push(...source.locations.map((location) => `  - 位置：${location}`));
      }
    }
    lines.push("");
    lines.push("### 已核验事实");
    lines.push("");
    if (advice.facts.length === 0) {
      lines.push("- 无。");
    }
    for (const fact of advice.facts) {
      lines.push(`- ${fact.claim} 来源：${fact.source}。置信度：${confidenceLabel(fact.confidence)}。`);
    }
    if (advice.research !== undefined) {
      lines.push("");
      lines.push("### 冲突与缺口");
      lines.push("");
      if (
        advice.research.evidence.conflicts.length === 0
        && advice.research.evidence.gaps.length === 0
      ) {
        lines.push("- 无。");
      }
      lines.push(...advice.research.evidence.conflicts.map((item) => `- 冲突：${item}`));
      lines.push(...advice.research.evidence.gaps.map((item) => `- 缺口：${item}`));
    }
    lines.push("");
    lines.push("### 候选项比较");
    lines.push("");
    for (const item of advice.optionAnalysis) {
      const option = decision.options.find((candidate) => candidate.id === item.optionId);
      lines.push(`#### ${item.optionId}: ${option?.label ?? item.optionId}`);
      lines.push("");
      lines.push(`- 收益：${item.benefits.length === 0 ? "无已确认收益" : item.benefits.join("；")}`);
      lines.push(`- 成本：${item.costs.length === 0 ? "无已确认成本" : item.costs.join("；")}`);
      lines.push(`- 风险：${item.risks.length === 0 ? "无已确认风险" : item.risks.join("；")}`);
      lines.push("");
    }
    lines.push("### 综合建议");
    lines.push("");
    lines.push(`- 推荐：${advice.recommendation}`);
    lines.push(...advice.rationale.map((item) => `- 理由：${item}`));
    if (advice.openQuestions.length > 0) {
      lines.push("");
      lines.push("待确认问题：");
      lines.push(...advice.openQuestions.map((item) => `- ${item}`));
    }
    const decisionState = state.stage1.decisions[decision.id];
    lines.push("");
    lines.push("### 用户结论");
    lines.push("");
    lines.push(`- 状态：${decisionState?.status ?? "missing"}`);
    const selected = selectedOption(decision, state);
    if (selected !== undefined) {
      lines.push(`- 结论：${selected.id}，${selected.label}`);
    } else if (decisionState?.customAnswer !== undefined) {
      lines.push(`- 结论：${decisionState.customAnswer}`);
    } else {
      lines.push("- 结论：待用户确认");
    }
    if (decisionState?.note !== undefined) {
      lines.push(`- 说明：${decisionState.note}`);
    }
    lines.push("");
  }
  return `${lines.join("\n").trimEnd()}\n`;
}

function escapeTable(value: string): string {
  return value.replace(/\|/gu, "\\|");
}

function oneLine(value: string): string {
  return value.trim().replace(/\s+/gu, " ").slice(0, 160);
}

function confidenceLabel(value: "low" | "medium" | "high"): string {
  return value === "high" ? "高" : value === "medium" ? "中" : "低";
}
