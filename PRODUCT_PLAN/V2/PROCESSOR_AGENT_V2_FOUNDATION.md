# Processor Agent V2 产品基础与技术内核

状态：讨论基线  
日期：2026-09-01  
适用范围：V2 产品定义、技术内核和后续架构设计

## 0. 文档职责

本文记录当前已经形成的产品结论，作为 V2 后续设计的约束基线。

本文暂不定义：

- Define、Realize、Improve 的具体界面和导航形式；
- 工作台如何呈现核心闭环；
- Skill 的最终目录、命名和数量；
- Ledger 的具体存储介质；
- 多 Agent 并发策略；
- V1 到 V2 的完整迁移方案。

本文中的技术名称是工程抽象，不自动成为用户必须理解的产品概念。

---

## 1. 产品定位

> Processor Agent 是一个 AI-native、文档驱动、由处理器设计师主导的处理器设计工作台。它协助用户明确自己想要怎样的处理器，把 idea 落实为架构和微架构设计，再把经用户确认的设计落实为实现、验证和修订证据。

产品的核心角色关系：

- 用户拥有处理器目标、设计概念、设计事实、关键取舍和最终批准权；
- Agent 负责调研、候选分析、设计协作、缺口发现、实现、验证和文档维护；
- Harness 负责版本、权限、事务、运行和授权；
- Runner 负责确定性的工程命令执行；
- Git 保存正式工程事实和版本历史。

AI-native 表示 AI 深度参与设计活动，不表示 Agent 主导设计或自主决定产品边界。

---

## 2. 三类所有权

### 2.1 处理器设计权

处理器设计师拥有：

- 处理器目标和成功条件；
- 新处理器概念的引入；
- Architecture 和 Design 中的关键事实；
- 性能、面积、时序、复杂度和验证成本之间的取舍；
- 对候选设计和实现的批准、拒绝或修订决定。

用户主导不只表示最终确认。用户应能直接提出问题、定义边界、修改文档和改变 Agent 的候选方案。

### 2.2 产品概念权

产品所有者拥有：

- 产品一级概念；
- 产品边界；
- 持久实体；
- 阶段和用户门禁；
- 权威关系；
- Harness 的长期状态模型。

Agent 发现产品缺口时，应提交问题证据、复现条件、现有机制的不足和候选方向。以下变化必须由产品所有者明确设计和确认：

- 新持久实体；
- 新长期状态；
- 新 Stage、Gate 或用户流程；
- 新 Artifact 类型；
- 新用户必须理解的名词；
- 新恢复机制；
- 新事实权威来源。

执行过程中的简单确认不能自动晋升为产品概念决定。

### 2.3 正式事实权

正式工程事实存在于 Git 跟踪的材料中：

```text
Architecture
Design
Source
Verification
```

其中处理器建模主要存在于龙芯杯-style Design 中。Harness 不保存第二份处理器模型。

---

## 3. 龙芯杯-style Design 原则

V2 继承龙芯杯设计材料中已经验证有效的信息组织方式：

```text
整核
-> 子系统
-> 模块与内部机制
-> 跨模块约定
-> 指令、数据或状态的生命周期
```

Design 应支持：

- README 或入口文档；
- 总纲；
- 概述；
- 外部约定；
- 按处理器逻辑拓扑组织的子系统和模块文档；
- load、store、flush、redirect、replay 等跨模块生命周期文档；
- 图、时序图、状态机和接口表；
- ADR，用于记录为什么作出某项选择；
- Verification 材料，用于记录如何检查设计。

每类文档围绕真实设计问题组织，不强制使用统一大型 Proposal Schema。

### 3.1 单一当前设计

`Design/` 保存当前权威设计。旧版本由 Git 历史保存。

以下目录模式不进入 V2：

```text
FinalDesign/
NewDesign/
DesignV2/
DesignBackup/
```

龙芯杯项目中的 `FinalDesign/` 是决赛工期压力造成的文档管理分叉，不是应继承的设计成熟度模型。

ADR 记录“为什么”，当前 Design 记录“现在是什么”。候选修改在隔离 worktree 或 candidate commit 中形成，批准后回写当前 Design。

---

## 4. V1 暴露出的十个严重问题

