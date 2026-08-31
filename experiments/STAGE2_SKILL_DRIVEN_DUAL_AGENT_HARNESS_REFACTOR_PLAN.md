# Stage2 Skill 驱动双 Agent 薄 Harness 重构计划

状态：重构方向及实施前设计点已确认，尚未修改产品逻辑

记录时间：2026-08-31

关联材料：

1. [产品总纲](../PRODUCT_PLAN/PRODUCT_PLAN.md)
2. [Stage2 权威计划](../PRODUCT_PLAN/STAGE2.md)
3. [Stage1 与 Stage2 产品重构计划](./STAGE1_STAGE2_PRODUCT_REFACTOR_PLAN.md)
4. [Stage1 与 Stage2 模块粒度问题记录](./STAGE1_STAGE2_MODULE_GRANULARITY_PROBLEM.md)

本文记录下一轮 Stage2 产品重构的目标、目标流程、最小状态、双 Agent 轮转、Skill 接入、迁移和验收要求。本文批准前不承担正式产品事实，实施后应把最终结论同步到产品总纲和 Stage2 权威计划。

## 1. 结论

Stage2 采用以下产品结构：

```text
Processor Engineering Skills
+ Thin Approval and Evidence Harness
+ Active/Shadow 双 Agent 流水
+ Ephemeral Verification Workers
+ Pluggable Agent Runtime
```

职责分配如下：

1. Processor Skills 提供处理器设计闭合、Chisel 实现、状态生命周期、时序分析和验证方法。
2. Primary Agent 读取项目、生成 Design、编写代码、调试和运行主验证。
3. Harness 冻结输入、管理用户批准、限制写入路径、检查漂移、轮转 Agent、保存证据和管理返工。
4. Verification Worker 在独立上下文检查实现、测试和 Architecture Fidelity。
5. Runtime Adapter 启动、恢复、取消和记录具体 AI Runtime。

Stage2 保留双持久 Agent。固定六项 Topology Decision、默认强制 Research 和过细的用户确认从核心流程中移除。

## 2. 重构证据

`dual_issue_demo` 已经暴露以下问题：

1. Stage2 在生成源码前固定要求完成六项 Topology Decision。
2. `S2_TOP_003` Research 要求已有完整 Bundle、源码、测试和 Unit Design，这些内容本身属于 Stage2 输出，形成循环门禁。
3. 当前扁平 Implementation Unit 同时表达子系统容器、Agent 工作单元和内部 Chisel Module，导致 Backend 内部模块没有独立接口、Design 和验证状态。
4. `S2_TOP_002` 在接口清单形成前确定共享类型 owner，后续容易出现 `core`、`control` 与消费者之间的依赖循环。
5. 当前单一 DAG 同时承担源码依赖、实施调度和硬件运行时数据流，语义不稳定。
6. 状态页混入完整 Architecture Rework 历史和失效路径，当前门禁可见性下降。
7. Stage2 与 Codex 的代码理解、局部设计、实现和调试能力高度重合，Harness 逐项代替 Agent 规划会增加等待和模型调用。
8. 当前 Stage2 控制流程较重，尚未进入 RTL 实现已经多次触发 Research insufficient。

双 Agent 轮转仍有明确价值。Active 实现当前 Work Package 时，Shadow 可以闭合下一 Work Package Design，能够降低串行等待时间。

## 3. 重构目标

### 3.1 必须实现

1. 从 Stage1 已批准 Snapshot 生成整体 Design Draft。
2. 由 Agent 提取零到多个真正需要用户决定的问题。
3. 用户批准后形成带哈希的正式 Design Package。
4. 根据 Design Package 形成可轮转的 Work Package 队列。
5. 保留 Active 和 Shadow 两个持久 Agent 上下文。
6. Active 只修改批准路径，Shadow 只生成下一 Package Design。
7. 独立验证不占用两个长期 Agent 槽位。
8. Design、源码、测试和验证证据能够追踪到同一批准版本。
9. 实现发现 Architecture 缺口时可以返回 Stage1。
10. Agent Runtime 使用 Provider 无关接口，第一版只实现 Codex CLI Adapter。

