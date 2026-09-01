# Processor Agent 当前核心问题图谱

状态：当前问题层级已确认，作为第一代复盘与第二代重构输入

记录时间：2026-09-01

关联材料：

1. [Design 事实所有权倒置问题](./DESIGN_FACT_OWNERSHIP_INVERSION.md)
2. [Human Approval 退化问题](./HUMAN_APPROVAL_READABILITY_FAILURE.md)
3. [龙芯杯 Design 组织方法复用缺口](./LOONG_CUP_DESIGN_ORGANIZATION_REUSE_GAP.md)
4. [产品边界与简化重审记录](./PRODUCT_BOUNDARY_SIMPLIFICATION_REASSESSMENT.md)
5. [Stage1 开发与实跑复盘](./STAGE1_RETROSPECTIVE.md)
6. [Stage2 Runtime 与并发重构记录](./STAGE2_RUNTIME_AND_CONCURRENCY_REFACTOR_PLAN.md)

本文汇总第一代 `processor_agent` 当前暴露的核心问题，并区分产品边界、事实权威、人类工作表面、状态分层、语义正确性、运行可靠性和价值证据。本文不修改 Harness、Schema、当前 Demo 或正式产品计划。

## 1. 总体结论

当前最直接的两项核心产品问题是：

1. Design 臃肿，人类工作表面失效。
2. 处理器设计事实所有权倒置，设计师与 Agent 的话语权失衡。

这两项问题由更深层的产品边界和分层问题推动。Domain、Control、Runtime 混合、语义证据不足、Runner 边界缺失和价值验证缺失同样具有独立失败条件。任何一项未闭合，第二代都无法形成可交付产品。

完整问题图谱为：

```text
产品边界未收敛
        |
        v
Domain、Control、Runtime 混合
        |
        +-> 内部 Project Model 持续膨胀
        +-> 状态机补丁式增长
        +-> Work Package 和 Runtime 结构侵入 Design
        |
        v
Design 臃肿 + 事实所有权倒置
        |
        +-> 用户难以理解设计
        +-> Approval 退化为 confirm
        +-> Agent 获得事实定义权
        +-> Correction 和 Rework 成为主要修订入口

语义证据不足 -> 流程自洽无法证明处理器正确
Runner 边界缺失 -> 环境故障进入设计主流程
价值验证缺失 -> 无法判断产品是否缩短真实开发周期
```

## 2. 问题层级

| 问题轴 | 问题 | 失败条件 | 当前影响 |
|---|---|---|---|
| 产品范围 | 产品边界未收敛 | 主路径无法收敛为最小闭环 | 第一代同时建设过多系统 |
| 系统分层 | Domain、Control、Runtime 混合 | 任一层故障可以污染另外两层 | 处理器事实、流程状态和运行状态相互影响 |
| 人类工作表面 | Design 臃肿 | 设计师无法高效理解和修订设计 | Approval 退化为 `confirm` |
| 事实权威 | 事实所有权倒置 | 用户无法直接控制处理器设计事实 | Agent 和内部模型掌握事实定义权 |
| 语义正确性 | 语义证据不足 | 流程通过后仍可能形成错误处理器 | Schema 和 hash 无法证明微架构正确 |
| 运行可靠性 | Runner 边界缺失 | 正确设计无法稳定得到可复现结果 | 环境错误阻塞 Architecture 和 Design 流程 |
| 产品证据 | 价值验证缺失 | 无法证明产品提高开发效率和忠实度 | 尚未验证 `Idea -> Validated Result` 是否缩短 |

这些问题处于不同轴上，不构成可以按 L0 到 L3 依次降级的单一层级。产品边界和系统分层决定实现结构，Design 和事实权威决定用户角色，语义证据和 Runner 决定结果是否可信，价值验证决定产品是否成立。

### 2.1 后四项的独立失败条件

#### Domain、Control、Runtime 混合

即使 Design 已经简洁且由用户直接拥有，三层混合仍会让 Runtime Failure 改变 Artifact 状态，让 Control 规则阻塞正常设计修订。该问题会继续推动状态机膨胀和跨层恢复入口增长。

#### 语义证据不足

即使 Architecture 和 Design 的事实所有权已经正确，用户与 Agent 仍可能共同批准错误方案。缺少源码追踪、定向验证和独立反例审查时，产品只能保证文档自洽。

#### Runner 边界缺失

即使设计正确且实现忠实，环境不可复现、运行不可观察或任务无法真实取消时，产品仍无法稳定得到验证结果。设计师会继续承担工具链诊断和跨系统恢复成本。

#### 价值验证缺失

即使某次 Demo 最终通过 CoreMark，也需要测量总耗时、人工介入、返工、Architecture Fidelity 和直接 Codex 对照结果。缺少这些数据时，无法判断 Harness 带来的收益是否覆盖自身成本。

