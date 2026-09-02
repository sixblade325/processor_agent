# Human Approval 退化为 `confirm` 的产品设计问题

状态：严重问题已确认，第一代止损方案与第二代重设计要求待实施

记录时间：2026-08-31

关联材料：

1. [产品边界与简化重审记录](./PRODUCT_BOUNDARY_SIMPLIFICATION_REASSESSMENT.md)
2. [Stage1 开发与实跑复盘](./STAGE1_RETROSPECTIVE.md)
3. [产品总纲](../PRODUCT_PLAN/PRODUCT_PLAN.md)
4. [Stage1 权威计划](../PRODUCT_PLAN/STAGE1.md)
5. [Stage2 权威计划](../PRODUCT_PLAN/STAGE2.md)

本文记录第一代 `processor_agent` 在真实 `dual_issue_demo` 中暴露出的 Human Approval 失效问题。本文不修改 Harness、Schema、用户项目状态或当前 Demo 流程。

## 1. 问题结论

`processor_agent` 的产品定位是处理器设计师的助手。人类设计师保留 Architecture 和高影响 Design 的决策权，Agent 负责调研、展开设计空间、闭合细节、实现和验证。

当前产品虽然保留了形式上的用户批准门禁，面向用户的 Design 和 Approval Packet 可读性过差。用户难以在合理时间内建立处理器拓扑、接口、周期行为和取舍模型，讨论环节因此逐渐退化为连续输入 `confirm`。

最终形成以下实际流程：

```text
Agent 生成大型机器 Proposal
-> Harness 投影长文档和大量结构化字段
-> 用户难以定位真正需要判断的设计问题
-> 用户输入 confirm
-> Agent 推荐直接晋升为批准事实
```

Human Approval 在结构上存在，Human Understanding 没有得到产品支持。该问题直接破坏产品的核心价值主张。

## 2. 严重度

严重度：产品定义级 P0。

理由：

1. 用户批准不再代表用户理解并接受设计取舍。
2. Architecture 和 Design 实际由 Agent 主导，用户只承担形式责任。
3. 后续 Implementation 即使通过测试，也无法证明实现忠实于设计师意图。
4. Processor Agent 与 Direct Codex 的核心差异随之消失。
5. 无人干预实验可以测量自动实现能力，无法验证设计师助手的核心价值。

该问题不必阻塞第一代 Demo 运行至 CoreMark。它必须作为第一代交付的已知核心缺陷，并成为第二代重设计的首要输入。

## 3. 必要设计成本与产品摩擦

处理器设计本身需要时间。设计师需要理解 workload、ISA、流水线、状态所有权、Cache、外部协议、性能和验证取舍。产品目标不包含消除这些必要思考。

总时间需要拆分为：

```text
T_total
├── T_human_reasoning       必要的人类架构思考
├── T_agent_research        Agent 调研和源码追踪
├── T_design_discussion     有效设计讨论
├── T_product_friction      阅读困难、状态操作和重复确认
├── T_rework                产品缺陷导致的返工
└── T_environment_failure   环境故障
```

产品应降低 `T_product_friction`、`T_rework` 和 `T_environment_failure`，并提高单位 `T_human_reasoning` 产生的决策质量。

当前无法只根据 `T_coremark_complete` 判断产品效率。较长的 Architecture 讨论可以产生高质量设计。大量无理解的 `confirm` 即使耗时较短，也属于低质量交互。

## 4. 当前可观察证据

### 4.1 用户行为

1. 用户已经多次指出 Stage1 和 Stage2 输出可读性差。
2. 用户难以从完整 Architecture、Module、Protocol 和 System Design 投影中定位当前批准内容。
3. 用户在长 Proposal 后频繁使用 `confirm`，有效追问和设计修正逐渐减少。
4. 当前没有 telemetry 统计 `confirm_only_ratio`、阅读时间和批准前讨论轮数，无法量化退化程度。

### 4.2 文档与展示

1. Design 文档同时承载硬件设计、人类说明、Work Package、路径、依赖、哈希和 Harness 状态。
2. System Design 和 Package Design 的主展示过长，关键拓扑与关键取舍缺少稳定摘要。
3. 机器可读 Proposal 的字段顺序主导用户阅读顺序。
4. 当前界面缺少相对上一 revision 的 Design Delta。
5. 当前界面缺少“本次批准后具体冻结什么”的短列表。

### 4.3 流程数据

[Stage1 实跑复盘](./STAGE1_RETROSPECTIVE.md)记录：

1. 8 个最终 Decision 共发生 26 次提交。
2. 21 次现代 Research 只有 11 次 Evidence 充分。
3. 5 次 audit 中前 4 次失败。
4. 共执行 10 次 Review Correction。

这些数据证明设计闭合和返工成本很高。当前数据没有区分必要的人类设计思考与产品可读性造成的重复操作。

## 5. 根因

### 5.1 产品先定义机器状态，后生成用户界面

当前用户文档主要是 ProjectSpec、System Design Proposal、Work Package 和 Evidence 状态的投影。机器模型中的一级实体直接成为用户需要理解的一级概念。

### 5.2 Design 知识按照执行拓扑组织

Work Package 是 Agent 调度、路径权限和验证单位。硬件设计师更关心组件、接口、状态所有权、数据流、周期行为和取舍。两种拓扑混合后，文档无法形成稳定阅读路径。

