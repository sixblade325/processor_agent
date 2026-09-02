# Processor Agent V3 产品计划

状态：当前产品判断基线  
日期：2026-09-02

## 1. 文档职责

本文定义 Processor Agent V3 的产品定位、核心抽象、职责边界、Skill 组织方式和近期交付目标。

V3 将产品收敛为面向处理器工程的 Skill Package。`PRODUCT_PLAN/V2/` 保留为 Harness 方向的历史讨论材料，不再指导当前实现。

## 2. 核心判断

处理器设计师最稀缺的资源是架构判断所需的认知资源。处理器开发中同时存在大量高认知消耗、具有稳定方法且可重复执行的工作，例如：

1. 阅读并追踪跨模块设计事实。
2. 闭合状态、周期、所有权和异常路径。
3. 维护设计文档及其一致性。
4. 将已确认设计落实为 RTL 和测试。
5. Review 实现与设计之间的偏差。
6. 从测试、综合和时序报告中提取工程证据。
7. 根据证据形成可检查的修改候选。

Agent 可以接管这些工作。设计师集中处理处理器目标、架构选择、关键取舍和最终批准，从而扩大个人和团队的实现带宽。

Processor Agent V3 的产品单位是可安装、可组合、可验证的处理器开发 Skill Package。

## 3. 产品定义

> Processor Development Skills 是一组面向处理器工程的认知方法包。它指导通用 Agent 接管高认知消耗、可重复、可检查的工程工作，并让处理器设计师持续拥有架构判断、设计事实和最终批准权。

产品依赖现有 Agent Runtime 提供会话、上下文、工具调用、文件编辑和任务执行能力。当前首要运行宿主为 Codex。

产品自身提供：

1. 处理器领域方法。
2. 任务阅读顺序和分析框架。
3. 输入、输出与权限边界。
4. 典型缺陷、反例和检查项。
5. 文档、实现、Review 和证据的质量标准。
6. 环境与工具链契约。
7. `doctor`、固定工具入口和确定性检查脚本。
8. Codex plugin manifest、可复现安装包和工具级测试。

## 4. 职责边界

### 4.1 设计师

设计师拥有：

1. 处理器目标和成功条件。
2. Architecture 中的处理器性质。
3. 关键微架构选择。
4. 性能、面积、时序、复杂度和验证成本之间的取舍。
5. 新设计概念的引入。
6. 对 Agent 结果的接受、拒绝和修订决定。

### 4.2 Agent Runtime

Codex 等通用 Agent Runtime 负责：

1. 建立和恢复会话。
2. 读取项目文件。
3. 调用 Skill 和工具。
4. 编辑工作区。
5. 调度当前任务所需的执行过程。
6. 向用户呈现结果和待决问题。

### 4.3 Skill Package

Skill Package 负责定义 Agent 完成处理器工程任务的方法，并提供降低重复工具探索成本的薄执行支撑。它不保存项目专属事实，不维护长期工作流状态。

### 4.4 用户项目

用户项目通过 Git 管理以下权威材料：

```text
Architecture
Design
Source
Verification
```

项目的 `AGENTS.md` 定义本地协作约束。项目文档、源码和测试共同提供当前处理器事实，Skill 不生成第二份处理器模型。

### 4.5 确定性工具

编译器、测试框架、仿真器、综合工具和静态检查器负责产生原始工程证据。Skill Package 的 `Execution Support Kit` 负责环境探测、固定命令入口、运行产物管理和结构化结果。Agent 负责选择操作并解释证据，设计师负责作出取舍。

执行支撑层不决定任务，不调度 Agent，不维护 Stage、Task、Run 或 Approval 状态。详细边界见 [可运行产品与实验资产边界](RUNNABLE_PRODUCT_AND_EXPERIMENT_BOUNDARY.md)。

## 5. Skill 的纳入标准

一项工作适合固化为 Skill 时，应同时满足：

1. 需要消耗较多认知资源。
2. 在多个处理器任务中重复出现。
3. 存在可表达的稳定方法。
4. 输入范围和输出形式可以约束。
5. 结果可以由人类或确定性工具检查。
6. 执行过程无需替设计师作出新的一级架构决定。
7. 现有 Agent Runtime 可以完成该工作。

Skill 可以发现缺口、构造反例、比较候选和请求决定。Skill 不能自行批准架构变化，也不能把经验性偏好晋升为项目事实。

## 6. 当前 Skill 体系

```text
Processor Development Skill Package
├── bootstrap-processor-project
├── organize-processor-docs
├── design-chisel-processor
├── implement-chisel-processor
├── trace-vivado-timing-to-rtl
└── optimize-chisel-fpga-timing
```

### 6.1 `bootstrap-processor-project`

使用包内固定基线初始化用户项目根目录的 `AGENTS.md`。已有文件只形成增量建议，并在用户确认后修改。写入后由用户项目维护，后续包版本不自动覆盖。该 Skill 不创建文档目录，不探测或配置环境，不修改处理器源码。环境与工具链工作由确定性脚本承担。

### 6.2 `organize-processor-docs`

建立并维护人类和 Agent 共同使用的处理器文档范式。它负责文档角色、事实权威、阅读路径、长度预算、接口表达顺序、可维护性检查和渐进式脚手架。

### 6.3 `design-chisel-processor`

负责周期精确的微架构推理，闭合字段语义、状态生命周期、生产者与消费者、寄存器边界、异常路径、优先级和可验证不变量。

### 6.4 `implement-chisel-processor`

根据已确认的 Architecture 和 Design 实现 Chisel RTL、接口迁移、断言和定向测试，并报告设计缺口和未验证行为。

