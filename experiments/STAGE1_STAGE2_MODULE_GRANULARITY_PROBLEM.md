# Stage1 与 Stage2 模块粒度问题记录

状态：问题已确认，产品重设计延期，Demo 使用临时兼容方案

记录时间：2026-08-31

关联材料：

1. [Stage1 权威计划](../PRODUCT_PLAN/STAGE1.md)
2. [Stage2 权威计划](../PRODUCT_PLAN/STAGE2.md)
3. `E:\107\dual_issue_demo\architecture\modules.yaml`
4. `E:\107\dual_issue_demo\design\plan.md`
5. `E:\107\dual_issue_demo\.assistant\reviews\stage1.json`

本文只记录问题、事实、备选模型和后续决策条件，不修改 Harness、Schema、Profile、用户项目状态或正式产品定义。

## 1. 问题结论

当前产品没有给出可操作且唯一的 Architecture Module 划分准则，也没有充分区分以下三种对象：

1. Stage1 Architecture Module
2. Stage2 Implementation Unit
3. Stage2 内部 Chisel Module 或 Pipeline 子模块

现有文档说明了三者职责不同，仍缺少决定某个实体应落在哪一层的判定规则。`dual_issue_demo` 的 Cache Architecture Rework 已经实际触发粒度漂移，Workspace Agent 可以在几种互不兼容的 Module Manifest 之间切换，并将 Stage2 Unit 边界写回 Stage1。

该问题影响产品核心分阶段模型。2026-08-31 用户决定先完成 `dual_issue_demo`，Stage1 与 Stage2 的产品重设计延期。当前 Demo 允许使用现有 Harness 所需的临时模块边界，相关结论不得晋升为通用产品事实。

### 1.1 临时执行决策

本轮采用以下处理方式：

1. 不在 Demo 中途重构 Stage1、Stage2、ProjectSpec、Review Correction 或 Topology Schema。
2. `dual_issue_demo` 继续通过现有 Harness 完成 Cache Architecture Rework、Stage1 重新批准和 Stage2 恢复。
3. 当前 8 模块候选可以作为 Demo 项目的临时兼容快照：`frontend`、`icache`、`instruction_queue`、`backend`、`dcache`、AXI arbiter、`control`、`core`。
4. 该快照只满足当前 Harness 的 Stage1 Module Manifest 和 Global Protocol owner 约束，不代表 Stage1 的最终产品定位。
5. Stage2 可以在 `frontend` 和 `backend` 内继续拆分 Fetch、Decode、RegFile、Issue、Execute、Memory、Retire、ALU、Branch 和 Pipeline 子模块。
6. Stage1 已确认的处理器目标、总体特性、流水边界、Cache 与 AXI 行为和全局可见语义继续具有约束力。临时 Module ID 不能覆盖这些架构事实。
7. Demo 开发中出现的职责重叠、owner 模糊、重复决策和返工成本继续记录，作为后续产品重设计证据。

## 2. 当前权威定义

[Stage1 计划](../PRODUCT_PLAN/STAGE1.md) 当前规定：

1. Stage1 确定全局 Architecture、Architecture Module 职责、共享语义边界、验证策略和用户批准。
2. Implementation Unit 划分、Interface owner、源码拓扑、实施 DAG、模块内部状态机和 Chisel 实现进入 Stage2。

[Stage2 计划](../PRODUCT_PLAN/STAGE2.md) 当前规定：

1. Stage1 Module Manifest 提供职责、状态所有权和契约消费关系。
2. Stage2 形成 Implementation Unit、共享接口所有权、源码组织、DAG 和实施 wave。
3. 一个 Implementation Unit 可以承载多个紧耦合 Architecture Module。

这些定义表达了阶段边界，没有定义 Architecture Module 的最小独立条件和最大聚合范围。

## 3. Demo 中已经出现的三种粒度

### 3.1 原 Stage1 Module Manifest

`dual_issue_demo` revision 117 的正式 Module Manifest 仍包含 10 个模块：

```text
fetch
decode
instruction_queue
regfile
issue
execute
memory
retire
control
core
```

该划分主要依据流水职责、跨周期状态所有权和全局协议 owner。它接近 Pipeline responsibility 粒度。

### 3.2 已回答的 Stage2 Implementation Topology

当前 `design/plan.md` 使用 5 个 Implementation Unit：

```text
frontend          <- fetch, decode
instruction_queue <- instruction_queue
backend           <- regfile, issue, execute, memory, retire
control           <- control
core              <- core
```

该划分主要依据源码组织、实施协作和整核子系统拓扑。它接近工程实施容器粒度。

### 3.3 Cache Rework 期间的候选 Module Manifest

Workspace Agent 先后形成过两种新提议。

第一种为 5 个 Stage1 Architecture Module：

```text
frontend
instruction_queue
backend
axi_aributer
core
```

