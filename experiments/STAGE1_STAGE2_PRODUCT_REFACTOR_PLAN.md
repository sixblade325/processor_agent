# Stage1 与 Stage2 产品重构计划

状态：方向已确认，等待 `dual_issue_demo` 基线完成后实施

记录时间：2026-08-31

关联材料：

1. [产品总纲](../PRODUCT_PLAN/PRODUCT_PLAN.md)
2. [Stage1 权威计划](../PRODUCT_PLAN/STAGE1.md)
3. [Stage2 权威计划](../PRODUCT_PLAN/STAGE2.md)
4. [Stage1 与 Stage2 模块粒度问题记录](./STAGE1_STAGE2_MODULE_GRANULARITY_PROBLEM.md)
5. [Stage2 返回 Stage1 与 Stage1 V2 实现计划](./STAGE2_STAGE1_REWORK_IMPLEMENTATION_PLAN.md)

本文记录 Demo 完成后的产品重构方案。当前只冻结重构目标、阶段边界、数据迁移和验收条件，不修改 Harness、Schema、Profile、用户项目状态或现行权威计划。

## 1. 重构目标

Stage1 的产品定位调整为：用户和助手通过调研、追问和逐项确认，共同形成一份用户批准的处理器总体架构定义。

Stage2 的产品定位调整为：将已批准的总体架构转换为可实现、可验证、可追踪的模块拓扑和详细设计。

重构需要解决三个问题：

1. Stage1 当前过早确定 Architecture Module，导致总体架构讨论被实现边界牵引。
2. Stage2 同时接收 Stage1 Module Manifest 并重新规划 Implementation Unit，产生两套粒度和双重事实源。
3. Global Protocol 当前直接绑定 Stage1 Module ID，使模块拓扑调整被误判为总体架构返工。

重构完成后，同一份 Stage1 Architecture 可以支持多种合法的 Stage2 实现拓扑。拓扑变化无需修改处理器总体行为时，只在 Stage2 内完成。

## 2. Stage1 的新边界

### 2.1 Stage1 必须闭合的内容

1. 目标 workload、使用场景、成功指标、资源约束和排除项。
2. ISA、特权范围、异常范围和外部系统边界。
3. 顺序或乱序、发射宽度、退休宽度和 Lane 能力。
4. 宏观流水边界和主要操作延迟类别。
5. Cache 层级、阻塞策略、写策略和外部总线模型。
6. `redirect`、`flush`、retirement、Store visibility 等全局可见语义。
7. 性能计数器、参考模型、验收 workload 和最低验证要求。
8. 已知风险、未闭合问题和明确延期项。

`dual_issue_demo` 中适合由 Stage1 确认的事实包括：

1. 七级宏观流水。
2. 顺序双发射。
3. Lane 1 只执行简单 ALU 指令。
4. 阻塞式 ICache 和 DCache。
5. DCache 使用 write-back 和 write-allocate。
6. 全局最多一个 AXI transaction outstanding。
7. Store 在 Cache line 提交后退休。

### 2.2 Stage1 不再确定的内容

1. Fetch 是否为独立 Chisel Module。
2. Frontend 内部拆分为几个实现模块。
3. Issue、Execute 和 Retire 是否合并。
4. ICache 归属哪个 Implementation Unit。
5. 源码路径、具体接口 owner、实施 DAG 和实施 wave。
6. Stage2 内部 Pipeline 子模块和状态机边界。

### 2.3 Stage1 完成条件

Stage1 完成时必须满足：

1. 所有影响处理器外部行为、总体性能模型和全局正确性的决策均已批准。
2. 所有 required research 已完成，或由用户明确延期并记录风险。
3. Stage2 可以规划实现拓扑，无需自行发明宏观架构行为或全局语义。
4. 验收 workload、参考模型、指标和最低验证范围已经明确。
5. Review 不再要求 Architecture Module Manifest 或 `stage2Order`。

## 3. Stage2 的新边界

### 3.1 Stage2 必须闭合的内容

1. Implementation Unit 划分和职责。
2. Unit 之间的接口、方向、协议和 owner。
3. Stage1 架构角色到 Implementation Unit 的映射。
4. 源码路径、文件组织和 Chisel Module 边界。
5. 依赖 DAG、实施 wave 和集成顺序。
6. 每个 Unit 的状态、组合路径、时序边界、异常路径和全局协议落点。
7. 每个 Unit 的验证任务、断言、测试入口和完成证据。

