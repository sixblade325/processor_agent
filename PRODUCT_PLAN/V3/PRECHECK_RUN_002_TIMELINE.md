# run-002 Skill 产品预检时间线报告

状态：已完成并封存，产品缺陷待修复  
时间范围：2026-09-03 13:03:25 至 2026-09-04 00:57:03  
时区：Asia/Shanghai，UTC+08:00  
正式线程：`01a065a6-80d5-73f1-a1dc-326bab0417cb`  
工作树：`E:\107\dual_issue_demo_V2-skill`  
基线 commit：`02048106e7e0958c4efd674cc609b48eb2f8a1ee`  
最终 commit：`b8c2c2d48269d115329a88e584ca51d3312dbbe3`

## 1. 报告结论

run-002 Skill 主线程在 2026-09-04 00:57:03 进入 `task_complete`，声明状态为 `acceptance_passed`。最终工作树干净，冻结输入检查、编译、3 个测试套件共 10 项测试、公共 CoreMark、公共综合验收和独立 organizer 全部通过。

本轮包含基础设施绕行、多轮人类设计干预、上游 404 恢复，以及运行中识别出的 Skill 版本偏差。结果只作为产品预检证据，`abSampleEligible=false`。run-002 Control 未启动。

主线程先自主生成一体化实现。21:09 起，人类通过 H-001 重建模块拓扑、接口所有权和 Load interlock 语义。23:24 恢复后，主线程按冻结设计调度 subagent 完成模块化实现、回归测试和验收。最后形成 9 个候选提交，共修改 47 个文件，新增 5362 行，删除 25 行。

## 2. 计时摘要

| 区间 | 起止时间 | 计入有效时间 | 状态 |
|---|---|---:|---|
| Segment 1 | 09-03 13:03:25.275 至 14:55:48.036 | 1:52:22.761 | 初始自主实现、公共验收与首次 organizer 尝试 |
| 实验管理暂停 | 09-03 14:55:48.036 至 21:02:48.383 | 0 | 人工暂停，主进程退出 |
| Segment 2 | 09-03 21:02:48.383 至 22:45:11.987 | 1:42:23.604 | 人类主导设计重建，随后转入实现审计 |
| 上游故障暂停 | 09-03 22:45:11.987 至 23:24:04.783 | 0 | Responses 404、恢复尝试和健康检查 |
| Segment 3 | 09-03 23:24:04.783 至 09-04 00:57:03.822 | 1:32:59.039 | 模块化实现、完整回归、基础设施诊断和最终验收 |
| 合计 | 墙钟跨度 11:53:38.547 | 5:07:45.405 | 排除时间 6:45:53.143 |

计时终点采用 session ordinal `5885` 的 `task_complete` 时间。上游故障区间和人工暂停区间均未计入有效时间。

## 3. 主线程活动时间线

