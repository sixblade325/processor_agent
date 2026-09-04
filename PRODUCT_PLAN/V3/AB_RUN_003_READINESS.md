# A/B run-003 启动就绪记录

状态：启动门禁通过，等待用户指示  
日期：2026-09-04

## 1. 当前结论

run-003 已具备启动条件。Skill 与 Control 正式会话均未启动，正式证据文件均不存在。执行顺序保持 `skill_then_control`，完成 Skill 组封存并取得用户确认后才允许启动 Control。

机器可读门禁位于：

```text
E:\107\.runtime\dual_issue_demo_V2\run-003\evidence\readiness.json
SHA-256: 8aa1da6421d825297dcf926b28b4be4ab45e69ab9c2986ec9e62894f29caeb81
```

## 2. 冻结起点

1. baseline tag：`ab-stage1-baseline-v3`。
2. Skill 与 Control repository HEAD：`268054c1ef67092b1bbba192f6aeb8a35e43e6b1`。
3. 两个 repository 工作树均为空。
4. 最终 `RUN_CONFIG.json` SHA-256：`24a166b80246bd75357d5aa0e2a8688493410bef9ac42f255b65d3afde1e107d`。
5. 设计师模型：`gpt-5.6-sol`，reasoning effort 为 `ultra`。
6. subagent 模型：`gpt-5.6-sol`，reasoning effort 为 `high`。每个主会话最多同时运行 4 个 subagent，总调用次数不设实验上限。
7. 实验不设置 wall-clock、token 或主线程 turn 上限。

## 3. 任务约束

两组 prompt 已逐项表达以下硬要求：

1. 实现顺序双发射处理器，双发射目标不可修改或降级。
2. `Frontend`、`Instruction Queue`、`Backend` 和七级流水作为受保护默认方案。调整前必须取得可复现证据并先写 ADR。
3. 按逻辑拓扑拆分 Design 与实现，禁止形成 `all in one` 核。
4. 固定 Architecture 对外行为、`ExperimentTop` ABI 和两个 CoreMark workload。
5. `external_dual_issue`、performance 和 validation 的 `dualIssueCycles` 必须大于 0。
6. 最终报告必须给出周期、退休数、双发射周期、IPC、关键组合路径、寄存器边界和时序风险。
7. `blocked` 不属于允许终态。任务持续到通过、预算耗尽、基础设施故障或用户终止。

## 4. Memory 与组间隔离

1. seed 线程生成 `memory_summary.md`，SHA-256 为 `8c03ca74639f4e25f1acaa010df1c0b7f50fb80c005e25502034366d1928a639`。
2. 独立 trigger 线程在第一条用户消息前读取了同一摘要。
3. Skill 与 Control 的 `MEMORY.md` 均为空文件，摘要逐字节相同。
4. 两组使用独立 `CODEX_HOME` 和独立 repository，Memory 机制保持启用和可写。
5. Memory bootstrap manifest SHA-256：`9842b7a11b3c186c903e6b9726bfb6c2f6465009bb31e3a43be6da691fcb4969`。
6. Skill pre-audit 与 Control pre-audit 均为 `ok=true`，各自绑定最终 `RUN_CONFIG`。

## 5. Skill 与 Control 条件

1. Skill Package archive SHA-256：`6a5d0ebef5bb5805a7287ccc38ffb6449e8dd7366226fb598498d6c499234fef`。
2. Skill Package installed inventory SHA-256：`8bf88ab251b66cc82a6ea8f6cbfe7a6e36df2ba4afb310cc4e93d0373f77215c`。
3. Skill 组只从其隔离 home 读取该 Package。
4. Control 组对六个 Processor Development Skills 的全局和项目级命中数为零。
5. 公共非产品 Skill inventory SHA-256 为 `3d2412db5bc7142784dc154f3dea904afd5c60d3ea23fae9ad8ebc6faa27758a`，两组一致。

## 6. 独立 organizer 验收

启动前使用独立候选夹具验证完整验收链。候选 commit 为 `2c855723e69b1fa56eb33f76a9f8f921fe83a659`，用途仅为验证基础设施，不进入 A/B 样本。

结果：

1. 13 个外部行为定向用例全部通过，其中 `external_dual_issue` 观察到真实双发射周期。
2. CoreMark performance 通过，IPC 为 `0.338346`。
3. CoreMark validation 通过，IPC 为 `0.337316`。
4. portable verification layer、RTL snapshot、Verilator build、受控 runtime DLL 和加载模块核验全部通过。
5. organizer result SHA-256：`fb4365925bff4df5ac6598c31bfdc0cc844782d13ab708db7317833d11e5aa84`。

结果路径：

```text
E:\107\.runtime\dual_issue_demo_V2\run-003\outputs\organizer-smoke-final-5\results\organizer-result.json
```

## 7. 启动控制

当前不执行 `skill-main`。用户明确下达启动指令后，先重新核验 `readiness.json`、最终 `RUN_CONFIG`、Skill repository HEAD、Skill home 和正式证据目录，再启动 Skill 组计时与会话。

PA3-DEFECT-002 的全新 Agent 会话现场验收将在 Skill 正式会话首次读取中文权威文档时完成。PA3-DEFECT-011 的通用冻结器收敛留在实验后处理，run-003 已使用隔离且验证通过的稳定 PATH 配置。