### 3.2 Stage2 的讨论顺序

1. 助手根据 Stage1 Architecture 给出第一版 Topology Draft。
2. 用户与助手逐步讨论 Unit 边界、接口 owner 和源码组织。
3. 用户批准完整 Implementation Topology。
4. 助手按拓扑逐个生成 Unit Design Draft。
5. 用户批准单个 Unit Design 后，该设计晋升为正式 Design Contract。
6. 实现和验证只消费已批准的 Design Contract。

Topology Draft 只是讨论材料。用户批准前，不得成为正式实现约束。

### 3.3 Stage2 完成条件

1. 所有 Implementation Unit 均有已批准的 Design Contract。
2. 接口 owner、源码路径、依赖 DAG 和实施 wave 已闭合。
3. 每项 Stage1 Architecture 约束均能追踪到 Design、验证任务或明确的非实现理由。
4. 所有实现和验证结果均能追踪到批准版本。

## 4. 产物与事实归属

### 4.1 Stage1 保留的产物

1. `architecture/overview.md`：用户认可的处理器总体架构事实。
2. `research/stage1.md`：支撑总体架构决策的调研投影。
3. `verification/plan.md`：总体功能、workload、参考模型和性能验收要求。
4. `.assistant/project.yaml` 中的 Stage1 Decision、证据、批准和审计状态。

### 4.2 从 Stage1 移出的产物

1. Architecture Module Manifest。
2. `architecture.stage2Order`。
3. 绑定具体 Module ID 的 Global Protocol owner。
4. Implementation Unit、接口 owner、源码路径、DAG 和 wave。

### 4.3 Stage2 的产物

1. `design/plan.md`：面向用户的实现拓扑、依赖关系和进度投影。
2. `.assistant/project.yaml` 中的机器可读 Topology、Unit Design、批准和验证状态。
3. `design/<unit>.md`：已批准的 Unit Design Contract。

最小产品目标不新增另一份用户必须维护的 Topology 文件。Stage2 状态作为机器事实源，`design/plan.md` 作为人类可读投影。

`architecture/modules.yaml` 在旧项目迁移期间按兼容输入处理。新项目不再由 Stage1 生成该文件。实际迁移后是否保留 Stage2 机器可读文件，需要通过实现成本和调试需求决定。

## 5. Global Protocol 重构

Stage1 继续确认 Global Protocol 的语义，字段不再直接引用具体 Module ID。

Stage1 Protocol 至少描述：

1. 协议名称和目的。
2. 架构角色、producer、consumer 和受影响资源。
3. 触发、保持、完成、取消和优先级规则。
4. 外部可见结果和全局不变量。

Stage2 负责补充：

1. 架构角色到 Implementation Unit 的映射。
2. 具体接口 owner 和信号方向。
3. 协议状态的存放位置。
4. 跨 Unit 的组合或时序路径。

Schema 校验分为两层：

1. Stage1 校验协议语义完整性，不校验具体 Module ID 是否存在。
2. Stage2 校验所有架构角色均有实现落点，owner 引用的 Unit 和接口真实存在。

## 6. 返工路由

Stage2 发现以下变化时返回 Stage1：

1. ISA、特权、异常或系统边界变化。
2. 顺序模型、发射宽度、退休宽度或 Lane 能力变化。
3. 宏观流水和主要操作延迟类别变化。
4. Cache 策略、外部总线模型或 transaction 并发模型变化。
5. `redirect`、`flush`、retirement、Store visibility 等全局语义变化。
6. Stage1 验收 workload、成功指标或资源约束需要改变。

以下变化保留在 Stage2：

1. Implementation Unit 的拆分或合并。
2. Chisel Module 边界和源码路径变化。
3. 具体接口 owner 或状态存放位置变化。
4. 实施 DAG 和 wave 变化。
5. 不改变 Stage1 语义的局部时序实现调整。

现有 `ARCH_MODULE_MANIFEST_MISSING_CACHE_TOPOLOGY` 在新模型中属于 Stage2 Topology 工作。Global Protocol 的语义错误返回 Stage1，具体 owner 映射错误留在 Stage2。

## 7. 实施步骤

### Phase 0：冻结 Demo 证据

