# Stage2 Skill-Driven Dual-Agent Harness 计划

状态：schemaVersion 5 已实现，支持有界读取、局部修订、可观测 Runtime 和真实 Active/Shadow 并发

上位文档：[PRODUCT_PLAN.md](./PRODUCT_PLAN.md)

更新时间：2026-08-31

## 1. 阶段定位

Stage2 把 Stage1 已批准的处理器总体架构转化为可实现、可验证的 baseline。

Stage1 决定目标、总体特性、Architecture Role 和全局语义。Stage2 决定实现组件、共享接口、源码边界、实施依赖、逐包 Design、RTL、测试和验证证据。

Stage2 不修改 Stage1 Architecture。实现过程中发现 Architecture 错误时，必须通过 Architecture Rework 返回 Stage1，取得新的 Architecture approval 后再恢复 Stage2。

## 2. 核心模型

Stage2 使用两个设计层级。

### 2.1 System Design

`design/plan.md` 是用户批准的全局实现设计，至少包含：

1. `Design Component` 及可选 `parentId` 层级。
2. 每个 Component 承担的 Architecture Role、职责和状态所有权。
3. 跨 Component 的 Interface Skeleton，包括唯一 owner、生产者、消费者、字段、边界和时序。
4. `Work Package` 划分、Design、Implementation、Integration 三类依赖 DAG、源码路径、测试路径、Design 路径和验收条件。
5. 全局 invariant、baseline 验收计划、风险和仍需用户拍板的 `DecisionRequest`。

Architecture Role 必须全部映射。Component、源码路径和测试路径必须有唯一 Work Package owner。三类 Work Package 依赖分别执行无环校验。

### 2.2 Package Design

`design/packages/<work-package-id>.md` 是单个 Work Package 的可执行实现契约，至少闭合：

1. Component 边界和已批准 Interface 的使用方式。
2. 字段、事件、生产者、消费者、存储位置和生命周期。
3. 周期行为、异常行为、同拍优先级和 invariant。
4. 允许修改的全部源码和测试路径。
5. 断言、定向测试、命令和预期结果。
6. 风险、排除项、开放问题和动态 `DecisionRequest`。

Package Design 不得自行改变已批准的 shared interface。需要改变时进入 System Design 修订，并使受影响 Work Package 重新对齐。

## 3. System Design 流程

```text
SYSTEM_DESIGN_DRAFT
-> Agent A 生成完整草案
-> Agent B 独立审查
-> 动态 DecisionRequest
-> Agent A 根据用户结论修订
-> Agent B 重新独立审查
-> 用户批准或退回修订 System Design
-> PACKAGE_LOOP
```

### 3.1 双 Agent 职责

Agent A 是 System Design Author。Agent B 是独立 System Design Reviewer。两者使用各自可恢复的 provider session，Harness 只在 assignment 中保存 `runtimeRef`，provider session ID 只进入 Runtime Registry。

Reviewer 必须基于同一份冻结输入独立检查：

1. Architecture Role 覆盖。
2. Component 职责和状态所有权。
3. Interface owner 和 endpoint。
4. Work Package 粒度、路径所有权和依赖 DAG。
5. 验收完整性和 Stage1 越界。

Reviewer 的 `pass` 只表示结构审查通过。System Design 仍需用户明确批准。

### 3.2 动态 DecisionRequest

Stage2 不再维护固定的 `S2_TOP_*` 决策序列。Author 或 Reviewer 仅在以下高风险问题无法从 Stage1 与项目证据唯一确定时创建动态 `DecisionRequest`：

1. pipeline boundary。
2. global state owner。
3. identity、retry 或 replay 语义。
4. control scope。
5. cross-package interface。
6. 会明显改变成本、风险或实现路径的工程权衡。
7. 需要返回 Stage1 的总体架构问题。

每个 Request 必须包含问题、用户必须决策的原因、候选、推荐、后果和影响范围。Agent 推荐不构成用户批准。用户回答后，旧草案和旧审查失效，Author 必须修订，Reviewer 必须重新审查。

局部命名、显然可逆的内部组织和无需用户承担后果的实现选择由 Agent 在 Design 中说明，不创建 DecisionRequest。

### 3.3 用户批准门禁

进入 `PACKAGE_LOOP` 前必须满足：

