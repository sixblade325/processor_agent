# Stage2 有界调用与双 Agent 并发重构计划

状态：核心机制已实施，`dual_issue_demo` 已迁移并完成一次真实并发派发，Demo 继续停在用户批准与 Design 修订门禁

记录时间：2026-08-31

依据：

1. [Stage2 权威计划](../PRODUCT_PLAN/STAGE2.md)
2. [Stage2 Skill 驱动双 Agent 重构计划](./STAGE2_SKILL_DRIVEN_DUAL_AGENT_HARNESS_REFACTOR_PLAN.md)
3. `E:\107\dual_issue_demo` 的 System Design 与 Package Loop 实跑证据

## 1. 目标

Stage2 已经具备 System Design、Work Package、Active/Shadow assignment、Package Design、实现和独立验证状态。当前运行方式仍存在两个核心问题：

1. 单次 Agent 调用输入过大，局部错误也会触发完整重生成。
2. Harness 可以同时给出 Active 与 Shadow action，实际只有一个 Workspace Agent 串行启动 CLI 命令。

本轮重构把 Stage2 调整为：

```text
有界任务输入
+ 局部修订协议
+ 可观测 Runtime
+ Harness 并发派发
+ 冲突安全的结果合并
```

目标是降低 `idea -> approved Design -> implemented Package` 的墙钟时间和单位可靠结果成本。双 Agent 必须产生真实重叠运行，不能只在状态中轮换角色。

## 2. 边界

本轮实现：

1. 限制各类 Worker 的读取范围和 Task Envelope。
2. 为 System Design 与 Package Design 提供 hash 绑定的局部 Patch。
3. 把逻辑 Agent slot 与 provider session 生命周期分离。
4. 增加增量事件、heartbeat、deadline、真实取消和不可变 Run Ledger。
5. 由 Harness 同时派发一个 Active Implementation 和一个 Shadow Package Design。
6. 安全合并两个互不冲突的结果。
7. 补齐 planned board 和三类 Work Package 依赖。

本轮不实现：

1. 正式 A/B 对照实验。
2. 两个 Package 同时修改 RTL。
3. 第三个长期 Agent。
4. 多 Provider 适配器。
5. 自动性能优化和 DSE。
6. 新的用户项目顶层目录。

## 3. 当前基线

### 3.1 Harness 状态

观测时 `dual_issue_demo` 状态为：

```text
Stage2: PACKAGE_LOOP
revision: 46
workspaceRevision: 29
System Design: revision 10, approved, review pass
Active A: wp_contracts, active_implementation ready
Shadow B: wp_axi, package_design running
```

`stage2 next` 同时返回两个 machine action：

```text
Shadow B: package_design wp_axi
Active A: active_implementation wp_contracts
```

实际进程中只有 Shadow B 的 `stage2 design . wp_axi`。Active A 没有 Implementation Worker。当前双 Agent 状态模型没有形成并发执行。

### 3.2 `wp_axi` 调用规模

第一次 `wp_axi` Package Design 运行证据：

```text
elapsed: 约 8 分钟
input_tokens: 1,643,658
cached_input_tokens: 1,414,400
output_tokens: 11,682
prompt.txt: 约 97 KB
task-envelope.json: 约 81 KB
result.json: 约 32 KB
```

设计主体已经形成，Harness 因四个局部问题拒绝落盘：

1. `affectedWorkPackages` 包含说明文字，没有使用合法 Work Package ID。
2. `sharedInterfaceChanges` 使用文字表示“无变化”，没有使用规范空集合。
3. `runner=wsl` 的命令没有完全满足 runner 专属字段约束。
4. `openQuestions` 保留了可以从批准文档直接闭合的问题。

第二次运行只要求修正这些字段，当前协议仍要求重新输出完整 Package Design。

### 3.3 运行可见性

