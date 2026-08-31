# Stage2 Guided Implementation 计划

状态：schemaVersion 3 的 Implementation Topology Decision Loop、Unit Loop 与 Architecture Rework 已实现

上位文档：[PRODUCT_PLAN.md](./PRODUCT_PLAN.md)

更新时间：2026-08-31

## 1. 阶段目标

Stage2 先与用户逐项闭合 Implementation Topology，再按 Implementation Unit 推进 `Design -> Implementation -> Verification`，逐步生成可构建、可验证的 baseline，并供后续 Architecture Change 复用。

Stage2 的输入是 Stage1 已批准的 Architecture Snapshot，或 Stage3 创建并完成影响分析的 Architecture Change。Stage2 不自行改变 ISA、全局流水边界、Architecture Role 和共享语义。

Stage1 批准的 `architecture/overview.md` 和机器 ProjectSpec 提供 Architecture Role、全局语义和验证完成条件。Stage2 通过用户参与的拓扑决策循环形成 Implementation Unit、Architecture Role 映射、共享接口所有权、源码组织、无环实施依赖和实施 wave。Architecture Role 与 Implementation Unit 不要求一一对应。

当前 Harness 已实现 schemaVersion 3 的 Topology Decision Loop、独立 Topology Research Worker、可恢复 Planner、单 Decision Packet、option 与 custom 提交、传递失效与 reopen、`design/plan.md` 投影、结构审查和批准哈希、完整 Unit 看板、旧 Module Loop 显式迁移、批准 Plan 驱动的 Design、Implementation、Verification 循环，以及 Stage2 返回 Stage1 的 Architecture Rework。Implementation Topology 只由 Stage2 拥有。

`dual_issue_demo` 已迁移到 schemaVersion 3。旧 schemaVersion 2 Topology 已失效并按 Architecture Role 重建，旧 Decision 只保留迁移索引，旧 Unit 边界未自动晋升。当前 Stage2 revision 8 因活动的 `S2_ARW_001` 保持 `BLOCKED`，等待 Stage1 重新审查和用户批准。

2026-08-30 实现证据：

1. `npm test` 覆盖 Stage1 与 Stage2 共 55 项测试。Stage2 覆盖单 Topology Decision、Research 证据门禁与显式刷新、用户调研关注点隔离、Planner 禁止代替用户确认、候选结构化投影、部分 Unit 看板、传递 reopen、DAG 成环拒绝、旧状态显式迁移、Decision 与 ProjectSpec 两类 Architecture Rework、Stage1 新批准门禁、Unit 传递失效和无关 Unit 证据保留，并保留 regfile tracer、角色轮转、两种验证模式、Design 漂移、路径唯一归属、越权路径、验证副本篡改、并发过期结果和 Project Reader MCP 测试。
2. `dual_issue_demo` 的 `S2_TOP_001` 独立 Research Worker 运行 ID 为 `2026-08-30T13-28-04-579Z-1e843d23-cd18-44e4-80b2-a0cc2c6b461d`，线程为 `01a052db-1639-71f2-b802-1a5315374528`，记录 9 个来源和 19 条事实，`evidenceSufficient=true`。
3. 同一 Decision 的可恢复 Planner 首次运行 ID 为 `2026-08-30T13-30-09-816Z-6a3b5756-0899-4b1c-91a2-ddb3a231514e`，当前候选完整投影运行 ID 为 `2026-08-30T13-37-05-549Z-0ef7566e-b0b8-4532-ab7f-77333c679c35`，两次使用同一线程 `01a052dc-feb7-77d2-bf4a-5913d52e8065`。它形成一一映射、合并 `core/control`、按闭环域合并三个候选，Harness 未自动提交推荐。
4. schemaVersion 1 的真实 Shadow Design 两次运行保留为迁移前实验索引，不能作为当前 Plan 或 Unit Design 的批准依据。运行 ID 分别为 `2026-08-30T10-16-53-653Z-4dd4ad27-cf7e-477e-aba8-00cb965de2ca` 和 `2026-08-30T10-25-02-981Z-f333a402-0ee3-440c-9381-fa14d931eea2`。
5. 真实 Chisel 实现与 WSL 验证等待全部 Topology Decision 闭合和用户批准 Plan，现阶段不声明已生成 baseline RTL。