1. Author 草案通过 Schema 和结构校验。
2. Reviewer verdict 为 `pass`。
3. 没有 error finding。
4. 所有动态 DecisionRequest 已回答并进入新草案。
5. `design/plan.md` 内容哈希、Architecture approval 哈希、Component topology 哈希、Interface 哈希和 Work Package plan 哈希一致。
6. 用户明确执行 System Design approval。

### 3.4 待批准草案退回修订

用户审阅完整候选草案后可以拒绝批准，并通过 Harness 登记 System Design Revision Request：

```text
SYSTEM_DESIGN_APPROVAL
-> stage2 revise --revision <n> --instruction <text>
-> SYSTEM_DESIGN_DRAFT
-> Agent A 修订
-> Agent B 重新独立审查
```

Revision Request 绑定当前 Design revision 和 document hash，持久化用户原始 instruction，失效当前 Review，并保留旧 Proposal 作为修订基线。Author 启动前可以用同一命令更新 pending Request。Author 自动读取已登记 instruction，Reviewer 必须检查新 Proposal 是否落实该要求。新 Review 通过后才能再次进入 `SYSTEM_DESIGN_APPROVAL`。

该入口只处理尚未批准的 System Design。进入 `PACKAGE_LOOP` 后的全局设计修改继续使用 Design reopen 或 Architecture Rework，不复用该状态转换。

## 4. Work Package 流程

每个 Work Package 按以下状态推进：

```text
PENDING
-> DESIGNING
-> AWAITING_APPROVAL
-> READY
-> IMPLEMENTING
-> VERIFYING
-> COMPLETE
```

异常状态为 `NEEDS_REALIGN`、`BLOCKED` 和 `CANCELLED`。

完整流程：

```text
Shadow Agent 生成 Package Design
-> Harness 校验并投影 Design 文档
-> 用户批准 Package Design
-> Active Agent 实现批准路径
-> Harness 运行主验证
-> Harness 在独立验证副本运行全部批准命令，同时启动 Static Review Worker
-> Verification Worker 只读审查 Harness 命令证据与验证覆盖
-> Static Review Worker 通过
-> Verification Worker 通过
-> Harness 复核文件哈希和命令证据
-> Work Package COMPLETE
```

实现发现 Design 缺口时，Active Agent 必须提交带反例的 Design gap。Harness 不应用任何文件，并将 Work Package 返回 `DESIGNING`。

## 5. 双 Agent 轮转

Stage2 固定维护 Agent A 与 Agent B 两个可恢复上下文。角色随 Work Package 轮转。

稳态：

```text
Agent A: Active Implementation(package N)
Agent B: Shadow Design(package N+1)
```

Workspace Agent 每轮只调用一次 `stage2 advance`。Harness 在同一状态快照中最多 claim 一个 Active Implementation 和一个 Shadow Package Design，并使用 `Promise.allSettled` 真实并发启动。两个 Worker 只写独立 runtime 目录，Harness 在项目状态锁内逐项校验并合并。一个 Worker 失败不会取消另一个合法结果。

首包 Design 批准后，当前 Shadow 晋升 Active，另一个 Agent 开始下一个可设计 Package。每次转换由 Harness 原子更新 assignment、lease、base revision、批准哈希和允许路径。

### 5.1 提前轮转

当前 Active 进入 `VERIFYING` 后，Shadow 可以提前晋升到另一个独立 Work Package。必须同时满足：

1. 两个 Package 没有直接或传递依赖。
2. 当前 Active 的 Package Design 没有 shared interface change。
3. 新 Active 的其他 implementation dependency 已完成。
4. 源码和测试路径没有交叠。
5. 两份 Package Design 均为当前批准版本。

当前 Active 仍需等待两个 Worker 完成。其 assignment 释放后保留 `runtimeRef`，后续修复可以恢复原 provider session。

独立验证失败后，Work Package 保留 blocker 和失败证据。当前 Active 进入 `VERIFYING` 或完成时，Harness 优先把空出的 Active slot 分配给最早的失败 Package，并从该 Package 的 Implementation record 恢复原 `runtimeRef`。待修复 Package 的优先级高于新的 Shadow 晋升，避免提前轮转造成修复饥饿。

依赖当前 Active 的 Package 必须等待当前 Active `COMPLETE` 后才能晋升。

## 6. 固定双 Worker 验证

