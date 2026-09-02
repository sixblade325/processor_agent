# 龙芯杯 Design 组织方法未被产品复用的问题

状态：问题已确认，作为第一代复盘和第二代重构输入

记录时间：2026-08-31

关联材料：

1. [Human Approval 退化问题](./HUMAN_APPROVAL_READABILITY_FAILURE.md)
2. [产品边界与简化重审记录](./PRODUCT_BOUNDARY_SIMPLIFICATION_REASSESSMENT.md)
3. [Stage1 与 Stage2 模块粒度问题](./STAGE1_STAGE2_MODULE_GRANULARITY_PROBLEM.md)
4. [龙芯杯 Design 入口](../../loong-cup-materials/WaterHanddoc/Design/README.md)
5. [龙芯杯整核 Design 入口](../../loong-cup-materials/Design/CPU.md)

本文记录 `processor_agent` 对龙芯杯遗产复用不完整的问题。本文只确定问题、参考模式和后续重构要求，不修改 Harness、Schema、当前 Demo 或正式产品计划。

## 1. 问题结论

第一代产品已经盘点龙芯杯遗产，并从中提取了部分处理器设计规则、Skill、源码案例和验证经验。龙芯杯项目中经过实际开发形成的 Design 信息组织方法没有进入产品设计。

当前产品主要复用了以下内容：

1. 处理器设计检查项和微架构闭合方法。
2. Chisel 实现、调试报告和验证材料。
3. Architecture、Design、Source、Verification 分层概念。
4. 面向 Agent 的约束、状态字段和审计规则。

以下关键资产没有得到复用：

1. 设计师从整核进入子系统、模块和机制的阅读路径。
2. Design 目录与处理器逻辑拓扑的自然对应关系。
3. 总纲、概述、外部约定、模块设计、最终设计和验证材料之间的职责划分。
4. 根据具体设计问题组织章节的写作方式。
5. Design 与源码在逻辑结构上的稳定映射。

产品因此拥有大量设计事实，却缺少适合人类设计师理解和修订这些事实的信息架构。

## 2. 龙芯杯遗产中的有效组织方式

### 2.1 从总体模型逐层进入局部设计

`WaterHanddoc/Design` 提供了清晰的阅读入口：

```text
Design/
├── README.md
├── 总纲.md
├── 概述.md
├── 外部约定.md
└── stage1/
    ├── 协议.md
    ├── load.md
    ├── store.md
    ├── Dcache.md
    └── LSU.md
```

各层职责明确：

1. `README.md` 说明目录结构和阅读入口。
2. `总纲.md` 记录总体原则、全局约定和分阶段实现路线。
3. `概述.md` 解释核心机制、模块关系和流水线行为。
4. `外部约定.md` 闭合跨模块约束。
5. 具体文档按 Load、Store、DCache、LSU 等设计对象展开。

设计师先建立全局模型，再进入某个机制或模块，不需要先理解任务调度和状态机实体。

### 2.2 目录拓扑对应处理器逻辑拓扑

`loong-cup-materials/Design` 采用以下主要结构：

```text
Design/
├── CPU.md
├── Frontend/
├── Dispatch/
├── Backend/
├── Commit/
├── Memory/
└── FinalDesign/
```

`CPU.md` 先给出整核组成、职责和连接关系。`Frontend`、`Backend`、`Commit` 和 `Memory` 随后按照真实设计边界继续展开。目录名称表达处理器结构，不表达 Agent assignment、Work Package 或执行 wave。

这种组织让以下关系可以直接被看见：

```text
系统设计对象
-> 子系统职责
-> 模块接口和状态
-> 具体源码
-> 模块验证
```

### 2.3 模块文档服从具体问题

龙芯杯模块文档没有强制使用完全一致的长模板。

例如：

1. `Backend.md` 重点描述内部对象、接口连接、写口映射、flush 分发和唤醒网络。
2. `ArithIssueQueue.md` 重点描述表项状态、分配回收、分派协议、唤醒和时序风险。
3. `FinalDesign/oooStore/LSU.md` 按 S1、S2A、S2B、S3 等周期阶段闭合 admission、forwarding、replay 和结算。
4. `总纲.md` 重点记录全局原则、硬件契约和实施阶段。