## 2. 实现拓扑决策循环

### 2.1 三类实体

Stage2 明确区分：

1. `Architecture Role`：Stage1 批准的稳定架构职责和全局语义参与者，不规定实现边界。
2. `Interface Contract`：Stage2 确定的跨 Unit 字段、方向、时序、有效条件和唯一 owner。
3. `Implementation Unit`：Stage2 的 Design、源码、测试、验证和调度单位，其实施依赖必须构成 DAG。

Implementation Unit 可以映射一个或多个 Architecture Role。共享类型、协议或基础设施 Unit 可以不映射 Architecture Role，但必须声明必要性、消费者和源码边界。每个 Architecture Role 必须映射到唯一 Implementation Unit，每个 Interface Contract 和源码路径必须有唯一 owner。

### 2.2 交互流程

Stage2 初始化后先进入：

```text
TOPOLOGY_DISCOVERY
-> TOPOLOGY_DECISION_LOOP
-> TOPOLOGY_REVIEW
-> TOPOLOGY_APPROVED
-> MODULE_LOOP
```

Topology Planner 先根据已批准 Architecture、现有源码、测试和构建结构建立带未知项的工作模型。它不得一次性生成完整拓扑并要求用户整体接受。

每轮只处理一个当前 ready 的 `topology_decision`：

```text
Planner 调研当前问题
-> 形成候选项、推荐、成本、影响范围和待确认问题
-> Workspace Agent 展示一个 Decision Packet
-> 用户选择、自定义或要求补充调研
-> Harness 更新结构化计划和 design/plan.md
-> 失效受影响的后续候选
-> 进入下一项 Decision
```

Agent 推荐不构成用户批准。用户的自然语言结论必须能够唯一映射到当前 Decision；无法唯一映射时只提出一个澄清问题，不写入正式状态。

每个 Topology Decision 至少记录：

1. 稳定 Decision ID、主题、问题、`dependsOn` 和当前状态。
2. 已批准 Architecture 事实、现有源码证据和仍未知的信息。
3. 候选方案、Agent 推荐、收益、成本、风险和不采用后果。
4. 受影响的候选 Unit、Interface Contract、源码范围、DAG edge 和后续 Decision。
5. 用户选择或完整自定义结论、理由、文档位置、revision 和内容哈希。

涉及现有源码组织、外部 Chisel 项目惯例或方案权衡时，Planner 先发起来源化 Research Task。Research Worker 负责证据，Planner 只基于证据形成当前 Topology Decision Packet。用户附加的调研关注点只约束证据搜索范围，不直接成为事实或结论。用户要求重新调研时使用显式 refresh，不复用当前 Evidence。命名和不影响职责、所有权、依赖或路径的局部默认值不触发正式调研。

已关闭 Decision 在计划批准前可以显式 reopen。Harness 保留此前结论作为修订基线，使目标 Decision 的旧建议和全部传递依赖候选失效。计划批准后的拓扑修订必须先使 Plan approval 失效，再进入对应 Decision。

### 2.3 决策顺序

默认按以下依赖推进，具体项目可以增加问题：

1. Architecture Role 到 Implementation Unit 的映射及 Unit 合并、拆分边界。
2. 共享 Bundle、pipeline payload、配置和工具代码的 owner。
3. Interface Contract 的 owner、生产者、消费者和稳定边界。
4. Scala package、源码目录、测试目录和顶层集成位置。
5. Implementation Unit 的 DAG、并行 wave 和集成消费者。
6. 每个 Unit 的 Design 路径、实现路径范围和完成条件。

前置结论变化时，Harness 使全部传递依赖 Decision 回到待确认状态。已确认内容作为修订基线保留，Planner 只能修改受影响部分。

### 2.4 正式计划

Stage2 只新增一个阶段级正式实体：

```text
design/plan.md
```

该文件由 Harness 投影，持续展示：

1. 已确认约束和用户决策。
2. 当前临时候选和未决问题。
3. Implementation Unit、Architecture 映射和职责。
4. Interface Contract 所有权。
5. 源码与测试拓扑。
6. 实施 DAG、wave 和集成点。
7. 计划 revision、状态和批准哈希。