当前 Runtime 在子进程退出前只创建 `prompt.txt`、`schema.json` 和 `task-envelope.json`。stdout 与 stderr 缓存在父进程内，`codex.jsonl` 在 Worker 结束后一次性写入。运行期间无法从 Harness 判断模型是否仍在推理、是否等待工具、是否触发上下文压缩或是否失活。

## 4. 未解决问题

以下问题来自此前 System Design 实跑，当前代码中仍无对应机制。

| ID | 问题 | 当前影响 |
|---|---|---|
| U1 | 全量重生成与上下文膨胀 | Decision、Revision 和 Package 局部错误触发完整输出 |
| U2 | 批准前 planned board 不完整 | 用户难以审查 Work Package、路径和依赖 |
| U3 | Runtime session 记录覆盖旧 run | 同一 `runtimeRef` 的历史调用无法形成不可变证据 |
| U4 | 单一 `dependsOn` 混合多种语义 | Design、实现和集成被无依据串行化 |
| U5 | Worker 读取范围无界 | Agent 可以读取无关源码、遗产和历史材料 |

已经完成的修复不进入本轮范围：

1. System Design 待批准草案可以通过 Revision Request 返回 Author 修订。
2. `SDR_001` 已应用到 System Design revision 10。
3. System Design approval 已先建立正式 authority，再分配首个 Shadow。

## 5. 新增问题

### 5.1 N1：双 Agent 调度仍为串行

根因：

1. `getReadyWorkspaceActions` 可以返回多个 action。
2. Workspace Agent 针对每个 action 启动一个同步 CLI 命令。
3. `stage2 design` 和 `stage2 implement` 都等待 Runtime 完成后才返回。
4. Workspace Agent 在前一个命令结束前无法启动后一个命令。
5. Harness 没有统一 claim 和派发多个 ready action 的 supervisor。

结果是 Active 和 Shadow 只在状态中并存，墙钟时间仍按串行调用累加。

### 5.2 N2：Package Design 没有局部修订协议

Harness 已经能定位非法字段，修订入口仍只有自然语言 `--instruction`。Agent 必须重新生成完整 `Stage2PackageDesignProposal`，既增加成本，也可能改动已经正确的字段。

### 5.3 N3：Provider session 跨阶段增长

Agent A 与 Agent B 同时承担 System Design Author/Reviewer 和 Package Loop Active/Shadow。逻辑 slot、provider session 和项目记忆使用同一生命周期。System Design 历史进入 Package Loop，每个 Package 又继续积累上下文。

### 5.4 N4：运行中缺少进度、超时分级和真实取消

当前 `AgentRuntime.start` 与 `resume` 只返回最终 `AgentRun`。`cancel` 只修改 Registry 状态，没有保存或终止真实子进程。统一 30 分钟总超时无法区分正常长推理和无事件失活。

## 6. 重构原则

1. Harness 继续是状态、正式文档、批准和用户项目写入的唯一 owner。
2. Agent 负责需要处理器工程判断的设计与实现，Harness 负责机械规范化、Schema、引用和冲突检查。
3. A、B 是稳定逻辑 slot，provider session 是可轮换的 Runtime 资源。
4. 每次 Worker 调用具有有界输入、明确 read scope、唯一 runId 和不可变证据。
5. 并发 Worker 只写各自 runtime 目录，完成后由 Harness 合并。
6. 无关 Package 的状态变化不能误伤合法结果，全局 authority 变化必须使旧结果失效。
7. 局部错误使用 Patch，设计语义变化才允许完整重生成。
8. 先降低单次调用成本并建立可观测 Runtime，再启动真实并发。

## 7. 目标运行结构

```text
Workspace Agent
    |
    | processor-agent stage2 advance .
    v
Harness Scheduler
    |
    +-> claim Active A  -> Runtime Run A -> isolated result A
    |
    +-> claim Shadow B  -> Runtime Run B -> isolated result B
                              |
                              v
                    Harness validation and merge
                              |
                              v
                 formal Design / source / test / state
```

Workspace Agent 每轮只调用一次 `stage2 advance`。`stage2 design`、`stage2 implement` 和 `stage2 verify` 保留为诊断和精确重试入口。

