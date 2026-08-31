# Processor Agent 第一版产品计划

状态：已确认的第一版实施基线

更新时间：2026-08-30

## 文档职责

1. 本文件是产品目标、产品边界、整体架构、第一版范围、里程碑和验收标准的总纲。
2. [STAGE1.md](./STAGE1.md) 是 Project Bootstrap 的权威计划。
3. [STAGE2.md](./STAGE2.md) 是 Module Development Loop 的权威计划。
4. [STAGE3.md](./STAGE3.md) 是 Optimization Loop 的权威计划。
5. 阶段计划服从本总纲，阶段内部流程以对应阶段计划为准。
6. `idea/` 保存历史构想与图示，不承担正式产品事实。

## 1. 产品定义

`processor_agent` 是产品本体。它是一个面向 Chisel 处理器开发的本地、状态化、文档驱动型工作流 Harness。

产品负责从空目录生成处理器项目，持续管理项目事实，并引导用户完成架构设计、实现和验证。用户保留架构决策权，Agent 负责源码追踪、问题闭合、产物生成和执行。

### 1.1 文档驱动原则

项目文件是产品状态的权威来源。Agent 上下文可以随时丢弃、轮换和重建。

聊天用于输入意图、讨论方案和回答设计问题。讨论结果需要晋升到项目文件后才能成为正式决策、实现约束或完成证据。任何阶段不得依赖历史对话中的隐含信息。

一次变更形成以下可追踪链路：

```text
Idea
-> Change Intent
-> Source Evidence
-> Architecture Contract / ADR
-> Design
-> Implementation Record / Git Diff
-> Verification Record
-> Experiment Conclusion
```

各类持久事实的归属：

| 内容 | 权威位置 |
|---|---|
| 来源索引、调研 Memo 和被采用结论 | `research/` |
| 整核事实、变更约束和架构决策 | `architecture/` |
| Implementation Topology、模块、字段、接口、周期和验证映射 | `design/` |
| 正式实现 | `src/` |
| 验收测试、参考模型和验证记录 | `verification/` |
| 已确认的性能、时序和资源结论 | `experiments/` |
| Change 状态、路径、哈希、审批和文档索引 | `.assistant/` |
| 原始日志、波形和生成文件 | 工作区级 `.runtime/` |
| 版本、Diff 和 baseline | Git |

每项用户决策需要写入 Contract、ADR 或 Design。每项源码改动需要关联 Change、Design revision 和验收测试。每项阶段转换需要引用已经落盘的产物及其内容哈希。

Agent 交接只传递文档路径、版本、哈希、允许路径、验收条件和待解决问题。Agent 的完整思维过程、聊天转录和重复正文不进入项目。

用户在对话中修正正式事实后，负责当前 Design 的 Shadow Align 需要通过 Harness 同步对应文档。文档同步完成前，相关 Change 不能进入下一阶段。

用户项目的人类可读文档默认使用简体中文。模块名、信号名、字段名、文件名、命令、代码和机器 Schema key 保持英文。仓库根目录 [USER_GUIDE.md](../USER_GUIDE.md) 是第一版用户操作入口，CLI 和项目资产规则变化时必须同步更新。

### 1.2 三层产品生命周期

三层结构已经确认，详细定义分别见 [STAGE1.md](./STAGE1.md)、[STAGE2.md](./STAGE2.md) 和 [STAGE3.md](./STAGE3.md)：

```text
Stage1 -> Stage2 baseline -> Stage3
Stage3 -> Architecture Change -> Stage2 -> A/B Evaluation -> Stage3
```

1. Stage1 一次性建立 ISA、Architecture、模块图、全局协议和项目结构。
2. Stage2 先通过逐项用户决策闭合 Implementation Topology，再按已批准 Implementation Unit 反复完成 Design、Implementation 和 Verification，并在 Design 批准时由用户为当前 Unit 选择验证执行模式。
3. Stage3 反复完成测量、诊断、优化假设、Change 创建和 A/B 评估。
4. Architecture Change 通过影响分析选定模块，并复用 Stage2 完成实现。
5. Verification 是 Stage2 与 Stage3 的共同门禁。

长期产品覆盖：

```text
Research -> Design -> Implementation -> Verification -> Optimization
```

第一版只交付一条完整纵向流程：