| 时间段 | Codex 主线程活动 | 结果与证据 |
|---|---|---|
| 09-03 13:03:25 至 13:05:40 | 读取 `AGENTS.md`、冻结 `RUN_CONFIG`、Architecture、ABI、Verification、CoreMark、任务和协议；核对 Skill Package 与工作树边界。 | 确认顺序双发射、七级流水、固定外部行为和 organizer 为完成门禁。13:04 读取冻结包中的 `organize-processor-docs`、`design-chisel-processor`、`implement-chisel-processor` 等入口。 |
| 13:05:41 至 13:18:28 | 第一轮并行调度 `design_docs`、`harness_audit`、`coremark_analysis`、`heritage_audit`。主线程同时检查构建入口和不可修改输入。 | 建立初始 Design、验收面、CoreMark 执行约束和 V1 遗产映射。此阶段开始暴露 Windows 多词参数传递问题。 |
| 13:18:29 至 13:30:09 | 第二轮并行调度 `rtl_core`、`coremark_runner`、`directed_tests`、`generator`，整合处理器、固定顶层、测试和 CoreMark runner。 | 形成以 `ExperimentTop.scala` 为主体的一体化初版。13:30 前后开始连续编译和测试。 |
| 13:30:10 至 13:47:20 | 修复 Scala 与 Chisel 集成问题，运行 compile、test、固定顶层生成；调度 `rtl_review` 和 `integration_review`。 | 编译与初始定向测试通过。Windows `.cmd` 参数和生成入口需要多次改换调用形式。 |
| 13:47:21 至 14:20:55 | 调度 `coverage_tests`，补齐异常、访存、跳转、双发射、反压和未覆盖 RV32I 用例；同步 Design、Verification 和 `_codex.md`。 | 多轮 compile 与 test 通过。主线程持续修正流水补位、提交轨迹和 Store 副作用检查。 |
| 14:20:56 至 14:36:00 | 执行交付检查和完整测试，提交初版实现与文档。 | 14:33 提交 `31e030d`。14:34 CoreMark 两个 workload 通过，IPC 分别为 `0.340063` 与 `0.338925`。14:36 提交 `7cbaae8`。 |
| 14:36:01 至 14:47:18 | 重跑公共 acceptance，诊断 CoreMark 结果校验偶发读取不到候选 HEAD 的问题。 | 14:38、14:39、14:41 出现模拟器通过后 validator 报 `candidate Git HEAD cannot be read`。14:47 在 `7cbaae8` 上公共 CoreMark 再次通过。 |
| 14:47:19 至 14:55:48 | 启动独立 baseline organizer，处理 Chisel verification layer 文件。 | 14:48 公共 acceptance 与 Final Git state 通过。14:50 organizer 因 3 个相对 include 缺失失败。14:53 提交 `49ee48e`，14:54 organizer 仍因嵌套 include 失败。14:55 编译通过，主进程随后退出。 |
| 14:55:48 至 21:02:48 | 主线程无执行。 | 实验管理侧暂停，计时关闭。 |
| 21:02:48 至 21:09:51 | 原 thread 恢复并等待用户指令。 | 开启 Segment 2，工作树与冻结上下文保持原状。 |
| 21:09:52 至 21:39:28 | H-001 开始。主线程停止源码重构，按用户决定在 Design 中建立 `Frontend`、`Instruction Queue`、`Backend` 三分区；加入 `NPC`、`PC`、`Decoder`、`RegFile`、`Forwarding`、`ALU`、`Branch`，访存逻辑归入 Backend。 | 新建 `Design/MODULE_TOPOLOGY.md`，同步 `README.md`、`OVERVIEW.md`、`PROTOCOLS.md`。期间只改文档，并调度 `topology_doc_review`。 |
| 21:39:29 至 22:00:18 | 固定 IQ 与 Backend 的发射所有权：IQ 持有 `Decoupled.valid/bits`，Backend 驱动 `ready` 并持有 `Issue/RR` 寄存器。主线程补写 fire、dequeue、接受、flush、redirect 和访存反压的周期语义。 | Design 四份文档得到同步。主线程此时提出 Backend 到 IQ 的 source-ready 查询。 |
| 22:00:19 至 22:20:41 | 用户质疑 source-ready。主线程追踪 EX Load、M1 request、data owner、Issue/RR 和 Forwarding 的逐拍关系，并调用 `load_interlock_review`。 | 撤销 source-ready 接口。`Forwarding` 只负责数据选择，Load 未完成约束留在 Backend interlock。允许无依赖年轻 group 在 Load 进入 M1 的边界推进。 |
| 22:20:42 至 22:36:32 | 明确 Lane 1 依赖 Load 时 Lane 0 推进、Lane 1 compact 到 Issue/RR Lane 0；把 `Control` 与 `Retire` 固定为 Backend 内部模块；完成文档复核。 | 用户在 22:36:32 指示主线程自主推进到 task 完成，H-001 关闭。 |
| 22:36:33 至 22:45:11 | 切换到冻结 `implement-chisel-processor`，调度 `verification_surface_audit`，审计单体实现与新 Design 的差异，并运行 compile 与现有测试。 | 实现拆分尚未开始。22:45:11 起多个 review subagent 同时收到 Responses 404。 |
| 22:45:11 至 23:24:04 | 主线程执行两次 `continue` 恢复尝试，第二次 turn 被中止。实验管理侧停止计时，随后运行 ephemeral 健康检查。 | H-002 记录 ordinal `3737`、`3747`、`3756`。23:23 健康检查返回 `UPSTREAM_OK`。 |
| 23:24:04 至 23:28:10 | 同一 thread 由新进程 PID `10408` 恢复，重新核对冻结设计、工作树和待办。 | 开启 Segment 3，thread ID、工作树和隔离 `CODEX_HOME` 保持不变。 |
| 23:28:11 至 23:36:14 | 并行调度 `frontend_impl`、`iq_impl`、`backend_leaf_impl`、`control_retire_impl`。主线程建立共享 `CoreTypes` 并准备 Backend 集成。 | 四个并行任务交付模块草案，主线程开始将一体化逻辑迁移到明确模块。 |
| 23:36:15 至 23:47:48 | 集成 `Frontend`、`InstructionQueue`、Backend 叶子模块、`Control`、`Retire`；连续运行 compile 与 test。 | 23:39 遇到 sbt boot lock 拒绝访问。23:45 定向测试暴露集成错误。23:47 修复后测试通过。 |
| 23:47:49 至 00:05:49 | 调度 `iq_stall_test`、`backend_review`、`io_type_cleanup`、`contract_audit`、两轮 Frontend/IQ review 和 `delivery_audit`；补全接口类型、hold、flush、queue 配对及 `_codex.md`。 | 23:58 编译通过，23:59 两个套件共 4 项测试通过。00:00 交付检查通过。 |
| 00:05:50 至 00:18:39 | 调度 `iq_coverage_expand` 与 `frontend_stale_test`，补齐 IQ 容量、wrap、RAW/WAW、Lane 1 排除、Frontend stale response 和 stalled payload 测试；诊断固定 Windows 入口的参数传递。 | 00:07 至 00:10 连续出现 sbt 参数被拆分和命名管道锁错误。主线程在候选 `.runtime/tooling` 编译进程局部 `sbt-wrapper.exe` 绕行。00:16 固定顶层生成通过。00:18 提交模块化实现 `526c60c`。 |
| 00:18:40 至 00:22:47 | 在模块化候选上运行 CoreMark，整理验证结果。 | 模拟器、定向用例和两个 workload 通过，末端 validator 再次误报候选 HEAD 不可读。00:22 提交验证文档 `5640bd2`。 |
| 00:22:48 至 00:28:57 | 对 `5640bd2` 运行全部公共门禁。 | 交付检查、编译、3 个套件共 10 项测试、CoreMark、acceptance 和 Final Git state 全部通过。00:28 提交 `8dd143e`。 |
| 00:28:58 至 00:37:57 | 复现 validator 偶发失败，重复比较 `git.exe` 入口和 `$LASTEXITCODE`；尝试建立 Git 包装器；启动独立 organizer。 | 正确 HEAD 文本伴随 `LASTEXITCODE=-1`。安全审批拒绝 Git 包装器，源码随即删除且未启用。独立 organizer 报告 30 个 verification include 缺失。主线程改为修正生成器。 |
| 00:37:58 至 00:41:46 | 将生成树内 33 个 verification include 改写为可解析的绝对路径，执行生成 smoke、编译和 10 项测试。 | 33 个 include 全部解析。00:41 提交 `0265c16`。 |
| 00:41:47 至 00:43:30 | 对 `0265c16` 运行独立 organizer。 | Verilator 编译完成，模拟器首次启动返回 `-1073741511`，即 `0xC0000139`。主线程定位到 Git MinGW DLL 位于 MSYS2 UCRT64 runtime 之前。修正本次运行 PATH 后，13 个定向用例和两个 CoreMark workload 全部通过。 |
| 00:43:31 至 00:45:45 | 整理独立 organizer 证据并更新 Verification。 | 00:45 提交 `c5ea846`。 |
| 00:45:46 至 00:50:47 | 在 `c5ea846` 上重跑交付检查、编译、10 项测试、CoreMark、acceptance 和独立 organizer。 | 全部通过，独立结果绑定 `c5ea846`。 |
| 00:50:48 至 00:51:53 | 修正 Verification 报告中最终结果的时态和绑定方式。 | 提交 `b8c2c2d`，该提交成为最终候选。 |
| 00:51:54 至 00:56:27 | 对最终 HEAD 重新运行交付检查、编译、10 项测试、CoreMark、完整 acceptance 和新的空 OutputRoot organizer。 | 所有命令退出码为 0。最终 organizer 结果绑定 `b8c2c2d`。 |
| 00:56:28 至 00:57:03 | 核对工作树、冻结 `RUN_CONFIG` hash、结果路径和最终报告。 | 00:57:03，ordinal `5885` 记录 `task_complete`，线程状态为 `acceptance_passed`。 |

