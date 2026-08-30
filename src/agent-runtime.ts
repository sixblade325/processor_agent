import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";
import { atomicWriteText, pathExists, readText, resolveWithin } from "./io.js";
import { renderDecisionPacket } from "./render.js";
import {
  currentGeneratedAggregate,
  findNextDecision,
  loadStage1,
  saveArchitectureReview,
  saveDecisionAdvice,
  summarizeStage1,
} from "./stage1.js";
import type {
  ArchitectureReviewReport,
  DecisionAdvice,
  DecisionSpec,
} from "./types.js";

const ADVICE_SCHEMA_BASE = {
  type: "object",
  additionalProperties: false,
  required: [
    "decisionId",
    "summary",
    "facts",
    "optionAnalysis",
    "recommendation",
    "rationale",
    "openQuestions",
  ],
  properties: {
    decisionId: { type: "string" },
    summary: { type: "string" },
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
    optionAnalysis: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["optionId", "benefits", "costs", "risks"],
        properties: {
          optionId: { type: "string" },
          benefits: { type: "array", items: { type: "string" } },
          costs: { type: "array", items: { type: "string" } },
          risks: { type: "array", items: { type: "string" } },
        },
      },
    },
    recommendation: { type: "string" },
    rationale: { type: "array", items: { type: "string" } },
    openQuestions: { type: "array", items: { type: "string" } },
  },
} as const;

const WORKSPACE_AGENT_ENV = "PROCESSOR_AGENT_WORKSPACE";

export async function buildWorkspaceAgentPrompt(projectPath: string): Promise<string> {
  const prepared = await prepareWorkspaceAgent(projectPath);
  return prepared.prompt;
}

export async function openWorkspaceAgent(projectPath: string): Promise<number> {
  if (process.env[WORKSPACE_AGENT_ENV] === "1") {
    throw new Error("A Workspace Agent cannot recursively run `processor-agent open`");
  }

  const prepared = await prepareWorkspaceAgent(projectPath);
  const version = spawnSync("codex", ["--version"], {
    cwd: prepared.root,
    encoding: "utf8",
    windowsHide: true,
    timeout: 30_000,
  });
  if (version.error !== undefined) {
    throw new Error(`Codex CLI is unavailable: ${version.error.message}`);
  }
  if (version.status !== 0) {
    throw new Error(
      `Codex CLI version check failed: ${(version.stderr || version.stdout || "unknown error").trim()}`,
    );
  }

  const result = spawnSync(
    "codex",
    ["-C", prepared.root, prepared.prompt],
    {
      cwd: prepared.root,
      stdio: "inherit",
      windowsHide: false,
      env: {
        ...process.env,
        [WORKSPACE_AGENT_ENV]: "1",
      },
    },
  );
  if (result.error !== undefined) {
    throw new Error(`Codex CLI failed to start: ${result.error.message}`);
  }
  if (result.status !== null) {
    return result.status;
  }
  return result.signal === "SIGINT" ? 130 : 1;
}