1. 完成 `dual_issue_demo` 基线实现、编译、仿真和 workload 测量。
2. 记录现有 Stage1、Stage2 工作流的实际使用频率、返工路径和失败案例。
3. 保存迁移前状态摘要和必要测试样例。

### Phase 1：先修改产品定义

1. 更新 `PRODUCT_PLAN/PRODUCT_PLAN.md`。
2. 重写 `PRODUCT_PLAN/STAGE1.md` 的输入、流程、产物和完成条件。
3. 重写 `PRODUCT_PLAN/STAGE2.md` 的 Topology Draft、批准和 Unit Design 流程。
4. 统一 Architecture、architecture role、Implementation Topology、Implementation Unit 和 Chisel Module 的术语。

### Phase 2：升级 Schema

1. 从 Stage1 schema 删除 Architecture Module Manifest 和 `stage2Order`。
2. 将 Global Protocol owner 改为架构角色和 Stage2 映射两层结构。
3. 将 Implementation Topology 的唯一所有权移入 Stage2 状态。
4. 为旧项目定义显式 schema version 和迁移规则。

### Phase 3：修改 Stage1 Harness

1. 删除 Stage1 Decision、Review 和 Correction 对 Module Manifest 的要求。
2. 修改 Stage1 完成门禁和审计规则。
3. 修改 `architecture/overview.md`、`research/stage1.md` 和 `verification/plan.md` 的渲染。
4. 保留 Stage1 Architecture Rework，只处理总体架构和全局语义。

### Phase 4：修改 Stage2 Harness

1. 增加 Topology Draft 生成、展示、修订和批准流程。
2. 增加架构角色到 Unit、接口和源码路径的映射校验。
3. 由批准后的 Topology 生成 Unit Design 队列和实施 DAG。
4. 保留单 Unit Draft、用户批准、正式 Design、实现和验证流程。

### Phase 5：迁移 Profile 和项目

1. 更新通用 Profile 和 `dual_issue_demo` Profile。
2. 保留已有 Architecture Decision、Research、用户批准和证据历史。
3. 将旧 Module Manifest 标记为迁移输入，不继续作为 Stage1 当前事实。
4. 仅重建受影响的 Stage2 Topology 和 Unit Design 状态。
5. 对迁移前后文档 hash、批准版本和追踪关系进行审计。

### Phase 6：更新 Workspace Agent

1. 调整 Stage1 提问、调研、推荐和审查提示。
2. 调整 Stage2 Topology Draft 和 Design Draft 提示。
3. 明确 Stage2 发现宏观架构缺口时的返工入口。
4. 同步 `USER_GUIDE.md` 和示例命令。

### Phase 7：测试与端到端验证

1. 更新单元测试、Schema 测试和迁移测试。
2. 增加同一 Architecture 派生两种合法 Topology 的测试。
3. 增加 Stage1 与 Stage2 返工路由测试。
4. 使用迁移后的 `dual_issue_demo` 完成一次端到端回归。

## 8. 验收标准

1. Stage1 在不存在 Architecture Module Manifest 和 `stage2Order` 时可以完成。
2. 同一份已批准 Architecture 可以生成两种不同的合法 Stage2 Topology，且无需修改 Stage1 revision。
3. Stage2 无法静默改变发射模型、Cache 策略、总线模型或全局可见语义。
4. Global Protocol 在 Topology 调整后仍保留稳定的架构语义和证据链。
5. 架构语义缺口与实现拓扑缺口能够进入正确的返工阶段。
6. 同一事实只存在一个权威来源，人类文档与机器状态可以相互追踪。
7. `dual_issue_demo` 可以完成迁移、重新规划 Topology、生成 Design 并通过既有验证入口。
8. 用户只阅读当前 Packet 和正式文档即可说明当前状态、待确认事项和下一步动作。

## 9. 风险与控制

| 风险 | 控制措施 |
|---|---|
| 旧项目迁移导致批准历史丢失 | 迁移只追加版本，保留旧 revision、Decision、evidence 和 approval 记录 |
| Protocol 去除 Module owner 后约束变弱 | Stage1 校验语义完整性，Stage2 强制校验 role-to-unit 和 owner 映射 |
| Stage2 Topology 上下文过大 | 先批准全局 Topology，再按 Unit 生成局部 Design Packet |
| 两阶段仍重复记录同一事实 | Schema 定义唯一 owner，渲染文档只投影引用和摘要 |
| Demo 临时 8 模块被误当成产品默认值 | 在迁移规则中明确标记为项目兼容快照 |
| 重构范围扩散到 Stage3 | 本计划不调整 Stage3，Stage3 只消费已实现和已验证的 Stage2 结果 |

