# Skill Package 对照评测方案

状态：当前评测基线  
日期：2026-09-02

## 1. 文档职责

本文定义 Processor Development Skill Package 的对照实验，用于评估 Skill Package 对 Agent 处理器工程团队完成效果、实现带宽和设计师认知投入的影响。

本文服从 [V3 产品计划](PRODUCT_PLAN.md)。实验复用 [V1 Stage1](../V1/STAGE1.md) 已形成的处理器目标与边界，不复用 V1 Harness、状态机和运行状态。

本文、Skill 行为 eval、最小处理器示例和 A/B 运行结果均属于实验资产，不构成可运行产品的安装或基础功能验收条件。产品与实验的详细边界见 [可运行产品与实验资产边界](RUNNABLE_PRODUCT_AND_EXPERIMENT_BOUNDARY.md)。

## 2. 核心假设

在架构目标、输入版本、模型、工具、执行预算和验收标准相同的条件下，使用 Processor Development Skill Package 的 Codex 团队应当表现出：

1. 更高的正确完成率。
2. 更高的 Architecture Fidelity。
3. 更完整的 Design、Source、Test 和 Evidence 闭环。
4. 更少的无效探索和返工。
5. 更少的设计师重复工程介入。
6. 更高的单位时间或单位 token 有效完成量。

一次完整对照运行用于作品演示。多次重复运行或多个固定任务用于支持效能结论。

## 3. 实验对象

实验比较两个从相同工程基线出发的 Codex 工程团队。

```text
冻结的 Stage1 技术产物与 Git baseline
                  │
         ┌────────┴────────┐
         │                 │
         ▼                 ▼
    Control Team       Skill Team
    Codex 主线程        Codex 主线程
    可调度 subagent     可调度 subagent
    禁止读取 Skills     可使用 Skill Package
         │                 │
         └────────┬────────┘
                  ▼
       相同确定性测试与独立盲审
```

两个主线程模拟具备执行自主性的工程师角色。它们可以分解任务、调度 subagent、Review 工作结果并组织最终交付。

该实验直接测量 Agent 工程团队的完成效果。设计师认知投入通过真实用户介入次数、介入时间和问题类型测量。

## 4. 复用的 V1 Stage1 技术遗产

实验输入只复用已经形成的处理器目标和架构边界：

1. 项目目标、使用场景和成功标准。
2. 明确约束和排除项。
3. ISA 范围。
4. 复位、地址空间、存储、MMIO、时钟、中断等系统边界。
5. 顺序或乱序模型、发射与退休宽度、流水边界和延迟分类。
6. Architecture Role 及其稳定职责。
7. 全局数据、控制、异常和恢复语义。
8. 共享协议的架构约束。
9. 验证策略。
10. 实现完成条件。

以下 V1 机制不进入实验输入：

1. `.assistant/` 状态。
2. Stage 状态机。
3. Profile 和 Schema。
4. Decision Packet 与决策依赖图。
5. Work Package 和 Package DAG。
6. Harness Task Envelope。
7. Approval hash 和迁移状态。
8. V1 Agent 运行记录、建议缓存和历史输出。

实验开始前应将有效技术产物整理为人类可直接阅读的 Architecture、Design 入口和 Verification Contract。

## 5. 实验组

### 5.1 Control Team

Control Team 获得：

1. 冻结的用户项目副本。
2. 统一任务说明。
3. 通用 Codex 工具能力。
4. 统一编译、测试和仿真命令。
5. 与 Skill Team 相同的时间、token、并发和 subagent 预算。

Control Team 的主线程和全部 subagent 禁止读取：

1. `skills/`。
2. Skill Package 安装目录。
3. Skill Team 的工作树、会话、日志和输出。
4. 由 Skill Package 生成的中间材料。

### 5.2 Skill Team

Skill Team 获得 Control Team 的全部输入，并可使用完整 Processor Development Skill Package。

主线程可以根据任务选择和组合 Skill。subagent 可以使用被分配任务所需的 Skill。Skill Team 不获得额外的项目事实、测试答案或人工提示。

### 5.3 独立评估者

独立评估者在两个团队完成后工作。评估者看不到组别名称、会话过程和处理顺序，只读取匿名化结果、固定验收标准和确定性证据。

评估者不得修改两个团队的输出。

## 6. 必须固定的变量

每次成对实验必须固定：

