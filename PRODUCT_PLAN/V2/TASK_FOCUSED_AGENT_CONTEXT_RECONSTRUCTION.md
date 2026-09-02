# 任务聚焦的 Agent 上下文重建能力

状态：V1 已验证的关键技术遗产，V2 需保留并精炼

## 1. 定义

任务聚焦的 Agent 上下文重建能力，是指：

> 根据当前任务、指定 Git 版本、权威项目材料、相关证据与任务方法，为一个全新的 Agent 线程确定性生成有界、可追踪、可复现的上下文，使其无需依赖旧线程历史，即可快速建立完成当前任务所需的项目理解。

其目标不是让 Agent 一次理解整个项目，而是让 Agent 对当前任务形成足够、准确、受约束的工作模型。

## 2. 核心价值

该能力解决以下问题：

1. Agent 线程会中断、压缩、漂移或丢失。
2. 长期线程会积累无关历史，降低任务聚焦程度。
3. 新 Agent 若从仓库根目录无界探索，成本高且容易读取无关材料。
4. 项目事实必须来自当前权威文件，不能依赖旧对话中的隐含信息。
5. 不同任务需要不同的阅读入口、材料范围、方法和输出契约。
6. Agent 交接必须能够脱离原线程完成。

该能力使 Agent 线程成为可替换的执行资源，而不是项目记忆的持有者。

## 3. 输入

上下文重建以以下信息为输入：

```text
inputCommit 或 candidateCommit
当前任务说明
任务目标与完成条件
相关权威材料
相关 Diff
相关 Finding、Review 与 Evidence
Skill
Read Scope
Write Scope
Tool Capability
Output Contract
Context Budget
```

其中：

- `inputCommit` 确定 Agent 读取的精确项目版本。
- 当前任务说明定义本次工作边界。
- 权威材料来自 Git 中的 Architecture、Design、Source 和 Verification。
- Skill 定义任务方法和领域检查重点。
- Capability 定义 Agent 能读取、修改和调用的资源。
- Output Contract 定义允许产生的结果类型。

## 4. 输出

该能力生成一个 Task Context Package：

```text
Task Context Package
├── task.json
├── authority.json
├── read-manifest.json
├── capability-manifest.json
├── context-map.md
├── relevant-diff.patch
├── evidence-index.json
└── output-contract.json
```

最小内容包括：

```text
任务目标
完成条件
输入 commit
候选 commit（如有）
推荐阅读入口
相关文件与 source span
相关变更 Diff
相关 Finding 和 Evidence
允许的读写范围
允许的工具能力
上下文预算
输出契约
```

Task Context Package 是运行时投影，可删除并重新生成，不属于处理器设计事实。

## 5. 标准流程

```text
Focused Task
+ Git Snapshot
+ Skill
+ Capability Policy
        |
        v
Task Context Assembler
        |
        v
Task Context Package
        |
        v
Fresh Agent Thread
        |
        v
Patch / Report / Finding / Context Gap
```

执行步骤：

1. Harness 冻结任务输入 commit。
2. 根据任务、Skill 和路径策略选择初始材料。
3. 生成 Read Manifest、Capability Manifest 和输出契约。
4. 建立推荐阅读顺序与上下文地图。
5. 启动新的 Agent 线程。
6. Agent 只依据当前上下文包和允许读取的权威材料工作。
7. Agent 输出候选 Patch、Report、Finding，或明确的 Context Gap。
8. Harness 校验结果是否仍绑定当前输入版本。

## 6. V1 已验证的技术组成

V1 已实现或实跑验证了以下组成部分：

### 6.1 Workspace Agent 启动协议

`processor-agent open` 能为新的 Codex CLI 线程注入项目根目录、当前操作协议和磁盘状态读取要求。

关键经验：

- 新线程启动后重新读取磁盘状态。
- 不依赖旧聊天历史判断当前项目状态。
- 正式状态由项目文件提供。

### 6.2 Task Envelope

V1 将任务类型、权威输入、Agent assignment、允许路径、Skill 和输出要求组织为结构化任务包。

关键经验：

- Agent 调用应有明确任务边界。
- 输入版本、权限和输出契约应一起交付。
- Agent 不应从无界仓库探索中自行推断任务。

### 6.3 Read Manifest

V1 为 Worker 指定：

```text
entryFiles
allowedRoots
excludedRoots
affectedIds
maxListedFiles
manifestSha256
```

关键经验：

- 当前任务只读取必要材料。
- 默认排除 Runtime、缓存、遗产和无关源码。
- 超范围读取应形成明确的读取缺口，而不是静默扩大权限。

### 6.4 Project Reader MCP

V1 使用受控项目读取接口代替 Shell、PowerShell、`rg` 或 `cmd` 扫描。

关键经验：

- 项目读取应是结构化能力。
- 文件访问权限必须可预检。
- Agent 不应为了理解项目而处理 Shell、路径和编码问题。

### 6.5 Skill Context