## 10. 实施前仍需拍板的问题

1. Stage2 是否需要独立的机器可读 Topology 文件，或只保存在 `.assistant/project.yaml`。
2. 架构角色的最小 Schema，以及 producer、consumer 和 shared resource 的表达方式。
3. 新项目在 Stage1 完成前是否创建空 `design/`，或进入 Stage2 时再创建。
4. 旧 Module Manifest 的迁移后保留期限和删除门禁。
5. 已批准 Stage1 项目迁移后是否自动保持批准，或要求一次范围受限的迁移确认。

这些问题在 Phase 1 和 Phase 2 设计审查中逐项决定，不阻塞当前 Demo。

## 11. 启动条件

满足以下条件后启动本重构：

1. `dual_issue_demo` baseline 可以稳定编译和仿真。
2. 最低功能测试和参考模型检查通过。
3. 目标 workload 可以重复运行并产生可比较的 cycle 或 IPC 数据。
4. 至少一个 Stage2 Unit 完成 Draft、批准、实现和验证的完整生命周期。
5. 当前两阶段工作流的使用数据和问题复盘已经落档。

启动前，Demo 继续使用现有 Harness 和临时模块边界。当前兼容状态不得继续扩展为通用产品规则。

## 12. 事实所有权与可修正性

状态：产品设计缺陷已确认，纳入本次重构范围

### 12.1 已暴露的故障

`dual_issue_demo` Stage1 revision 141 暴露了完整的不可修正闭环：

1. Profile 0.7.0 的 `defaults.exclusions` 仍包含 `Cache 和虚拟内存`，`S1_DEC_006.knownFacts` 仍包含 `Demo 不需要 Cache 和虚拟内存`。
2. 当前项目已通过 Architecture Rework 确认 ICache、DCache 和共享 AXIAributer 属于 baseline。
3. `architecture/overview.md` 的“项目意图/排除项”由 `state.stage1.intent.exclusions` 生成，“系统边界”由 `Stage1ProjectSpec.architecture.systemBoundary` 生成。
4. Review Correction 的 `ProjectSpecTarget` 不包含 `intent.exclusions`。
5. 独立 Audit 只读取生成文档，由模型自行判断 `repairKind`，无法可靠获知冲突文本的真实状态来源。
6. Audit 将该问题标记为 `repairKind=project_spec` 和 `repairTarget=architecture.systemBoundary`。Correction 可以继续替换系统边界，无法删除项目意图中的旧排除项。
7. `profile-refresh` 在当前 finding 不是 `profile` 时拒绝执行，公开恢复路径进入死锁。
8. `verification/plan.md` 的 Stage2 完成门禁由 Renderer 固定输出，修改现有 Verification ProjectSpec 字段也无法替换这些语句。

该故障说明当前生成文档中的正式语义分散在 `intent`、Decision、ProjectSpec、Profile 和 Renderer 常量中。部分语义没有唯一维护者，部分 finding 没有能够改变目标文本的合法修正入口。

### 12.2 重构约束

1. 每条进入正式文档的语义必须对应唯一 `factKey`。
2. 每个 `factKey` 必须声明唯一事实所有者、当前来源版本和合法修改入口。
3. Renderer 只负责格式和投影，不保存项目级或产品级处理器事实。
4. Audit Agent 负责识别语义冲突和缺口，不自行决定最终修复路由。
5. Harness 根据 `factKey` 的所有权解析 `repairKind` 和 `repairTarget`。
6. Finding 的 `requiredClosure` 必须落在其 repair target 能够影响的生成片段内。
7. Correction 提交前必须试渲染候选状态，确认目标片段发生预期变化且未修改未声明目标。
8. Correction 应用后继续通过独立 Audit 验证语义闭合。
9. 同一个事实不得同时由 Profile 默认值、项目状态和 Renderer 常量提供正文。

### 12.3 最小数据模型

本次重构不新增独立的用户维护文件。事实来源关系保存在 Harness 状态和渲染索引中。

每个可审查事实至少具有以下逻辑属性：

```text
factKey
ownerKind
ownerPath
sourceRevisionOrDigest
renderedArtifact
renderedSection
mutableThrough
```