计划讨论期间使用同一文件，不创建 `draft`、`final` 或按 revision 命名的副本。结构化 Decision、依赖、修订和批准记录保存在现有 `.assistant/project.yaml`。

### 2.5 最终审阅与门禁

进入 `TOPOLOGY_REVIEW` 前必须满足：

1. 所有 blocking Topology Decision 已闭合。
2. Implementation Unit DAG 无环且所有依赖可解析。
3. Architecture Role 映射完整，每个 Role 的实现 owner 唯一。
4. Interface Contract 和源码路径范围没有 owner 冲突。
5. 每个 Unit 都有 Design、实现、测试和集成责任。
6. 实施 wave 与验证落点明确。

Workspace Agent 展示完整拓扑、路径规划、DAG、wave、风险和仍然显式排除的内容。只有用户明确批准当前 `design/plan.md` 后，Harness 才绑定 revision 与聚合哈希并进入 `MODULE_LOOP`。第一版不在计划局部确认后提前启动模块 Design。

### 2.6 用户可见状态

`stage2 status` 和 Workspace Agent 必须展示完整实施看板，至少包含：

```text
Unit | Architecture 映射 | 依赖 | Wave | 状态 | Agent 角色
Design revision | Design 路径 | 源码归属 | 验证状态 | Blocker
```

Stage2 初始化、Topology Decision 提交、计划批准、模块状态转换、Design reopen 和验证结束后，Workspace Agent 都要主动展示计划 revision、总体进度、当前 Active、当前 Shadow、当前用户门禁和下一项机器动作。`stage2 next` 继续只返回当前允许处理的一个用户 Decision，机器动作可以并列报告但不能掩盖用户门禁。

### 2.7 旧 Module Loop 状态迁移

旧 Stage2 状态不会自动解释为已确认 Implementation Topology。迁移必须由用户显式触发，并满足尚无已批准 Unit Design、源码写入和验证证据。Harness 执行以下原子转换：

1. 保存旧状态 revision、run ID、thread ID 和 Design 哈希作为迁移来源索引，不复制完整状态快照。
2. 将未批准 `design/<module-id>.md` 标记为 Topology 未批准导致的失效草案，禁止沿用其批准门禁。
3. 释放旧 Shadow 和 Active 租约，使旧线程不能提交新结果。
4. 建立 `design/plan.md`、Topology Decision 状态和新的 Planner 租约。
5. Planner 可以引用旧草案中的事实和问题，所有 Unit 边界、Interface owner、路径和 DAG 都必须重新经过用户确认。

存在已批准 Design、源码或验证证据时，第一版拒绝自动迁移并报告需要人工闭合的影响范围。schemaVersion 2 到 3 使用顶层产品迁移命令，迁移后从 Architecture Role 重新建立 Topology Decision Loop。

## 3. 单 Unit 循环

```text
选择 Unit
-> Shadow Align 闭合 Design
-> 用户批准 Design，并选择本 Unit 的验证模式
-> Active Coding 实现
-> Active Coding 完成主验证
-> 按用户选择完成静态审查与验证
-> 修复问题并重跑受影响检查
-> Harness 记录证据并关闭 Unit
-> 双 Agent 满足条件后轮转
```

每个 Unit 在 Design 批准时都必须单独向用户询问：

> 本 Unit 是否启用独立 Static Review Worker 与独立 Verification Worker？

Harness 不从上一个 Unit 继承选择，也不推断默认值。选择记录为：

1. `independent_workers`：启动两个短生命周期 subagent。
2. `active_only`：不启动 subagent，由当前 Active Coding Agent 完成静态自审和验证。

## 4. 状态与门禁

Stage2 阶段状态保持：

```text
TOPOLOGY_DISCOVERY
-> TOPOLOGY_DECISION_LOOP
-> TOPOLOGY_REVIEW
-> TOPOLOGY_APPROVED
-> MODULE_LOOP
-> BASELINE_READY
```

计划被用户修订时从 `TOPOLOGY_REVIEW` 返回 `TOPOLOGY_DECISION_LOOP`。已批准计划发生内容漂移时进入 `BLOCKED`，不得启动或继续新的模块工作。Architecture 变化时，原计划批准失效并重新执行受影响的 Topology Decision。

