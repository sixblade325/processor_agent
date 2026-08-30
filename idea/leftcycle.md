# Processor Development Lifecycle

状态：历史构想，仅保留讨论轨迹

更新时间：2026-08-29

正式产品总纲见 `../PRODUCT_PLAN/PRODUCT_PLAN.md`。Stage1、Stage2 和 Stage3 的权威定义分别见 `../PRODUCT_PLAN/STAGE1.md`、`../PRODUCT_PLAN/STAGE2.md` 和 `../PRODUCT_PLAN/STAGE3.md`。本文件停止同步正式产品事实。

## 总体结构

产品使用三层生命周期：

```text
Stage1: Project Bootstrap
一次性建立项目、Architecture、模块图和全局协议

Stage2: Module Development Loop
反复完成模块 Design、Implementation、Unit Verification 和 Integration

Stage3: Optimization Loop
反复完成测量、诊断、假设、Change 创建和 A/B 评估
```

Stage3 选择优化 Change，Stage2 完成受影响模块，Stage3 评估结果并决定接受、拒绝或进入下一轮。

全部阶段遵守文档驱动原则。正式事实、决策、设计、改动映射和验证证据必须落入项目文件。Agent 上下文不承担持久状态。

## Stage1: Project Bootstrap

Stage1 协助用户完成总体目标指定、必要调研、大体设计和项目建立。

### 必须闭合的内容

1. 处理器目标与使用场景。
2. ISA 与支持的指令范围。
3. 顺序或乱序执行模型。
4. 流水级和主要模块。
5. Architecture Overview 与顶层不变量。
6. 跨模块协议。
7. 随流水级传递的字段协议。
8. 模块依赖和实施顺序。
9. 构建、验证与集成策略。

ISA Profile 必须在项目实现开始前准备并确认。

### 调研资产

项目使用 `research/` 保存：

1. 来源索引。
2. 调研 Memo。
3. 参考设计的机制对比。
4. 被采用结论及其来源。

原始下载、网页快照和临时检索结果进入工作区级 `.runtime/`。Architecture 与 Design 引用已采用的调研结论，不复制完整调研正文。

### 用户确认粒度

产品将信息分为三级：

1. 事实提取：ISA 原文、源码行为和测试结果。需要记录来源，无需逐项审批。
2. 局部实现选择：命名、辅助函数和已批准 Design 内部的等价实现。一次 Design 审批覆盖这些选择。
3. 架构决策：ISA 范围、流水边界、模块职责、协议、状态字段、异常行为和保守机制。必须由用户显式确认，并写入 Contract、ADR 或 Design。

三级内容全部需要落盘，交互式审批集中在架构决策。

### Stage1 退出条件

1. ISA Profile 已确认。
2. Architecture Overview 已确认。
3. Pipeline 与 Module Map 已确认。
4. 跨模块协议和流水字段协议具有权威文档。
5. 每个模块具有稳定 Module ID、职责和依赖关系。
6. 未闭合问题已经显式记录。
7. 用户确认绑定具体文档版本和内容哈希。
8. 项目骨架、Git、构建入口和验证入口已经建立。

## Stage2: Module Development Loop

Stage2 与用户逐模块完成 Design、Implementation、Unit Verification 和 Integration。

```text
选择模块
-> 读取 Architecture 与上游协议
-> 闭合模块 Design
-> 用户确认 Design
-> 实现源码
-> 单元验证
-> 集成验证
-> 更新文档与状态
-> 进入下一模块
```

### 模块状态

```text
PLANNED
-> DESIGNING
-> AWAITING_APPROVAL
-> DESIGN_CLOSED
-> IMPLEMENTING
-> UNIT_VERIFYING
-> INTEGRATING
-> COMPLETE
```

实现暴露设计缺口时进入 `DESIGN_REOPENED`。共享接口变化导致下游文档失效时进入 `NEEDS_REALIGN`。

### 模块映射

Design、源码和验证通过稳定 Module ID 关联。`architecture/modules.yaml` 保存权威映射：

```yaml
modules:
  - id: issue
    architecture: architecture/modules/issue.md
    design: design/issue.md
    source:
      - src/backend/Issue.scala
    verification:
      - verification/unit/issue
    depends_on:
      - decode
      - regfile
```

文件夹同名作为默认组织约定。Module Manifest 负责处理多源码文件、共享 Package、顶层集成和模块拆分。

模块组织 Schema 从龙芯杯遗产中提炼，产品运行时不依赖遗产路径。

### Architecture Change

baseline 完成后的 Architecture Change 复用 Stage2：

```text
Architecture Idea
-> 影响分析
-> 确定受影响模块
-> 逐模块 Design / Implement / Verify
-> 整体结果确认
```

## Stage3: Optimization Loop

Stage3 负责闭合优化价值：

```text
建立性能基线
-> 定位瓶颈
-> 形成优化假设
-> 用户选择方案
-> 创建 Architecture Change
-> 进入 Stage2 实现
-> A/B 验证
-> 接受或拒绝
-> 进入下一轮
```

### 优化资产

```text
experiments/
├── baselines/
├── profiles/
├── hypotheses/
└── results/
```

每轮优化至少记录：

1. baseline commit。
2. benchmark、工具链、参数和随机种子。
3. 性能、时序和资源基线。
4. 瓶颈证据。
5. 优化假设与预期收益。
6. 用户选择结果。
7. 对应 `CHG_XXXX`。
8. A/B 结果。
9. 正确性与回归结果。
10. 接受、拒绝或继续迭代的结论。

### 第一版 Stage3

第一版只实现以下最小闭环：

```text
用户提供优化 Idea
-> Harness 记录 baseline
-> 创建 Architecture Change
-> Stage2 实现
-> 运行固定 benchmark
-> 比较性能和正确性
-> 保存结果
```

自动瓶颈发现、Vivado 时序回溯、PPA 优化和设计空间搜索进入后续版本。

## 共同门禁

Verification 是 Stage2 与 Stage3 的共同门禁。任一模块、Change 或优化结果缺少文档、测试、Diff 或可复现证据时，不能进入完成状态。
