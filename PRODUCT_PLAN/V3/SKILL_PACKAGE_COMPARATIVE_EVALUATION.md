# Skill Package 对照评测方案

状态：当前评测基线  
日期：2026-09-03

## 1. 文档职责

本文定义 Processor Development Skill Package 的 A/B 实验，用于评估 Skill Package 对 Codex 处理器工程团队完成效果、实现带宽和设计质量的影响。

本文服从 [V3 产品计划](PRODUCT_PLAN.md)。实验复用 [V1 Stage1](../V1/STAGE1.md) 的处理器目标与内部 Architecture 作为相同起点，不复用 V1 Harness、状态机和运行状态。

该实验属于实验资产，不构成产品安装或基础功能验收条件。边界见 [可运行产品与实验资产边界](RUNNABLE_PRODUCT_AND_EXPERIMENT_BOUNDARY.md)。

## 2. 核心假设

在相同起点、处理器对外行为、CoreMark workload、模型、工具和执行预算下，使用 Processor Development Skill Package 的 Codex 团队应当表现出：

1. 更高的正确完成率。
2. 更完整的 Architecture、Design、Source、Test 和 Evidence 闭环。
3. 更少的无效探索和返工。
4. 更少的重复环境、脚本和日志处理。
5. 更高的单位时间或单位 token 有效完成量。

一次成对运行用于作品演示。效能结论需要重复运行或多个固定任务支持。

## 3. 实验对象

```text
相同 V1 Stage1 技术遗产与 Git baseline
              │
      ┌───────┴───────┐
      │               │
      ▼               ▼
 Control Team     Skill Team
 禁用产品 Skills   使用冻结 Skill Package
      │               │
      └───────┬───────┘
              ▼
 相同外部行为与 CoreMark 独立验收和匿名盲审
```

两个主线程均承担处理器设计师和实现负责人职责。它们可以修改 Design、Source 和 Verification，也可以在相同上限内调度 subagent。顺序双发射是共同且不可降级的处理器目标。V1 模块 Role 与七级流水是受保护的默认 Architecture，只有满足本方案规定的变更证据门禁后才允许调整。

## 4. 公共起点与硬边界

实验开始前，将 V1 Stage1 遗产整理为人类可读的：

1. 处理器对外行为契约。
2. 内部 Architecture 起始方案。
3. 空 Design 入口。
4. Verification 起始参考。
5. Chisel 构建骨架。
6. CoreMark upstream、RV32I port、两个 image 和 manifests。
7. 固定 `ExperimentTop` 外部验收 ABI 与组织者验收器。

两个团队可以在相同门禁下独立完善内部 Architecture 与 Verification。共同且不可修改的技术硬边界包括：

1. 程序可见 RV32I 行为。
2. 实验环境需要连接的外部存储器、终止语义与固定 `ExperimentTop` ABI。
3. 冻结 CoreMark workload 及其通过条件。
4. 顺序双发射处理器目标。实现必须具有两条同拍 Issue 路径，并在固定定向用例和两个 CoreMark workload 中产生可观察的双发射事件。
5. 固定性能观察语义。两个团队必须报告相同 workload 下的周期数、退休指令数、双发射周期数与 IPC。

V1 的 Frontend、Instruction Queue、Backend 等模块 Role 和七级流水属于受保护的默认方案。团队应先按该方案完成垂直闭环。只有以下任一条件具有可复现证据时，才允许修改模块 Role 或流水边界：

1. 当前边界直接导致固定验收无法满足，失败已经定位到具体状态、组合路径、协议环或周期矛盾。
2. 候选调整在保持双发射目标和程序语义的前提下，对 IPC、关键时序路径、面积或验证闭合具有明确优势。

实现便利、减少代码量、缩短首次通过时间和规避双发射相关状态空间均不构成变更证据。变更前必须写 ADR，记录失败或比较证据、备选方案、最小修改范围、时序与 IPC 影响及回归条件。

非对称 Lane、配对限制、single owner、内部字段和定向测试属于可演化实现选择。相关修改仍需保持模块 Role、流水边界、双发射目标和文档一致性，或满足上述 Architecture 变更门禁。

以下 V1 机制不进入实验输入：

1. `.assistant/` 状态。
2. Stage 状态机。
3. Profile 和 Schema。
4. Decision Packet、Work Package 和 Package DAG。
5. Harness Task Envelope、Approval hash 和迁移状态。
6. V1 Agent 运行记录、建议缓存和历史输出。

## 5. 实验组

### 5.1 Control Team

