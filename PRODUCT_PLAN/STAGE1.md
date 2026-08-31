# Stage1 Project Bootstrap 计划

状态：首个 CLI 版本已实现，`dual_issue_demo` 已完成 Stage1

上位文档：[PRODUCT_PLAN.md](./PRODUCT_PLAN.md)

更新时间：2026-08-30

## 1. 阶段目标

Stage1 将用户的处理器目标转化为可以直接进入模块开发的 Project Blueprint，并建立可恢复的项目工作区。

```text
用户目标
-> 必要调研
-> 全局架构决策
-> Architecture Snapshot
-> 项目骨架
-> Stage2 Topology Planning 输入
```

Stage1 负责全局 Architecture、Architecture Module 职责、共享语义边界、项目级验证策略和用户批准。Implementation Unit 划分、Interface owner、源码拓扑、实施 DAG、模块内部状态机、具体 Chisel 实现、完整测试开发和 baseline 集成进入 Stage2。性能优化进入 Stage3。

`STAGE1_COMPLETE` 表示：

1. 全局架构已经批准。
2. 工具链和项目骨架可以进入开发。
3. Architecture Module Manifest 和共享约束足以启动 Stage2 Topology Decision Loop。
4. baseline RTL 尚不要求完成。

## 1.1 当前实现快照

截至 2026-08-30，Stage1 已实现 Profile 驱动的初始化、环境探测、决策依赖图、Decision 级 Research Task、指纹缓存与显式刷新、Decision 修正、正式文档同步、独立架构审查、Review Correction v2、批准哈希、项目骨架生成、WSL smoke check、未批准 Profile 更新、Stage2 Architecture Rework 返回入口和 Workspace Agent 自然语言入口。

`dual_issue_demo` Profile `0.7.0` 已为八个 Decision 声明 `researchPolicy`。隔离端到端运行通过独立架构审查且无 finding，并在 WSL 中通过 SBT 编译。实际 `E:\107\dual_issue_demo` 已迁移到 `0.7.0`，并已覆盖完整决策、Architecture audit、Decision reopen、重新调研和修订结论提交。

当前 Profile 和 Schema 仍保留 `architecture.stage2Order`。该字段在旧 Stage2 中直接驱动实施，已确认需要迁移。新语义只允许把它作为 Architecture Module 的确定性展示顺序和 Topology Planner 的初始讨论线索，不能作为用户已批准的 Implementation Topology。

当前恢复能力覆盖正常关闭后从 `.assistant/project.yaml`、ProjectSpec history sidecar 和 Profile 快照继续执行，也支持修正未批准 Decision，以及由 Stage2 发起的已批准 Architecture Rework。重开后的 Decision 以此前结论为修订基线，旧 advice 自动失效，Research 与 Synthesis 必须围绕修正原因形成完整修订候选。命令中断期间的通用多文件事务恢复、自由形式 discovery 与 synthesis、本地 Web 界面进入后续实现。

Architecture audit finding 已显式分类为 `decision`、`project_spec` 和 `profile`。`project_spec` finding 通过 `stage1 correct --proposal-json` 修改结构化项目事实并重新生成现有正式文档。findingSource、Evidence、按目标覆盖关系和用户确认分别记录。旧 audit 进入审查历史，修正必须经过新的 `review` 和当前文档哈希对应的独立 `audit` 才能批准。

Research Task 接收用户指定的问题、仓库、URL 和范围。Research Worker 负责来源与事实，Synthesis Worker 只读取结构化 Evidence。Harness 记录请求指纹、缓存命中、run ID、两个 Worker thread ID、证据充分性和停止原因。隔离 Worker 固定使用 Codex `read-only` sandbox，并通过 Harness 提供的 `processor_project` MCP 读取项目证据。该 MCP 只暴露文件枚举、文本搜索和分段读取，不提供写入工具，也不依赖交互会话的 execpolicy allowlist。`advise` 作为默认请求的兼容入口保留。

用户项目中的人类可读 Stage1 产物默认使用中文。模块名、信号名、字段名、路径、命令、代码和机器状态 key 保持英文。新项目没有 `AGENTS.md` 时生成严格版协作约束，已有文件不自动覆盖。