### 3.2 不进入本轮

1. 多于两个长期 Agent 的自动调度。
2. 多个 Active Agent 同时写 RTL。
3. 自动 FPGA timing closure。
4. 完整形式验证。
5. 自动 Architecture DSE。
6. 第二个正式 AI Provider Adapter。
7. Stage3 Optimization 重构。
8. 正式 A/B 实验编排与结论评估。

## 4. 目标流程

```text
Stage1 Architecture Snapshot
-> System Design Draft
-> 0..N Decision Requests
-> User Approval
-> Work Package Queue
-> Active/Shadow Pipeline
-> Independent Verification
-> Complete or Design Reopen or Stage1 Rework
```

### 4.1 启动阶段

1. Agent A 读取 Stage1 Snapshot、源码骨架、测试和 Processor Skills，生成整体 System Design Draft。
2. Agent B 对 System Design Draft 执行只读独立审查，重点检查 Architecture Fidelity、接口遗漏、状态所有权和验证缺口。
3. Harness 合并确定性检查和审查 finding，形成一个 System Design 审批包。
4. 用户完成一次 System Design Approval 后，Harness 冻结总体拓扑、职责、跨 Package 接口骨架、Work Package 边界和路径范围。
5. Agent A 成为首个 Package 的 Active，Agent B 成为下一个 ready Package 的 Shadow。

### 4.2 稳态轮转

```text
Agent A: Active Implementation(Wn)
Agent B: Shadow Design(Wn+1)

完成轮转后：

Agent B: Active Implementation(Wn+1)
Agent A: Shadow Design(Wn+2)
```

轮转期间允许：

1. Active 写入当前批准源码和测试路径。
2. Shadow 读取当前 Architecture、System Design、已批准上游 Design 和当前源码。
3. Shadow 通过 Harness 更新下一 Package 的 Design Draft，不写 RTL。
4. 用户在 Active 运行期间审阅 Shadow Design。
5. Verification Worker 并行检查已完成 Package 的冻结副本。

没有 ready 的下一 Package 时，Shadow 可以执行只读 Design Review 或保持 idle，不生成虚假并行任务。

## 5. 最小持久实体

### 5.1 System Design Package

System Design Package 是 Stage2 的全局批准边界，至少包含：

```text
stage1Snapshot
architectureHashes
summary
componentTopology
interfaceSkeletons
workPackages
globalInvariants
acceptancePlan
decisionRequests
risks
approval
```

System Design Approval 不冻结每个接口的精确字段和 Package 内部实现。每个 Work Package 仍需独立完成 Package Design Approval。

### 5.2 Design Component

Design Component 表示 Stage2 中需要显式描述职责、接口或状态所有权的设计节点。它可以对应一个 Chisel Module，也可以在实现中合并为一个 Module。

`parentId` 是可选字段。顶层 Component 使用 `null` 或省略该字段，其他 Component 可以通过它表达唯一的设计归属层次。Harness 必须检查该层次无环。`parentId` 不表达 Chisel 实例化、运行时数据依赖或 Work Package 归属，跨层连接继续通过 Interface 表达。

最小字段为：

```text
id
parentId
architectureRoles
responsibility
stateOwnership
interfaceIds
```

`frontend`、`backend` 可以作为层次容器。`icache`、`dcache`、`regfile`、`issue`、`alu`、`branch` 等可以作为其子 Component。具体集合由 System Design Draft 和用户批准决定。

### 5.3 Work Package

Work Package 是 Agent 的 Design、实现、路径权限和验证单位。它可以拥有一个或多个 Design Component，每个 Component 只能由一个 Work Package 实现。

最小字段为：

```text
id
componentIds
dependsOn
allowedSourcePaths
allowedTestPaths
designPath
acceptance
status
```

Design Component 与 Work Package 具有独立生命周期，因此需要分开表达。前者描述处理器设计拓扑，后者描述实施和协作边界。

### 5.4 Package Design

每个 Work Package 的 Shadow Design 至少闭合：