## 8. 有界任务输入

### 8.1 Read Manifest

每个 Worker Task Envelope 增加：

```ts
interface Stage2ReadManifest {
  entryFiles: string[];
  allowedRoots: string[];
  excludedRoots: string[];
  affectedIds: string[];
  maxListedFiles: number;
  manifestSha256: string;
}
```

规则：

1. Package Design 只读取相关 Architecture 条目、System Design 切片、shared interface、上游批准 Design、批准源码路径和测试路径。
2. Implementation 只读取批准 Package Design、允许写路径和必要依赖接口。
3. Static Review 与 Verification 只读取冻结实现、Design、测试和明确依赖。
4. `.runtime`、`research/reference_sources`、构建缓存和未引用遗产默认排除。
5. `list_files("")` 在 scoped task 中拒绝。
6. 超范围读取返回 `read_scope_gap`。Harness 扩展 Manifest 后创建新 run，Worker 无权自行扩大范围。

### 8.2 Task Envelope 投影

Envelope 不再嵌入完整 Stage1 ProjectSpec、全部 Work Package 和持续增长的历史日志。每个 Package 只投影：

1. 当前批准 hash。
2. 当前 Package plan 与 Design。
3. 相关 Component 和 Interface。
4. 已批准上游 Design 摘要。
5. 允许路径。
6. 当前 blocker、Revision Request 和必要 evidence。
7. Read Manifest。

## 9. 局部修订协议

System Design 与 Package Design 共用 base-hash Patch 基础设施，分别使用业务专属 Schema。

```ts
interface DesignRevisionIssue {
  code: string;
  target: string;
  message: string;
  repairClass: "canonical" | "local_patch" | "full_redraft";
}

interface DesignPatch {
  baseProposalSha256: string;
  operations: Array<{
    op: "add" | "replace" | "remove";
    target: string;
    value?: unknown;
  }>;
}
```

三类修复路径：

1. `canonical`：Harness 可以唯一确定含义时直接规范化，不调用 Agent。每次规范化保存旧值、新值、规则 ID 和结果 hash。
2. `local_patch`：Agent 只读取基线、结构化 issues 和受影响字段，返回带 base hash 的 Patch。
3. `full_redraft`：状态生命周期、接口方向、shared interface、路径 owner 或 Work Package 边界发生实质变化时重新生成完整 Design。

约束：

1. Patch 只能修改 issues 声明的 target。
2. base hash 漂移时原子拒绝。
3. Patch 应用后重新执行完整确定性校验。
4. Work Package 引用必须属于当前合法 ID 集合。
5. 命令 Schema 按 `runner` 使用判别联合类型。
6. Harness 不得通过 canonicalization 改变处理器设计语义。

## 10. Session 与 Run 分层

```ts
interface RuntimeSessionRecord {
  runtimeRef: string;
  provider: string;
  externalSessionId?: string;
  status: "active" | "idle" | "cancelled" | "failed";
  latestRunId?: string;
  updatedAt: string;
}

interface RuntimeRunRecord {
  runId: string;
  runtimeRef: string;
  task: Stage2AgentTask;
  slot?: Stage2AgentSlot;
  workPackageId?: string;
  status: "queued" | "running" | "model_completed" | "validation_failed" | "applied" | "failed" | "cancelled" | "orphaned";
  startedAt?: string;
  lastEventAt?: string;
  completedAt?: string;
  inputArtifactHashes: Record<string, string>;
  outputArtifactHashes: Record<string, string>;
  runtimePath: string;
}
```

Session 规则：

1. System Design Approval 后结束 Author 与 Reviewer session 的活跃生命周期。
2. Package Loop 为 A、B 创建新的 Package 阶段 session，只注入有界 handoff。
3. Package 切换时可以复用同阶段 session。
4. 累计 input token、run 数、prompt 大小或异常压缩次数超过阈值时轮换 session。
5. session 轮换不改变 slot、assignment、lease、Package owner 或 approval。
6. Run Ledger 以 runId 追加，旧记录不可覆盖。