## 2. 两次 Bootstrap

Stage1 区分两个动作：

1. `WORKSPACE_INITIALIZED`：在流程开头创建最小文档、Git 和机器状态入口，使后续讨论可以持续落盘。
2. `PROJECT_SCAFFOLDED`：在全局架构批准后生成构建配置、验证入口和经用户预览的项目骨架。

项目骨架生成前的调研、草案和用户回答都必须保存。项目骨架不得抢先固化尚未批准的 ISA、流水边界或模块接口。

## 3. 输入

Stage1 的最小输入：

1. 目标目录。
2. Project Profile 及版本。
3. 处理器目标、使用场景和约束。
4. 用户明确给出的架构事实和排除项。
5. 用户授予 Agent 的决策权限范围。
6. 本机构建、仿真和参考模型环境。

信息不足时，Stage1 先建立带未知项的 Blueprint 草案，再按依赖顺序提出问题。

## 4. 必须闭合的内容

| 领域 | Stage1 必须确定的内容 |
|---|---|
| 项目目标 | 使用场景、目标工作负载、成功标准、约束和明确排除项 |
| 工程环境 | Chisel、Scala、构建工具、仿真器、参考模型和执行位置 |
| ISA Profile | 基础 ISA、扩展、特权范围、异常、中断、CSR 和非对齐访问策略 |
| 系统边界 | 复位入口、地址宽度、存储接口、MMIO、时钟复位和外部中断 |
| 宏观执行模型 | 顺序或乱序、发射与退休宽度、流水边界和操作延迟分类 |
| 全局控制 | stall、flush、redirect、exception、kill 和 backpressure 语义 |
| Module Map | 稳定 Module ID、职责、状态所有权、契约消费关系和共享架构边界 |
| 共享协议 | 跨模块接口及共享流水字段的语义、生产者、消费者和有效区间 |
| 验证策略 | 参考模型、定向测试、集成测试、性能计数器和完成条件 |
| 未决事项 | blocking 或 deferred 分类、负责人、影响范围和最迟决策点 |

模块内部字段只在影响跨模块接口或全局正确性时进入 Stage1。其余字段在对应模块进入 Stage2 后闭合。

## 5. 调研流程

### 5.1 调研触发条件

满足以下任一条件时创建调研任务：

1. Project Profile 标记该问题需要来源依据。
2. 决策影响 ISA 正确性、外部接口、流水边界、异常语义或验证能力。
3. 现有来源互相冲突或适用条件不清楚。
4. 用户要求比较参考设计或补充依据。
5. Agent 无法在已有项目事实中证明推荐方案。

命名、文件布局和不影响批准边界的工程默认值不触发架构调研。

### 5.2 来源优先级

1. ISA、接口和工具链的官方规范。
2. 参考实现的当前源码、测试和构建配置。
3. 论文、官方设计文档和项目维护者说明。
4. 二手分析和搜索摘要。

源码行为、提议中的设计和 Agent 推荐必须分开标记。参考核的机制不能直接晋升为当前项目事实。

### 5.3 单项调研闭环

```text
Decision Question
-> Evidence Needed
-> Source Collection
-> Candidate Comparison
-> Recommendation
-> User Decision
```

每条调研结论至少记录：

1. 关联 Decision ID。
2. 问题和决策标准。
3. 来源、定位信息和访问时间。
4. 候选机制及其适用条件。
5. 正确性、复杂度、时序、面积和验证代价。
6. 不确定项与置信度。
7. Agent 推荐及理由。
8. 用户最终采用的结论。

调研达到当前决策所需的证据阈值后停止。第一版优先使用固定的本地资料和官方来源，实时网络检索作为补充。原始下载和临时结果进入工作区级 `.runtime/`，可复现结论进入用户项目 `research/`。

### 5.4 已实现的 Research Task 机制

Stage1 按以下机制执行正式调研：