1. 接口精确字段和方向。
2. producer、register boundary 和 consumer。
3. 状态设置、保持、清除、释放和复用。
4. valid、ready、stall、kill、flush、redirect、retry 和 late response。
5. 同拍事件优先级。
6. 组合路径、扇出和预期时序风险。
7. 断言、定向测试和批准命令。
8. 允许修改的源码与测试路径。

Package Design 必须由用户明确批准后才能晋升为 Active Implementation 输入。

System Design Approval 与 Package Design Approval 是两个独立门禁。前者确认全局设计框架，后者确认当前 Work Package 的精确实现契约。

## 6. 动态用户决策

System Design Agent 和 Shadow Agent 可以返回 `DecisionRequest[]`。Harness 只展示会改变以下内容的问题：

1. Architecture Role 或跨 Work Package 边界。
2. 新流水级或关键寄存边界。
3. 新增全局或跨周期状态。
4. 新增 generation、tag、retry、replay 或 identity 机制。
5. 扩大 stall、flush、kill 或 serialization 范围。
6. 跨 Package Interface Contract。
7. 重要性能、面积、时序和验证复杂度取舍。
8. Stage1 Architecture Rework。

命名、局部 helper、普通 package、内部 Bundle 组织和不影响批准边界的代码布局由 Agent 决定并写入 Design，不单独打断用户。

DecisionRequest 至少包含：

```text
id
question
whyUserDecisionIsRequired
options
recommendation
affectedComponents
affectedInterfaces
affectedPaths
consequences
```

固定 `S2_TOP_001` 至 `S2_TOP_006` 迁移为历史索引，不再作为所有项目必须经过的流程。

## 7. Research 机制

Research 改为按需触发：

1. 现有项目源码已经给出事实时，Agent直接引用源码。
2. Stage1 Architecture 已经给出稳定语义时，Design Agent直接形成候选设计。
3. 涉及外部实现惯例、论文、未知 IP、工具限制或用户明确要求调研时，Harness 启动 Research Worker。
4. Research Worker 只提供来源化事实和候选约束，不要求目标 Design 已经存在。
5. `evidenceSufficient` 表示证据足以比较候选或解释风险，不表示接口、源码或 Design 已经完成。
6. Research 缺口属于待设计内容时，返回 Design Agent继续闭合，不进入重复 Research 循环。

## 8. 双 Agent 状态和轮转门禁

### 8.1 Work Package 状态

```text
DESIGNING
-> AWAITING_APPROVAL
-> READY
-> IMPLEMENTING
-> VERIFYING
-> COMPLETE
```

补充事件：

```text
DESIGN_REOPENED
IMPLEMENTATION_FAILED
VERIFICATION_FAILED
ARCHITECTURE_REWORK_REQUESTED
```

这些事件触发回退，不增加长期状态。

### 8.2 Agent Slot

```text
idle | shadow | active
```

每个 Assignment 只保存：

```text
slot
role
workPackageId
runtimeRef
lease
baseRevision
designHash
interfaceHash
allowedPaths
```

Harness 使用一个递增的 `workspaceRevision` 和一次性 `lease` 拒绝旧结果。Provider thread ID 不直接进入 Stage2 业务状态。

### 8.3 原子轮转条件

1. 当前 Active Package 已完成实现和主验证。
2. 当前 Shadow Package Design 已经由用户批准。
3. Shadow 依赖的 Architecture、System Design 和 Interface hash 仍有效。
4. 两个 Package 的写入路径不重叠。
5. 不存在未批准的 shared interface change。
6. 不存在活动 Architecture Rework。
7. Active 的最终变更没有使 Shadow Design 的源码假设失效。
8. 当前 Active 的独立验证已经完成，或下一 Package 不依赖当前 Active 且当前 Active 未修改 shared interface 和全局协议。
9. 独立验证尚未完成时，当前 Active Package 保持 `VERIFYING`，不能进入 `COMPLETE`。
10. 直接或间接依赖当前 Active 的 Package 必须等待其独立验证完成后才能晋升为 Active。