该提议将 ICache、DCache、RegFile、Issue、Execute、Memory、Retire 和 control 分别并入 `frontend` 或 `backend`。Harness 因旧 Global Protocol owner 不存在而拒绝提交。

第二种为 8 个 Stage1 Architecture Module：

```text
frontend
icache
instruction_queue
backend
dcache
axi_aributer
control
core
```

该提议分离了 Cache、AXI 和全局控制状态，继续把 Fetch、Decode、RegFile、Issue、Execute、Memory 和 Retire 合并到两个整核子系统容器中。

两种提议都使用 `frontend` 和 `backend` 作为 Stage1 Architecture Module，同时这两个名称已经是 Stage2 Implementation Unit。阶段对象发生重叠。

## 4. 根因

### 4.1 `Module` 一词承担了多种语义

当前材料中的 `Module` 可能表示：

1. 架构职责边界
2. 状态生命周期 owner
3. 协议 owner
4. 流水阶段
5. 子系统容器
6. Chisel `Module`
7. Agent 工作和源码路径 owner

这些语义允许重合，不能默认等价。

### 4.2 Architecture Module 的资格条件未定义

当前没有回答以下问题：

1. 独立跨周期状态是否必然产生 Architecture Module。
2. 独立请求与响应生命周期是否必然产生 Architecture Module。
3. 一个 Architecture Module 最多可以包含多少互相独立的状态机。
4. Pipeline stage 是否天然具有 Architecture Module 身份。
5. 无状态的 `control` 和 `core` 为什么可以独立成 Module。
6. 只在 Stage2 中具有独立源码、接口或验证边界的 ALU 和 Branch 是否应进入 Stage1。

### 4.3 Stage1 与 Stage2 都在决定拓扑

Stage1 的 Module Manifest 包含 Module ID、依赖和 `stage2Order`。Stage2 又决定 Implementation Unit、Interface owner、路径 owner 和 DAG。Stage1 Module 使用 `frontend`、`backend` 等容器名称时，Stage2 的首个 Topology Decision 已被提前决定。

### 4.4 Protocol owner 与 Module 粒度强耦合

`architecture.globalProtocols[].owner` 只能引用一个 Architecture Module ID。细粒度 Manifest 可以表达 `issue`、`retire`、`control` 等准确 owner。粗粒度 Manifest 会把 pairing、forwarding、trap、retirement 和 Cache backpressure 大量归为 `backend`。

这种粗化仍可通过引用完整性校验，语义所有权却变得不精确。Stage2 需要再次决定内部 owner。

### 4.5 Architecture Rework 缺少粒度保持门禁

当前 Harness 会检查 Module dependency、`stage2Order` 和 Global Protocol owner 的引用完整性。它不会检查：

1. Architecture Module 是否被 Implementation Unit 替换。
2. 已批准的独立状态 owner 是否在返工中被无授权合并。
3. Stage2 是否因 Stage1 粗化而需要重新发明协议 owner。
4. 新 Module Manifest 是否遵循一套统一的划分准则。

如果 Workspace Agent 同时重写 Global Protocol owner，错误粒度可能通过现有确定性校验。

## 5. 两种可闭合模型

### 5.1 模型 A：细粒度 Architecture owner，Stage2 负责组合

Stage1 按稳定架构职责、独立状态生命周期和协议 owner 划分。Cache Rework 后的候选集合约为：

```text
fetch
decode
instruction_queue
regfile
issue
execute
memory
retire
control
icache
dcache
axi_arbiter
core
```

Stage2 再把这些 Architecture Module 组合为 `frontend`、`backend` 等 Implementation Unit。

优点：

1. 协议 owner 精确。
2. Stage1 与 Stage2 分工清晰。
3. 同一个 Architecture 可以探索多种源码和实施拓扑。
4. Architecture Rework 的影响范围可以落到稳定 Module ID。

代价：

1. Module Manifest 较长。
2. 部分 Architecture Module 最终可能没有一一对应的 Chisel `Module`。
3. 需要明确何时将紧耦合流水职责合并，避免按每个功能块无限拆分。

### 5.2 模型 B：子系统级 Architecture Module，Stage2 负责内部设计

Stage1 使用 `frontend`、`backend`、Cache、AXI、control 和 core 等子系统边界。Stage2 在每个子系统内决定 Pipeline、RegFile、Issue、Execute、Memory 和 Retire 的具体模块。

优点：

1. Stage1 文档规模较小。
2. Architecture Module 更接近整核框图。
3. Stage2 对模块内部组织保留更大自由度。

代价：

1. Stage1 Protocol owner 大量退化为 `frontend` 或 `backend`。
2. Stage2 需要重新闭合内部 owner 和模块边界。
3. 当前 Stage2 Implementation Unit Topology Loop 与 Stage1 子系统拓扑重复。
4. Architecture Rework 难以精确失效某个内部责任边界。