### 5.3 用户门禁覆盖过多局部实现问题

局部类型、普通 helper、代码布局、测试组织和低风险可逆实现选择也可能进入 Approval Packet。用户需要筛选大量无需承担后果的信息。

### 5.4 缺少认知压缩层

Agent 已经读取大量源码、Research 和机器 Proposal，却没有把这些内容压缩成设计师可以判断的最小决策面。

### 5.5 `confirm` 没有绑定明确语义

自然语言 `confirm` 经 Workspace Agent 映射为当前门禁批准。用户看到的对象过长或不明确时，`confirm` 仍然可以推进正式状态。

## 6. 第一代止损方案

第一代目标继续保持为完成 `dual_issue_demo` 并运行 CoreMark。止损方案只调整展示和运行纪律，不重构底层状态机。

### 6.1 增加 Human Review View

每个用户门禁前，由 Workspace Agent 根据当前机器 Proposal 生成一页 Review Packet。该 Packet 只在对话中展示，不新增长期正式实体。

Architecture Decision Review Packet：

```text
当前要决定什么
为什么需要设计师决定
已批准的前置约束
候选方案
正确性、性能、时序和验证代价
Agent 推荐及证据
本次批准后冻结的内容
仍未确定的内容
```

System Design Review Packet：

```text
组件拓扑图
组件职责和状态所有权表
跨组件接口表
关键数据流或逐周期图
相对上一 revision 的变化
风险和开放问题
本次批准后冻结的内容
```

Package Design Review Packet：

```text
当前组件职责
使用和改变的 shared interface
状态生命周期与周期边界
同拍优先级和异常路径
新增状态、组合路径和时序代价
验收测试
需要用户决定的问题
```

完整 Design 文档继续作为可展开的依据，主交互默认显示 Review Packet。

### 6.2 收紧用户打断条件

只有以下变化进入用户门禁：

1. Architecture 行为或外部可见语义。
2. 跨组件接口和状态所有权。
3. 流水边界和主要时序取舍。
4. 新增跨周期身份、retry、replay 或全局状态。
5. 扩大 stall、flush、kill 或 serialization 范围。
6. 明显改变性能、面积或验证成本的选择。

局部类型、helper、内部 Bundle 组织、普通 mux 和测试代码结构由 Agent 闭合并记录。

### 6.3 绑定 `confirm` 的批准对象

Workspace Agent 接受 `confirm` 前必须明确显示：

```text
Artifact path
revision
content hash
批准摘要
批准后失效或冻结的范围
```

一次 `confirm` 只绑定当前展示的一个具名 Artifact revision。不存在清晰 Review Packet 时，不应提示用户输入 `confirm`。

## 7. 第二代重设计要求

第二代产品需要从 Human Review 出发设计信息架构。

1. 用户文档按照处理器硬件拓扑组织。
2. Work Package、Agent、Lease、Run 和 Evidence hash 保留为内部实体。
3. Architecture、Design、Source 和 Verification 构成用户的主要事实模型。
4. Design 主视图固定包含拓扑、接口、周期和不变量。
5. 每次 revision 自动生成语义 Delta。
6. 用户只批准 Artifact，不批准模糊的 Harness 状态。
7. Agent 推荐与用户最终结论分别记录。
8. 用户修正必须保留原始表述和被改变的推荐。
9. Review Packet 可以从正式 Artifact 确定性重建。
10. 删除 `.assistant/` 后，人类仍能理解设计与批准历史。

## 8. 实验设计影响

原无人干预 A/B 方案只能测量：

1. Agent 是否能完成 Chisel 实现。
2. Harness 是否提高自动验证通过率。
3. 文档和门禁是否约束 Agent 行为。

它无法测量：

1. 设计师是否理解当前设计。
2. 产品是否帮助设计师发现遗漏。
3. 设计师是否改变了 Agent 推荐。
4. 产品是否降低设计师的认知负担。
5. 最终实现是否更忠实于设计师真实意图。

第二代正式实验需要真实设计师参与，并记录：

```text
confirm_only_ratio
human_correction_count
recommendation_override_count
discussion_turns_before_approval
approval_reopen_count
time_to_identify_key_tradeoff
time_to_explain_approved_design
```

无人干预实验可以继续作为 Implementation Automation 子实验，不能独立证明 Processor Agent 的产品价值。

## 9. 验收标准

Human Approval 问题完成修复需要满足：

1. 用户在批准前可以用短摘要说明当前决策、主要代价和冻结范围。
2. 主视图不直接展示完整机器 Proposal。
3. 每个门禁只包含一个清晰批准对象。
4. 每次 revision 都有可读 Design Delta。
5. 无需用户判断的局部实现选择不打断主流程。
6. `confirm` 绑定 Artifact path、revision 和 hash。
7. 可以统计批准前讨论、用户修正、推荐覆盖和重新打开次数。
8. 完整 Design 和机器状态仍可展开审计。

## 10. 第一代处理结论

第一代不围绕该问题重构 Harness。后续 Demo 运行中持续记录退化案例，并在可行范围内由 Workspace Agent 提供 Review Packet。CoreMark 完成后冻结第一代状态、正式文档和交互证据。

第二代产品以本文作为核心重设计输入。Design 可读性和 Human Approval 有效性需要先于多 Agent 并发、复杂状态恢复和通用 Runtime 扩展。