每个 Work Package 都使用两个独立、短生命周期 Worker，不提供 `active_only` 选项。

### 6.1 Static Review Worker

只读检查冻结副本中的 Design、源码、测试和 diff，输出 Design 一致性、边界条件、回归风险和测试缺口。Static Review 不执行批准命令。

### 6.2 Verification Worker

Harness 在另一份冻结副本中执行 Package Design 批准的完整命令集，再把不可变命令结果交给只读 Verification Worker。Worker 审查命令覆盖、失败含义和验证缺口，报告逐项保留 command ID、runner、required、退出状态、输出摘要和时间。外部助手不直接创建 WSL 或其他构建进程。

历史 Verification Worker 因 `COMMAND_EXECUTION_BLOCKED` 或 `REVIEW_SCOPE_INCOMPLETE` 进入实现修复状态时，显式 `stage2 verify` 可以在文件与批准哈希仍有效的前提下恢复验证，无需重新运行 Active Implementation。

两个 Worker 不能共享 provider session、工作副本或运行 ID。任一 verdict 为 `fail`，任一 error finding 未处理，或任一 required command 失败，Package 都不能进入 `COMPLETE`。

## 7. Runtime Port

Harness 通过 provider-neutral `AgentRuntime` 调用外部助手：

```text
start(request)
resume(runtimeRef, request)
cancel(runtimeRef)
capabilities()
```

当前适配器是 `CodexCliRuntime`。`start` 和 `resume` 先返回 `AgentRunHandle`，其中包含 `runId`、`runtimeRef`、事件路径、结果路径、启动时间和完成 Promise。

Runtime Registry 只保存 provider session。Run Ledger 以 `runId` 保存不可变运行证据，包括 task、slot、Package、状态、输入输出哈希、事件时间、deadline、PID 和 runtime 路径。stdout 与 stderr 增量写入 `codex.jsonl`。总 deadline 与 no-event timeout 分离，`stage2 cancel` 终止真实进程树。`stage2 status` 同时读取正式 Ledger 和 runtime 状态文件，识别异常退出的 orphaned run。

System Design approval 后不复用 System Design session 执行 Package 任务。Package session 达到运行次数或累计 prompt 大小阈值时轮换，逻辑 slot、lease 和 Package owner 保持不变。

每个 Worker 的 Task Envelope 携带 hash 绑定的 Read Manifest。Project Reader MCP 只允许读取 Manifest 中的 entry file 和 allowed root，拒绝根目录枚举、无范围搜索及 `.runtime`、构建缓存、未引用遗产等排除路径。

该边界允许后续接入其他 AI provider，同时保持 System Design、Package、审批、哈希和证据模型不变。

## 8. Harness 权限与一致性

Harness 是以下实体的唯一写入者：

1. `.assistant/project.yaml`。
2. `design/plan.md`。
3. `design/packages/*.md`。
4. `verification/packages/*.md`。
5. 审批记录、Runtime Registry、Worker evidence 和 history。

Agent 通过只读 `processor_project` MCP 读取项目。Active Implementation 只向 Harness 返回结构化文件提案。Harness 在应用前检查：

1. `stateEpoch`、assignment lease、slot、role 和 Work Package revision。
2. Architecture、System Design、Interface 和 Package Design 哈希。
3. 每个文件是否属于批准路径。
4. `baseSha256` 是否匹配磁盘。
5. 不同 Package 的路径是否互斥。

Git commit 用于项目版本管理，不替代上述权威文件哈希和运行门禁。

## 9. Architecture Rework

Stage2 证据证明总体 Architecture 有误时，用户确认一个 Rework Proposal 后执行：

```text
stage2 rework-start
-> 冻结 Stage2 并释放 Agent assignment
-> Stage1 Decision 或 ProjectSpec 修正
-> Stage1 review、audit、approval
-> stage2 rework-resume
-> System Design 重新生成和独立审查
-> 用户重新批准 System Design
-> 受影响 Package 重新对齐
```

Rework 必须声明唯一 Stage1 repair target、证据、受影响 Component 和 Work Package。Harness 失效受影响 Package 及其传递消费者，保留无关 Package 的批准、实现和验证证据。新 System Design 批准后，保留项也必须重新绑定新的 System Design 与 Interface 哈希。

## 10. schemaVersion 3 与 4 迁移

迁移必须显式执行：