1. 每个 Decision 声明 `researchPolicy: required | conditional | none`。
2. `required` Decision 在展示前必须具有与当前输入匹配的有效调研；`conditional` 在用户要求来源、比较或指定外部材料时触发；`none` 直接使用项目事实和 Profile 内容。
3. `next` 保持只读。缺少必要调研时返回 `kind: research_required`，证据有效时返回 `kind: decision_ready`，由 Workspace Agent 调用 Harness 执行。
4. Research Request 至少包含 `decisionId`、`question`、`sources` 和可选 `scope`。用户指定的仓库、URL 和问题必须进入该请求，不能只保留在 Workspace Agent 上下文中。
5. 缓存指纹由 Decision Packet、问题、来源、已确认依赖决策、相关正式文档哈希和 Research Prompt 版本共同计算。输入变化时启动新任务，相同指纹直接复用。
6. Research Worker 只负责来源收集和证据整理，输出来源定位、revision 或 commit、访问时间、事实、冲突、缺口、`evidenceSufficient` 和 `stopReason`。
7. Synthesis Worker 只读取 Decision Packet 和已经校验的 Research Evidence，负责完整比较候选方案并形成推荐，不自行补充来源。
8. Harness 输出 `cacheHit`、`fingerprint`、`runId`、Research Worker `threadId`、Synthesis Worker `threadId` 和证据充分性，使 Workspace Agent 可以向用户说明本次结果来自缓存还是新任务。
9. 正式机器结果继续写入 `.assistant/advice/<decision-id>.json`，历史运行保存在现有工作区级 `.runtime/`。不新增顶层目录和按版本命名的正式文件。
10. `research/stage1.md` 投影调研问题、范围、来源定位、访问时间、事实、冲突、证据缺口、全部候选项的收益、成本与风险、Worker 推荐、用户最终结论和请求指纹。
11. 正式调研必须经 Harness 创建和落盘。Workspace Agent 收到自由形式仓库调研请求时负责构造 Research Request，不直接完成会影响架构决策的临时调研。

兼容策略：保留 `stage1 advise` 作为默认 Research Request 入口，新增可携带 `question`、`source` 和 `scope` 的 `stage1 research`。已有 advice 在新指纹规则下迁移为无额外来源的默认请求结果。

## 6. 决策与批准

### 6.1 信息分类

| 类型 | 处理规则 |
|---|---|
| 来源事实 | Agent 记录来源，用户可以纠正，无需逐条批准 |
| 用户需求 | Agent 复述并写入阶段摘要，由用户确认摘要 |
| 架构决策 | 用户显式选择、修改或授权 Agent 决定 |
| 派生结论 | 从已批准决策推导，自动同步文档并参加最终审阅 |
| 模块内部实现选择 | 延后到 Stage2 的模块 Design |

Stage1 的架构决策包括 ISA 范围、系统边界、流水边界、发射和退休语义、模块职责、共享协议、异常行为、全局保守机制和验收标准。

### 6.2 Decision Packet

每个需要用户拍板的问题使用结构化 Decision Packet：

```yaml
id: S1_DEC_006
question: baseline 是否支持 lane0 到 lane1 的同拍 RAW 前递
why_now: 该选择决定发射规则、前递接口和 baseline 性能
known_facts: []
options: []
recommendation: prohibit_same_cycle_raw
consequences: []
affected_artifacts: []
status: awaiting_user
```

Decision Packet 必须给出实际后果和受影响文档。只列选项、不解释影响的提问不能进入用户确认。

### 6.3 用户操作

用户可以：

1. 接受推荐方案。
2. 选择其他候选方案。
3. 修改候选方案或补充约束。
4. 要求继续调研。
5. 授权 Agent 在指定边界内决定。
6. 延后决策。

延后项分为：

1. `blocking`：阻止 Stage1 完成。
2. `deferred`：不影响当前全局边界，必须记录最迟决策点和受影响模块。

### 6.4 批准绑定

单项决策批准记录 Decision ID、用户回答、对应文档位置、revision 和内容哈希。最终 Stage1 批准绑定 Architecture、Module Map、验证计划和决策记录的聚合哈希。

批准后修改受保护内容时，状态进入 `NEEDS_REVISION`。旧批准不能继续用于生成项目骨架或启动 Stage2。