### 5.3 暂不引入第三层 Schema

可以进一步区分 Architecture Domain、Architecture Component 和 Implementation Unit。该模型会新增实体、Schema、映射关系和迁移成本。第一版应先验证模型 A 或模型 B 能否闭合，避免为解决命名混乱立即增加新层。

## 6. 必须拍板的问题

1. Architecture Module 的一句话资格条件是什么。
2. `frontend` 和 `backend` 属于 Architecture Module、Architecture 分区标签还是 Stage2 Implementation Unit。
3. `fetch`、`decode`、`issue`、`execute`、`memory` 和 `retire` 是否具有跨实现稳定身份。
4. RegFile、ICache、DCache 和 AXI arbiter 的独立状态生命周期是否足以要求独立 Architecture Module。
5. `control` 和 `core` 作为无状态模块的例外依据是什么。
6. Global Protocol owner 需要精确到 Architecture Module、内部责任名称还是 Implementation Unit。
7. `architecture.stage2Order` 仍需要表达什么。它不能继续同时表示 Architecture 展示顺序和 Stage2 实施顺序。
8. Stage2 `S2_TOP_001` 允许改变哪些边界，哪些边界必须继承 Stage1。
9. Architecture Rework 删除或合并现有 Module ID 时需要什么用户决策和影响分析。

## 7. 解决后的验收标准

1. 产品总纲可以用一句话区分 Architecture Module、Implementation Unit 和 Chisel Module。
2. 给定一个处理器框图，两名 Agent 按规则可以得到一致的 Stage1 模块集合。
3. 同一状态或协议只有一个明确 owner，Stage2 不需要补充全局架构语义。
4. Stage2 仍能比较至少两种不同 Implementation Topology，不受 Stage1 容器名称预先锁定。
5. `frontend`、`backend`、Cache、RegFile、Issue、Retire、control 和 core 都有明确的正例或反例说明。
6. Harness 能拒绝无授权删除、合并或改名 Architecture Module 的 Proposal。
7. Architecture Rework 可以确定性计算受影响 Topology Decision、Unit、Design 和验证证据。
8. `dual_issue_demo` 的 Module Manifest、Global Protocol owner、Stage2 Plan 和后续 Design 使用同一套粒度定义。

## 8. 当前处理约束

1. `dual_issue_demo` 当前仍为 Stage1 revision 117，状态为 `REVIEW_CORRECTION`，Architecture approval 无效。
2. 当前 Cache Module Manifest 与 Global Protocol Proposal 只能通过 Harness 和用户明确确认提交，不手工修改用户项目状态或正式文档。
3. 允许为满足当前 Demo 的引用完整性同步更新 Module Manifest、`stage2Order` 和 Global Protocol owner。该操作属于项目兼容修正。
4. 8 模块候选可以进入 `dual_issue_demo` 的临时 Architecture Snapshot，不能写入通用 Profile、产品总纲或其他项目模板。
5. 当前不增加 Architecture Domain、Architecture Component 或新的中间层 Schema。
6. 当前不删除 Stage1 Module Manifest，也不迁移 `architecture.stage2Order`。
7. Stage2 内部模块设计仍需服从已确认的流水、状态生命周期、Cache、AXI、redirect、trap、retirement 和 Store visibility 语义。
8. Demo 完成前不以本临时方案宣称 Stage1 与 Stage2 的产品边界已经解决。

## 9. 后续决策输出

Demo 完成后的产品重设计需要形成一份明确结论，至少包含：

1. 采用模型 A 或模型 B。
2. Architecture Module 资格条件和例外规则。
3. Stage1 到 Stage2 的映射规则。
4. Global Protocol owner 的目标粒度。
5. `architecture.stage2Order` 的保留、改名或删除方案。
6. Harness 新增的静态门禁。
7. `dual_issue_demo` 当前 rework 的恢复方案。

## 10. 重启产品设计的条件

满足以下条件后，停止沿用临时兼容方案并重新设计 Stage1 与 Stage2：

1. `dual_issue_demo` 已形成可编译、可仿真的顺序双发射 RTL baseline。
2. ISA、流水、Cache、AXI、异常、redirect、retirement 和 Store visibility 的必需定向测试通过。
3. 固定 workload 可以运行，并能产生可复现的 cycle、instruction 和 IPC 数据。
4. 至少一个完整 Unit 经历 Stage2 Design、用户批准、Implementation 和 Verification。
5. Demo 期间的 Module owner、Interface owner、文档重复、返工和用户交互问题已经形成可审查记录。

重设计时优先使用 Demo 证据回答第 6 节的问题，再同步产品总纲、Stage1、Stage2、Schema、Harness、Profile、用户指南和测试。临时 8 模块快照不自动迁移为新产品默认值。