## 11. 可观测 Runtime

Runtime Port 改为先返回 Run Handle：

```ts
interface AgentRunHandle {
  runId: string;
  runtimeRef: string;
  pid?: number;
  eventsPath: string;
  resultPath: string;
  startedAt: string;
  completion: Promise<AgentRun>;
}
```

运行规则：

1. stdout 和 stderr 到达时立即追加到 `codex.jsonl`。
2. 每次有效事件更新 `lastEventAt`、事件计数和可用 usage。
3. `stage2 status` 展示 task、slot、Package、runId、elapsed、lastEventAt 和 deadline。
4. 区分总 deadline 与 no-event timeout。
5. timeout 或用户 cancel 必须终止真实 Windows 子进程树。
6. 模型完成、输出 Schema 校验、Harness 语义校验和结果应用分别记录状态。
7. Run Record 在 dispatch 前持久化，异常退出后标记 `orphaned`，不得静默覆盖。

所有原始运行文件继续进入工作区级 `.runtime/`，不增加用户项目正式文件。

## 12. 真实双 Agent 并发

增加：

```text
processor-agent stage2 advance <path>
```

执行过程：

1. 在同一状态快照中计算 ready machine action。
2. 最多 claim 一个 Active Implementation 和一个 Shadow Package Design。
3. claim 时保存 runId、assignment lease、`stateEpoch`、Package revision、Design hash、Interface hash 和允许路径。
4. 使用 `Promise.allSettled` 并发启动两个 Runtime。
5. Worker 只向各自 runtime 目录输出候选结果。
6. Harness 在项目状态锁内逐项校验并应用结果。
7. 一个 Worker 失败不取消另一个合法 Worker。

### 12.1 合并门禁

每个结果必须满足：

1. `stateEpoch` 未变化。
2. assignment lease、slot、role 和 `workPackageId` 未变化。
3. System Design、Interface 和 Package Design approval hash 未变化。
4. 对应 Package revision 未变化。
5. 结果路径属于 assignment 允许路径。
6. 与同批次及已应用结果的路径无交叠。
7. 并发期间发生的事件只影响不相干 Package。

全局 `workspaceRevision` 不再单独否决并发结果。无关 Package 的 revision 增长允许合并。Architecture Rework、System Design Reopen、shared interface、路径 owner 或同一 Package 变化必须拒绝旧结果。

## 13. Planned Board 与依赖

System Design 批准前从 Proposal 投影只读 planned board，展示 Component、路径、验收和依赖。批准后由真实 Work Package state 接管。

Work Package 依赖拆分为：

```ts
interface Stage2WorkPackagePlanV5 {
  designDependsOn: string[];
  implementationDependsOn: string[];
  integrationDependsOn: string[];
}
```

1. `designDependsOn` 控制开始 Package Design 所需的上游批准 Design。
2. `implementationDependsOn` 控制开始写源码所需的上游完成实现。
3. `integrationDependsOn` 控制集成验证，不阻止独立 Design 或源码实现。

三组依赖分别执行无环校验。路径交叠、shared interface change 和 approval hash 继续作为独立门禁。

## 14. 实施顺序

### Phase A：限制单次调用成本

1. 实现 Read Manifest 并由 Project Reader MCP 强制执行。
2. 裁剪 Package Design 和 Implementation Envelope。
3. System Design Approval 后轮换为 Package 阶段 session。
4. 实现 Design Revision Issue、canonicalization 和 Patch apply。
5. 记录每次 run 的 prompt、Envelope、输入、输出、工具调用和 token。

Phase A 完成前不自动批量启动后续高成本 Package Design。

### Phase B：建立可观测 Runtime

1. 拆分 Session Registry 与 immutable Run Ledger。
2. Runtime Port 返回 `AgentRunHandle`。
3. 增量写入事件、heartbeat、usage 和 deadline。
4. 实现真实取消、no-event timeout 和 orphan recovery。
5. 更新 `stage2 status` 与用户摘要。