### 6.5 Review Correction

Architecture audit finding 按修正所有者分为三类：

| `repairKind` | 适用范围 | 修正入口 |
|---|---|---|
| `decision` | 已有用户决策的结论、约束或适用范围错误 | `stage1 reopen` |
| `project_spec` | 用户项目的 Module Manifest、共享字段、全局协议、Verification Contract 或验收数据缺失 | Review Correction |
| `profile` | 对所有使用该 Profile 的项目都成立的通用模板错误 | 修改框架 Profile 后执行 `profile-refresh` |

`project_spec` 修正使用逻辑实体 `Review Correction`。当前 ProjectSpec、Correction compact index 和 sidecar 元数据保存在现有 `.assistant/project.yaml`，ProjectSpec baseline 与增量事件保存在同目录的内容寻址压缩 sidecar。第一版不新增用户正式目录和正式文档。Harness 根据修正结果重新生成现有 `architecture/overview.md`、`architecture/modules.yaml` 和 `verification/plan.md`。

每个 finding 至少记录：

```yaml
code: PIPELINE_MANIFEST_INCOMPLETE
repairKind: project_spec
repairTarget: architecture.modules
relatedDecision: S1_DEC_003
requiredClosure:
  - Instruction Queue state owner
  - hold、kill、release 和 reuse 规则
status: open
```

Review Correction 必须满足以下规则：

1. Audit Agent 只分类和描述缺口，不直接修改项目。
2. Workspace Agent 每轮只处理一个 open finding 或一个由相同根因合并的 finding 组。
3. `project_spec` 修正写入结构化项目事实，禁止对生成文档进行任意文本补丁。
4. Correction index 必须记录 finding code、修改目标、理由、findingSource、Evidence、按目标覆盖关系和用户确认。完整旧值和新值由 baseline 与领域 patch 重放得到，不在每条 Correction 中重复保存。
5. 项目专属修正不得写回通用 Profile。确认对所有同 Profile 项目均成立的缺陷才使用 `profile`。
6. Harness 重新生成正式文档后，原 audit 报告保留为历史证据，finding 标记为 `superseded`，不能直接标记为通过。
7. 必须重新执行确定性 `review` 和独立 `audit`。只有新文档哈希对应的 audit 返回 pass 才能批准。
8. 当前第一个 open finding 必须包含在本次 Correction 中。同一根因可以合并多个 finding，其余 finding 按顺序处理。
9. Audit report 只能作为 findingSource。Decision、项目文档、Research、Profile 和用户新指令作为 Evidence 时必须通过 revision、digest、fingerprint 或完整指令校验。
10. Profile refresh 与 Review Correction 共用 ProjectSpec event chain。项目覆盖字段默认保留，只有显式 `release-override` 才交还 Profile 管理。
11. v1 Correction 只通过显式 `correction-migrate --dry-run|--apply` 迁移。旧记录缺少 Evidence 时标记为 `legacy_unresolved`，不伪造依据，也不使既有 approval 失效。
12. 用户确认界面只展示语义差异。字符串数组显示新增、删除和顺序变化；结构化集合按稳定 ID 显示新增、删除和字段变化；`architecture.modules` 按 Module ID 展示。原始 Proposal JSON 和未变化实体不进入用户正文。

审查修正闭环为：

```text
audit
-> finding 分类
-> reopen Decision | Review Correction | Profile 修正
-> 重新生成正式文档
-> review
-> audit
-> approve
```

## 7. 用户交互

Stage1 按以下主题推进：

```text
目标与环境
-> ISA 与系统边界
-> 流水线与执行模型
-> 模块与共享协议
-> 验证与 Stage2 Planning 输入
-> 全量审阅
```

交互规则：

