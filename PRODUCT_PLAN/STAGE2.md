# Stage2 Module Development Loop 计划

状态：第一版 Harness 已实现，实际 Demo 等待 Stage1 审查闭合

上位文档：[PRODUCT_PLAN.md](./PRODUCT_PLAN.md)

更新时间：2026-08-30

## 1. 阶段目标

Stage2 按模块推进 `Design -> Implementation -> Verification`，逐步生成可构建、可验证的 baseline，并供后续 Architecture Change 复用。

Stage2 的输入是 Stage1 已批准的 Architecture Snapshot，或 Stage3 创建并完成影响分析的 Architecture Change。Stage2 不自行改变 ISA、全局流水边界、模块职责和共享协议。

第一条完整 tracer 选择 `regfile`。Module ID、职责和实施顺序来自 Stage1 批准的 `architecture/modules.yaml`，具体接口细节、源码路径和测试路径在模块 Design 中闭合，不在 Harness 中硬编码项目事实。

当前实现包括 Stage2 CLI、模块状态机、Task Envelope、Skill 注入与内容哈希、Design 投影与批准门禁、`design_revision` 缺口动作、受限实现写入、两种验证模式、验证副本输入保护、Design reopen、共享接口失效、租约检查和双 Agent 轮转。`dual_issue_demo` 当前仍处于 Stage1 审查修正状态，尚未创建真实 Stage2 状态或 RTL。

2026-08-30 实现证据：

1. `npm test` 覆盖 Stage1 与 Stage2 共 39 项测试，包括 regfile tracer、角色轮转、两种验证模式、Design 漂移、路径唯一归属、显式与自动 reopen、越权路径、验证副本篡改和并发过期结果。
2. 真实 Codex CLI 初次 Shadow Design 运行 ID 为 `2026-08-30T10-16-53-653Z-4dd4ad27-cf7e-477e-aba8-00cb965de2ca`，线程为 `01a0522c-0db9-7350-b31a-dfecf3d77315`。
3. 同一线程通过 `resume` 完成 Design revision 2，运行 ID 为 `2026-08-30T10-25-02-981Z-f333a402-0ee3-440c-9381-fa14d931eea2`。Harness 保留未闭合问题并返回 `design_revision`，拒绝提前批准。
4. 真实 Chisel 实现与 WSL 验证需等待 `dual_issue_demo` 的 Stage1 当前审查 finding 闭合，现阶段不声明已生成 baseline RTL。

## 2. 单模块循环

```text
选择模块
-> Shadow Align 闭合 Design
-> 用户批准 Design，并选择本模块的验证模式
-> Active Coding 实现
-> Active Coding 完成主验证
-> 按用户选择完成静态审查与验证
-> 修复问题并重跑受影响检查
-> Harness 记录证据并关闭模块
-> 双 Agent 满足条件后轮转
```

每个模块在 Design 批准时都必须单独向用户询问：

> 本模块是否启用独立 Static Review Worker 与独立 Verification Worker？

Harness 不从上一个模块继承选择，也不推断默认值。选择记录为：

1. `independent_workers`：启动两个短生命周期 subagent。
2. `active_only`：不启动 subagent，由当前 Active Coding Agent 完成静态自审和验证。

## 3. 状态与门禁

长期模块状态保持最少：

```text
PENDING
-> DESIGNING
-> AWAITING_APPROVAL
-> IMPLEMENTING
-> VERIFYING
-> COMPLETE
```

`DESIGN_CLOSED`、`PRIMARY_VERIFIED` 和 `VERIFICATION_CLOSED` 是证据门禁，不增加长期状态。

异常处理：

1. `DESIGN_REOPENED` 是返回 `DESIGNING` 的转换事件。Harness 暂停 Active 的源码写权限并保留其租约，分配 Shadow 处理设计缺口。新 Design 批准后，原 Active 重新读取批准包并校验租约，才能返回 `IMPLEMENTING`。
2. 已批准共享接口变化时，受影响模块标记为 `NEEDS_REALIGN`，完成影响分析后回到相应正常状态。
3. 无法继续的模块可标记为 `BLOCKED` 或 `CANCELLED`。
4. 验证失败返回 `IMPLEMENTING`，保留失败证据。

## 4. Design 门禁

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

用户批准包同时包含：

1. Design revision 与内容哈希。
2. 允许修改的源码和测试路径。
3. 验收命令、断言和预期结果。
4. 本模块的 `verificationMode`。

批准后的 Design 对 Active Coding Agent 只读。实现发现设计缺口时，Active Coding Agent 必须提交带反例的 `DESIGN_REOPENED` 请求，不得自行增加协议、状态或保守限制。