| 变量 | 固定要求 |
|---|---|
| Baseline | 相同 Git commit |
| Architecture | 相同文件和内容 hash |
| 任务说明 | 除 Skill 权限说明外完全相同 |
| Codex | 相同模型、配置和推理设置 |
| 工具 | 相同基础工具和命令 |
| 文件权限 | 相同项目读写范围 |
| subagent | 相同数量、并发上限和模型 |
| 预算 | 相同时间、token 或运行次数上限 |
| 网络 | 相同网络访问策略 |
| Runner | 相同编译、测试、仿真和综合命令 |
| 验收 | 相同测试、Rubric 和完成条件 |
| 人工决策 | 相同决定同时提供给两组 |

Skill 文件及其必要上下文属于实验处理变量，其 token 成本计入 Skill Team 总消耗。

## 7. 隔离要求

1. 两个团队从同一 baseline 创建独立 worktree。
2. 两个团队使用全新 Codex 会话。
3. 工作树、运行目录、日志目录和结果目录完全分离。
4. 两个团队不能读取彼此的 branch、diff、日志和生成物。
5. Control Team 的运行环境不安装本 Skill Package。
6. Skill Team 使用待提交版本的 Skill Package。
7. 任何公共测试工具都必须在实验开始前冻结。
8. 完成后立即记录最终 commit、dirty state、工具版本和结果 hash。

## 8. 人工决定协议

Stage1 技术产物应尽量闭合影响实现的架构决定。实验过程中仍可能出现真实缺口。

处理流程：

```text
任一团队提出 Architecture Decision Request
                    ↓
记录问题、选项、影响和阻塞工作
                    ↓
设计师作出统一决定
                    ↓
同一决定同时提供给两个团队
                    ↓
两个团队从各自当前状态继续执行
```

每次人工介入记录：

1. 发起团队。
2. 问题内容。
3. 所需决定类型。
4. 设计师阅读和判断时间。
5. 最终决定。
6. 两个团队收到决定的时间。

工程命令失败、路径错误和普通实现缺陷由团队自行处理，不进入 Architecture Decision Request。

## 9. 实验流程

1. 选择 V1 Stage1 留下的实现目标。
2. 整理并冻结 Architecture 和 Verification Contract。
3. 记录 baseline commit 和全部输入 hash。
4. 生成两个隔离 worktree。
5. 为两个主线程提供统一任务说明和完成条件。
6. 同时启动两个全新 Codex 主线程。
7. 两个主线程在预算内自主组织 subagent 和工程工作。
8. 按统一协议处理架构决定请求。
9. 到达完成条件或预算上限后停止执行。
10. 冻结两个结果 commit 和运行记录。
11. 在两个结果 commit 上执行相同确定性验收命令。
12. 对结果进行匿名化。
13. 由独立评估者执行盲审。
14. 汇总质量、效率、成本和人类介入指标。

## 10. 任务设计

### 10.1 完整演示任务

完整任务应覆盖：

```text
读取 Architecture
→ 建立或完善 Design
→ 闭合接口、状态和生命周期
→ 实现 Chisel RTL
→ 编写断言和定向测试
→ 执行验证
→ Review Architecture、Design、Source 和 Test 一致性
→ 交付可追踪结果
```

任务规模应允许至少一组在预算内形成完整闭环。完成范围不足时，应保留可独立验收的垂直切片。

### 10.2 固定微型评测

为降低单次 Agent 随机性，至少准备两个固定微型任务：

1. 周期精确的设计缺陷识别与修订。
2. 已知 Design 下的 Chisel 实现缺陷修复与验证。

可以增加 Vivado 时序报告到 RTL 的证据追踪任务。微型任务使用固定输入、隐藏验收点和独立结果目录。

## 11. 评测指标

### 11.1 正确性

1. 编译是否通过。
2. 定向测试和回归测试通过率。
3. 断言是否覆盖关键不变量。
4. 已知缺陷是否被识别并正确修复。
5. 是否引入新的功能错误。

### 11.2 Architecture Fidelity

1. 实现是否符合冻结的 Architecture。
2. Design 是否完整表达实现所依赖的新增语义。
3. 是否擅自改变接口、流水边界或状态所有权。
4. 是否引入未经设计师确认的新架构概念。
5. Design、Source 和 Test 是否保持一致。

### 11.3 工程质量

1. 状态生命周期是否闭合。
2. flush、redirect、retry、replay 和 late response 路径是否完整。
3. 同周期冲突和写优先级是否明确。
4. RTL 是否存在冗余保护、重复状态和不必要的数据通路。
5. 文档是否可由全新 Agent 会话接管。
6. 变更是否集中、可读和可维护。

### 11.4 实现带宽

1. 预算内完成的有效功能范围。
2. 通过验收的垂直切片数量。
3. 单位时间完成的有效工作量。
4. 单位 token 完成的有效工作量。
5. 首次有效结果所需时间。