async function prepareWorkspaceAgent(projectPath: string): Promise<{ root: string; prompt: string }> {
  const loaded = await loadStage1(projectPath);
  const summary = await summarizeStage1(loaded);
  const nextDecision = summary.nextDecision?.id ?? "none";
  const prompt = `你是 Processor Agent 唯一面向用户的 Workspace Agent。本会话由 Harness 启动，项目根目录是 ${loaded.root}。

先读取项目根目录的 AGENTS.md。随后立即执行以下启动动作，不等待用户补充命令：
1. 运行 \`processor-agent stage1 status . --json\` 获取磁盘中的当前状态。
2. 运行 \`processor-agent stage1 next . --json\` 获取当前唯一待处理决策。
3. 用简体中文向用户展示一个待确认决策或一个明确的阶段动作。

交互协议：
1. Harness 是工作流状态、生成文档、审批哈希和阶段转换的唯一写入者。不得手工修改 \`.assistant/\`，不得直接改写 Harness 管理的 Stage1 正式草案。
2. 每次处理用户回答前重新查询 \`status\` 和 \`next\`。只处理当前 ready Decision，不依赖聊天记录猜测状态。
3. 用户明确选择 option 时运行 \`processor-agent stage1 answer . <decision-id> <option-id>\`。用户说“按推荐”或在当前单一决策上下文中明确确认推荐时，读取 Decision Packet 的 recommendation 后再提交。
4. 用户提出候选项之外的结论时运行 \`processor-agent stage1 custom . <decision-id> --text <结论> --note <理由>\`。语义无法唯一映射时先提一个澄清问题，不提交状态。
5. 用户要求依据、比较或建议时运行 \`processor-agent stage1 advise . <decision-id>\`，总结来源和权衡，保持该 Decision 待确认。
6. 只有非 blocking Decision 且用户明确要求延期时，才运行 \`processor-agent stage1 defer\`。只有用户明确授权 Agent 代为选择时，才使用 \`answer --delegated\`。
7. \`review\`、\`audit\`、\`approve\`、\`scaffold\` 和 \`complete\` 必须按当前状态调用对应 Harness 命令。\`approve\` 必须得到用户在查看审查结果后的明确批准。
8. 每次成功提交后重新查询状态，只展示下一项决策或下一项阶段动作。不得一次要求用户确认多个架构决策。
9. Harness 命令失败时原样保留状态，报告具体错误和恢复条件。不得通过直接编辑状态或正式草案绕过门禁。
10. 不要求用户手工执行 Harness 命令，不得在本会话内再次调用 \`processor-agent open\`。

启动前快照仅用于发现明显漂移，磁盘查询结果拥有最终解释权：Stage1=${summary.status}，revision=${summary.revision}，nextDecision=${nextDecision}。
现在执行启动动作并继续工作流。`;
  return { root: loaded.root, prompt };
}

export async function adviseDecision(
  projectPath: string,
  decisionId?: string,
  options: { refresh?: boolean } = {},
): Promise<DecisionAdvice> {
  const loaded = await loadStage1(projectPath);
  const profile = loaded.loadedProfile.profile;
  const decision = decisionId === undefined
    ? findNextDecision(loaded.state, profile)
    : profile.decisions.find((item) => item.id === decisionId);
  if (decision === undefined) {
    throw new Error(decisionId === undefined ? "No ready Stage1 decision" : `Unknown decision: ${decisionId}`);
  }
  if (options.refresh !== true) {
    const recordedPath = loaded.state.stage1.decisions[decision.id]?.advicePath;
    const advicePath = recordedPath ?? `.assistant/advice/${decision.id}.json`;
    const absoluteAdvicePath = resolveWithin(loaded.root, advicePath);
    if (recordedPath !== undefined && !(await pathExists(absoluteAdvicePath))) {
      throw new Error(`Recorded advice is missing: ${advicePath}`);
    }
    if (await pathExists(absoluteAdvicePath)) {
      const advice = validateAdvice(JSON.parse(await readText(absoluteAdvicePath)), decision);
      if (recordedPath === undefined) {
        await saveDecisionAdvice(
          loaded.root,
          decision.id,
          `${JSON.stringify(advice, null, 2)}\n`,
        );
      }
      return advice;
    }
  }
  const runtimeRoot = await createRunDirectory(
    dirname(loaded.root),
    [".runtime", "processor_agent", basename(loaded.root), "stage1", decision.id],
  );
  const schemaPath = resolve(runtimeRoot, "advice.schema.json");
  const outputPath = resolve(runtimeRoot, "advice.json");
  const eventsPath = resolve(runtimeRoot, "codex.jsonl");
  await atomicWriteText(schemaPath, `${JSON.stringify(adviceSchema(decision), null, 2)}\n`);
  const prompt = buildAdvicePrompt(loaded.root, loaded.state.stage1.intent.goal, decision, loaded.state);
  const result = spawnSync(
    "codex",
    [
      "exec",
      "--ignore-user-config",
      "--ephemeral",
      "--json",
      "--sandbox",
      "read-only",
      "-C",
      loaded.root,
      "--output-schema",
      schemaPath,
      "-o",
      outputPath,
      "-",
    ],
    {
      input: prompt,
      encoding: "utf8",
      windowsHide: true,
      timeout: 900_000,
      maxBuffer: 32 * 1024 * 1024,
    },
  );
  await atomicWriteText(eventsPath, `${result.stdout ?? ""}${result.stderr ?? ""}`);
  if (result.error !== undefined) {
    throw new Error(`Codex CLI failed: ${result.error.message}`);
  }
  if (result.status !== 0) {
    throw new Error(`Codex CLI exited with ${String(result.status)}; events: ${eventsPath}`);
  }
  if (!(await pathExists(outputPath))) {
    throw new Error(`Codex CLI did not create structured advice: ${outputPath}`);
  }
  const raw = await readText(outputPath);
  const advice = validateAdvice(JSON.parse(raw), decision);
  await saveDecisionAdvice(loaded.root, decision.id, `${JSON.stringify(advice, null, 2)}\n`);
  return advice;
}