```text
创建项目
-> 引导建立 baseline
-> 冻结 baseline
-> 接收 Architecture Idea
-> 闭合 Architecture Contract
-> 形成 Design
-> 用户确认
-> 受约束实现
-> 定向验证
-> 保存证据
```

`dual_issue_demo` 是第一版生成 Profile、示范用户项目和端到端验收对象。框架通用逻辑不得包含该核的模块名、信号名、ISA 细节或流水线规则。

## 2. 第一版交付结果

用户提供：

1. 一个空目标目录。
2. 处理器项目的最小目标描述。
3. ISA、流水线和发射规则等必要决策。
4. Architecture Contract 的确认结果。

产品交付：

1. 可以独立构建和测试的 Chisel 项目。
2. 来源可追踪的 Research Memo 与采用结论。
3. 用户确认的 Architecture Overview、Contract 和 ADR。
4. Module Manifest、用户批准的 Implementation Plan 及 Architecture 到源码之间的 Design 文档。
5. baseline Core、定向测试和性能计数器。
6. 一个完整执行的 Architecture Change。
7. 一次最小 Optimization Loop。
8. 实现 Diff、测试结果、性能结果和一致性审查证据。
9. 可以暂停、恢复和重开的持久 Change 状态。

项目移除 `.assistant/` 后仍需能够构建、测试，并保留正式 Architecture、Design、源码和验证资产。

## 3. 产品形式

第一版采用本地 Workflow Harness。Harness 与 CLI 使用 TypeScript/Node.js 实现，内部按照 SDK 边界组织，本地 Web 工作台后续复用同一执行内核。

```text
CLI / Local Web
       |
       v
Processor Agent Harness
├── Project Generator
├── Project Model
├── Change Engine
├── Skill Registry
├── Policy and Gate Engine
├── Evidence Store
└── Agent Runtime Adapter
       |
       v
Coding Agent + Git + Build Tools
       |
       v
User Processor Project
```

各形式的职责：

1. Harness 是产品主体，拥有状态机、审批、权限和证据。
2. 内部 SDK 是模块边界和测试接口，第一版不承诺公共兼容性。
3. CLI 提供完整操作面，用于开发、自动化和故障恢复。
4. 本地 Web 工作台提供统一 Workspace Agent、文档审阅、决策确认、Diff 和验证结果展示。
5. MCP 与公共 SDK 留作后续适配接口。

Web 层不保存业务规则。关闭 Web 后，CLI 仍能恢复和推进同一项目。

第一版要求本机安装并登录 Codex CLI，不要求 ChatGPT 客户端。用户通过 `processor-agent` CLI 操作产品。Codex CLI 既承担交互式 Workspace Agent，也作为后台 Agent Runtime 执行结构化任务。本地 Web 工作台后续接入同一 Harness Core。

Harness Core 只依赖 `AgentRuntime` 接口。Codex 命令、认证、版本和事件格式集中在 `CodexCliRuntime` 适配器中。

## 4. 核心模块

### 4.1 Project Generator

职责：

1. 检查目标目录、Git 和本地工具链。
2. 收集最小 Project Blueprint。
3. 预览即将生成的目录、文件和命令。
4. 生成项目级 `AGENTS.md`、正式资产目录和助理状态入口。
5. 根据 Profile 引导生成 baseline 源码与验证。
6. 保证重复执行可检测、可恢复，不覆盖用户已有资产。

### 4.2 Project Model

保存可重建的机器索引：

1. 稳定 Module ID、模块、接口、信号和源码路径。
2. 流水级与主要数据流。
3. 构建、测试和 elaboration 命令。
4. Architecture、Design、源码和验证的引用关系。
5. `architecture/modules.yaml` 中的模块依赖与实施状态。

Project Model 不复制源码正文，不取代用户确认的 Architecture。

### 4.3 Change Engine

Change 是产品的主要持久工作对象：

```text
Change
├── Intent
├── Baseline Commit
├── Architecture Contract
├── Design Revision
├── Allowed Paths
├── Acceptance Tests
├── Implementation Run
└── Evidence
```

Change Engine 管理状态转换、审批哈希、版本漂移和重开流程。Agent 只能提交产物和状态转换请求。