Control Team 获得公共仓库、统一任务、通用 Codex 能力、公共 memory 快照和冻结运行配置。

主线程和全部 subagent 禁止发现、读取、引用或调用本产品 Skill 的任何副本。禁令覆盖 Codex 全局目录、用户目录、仓库目录、admin 目录、插件缓存和其他可发现路径。

### 5.2 Skill Team

Skill Team 获得 Control Team 的全部输入，并可使用冻结版本的完整 Processor Development Skill Package。Skill Team 不获得额外项目事实、测试答案、预算或人工提示。

### 5.3 独立评估者

独立评估者在两个团队结束后工作。评估者只读取匿名结果、不可修改的对外行为、CoreMark 验收材料和固定 Rubric，不读取组别、会话过程和运行顺序。

## 6. 固定变量

| 变量 | 固定要求 |
|---|---|
| Baseline | 相同 Git commit 和 tracked file hash |
| Architecture 目标 | 相同且不可降级的顺序双发射目标 |
| 模块与流水 | 相同受保护默认方案，只能依据固定证据门禁调整 |
| 对外行为 | 相同且不可修改的契约与固定 `ExperimentTop` ABI |
| CoreMark | 相同 upstream、port、images、manifests 和组织者验收器 |
| 任务 | 除 Skill 权限附录外完全相同 |
| Codex | 相同版本、模型、推理设置和通用配置 |
| Memory | 同一份空快照的独立可写副本，读取与生成同时启用 |
| 工具链 | 相同纯 Windows 工具、版本和环境变量 |
| 权限 | 相同项目读写范围 |
| subagent | 相同模型、推理设置、数量和并发上限 |
| 预算 | 相同 wall time、token 和主线程轮次上限 |
| 网络 | 相同访问策略 |
| Rubric | 相同盲审维度与证据要求 |
| 运行方式 | 串行，顺序在首次运行前冻结 |

Skill 文件及其必要上下文属于实验处理变量，其 token 和加载时间计入 Skill Team 总消耗。

## 7. 隔离要求

1. 两个团队从同一 baseline tag 创建独立本地 repository checkout 和 branch，不共享 Git object database 或 remote。
2. 两个团队使用全新 Codex 会话和独立 `CODEX_HOME`，可以使用同一 Windows identity。
3. 工作树、运行目录、日志目录和结果目录完全分离。
4. 两个团队不能读取彼此的 branch、diff、日志、memory、会话和生成物。
5. 两个 home 在第一组启动前完成准备。
6. 两组从同一份空 `MEMORY.md` 的独立可写副本启动。
7. 其他起始 memory 输入同时缺失或逐字节相同，memory 读取与生成同时开启。
8. Control 有效 Skill 清单不包含本产品 Skill，提示词继续禁止从文件系统读取本产品 Skill。
9. Skill Team 只能加载冻结 Package 版本。
10. 两组串行运行，第一组结果密封后再启动第二组。
11. 固定验收 ABI、CoreMark 输入与独立验收器在实验开始前冻结。
12. Windows identity 只作为环境溯源记录。组织者通过干净 baseline tag、不可修改输入 manifest 和候选执行前后 hash 校验保护验收依据。

## 8. 设计权限

两个团队分别拥有本组 Design、Source、Verification 和受约束 Architecture 的决定权。决定记录在各自结果树，不提供给另一组。

团队可以：

1. 在保持双发射能力的前提下调整配对、forwarding、hold、kill、Queue 和状态所有权细节。
2. 增加完成 CoreMark 所需的内部状态、Cache 和适配层。
3. 增删内部定向测试、断言和周期期望，同时保留共同验收门禁。
4. 选择自己的实现与调试顺序。
5. 在取得规定证据并先写 ADR 后调整模块 Role 或流水边界。

团队不能：

1. 修改处理器对外行为契约。
2. 修改固定 `ExperimentTop` ABI 或组织者验收器。
3. 修改或替换冻结 CoreMark upstream、port、image 和 manifest。
4. 跳过候选处理器上的 CoreMark 实际仿真。
5. 在运行中获得另一组 Architecture 决定或实现信息。
6. 将处理器改成单发射、逐条多周期执行或仅保留双指令取指外观的串行内核。
7. 以简化实现或更快通过功能验收为理由删除双发射路径。

实验组织者在运行中不提供新的处理器设计决定。公共输入存在真实矛盾时，成对运行记录为 `experiment_invalid`。团队仍提交当前结果，不使用 `blocked`。

## 9. 实验流程