export async function auditStage1Architecture(
  projectPath: string,
): Promise<ArchitectureReviewReport> {
  const loaded = await loadStage1(projectPath);
  if (loaded.state.stage1.status !== "ARCHITECTURE_REVIEW") {
    throw new Error(
      `Architecture audit requires ARCHITECTURE_REVIEW, current state is ${loaded.state.stage1.status}`,
    );
  }
  const aggregate = currentGeneratedAggregate(loaded.state);
  const runtimeRoot = await createRunDirectory(
    dirname(loaded.root),
    [".runtime", "processor_agent", basename(loaded.root), "stage1", "architecture-review"],
  );
  const schemaPath = resolve(runtimeRoot, "review.schema.json");
  const outputPath = resolve(runtimeRoot, "review.json");
  const eventsPath = resolve(runtimeRoot, "codex.jsonl");
  await atomicWriteText(
    schemaPath,
    `${JSON.stringify(reviewSchema(aggregate), null, 2)}\n`,
  );
  const documents: string[] = [];
  for (const path of Object.keys(loaded.state.stage1.generatedDocumentHashes).sort()) {
    documents.push(`\n<document path="${path}">\n${await readText(resolve(loaded.root, path))}</document>\n`);
  }
  const prompt = `你是 Chisel 处理器项目的独立只读 Stage1 架构审查 Agent。只使用下方提供的文档，不调用工具，不修改文件。所有自然语言输出使用简体中文，标识符、路径和代码保持原样。

审查标准：
1. 每个 blocking 决策都一致反映在 Architecture、Module Manifest 和 Verification Plan 中。
2. ISA 与系统边界、流水线与发射语义、模块所有权、全局 stall、flush、redirect、exception、kill、backpressure 和验证门禁已经充分闭合，可以进入 Stage2。
3. 推荐方案不能写成已批准事实。
4. 模块依赖与职责一致。
5. 影响正确性或接口的未决项属于 error。Stage2 的模块内部实现细节不属于 error。
6. 只有 Stage2 无需自行发明全局架构规则时才能返回 pass。
7. ARCHITECTURE_REVIEW 阶段的正式文档保持草案状态，独立审查通过并由用户批准后才晋升为已批准。草案状态本身不构成 finding。

reviewedAggregateSha256 必须严格等于：${aggregate}
没有单一关联决策时，relatedDecision 使用空字符串。
${documents.join("\n")}`;
  const result = spawnSync(
    "codex",
    [
      "exec",
      "--ignore-user-config",
      "--ephemeral",
      "--json",
      "--sandbox",
      "read-only",
      "-C",
      loaded.root,
      "--output-schema",
      schemaPath,
      "-o",
      outputPath,
      "-",
    ],
    {
      input: prompt,
      encoding: "utf8",
      windowsHide: true,
      timeout: 900_000,
      maxBuffer: 32 * 1024 * 1024,
    },
  );
  await atomicWriteText(eventsPath, `${result.stdout ?? ""}${result.stderr ?? ""}`);
  if (result.error !== undefined) {
    throw new Error(`Codex CLI failed: ${result.error.message}`);
  }
  if (result.status !== 0) {
    throw new Error(`Codex CLI exited with ${String(result.status)}; events: ${eventsPath}`);
  }
  if (!(await pathExists(outputPath))) {
    throw new Error(`Codex CLI did not create an architecture review: ${outputPath}`);
  }
  const report = validateReview(JSON.parse(await readText(outputPath)), aggregate);
  await saveArchitectureReview(loaded.root, report);
  return report;
}

