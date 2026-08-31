# Processor Agent 产品边界与简化重审记录

状态：讨论结论已记录，产品重构方案待确认

记录时间：2026-08-31

关联材料：

1. [产品总纲](../PRODUCT_PLAN/PRODUCT_PLAN.md)
2. [Stage1 权威计划](../PRODUCT_PLAN/STAGE1.md)
3. [Stage2 权威计划](../PRODUCT_PLAN/STAGE2.md)
4. [Stage1 与 Stage2 产品重构计划](./STAGE1_STAGE2_PRODUCT_REFACTOR_PLAN.md)
5. [Stage2 双 Agent Harness 重构计划](./STAGE2_SKILL_DRIVEN_DUAL_AGENT_HARNESS_REFACTOR_PLAN.md)

本文记录近期对产品边界、复杂度、现有开源项目和三阶段模型的重新审视。本文不修改当前产品逻辑、Schema、用户项目状态或权威阶段计划。后续重构经用户确认后再同步到产品总纲和阶段计划。

## 1. 已确认的问题

当前产品暴露出三组稳定问题。

### 1.1 Design 文档缺少清晰的人类信息架构

1. Design 下的文档组织没有形成稳定、直观的阅读路径。
2. 文档泄漏较多 Harness 内部结构，例如 revision、Work Package、路径、哈希、依赖和 Schema 字段。
3. 用户难以从文档中快速理解处理器拓扑、职责、接口、周期行为和当前设计变化。
4. 审批逐渐退化为连续输入 `confirm`，Human-in-the-loop 门禁失去实际审查价值。
5. 当前 Design 知识容易按照 Agent 调度结构组织，无法稳定映射硬件本身的逻辑拓扑。

### 1.2 状态机持续补丁式增长

1. 当前状态同时表达文档成熟度、实现进度、返工原因、Agent assignment、Worker 运行和证据有效性。
2. 新故障经常通过增加状态、恢复入口或特殊迁移规则处理。
3. 多个正交维度被压入同一状态枚举，合法转换和恢复条件越来越难以解释。
4. 状态机开始主导产品交互，用户需要理解 Harness 才能继续处理器开发。
5. 返工机制按故障种类扩展，缺少统一的 revision 与依赖失效模型。

### 1.3 环境问题频繁进入核心流程

1. Windows、WSL、Codex CLI、Node.js、SBT、仿真工具、权限和认证相互耦合。
2. Worker 经常在运行后才发现工具不可用、路径不可读、认证失效或命令被策略拒绝。
3. 环境故障与 Architecture、Design 和实现故障混在同一用户流程中。
4. Harness 承担了较多通用 Runtime 和 EDA 执行基础设施职责。

## 2. 根因判断

前两组问题共享同一根因：产品在用户协作方式、设计产物边界和第一版核心价值尚未稳定时，提前固化了完整工作流。

当前第一版实际同时建设：

1. 处理器架构讨论与调研系统。
2. 通用文档驱动开发 Harness。
3. 多 Agent 调度与恢复 Runtime。
4. 处理器 System Design 和 Package Design 方法。
5. Chisel 实现与验证执行系统。
6. Architecture Rework、证据失效和 Schema 迁移系统。
7. 后续 Optimization Loop 的基础设施。

一级产品概念因此持续增加，包括 Decision、Correction、Finding、Rework、System Design、Work Package、Assignment、Lease、Worker、Run 和 Evidence。产品核心边界没有收敛时，状态机和文档只能被动承接这些未稳定概念。

## 3. 产品简单性原则

一个好的产品需要具备较少的一级概念、稳定的规则和短的主要用户路径。内部实现可以处理必要复杂度，用户无需理解 Agent 调度、租约、运行哈希和恢复细节。

`processor_agent` 的核心价值暂定为：

> Processor Agent 与用户确认处理器架构，将其转化为可审查的 Design，并驱动 AI 完成 Chisel 实现和验证。

用户需要理解的持久事实应收敛为四类：

```text
Architecture  想要什么处理器
Design        准备怎样实现
Source        实际实现是什么
Verification  实现是否满足设计
```

主要流程应能压缩为：

```text
讨论 -> 草案 -> 用户批准 -> 实现 -> 验证
```

每个新增实体、状态或门禁都需要回答：