每个状态转换请求必须携带输入文档、输出文档、内容哈希和证据路径。只存在于 Agent 上下文中的结论不能满足阶段门禁。

### 4.4 Agent Runtime Adapter

Agent Runtime Adapter 隔离具体 Coding Agent。第一版实现 `CodexCliRuntime`。Decision 级 Research Task、独立审查和独立验证通过非交互 `codex exec` 执行，并保留以下稳定操作：

```text
prepare
invoke
collect
cancel
capabilities
```

Runtime 支持两种会话：

1. Research Worker、Synthesis Worker、Static Review Worker 和 Verification Worker 使用新的短生命周期上下文，并接收结构化任务包。
2. Stage2 的两个可恢复 Windows Codex 上下文先承担 Topology Planner，再通过 `resume` 在 Shadow Align 与 Active Coding 之间轮转。Harness 持久化线程标识、角色、Implementation Unit、租约和 state epoch，Chisel 命令由 WSL Runner 执行。

Research Task 依次启动只读 Research Worker 和只读 Synthesis Worker，前者输出来源与事实 Evidence，后者只基于 Evidence 比较候选项。

新 Agent 必须能够仅依靠任务包和项目文件继续工作。Harness 不转发上一 Agent 的私有对话历史。

短生命周期 Worker 使用 ephemeral 会话、JSONL 事件和结构化输出 Schema。Stage2 模块 Agent 可以恢复会话，产品正确性不依赖其私有历史。上下文丢失时，新 Agent 必须能从项目文件重建同一角色和任务。

面向用户的 Workspace Agent 由 `processor-agent open <path>` 启动交互式 Codex。Harness 注入固定交互协议，要求 Agent 每轮查询磁盘状态并调用结构化 Harness 命令。交互会话只负责理解自然语言和展示结果，不拥有流程状态。

### 4.5 Policy and Gate Engine

确定性检查包括：

1. 当前阶段允许的读写路径。
2. 当前 Agent 允许执行的命令。
3. baseline commit、Change revision 和文件哈希。
4. Architecture Contract 是否已经确认。
5. Design 是否覆盖必需字段和验收映射。
6. Diff 是否超出授权范围。
7. 编译、测试和证据是否满足阶段门禁。

状态转换只能由 Harness 提交。

### 4.6 Evidence Store

正式实验结论进入用户项目的 `experiments/`。Harness 状态只保存命令、运行 ID、路径、哈希和结果摘要。原始日志、波形和生成 RTL 进入工作区级 `.runtime/`。

## 5. Skill 融入方式

Skill 是阶段能力包。Workflow 决定 Skill 的调用顺序，Harness 强制执行权限和门禁，项目文件提供具体事实。

任务上下文按以下顺序组装：

```text
用户当前指令
-> 项目 AGENTS.md
-> 已确认的 Architecture 与 Design
-> 当前 Change 状态
-> 当前阶段 Skill
-> 允许路径、命令与输出 Schema
-> 直接相关源码和测试
```

Harness 组装任务时扫描对应的 `skills/*/SKILL.md` 与引用 Markdown，记录：

```text
skill_id
content_hash
applicable_stages
required_inputs
expected_outputs
tool_capabilities
write_scope
gates
```

`skill_id` 与 `content_hash` 来自 Skill 本身。适用阶段、输入输出、工具能力、写入范围和门禁由产品侧 Workflow Profile 声明，第一版不要求逐个改造现有 Skill 目录。

用户项目只在 `.assistant/project.yaml` 的 Design、Implementation 和 Verification 记录中保存 Skill 名称与内容哈希，不复制 Skill 正文。第一版不另建 `skill-lock.yaml`。

### 5.1 第一版 Skill Profile

| 阶段 | 使用的 Skill | 处理方式 |
|---|---|---|
| Project Blueprint | `design-chisel-processor` | 引导闭合最小架构输入 |
| Implementation Topology | `design-chisel-processor` | 围绕当前单一 Topology Decision 调研候选并更新 Implementation Plan |
| Baseline Design | `design-chisel-processor` | 根据已批准 Implementation Plan 生成 Unit Design 草案 |
| Baseline Implementation | `design-chisel-processor`、`implement-chisel-processor` | 根据已确认设计实现源码和测试 |
| Change Design | `design-chisel-processor` | 追踪源码并闭合 Contract 与 Design |
| Change Implementation | `design-chisel-processor`、`implement-chisel-processor` | 在冻结设计与允许路径内实现 |
| Verification | `implement-chisel-processor` 中的验证规则 | Active 完成主验证，用户按 Unit 选择两个独立 Worker 或 Active 自行完成后续审查与验证 |
| Timing Trace | `trace-vivado-timing-to-rtl` | 注册，第一版关闭 |
| Timing Optimization | `optimize-chisel-fpga-timing` | 注册，第一版关闭 |