1. **产品边界过早扩张**：核心价值尚未验证，已经同时建设处理器建模、状态机、多 Agent Runtime、迁移、返工和优化基础设施。
2. **设计事实所有权倒置**：Project Model、Schema 和 Renderer 成为事实源，Design 退化为机器状态投影。
3. **Human Approval 退化**：用户面对大型 Proposal 连续 `confirm`，批准不能证明设计理解。
4. **Design 信息架构失效**：Work Package、路径、状态和 Schema 主导文档，龙芯杯式人类阅读路径未进入产品。
5. **Domain、Control、Runtime 混合**：处理器事实、流程状态和运行状态进入同一个超级状态对象。
6. **结构正确替代语义正确**：Schema、引用、路径和 hash 通过，仍不能证明微架构机制正确。
7. **可实现性检查过晚**：接口方向、可观测性和周期闭合问题在 Implementation 才被发现。
8. **状态与返工补丁式增长**：新的异常持续产生新的状态、恢复命令、迁移和反馈回路。
9. **Runner 边界不足**：PowerShell、WSL、权限、认证、路径、编码和工具链失败污染设计流程。
10. **产品价值证据不足**：尚未证明 Harness 相比直接使用 Agent 能缩短周期、提高 Architecture Fidelity 或降低返工。

---

## 5. V1 确认的十条重要边界和成果

1. 本地、Git 化、文档驱动的处理器工作区是可行产品形态。
2. Define、Realize、Improve 对用户理解设计活动有宏观组织价值。
3. Define 负责明确“做什么处理器”，Realize 负责“如何设计、实现和验证”，Improve 负责基于测量证据改进。
4. Architecture Role、Design 结构、源码模块和执行任务必须分离。
5. Agent 上下文可丢弃；正式材料必须支持新 Agent 接管。
6. 用户只应被高影响、不可逆或重要取舍问题打断。
7. 独立 Author、Reviewer、Research 和 Verification 角色可以提高证据质量。
8. 精确版本绑定、Approval、漂移检查和 stale result 拒绝是必要机械门禁。
9. 实现和验证发现问题后，必须有正式、可追踪、可恢复的材料修订机制。
10. Agent Runtime 和工程 Runner 需要受限输入、可观察运行、不可变结果、超时和真实取消。

V1 的负面证据进一步确认：处理器建模不能进入 Harness，Design 必须成为直接权威。

---

## 6. 宏观阶段的定位

```text
Define
Realize
Improve
```

三者是面向用户目标的宏观工作视图，不是 Harness 的核心领域模型。

三个阶段共同使用相同的底层技术内核。阶段差异由以下内容表达：

- 当前目标；
- 输入材料；
- 使用的 Skill；
- 输出契约；
- 用户定义的完成条件。

Harness 不持久化组合式 Stage 状态，不为每个 Stage 建设独立 Runtime、Runner、Evidence Store 或修正机制。

核心材料关系可概括为：

```text
Idea
-> Architecture
-> Design
-> Source + Verification
-> Evidence
-> 用户主导的 Revision
```

该关系是产品价值链，不是固定状态转换链。

---

## 7. V2 底层技术内核

```text
Git Workspace Substrate
+ Candidate Change Protocol
+ Agent Executor
+ Deterministic Runner
```

Thin Harness 机械协调以上四项。

四项构件不处于完全相同的层次：

- Git Workspace 是事实底座；
- Candidate Change Protocol 是变更与授权协议；
- Agent Executor 是概率性认知执行器；
- Deterministic Runner 是确定性工程执行器。

---

## 8. Git Workspace Substrate

### 8.1 定义

基于 Git 的内容寻址版本库与隔离工作区服务。

### 8.2 输入

```text
baseCommit
pathScope
文件编辑或 Patch
```

### 8.3 输出

```text
candidateCommit
diff
冲突或漂移报告
```

### 8.4 能力

- 读取指定 commit；
- 创建隔离 worktree；
- 获取 diff；
- 将多文件修改物化为 candidate commit；
- 校验 base commit；
- 检查修改路径范围；
- 原子更新正式 ref；
- 清理隔离 worktree。

### 8.5 持久状态

```text
commit
tree
blob
ref
```

### 8.6 不变量

1. 每次修改绑定明确的 `baseCommit`。
2. 一组多文件修改由一个 candidate commit 表达。
3. 正式版本推进使用 compare-and-swap。
4. 正式 ref 已变化时，旧 candidate 不能直接晋升。
5. 批准后不自动 rebase、merge 或修改内容。
6. Git 层不解释处理器语义。

### 8.7 Agent 参与边界

Agent 可以：

- 在隔离 worktree 中编辑文件；
- 产生候选 Patch；
- 解释 diff；
- 冲突后基于最新版本重新生成候选修改。

Agent 不参与：

- 版本身份判定；
- base commit 校验；
- 冲突判定；
- 原子 ref 更新；
- 正式提交晋升；
- 批准后的智能合并。

---

## 9. Candidate Change Protocol

### 9.1 定义

将候选版本、评估结果和用户授权绑定到同一个 commit 的变更协议。

### 9.2 标准过程

```text
baseCommit
-> edit
-> candidateCommit
-> evaluate
-> userDecision
-> promote | reject
```

编辑者可以是用户、Agent、IDE 或其他工具。

### 9.3 最小决定记录

```ts
interface CandidateDecision {
  candidateCommit: string;
  decision: "approved" | "rejected";
  decidedBy: string;
  decidedAt: string;
  evaluationRefs: string[];
}
```