轮转由 Harness 原子更新两个 Assignment 和 lease。两个 Agent 在下一次写入前重新读取批准包。提前轮转只释放长期 Agent 槽位，不改变当前 Package 的验证门禁。后续独立验证失败时，Harness 根据依赖和 Interface hash 重新打开受影响 Package。

## 9. 验证模型

### 9.1 Active 主验证

Active 必须完成 Package Design 指定的编译、定向测试、断言和必要随机测试。主验证失败时保持当前 Package 未完成，并记录命令、退出状态、seed、失败周期和信号。

### 9.2 独立验证

每个 Package 默认启动两个相互独立的只读 Worker，并读取同一冻结副本：

1. Static Review Worker 检查 Architecture Fidelity、Design 与 RTL 一致性、接口漂移、遗漏场景、禁止行为和无关 diff。
2. Verification Worker 执行编译、测试、断言和批准的回归命令，并保存退出状态、seed、失败周期和必要信号。

两个 Worker 不读取对方输出。Package 必须同时通过两项检查才能进入 `COMPLETE`。

两个 Worker 合计至少覆盖：

1. Design 与 RTL 一致性。
2. Architecture Fidelity。
3. 禁止组合和边界场景。
4. 测试是否与实现共享同一错误假设。
5. 修改路径和无关 diff。

Static Review Worker 和 Verification Worker 都不占用 Agent A 或 Agent B 的持久槽位，也不对每个 Package 重复询问启用策略。

## 10. Harness 必须保留的门禁

1. Stage1 Snapshot 和 Architecture hash 当前有效。
2. System Design 与 Package Design 都有明确用户批准和内容哈希。
3. 所有 blocking DecisionRequest 已解决。
4. Active 只修改批准路径。
5. Design hash、Interface hash 和允许路径在实现期间没有漂移。
6. 一个源码或测试路径只有一个当前 Work Package owner。
7. shared interface change 触发受影响分析和 Design realign。
8. Architecture 缺口进入 Stage1 Rework。
9. 实现、测试和验证证据绑定当前文件 hash。
10. Package 关闭前不存在有效 error finding。

## 11. 需要移除或降级的现有机制

### 11.1 移除

1. 固定六项 Topology Decision 主循环。
2. `S2_TOP_001` 至 `S2_TOP_005` 的默认 required Research。
3. Planner 作为长期第三个 Agent 角色。
4. package、路径、共享 Bundle 和普通工具代码的逐项用户决策。
5. 将硬件运行时数据流强制解释为单一实施 DAG。
6. 每个 Unit 重复询问 verification mode。
7. Provider thread ID 作为 Design、Implementation 或 Assignment 主键。

### 11.2 保留并简化

1. Design hash 和 approval。
2. allowed paths 和路径唯一 owner。
3. Active/Shadow lease。
4. 漂移和过期结果拒绝。
5. 独立 Static Review 和 Verification。
6. Design reopen。
7. Stage2 返回 Stage1。
8. 人类可读 Design 和机器状态投影。

## 12. Runtime 抽象

Harness Core 使用 Provider 无关接口：

```ts
interface AgentRuntime {
  capabilities(): AgentCapabilities;
  start(request: AgentRequest): Promise<AgentRun>;
  resume(runtimeRef: string, input: AgentInput): Promise<AgentRun>;
  cancel(runtimeRef: string): Promise<void>;
}
```

产品自己的 `AgentRequest` 和 `AgentResult` Schema 承载 Task Envelope、权限、输入 hash 和结构化输出。Provider 运行记录进入 Runtime Registry：

```text
provider
model
runtimeVersion
runtimeRef
externalSessionId
promptDigest
inputArtifactHashes
outputArtifactHashes
toolPolicy
usage
startedAt
completedAt
```

Stage2 业务状态只引用 `runtimeRef`。第一版实现 `CodexCliRuntime`，其余 Runtime 等 Stage2 端到端闭环后接入。

## 13. CLI 与用户交互