### 5.2 编排职责的产品化

双 Agent 编排不作为独立 Skill 保留。原 `orchestrate-chisel-development` 的职责按所有权拆入产品：

1. Topology Decision、Implementation Unit 状态、角色分配、租约、state epoch、审批哈希、路径权限、证据失效、重开和原子轮转由 Harness 与 Schema 强制执行。
2. Authority、当前角色、批准文档、允许路径、Stage Gate、证据字段和下一步动作由 Harness 写入每次 Agent Task Envelope。
3. Implementation Plan、Unit Design、批准哈希、实现范围、验收条件和 Verification Record 构成持久交接面，不创建独立 handoff 文件。
4. `design-chisel-processor` 与 `implement-chisel-processor` 只保留领域方法，不承担线程身份、租约或状态转换。

第一版统一使用 `.assistant/`，不使用遗产中的 `.codex/chisel-workflow/`。逐源码 `_codex.md` 规则不进入第一版项目，变更级实施记录由 Change、Design 和 Verification Record 承担。

## 6. Agent 模型

用户始终面对一个 Workspace Agent。Stage2 维护两个可恢复的 Windows Codex 上下文，先由 Agent A 承担 Topology Planner，计划批准后在 Shadow Align 与 Active Coding 之间按 Implementation Unit 轮转。Stage1 Research Task 和 Stage2 可选验证使用短生命周期 Worker，不形成新的持久角色。

### 6.1 Workspace Agent

1. 作为唯一用户交互入口。
2. Topology 阶段展示完整实施看板和一个当前 Topology Decision。
3. Module Loop 展示当前状态、Design 批准包和待确认问题。
4. 在每个 Unit 批准 Design 时，明确询问是否启动两个独立验证 Worker。
5. 不代替用户批准 Implementation Plan、Design 或选择验证模式。
6. 通过 Harness 查询和提交正式状态，不直接改写 `.assistant/`。

### 6.2 Topology Planner

1. 读取已批准 Architecture、现有源码、测试和构建组织。
2. 围绕一个当前 Topology Decision 形成候选、推荐、影响和风险。
3. 通过 Harness 更新 `design/plan.md` 中的已确认事实和未决问题。
4. 不一次性固化完整拓扑，不代替用户拍板。

### 6.3 Shadow Align

1. 读取 Architecture、Design、相关源码和测试。
2. 追踪 producer、寄存边界、consumer 和副作用。
3. 与用户闭合字段、事件、周期、优先级、异常路径和验收条件。
4. 向 Harness 提交 Design 提案，无 RTL 和测试写权限。

### 6.4 Active Coding

1. 只在当前 Unit 通过 `DESIGN_CLOSED` 后获得实现租约。
2. 读取已批准 Contract、Design 和允许路径，批准后的 Design 保持只读。
3. 只修改任务声明的源码和测试路径，完成最小实现、断言与主验证。
4. 用户选择 `active_only` 时，执行分离的静态自审和完整验证。
5. 发现设计缺口时提交带反例的 `DESIGN_REOPENED` 请求。

### 6.5 验证 Worker

每个 Unit 的 Design 批准包必须记录用户选择：

1. `independent_workers` 创建独立 Static Review Worker 和独立 Verification Worker。两个 Worker 均无正式文件写权限，可以并行执行。
2. `active_only` 不创建 Worker，由 Active Coding 完成静态自审和验证，证据不得声明独立性。
3. Harness 不继承上一 Unit 的选择，也不推断默认值。

### 6.6 租约与轮转