`MODULE_LOOP` 内的长期 Unit 状态保持最少：

```text
PENDING
-> DESIGNING
-> AWAITING_APPROVAL
-> IMPLEMENTING
-> VERIFYING
-> COMPLETE
```

`DESIGN_CLOSED`、`PRIMARY_VERIFIED` 和 `VERIFICATION_CLOSED` 是证据门禁，不增加长期状态。

异常处理：

1. `DESIGN_REOPENED` 是返回 `DESIGNING` 的转换事件。Harness 暂停 Active 的源码写权限并保留其租约，分配 Shadow 处理设计缺口。新 Design 批准后，原 Active 重新读取批准包并校验租约，才能返回 `IMPLEMENTING`。
2. 已批准共享接口变化时，受影响 Unit 标记为 `NEEDS_REALIGN`，完成影响分析后回到相应正常状态。
3. 无法继续的模块可标记为 `BLOCKED` 或 `CANCELLED`。
4. 验证失败返回 `IMPLEMENTING`，保留失败证据。

### 4.1 Stage2 返回 Stage1 Architecture Rework

Topology、Unit Design、Implementation 或 Verification 证明已批准 Architecture 有误时，Workspace Agent 形成一个单一 Stage1 repair target 的 Proposal。用户明确确认后，Harness 执行：

```text
stage2 rework-start
-> 冻结 Stage2，释放 Agent 租约并递增 stateEpoch
-> 重开 Stage1 Decision 或创建 ProjectSpec finding
-> Stage1 Research / Correction / Review / Audit / Approval
-> stage2 rework-resume
-> 失效受影响 Topology Decisions 及其传递依赖
-> 失效受影响 Units 及其 DAG 消费者
-> 重新闭合并批准 design/plan.md
-> 从第一个 ready NEEDS_REALIGN Unit 恢复
```

Proposal 至少包含：

1. `summary`、`rationale` 和 `requiredClosure`。
2. Stage2 `source.kind` 及对应 `decisionId` 或 `unitId`。
3. 唯一 `repair.kind` 与 `repair.target`。
4. 当前有效的 `evidenceSources`。
5. `affectedTopologyDecisions` 和已物化时非空的 `affectedUnits`。

返工门禁：

1. 同一时刻只允许一个活动 Architecture Rework。
2. Stage1 新 approval 前，Stage2 保持 `BLOCKED`，旧 lease 和 state epoch 的结果一律拒绝。
3. ProjectSpec 修正必须使用 Review Correction v2。Audit report 只能定位 finding，不能作为新值 Evidence。
4. `rework-resume` 校验 Stage1 状态、新 approval、Plan 哈希和冻结后的 Stage2 revision，拒绝并发状态变化。
5. 受影响 Unit 的旧 Design approval、Implementation 和 Verification 只保存哈希索引，Unit 状态变为 `NEEDS_REALIGN`。
6. 未受影响 Unit 的状态、Design、实现和验证证据保持不变。未声明 Unit 的删除或内容变化阻止 Plan review；新增 Unit 必须重开 `S2_TOP_001`。
7. 新 Plan 批准后才归档 Rework。未受影响的 Active 上下文可以使用新 lease 恢复，旧运行结果仍因 epoch 变化失效。

命令入口：

```text
processor-agent stage2 rework-start <path> --proposal-json <json>
processor-agent stage2 rework-resume <path>
```

## 5. Design 门禁

Design 至少闭合：

1. 模块边界、接口和状态所有权。
2. 字段语义、生产者、消费者、设置、清除和有效区间。
3. 周期边界、组合路径和寄存位置。
4. stall、flush、kill、retry、replay 和异常路径。
5. 同拍事件优先级。
6. ownership、release、reuse 和 late response。
7. 全局 Architecture 与共享协议映射。
8. 断言、定向测试和集成验收条件。
9. 时序、面积和验证成本的已知风险。

用户批准包同时包含：

1. Design revision 与内容哈希。
2. 允许修改的源码和测试路径。
3. 验收命令、断言和预期结果。
4. 本 Unit 的 `verificationMode`。