## 3. 元根因一：产品边界未收敛

第一代产品实际同时建设：

1. 处理器架构调研和讨论系统。
2. Architecture 与 Design 文档框架。
3. 处理器领域 Schema 和 Project Model。
4. 多 Agent 调度与恢复 Runtime。
5. Chisel 实现和验证执行系统。
6. Correction、Rework、Evidence 失效和迁移系统。
7. 后续 Optimization Loop 基础设施。

一级概念随之增加，包括 Decision、Correction、Finding、Rework、System Design、Work Package、Assignment、Lease、Worker、Run 和 Evidence。

产品核心价值尚未通过 Demo 得到验证时，这些概念已经进入代码、状态机和用户交互。后续故障只能继续增加迁移规则和恢复入口。

第二代需要将主路径收敛为：

```text
共同维护 Architecture 和 Design
-> Agent 实现
-> Runner 验证
-> Evidence 推动修订
```

## 4. 核心架构问题：Domain、Control 和 Runtime 混合

当前 Project Model 和 Harness 同时承担三类职责。

### 4.1 Domain

1. 处理器目标和总体特性。
2. 模块拓扑、接口和状态所有权。
3. 周期行为、协议和正确性不变量。
4. Source 与 Verification 映射。

### 4.2 Control

1. Artifact revision 和 approval。
2. Decision、Correction 和 Rework。
3. 依赖失效、门禁和阶段转换。
4. Work Package 和任务进度。

### 4.3 Runtime

1. Agent assignment 和 provider session。
2. Worker、Lease、Run 和并发调度。
3. 日志、超时、取消和恢复。
4. Windows、WSL、CLI 和 EDA 环境。

三层混合后形成以下故障传播：

1. Runtime 失败可以阻塞 Design approval。
2. Design 修订可以误伤合法 Worker result。
3. 环境错误可能触发 Architecture 或 Profile 返工。
4. Work Package 拓扑进入用户 Design 目录。
5. 用户需要理解 Harness 状态才能继续处理器开发。

第二代需要采用以下边界：

```text
Domain   = Architecture、Design、Source、Verification
Control  = Artifact、Task、Approval、Finding
Runtime  = Agent Session、Runner、Run、Log
```

各层通过具名 Artifact、hash 和结果协议连接。Runtime 不能拥有处理器语义，Control 不能决定 Design 信息架构。

该分层需要成为代码边界和失败边界：

1. Domain 修改只通过 Artifact revision 发生。
2. Control 只引用 Artifact，不复制处理器语义。
3. Runtime 只返回结果、证据或失败，不推进 Domain 状态。
4. Runner 失败只改变 Run 和 Task，不改变 Architecture 或 Design。
5. Agent session 丢失后，可以从 Artifact 和 Task 重新启动。

这项问题若继续存在，简化 Design 只能改善展示，无法阻止状态机继续增长。

## 5. 核心问题一：Design 臃肿

当前 Design 同时投影模块拓扑、状态字段、接口、路径、Work Package、依赖 DAG、审计信息和运行状态。Package Design 又重复 Architecture 引用、排除项、字段表、不变量和验证要求。

直接结果包括：

1. 用户缺少从整核进入子系统和模块的阅读路径。
2. 真正需要设计判断的问题被大量机器字段淹没。
3. 模块文档的章节由统一 Schema 决定。
4. 修改一个局部事实经常需要重新生成完整 Proposal。
5. Review Packet 无法提供足够的认知压缩。
6. 用户逐渐放弃审查并连续输入 `confirm`。

第二代 Design 应按照处理器逻辑拓扑组织，并从龙芯杯遗产复用总纲、概述、外部约定、模块文档和最终设计之间的职责划分。

## 6. 核心问题二：事实所有权倒置

当前事实流向为：

```text
Agent 内部理解
-> Project Model
-> Renderer
-> Design
-> 用户确认
```

用户看到的 Design 是内部机器状态的投影。用户修改设计事实时，需要通过 Correction、Rework 或 Harness 专用入口改变上游模型。

这造成：

1. Agent 决定处理器事实如何被分解和表达。
2. Schema 决定哪些设计事实可以存在。
3. Renderer 决定用户能够看到什么。
4. 用户直接修改 Design 可能引发审计失败或被重新生成覆盖。
5. Agent 的早期误解会被多个生成文档重复并固化。
6. 用户批准流程状态，难以证明对具体设计的理解。

第二代需要采用相反的派生方向：

```text
用户与 Agent 共同维护 Architecture 和 Design
-> Harness 派生索引、依赖和任务
-> Agent 实现
-> Verification 生成证据
```

内部机器模型只承担可删除、可重建、带原文位置的 Derived IR 职责。

## 7. 核心正确性问题：语义证据不足