### 11.5 返工与成本

1. token 总量。
2. 总耗时。
3. subagent 调用次数。
4. 无效工具调用次数。
5. 编译和测试失败次数。
6. 重复修改同一区域的次数。
7. 最终未解决 Finding 数量和严重度。

### 11.6 设计师认知投入

1. 人工决定请求数量。
2. 设计师总介入时间。
3. 重复工程问题占人工问题的比例。
4. 一级架构问题占人工问题的比例。
5. 设计师需要亲自阅读的源码和日志规模。

核心衡量值为：

```text
在固定资源预算内通过验收的有效工程完成量
```

## 12. 确定性验收

验收命令必须在实验开始前登记，并对两个结果 commit 执行完全相同的命令。至少覆盖：

1. 文档结构检查。
2. Chisel 编译或 elaboration。
3. 定向 ChiselTest。
4. 项目回归测试。
5. 静态一致性检查。
6. 必要的综合或时序报告检查。

实验结果必须保留命令、退出码、工具版本、seed、stdout、stderr 和结果 hash。

## 13. 盲审 Rubric

独立评估者按固定 Rubric 对匿名结果评分：

| 维度 | 主要问题 |
|---|---|
| 设计闭合 | 接口、周期、状态、所有权和异常路径是否完整 |
| 实现忠实度 | RTL 是否实现冻结 Architecture 和当前 Design |
| 验证充分性 | 测试和断言能否检查关键不变量 |
| 可维护性 | 新工程师能否理解和继续修改 |
| 证据质量 | 结论能否追踪到文件、测试和工具结果 |
| 完成度 | 交付物是否形成可运行的垂直闭环 |

评估者应报告 Finding 的严重度、文件位置、具体反例和证据，不根据代码量、文档长度或表面完整度评分。

## 14. 结果解释边界

1. 单次 A/B 结果适合作为产品演示和案例证据。
2. Skill 效能结论至少需要多个固定任务或重复运行支持。
3. Agent 输出具有随机性，必须同时报告资源预算和运行配置。
4. 两组选择不同微架构时，先检查 Stage1 是否留下未闭合决定。
5. 确定性测试通过只能证明已覆盖行为。
6. Agent 团队效果不能单独证明真实设计师认知负担下降。
7. 人类介入记录用于支持认知资源变化结论。
8. Skill Team 的额外上下文和 token 成本必须计入比较。

## 15. 实验产物

每次实验保存：

```text
experiment-brief.md
baseline-manifest.json
control-result/
skill-result/
acceptance-results/
blind-review/
comparison-report.md
```

`baseline-manifest.json` 至少记录：

1. baseline commit。
2. Architecture 和 Verification 文件 hash。
3. Codex 模型与运行配置。
4. 工具链版本。
5. 资源预算。
6. subagent 上限。
7. 验收命令定义。
8. Control Team 禁用 Skill 的证明方式。
9. Skill Package commit 和内容 hash。

实验产物是评测证据，不成为处理器设计事实。

## 16. 比赛演示结构

演示视频可以按照以下顺序组织：

1. 说明相同 Stage1 输入和实验控制条件。
2. 展示两个全新 Codex 主线程同时开始工作。
3. 展示两组如何分解任务和调度 subagent。
4. 对比设计推理、文档、RTL、测试和错误恢复过程。
5. 执行相同确定性验收。
6. 展示匿名盲审和量化结果。
7. 解释 Skill 如何接管重复且高认知消耗的工作。
8. 汇总设计师实际介入的架构问题和时间。

完整演示应突出可观察工程结果，避免只展示对话文本和提示词。

## 17. 验收标准

1. 两个团队从同一 baseline 开始。
2. 除 Skill Package 外的实验条件一致。
3. Control Team 无法读取 Skill 及其衍生输出。
4. 两个团队均可按相同上限调度 subagent。
5. 架构决定由同一设计师统一提供并完整记录。
6. 两组输出形成独立 commit。
7. 相同确定性命令在两个 commit 上执行。
8. 最终结果经过匿名盲审。
9. 报告同时包含正确性、完成度、成本和人类介入指标。
10. 所有比较结论均能追踪到运行记录或工程证据。

## 18. 一句话定义

> 从同一个已冻结的处理器目标和架构边界出发，让两个具备相同资源的 Codex 工程团队分别在禁用和启用 Skill Package 的条件下完成同一实现任务，以确定性验收、独立盲审和设计师介入记录衡量 Skill 对工程完成效果与实现带宽的影响。