### Phase C：实现并发派发

1. 增加 `stage2 advance`。
2. 原子 claim Active 与 Shadow action。
3. 并发启动两个 Runtime。
4. 使用 `stateEpoch`、lease、Package revision 和 authority hash 合并结果。
5. 增加项目状态锁、路径冲突检测和崩溃恢复。
6. Workspace Agent 改为调用单一 advance 入口。

### Phase D：完成结构升级

1. 投影 planned board、revision diff、warning 和 risk。
2. 拆分三类依赖并迁移 Demo。
3. 实现 targeted Review 与 full Review 门禁。
4. 重新评估 Work Package 粒度和实际轮转收益。

## 15. 测试矩阵

1. 两个延迟 Fake Runtime 由一次 `stage2 advance` 同时启动，总耗时小于串行和。
2. Active 与 Shadow 路径不交叠时，两个结果以任意顺序均可合法合并。
3. shared interface、authority hash、lease、`stateEpoch` 或同一路径变化时拒绝旧结果。
4. 一个 Worker 失败时另一个合法结果仍可完成并落盘。
5. canonical issue 不启动 Agent，保存规范化记录并通过完整校验。
6. local patch 只能修改允许 target，base hash 漂移时原子拒绝。
7. full redraft 只在明确语义变化时触发。
8. Worker 访问 Manifest 外路径时返回确定性 `read_scope_gap`。
9. System Design session 不被 Package Worker resume。
10. Worker 运行中 `codex.jsonl` 和 `lastEventAt` 持续更新。
11. no-event timeout 与 cancel 均终止真实子进程树。
12. 无关 Package 的 workspace revision 增长不误伤合法结果。
13. 现有 Architecture Rework、approval、路径 owner 和独立验证测试不回归。

## 16. 完成标准

1. `wp_axi` 同类局部校验失败不再触发完整 Package Design 重生成。
2. Package Task Envelope 不包含无关 Work Package、遗产目录或完整历史日志。
3. 单次 Package Design input token 相对 1,643,658 基线至少下降 80%。
4. `stage2 status` 可以区分 queued、running、model completed、validation failed、applied、cancelled 和 orphaned。
5. `wp_contracts` Active Implementation 与 `wp_axi` Shadow Design 至少产生一次可由 runId 和时间戳证明的真实重叠。
6. 两个并发结果均通过 authority hash、lease、路径和 Package revision 校验。
7. A、B 逻辑 slot 保持稳定，provider session 可以安全轮换。
8. planned board、三类依赖和实际 Package board 语义一致。
9. Runtime 原始数据留在 `.runtime/`，用户项目只保存正式 Design、实现、验证证据和必要索引。
10. Demo 完成至少两个真实 Active/Shadow 轮转后，再评估双 Agent 的墙钟收益与单位可靠结果成本。

## 17. Demo 迁移约束

1. 保留当前 Stage1 approval、System Design revision 10、`SDR_001` 记录和八个 Work Package。
2. 不手工修改 `dual_issue_demo/.assistant/` 或 Harness 生成文档。
3. 当前在途 Worker 的结果、事件和 usage 作为重构基线保留。
4. Schema 升级使用显式 dry-run 和 apply，展示保留、迁移和失效字段。
5. 已批准 Package Design 的 hash 在迁移后仍可验证时保留；运行语义变化导致无法验证时进入 `NEEDS_REALIGN`，不得伪造新批准。
6. 重构完成后从当前 Package Loop 状态恢复，不重新运行 Stage1 或重新发明 System Design。

## 18. 实施结果

### 18.1 代码结构

schemaVersion 5 的 Stage2 主流程已按职责拆分：