1. Agent 先扫描已有项目事实和环境，再提出问题。
2. 每轮呈现一个复杂决策，或一组相互依赖的简单决策。
3. 每个问题先给出已知事实、推荐方案、后果和未知项。
4. 用户回答后立即更新正式草案和机器状态。
5. 下一轮只读取项目文件、当前状态和本轮任务包。
6. 聊天中的修正尚未同步到文档时，流程停留在当前状态。
7. 修正已关闭 Decision 时必须记录原因并执行 `stage1 reopen`。Harness 保留旧结论，把目标重置为 pending，并使目标旧 advice 与全部传递依赖 Decision 失效。
8. 修正后重新读取 `status` 和 `next`。`next` 必须携带此前结论、修正原因和完整修订候选，Profile 默认推荐不得覆盖此前讨论结果。
9. `revise_previous` 只能通过 `custom` 提交 `proposedCustomAnswer`，并继续受显式用户确认门禁约束。
10. Audit finding 按 6.5 节进入对应修正入口。`relatedDecision` 不能替代 `repairKind`，没有 Decision owner 的项目事实不得强行通过 `reopen` 修正。
11. 最终审阅展示已确认事项、deferred 项、open finding、生成预览、Architecture Module Manifest 和 Stage2 Topology Planning 输入。

用户始终面对一个 Workspace Agent。Harness 拥有交互状态、问题队列、审批和恢复逻辑。Codex CLI 通过结构化任务生成调研、方案和文档更新。

第一版入口为 `processor-agent open <path>`。该命令校验 Stage1 项目和 Codex CLI，随后在项目根目录启动交互式 Codex，并注入固定 Workspace Agent 协议。协议要求 Agent 每轮重新查询 `status` 和 `next`，自动执行 required Research Task，将用户指定来源写入 Research Request，只展示一个 ready Decision，并保留推荐选项、自定义架构结论和 Architecture Approval 的显式用户门禁。Harness 命令仍是状态与正式草案的唯一写入口。

## 8. Agent 配置

第一版 Stage1 对用户保持一个 Workspace Agent，并按任务启动短生命周期 Worker：

1. `discovery` 任务收集目标、环境和已有事实。
2. Research Worker 完成单个 Decision Question 的来源调研和 Evidence 输出。
3. `architecture` 任务生成候选方案、Decision Packet 和文档草案。
4. Synthesis Worker 只基于 Evidence 比较候选项并形成建议。

各任务可以使用新的 Codex 上下文。持久状态全部来自项目文件。

Stage1 完成前增加一次独立只读审查。审查只报告缺失决策、矛盾、无来源结论、接口不闭合和退出门禁缺口，不修改用户项目。

## 9. 状态机

```text
NEW
-> WORKSPACE_INITIALIZED
-> INTENT_CAPTURED
-> BLUEPRINT_DRAFTED
-> DECISION_LOOP
   <-> RESEARCHING
-> ARCHITECTURE_REVIEW
   -> REVIEW_CORRECTION
   -> ARCHITECTURE_REVIEW
-> ARCHITECTURE_APPROVED
-> PROJECT_SCAFFOLDED
-> STAGE1_COMPLETE
```

异常状态：

```text
NEEDS_REVISION
BLOCKED
CANCELLED
```

状态规则：

1. `WORKSPACE_INITIALIZED` 要求最小目录、Git 和 `.assistant/project.yaml` 已建立。
2. `BLUEPRINT_DRAFTED` 允许未知项存在，每个未知项必须具有类型和影响范围。
3. `DECISION_LOOP` 只推进当前依赖已经满足的决策。
4. `ARCHITECTURE_REVIEW` 要求所有 blocking 决策已经闭合。
5. Audit fail 时，`decision` finding 回到 `DECISION_LOOP`，`project_spec` finding 进入 `REVIEW_CORRECTION`，`profile` finding 等待 Profile 修正和迁移。
6. `REVIEW_CORRECTION` 只允许通过 Harness 修改 6.5 节定义的结构化项目事实，完成后回到 `ARCHITECTURE_REVIEW`。
7. `ARCHITECTURE_APPROVED` 绑定正式文档哈希，且当前哈希对应的 audit 必须为 pass。
8. `PROJECT_SCAFFOLDED` 只能使用已批准的 Architecture Snapshot。
9. 任一阶段可因外部条件进入 `BLOCKED`，并记录阻塞原因和恢复条件。

## 10. 持久产物

Stage1 使用逻辑产物定义职责，实际文件按首次内容创建，不生成空目录。