V1 根据任务注入处理器设计、Chisel 实现、验证或时序分析方法。

关键经验：

- 项目事实与任务方法必须分离。
- 权威事实来自项目文件。
- Skill 只提供方法、检查框架和输出要求。

### 6.6 Session 可替换性

V1 已确认：Agent session 可以丢失、轮换或重建；项目正确性不能依赖 provider session 的私有历史。

## 7. V2 中的技术归属

该能力属于 Agent Executor 的上下文准备部分：

```text
Agent Executor
├── Task Context Assembler
├── Provider Adapter
├── Output Validator
└── Run Recorder
```

采用 Harness 与 Skill 的组合实现。

### 7.1 Harness 职责

Harness 负责确定性工作：

```text
绑定 input commit
读取当前权威文件
计算相关 Diff
生成 Read Manifest
生成 Capability Manifest
关联 Finding 和 Evidence
限制上下文预算
记录上下文包 hash
启动 Agent
校验输出版本绑定
处理 Context Gap
```

Harness 不补充项目文件之外的处理器事实。

### 7.2 Skill 职责

Skill 负责领域方法：

```text
该任务应优先阅读哪些文档角色
推荐的阅读顺序
需要检查哪些典型机制和反例
如何判断上下文是否充分
输出应闭合哪些内容
应返回 Patch、Report 还是 Finding
```

Skill 不保存项目状态，不拥有处理器事实，也不修改 Harness 状态。

### 7.3 Provider Adapter 职责

Provider Adapter 负责：

```text
启动新的 Agent 线程
传递上下文包
提供允许的读取和编辑工具
收集事件和最终结果
处理 provider session
```

Provider session 只是运行资源，不属于项目业务状态。

## 8. Context Gap 协议

Agent 发现当前上下文不足时，不应自行无界扩大读取范围。

最小输出：

```ts
interface ContextGap {
  reason: string;
  requiredFiles?: string[];
  requiredRoots?: string[];
  requiredEvidence?: string[];
  blockedConclusion: string;
}
```

处理流程：

```text
Agent 返回 Context Gap
-> Harness 校验请求是否与当前任务相关
-> 扩展 Read Manifest
-> 生成新的上下文包版本
-> 新建或重新启动 Agent Run
```

上下文扩展必须可追踪，并继续受任务边界约束。

## 9. 核心不变量

1. 新线程不依赖旧线程聊天记录。
2. 所有项目事实可追踪到 Git commit、文件路径和原文位置。
3. 相同任务、commit、Skill、权限和预算应生成可复现的上下文包。
4. 上下文围绕当前任务收敛，不追求一次加载整个项目。
5. Harness 不在上下文包中维护第二份处理器模型。
6. Skill 提供方法，不提供项目事实。
7. Agent 需要更多材料时返回 Context Gap。
8. Agent 输出绑定输入 commit；输入漂移后不得直接应用。
9. Task Context Package 可删除、可重建、无需迁移处理器语义。
10. Agent session 不是事实源、批准对象或设计权威。

## 10. 不进入该能力的内容

该能力不负责：

```text
决定用户当前应该设计什么
定义新的处理器概念
维护 Architecture 或 Design Schema
推进 Define、Realize、Improve 状态
批准 Agent 输出
修改正式 Git ref
执行编译、测试和仿真
判断 Finding 的最终修订方案
```

这些职责分别属于用户、权威 Design、Candidate Change Protocol 和 Deterministic Runner。

## 11. 与其他底层构件的关系

```text
Git Workspace
提供冻结版本和文件内容
        |
        v
Task Context Assembler
编译当前任务上下文
        |
        v
Agent Executor
产生候选修改或认知结果
        |
        v
Candidate Change Protocol
组织评估、用户授权和晋升
```

Runner 结果、Agent Review 和用户 Finding 均可作为下一次上下文重建的输入，但必须绑定具体 commit。

## 12. 验收标准

1. 在完全没有旧线程历史的情况下，新 Agent 可以开始当前任务。
2. Agent 能说明任务目标、输入版本、允许范围和输出要求。
3. Agent 引用的项目事实均能定位到权威文件。
4. 初始上下文不包含明显无关的项目材料。
5. 缺少材料时，Agent 返回结构化 Context Gap。
6. 扩展上下文后，无需修改处理器设计或 Harness 领域状态。
7. 输入 commit 变化后，旧输出被确定性拒绝。
8. 删除上下文缓存后，可以从 Git、Task 和 Skill 完整重建。
9. 更换 Codex CLI 线程或 Provider session 不影响任务语义。
10. Harness 无需理解 Frontend、Backend、Cache、流水线或接口语义。

## 13. 精炼定义

> 从权威项目材料中，为当前聚焦任务编译一个可追踪、可复现、有界的 Agent 上下文，使任意新线程能够快速接管工作。

该能力是 V1 已验证的关键技术遗产，也是 V2 Agent Executor 的核心组成。