| 模块 | 职责 |
|---|---|
| `src/stage2/workflow.ts` | System Design、Package Loop、并发派发和状态转换 |
| `src/stage2/runtime-port.ts` | provider-neutral Session 与 Run 生命周期 |
| `src/stage2/read-manifest.ts` | 生成有界 Read Manifest |
| `src/project-reader-mcp.ts` | 强制读取、搜索和枚举边界 |
| `src/stage2/design-revision.ts` | canonicalization、结构化 issue 和 hash 绑定 Patch |
| `src/stage2/gates.ts` | authority、lease、Package revision 和路径合并门禁 |
| `src/stage2/rotation.ts` | Active、Shadow 分配、晋升和修订任务优先级 |
| `src/stage2/work-package.ts` | 三类依赖门禁 |
| `src/stage2/workspace-lock.ts` | 跨进程项目状态锁 |
| `src/stage2-runtime.ts` | Codex CLI 流式事件、deadline、cancel 和 orphan 探测 |

`src/stage2.ts` 继续承载 schemaVersion 3 的旧流程和迁移兼容入口。schemaVersion 5 的新增逻辑不再继续写入该文件。

### 18.2 已实现机制

1. schemaVersion 4 的单一 `dependsOn` 已迁移为 `designDependsOn`、`implementationDependsOn` 和 `integrationDependsOn`。
2. Runtime Registry 只保存 provider session，Run Ledger 按 `runId` 保存不可变运行记录。
3. Runtime 先返回 `AgentRunHandle`，运行期间增量写入 `codex.jsonl` 和 `run-status.json`。
4. `stage2 status` 展示 run 状态、时间、deadline、事件数、PID 和 runtime 路径。
5. `stage2 cancel` 可以按 `runId` 或 `runtimeRef` 终止真实进程树。
6. 启动恢复时会把失去进程的 queued 或 running run 识别为 `orphaned`。
7. Worker 的读取由 hash 绑定 Read Manifest 限定，越界统一返回 `read_scope_gap`。
8. Package Design 支持确定性 canonicalization 和 hash 绑定局部 Patch。Patch 只能修改结构化 issue 声明的 target。
9. `stage2 advance` 在同一快照中最多派发一个 Active Implementation 和一个 Shadow Package Design，并使用独立 runtime 目录并发运行。
10. 结果合并不再使用全局 `workspaceRevision` 作为唯一门禁，改为检查 `stateEpoch`、lease、slot、role、Package revision、authority hash 和路径集合。
11. System Design 批准前可以投影 planned board，批准后使用正式 Work Package board。
12. Active Implementation 报告 Design gap 时释放 Active assignment，并把原 Package 留在 `DESIGNING`。空闲 Shadow 优先接手未分配的 Design 修订，避免同一时刻出现两个 Shadow role。
13. schemaVersion 5 再次迁移时会修复历史重复 role，同时保留仍在工作的合法 assignment。

### 18.3 `dual_issue_demo` 迁移

Demo 通过 Harness 显式执行 schemaVersion 4 到 5 的 dry-run 和 apply：

```text
source revision: 46
target revision: 47
Stage2 status: PACKAGE_LOOP
System Design: revision 10, approval preserved
Work Packages: 8, preserved
```

迁移没有重新运行 Stage1，没有重新生成 System Design，也没有手工修改 `.assistant/`。

### 18.4 真实并发证据

一次 `stage2 advance` 产生以下 dispatch：

```text
dispatchId: dispatch_4a470a3d-ef6f-4dfe-8f99-f19084c664e5
dispatch startedAt: 2026-08-31T13:01:26.703Z
dispatch completedAt: 2026-08-31T13:08:25.506Z
```

两个 Run 的启动时间只差 1 ms：

| 任务 | Work Package | runId | startedAt | completedAt | PID | events |
|---|---|---|---|---|---:|---:|
| Active Implementation | `wp_contracts` | `2026-08-31T13-01-27-408Z-73ade06f-ea63-4f18-bb6f-e32f71333a6d` | `2026-08-31T13:01:27.727Z` | `2026-08-31T13:03:32.633Z` | 28144 | 49 |
| Shadow Package Design | `wp_axi` | `2026-08-31T13-01-27-408Z-4cef3245-f658-48b4-9e00-a1f1080371b4` | `2026-08-31T13:01:27.726Z` | `2026-08-31T13:08:25.067Z` | 38696 | 81 |