| 产物 | 默认位置 | 内容 |
|---|---|---|
| Project State | `.assistant/project.yaml` | Profile、当前状态、revision、决策索引、Correction compact index、sidecar 元数据和哈希 |
| ProjectSpec History | `.assistant/project-spec-history-<hash>.json.gz` | 内容寻址的 baseline、领域增量事件和重放哈希 |
| Architecture Overview | `architecture/overview.md` | 目标、ISA、系统边界、流水线、全局规则和不变量 |
| Module Manifest | `architecture/modules.yaml` | Module ID、职责、状态所有权、契约消费关系和共享接口 |
| Decision Record | `architecture/overview.md` 或独立 ADR | 已批准选择、理由、影响和来源引用 |
| Stage1 Research Memo | `research/` | 来源索引、机制比较和被采用结论 |
| Verification Plan | `verification/` | 参考模型、测试层级、计数器和完成条件 |
| Project Scaffold | 项目根目录 | 构建配置、验证入口和必要工具配置 |

长篇协议或独立 ADR 只有在现有文档无法清晰承载时创建。`design/` 和 baseline 源码由 Stage2 首次使用时创建。

## 11. 退出门禁

进入 `STAGE1_COMPLETE` 必须同时满足：

1. 项目目标、约束、成功标准和排除项已经确认。
2. 工具链、执行位置、构建入口和验证入口已经确定。
3. ISA Profile 与系统边界已经批准。
4. 执行模型、流水边界、发射与退休规则已经批准。
5. Module Map、Module ID、职责、状态所有权和契约消费关系已经批准。
6. 跨模块协议与共享流水字段已经闭合。
7. 全局 stall、flush、redirect、exception、kill 和 backpressure 语义已经闭合。
8. 必需调研具有来源，可采用结论已经进入正式文档。
9. 所有 blocking 决策已经闭合，deferred 决策具有最迟决策点。
10. 验证策略和 Stage2 完成条件已经确定。
11. 用户批准绑定当前文档 revision 和聚合哈希。
12. 项目骨架、Git 和机器状态可以从磁盘恢复。
13. 新的 Agent 只读取项目文件即可说明当前架构和 Stage2 Topology Planning 的输入边界。
14. 当前文档哈希对应的独立 audit 已通过，且不存在 open Review Correction。

## 12. 第一版 `dual_issue_demo` Profile

第一版 Profile 固定产品演示方向，并将具体架构选择留在 Profile 和用户项目中。Harness Core 不包含 Demo 的模块名、信号名和流水规则。

Stage1 至少引导用户闭合以下主题：

1. ISA 子集和异常范围。
2. 流水级划分与各级职责。
3. 双发射 Lane 能力和程序顺序规则。
4. 配对、结构冲突和 RAW、WAW 处理基线。
5. 控制流、访存和多周期操作限制。
6. flush、stall、forwarding 和 retirement 的全局语义。
7. 参考模型、定向测试、小型 benchmark 和性能计数器。
8. Architecture Module 职责、状态所有权、共享协议和允许 Stage2 讨论的实现自由度。

baseline 禁止 `lane0 -> lane1` 同拍 RAW 配对属于需要用户批准的架构决策。该决定必须同时写入 Architecture Overview、发射模块边界和验证计划。

## 13. Stage1 开发顺序

1. 定义 `Stage1State`、Project Blueprint、Decision Packet、Evidence 和 Approval 的 TypeScript 类型。
2. 实现最小 Workspace 初始化、幂等检查和恢复。
3. 实现 Profile 加载和 blocking 决策依赖图。
4. 实现环境探测与来源索引。
5. 实现 Codex CLI 的 discovery、research、architecture 和 synthesis 任务包。
6. 实现 Decision Loop、用户回答写入和文档同步。
7. 实现聚合哈希、批准失效和最终只读审查。
8. 实现经批准的 Project Scaffold 生成。
9. 使用 `dual_issue_demo` Profile 完成从空目录到 `STAGE1_COMPLETE` 的端到端测试。
10. 实现 audit finding 分类、Review Correction、结构化项目事实更新和重新审查闭环。