1. Shadow Align 可以闭合下一个 ready Unit 的 Design，Active Coding 可以实现当前 Unit，两者只允许写入互不相交的路径。
2. 任一路径同一时刻只有一个写入者，Harness 是状态、审批和正式证据投影的唯一写入者。
3. 当前 Active Unit `COMPLETE` 且 Shadow Unit `DESIGN_CLOSED` 后，Harness 原子交换两个角色与租约并递增 state epoch。
4. Static Review Worker 和 Verification Worker 不参与轮转，任务结束后释放。

## 7. 生命周期总览

| 阶段 | 目标 | 完成结果 | 权威计划 |
|---|---|---|---|
| Stage1 | 闭合全局架构并建立项目 | 已批准的 Project Blueprint、项目骨架和 Architecture Module Manifest | [STAGE1.md](./STAGE1.md) |
| Stage2 | 逐项闭合 Implementation Topology，再逐 Unit 完成设计、实现、验证与集成 | 已批准 Implementation Plan，以及可构建、可测试并冻结的 baseline 或已完成的 Change | [STAGE2.md](./STAGE2.md) |
| Stage3 | 用可复现实验证明或否定优化假设 | 带 A/B 证据的接受或拒绝结论 | [STAGE3.md](./STAGE3.md) |

跨阶段规则：

1. Stage1 只闭合全局架构和共享边界，模块内部设计进入 Stage2。
2. Stage2 负责 baseline 与 Architecture Change 的实际设计、实现和验证。
3. Stage3 选择优化方向，创建 Change，调用 Stage2，并评估结果。
4. Verification 是 Stage2 和 Stage3 的共同门禁。
5. 状态转换、审批哈希、文档引用和失败证据由 Harness 持久化。
6. 任一 Agent 无法从项目文件恢复当前工作时，流程不能进入完成状态。
7. Stage2 证明已批准 Architecture 有误时，必须冻结 Stage2 并通过正式 Architecture Rework 返回 Stage1。Stage1 新 approval 生效后，Harness 只失效已声明的 Topology Decision、受影响 Unit 及其传递消费者。

## 8. 用户项目结构

Project Generator 初次执行只生成恢复工作所需的最小结构：

```text
user_project/
├── AGENTS.md
├── architecture/
│   ├── overview.md
│   └── modules.yaml
└── .assistant/
    ├── project.yaml
    └── project-spec-history-<hash>.json.gz
```

其余实体按首次正式内容延迟创建：

1. 首次调研创建 `research/`。
2. 首次 Stage2 Topology Decision 创建 `design/plan.md`；首次 Unit Design 创建 `design/<unit-id>.md`。Stage1 已批准的 `architecture/modules.yaml` 在 Stage2 保持只读。
3. 首次架构变更创建 `architecture/contracts/` 与 `architecture/decisions/`。
4. 首次实现创建 `src/`，首次形成正式验证证据时创建 `verification/`。
5. 首次优化创建 `experiments/`，其下分类目录也按内容创建。
6. `project-model.json` 和 `.assistant/changes/` 在对应状态首次产生时创建。

不生成空目录。Research、Architecture、Design、源码、验证与确认后的实验结论是项目正式资产。`.assistant/` 保存状态与引用。调研原始下载和临时检索结果进入工作区级 `.runtime/`。

## 9. 框架目录

当前实现采用以下最小物理结构：

```text
processor_agent/
├── AGENTS.md
├── README.md
├── PRODUCT_PLAN/
│   ├── PRODUCT_PLAN.md
│   ├── STAGE1.md
│   ├── STAGE2.md
│   └── STAGE3.md
├── idea/                 前期构想与图示，不承担正式产品事实
├── skills/               通用领域方法
├── package.json
├── tsconfig.json
├── src/                  TypeScript 执行内核与 CLI，初期保持扁平
├── profiles/             项目生成 Profile
└── tests/                状态机、生成器和最小端到端测试
```

npm 与 `package-lock.json` 已在 M0 冻结。`src/` 初期只承载入口、Harness、Codex CLI Runtime 和 WSL Runner 等实际代码。实现规模允许时合并文件。`dual_issue_demo` 的专属事实进入 `profiles/dual_issue_demo/profile.yaml`，通用逻辑不得依赖该路径中的具体字段。

新实体需要满足至少一项条件：

1. 两个以上文件具有共同生命周期。
2. 具备独立所有权或独立加载边界。
3. 运行时需要通过固定路径发现。
4. 现有类型、函数或文档章节无法清晰承载该职责。
5. 删除该实体会破坏构建、恢复、验证或权威事实。