1. 是否直接提高 Architecture Fidelity。
2. 是否缩短 `Idea -> Validated Result`。
3. 用户是否必须理解它。

前两项均不满足时，从第一版删除。第三项不满足时，保留为内部实现细节。

## 4. 三阶段模型继续保留

Stage1、Stage2 和 Stage3 对应三种不同问题、权威产物和完成条件，仍是必要的产品宏观边界。

### 4.1 Stage1 Define

目标：确定要做一颗什么处理器。

权威产物：用户批准的 `Architecture`。

Stage1 负责：

1. 目标 workload、成功指标和资源约束。
2. ISA、流水线、发射和退休模型。
3. Lane 能力、Cache 行为和外部系统边界。
4. 全局可见语义和最低验证要求。

Stage1 不确定源码模块、路径、Agent Work Package 和实施顺序。

### 4.2 Stage2 Realize

目标：把已批准的 Architecture 转化为可实现、可验证的处理器。

权威产物：批准的 `Design`、正式 `Source` 和 `Verification` 证据。

Stage2 负责：

1. 组件拓扑、职责和状态所有权。
2. 接口、周期契约和源码组织。
3. Chisel 实现、定向测试和集成验证。
4. Architecture 与实现的一致性检查。

Stage2 发现总体 Architecture 错误时返回 Stage1。

### 4.3 Stage3 Improve

目标：测量现有实现，提出优化假设并通过实验决定是否接受。

权威产物：可复现的 A/B Evidence 和接受或拒绝结论。

Stage3 负责：

1. 性能、时序和资源测量。
2. 瓶颈诊断和优化假设。
3. Architecture Change 创建。
4. A/B 评估和结论保存。

Stage3 产生的 Change 交由 Stage2 完成 Design、实现和验证。

整体循环为：

```text
Stage1 -> Stage2 baseline -> Stage3
                           |
                           v
                 Optimization Change
                           |
                           v
                        Stage2
                           |
                           v
                    A/B Evaluation
```

需要简化的是每个 Stage 内部的一级概念和用户交互。Agent 数量、Worker、运行记录、哈希和调度不扩大用户对三阶段的理解成本。

## 5. Design 信息架构候选方向

以下内容是待确认的重构方向。

Design 知识按照硬件逻辑拓扑组织。Work Package 继续作为内部执行和权限单位，不决定人类文档结构。

最小候选结构为：

```text
design/
├── system.md
└── components/
    └── <component>.md
```

`design/system.md` 只回答：

1. 整体组件拓扑。
2. 每个组件的职责和状态所有权。
3. 共享接口与全局协议如何落地。
4. Architecture Role 到 Design Component 的映射。
5. 集成顺序、主要风险和验证映射。

`design/components/<component>.md` 只回答：

1. 组件边界、输入、输出和依赖。
2. producer、寄存边界、consumer 和副作用。
3. 状态生命周期、周期行为和同拍优先级。
4. stall、kill、flush、redirect、retry 和异常处理。
5. 断言、定向测试和验收要求。

`.assistant/` 保存 Work Package、路径授权、Agent assignment、运行记录和哈希。用户审批界面展示具名 Design revision 的拓扑、关键变化、影响、风险和真正需要用户承担后果的问题，不投影完整机器状态。

## 6. 状态模型候选方向

当前混合状态可以拆成三个互相独立的简单生命周期：

```text
Artifact: draft -> reviewed -> approved -> superseded
Task:     pending -> running -> verifying -> complete | failed
Run:      active -> finished | cancelled | orphaned
```

候选规则：

1. 用户只批准具名 Artifact revision 和内容哈希。
2. 返工创建新 revision，旧 revision 作为历史保留。
3. Architecture、Design 或源码变化导致的失效由依赖和哈希派生，不继续增加组合状态。
4. Agent assignment、lease 和 provider session 只属于 Runtime 元数据。
5. 所有失败通过 Artifact 修订、Task 重试或 Run 终止三种通用机制恢复。
6. `confirm` 只对当前明确展示的产物生效，不用于模糊推进 Harness 状态。

## 7. 环境与 Runner 候选方向

环境问题需要收敛到独立 Runner 边界：