## 14. Stage1 产品验收

1. 从空目录开始可以完成 Stage1。
2. 中途关闭后可以从项目文件恢复。
3. 同一 Profile 和相同用户回答生成一致的正式产物。
4. blocking 决策未闭合时不能批准。
5. 修改已批准 Architecture 后批准自动失效。
6. Agent 推荐能够追溯到项目事实或调研来源。
7. Stage1 不生成未经批准的 baseline RTL。
8. 新 Agent 可以根据产物生成正确的 Stage2 首模块任务包。
9. Audit 发现 Decision 之外的项目事实缺口时，可以在不手工编辑生成文档、不修改通用 Profile 的情况下完成项目级修正。
10. 每项 Review Correction 可以追溯到 finding、用户确认、结构化字段变化和重新审查结果。

## 15. 实现结果

已通过自动测试的行为：

1. 从空目录完成确定性 Stage1 主路径。
2. 决策依赖、环境阻塞和批准门禁生效。
3. 已有正式文档不会被初始化覆盖。
4. 正式文档漂移会使对外状态显示为 `NEEDS_REVISION`。
5. 未批准 Profile 可以迁移，已经回答或已有建议的 Decision 定义不能静默变化。
6. Windows 路径可以转换为 WSL 路径。
7. 生产 Profile 可以通过结构校验。
8. `processor-agent open` 可以启动 Workspace Agent，自动查询 Harness，并把自然语言“按推荐”映射为当前 Profile option 或完整修订结论。
9. Decision 正常回答、自定义和延期后保留对应调研证据；Decision 重开时旧 advice 失效。没有活动修正记录的旧版本孤立建议可以自动重新挂接。
10. `stage1 advise` 默认复用有效建议，并支持 `--refresh` 显式重新调研。
11. `stage1 research` 接收 `question`、重复的 `source` 和 `scope`，相同指纹命中缓存。
12. required Decision 在证据充分前不能回答；`next` 自动返回 Research Task。
13. Research 与 Synthesis 使用独立只读 Codex Worker，运行记录进入工作区级 `.runtime/`。
14. 未批准的已关闭 Decision 可以通过 `stage1 reopen` 修正。旧结论和修正原因进入审计记录，目标旧 advice 与全部传递依赖 Decision 自动失效，修订建议必须保留未被新证据否定的既有内容。
15. Audit finding 显式声明修正所有者和结构化目标。Review Correction v2 分离 findingSource、Evidence 与用户确认，要求每个修改目标具有 Evidence coverage，且不能写回通用 Profile。
16. ProjectSpec baseline、keyed collection、字符串数组和 replace patch 可以重放得到当前完整事实。内容寻址压缩 sidecar 在加载时校验路径、大小、哈希、事件数和重放结果。
17. Profile refresh 与 Correction 共用事件链，保留 `overriddenTargets`。用户可以显式释放单个覆盖目标。
18. v1 Correction 支持不写状态的 dry-run 和显式 apply。迁移验证历史链、正式文档哈希、approval hash 和当前 ProjectSpec hash，缺失 Evidence 的记录标记为 `legacy_unresolved`。
19. Stage2 可以冻结 Agent 租约后返回 Stage1，重开 Decision 或创建 ProjectSpec finding。新 Review、Audit 和用户 Approval 完成后生成新的 Architecture approval。
20. Stage1 自动测试覆盖 33 项，包括 Review Correction v2 Evidence 门禁、finding 顺序、压缩 sidecar、Profile refresh、override release、v1 迁移和两类 Architecture Rework 入口。

隔离端到端验证覆盖 `init -> decisions -> review -> audit -> approve -> scaffold -> complete`，最终状态为 `STAGE1_COMPLETE`。Workspace Agent 端到端验证覆盖 `open -> status -> next -> 自然语言回答 -> answer -> next`。Stage2 已能从该状态生成首个 Topology Decision Task Envelope，不再直接消费 `architecture.stage2Order` 启动 Module Loop。

尚未实现的已确认 Stage1 缺口：命令中断期间的通用多文件事务自动恢复、自由形式 discovery 与 synthesis、本地 Web 界面。
