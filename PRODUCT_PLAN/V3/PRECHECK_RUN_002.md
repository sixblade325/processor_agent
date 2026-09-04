# run-002 Skill 产品预检

状态：已完成，run-003 启动门禁通过，等待用户指示  
重分类日期：2026-09-03  
完成日期：2026-09-04  
正式线程：`01a065a6-80d5-73f1-a1dc-326bab0417cb`

## 1. 文档职责

本文记录 `dual_issue_demo_V2` run-002 Skill 运行的用途、证据边界和结束条件。该运行用于在正式 A/B 实验前暴露产品、Skill、环境、工具和实验基础设施缺陷。

## 2. 重分类决定

run-002 最初按 A/B 实验 Skill 组准备。运行中已经发生基础设施修复、多轮人类架构干预、上游故障恢复，并确认冻结 Skill Package 不包含当前增强后的文档组织约束。

从 2026-09-03 23:55 起：

1. run-002 Skill 运行退出正式 A/B 样本集合。
2. 本轮继续运行至任务完成并封存，性质改为产品预检。
3. run-002 Control 组不启动。
4. 本轮结果不得用于 Skill 与 Control 的效能差异结论。
5. 本轮暴露的通用产品缺陷进入 `PRODUCT_PLAN/V3/缺陷/`。
6. 全部已确认产品缺陷修复并验证后，使用新的 run ID、重新冻结的 Skill Package 和干净实验环境重启 A/B。

原始 `RUN_CONFIG.json` 是启动时事实，保持冻结且不回写。运行用途的变更由以下附加证据表达：

```text
E:\107\.runtime\dual_issue_demo_V2\run-002\run-reclassification.json
```

## 3. 预检继续范围

Skill 线程继续完成当前处理器任务，包括：

1. 收敛 Architecture、Design、Source、Verification 一致性。
2. 完成真实顺序双发射实现。
3. 运行公共定向测试、CoreMark 和组织者验收。
4. 记录 IPC、周期、双发射事件、关键组合路径和未验证行为。
5. 保存人类干预、subagent 调度、失败、返工和环境探索证据。
6. 对每个新暴露问题判断其属于产品缺陷、旧版本差异、候选实现错误或外部服务故障。

预检继续沿用原 thread、工作树、隔离 `CODEX_HOME` 和计时 segment。重新分类不授权修改冻结处理器外部行为或 CoreMark 验收输入。

## 4. 文档 Skill 版本偏差

当前线程使用的冻结 `organize-processor-docs` 早于物理模块拓扑增强：

| 文件 | run-002 冻结版本 SHA-256 | 当前产品版本 SHA-256 |
|---|---|---|
| `SKILL.md` | `1802912f4d2c75071ef801c8cec15b11ba81a11c30d0e152b4037cef26ec1861` | `847c6c7789b2c542e58c7f491e03b95753d8833f07a0f2f7b793b7f79c79683b` |
| `references/design.md` | `e30a392dabf4090170872130de2ef0d2b02a7e4dc9a1c1fd78191ea39d63b1be` | `44df2189be8c648f07cd3449db043f48b15de7eca03eef8c653f7a0158949ed7` |

run-002 中 Design 和源码平铺不能用于判定当前增强版文档 Skill 失效。此前 `PA3-DEFECT-006` 的产品缺陷定性已经撤销。

下一版规则应采用以下对应关系：

```text
一个稳定 Design Module authority
  对应一个稳定 RTL module responsibility
  对应一组明确的 sourcePaths
```

该关系约束模块职责和路径集合，不强制一份 Design 文档对应一个源码文件。模块目录按用户建立的稳定处理器拓扑组织，合理偏差需要显式映射和理由。

## 5. 当前有效产品缺陷

以 [V3 产品缺陷索引](缺陷/README.md) 为准。PA3-DEFECT-003、008、009 和 010 已在 run-003 启动前完成现场验收。PA3-DEFECT-005 已由用户排除出本轮修复范围。PA3-DEFECT-002 在首个正式 Skill 会话中完成现场验收。PA3-DEFECT-011 已完成 run-003 隔离修复，通用冻结器留待实验后收敛。

## 6. 预检结束与封存

Skill 主线程已于 2026-09-04 00:57:03 完成，最终 commit 为 `b8c2c2d48269d115329a88e584ca51d3312dbbe3`。公共验收、独立 organizer 与 post-context audit 均通过。完整过程见 [run-002 Skill 产品预检时间线报告](PRECHECK_RUN_002_TIMELINE.md)。封存 manifest 位于 `E:\107\.runtime\dual_issue_demo_V2\run-002\sealed\skill-precheck-manifest.json`。run-002 Control 保持未启动。

预检在以下证据齐备后结束：

1. Skill 主线程进入明确终态。
2. 当前 Git commit、工作树状态和全部未提交文件得到记录。
3. 公共验收与组织者验收结果得到保存，失败时保留首个确定性失败证据。
4. 人类干预、计时 segment、session ordinal 和 subagent 调度记录完整。
5. 执行 Skill 组 post-context audit，并保存 Memory 变化。
6. 建立预检封存 manifest，声明结果不具备 A/B 可比性。
7. Control 组保持未启动。

## 7. 正式 A/B 重启门禁

1. 当前缺陷索引中的全部开放项已修复并通过对应关闭条件。
2. 增强后的文档 Skill 和其他正式 Skill 重新合成、校验并冻结为新 Package。
3. 新 Package manifest、payload hash 和安装 inventory hash 一致。
4. 使用新的 run ID、新的两份 repository checkout 和新的两个 `CODEX_HOME`。
5. 两组从同一空 Memory 快照开始，Memory 读取与生成均经过实际 preflight。
6. Control 全局 Skill 隔离、模型、subagent、Windows 工具链和组织者验收器重新审计。
7. 正式运行期间不进行基础设施修复或不对称的人类设计干预。

上述门禁已完成。最终配置、Memory、两组 pre-audit、独立 organizer 和启动停止点见 [A/B run-003 启动就绪记录](AB_RUN_003_READINESS.md)。