## 4. Subagent 调度时间线

主线程共发起 29 次 subagent 调度，并发上限为 4。主要波次如下：

| 波次 | 时间 | 任务 |
|---|---|---|
| 初始设计与验收理解 | 13:05 至 13:18 | `design_docs`、`harness_audit`、`coremark_analysis`、`heritage_audit` |
| 初始垂直实现 | 13:18 至 13:30 | `rtl_core`、`coremark_runner`、`directed_tests`、`generator` |
| 初始实现复核 | 13:37 至 14:34 | `rtl_review`、`integration_review`、`coverage_tests` |
| 人类主导设计复核 | 21:22 至 22:47 | `topology_doc_review`、`decoupled_boundary_review`、`load_interlock_review`、`verification_surface_audit` |
| 模块化实现 | 23:28 至 23:36 | `frontend_impl`、`iq_impl`、`backend_leaf_impl`、`control_retire_impl` |
| 集成与验证加固 | 23:32 至 00:40 | Frontend/IQ review、Backend review、IO type cleanup、stall 与 stale-response 测试、contract audit、delivery audit、coverage expansion |

22:45 的 404 同时影响多个 review subagent。恢复后，主线程保留已完成结果，并重新调度仍需完成的实现与复核任务。

## 5. 提交时间线

| 时间 | Commit | 内容 |
|---|---|---|
| 09-03 14:33:37 | `31e030d` | 初始顺序双发射 RV32I 一体化实现 |
| 09-03 14:36:00 | `7cbaae8` | 生命周期与验证文档对齐 |
| 09-03 14:53:37 | `49ee48e` | 首次处理 verification layer 自包含问题 |
| 09-04 00:18:39 | `526c60c` | 按三分区和叶子模块拆分处理器流水 |
| 09-04 00:22:47 | `5640bd2` | 记录模块化候选的验证证据 |
| 09-04 00:28:57 | `8dd143e` | 记录公共候选就绪检查 |
| 09-04 00:41:46 | `0265c16` | 使生成的 verification include 可独立解析 |
| 09-04 00:45:45 | `c5ea846` | 记录独立 organizer 通过证据 |
| 09-04 00:51:53 | `b8c2c2d` | 固化最终验收报告表述 |