两项 Runtime 在同一时间窗口内持续产生独立事件，证明并发发生在真实 Codex CLI 进程，不是状态层轮换。

### 18.5 调用规模

`wp_axi` Package Design 的新 Run：

```text
input_tokens: 264,581
cached_input_tokens: 195,328
output_tokens: 8,699
prompt.txt: 约 46.6 KB
task-envelope.json: 约 31.3 KB
```

相对旧基线：

```text
input_tokens: 1,643,658 -> 264,581，下降 83.9%
prompt.txt: 约 97 KB -> 46.6 KB，下降 52.0%
task-envelope.json: 约 81 KB -> 31.3 KB，下降 61.4%
```

单次 Package Design input token 下降至少 80% 的目标已达到。

### 18.6 实跑暴露并修复的问题

`wp_contracts` Implementation Worker 没有猜测未批准的跨 Package ABI。它返回 Design gap，指出多个共享 Bundle 字段缺少精确 Chisel 类型、位宽、嵌套字段和枚举编码，Harness 没有写入 RTL。

该结果暴露出一个调度缺陷。旧合并路径会把报告 Design gap 的 Active assignment 改成第二个 Shadow，同时原 Shadow 仍在工作。修复后：

1. Design gap 释放 Active assignment。
2. Package 保持 `DESIGNING` 和原 blocker。
3. 空闲 Shadow 优先领取该修订任务。
4. schemaVersion 5 校验拒绝重复 persistent role。
5. schemaVersion 5 迁移可以修复旧状态中的重复 role。

修复时 `wp_axi` Worker 仍在运行。迁移保留该合法 Worker，随后结果通过局部门禁正常合并，说明无关状态 revision 增长不会误伤合法并发结果。

## 19. 验收结果与剩余边界

### 19.1 已通过

1. 全量 TypeScript 构建通过。
2. 自动化测试共 78 项，全部通过。
3. Read Manifest 越界、三类依赖 DAG、canonicalization、Patch base hash、Patch target、真实 Fake Runtime 并发、orphan 探测、cancel 状态持久化、重复 role 迁移和 Architecture Rework 回归均有测试覆盖。
4. `dual_issue_demo` 已完成一次真实 Active 与 Shadow 并发运行。
5. 两个 Run 均进入 immutable Run Ledger，并通过各自的 authority、lease、Package revision 和路径门禁。

### 19.2 当前 Demo 门禁

```text
Stage2 revision: 53
workspaceRevision: 36
System Design: revision 10, approved
wp_axi: AWAITING_APPROVAL，等待用户批准 Package Design
wp_contracts: DESIGNING，等待补齐共享 Contract 的精确类型与编码
Active: idle
Shadow B: wp_axi, waiting
```

Harness 当前只展示 `wp_axi` 用户批准门禁，不会越过用户继续实施。

### 19.3 尚未闭合

1. `wp_contracts` 的 Design gap 需要由 Shadow 修订并重新取得用户批准。
2. `wp_axi` 需要用户审阅当前 Package Design。
3. 完成第二次真实 Active/Shadow 轮转后，才能评估长期墙钟收益和单位可靠结果成本。
4. 正式 A/B 对照实验仍在本轮边界外。
5. Package Design 已使用局部 Patch。System Design 的自由文本 Revision Request 仍按完整 Author Proposal 和完整独立 Review 执行。只有在 System Design 修订问题具备稳定结构化 target 后，才能安全复用局部 Patch，Harness 不能从自由文本猜测修改路径。
6. 当前 System Design 和 Package 完成后的独立审查均执行完整 Review。targeted Review 的最小可靠 target 模型尚未定义，不能把局部审查结果等价为完整批准门禁。