批准后的 Design 对 Active Coding Agent 只读。实现发现设计缺口时，Active Coding Agent 必须提交带反例的 `DESIGN_REOPENED` 请求，不得自行增加协议、状态或保守限制。

## 6. Agent 职责

### 6.1 Workspace Agent

1. 作为唯一用户交互入口。
2. Topology 阶段只展示一个当前 Decision，并同步完整实施看板。
3. Module Loop 展示当前 Unit、Design 批准包和验证模式问题。
4. 不代替用户批准 Implementation Topology、Design 或验证模式。
5. 只通过 Harness 查询和提交正式状态。

### 6.2 Topology Planner

1. 读取已批准 Architecture、现有源码、测试和构建组织。
2. 建立带未知项的 Implementation Topology 工作模型。
3. 围绕当前单一 Topology Decision 调研并形成候选、推荐和影响分析。
4. 不修改 Architecture、RTL 和测试，不代替用户拍板。
5. 将结构化提案交给 Harness 更新 `design/plan.md`。

Topology 阶段由 Agent A 承担 Planner 角色，Agent B 保持 idle。计划批准后，Planner 上下文可以转为第一个 Unit 的 Shadow，但必须重新读取批准计划、Task Envelope、租约和 state epoch。

### 6.3 Shadow Align

1. 读取 Architecture、相关源码、测试和上游协议。
2. 与用户闭合当前 Unit Design 和验收条件。
3. 不修改 RTL 和测试。
4. 将 Design 提案交给 Harness 投影为正式文档。

### 6.4 Active Coding

1. 只在 `DESIGN_CLOSED` 后获得实现租约。
2. 读取已批准 Design，并只修改批准包中的源码和测试路径。
3. 完成最小实现、断言、测试和主验证。
4. 在 `active_only` 模式下，额外执行分离的静态自审和验证步骤。
5. 不修改已批准 Design、Architecture 和 Harness 状态。

### 6.5 短生命周期验证 Worker

仅在用户为当前 Unit 选择 `independent_workers` 时创建：

1. Static Review Worker 只读审查 RTL、测试、Diff 和 Design 一致性，不修改文件。
2. Verification Worker 在独立上下文运行批准的 WSL 验证命令，不修改 Design、源码和测试。
3. 两个 Worker 可以并行执行，结果都返回 Harness。
4. Worker 不参与双 Agent 轮转，任务完成后即结束。

Harness 是 `.assistant/project.yaml`、审批记录和正式证据投影的唯一写入者。Agent 不直接修改这些内容。

Stage2 Agent 通过 Harness 注入的只读 `processor_project` MCP 枚举、搜索和读取项目文件。该通道同时注入新线程与恢复线程，不依赖 Shell、PowerShell、cmd 或交互会话的 execpolicy allowlist。独立 Verification Worker 只允许通过 Shell 执行批准包中的命令。

Harness 为每次角色执行生成 Task Envelope。Topology 阶段至少包含当前 Decision、已确认结论、修订基线、受影响候选和计划哈希。Module Loop 至少包含当前角色、Unit ID、Architecture 映射、权威文档及哈希、允许路径、Interface Contract、依赖 Unit、验收条件、`verificationMode`、租约、state epoch 和下一项允许动作。Agent 不得根据模块名、最近文件修改或对话相似性猜测自身身份和权限。

在源码编辑、长时间验证、状态转换和角色轮转前，Harness 都要重新检查租约、state epoch 与批准 Design 哈希。Git commit 不能替代实际权威文件哈希。任一检查过期时立即拒绝操作，已有 Agent 上下文不能覆盖磁盘状态。

## 7. 双 Agent 轮转

Stage2 保留两个可恢复的 Windows Codex 上下文。角色绑定到阶段和模块，不永久绑定到线程。Chisel 构建与验证命令按批准的 runner 在 WSL 执行。

稳态流水：

```text
Agent A: Active Coding(module N)
Agent B: Shadow Align(module N+1)
```

允许轮转的条件：

1. Active 模块已达到 `COMPLETE`。
2. Shadow 模块已通过 `DESIGN_CLOSED`。
3. 两个模块的文档、哈希和交接信息均为当前版本。
4. 不存在未解决的共享接口冲突。
5. 当前 Unit 要求的测试和 Worker 均已结束。