正式成对运行前先执行一次仅含 Skill 组的产品预检。预检用于暴露 Skill 快照、环境、Memory、命令入口、上游恢复和验收基础设施问题，其结果不进入 A/B 样本。预检发现的通用产品缺陷全部关闭并重新冻结 Package 后，才创建新的正式 A/B run。

`run-002` 已在运行中重分类为产品预检，Control 组不启动。该决定与证据边界见 [run-002 Skill 产品预检](PRECHECK_RUN_002.md)。

`run-003` 已完成 Memory、组间隔离、最终配置、两组 pre-audit 和独立 organizer 启动门禁，当前等待用户下达 Skill 组启动指令。冻结身份与证据见 [A/B run-003 启动就绪记录](AB_RUN_003_READINESS.md)。

1. 整理公共起点并建立 baseline commit 与 tag。
2. 校验 CoreMark upstream、port 和两个 RV32I image。
3. 冻结模型、预算、网络、subagent、工具链和独立验收器。
4. 建立公共空 `MEMORY.md`，并创建两个独立可写副本。
5. 本次运行冻结为 `skill_then_control`。
6. 创建两个隔离 repository checkout、branch 和 Codex home，移除 remote，记录共享 Windows identity。
7. 执行环境、Skill 可见性、memory 和 baseline 审计。
8. 启动第一组并在结束后提交、记录、密封结果。
9. 重新审计第二组起点与上下文，随后启动第二组。
10. 两组均以 CoreMark 通过、预算耗尽或用户明确终止为停止条件。
11. 匿名化两个结果 commit。
12. 使用组织者持有的相同验收器构建候选 `ExperimentTop`，检查外部行为并运行两个 CoreMark image。
13. 独立评估者执行盲审。
14. 汇总质量、效率、成本、返工和顺序效应。

`blocked` 不是允许的团队终态。预算耗尽统一记为 `acceptance_failed`，并保留当前可执行结果和首个失败证据。

## 10. 完整工程任务

```text
读取双发射硬目标、对外契约与起始 Architecture
→ 按受保护模块与七级流水建立垂直闭环
→ 建立 Design
→ 闭合接口、状态和 Lifecycle
→ 实现 Chisel RTL
→ 建立纯 Windows 仿真
→ 运行冻结 CoreMark
→ 修复首个程序可见偏差
→ 取得双发射、IPC 与关键时序路径证据
→ Review Architecture、Design、Source、Test 和 Evidence
→ 提交可追踪结果
```

任务要求两个 CoreMark image 均在候选处理器上执行到 ECALL，并通过 upstream 内部校验与结果签名检查。静态解析、软件 reference model、预写签名和成功文本不能替代处理器仿真。

## 11. 评测指标

### 11.1 正确性

1. 对外行为契约是否保持。
2. CoreMark performance image 是否通过。
3. CoreMark validation image 是否通过。
4. 是否出现非法指令、非预期 trap、内存越界、CRC 或签名错误。
5. 是否伪造或绕过验收。

### 11.2 双发射、IPC 与时序

1. 固定双发射定向用例是否观察到两条合格指令同拍进入 Execute。
2. `performance` 与 `validation` 是否各自具有正数双发射周期。
3. 每个 workload 的周期数、退休指令数、双发射周期数和 `IPC = retiredInstructions / measuredCycles` 是否完整可追踪。
4. 关键组合路径是否绑定生成 RTL、Chisel 来源、起点、终点和逻辑层级。
5. 模块或流水调整是否同时说明 IPC 收益、时序影响、面积与验证代价。
6. 在功能正确且均保持双发射的候选之间，IPC 与时序是主要比较指标。

### 11.3 Architecture 与 Design 质量

1. 当前 Architecture 是否自洽。
2. Design 是否表达实现依赖的接口、状态、周期和异常语义。
3. 状态所有权、程序年龄和副作用是否闭合。
4. 关键变化是否具有证据、取舍和迁移记录。
5. Architecture、Design、Source 和 Verification 是否一致。

### 11.4 验证与工程质量

1. 团队选择的测试能否发现当前设计的关键反例。
2. 删除或放宽的验证是否明确披露风险。
3. RTL 是否存在重复状态、不必要通路和维护风险。
4. CoreMark 失败是否能定位到首个 PC、instruction、访存或 trap 偏差。
5. 新会话能否继续维护项目。

### 11.5 实现带宽和成本

1. 预算内通过 CoreMark 的状态。
2. 首次 CoreMark 通过时间。
3. token 总量与单位 token 有效完成量。
4. subagent 调用次数。
5. 无效工具调用、编译失败和 CoreMark 失败次数。
6. 重复修改同一区域次数。
7. 用于环境、脚本和日志探索的时间比例。

