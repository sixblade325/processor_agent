# Stage2 Module Development Loop 计划

状态：阶段边界与基础流程已确认，详细实现待专项细化

上位文档：[PRODUCT_PLAN.md](./PRODUCT_PLAN.md)

更新时间：2026-08-29

## 1. 阶段目标

Stage2 逐模块完成 Design、Implementation、Unit Verification 和 Integration。它同时服务 baseline 建设和 Architecture Change 实施。

Stage2 的输入是 Stage1 已批准的 Architecture Snapshot，或 Stage3 创建并完成影响分析的 Architecture Change。Stage2 不自行改变 ISA、全局流水边界、模块职责和共享协议。

## 2. 模块循环

```text
选择模块
-> 读取 Architecture 与上游协议
-> 闭合模块 Design
-> 用户确认 Design
-> 使用新上下文实现
-> 单元验证
-> 集成验证
-> 更新文档与状态
-> 进入下一模块
```

模块状态：

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

异常状态：

```text
DESIGN_REOPENED
NEEDS_REALIGN
BLOCKED
CANCELLED
```

## 3. 模块 Design 门禁

Design 至少闭合：

1. 模块边界、接口和状态所有权。
2. 字段语义、生产者、消费者、设置、清除和有效区间。
3. 周期边界、组合路径和寄存位置。
4. stall、flush、kill、retry、replay 和异常路径。
5. 同拍事件优先级。
6. ownership、release、reuse 和 late response。
7. 全局 Architecture 与共享协议映射。
8. 断言、定向测试和集成验收条件。
9. 时序、面积和验证成本的已知风险。

用户批准绑定 Design revision 和内容哈希。批准后的 Design 发生实质变化时，模块进入 `NEEDS_REALIGN`。

## 4. Agent 边界

1. Design Agent 读取 Architecture、相关源码和测试，写 Design 草案，无源码写权限。
2. Implementation Agent 使用新上下文，只读取已批准 Design 和允许路径。
3. Harness 执行 Diff、路径、命令、测试和证据门禁。
4. Implementation 发现设计缺口时提交 `DESIGN_REOPENED`，不能自行增加协议、状态或保守限制。
5. 第一版不执行并行正式写入。

## 5. 模块映射

Design、源码和验证通过稳定 Module ID 与 `architecture/modules.yaml` 关联。Module Manifest 保存职责、依赖、Architecture 文档、Design、源码、验证和当前状态。

共享接口变化时，所有依赖模块进入影响分析。尚未实现的模块更新输入约束，已经实现的模块进入 `NEEDS_REALIGN`。

## 6. Baseline 聚合

```text
BASELINE_BUILDING
-> BASELINE_INTEGRATING
-> BASELINE_VERIFYING
-> READY
```

`READY` 要求：

1. 所有 baseline 必需模块已经完成。
2. Core 可以构建和 elaboration。
3. 定向测试与集成测试通过。
4. 性能计数器可用。
5. Architecture、Design、源码和验证映射一致。
6. Git 工作区干净，baseline commit 已冻结。

## 7. Architecture Change

Architecture Change 完成影响分析后复用模块循环：

```text
Architecture Idea
-> Contract 与影响分析
-> 确定受影响模块
-> 逐模块 Design、Implement、Verify
-> 整体回归与一致性审查
-> Change Complete
```

Change 的关键规则：

1. `DESIGN_CLOSED` 绑定 Contract 与所有受影响 Design 的内容哈希。
2. Diff 必须限制在允许路径。
3. 验证失败返回 `IMPLEMENTING` 并保留失败证据。
4. Design 缺口返回 `DESIGN_REOPENED`。
5. 文档、源码、测试和证据全部闭合后才能进入 `COMPLETE`。

## 8. 持久产物

1. 模块 Architecture 与 Design。
2. 已批准 Design revision 和哈希。
3. 源码、断言和测试。
4. 实施记录、Diff 和验证证据。
5. Module Manifest 状态与依赖变更。
6. baseline commit 或 Change 结果。

## 9. 第一版范围

第一版只覆盖 `dual_issue_demo` baseline 所需模块和首个同拍 ALU 前递 Change。验证使用定向测试、集成测试和固定 benchmark。多 Agent 并行、完整形式验证和多构建系统留到后续版本。

## 10. 待专项细化

1. 模块选择和依赖调度算法。
2. Design 文档最小 Schema。
3. Chisel 源码写入和 Patch 应用协议。
4. 单元验证与集成验证的证据 Schema。
5. `DESIGN_REOPENED` 与 `NEEDS_REALIGN` 的精确转换条件。
6. baseline 聚合状态和 Change 状态的统一方式。