每份文档围绕读者需要理解的设计问题组织内容。字段和章节只有在服务该问题时出现。

### 2.4 设计成熟度和证据类型保持分离

遗产中存在普通模块文档、`FinalDesign`、优化设计、`*_codex.md` 诊断报告和独立 Verification 文档。它们表达不同成熟度和证据类型。

该结构允许设计师区分：

1. 当前系统如何工作。
2. 某个方案最终如何闭合。
3. 某次问题如何被调查和修复。
4. 哪些结论已经经过验证。

这些内容没有被压缩进一个统一的机器对象。

## 3. 第一代产品的实际偏离

| 维度 | 龙芯杯遗产 | 第一代产品 | 结果 |
|---|---|---|---|
| 阅读入口 | README、总纲、概述和整核索引 | Harness 当前状态和待批准 Proposal | 用户先理解流程状态 |
| 目录结构 | 处理器逻辑拓扑 | System Design、Work Package 和生成模板 | 执行模型侵入 Design |
| 文档形状 | 根据模块问题选择章节 | 每份 Package Design 使用近似固定字段 | 大量重复和低信号内容 |
| 修改方式 | 围绕具体机制修订文档 | 替换大型结构化对象并重新渲染 | 语义变化难以辨认 |
| 审批对象 | 可读设计方案 | Harness revision 和机器 Proposal | Approval 退化为 `confirm` |
| 源码映射 | 逻辑目录和模块名称自然对应 | sourcePaths 作为状态字段附着于 Package | 人类难以从设计导航到实现 |

当前 `dual_issue_demo/design/plan.md` 同时承担组件拓扑、状态所有权、接口、路径、Work Package、依赖关系、验收和风险。各 Package Design 又重复 Architecture 引用、源码参考、排除项、接口、字段、状态和不变量。完整性提高了，阅读效率和设计讨论质量下降了。

## 4. 根因

### 4.1 产品先设计了自动化状态，再设计用户如何理解结果

第一代优先解决以下问题：

1. Agent 在什么时候运行。
2. 哪个 Decision 可以提交。
3. 哪个 Worker 拥有任务。
4. revision、hash、lease 和 evidence 如何保存。
5. 如何阻止越权修改。

这些内部问题逐渐决定了用户文档结构。Design 成为 Harness 状态的投影。

### 4.2 过早追求统一 Schema

产品试图为所有处理器模块提供统一字段，导致简单模块和复杂子系统都被展开成相似的长文档。统一 Schema 适合审计和自动检查，无法独立承担人类 Design 的组织职责。

### 4.3 混淆逻辑拓扑与执行拓扑

处理器模块、Architecture Role、Design Component、Work Package、Worker Task 和源码路径属于不同层次。第一代多次尝试让同一组实体同时表达这些关系，直接引发 Stage1 与 Stage2 模块粒度争议。

### 4.4 遗产盘点停留在材料层

遗产整理确认了哪些文档、源码和验证材料可以参考，也提炼了通用 Skill。产品开发没有继续回答以下问题：

1. 人类当时如何从总纲进入模块设计。
2. 哪些文档在真实开发中被频繁维护。
3. 哪些结构帮助设计师发现冲突。
4. Design 如何随着实现和验证逐渐成熟。

## 5. 严重度与影响

该问题属于产品定义级严重缺陷，也是 Human Approval 退化问题的直接根因之一。

它造成以下影响：

1. Stage2 讨论被大量机器字段淹没。
2. 用户难以形成模块拓扑、周期和取舍的整体模型。
3. 用户无法快速判断 Agent 提案是否符合真实设计意图。
4. `confirm` 表达了流程授权，无法可靠证明设计理解。
5. Agent 可以生成形式完整的 Design，产品仍未完成设计师助手的职责。
6. 文档数量和状态复杂度继续增长时，可读性会进一步下降。