`ownerKind` 的最小集合为：

1. `intent`
2. `decision`
3. `project_spec`
4. `profile`

Renderer 不属于 `ownerKind`。当前写在 Renderer 中的 Stage2 完成门禁迁移到 `verification.completionCriteria` 或同等 ProjectSpec 字段。

Stage1 Intent 采用以下收敛方案：

1. 将 `goal`、`useCase`、`constraints` 和 `exclusions` 纳入 Stage1 ProjectSpec 的可版本化范围。
2. Review Correction 可以使用明确 target 修正这些字段。
3. Profile 只提供初始化默认值和迁移来源。
4. 项目形成用户确认值后，Profile refresh 不得静默覆盖项目事实。
5. 不增加新的 `project_intent` repair kind，继续由统一的 ProjectSpec 修正协议处理。

### 12.4 Review 与 Correction 新流程

1. Harness 向 Audit Worker 提供生成文档和只读的 `factKey` 来源索引。
2. Audit Finding 返回冲突位置、涉及的 `factKey`、语义说明和 `requiredClosure`。
3. Harness 根据来源索引生成或校验 `repairKind` 与 `repairTarget`。
4. Finding 引用了不存在的 `factKey`、错误 owner 或无法影响目标片段的 target 时，Harness 拒绝接受 Review Report。
5. Workspace Agent 基于合法 target 形成候选 patch 和证据覆盖。
6. Harness 在临时状态中应用 patch 并重新渲染目标文档。
7. 候选渲染未改变 finding 指向的片段时，Correction 提交失败且正式状态保持不变。
8. 候选渲染改变了未声明的事实 target 时，Correction 提交失败并报告越界字段。
9. Correction 成功后重新运行 Review 和独立 Audit，旧 finding 只在新证据闭合后标记为 superseded。

### 12.5 实施映射

该任务分配到已有重构阶段：

1. Phase 1：在产品计划中定义事实所有权、`factKey`、修正边界和 Renderer 约束。
2. Phase 2：把 Intent 纳入 ProjectSpec，增加 Verification 完成门禁字段和渲染来源索引 Schema。
3. Phase 3：修改 Stage1 Review、Correction、Profile refresh、候选试渲染和修复路由校验。
4. Phase 5：升级 `dual_issue_demo` Profile，迁移 Intent，保留旧 Correction 历史并标记无效重复修正。
5. Phase 6：要求 Workspace Agent 展示 finding 的事实所有者、修正 target 和候选文档差异。
6. Phase 7：增加事实来源、错误分类、不可达 target、Renderer 常量和恢复死锁测试。

### 12.6 `dual_issue_demo` 迁移要求

1. 新 Profile 删除 Cache 排除项及 `Demo 不需要 Cache` 的旧 known fact。
2. 迁移后的 Intent 排除项与已批准的系统边界一致。
3. revision 141 的 finding 作为迁移前故障证据保留，迁移后重新运行 Review 生成当前 finding。
4. 多轮无法影响 `intent.exclusions` 的 `architecture.systemBoundary` Correction 保留审计历史，并标记为 ineffective 或由等价状态明确表示。
5. Stage2 完成门禁从 Renderer 常量迁移到 Verification ProjectSpec。
6. 迁移、重审和恢复 Architecture Rework 全程通过 Harness 完成，不手工修改 `.assistant/`。

### 12.7 补充验收标准

1. Profile 默认值错误产生的 finding 自动路由到 Profile 或显式项目覆盖入口。
2. 项目已确认事实与 Profile 默认值冲突时，Harness 保留项目事实并报告来源差异。
3. 修改 `architecture.systemBoundary` 的 Correction 无法声称已经修改 `intent.exclusions`。
4. 任意正式文档语义都可以追踪到唯一 `factKey` 和当前 source revision 或 digest。
5. Renderer 源码中不存在未进入 Schema 的项目语义和阶段完成门禁正文。
6. 错误 `repairKind` 或不可达 `repairTarget` 在 Review Report 接收阶段被拒绝。
7. Correction 候选未改变目标生成片段时不增加正式 revision、history event 或重复快照。
8. Profile refresh、Review Correction 和 Architecture Rework 之间不存在无公开命令可恢复的状态组合。
9. 迁移后的 `dual_issue_demo` 可以通过 Review、独立 Audit、用户批准并恢复 `S2_ARW_001`。
