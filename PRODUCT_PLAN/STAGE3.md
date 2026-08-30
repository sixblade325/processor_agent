# Stage3 Optimization Loop 计划

状态：阶段边界与第一版闭环已确认，详细实现待专项细化

上位文档：[PRODUCT_PLAN.md](./PRODUCT_PLAN.md)

更新时间：2026-08-29

## 1. 阶段目标

Stage3 用可复现证据闭合优化价值。它保存 baseline、瓶颈证据、优化假设、用户选择、对应 Change、A/B 结果和接受结论。

Stage3 不直接修改 RTL。它创建 Architecture Change，调用 Stage2 完成设计、实现和验证，再对结果进行评估。

## 2. 完整生命周期

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

状态机：

```text
BASELINE_CAPTURING
-> ANALYZING
-> HYPOTHESIS_DRAFTING
-> AWAITING_SELECTION
-> CHANGE_CREATED
-> STAGE2_EXECUTING
-> A_B_VERIFYING
-> REVIEWING
-> ACCEPTED / REJECTED
```

## 3. 优化假设

每个优化假设至少包含：

1. 目标瓶颈和直接证据。
2. 预期改变的机制。
3. 预期性能收益。
4. 正确性约束。
5. 可能的时序、面积和验证代价。
6. 受影响的 Architecture 和模块。
7. 验证方法和接受阈值。

用户显式选择假设后，Stage3 才能创建 Architecture Change。

## 4. A/B 公平性

Product 和对照实验使用：

1. 相同 baseline commit。
2. 相同 benchmark、输入、工具链和参数。
3. 相同随机种子和时间预算。
4. 相同正确性测试和性能计数口径。
5. 可追踪的模型、推理强度和工具权限。

结果需要分开报告正确性、性能、架构忠实度、修改边界、时序代价、验证质量和文档一致性。

## 5. 持久产物

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

原始日志、波形和生成物进入工作区级 `.runtime/`。确认后的实验结论进入用户项目 `experiments/`。

## 6. 完成门禁

进入 `ACCEPTED` 或 `REJECTED` 必须满足：

1. baseline 和候选实现可以复现。
2. Stage2 Change 已经完成或明确失败。
3. 正确性测试具有结论。
4. 性能数据使用固定口径。
5. 结果包含预期外代价和异常项。
6. 用户接受最终结论。
7. 实验文档引用 commit、命令和证据路径。

## 7. 第一版范围

第一版接收用户给出的优化 Idea：

```text
用户提供优化 Idea
-> Harness 记录 baseline
-> 创建 Architecture Change
-> Stage2 实现
-> 运行固定 benchmark
-> 比较性能和正确性
-> 保存结果
```

第一版 Demo 使用 `dual_issue_demo` 的同拍 ALU 前递优化，并与 Direct Codex 从相同 baseline 开始比较。

自动瓶颈发现、Vivado 时序回溯、自动 PPA 优化和设计空间搜索留到后续版本。

## 8. 待专项细化

1. baseline 与实验配置 Schema。
2. benchmark 运行和计数器采集协议。
3. 优化假设评分与用户选择界面。
4. Product 与 Direct Codex 的预算锁定方式。
5. 只读 Evaluator 的评分规则。
6. 多轮优化之间的结果继承方式。