## 6. 第一代产品处理方式

第一代继续以完成 `dual_issue_demo` 和 CoreMark 为目标，不围绕该问题进行大规模目录迁移或 Harness 重写。

剩余 Demo 过程中采用以下限制：

1. 不继续扩展 Package Design 模板。
2. 用户需要审批时，优先提供短的拓扑、关键周期、取舍和影响摘要。
3. 持续记录 Design 可读性导致的误解、重复确认和返工案例。
4. CoreMark 完成后冻结第一代 Design、交互记录和运行数据。
5. 第一代生成文档作为第二代迁移输入，不作为必须兼容的格式标准。

## 7. 第二代产品的复用目标

第二代需要复用龙芯杯遗产的信息架构原则，同时清理遗产中的历史版本、命名不一致和项目专属事实。

最小用户目录候选为：

```text
architecture/
└── overview.md

design/
├── README.md
├── system.md
├── contracts.md
├── frontend/
├── backend/
└── memory/

verification/
└── plan.md
```

职责如下：

1. `architecture/overview.md` 说明用户批准的处理器目标、总体特性和全局语义。
2. `design/README.md` 给出当前 Design 地图、文档状态、阅读顺序和最近变化。
3. `design/system.md` 说明整体逻辑拓扑、主要数据通路和跨子系统关系。
4. `design/contracts.md` 只保存真正跨模块的接口、周期和所有权约定。
5. 子目录按处理器逻辑拓扑组织模块文档。
6. `verification/plan.md` 将架构和设计要求映射到验证目标。

Work Package、Agent assignment、Run、Lease、hash、授权路径和执行 DAG 只保存在 `.assistant/`。这些实体可以引用 Design 文档，不能决定 Design 目录和章节结构。

## 8. 模块 Design 的写作规则

模块文档根据实际问题选择以下内容：

1. 模块在系统中的位置和设计目标。
2. 对外接口与上下游关系。
3. 内部维护状态和生命周期。
4. producer、寄存边界、consumer 和副作用。
5. 关键周期行为与同拍优先级。
6. stall、kill、flush、redirect、retry 和异常语义。
7. 正确性不变量和主要取舍。
8. 源码与验证映射。

每个模块无需机械包含全部章节。跨模块事实只在 `contracts.md` 或唯一权威模块中完整定义，其他文档通过链接引用。

## 9. 用户交互与审批要求

第二代 Workspace Agent 面向用户展示以下顺序：

```text
Design 地图
-> 当前需要讨论的模块或机制
-> 本次语义变化
-> 主要方案与取舍
-> 受影响的接口、周期和验证
-> 明确的批准对象
```

用户批准绑定具体 Design Artifact 的 path、revision 和 content hash。完整机器状态只提供审计入口。Agent 生成草案后，讨论直接修改可读 Design，最终文档同时作为后续实现 Agent 的输入。

## 10. 第二代验收标准

完成复用需要满足：

1. 用户从 `design/README.md` 可以找到整核、子系统和模块设计。
2. 用户无需读取 `.assistant/` 即可解释处理器的主要拓扑和关键周期行为。
3. Design 目录与处理器逻辑拓扑一致，执行任务实体不出现在主导航中。
4. 模块文档可以直接导航到对应源码和验证。
5. 全局约定只有一个权威定义位置。
6. 一次 Design revision 可以生成简短、可读的语义差异。
7. 用户审批前可以说明本次变更的机制、代价和影响范围。
8. 删除 `.assistant/` 后，正式 Design 仍保持完整可读。
9. 使用 `dual_issue_demo` 验证新结构时，文档规模和批准轮次需要显著低于第一代。

## 11. 后续结论

龙芯杯遗产的 Design 组织方式应作为第二代产品的信息架构原型。复用对象是阅读路径、逻辑拓扑、文档职责和设计成熟过程，不包含 WaterHand、LoongArch 或具体访存实现事实。

第二代应先建立人类可读的 Design 结构，再设计 Schema、状态机和 Agent 调度如何支撑该结构。