function buildAdvicePrompt(
  projectRoot: string,
  goal: string,
  decision: DecisionSpec,
  state: Parameters<typeof renderDecisionPacket>[1],
): string {
  return `你是 Chisel 处理器项目的只读 Stage1 架构建议 Agent。

项目根目录：${projectRoot}
项目目标：${goal}

只分析一个 Decision Packet，不修改文件。明确区分已核验事实、推导结论和建议。事实使用源码路径或直接 URL 作为来源，不得编造来源。在相同项目范围下比较全部候选方案。recommendation 字段只能填写一个原始 option id，不添加其他文字。所有自然语言字段使用简体中文，标识符、路径、命令和代码保持原样。只返回要求的结构化结果。

${renderDecisionPacket(decision, state)}
`;
}

function adviceSchema(decision: DecisionSpec): object {
  const schema = structuredClone(ADVICE_SCHEMA_BASE) as {
    properties: {
      recommendation: Record<string, unknown>;
      optionAnalysis: { items: { properties: { optionId: Record<string, unknown> } } };
    };
  };
  const optionIds = decision.options.map((option) => option.id);
  schema.properties.recommendation.enum = optionIds;
  schema.properties.optionAnalysis.items.properties.optionId.enum = optionIds;
  return schema;
}

function reviewSchema(aggregate: string): object {
  return {
    type: "object",
    additionalProperties: false,
    required: ["reviewedAggregateSha256", "verdict", "summary", "findings"],
    properties: {
      reviewedAggregateSha256: { type: "string", enum: [aggregate] },
      verdict: { type: "string", enum: ["pass", "fail"] },
      summary: { type: "string" },
      findings: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["severity", "code", "message", "artifact", "relatedDecision"],
          properties: {
            severity: { type: "string", enum: ["error", "warning", "note"] },
            code: { type: "string" },
            message: { type: "string" },
            artifact: { type: "string" },
            relatedDecision: { type: "string" },
          },
        },
      },
    },
  };
}

function validateAdvice(value: unknown, decision: DecisionSpec): DecisionAdvice {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("Codex advice must be an object");
  }
  const advice = value as DecisionAdvice;
  if (advice.decisionId !== decision.id) {
    throw new Error(`Codex advice returned decision ${advice.decisionId}, expected ${decision.id}`);
  }
  const optionIds = new Set(decision.options.map((option) => option.id));
  if (!optionIds.has(advice.recommendation)) {
    throw new Error(`Codex advice recommends unknown option ${advice.recommendation}`);
  }
  for (const item of advice.optionAnalysis) {
    if (!optionIds.has(item.optionId)) {
      throw new Error(`Codex advice analyzes unknown option ${item.optionId}`);
    }
  }
  const analyzed = advice.optionAnalysis.map((item) => item.optionId);
  if (analyzed.length !== optionIds.size || new Set(analyzed).size !== optionIds.size) {
    throw new Error("Codex advice must analyze every option exactly once");
  }
  return advice;
}

async function createRunDirectory(parent: string, segments: string[]): Promise<string> {
  const runId = `${new Date().toISOString().replace(/[:.]/gu, "-")}-${randomUUID()}`;
  const path = resolve(parent, ...segments, runId);
  await mkdir(path, { recursive: true });
  return path;
}

function validateReview(value: unknown, aggregate: string): ArchitectureReviewReport {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("Codex architecture review must be an object");
  }
  const report = value as ArchitectureReviewReport;
  if (report.reviewedAggregateSha256 !== aggregate) {
    throw new Error("Codex architecture review returned the wrong document aggregate");
  }
  if (report.verdict !== "pass" && report.verdict !== "fail") {
    throw new Error(`Codex architecture review returned invalid verdict ${String(report.verdict)}`);
  }
  if (!Array.isArray(report.findings)) {
    throw new Error("Codex architecture review findings must be an array");
  }
  if (report.verdict === "pass" && report.findings.some((finding) => finding.severity === "error")) {
    throw new Error("Codex architecture review passed while reporting an error finding");
  }
  return report;
}