第一代投入了大量 Schema、hash、revision、deterministic gate 和状态审计。这些机制可以证明：

1. 字段满足结构要求。
2. 引用和依赖关系存在。
3. Artifact 没有发生未登记漂移。
4. 状态转换符合 Harness 规则。

这些结果无法独立证明：

1. 微架构机制正确。
2. 周期和同拍优先级闭合。
3. flush、retry、late response 和 slot reuse 没有反例。
4. Source 忠实实现 Design。
5. 测试覆盖了关键错误路径。

Stage1 曾出现 deterministic review 全部通过，后续独立 architecture audit 失败的情况。这说明流程一致性和语义正确性需要独立处理。

该问题具有独立产品风险。Architecture 和 Design 成为权威后，产品仍需要证明它们值得信任。用户批准表示接受方案及其取舍，不承担发现全部周期反例、协议漏洞和实现偏差的责任。

第二代证据关系应为：

```text
Architecture 和 Design 定义目标
Source 实现目标
Verification 提供行为证据
Independent Review 主动寻找反例
Finding 驱动新的 Artifact revision
```

最低证据闭环需要包含：

1. 每项高影响 Design 结论的依据和假设。
2. producer、寄存边界、consumer 和副作用追踪。
3. flush、stall、kill、retry、late response 和复用边界检查。
4. Source 到 Design 的实现映射。
5. Verification 到不变量和反例的覆盖映射。
6. 独立 Reviewer 与 Author 的证据分离。
7. 未闭合风险的显式保留。

语义 Review 失败生成 Finding。Finding 指向具体 Artifact 和证据，不进入新的专用 Stage 状态。

## 8. 核心可运行性问题：Runner 边界缺失

当前 Windows、WSL、Codex CLI、Node.js、SBT、仿真工具、路径权限、认证和文本编码进入同一工作流。Worker 经常在启动后才发现环境不可用。

已经出现的影响包括：

1. 只读命令被策略拒绝。
2. Windows 与 WSL 路径不可读取。
3. CLI 协议版本和会话版本漂移。
4. 登录、认证和模型配置阻塞 Research 或 Design。
5. stderr 编码错误导致恢复条件不可读。
6. 运行中缺少流式进度、超时分级和真实取消。
7. Runtime Failure 与 Design Failure 混合呈现。

第二代 Runner 需要提供：

1. 任务启动前的统一 doctor。
2. 固定且可复现的执行环境。
3. 明确的 Read Manifest 和写入边界。
4. 流式日志、心跳、超时和真实取消。
5. 不可变 Run 证据。
6. 独立的 Runtime Failure 分类。

环境失败不能自动演化为 Architecture、Design 或 Profile 修订。

Runner 需要形成独立产品契约：

```text
Task + Read Manifest + Environment Spec
-> Preflight
-> Execution
-> Streaming Events
-> Immutable Result 或 Runtime Failure
```

Harness 只消费标准结果。Windows、WSL、容器、远程 Linux 和具体 EDA 工具由 Runner Adapter 处理。Workspace Agent 无需解释 shell 策略、认证文件、文本编码和路径转换。

Runner 未完成预检时，不应启动设计、实现或验证 Worker。运行失败后，Task 可以重试、迁移环境或终止，正式 Artifact 保持不变。

## 9. 核心产品证据问题：价值验证缺失

当前第一代仍未完成以下闭环：

```text
Approved Architecture
-> Design
-> Chisel Source
-> Build 和定向测试
-> CoreMark
-> Architecture Fidelity 审查
```

因此尚未获得以下证据：

1. 产品是否缩短 `Idea -> Validated Result`。
2. 产品是否提高 Architecture Fidelity。
3. 产品是否减少遗漏、返工和无依据保护。
4. 产品增加的流程成本是否低于节省的工程成本。
5. 双 Agent 是否提高单位时间内的可靠结果产出。
6. 用户是否真正理解并修正了 Agent 提案。

无人干预 A/B 只能评估实现自动化、测试通过率和约束遵守情况。设计师助手的价值需要真实用户参与，并记录批准前讨论、用户修正、推荐覆盖和解释设计所需时间。

价值验证需要分成两类实验。

### 9.1 Implementation Automation 实验

目标是判断 Harness 是否帮助 Agent 从批准 Architecture 得到可运行实现。

至少记录：

1. 构建、定向测试、集成测试和 CoreMark 是否通过。
2. 总墙钟时间、模型调用时间和 Runner 时间。
3. Agent 调用次数、失败次数和重试原因。
4. Architecture Fidelity 偏差数量。
5. 无依据状态、额外串行化和未授权接口变化数量。

### 9.2 Designer Assistance 实验

目标是判断产品是否帮助设计师形成更完整、更可靠的方案。

至少记录：