轮转后，原 Shadow 成为其已闭合模块的 Active，原 Active 成为下一个模块的 Shadow。Harness 原子更新两个角色、租约和 state epoch，各 Agent 重新读取项目规则、状态和批准包后才能写入。

Stage2 启动方式：

```text
Agent A: Topology Planner
Agent B: idle

Implementation Topology 批准后：
Agent A: Shadow Align(first ready unit)
Agent B: idle

first unit Design 批准后：
Agent A: Active Coding(first ready unit)
Agent B: Shadow Align(next ready unit)
```

`first ready unit` 和 `next ready unit` 由已批准 Implementation DAG 与 wave 决定，不由 Architecture Role 的展示顺序决定。仅当依赖已经满足且写入路径互不相交时允许 Shadow Design 与 Active Implementation 并行。任一路径同一时刻只有一个写入者。

## 8. 验证闭环

所有 Implementation Unit 都必须先由 Active Coding Agent 完成主验证，包括构建、定向测试、必要断言及批准包要求的命令。

`PRIMARY_VERIFIED` 至少要求 elaboration 与编译成功、批准的定向测试通过、要求的随机或压力测试通过、无断言失败，并记录命令、seed、cycle count、结果和日志引用。仅编译成功不能通过该门禁。

### 8.1 `independent_workers`

1. 主验证通过后启动 Static Review Worker 和 Verification Worker。
2. Static Review Worker 输出 Design 一致性、边界条件、潜在回归和测试缺口。
3. Verification Worker 独立运行批准命令，记录命令、种子、周期、退出状态和日志引用。
4. 任一 Worker 发现问题后，Active Coding Agent 修复，所有受影响检查必须重跑。
5. 源码或测试变化会使对应旧报告失效。
6. 两个 Worker 都结束、有效 finding 已修复、被拒绝 finding 已附具体 invariant 或证据后，才能通过 `VERIFICATION_CLOSED`。

### 8.2 `active_only`

1. Active Coding Agent 在主实现步骤后执行一次分离的静态自审。
2. Active Coding Agent 再运行完整批准验证集并保存证据。
3. 证据明确记录 `performedBy: active`、`independent: false` 和 `waivedByUser: true`。
4. Harness 不得将该结果表述为独立审查或独立验证。

两种模式都必须通过同一正确性和可追溯性门禁。差别只在独立性和执行成本。

Unit 进入 `COMPLETE` 还要求 Design、源码、测试和证据一致，不存在当前 Unit 的必需工作，已知排除项已经记录，并明确下一个集成消费者。Harness 的阶段报告必须包含实施看板、角色、Unit、状态、批准 revision、修改文件、验证证据、共享接口变化、依赖 Unit、阻塞项和下一项允许动作。

## 9. Role 映射、拓扑一致性与最小持久实体

Stage1 批准后，Stage2 将 Stage1 ProjectSpec 中的 Architecture Role、全局语义和完成条件视为只读输入。`design/plan.md` 中稳定的 Implementation Unit ID 是 Stage2 Design、源码、验证、调度和状态看板的主键。

Architecture 与 Implementation Topology 承担不同职责：

1. Architecture Role 表示稳定职责，不携带实现依赖、源码路径或 Chisel 层级。
2. Global Protocol 通过 ownerRole、producerRoles、consumerRoles 和 affectedResources 描述稳定语义参与关系。
3. Implementation Unit `dependsOn` 表示 Design 与实现前置关系，必须形成 DAG。
4. 每个 Architecture Role 映射到唯一 Implementation Unit；一个 Unit 可以承载多个紧耦合 Role。
5. foundation 或 shared contract Unit 可以不承载 Architecture Role，但必须拥有明确产物并被至少一个 Unit 消费。
6. 每个 Interface Contract 声明唯一 owner、生产者、消费者、字段边界和冻结状态。

Design 与 `src/` 必须保持以下拓扑一致性：