用户继续通过 `processor-agent open <project>` 和自然语言交互。Workspace Agent 将自然语言映射到最小 Harness 命令。

目标命令集合：

```text
stage2 status
stage2 start
stage2 draft
stage2 decide
stage2 approve
stage2 implement
stage2 verify
stage2 reopen
stage2 rework-start
stage2 rework-resume
```

Agent 轮转、lease 更新、证据绑定和状态投影由 Harness 自动执行，不要求用户调用专门的 rotate 或 assign 命令。

Workspace Agent 每轮只展示：

1. 当前 Active 与 Shadow。
2. 当前总体和 Package 进度。
3. 一个用户门禁。
4. 正在运行的机器动作。
5. 当前 blocker 和恢复条件。

完整历史、Worker 记录和 Architecture Rework 证据通过显式 detail 命令查看，不默认展开到状态页。

## 14. 代码组织计划

继续使用已有 `src/stage2/`，不新增顶层目录。按逻辑职责收敛为：

```text
src/stage2/
  workflow.ts
  design-package.ts
  work-package.ts
  rotation.ts
  gates.ts
  evidence.ts
  rework.ts
  runtime-port.ts
  presentation.ts
  worker-contracts.ts
```

职责约束：

1. `workflow.ts` 只处理状态转换和命令编排。
2. `design-package.ts` 处理 System Design、Component 和 Interface Schema。
3. `work-package.ts` 处理 Package 状态、路径和依赖。
4. `rotation.ts` 处理 A/B Assignment、lease 和原子轮转。
5. `gates.ts` 处理 hash、批准、路径、漂移和过期结果校验。
6. `evidence.ts` 处理实现与验证证据。
7. `rework.ts` 保留 Design reopen 和 Stage1 Rework。
8. `runtime-port.ts` 只暴露 Provider 无关 Runtime 接口。
9. `presentation.ts` 只生成用户可读投影。
10. `worker-contracts.ts` 只定义结构化 Worker 输入和输出。

`src/stage2.ts` 最终只保留兼容导出或删除。Schema 与逻辑放在其拥有者文件中，不新建独立 Schema 目录。

## 15. `dual_issue_demo` 迁移

### 15.1 实验快照

Git commit：

```text
06d759d9407a286c4bc77c94a33e34e5b6dd6bd7
stage1 developed.
```

该 commit 已包含 Stage1 revision 152、有效 Architecture approval 和已回答的 `S2_TOP_001`。它是“Stage1 加 S2_TOP_001”快照，不能用于测量 Unit 边界决策的价值。

快照只使用 Git commit，不创建重复快照目录。当前工作树继续作为 Harness 开发实验，不作为最终 A/B 结果。

### 15.2 状态迁移

1. 保留 Stage1 Snapshot、Decision、Correction、Research 和 approval。
2. 将已回答的 S2_TOP 记录保存为迁移历史和候选证据，不自动转换为 Work Package，也不自动获得新 System Design Approval。
3. 从当前 `design/plan.md` 提取已有 Unit 结论，转换为未批准 System Design Draft。
4. 不自动批准新的 Component、Interface 或 Work Package。
5. 删除当前 Research insufficient blocker，迁移后由 Design Agent直接闭合待设计内容。
6. 释放旧 Planner lease，保留可复查的 runId 和 evidence hash。
7. 用户批准新 System Design 后启动 Agent A/B 轮转。
8. 已有 Architecture Rework 历史保留摘要，默认状态页不展开失效路径。

### 15.3 实验范围暂缓

本轮不实现正式 A/B 实验矩阵、实验编排器或对比结论。当前 Git commit 只用于 Demo 迁移、失败恢复和可重复运行，不承担实验组定义。

当前目标是完成 `dual_issue_demo` 的 Stage2 迁移，跑通至少两个 Work Package 的 Active/Shadow 轮转，并得到可编译、可测试和可独立验证的实现。运行过程中继续记录两个长期 Agent 和全部 Worker 的调用、运行时间与 usage，暂不据此形成产品效果结论。

Demo 闭环后再单独设计 Generic Codex、Skill Codex 和 Processor Agent 的正式对照实验。