1. 任务开始前统一执行 `doctor`，验证路径、工具版本、认证、权限和构建命令。
2. 固定一个 Linux、WSL 或容器执行环境，不允许 Worker 临时推断运行位置。
3. Coding Agent 负责推理和文件提案，Runner 负责构建、仿真和综合。
4. 环境失败在 Agent 任务启动前 fail fast，不进入 Architecture 或 Design 返工。
5. 原始日志和构建产物继续进入 `.runtime/`，正式验证只引用命令、版本、结果和证据哈希。

## 8. 开源项目与重复建设判断

当前产品形态可以拆成通用文档工作流和处理器领域工作流。GitHub 上已经存在与两部分分别高度相关的项目。

| 项目 | 可复用方向 |
|---|---|
| [GitHub Spec Kit](https://github.com/github/spec-kit) | 通用 Spec 驱动 Harness、阶段化 Markdown 产物、多 Coding Agent 接入和扩展机制 |
| [OpenSpec](https://github.com/Fission-AI/OpenSpec) | 正式规格与 Change 分离、文档驱动协作和多 Agent 工具适配 |
| [HAgent](https://github.com/masc-ucsc/hagent) | LLM 与 EDA 工具集成、MCP、Docker、YAML 流程、Chisel 编译和综合执行 |
| [ReChisel](https://github.com/niujuxin/ReChisel) | Chisel 生成、编译与仿真反馈、迭代修复 |
| [UCAgent](https://github.com/XS-MLVP/UCAgent) | 自动验证、覆盖率、文档与报告一致性和 MCP 接入 |

当前检索没有发现完整覆盖以下链路的开源项目：

```text
处理器目标讨论
-> 用户批准 Architecture
-> 处理器 System Design
-> Chisel 实现
-> 独立验证
-> Architecture Rework
-> Optimization A/B
```

重复建设主要集中在：

1. Coding Agent provider adapter。
2. 通用 Spec、Plan、Task 和 Change 生命周期。
3. Docker 与 EDA Runner。
4. 编译、仿真、综合和错误反馈循环。
5. 通用 Worker 调度、日志、取消和恢复。

Processor Agent 需要保留的领域价值包括：

1. 处理器 Architecture 与 Design Schema。
2. ISA、流水线、Lane、Cache、retirement 和 AXI 语义闭合。
3. producer、寄存边界、consumer 和副作用追踪。
4. Architecture Fidelity 审查。
5. Architecture Rework 与受影响证据选择性失效。
6. 面向处理器 baseline、CoreMark 和优化实验的证据链。

后续产品形态可以评估：Processor Agent 维护处理器领域模型和工作流，复用 Spec Kit 或 OpenSpec 的通用文档机制，并复用 HAgent 或同类项目的 EDA 执行能力。

## 9. 第一版范围候选

为重新回到单一核心功能，第一版可以候选冻结为：

```text
输入：已经批准的处理器 Architecture
输出：人类可审查的 System Design
   -> Chisel 实现
   -> 构建、定向测试和 CoreMark 集成验证
```

在该范围下：

1. `dual_issue_demo` 的已批准 Architecture 作为固定实验输入。
2. 第一版完整验证 Stage2 主链。
3. Stage1 保留 Architecture 输入契约和最小人工流程。
4. Stage3 保留 Change 与 A/B Evidence 接口，自动优化延期。
5. 双 Agent、独立 Worker 和 provider-neutral Runtime 只有在实验能够证明收益时进入产品核心。

该范围尚未确认，不能直接覆盖当前产品总纲。

## 10. 重构前必须确认的问题

1. 第一版是否正式收缩为 `Approved Architecture -> Verified Implementation`。
2. Design 是否采用 `system.md + components/`，以及哪些 Component 需要独立文档和用户批准。
3. Work Package 是否完全退出用户 Design 信息架构。
4. Artifact、Task、Run 三类状态是否足以覆盖主路径和实际失败案例。
5. 哪些通用能力直接复用 Spec Kit、OpenSpec、HAgent 或其他项目。
6. 双 Agent 相比单 Agent 是否在固定预算下显著缩短时间或提高 Architecture Fidelity。
7. 环境是否统一到一个可预检、可复现的 Runner。

这些问题闭合前，暂停增加新的 Stage2 状态、恢复入口、长期实体和通用 Runtime 功能。现有 Harness 继续作为 `dual_issue_demo` 的实验样本，不自动晋升为最终产品架构。