### 6.5 `trace-vivado-timing-to-rtl`

将 Vivado 物理时序证据映射到生成 RTL、Chisel 源码、流水线语义和路径家族，形成有证据约束的修改方向。

### 6.6 `optimize-chisel-fpga-timing`

根据周期契约和实现证据产生时序优化候选，通过 RTL、测试和实现结果验证收益及语义保持情况。

## 7. 文档 Skill 的基础地位

`organize-processor-docs` 与其他 Skill 的关系具有基础性。其他 Skill 消费或修改具体工程内容，文档 Skill 建立这些工作共同依赖的知识工作面。

该文档范式遵循：

1. 人类可直接阅读和维护。
2. Agent 可参与搭建、撰写、重组和审查。
3. Architecture 表达处理器目标与性质。
4. Design 表达当前微架构设计。
5. Source 表达当前实现。
6. Verification 表达检查方法和已取得的证据。
7. 同一规范性事实只有一个拥有者。
8. 文档长度受到明确约束。
9. Chisel 接口按照 Scala 声明到语义说明的顺序表达。
10. Git 保存历史，人类可编辑文件保存当前事实。

文档 Skill 不决定处理器拓扑，不引入项目专属字段，不覆盖用户修改，不通过 Schema 或生成器维护第二份权威表示。

## 8. 标准协作闭环

```text
设计师提出目标、约束或问题
          ↓
Agent 根据任务选择 Skill
          ↓
Skill 指导阅读、分析、实现或 Review
          ↓
项目文件产生候选修改或报告
          ↓
确定性工具产生验证证据
          ↓
设计师作出架构判断和接受决定
          ↓
Git 保存当前事实与历史
```

Review 与修改保持为可区分的任务。Review 可以使用独立上下文。Agent 发现设计缺口时提交证据和待决问题，由设计师决定修订方向。

## 9. 产品边界

V3 当前不建设：

1. 独立 Agent Executor。
2. Harness 工作流引擎。
3. Stage 状态机。
4. Task Scheduler。
5. Run Ledger。
6. Candidate Change Protocol。
7. Approval 数据库。
8. 处理器 Schema 和 Renderer。
9. 第二份处理器模型。
10. 对 Codex 已有会话、工具和文件编辑能力的封装替代层。

当未来出现明确证据，证明跨 Provider 审计、长期无人值守运行或受监管审批需要独立基础设施时，再重新评估对应能力。新增基础设施必须直接解决已验证的问题。

## 10. Skill Package 交付结构

```text
processor-development-skills/
├── .codex-plugin/
├── README.md
├── LICENSE
├── skills/
├── tools/
├── environment/
├── scripts/
└── tests/
```

当前可运行产品仍需完成：

1. Codex plugin manifest。
2. 环境与工具链契约。
3. `doctor` 和固定工具入口。
4. 可复现安装包。
5. 工具级测试。

Skill 行为 eval、最小处理器示例和 A/B 对照演示属于实验资产，不构成产品运行条件。详细交付边界和验收见 [可运行产品与实验资产边界](RUNNABLE_PRODUCT_AND_EXPERIMENT_BOUNDARY.md)。

## 11. 实验性演示闭环

可运行产品完成后，实验工作展示一条完整处理器开发链：

```text
读取 Architecture 和 Design
→ 识别一个周期语义或实现缺口
→ 完善 Design
→ 独立 Review 并给出具体反例
→ 由设计师确认修订方向
→ 修改 Chisel 和测试
→ 执行验证
→ 输出 Design、Source、Test 和 Evidence 的追踪关系
```

时序追踪和优化作为已有扩展能力展示，不扩大近期产品实现范围。演示、示例和行为评测均属于实验资产。

## 12. 验收标准

1. 新用户可以按照 `README.md` 安装 Skill Package。
2. Codex 可以发现并调用全部正式 Skill。
3. `doctor` 可以报告环境、工具版本和缺失项。
4. Skill 依赖的重复性工程命令具有固定入口和明确退出状态。
5. 安装包可以从固定 Git commit 可复现构建并校验内容 hash。
6. 工具级测试全部通过。
7. 全新 Agent 会话可以依据项目文件和 Skill 开始任务。
8. 删除 Agent 会话历史后，项目事实仍然完整。
9. 用户可以直接修改 Architecture、Design、Source 和 Verification。
10. Skill 不覆盖用户确认的架构选择。
11. 文档、设计、实现、Review 和时序 Skill 的职责边界清晰。
12. Skill Package 不依赖项目专属模块名、路径或处理器拓扑。
13. 删除实验资产后，产品仍能安装、检查环境并调用 Skill。
14. 作品贡献可以与 Codex、Vivado、Chisel 等外部依赖明确区分。

## 13. 从 V2 到 V3

V2 中以下结论继续有效：

1. 人类拥有处理器设计权和产品概念权。
2. Architecture、Design、Source 和 Verification 是项目权威材料。
3. Agent 上下文可以丢弃，项目事实必须支持新会话接管。
4. Skill 提供方法，项目文件提供事实。
5. Review、Finding 和 Evidence 应绑定明确的工程基线。
6. 确定性工具负责运行编译、测试、仿真和综合。
7. 处理器模型不进入通用运行基础设施。

V2 的 Harness 设计停止进入当前产品实现。相关文档保留，用于记录已经探索过的边界、失败模式和未来重新评估基础设施时的历史依据。

## 14. 一句话产品定义

> Processor Agent V3 通过可复用、可检查的处理器开发 Skill 和薄执行支撑工具，让通用 Agent 接管重复且高认知消耗的工程工作，使设计师集中完成架构判断并扩大实现带宽。