## 16. 实施阶段

### Phase 0：冻结证据和测试

1. 保存当前 Stage2 revision 17、`S2_TOP_003` blocker 和事件历史摘要。
2. 为固定 Decision、Research insufficient、双 Agent 轮转和 Architecture Rework建立回归测试。
3. 记录当前 Stage2 命令数、代码规模和一次完整交互的调用数。

### Phase 1：先修改产品定义

1. 更新产品总纲中的 Stage2 定位。
2. 重写 Stage2 权威计划的流程、实体、Agent 和门禁。
3. 定义 Design Component、Work Package、Design Package 和 DecisionRequest。
4. 明确 Thin Harness 与 Processor Skills 的职责边界。

### Phase 2：实现新数据模型

1. 增加 System Design Package。
2. 增加 Component hierarchy 和 Interface skeleton。
3. 将 Implementation Unit 状态迁移为 Work Package 状态。
4. 将固定 Topology Decision 迁移为动态 DecisionRequest。
5. 使用 `workspaceRevision` 和 lease 替代多层过期状态。

### Phase 3：实现双 Agent 流水

1. 实现启动阶段的 Design 与独立审查。
2. 实现 Active/Shadow Assignment。
3. 实现 Shadow Design 和用户批准。
4. 实现原子轮转和过期提交拒绝。
5. 实现无 ready Package 时的 idle 或 Review 行为。

### Phase 4：精简 Research 和验证

1. Research 改为 Agent 按需请求。
2. 修复 evidence sufficiency 语义。
3. 统一独立 Verification Worker。
4. 把 verification policy 移到 System Design approval。

### Phase 5：Runtime Adapter

1. 抽取 Provider 无关 `AgentRuntime`。
2. 将 Codex CLI 启动逻辑移入 `CodexCliRuntime`。
3. 将 Provider session ID 移入 Runtime Registry。
4. Stage2 状态改为内部 `runtimeRef`。

### Phase 6：迁移 Demo

1. 先运行 dry-run 并展示保留、转换、失效和待批准内容。
2. 迁移当前 Stage2 状态。
3. 重新生成 System Design Draft。
4. 用户批准后运行第一个 Active/Shadow 周期。
5. 完成至少两个 Package 的真实轮转。

### Phase 7：文档和端到端验证

1. 更新 README、USER_GUIDE 和命令帮助。
2. 更新产品计划和实验记录。
3. 在 Windows 控制端和 WSL Chisel 环境运行完整回归。
4. 从冻结 Git commit 执行一次迁移 dry-run 和完整恢复演练。

## 17. 测试要求

### 17.1 状态与批准

1. 未批准 System Design 不能创建 Active Assignment。
2. 未批准 Package Design 不能晋升 Shadow 为 Active。
3. Design 或 Interface hash 漂移拒绝实现结果。
4. 旧 lease 和旧 workspaceRevision 的结果被拒绝。
5. 用户未明确批准时不能自动提交 Design 或 DecisionRequest。

### 17.2 双 Agent

1. Active 写路径与 Shadow Design 路径不冲突。
2. Active 完成且 Shadow 未批准时不轮转。
3. Shadow 批准且 Active 未完成时保持等待。
4. 两项均满足时原子交换角色和 lease。
5. shared interface change 阻止错误晋升。
6. Agent 重启后可以通过 runtimeRef 恢复。

### 17.3 Design 与路径

1. 每个 Architecture Role 有 Design 落点。
2. 每个 Design Component 只有一个 Work Package owner。
3. 每个源码和测试路径只有一个 owner。
4. Component hierarchy 无环。
5. Work Package 实施依赖无环。
6. 硬件 ready/valid 反压关系不被误判为实施 DAG 环。

### 17.4 Research 与验证

1. 缺少尚未设计的 Bundle 不会触发永久 Research blocker。
2. 外部证据缺失时 Research 可以合法阻塞对应 DecisionRequest。
3. Static Review Worker 和 Verification Worker 均不可修改正式输入。
4. 两个 Worker 必须读取同一冻结版本，且不能读取对方输出。
5. 实现或测试变化会使两类旧报告失效。
6. 任一 Worker 失败或 error finding 未闭合时 Package 不能 COMPLETE。