第一版只有一个公开任务结果类型时，将其定义在 TypeScript 代码中。出现多个需要独立版本管理的公开 Schema 后再创建 `schemas/`。接入第二种 Agent Runtime 后再创建 `adapters/`。出现第二条可独立配置的工作流后再创建 `workflows/`。本地 Web 实施时再创建对应目录。包清单、锁文件、`src/`、`profiles/` 和 `tests/` 已随 Stage1 实现创建。

## 10. 用户入口

当前 Stage1 CLI 操作面：

```text
processor-agent open <path>
processor-agent stage1 init <path>
processor-agent stage1 status <path>
processor-agent stage1 next <path>
processor-agent stage1 research <path> [decision-id]
processor-agent stage1 advise <path>
processor-agent stage1 answer <path> <decision-id> <option-id>
processor-agent stage1 custom <path> <decision-id>
processor-agent stage1 defer <path> <decision-id>
processor-agent stage1 reopen <path> <decision-id> --reason <reason>
processor-agent stage1 correct <path> <finding-code> [finding-code...] --proposal-json <json>
processor-agent stage1 correction-migrate <path> --dry-run|--apply
processor-agent stage1 release-override <path> <project-spec-target>
processor-agent stage1 probe <path>
processor-agent stage1 profile-refresh <path>
processor-agent stage1 review <path>
processor-agent stage1 audit <path>
processor-agent stage1 approve <path>
processor-agent stage1 scaffold <path>
processor-agent stage1 complete <path>
```

当前 Stage2 CLI 操作面：

```text
processor-agent stage2 init <path>
processor-agent stage2 migrate <path>
processor-agent stage2 status <path>
processor-agent stage2 next <path>
processor-agent stage2 plan <path> [decision-id]
processor-agent stage2 answer <path> <decision-id> <option-id>
processor-agent stage2 custom <path> <decision-id>
processor-agent stage2 topology-reopen <path> <decision-id> --reason <reason>
processor-agent stage2 rework-start <path> --proposal-json <json>
processor-agent stage2 rework-resume <path>
processor-agent stage2 review <path>
processor-agent stage2 approve-plan <path>
processor-agent stage2 design <path> [unit-id]
processor-agent stage2 approve <path> <unit-id> --verification-mode <mode>
processor-agent stage2 implement <path> [unit-id]
processor-agent stage2 verify <path> [unit-id]
processor-agent stage2 reopen <path> <unit-id> --reason <reason>
```

完整产品后续扩展为：

```text
processor-agent init <path>
processor-agent status
processor-agent change create
processor-agent change run
processor-agent change approve
processor-agent change reopen
processor-agent verify
```

本地 Web 工作台提供：

1. 当前 Project、baseline commit、Change 和阶段。
2. Workspace Agent 对话与待解决设计问题。
3. Architecture Contract 与 Design 审阅。
4. 用户批准、重开和继续执行操作。
5. 源码依据、Diff、测试和性能证据。

## 11. `dual_issue_demo` Profile

第一版验收 Profile 生成一个具有明确优化空间的顺序双发射 Chisel Core。

最小特征：

1. 五级左右的顺序流水线。
2. Lane 0 始终比 Lane 1 年老。
3. Lane 0 支持完整 Demo 指令子集，Lane 1 只支持简单 ALU。
4. 每周期最多一条访存或控制流指令。
5. 已有跨周期 forwarding。
6. baseline 禁止所有同拍 `lane0 -> lane1` RAW 配对。
7. 提供周期数、退休数、双发射数和目标配对数计数器。
8. Verilator 可以运行定向测试和小型 benchmark。

首个 Architecture Change：

> 允许能够由同拍 ALU 前递解决的 `lane0 -> lane1` RAW 依赖继续双发，在保持程序顺序和正确性的前提下提高 IPC。

Product 与 Direct Codex 从同一个冻结 commit 开始。Product 使用完整 Harness 流程，Direct Codex 只接收原始需求和相同工具预算。

## 12. 第一版范围

第一版包含：