核心衡量值为固定资源预算内通过 CoreMark 且保持对外行为的工程完成量。

## 12. 独立验收

组织者从干净 baseline tag 取回不可修改的对外行为契约、固定 `ExperimentTop` ABI、CoreMark manifests 和验收器，对两个匿名结果依次执行：

```powershell
.\Experiment\organizer-harness\run.cmd -CandidateRoot <candidate-worktree> -OutputRoot <fresh-organizer-output>
```

验收至少检查：

1. 不可修改文件 hash。
2. workload image hash。
3. 固定顶层生成、候选处理器和仿真器构建。
4. request 稳定性、trap、x0、JALR、access fault 以及 CoreMark image 未覆盖 RV32I 指令的定向边界。
5. 两个 image 的真实执行。
6. 外部存储器事务、ECALL cause 11 和结果签名。
7. 超时、异常和首个失败证据。
8. 固定双发射用例和两个 CoreMark workload 的双发射计数均为正数。
9. 每个 workload 的退休指令数、周期数和 IPC 可以从组织者结果复算。

团队自己的 Verification 和公开测试结果作为盲审输入。它们不改变共同 CoreMark 门禁。

## 13. 盲审 Rubric

| 维度 | 主要问题 |
|---|---|
| 对外正确性 | 是否保持 RV32I、存储器和终止语义并通过 CoreMark |
| 双发射与性能 | 是否保持真实双发射，并在相同 workload 下取得可复算的 IPC 与周期证据 |
| 时序 | 关键路径证据是否可信，Architecture 变化是否改善或保护目标时序 |
| Architecture 质量 | 当前内部方案是否闭合且有证据支撑 |
| Design 闭合 | 接口、周期、状态、所有权和异常路径是否完整 |
| 验证充分性 | 团队选择的测试能否检查当前设计关键不变量 |
| 可维护性 | 新工程师能否理解和继续修改 |
| 证据质量 | 结论能否追踪到文件、命令和运行结果 |
| 完成度 | 是否形成可运行的完整处理器工程 |

满足变更证据门禁的内部 Architecture 调整不直接扣分。未获证据支持的模块或流水变更、双发射降级、文档与实现冲突、外部行为偏差和伪造证据形成 Finding。单发射候选直接判定共同目标失败。

## 14. 结果解释边界

1. 单次 A/B 结果适合作为作品演示和案例证据。
2. Skill 效能结论至少需要多个固定任务或重复运行支持。
3. Agent 输出具有随机性，报告必须包含资源预算和运行配置。
4. CoreMark 通过只证明冻结 workload 覆盖的程序行为。
5. 两组可以在证据门禁内选择不同实现，应比较正确性、双发射、IPC、时序、闭合度、维护成本和完成速度。
6. Skill Team 的额外上下文和 token 成本计入比较。
7. 串行顺序可能影响结果。报告披露顺序，重复实验采用交替或预先随机顺序。

## 15. 实验产物

```text
experiment-brief.md
baseline-manifest.json
control-result/
skill-result/
acceptance-results/
blind-review/
comparison-report.md
```

`baseline-manifest.json` 至少记录 baseline commit、对外行为 hash、CoreMark manifests 与 image hash、工具链、Codex 配置、memory hash、资源预算、subagent 上限、Control Skill 隔离证据和 Skill Package hash。

## 16. 验收标准

1. 两个团队从同一 baseline 和 memory 快照开始。
2. 除 Skill Package 外的实验条件一致。
3. Control 无法发现、读取或调用本产品 Skill。
4. Skill Team 只使用冻结 Package。
5. 两组串行运行且相互不可见。
6. 两组在相同门禁内修改内部 Architecture 和 Verification，双发射目标保持不变。
7. 对外行为、固定验收 ABI 与 CoreMark 输入保持不可修改。
8. 两组输出形成独立 commit。
9. 相同外部行为与 CoreMark 独立验收器在两个 commit 上执行。
10. 最终结果经过匿名盲审。
11. 报告包含正确性、设计质量、完成度、成本和污染检查。

## 17. 一句话定义

> 从同一个 Stage1 技术遗产、顺序双发射硬目标和不可修改的处理器对外行为出发，让两个具备相同资源的 Codex 工程团队分别在禁用和启用 Skill Package 的条件下完成处理器，以冻结 CoreMark workload、双发射事件、IPC、时序证据、独立盲审和工程记录衡量 Skill 对完成效果与实现带宽的影响。