## 5. Agent 职责

### 5.1 Workspace Agent

1. 作为唯一用户交互入口。
2. 展示当前模块、Design 批准包和验证模式问题。
3. 不代替用户批准 Design 或选择验证模式。
4. 只通过 Harness 查询和提交正式状态。

### 5.2 Shadow Align

1. 读取 Architecture、相关源码、测试和上游协议。
2. 与用户闭合当前模块 Design 和验收条件。
3. 不修改 RTL 和测试。
4. 将 Design 提案交给 Harness 投影为正式文档。

### 5.3 Active Coding

1. 只在 `DESIGN_CLOSED` 后获得实现租约。
2. 读取已批准 Design，并只修改批准包中的源码和测试路径。
3. 完成最小实现、断言、测试和主验证。
4. 在 `active_only` 模式下，额外执行分离的静态自审和验证步骤。
5. 不修改已批准 Design、Architecture 和 Harness 状态。

### 5.4 短生命周期验证 Worker

仅在用户为当前模块选择 `independent_workers` 时创建：

1. Static Review Worker 只读审查 RTL、测试、Diff 和 Design 一致性，不修改文件。
2. Verification Worker 在独立上下文运行批准的 WSL 验证命令，不修改 Design、源码和测试。
3. 两个 Worker 可以并行执行，结果都返回 Harness。
4. Worker 不参与双 Agent 轮转，任务完成后即结束。

Harness 是 `.assistant/project.yaml`、审批记录和正式证据投影的唯一写入者。Agent 不直接修改这些内容。

Harness 为每次角色执行生成 Task Envelope，至少包含当前角色、Module ID、权威文档及哈希、允许路径、显式排除项、共享接口、依赖模块、验收条件、`verificationMode`、租约、state epoch 和下一项允许动作。Agent 不得根据模块名、最近文件修改或对话相似性猜测自身身份和权限。

在源码编辑、长时间验证、状态转换和角色轮转前，Harness 都要重新检查租约、state epoch 与批准 Design 哈希。Git commit 不能替代实际权威文件哈希。任一检查过期时立即拒绝操作，已有 Agent 上下文不能覆盖磁盘状态。

## 6. 双 Agent 轮转

Stage2 保留两个可恢复的 Windows Codex 上下文。角色绑定到阶段和模块，不永久绑定到线程。Chisel 构建与验证命令按批准的 runner 在 WSL 执行。

稳态流水：

```text
Agent A: Active Coding(module N)
Agent B: Shadow Align(module N+1)
```

允许轮转的条件：

1. Active 模块已达到 `COMPLETE`。
2. Shadow 模块已通过 `DESIGN_CLOSED`。
3. 两个模块的文档、哈希和交接信息均为当前版本。
4. 不存在未解决的共享接口冲突。
5. 当前模块要求的测试和 Worker 均已结束。

轮转后，原 Shadow 成为其已闭合模块的 Active，原 Active 成为下一个模块的 Shadow。Harness 原子更新两个角色、租约和 state epoch，各 Agent 重新读取项目规则、状态和批准包后才能写入。

首模块启动方式：

```text
Agent A: Shadow Align(regfile)
Agent B: 暂无写租约

regfile Design 批准后：
Agent A: Active Coding(regfile)
Agent B: Shadow Align(next module)
```

仅当写入路径互不相交时允许 Shadow Design 与 Active Implementation 并行。任一路径同一时刻只有一个写入者。

## 7. 验证闭环

所有模块都必须先由 Active Coding Agent 完成主验证，包括构建、定向测试、必要断言及批准包要求的命令。

`PRIMARY_VERIFIED` 至少要求 elaboration 与编译成功、批准的定向测试通过、要求的随机或压力测试通过、无断言失败，并记录命令、seed、cycle count、结果和日志引用。仅编译成功不能通过该门禁。

### 7.1 `independent_workers`

1. 主验证通过后启动 Static Review Worker 和 Verification Worker。
2. Static Review Worker 输出 Design 一致性、边界条件、潜在回归和测试缺口。
3. Verification Worker 独立运行批准命令，记录命令、种子、周期、退出状态和日志引用。
4. 任一 Worker 发现问题后，Active Coding Agent 修复，所有受影响检查必须重跑。
5. 源码或测试变化会使对应旧报告失效。
6. 两个 Worker 都结束、有效 finding 已修复、被拒绝 finding 已附具体 invariant 或证据后，才能通过 `VERIFICATION_CLOSED`。

### 7.2 `active_only`