### 17.5 迁移

1. 旧 S2_TOP 结论和 evidence hash 保留。
2. 旧 approval 不自动批准新 System Design。
3. 迁移前后 Stage1 Snapshot hash 一致。
4. 迁移 dry-run 不修改文件。
5. 迁移失败保持旧状态可恢复。

## 18. 验收标准

1. `dual_issue_demo` 不再阻塞于“缺少待设计接口和源码”的 Research 循环。
2. 用户只需批准整体 Design、关键 DecisionRequest 和 Package Design。
3. 至少完成两次真实 Active/Shadow 轮转。
4. Active 实现期间 Shadow 能并行形成下一 Package Design。
5. 固定 Topology Decision 不再是新项目的必经门禁。
6. Stage2 长期角色只有 Active 和 Shadow，Research、Static Review 与 Verification 使用短生命周期 Worker。
7. 一个 Package 可以从 Design Draft 推进到独立验证闭合。
8. Architecture、Design、源码、测试和证据可以通过 hash 互相追踪。
9. Architecture 缺口能够冻结双 Agent 并返回 Stage1。
10. Provider session ID 不进入 Stage2 业务 Schema。
11. CLI 命令和用户状态页明显少于当前实现，状态页默认只展示当前动作。
12. 端到端测试能够从冻结 Git commit 启动并完成 baseline 的至少一个可执行路径。

## 19. 风险与控制

| 风险 | 控制 |
|---|---|
| 双 Agent 消耗高于单 Agent | 记录两个 Agent 和全部 Worker usage，以墙钟时间、正确率和单位可靠结果成本共同评价 |
| Shadow Design 基于过期源码假设 | 轮转前检查 baseRevision、Design hash、Interface hash 和 Active 最终 diff |
| Work Package 过大导致轮转收益低 | System Design 按独立状态生命周期、测试边界和路径所有权划分 Package |
| Work Package 过小导致文档和审批膨胀 | 小 Component 合并到同一 Package，只有关键边界进入用户门禁 |
| 动态 DecisionRequest 漏掉重要选择 | Skill checklist 加 Harness 确定性规则共同检测高风险变化 |
| 移除固定 Topology Loop 后追踪变弱 | System Design Package继续保存 Component、Interface、路径和 Package 映射 |
| 独立验证阻塞轮转 | 两个独立 Worker 使用冻结副本；无依赖且不修改 shared interface 或全局协议的下一 Package 可以先轮转，当前 Package 继续保持 `VERIFYING` |
| Provider 抽象提前膨胀 | 第一版只实现 CodexCliRuntime，接口只覆盖当前真实调用能力 |

## 20. 已确认的实施设计点

1. `Design Component` 使用可选 `parentId` 表达唯一的设计归属层次。该字段不表达 Chisel 实例化、数据依赖或 Work Package 归属。
2. Stage2 使用两级批准。用户先完成一次 System Design Approval，再逐个完成 Package Design Approval。
3. 每个 Package 默认同时启动一个 Static Review Worker 和一个 Verification Worker。二者相互独立、只读并使用同一冻结版本。
4. 下一 Package 与当前 Package 无直接或间接依赖，且当前 Package 未修改 shared interface 或全局协议时，允许在独立验证完成前轮转。当前 Package 保持 `VERIFYING`，依赖它的 Package 不能提前晋升。
5. 当前 `S2_TOP_001` 六 Unit 结论只作为候选证据和历史记录。新 System Design 重新划分 Design Component 与 Work Package，不继承旧批准。
6. 正式 A/B 实验暂缓。当前先完成 `dual_issue_demo` 迁移、双 Agent 轮转、实现和独立验证闭环。

以上六项已经由用户确认，实施时不得重新作为开放设计问题。本文仍是重构计划，尚未修改产品逻辑、权威产品文档或 `dual_issue_demo` 状态。