## 6. 产品缺陷暴露时间线

| 首次或关键时间 | 记录 | 线程现场 |
|---|---|---|
| 13:06 起，00:07 至 00:16 集中复现 | [PA3-DEFECT-004](缺陷/PA3-DEFECT-004-WINDOWS-CMD-ARGUMENT-FORWARDING.md) | Windows `.cmd` 破坏多词 sbt 参数，部分内部错误仍向外返回 0。线程自行构造临时 `sbt-wrapper.exe` 才继续完成门禁。 |
| 22:45:11 | [PA3-DEFECT-005](缺陷/PA3-DEFECT-005-UPSTREAM-404-RUN-RECOVERY.md) | 主线程与多个 subagent 同时收到 Responses 404，人工执行两次失败恢复和一次成功恢复。 |
| 14:38 首现，00:30 完成稳定复现 | [PA3-DEFECT-007](缺陷/PA3-DEFECT-007-POWERSHELL-NATIVE-PIPELINE-EXITCODE.md) | 模拟与结果 JSON 均通过，validator 读取正确 HEAD 后仍因 `$LASTEXITCODE=-1` 判失败。 |
| 00:33 左右 | [PA3-DEFECT-008](缺陷/PA3-DEFECT-008-VALIDATOR-TOOL-SHADOWING-GUARD.md) | 线程试图用候选侧 Git wrapper 稳定完整性查询。安全审批拒绝，未生成或启用包装器。 |
| 14:50 首现，00:34 扩展为 30 个缺失 include | [PA3-DEFECT-009](缺陷/PA3-DEFECT-009-ORGANIZER-VERILATOR-INCLUDE-PATHS.md) | organizer 未向 Verilator 提供 verification layer include 目录。候选生成器承担了本轮临时兼容修正。 |
| 00:42 | [PA3-DEFECT-010](缺陷/PA3-DEFECT-010-ORGANIZER-SIMULATOR-RUNTIME-PATH.md) | 模拟器构建成功，运行时加载到冲突 MinGW DLL，以 `0xC0000139` 退出。 |

运行使用的冻结 `organize-processor-docs` 早于当前物理模块拓扑增强。Design 和源码的平铺形态记录为 [PRECHECK_FINDING_001](PRECHECK_FINDING_001_OLD_DOC_SKILL_SNAPSHOT.md)，不计入当前增强版 Skill 的失效证据。