1. Active Coding Agent 在主实现步骤后执行一次分离的静态自审。
2. Active Coding Agent 再运行完整批准验证集并保存证据。
3. 证据明确记录 `performedBy: active`、`independent: false` 和 `waivedByUser: true`。
4. Harness 不得将该结果表述为独立审查或独立验证。

两种模式都必须通过同一正确性和可追溯性门禁。差别只在独立性和执行成本。

模块进入 `COMPLETE` 还要求 Design、源码、测试和证据一致，不存在当前模块的必需工作，已知排除项已经记录，并明确下一个集成消费者。Harness 的阶段报告必须包含角色、模块、状态、批准 revision、修改文件、验证证据、共享接口变化、依赖模块、阻塞项和下一项允许动作。

## 8. 模块映射、拓扑一致性与最小持久实体

Design、源码和验证通过稳定 Module ID 与 `architecture/modules.yaml` 关联。Stage1 批准后，Stage2 将 `architecture/modules.yaml` 视为只读输入。

`architecture/modules.yaml` 中的模块关系与实施顺序承担不同职责：

1. `dependsOn` 表示当前模块消费的其他模块契约。流水线允许存在经过寄存边界的反馈关系，因此该关系可以成环。
2. `stage2Order` 是每个 Module ID 恰好出现一次的实施顺序，不作为 `dependsOn` 的拓扑排序。
3. 模块职责、状态所有权和共享接口由 Architecture 决定。Stage2 只能在对应模块 Design 中闭合实现映射。

Design 与 `src/` 必须保持以下拓扑一致性：

1. 每个 Module ID 只对应一份 `design/<module-id>.md`。
2. 每份已批准 Design 通过 `implementation.sourcePaths` 和 `implementation.testPaths` 声明该模块拥有的实现路径。
3. 每个源码或测试路径只允许一个 Module ID 拥有。共享 Bundle、公共工具和集成文件也必须指定唯一 owner，其他模块通过接口或源码引用消费。
4. `design/` 与 `src/` 的物理目录无需逐层镜像。稳定映射由 Module ID、Design 中的路径集合和内容哈希共同确定。
5. Active Coding 只能修改本模块已批准的路径集合。路径新增、删除或 owner 迁移必须先修订并重新批准 Design。
6. 模块完成时，Design 声明的全部路径必须存在，源码和测试哈希必须与验证证据一致。

Harness 在 Design 批准前检查路径位于 `src/main/` 或 `src/test/`、单份 Design 内没有路径别名或重复、不同模块没有路径所有权重叠。Harness 在实现和验证阶段继续使用批准 Design 的路径集合限制写入并检查漂移。

首个模块产生内容时，最小正式实体为：

```text
design/regfile.md
src/main/scala/.../RegFile.scala
src/test/scala/.../RegFileSpec.scala
verification/regfile.md
.assistant/project.yaml
```

实际源码和测试路径以已批准的模块 Design 为准。`verification/regfile.md` 汇总主验证、用户验证模式、审查结果和最终证据，不为两个 Worker 分别创建长期报告文件。

`.assistant/project.yaml` 在现有项目状态中记录 Module ID、状态、角色、线程标识、租约、state epoch、批准哈希、`verificationMode`、允许路径和证据引用。原始日志、临时工作树和 Worker 输出进入工作区级 `.runtime/`。

第一版不新增独立 Stage2 状态文件、任务目录、Schema 目录、handoff 目录或 `.codex/chisel-workflow/`。Design 文档、批准哈希、允许路径和验收条件构成正式交接面。

## 9. Baseline 聚合

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

## 10. Architecture Change

Architecture Change 完成影响分析后复用同一模块循环：

```text
Architecture Idea
-> Contract 与影响分析
-> 确定受影响模块
-> 逐模块 Design、Implementation、Verification
-> 整体回归与一致性审查
-> Change Complete
```

每个受影响模块仍需独立批准 Design，并单独选择 `verificationMode`。文档、源码、测试和证据全部闭合后，Change 才能进入 `COMPLETE`。

## 11. 第一版范围

第一版覆盖：

1. 以 `regfile` 为 tracer 的单模块完整闭环。
2. Shadow Align 与 Active Coding 双 Agent 轮转。
3. 用户按模块选择两个独立验证 Worker 或 Active 自行验证。
4. WSL 中的 Chisel 构建、定向测试和证据记录。
5. `dual_issue_demo` baseline 所需模块和首个同拍 ALU 前递 Change。

第一版暂不覆盖完整形式验证、自动模块调度、多构建系统和多模块并行实现。