```text
processor-agent stage2 migrate <path> --dry-run
processor-agent stage2 migrate <path> --apply
```

迁移规则：

1. `--dry-run` 不修改任何文件。
2. 旧 Topology Decision、Plan、Worker run 和 Architecture Rework 只作为 `legacyEvidence` 索引保留。
3. 固定 `S2_TOP_*`、Planner、`verificationMode`、`active_only`、旧 Unit assignment 和 state epoch 退出主流程。
4. 旧 Unit 边界、接口 owner、路径和 DAG 作为候选证据，不能自动升级为 System Design approval。
5. 已完成的 Stage1 Architecture 保持权威。
6. 活动 Stage1 Architecture Rework 保持阻塞，直到 Stage1 新 approval 后恢复。
7. 无活动返工时，迁移后进入 `SYSTEM_DESIGN_DRAFT`。
8. schema 4 的单一 `dependsOn` 保守迁移为三类依赖，旧 mutable runtime entry 拆为 Session 与 Run。
9. schema 4 已批准 Design 在哈希可验证时保留，System Design 文档和批准哈希由 Harness 重投影。
10. schema 5 再次执行迁移时只规范化残留 provider metadata，不重新生成 Design 或改变用户决策。

## 11. CLI 与用户交互

主要命令：

```text
processor-agent stage2 status <path>
processor-agent stage2 next <path>
processor-agent stage2 advance <path>
processor-agent stage2 cancel <path> <run-id-or-runtime-ref>
processor-agent stage2 migrate <path> --dry-run|--apply
processor-agent stage2 start <path>
processor-agent stage2 draft <path>
processor-agent stage2 revise <path> --revision <n> --instruction <text>
processor-agent stage2 decide <path> <decision-id> <option-id>
processor-agent stage2 decide <path> <decision-id> --text <conclusion>
processor-agent stage2 approve <path>
processor-agent stage2 design <path> <work-package-id>
processor-agent stage2 approve <path> <work-package-id>
processor-agent stage2 implement <path> <work-package-id>
processor-agent stage2 verify <path> <work-package-id>
processor-agent stage2 reopen <path> <work-package-id> --reason <reason>
processor-agent stage2 rework-start <path> --proposal-json <json>
processor-agent stage2 rework-resume <path>
```

Workspace Agent 每轮先读取 `status` 和 `next`。用户需要拍板时一次只展示一个 DecisionRequest 或 approval gate，同时显示完整 Package board、Agent 角色、blocker 和下一项机器动作。

当前不存在用户门禁时，Workspace Agent 调用一次 `stage2 advance`。`design`、`implement` 和 `verify` 只用于诊断和精确重试。

## 12. 最小持久实体

```text
design/plan.md
design/packages/<work-package-id>.md
verification/packages/<work-package-id>.md
src/main/...
src/test/...
.assistant/project.yaml
```

原始运行日志、冻结副本和 Worker 输出进入工作区级 `.runtime/`。不创建长期 task、handoff、snapshot、decision 或 agent 目录。

## 13. Baseline 完成条件

进入 `BASELINE_READY` 必须满足：

1. 所有 baseline Work Package 为 `COMPLETE`。
2. 每个 Package 的 Design、实现文件和验证证据哈希一致。
3. 两个独立 Worker 均通过。
4. Core 构建、elaboration、定向测试和集成测试通过。
5. Stage1 Architecture、System Design、Package Design、源码和测试映射一致。
6. 已知排除项和延期项进入正式文档。

## 14. 第一版范围

第一版覆盖：

1. System Design Author 与独立 Reviewer。
2. 动态 DecisionRequest 和两级用户批准。
3. Package Design、Implementation 和固定双 Worker 验证。
4. 两个可恢复 Agent 的稳定轮转、真实并发与受限提前轮转。
5. 有界 Read Manifest、canonicalization 和 hash 绑定局部 Patch。
6. Session 与 Run 分层、增量事件、deadline、cancel 和 orphan recovery。
7. provider-neutral Runtime Port 和 Codex CLI adapter。
8. Architecture Rework 和受影响 Package 选择性失效。
9. schemaVersion 3 与 4 显式迁移。
10. `dual_issue_demo` baseline 的真实跑通。

第一版暂不做正式对照实验、自动性能优化、多 Package 并行写入、完整形式验证和多构建系统适配。