## 7. 最终处理器与验收结果

最终实现保留 `Frontend`、`Instruction Queue`、`Backend` 三分区和七级流水。`InstructionQueue` 持有 issue `valid/bits`，Backend 持有 `ready`、`Issue/RR`、EX、M1，并安装 `RegFile`、纯组合 `Forwarding`、`ALU`、`Branch`、`Control` 与 `Retire`。Architecture Role、流水边界和冻结对外行为未修改。

| 验收项 | 最终结果 |
|---|---|
| `scripts/check-deliverables.cmd` | PASS，71 个冻结输入文件、15 个 main Scala、4 个 test Scala |
| `scripts/compile.cmd` | PASS |
| `scripts/test.cmd` | PASS，3 suites、10 tests |
| `scripts/coremark.cmd` | PASS，结果绑定 `b8c2c2d` |
| `scripts/acceptance.cmd` | PASS，Final Git state PASS |
| 独立 organizer | PASS，13 个定向用例和 2 个 CoreMark workload |

| Workload | measuredCycles | retiredInstructions | dualIssueCycles | IPC |
|---|---:|---:|---:|---:|
| performance | 2,305,506 | 780,059 | 124,591 | 0.338346115777 |
| validation | 2,471,419 | 833,648 | 133,986 | 0.337315526020 |

最终公共结果：

```text
E:\107\dual_issue_demo_V2-skill\.runtime\coremark\result.json
```

最终独立 organizer 结果：

```text
E:\107\dual_issue_demo_V2-organizer-output-skill-b8c2c2d-final\results\organizer-result.json
```

## 8. 人类干预与上下文审计

人类干预共归档两组：

1. `H-001`：9 条设计干预，冻结模块拓扑、Decoupled 所有权、Load interlock、Lane compact、`Control` 和 `Retire`。
2. `H-002`：3 条 `continue`，用于上游 404 后恢复原 thread。

post-context audit 已通过：

| 项目 | 结果 |
|---|---|
| Memory 功能配置 | `use_memories=true`，`generate_memories=true` |
| `MEMORY.md` | 启动与结束均为空，SHA-256 为 `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855` |
| 辅助 Memory 工作区 | 结束时 29 个文件，inventory SHA-256 为 `fe5f524c12f3c67cb7f5f78814a45fc3f5afc670705f1a5336e1a51dbbd83b5d` |
| Skill inventory | 冻结 Skill inventory 匹配，无意外产品 Skill 副本 |
| 非产品 Skill inventory | 与 preflight 匹配 |

辅助 Memory 工作区生成了 Git 基线、`raw_memories.md` 和 `phase2_workspace_diff.md`。`raw_memories.md` 明确记录没有形成 raw memory，`rollout_summaries/` 为空。

审计证据：

```text
E:\107\.runtime\dual_issue_demo_V2\run-002\evidence\skill-pre-context.json
E:\107\.runtime\dual_issue_demo_V2\run-002\evidence\skill-post-context.json
E:\107\.runtime\dual_issue_demo_V2\run-002\skill\interventions\H-001
E:\107\.runtime\dual_issue_demo_V2\run-002\skill\interventions\H-002
E:\107\.runtime\dual_issue_demo_V2\run-002\skill\monitoring\observations
```

## 9. 证据边界与后续门禁

1. 该运行不进入正式 A/B 数据集。
2. run-002 Control 保持未启动。
3. 正式 A/B 重启前，需要关闭缺陷索引中的全部开放项。
4. 需要重新合成并冻结包含当前文档拓扑约束的 Skill Package。
5. 新实验使用新的 run ID、两份干净工作树和两个新的隔离 `CODEX_HOME`。
6. 新实验不得复用本轮候选实现、Memory、线程上下文、人工设计决定或临时工具绕行。

## 10. 原始时间线依据

主 session：

```text
E:\107\.runtime\dual_issue_demo_V2\run-002\skill\codex-home\sessions\2026\09\03\rollout-2026-09-03T13-03-25-01a065a6-80d5-73f1-a1dc-326bab0417cb.jsonl
lastOrdinal=5885
taskCompleteAt=2026-09-03T16:57:03.822Z
```

时间线以 session 事件、Windows 进程时间、Git commit 时间、验收结果 JSON、监控观察和干预归档交叉核对。秒级时间用于任务边界和计时 segment，逻辑工作段按相邻工具调用、subagent 调度、文件变更和提交合并。