### 9.4 不变量

1. Candidate 的身份是 commit hash。
2. Candidate 的基线是其 parent commit。
3. Candidate 的内容是 parent 与 candidate 的 Git diff。
4. Review、Finding、Evidence 和 Approval 全部绑定精确 commit。
5. Candidate 内容变化后必须产生新 commit。
6. 用户批准后，正式晋升的 commit 必须与批准对象完全相同。
7. Candidate 的 parent 不再等于当前正式 ref 时，Candidate 进入 stale 关系，需要重新生成、评估和批准。
8. `stale` 由版本关系计算，不维护复杂状态。

### 9.5 协议职责

- 登记 candidate；
- 关联评估结果；
- 记录用户批准或拒绝；
- 调用 Git Workspace 原子推进正式 ref；
- 拒绝基于旧正式版本的 candidate。

协议不判断设计是否正确，也不决定应修改 Architecture、Design、Source 或 Verification。

---

## 10. Agent Executor

### 10.1 定义

在冻结版本和受限能力范围内执行概率性认知、分析和生成任务的执行器。

### 10.2 输入

```ts
interface AgentTask {
  inputCommit: string;
  instruction: string;
  readScope: string[];
  writeScope: string[];
  tools: string[];
  skills: string[];
  outputContract: string;
}
```

### 10.3 输出

- 隔离 worktree 中的文件修改；
- Research Report；
- Review Report；
- Finding；
- 分析建议；
- 结构化运行失败。

### 10.4 适用任务

```text
Research
Design Assistance
Implementation
Review
Diagnosis
Optimization Analysis
```

这些任务共享同一个 Executor，通过 Skill、输入范围、能力清单和输出契约区分。

### 10.5 最小运行记录

```text
taskId
inputCommit
runId
resultPath
resultHash
runStatus
optional sessionRef
```

### 10.6 不变量

1. Agent 输入绑定不可变 commit。
2. 文件修改只发生在隔离 worktree。
3. 读取和写入范围受 Task 限制。
4. Agent 不能更新正式 ref。
5. Agent 不能批准候选版本。
6. Agent 结果必须绑定 `inputCommit`。
7. 输入漂移后，结果不能直接应用。
8. Agent 输出始终是候选修改或评估材料。
9. Agent 不得自行增加产品一级概念或长期 Harness 状态。

---

## 11. Deterministic Runner

### 11.1 定义

在受控环境中，对指定 commit 执行预注册工程命令的确定性执行器。

### 11.2 输入

```ts
interface RunnerTask {
  inputCommit: string;
  commandId: string;
  capabilityManifest: string;
  environmentSpec: string;
}
```

### 11.3 输出

```ts
interface RunResult {
  inputCommit: string;
  commandId: string;
  commandSpecHash: string;
  toolchainDigest: string;
  exitCode: number;
  stdoutPath: string;
  stderrPath: string;
  resultPath: string;
  resultHash: string;
  startedAt: string;
  completedAt: string;
}
```

### 11.4 能力

- 环境和权限预检；
- 创建隔离 worktree；
- 执行预注册命令；
- 编译；
- 仿真；
- 测试；
- 综合；
- 性能测量；
- 流式日志；
- 超时；
- 取消和进程树终止。

### 11.5 不变量

1. Runner 只执行预注册 `commandId`。
2. Agent 不能提供任意 executable、cwd 或 shell 命令。
3. 每个结果绑定输入 commit、命令定义和工具链版本。
4. Run Result 生成后不可修改。
5. Runtime Failure 只影响本次 Run。
6. Runner 不判断处理器设计应如何修订。

---

## 12. Thin Harness

### 12.1 定义

协调 Git Workspace、Candidate Change Protocol、Agent Executor 和 Deterministic Runner 的低状态控制层。

### 12.2 职责

- 创建隔离 worktree；
- 冻结输入 commit；
- 派发 Agent Task；
- 派发 Runner Task；
- 将编辑结果物化为 candidate commit；
- 收集绑定 commit 的评估结果；
- 记录用户批准或拒绝；
- 原子推进正式 ref；
- 维护 Agent 和 Runner 的 Run Ledger；
- 处理取消、超时和必要恢复。

### 12.3 最小持久状态

Git 已保存：

```text
正式版本
候选版本
文件内容
Diff
历史
版本关系
```

Harness 额外保存：

```text
用户决定记录
Agent / Runner Run Ledger
结果文件位置和 hash
活动进程所需的取消与恢复信息
```

### 12.4 禁止进入 Harness 的内容

- Architecture Role；
- 处理器模块和组件模型；
- 接口字段和方向；
- 状态所有权；
- 流水级和周期行为；
- flush、redirect、retry、replay 等处理器语义；
- Design 目录结构；
- Work Package 处理器拓扑；
- 设计修订层级判断；
- Stage 专用状态机；
- 由机器维护的第二份处理器事实。