1. 用户提出的修正和覆盖 Agent 推荐的次数。
2. Approval 前有效讨论轮次和连续 `confirm` 比例。
3. 用户识别关键取舍所需时间。
4. 用户解释最终 Design 所需时间。
5. Design reopen 和实现返工次数。
6. 从 Architecture Idea 到验证结果的总时间。

第一类实验通过后只能证明实现自动化能力。第二类实验通过后，产品才具备设计师助手的直接证据。

## 10. 已知症状的归属

| 已知症状 | 主要根因 |
|---|---|
| 连续 `confirm` | Design 臃肿、事实所有权倒置 |
| Stage1 与 Stage2 模块粒度反复变化 | 产品边界未收敛、Domain 与 Control 混合 |
| Correction 状态膨胀 | 大型 Project Model、状态维度混合 |
| Rework 类型持续增加 | 缺少统一 Artifact revision 和依赖失效模型 |
| Package Design 全量重生成 | Design 被建模为大型机器对象 |
| 双 Agent 轮转缓慢 | Runtime 生命周期和 provider session 设计不清晰 |
| 环境问题触发流程阻塞 | Runner 边界缺失 |
| deterministic review 通过后 audit 失败 | 流程一致性替代语义证据 |
| 用户无法理解当前批准对象 | Design 臃肿、Control 状态侵入交互 |

这些症状不应分别推动新增长期实体和专用状态。第二代优先修复其共同根因。

## 11. 第一代处理边界

第一代继续以完成 `dual_issue_demo` 和 CoreMark 为目标。后续采用以下约束：

1. 暂停增加新的 Stage2 长期状态和恢复实体。
2. 不围绕当前问题大规模迁移 Design 目录。
3. 持续记录真实失败、用户误解和人工绕过方式。
4. 环境故障单独记录，不修改处理器设计事实。
5. CoreMark 完成后冻结代码、文档、状态和交互证据。
6. 第一代 Harness 作为实验样本，不自动晋升为第二代架构。

## 12. 第二代不可省略的四组门禁

以下顺序表达建设依赖，不表达问题严重度。四组门禁全部闭合后，第二代才具备交付条件。

### Gate A：事实与人类工作表面

1. Architecture 和 Design 成为处理器语义权威。
2. Design 按处理器逻辑拓扑组织。
3. 用户直接修订和批准 Artifact。
4. 内部模型降级为 Derived IR。

### Gate B：产品边界与三层分离

1. 主路径收敛为讨论、草案、批准、实现和验证。
2. Domain、Control 和 Runtime 形成明确代码边界。
3. Artifact、Task、Approval、Finding 和 Run 使用独立生命周期。
4. Work Package 和 Agent 调度退出用户 Design 信息架构。
5. Runtime Failure 不得推进 Domain revision。

### Gate C：语义证据与稳定 Runner

1. 独立 Review 主动寻找设计反例。
2. Source 和 Verification 对 Design 提供可追溯证据。
3. Runner 在 Worker 启动前完成统一预检。
4. Runner 支持流式日志、心跳、超时、取消和不可变结果。
5. 语义 Finding 与 Runtime Failure 使用不同路径处理。

### Gate D：端到端价值验证

1. 跑通 CoreMark 端到端 Demo。
2. 分别执行 Implementation Automation 和 Designer Assistance 实验。
3. 测量时间、Architecture Fidelity、人工修正和返工成本。
4. 与直接 Codex 使用相同起点、模型预算和验收要求。
5. 用实验结果决定多 Agent、Research Worker 和通用 Runtime 是否进入产品核心。

## 13. 第二代最低验收条件

第二代产品至少需要满足：

1. 用户无需理解 Harness 即可阅读和修订 Architecture 与 Design。
2. 删除 `.assistant/` 后处理器设计语义完整保留。
3. 内部状态可以从正式 Artifact 和 Run Evidence 重建。
4. Runtime 失败不会改变 Architecture 或 Design。
5. 每次批准绑定具名 Artifact、revision、hash 和语义差异。
6. Design 文档不暴露 Work Package、Lease、Worker 和 Run 拓扑。
7. 独立 Review、Source 和 Verification 可以产生可追溯 Finding。
8. 新 Agent 通过正式文档即可接管处理器项目。
9. 端到端 Demo 可以构建、运行定向测试并完成 CoreMark。
10. 实验能够回答产品是否真正提高处理器设计效率与忠实度。

## 14. 核心判断

第一代当前问题的核心结构为：

```text
产品边界与分层失控
-> 内部状态获得过多权力
-> Design 臃肿和事实所有权倒置
-> 用户协作失效
```

三层分离、语义证据、Runner 和价值验证属于第二代的独立核心问题。它们分别决定产品架构能否保持简单、处理器结果能否可信、工作流能否稳定运行，以及产品价值能否成立。