1. 每个 Implementation Unit ID 只对应一份 `design/<unit-id>.md`。
2. 每份已批准 Design 通过 `implementation.sourcePaths` 和 `implementation.testPaths` 声明该 Unit 拥有的实现路径。
3. 每个源码或测试路径只允许一个 Unit ID 拥有。共享 Bundle、公共工具和集成文件也必须指定唯一 owner，其他 Unit 通过批准的 Interface Contract 或源码引用消费。
4. `design/` 与 `src/` 的物理目录无需逐层镜像。稳定映射由 Unit ID、Design 中的路径集合和内容哈希共同确定。
5. Active Coding 只能修改当前 Unit 已批准的路径集合。路径新增、删除或 owner 迁移必须先修订 Implementation Plan，再重新批准受影响 Design。
6. Unit 完成时，Design 声明的全部路径必须存在，源码和测试哈希必须与验证证据一致。

Harness 在 Plan 批准前检查 Unit ID、Architecture Role 唯一映射、Interface owner、源码范围和 DAG。Harness 在 Design 批准前检查路径位于 `src/main/` 或 `src/test/`、单份 Design 内没有路径别名或重复、不同 Unit 没有路径所有权重叠。Harness 在实现和验证阶段继续使用批准 Design 的路径集合限制写入并检查漂移。

首个 Unit 产生内容时，最小正式实体为：

```text
design/plan.md
design/<unit-id>.md
src/main/scala/.../<owned-source>.scala
src/test/scala/.../<owned-test>.scala
verification/<unit-id>.md
.assistant/project.yaml
```

实际源码和测试路径以已批准的 Plan 与 Unit Design 为准。`verification/<unit-id>.md` 汇总主验证、用户验证模式、审查结果和最终证据，不为两个 Worker 分别创建长期报告文件。

`.assistant/project.yaml` 在现有项目状态中记录 Topology Decision、Implementation Unit、DAG、wave、Unit 状态、角色、线程标识、租约、state epoch、批准哈希、`verificationMode`、允许路径和证据引用。原始日志、临时工作树和 Worker 输出进入工作区级 `.runtime/`。

第一版只新增 `design/plan.md`，不新增独立 Stage2 状态文件、Decision 目录、任务目录、Schema 目录、handoff 目录或 `.codex/chisel-workflow/`。Implementation Plan、Unit Design、批准哈希、允许路径和验收条件构成正式交接面。

## 10. Baseline 聚合

```text
BASELINE_BUILDING
-> BASELINE_INTEGRATING
-> BASELINE_VERIFYING
-> READY
```

`READY` 要求：

1. 所有 baseline 必需 Implementation Unit 已经完成。
2. Core 可以构建和 elaboration。
3. 定向测试与集成测试通过。
4. 性能计数器可用。
5. Architecture、Design、源码和验证映射一致。
6. Git 工作区干净，baseline commit 已冻结。

## 11. Architecture Change

Architecture Change 完成影响分析后复用同一模块循环：

```text
Architecture Idea
-> Contract 与影响分析
-> 检查 Implementation Topology 是否仍然适用
-> 确定受影响 Unit
-> 逐 Unit Design、Implementation、Verification
-> 整体回归与一致性审查
-> Change Complete
```

Architecture Change 改变 Unit 边界、Interface owner、源码 owner 或 DAG 时，先重新进入受影响的 Topology Decision。每个受影响 Unit 仍需独立批准 Design，并单独选择 `verificationMode`。文档、源码、测试和证据全部闭合后，Change 才能进入 `COMPLETE`。

## 12. 第一版范围

第一版覆盖：

1. Topology Planner 与用户逐项闭合 Implementation Topology。
2. `design/plan.md`、Topology Decision、最终审阅和批准哈希。
3. `stage2 status` 与 Workspace Agent 的完整实施看板。
4. 以批准计划中的首个 ready Unit 完成完整闭环。
5. Shadow Align 与 Active Coding 双 Agent 轮转。
6. 用户按 Unit 选择两个独立验证 Worker 或 Active 自行验证。
7. WSL 中的 Chisel 构建、定向测试和证据记录。
8. `dual_issue_demo` baseline 所需 Unit 和首个同拍 ALU 前递 Change。
9. Stage2 暴露 Architecture 错误时的 Stage1 返工、新批准和选择性失效闭环。

第一版暂不覆盖完整形式验证、自动模块调度、多构建系统和多模块并行实现。