1. Project Blueprint 与项目生成。
2. Project Model。
3. Project 和 Change 状态机。
4. Module Manifest、Stage2 Topology Decision Loop 与 Unit 开发循环。
5. Skill Registry 与固定 Architecture Change Profile。
6. `CodexCliRuntime` Agent Runtime Adapter。
7. Workspace Agent、Topology Planner、可轮转的 Shadow Align 与 Active Coding，以及按 Unit 可选的两个验证 Worker。
8. 三级信息处理与架构决策审批。
9. 路径权限、Diff 检查和确定性验证门禁。
10. CLI 与最小本地 Web 工作台。
11. `dual_issue_demo` 生成、baseline 冻结和 Architecture Change。
12. 最小 Stage3 Optimization Loop。
13. Direct Codex 对照与只读 Evaluator。

第一版不包含：

1. 完整论文与参考核 Research 流程。
2. Vivado 时序闭合与自动 PPA 优化。
3. 自动设计空间搜索。
4. 多模块并行实现和同一路径的多 Agent 写入。
5. 多种 RTL 语言和多种构建系统。
6. 远程云执行、团队权限和账号系统。
7. Skill 市场与第三方插件生态。
8. 完整 IDE 功能。

## 13. 实施里程碑

### M0：规则冻结与 Skill 审计

1. 固定产品状态机和项目资产边界。
2. 审计 5 个现有 Skill 的通用规则与遗产耦合。
3. 固定 Node.js 版本、包管理器、状态格式和 Codex CLI 兼容策略。

完成标准：固定 Task Envelope、Change Schema 和第一版 Skill Profile。

### M1：确定性 Project Generator

1. 实现 `processor-agent init`。
2. 生成项目结构、Git 和项目级 `AGENTS.md`。
3. 支持预览、幂等检查和已有目录保护。

完成标准：在临时空目录重复生成，结果稳定且无未授权覆盖。

### M2：Harness Core

1. 实现 Project 和 Change 状态机。
2. 实现持久状态、revision、哈希和审批。
3. 实现路径能力和状态恢复。

完成标准：使用 Fake Agent 完成全部正常与异常转换测试。

### M3：Skill 与 Agent Runtime

1. 实现 Skill Registry 和内容锁定。
2. 实现第一个 Agent Runtime Adapter。
3. 实现 Shadow Align、Active Coding 与验证 Worker Task Envelope。
4. 实现两个可恢复 Windows Codex 上下文的角色轮转与租约检查，并使用 WSL Runner 执行 Chisel 命令。

完成标准：两个可恢复上下文能够按权限轮转，Harness 可以拒绝越权结果，短生命周期 Worker 不获得正式文件写权限。

### M4：Guided Baseline

1. 实现 `dual_issue_demo` Profile。
2. 引导用户闭合最小 Architecture 与 Design。
3. 建立 Research Memo 和 Module Manifest。
4. 通过逐项用户讨论确认 Implementation Unit、Interface owner、源码拓扑、DAG 和实施 wave。
5. 批准 `design/plan.md` 并展示完整 Stage2 实施看板。
6. 以首个 ready Unit 完成第一条 `Design -> Implementation -> Verification` tracer。
7. 通过 Stage2 生成 baseline Core、测试和性能计数器。
8. 验证并冻结 baseline commit。

完成标准：从空目录生成可运行 baseline，重启 Harness 后可以恢复。

### M5：Architecture Change

1. 从原始 Idea 生成 Contract 与 Design。
2. 完成用户确认门禁。
3. 完成受约束实现、验证和一致性审查。

完成标准：在禁止手工修改 Harness 状态的条件下完成 `CHG_0001`。

### M6：Optimization Loop 与对照演示

1. 记录 baseline、优化假设和用户选择。
2. 从同一 baseline 创建 Product 与 Direct Codex 分支。
3. 固定模型、推理强度、工具、时间预算、测试和 benchmark。
4. 完成 A/B 验证并保存 Optimization 结果。
5. 使用只读 Evaluator 评分。

完成标准：输出可复现的正确性、性能、架构忠实度、修改边界、时序代价、验证质量和文档一致性结果。

## 14. 第一版验收标准

第一版完成需要同时满足：