### 12.5 状态最小化原则

Harness 只持久化无法从 Git 和不可变运行结果重建的机械事实。

判断新状态是否合理：

```text
它是在记录已经发生的客观事实，
还是在规定设计接下来必须怎样进行？
```

前者可能进入 Harness；后者通常由用户、Design 和当前任务决定。

---

## 13. Review、Finding、Evidence

三者是绑定 commit 的结果材料，不构成独立执行器或独立状态机。

### Review

对一个冻结 commit 的评估活动。执行者可以是用户、Agent 或 Runner。

### Finding

评估中发现的问题记录，至少绑定：

```text
subjectCommit
targetPath
source location
observation
evidence reference
```

Finding 不自动决定修订层级或修复方案。

### Evidence

对一个 commit 的观察结果及其来源绑定。来源可以是 Agent、Runner、外部规范或用户确认。

```ts
interface Evaluation {
  subjectCommit: string;
  producer: "human" | "agent" | "runner";
  resultPath: string;
  resultHash: string;
  findingRefs: string[];
}
```

Evidence 提供依据。用户决定是否修订、修订什么和接受什么取舍。

---

## 14. Harness、Skill、Adapter 和配置的组织边界

```text
Harness Kernel
├── Candidate Change Protocol
├── Authorization Record
├── Run Ledger
└── Executor Ports

Adapters
├── Git Adapter
├── Agent Provider Adapter
└── Runner Adapter

Skills
├── 处理器设计方法
├── Chisel 实现方法
├── 设计审查方法
├── 调研方法
└── 性能分析方法

Workspace Configuration
├── Command Registry
├── Toolchain Configuration
├── Capability Policy
└── Directory Conventions
```

### 14.1 Harness

负责版本、权限、事务、运行和授权。

### 14.2 Skill

无持久状态的方法包。Skill 定义：

- 任务目的；
- 建议读取的材料；
- 分析方法；
- 典型反例；
- 输出契约；
- 需要请求的工具能力；
- 可选 Runner command ID。

Skill 不得：

- 写正式 ref；
- 记录 Approval；
- 修改 Harness 状态；
- 自行扩大权限；
- 执行任意 shell；
- 定义新的产品状态；
- 决定用户是否接受设计。

### 14.3 Adapter

隔离具体 Git、模型 Provider 和执行环境。

### 14.4 Workspace Configuration

保存工具链、命令、环境和能力配置。Skill 只能请求已注册命令 ID，不能提供任意可执行命令。

---

## 15. 当前核心不变量

1. 正式工程事实由 Git commit 标识。
2. 龙芯杯-style Design 是处理器当前设计权威。
3. Harness 不保存处理器模型。
4. 所有正式修改先形成 candidate commit。
5. 所有 Review、Finding、Evidence 和 Approval 绑定精确 commit。
6. 只有用户批准的 candidate 可以晋升为正式版本。
7. 批准后的正式版本必须与被批准的 commit 完全相同。
8. Agent 可以编辑内容，不能控制版本事务和正式晋升。
9. Runner 只执行预注册命令，并返回不可变结果。
10. Runtime Failure 不修改 Architecture、Design、Source 或 Verification。
11. Define、Realize、Improve 不进入 Harness 的核心持久状态。
12. Work Package 和 Agent 调度不决定 Design 信息架构。
13. Evidence 只提供依据，Revision 由用户主导。
14. 新产品概念由产品所有者定义，Agent 只提供问题证据和候选分析。
15. 可从 Git 或结果文件计算的状态不重复持久化。

---

## 16. 当前未决定事项

以下内容保持开放，不由 Agent 自动固化：

1. 用户直接编辑如何进入 candidate commit 流程；
2. Approval、Rejection 和 Run Ledger 使用 SQLite、Git notes、签名 tag 还是 append-only 文件；
3. authority ref 和 candidate ref 的具体命名；
4. worktree 生命周期和垃圾回收规则；
5. Skill 的最终格式和加载方式；
6. Agent 输出采用 worktree 编辑、统一 Patch 还是两者并存；
7. Review Result 和 Finding 的最小结构；
8. Runner Command Registry 的配置格式；
9. Define、Realize、Improve 的具体组织和呈现形式；
10. 核心闭环在工作台中的导航方式；
11. 多 Agent 并发是否进入默认产品能力；
12. V1 正式材料和运行证据的迁移范围。

---

## 17. 一句话架构

> Git 保存工程事实，Candidate Change Protocol 管理候选版本的评估、授权和晋升，Agent Executor 执行认知任务，Deterministic Runner 执行工程命令，Thin Harness 只负责机械协调；处理器设计始终由用户和龙芯杯-style Design 主导。