1. `processor_agent` 可以从空目录生成 `dual_issue_demo`。
2. 生成过程由 Project Blueprint 驱动，框架核心没有 Demo 专属硬编码。
3. 用户可以暂停、关闭并恢复当前项目和 Change。
4. Shadow Align 无法通过正常工具写入源码和测试。
5. Active Coding 的 Diff 受到允许路径约束，批准后的 Design 保持只读。
6. 用户审批绑定具体 Contract 与 Design 哈希。
7. 设计文件变化会自动触发重新对齐。
8. 设计缺口可以从 Implementation 返回 Design。
9. 测试失败不能进入 `COMPLETE`。
10. Skill 名称、内容哈希、模型、命令、种子和证据均可追溯。
11. Product 与 Direct Codex 使用相同 baseline 和实验预算。
12. 删除 `.assistant/` 不影响生成项目的独立构建与正式文档。
13. 清空全部 Agent 上下文后，新 Agent 可以从项目文件恢复当前 Change。
14. 每项已实现行为都能追踪到 Design、Contract 或 baseline Architecture。
15. 每项用户决策都能在 Contract、ADR 或 Design 中定位。
16. 每个 Architecture Module 都能通过已批准 Implementation Plan 追踪到 primary Unit、Design、源码和验证。
17. Stage3 结果包含 baseline、优化假设、对应 Change、A/B 证据和接受结论。
18. 未安装 ChatGPT 客户端时，产品仍能完成第一版完整流程。
19. 每个 Unit 都保存用户明确选择的 `verificationMode`，且不继承上一 Unit 选择。
20. `independent_workers` 必须留下两个独立 Worker 的执行证据，`active_only` 不得被表述为独立验证。
21. Implementation Topology 由多个单项用户 Decision 逐渐闭合，Agent 不能一次性提交完整拓扑并代替用户确认。
22. Stage2 Module Loop 只能使用已批准 `design/plan.md` 中的 Unit、Interface owner、源码拓扑和 DAG。
23. Stage2 状态必须向用户展示全部 Unit、依赖、wave、Design revision、源码归属、验证状态、Agent 角色和 blocker。
24. Stage2 Architecture Rework 必须冻结旧租约，返回 Stage1 形成新 approval，并对受影响 Topology Decision、Unit 及传递消费者执行可审计失效。未受影响 Unit 的状态和证据不得被清空。
25. Review Correction 必须区分 findingSource 与 Evidence，按目标记录覆盖关系，并使用可重放的增量历史。v1 迁移必须支持不写状态的 dry-run。

## 15. 技术基线与剩余待定事项

已确认的技术基线：

1. Harness 与 CLI 使用 TypeScript/Node.js。
2. Codex CLI 通过 Agent Runtime 边界接入。
3. 第一版运行不依赖 ChatGPT 客户端。
4. Node.js 最低版本为 22，包管理器为 npm，锁文件为 `package-lock.json`。
5. 机器状态与 Profile 使用 YAML，Agent 结构化输出与审查报告使用 JSON。
6. 当前验证基线使用 Codex CLI `0.151.0`。后台结构化任务通过 `codex exec` 调用，Workspace Agent 通过 `processor-agent open` 启动交互式 Codex。
7. `dual_issue_demo` 采用 Windows Control Plane 和 WSL Execution Runner，当前只支持盘符路径到 `/mnt/<drive>/` 的转换。
8. Chisel 项目骨架固定 Scala `2.13.18`、Chisel `7.14.0` 和 SBT `1.12.11`。
9. 用户项目默认生成中文 Architecture、Research、Verification 和严格版 `AGENTS.md`。
10. Stage1 Decision 声明 `researchPolicy`。Research Request、指纹、Evidence、run ID、Worker thread ID 和证据充分性由 Harness 落盘。
11. Review Correction v2 的当前 ProjectSpec 和 compact index 保存在 `.assistant/project.yaml`，基线与增量事件保存在同目录的内容寻址压缩 sidecar。Harness 加载时校验路径、大小、哈希和完整重放结果。

剩余实现选择：

1. Codex CLI 的长期最低版本和 JSONL 向后兼容策略。
2. 本地 Web 与 Harness 使用进程内 API、HTTP 或 stdio 协议。
3. 非盘符 Windows 路径、WSL 发行版选择和单实例锁策略。
4. 命令中断期间的多文件事务恢复策略。

这些选择不能改变本计划中的产品边界、项目资产归属和 Change 门禁。
