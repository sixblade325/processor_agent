# 双发射 Demo 每小时观察：2026-09-01 02

## 观察窗口

- 时区：Asia/Shanghai
- 窗口：2026-09-01 01:55 至 2026-09-01 02:53
- 目标任务：`执行 Processor Agent 启动流程`
- threadId：`01a0580e-7fc0-7050-858c-cff785f5a6db`
- 当前可观察终端：session `86018`
- 本轮最后核对的目标 turn：`01a05909-fb9c-7e91-b6b5-a72283f433b9`

## 证据基线

| 项目 | 当前值 |
| --- | --- |
| Stage1 | `STAGE1_COMPLETE`，revision 152 |
| Stage2 | `PACKAGE_LOOP`，revision 174 |
| workspaceRevision | `157` |
| 完成进度 | `1/8` |
| Active | 无 |
| Shadow | Slot B，`wp_control`，waiting |
| 当前用户门禁 | `wp_control` Package Design 改变 shared interface，需要修订 System Design |
| 当前活动 Worker | 无 |
| 当前 commit | `cad0a17fe4d776a7ab147590f9257a06784b1802` |
| 工作树修改 | `.assistant/project.yaml`、`design/control.md` |

主要证据：

1. `processor-agent.cmd stage2 status . --json`
2. `processor-agent.cmd stage2 next . --json`
3. `E:\107\dual_issue_demo\.assistant\project.yaml`
4. `E:\107\dual_issue_demo\design\control.md`
5. `E:\107\.runtime\processor_agent\dual_issue_demo\stage2\wp_control\package_design\2026-08-31T17-54-52-010Z-17842476-ceb6-4e4f-b424-6abe221ec3e2\result.json`
6. `E:\107\.runtime\processor_agent\dual_issue_demo\stage2\wp_control\package_design\2026-08-31T18-01-07-064Z-07f2238f-8319-4a69-bcb9-7d109f2b9ece\result.json`
7. `E:\107\.runtime\processor_agent\dual_issue_demo\stage2\wp_control\package_design\2026-08-31T18-06-46-091Z-09744744-c6f4-438a-b102-b2342adc8310\result.json`
8. `E:\107\processor_agent\PRODUCT_PLAN\STAGE2.md`
9. `E:\107\processor_agent\src\stage2\workflow.ts`

目标任务当前 turn 已完成并以 blocked 结束。恢复后的 Codex CLI 主进程仍在终端等待输入，没有 Package Worker、orphaned、interrupted 或 stale run。

## 主任务活动

本窗口内 Stage2 从 revision 166 推进至 revision 174，workspaceRevision 从 149 推进至 157，完成数仍为 1/8。

1. `wp_control` Design run `2026-08-31T17-54-52-010Z-17842476-ceb6-4e4f-b424-6abe221ec3e2` 生成 revision 2，并提出动态 Decision `dr_control_existing_interface_consumers`。
2. 该 Decision 在 revision 168 按推荐结论 `reuse_existing_interfaces` 获得回答。结论要求 Control 只读消费现有 `fetch_icache_cpu`、`memory_dcache_request` 和 `dcache_retire_completion`，不增加 Bundle 字段。
3. `wp_control` revision 3 继续声明 shared interface 消费者集合变化。`advance` 在 revision 171 认领修订动作，随后以 `requires an explicit full-redraft instruction` 失败。
4. 主任务通过精确 Design 入口生成 revision 4。该版本仍要求更新 `design/plan.md` 的 Component interfaceIds、Interface Skeleton、跨 Component 连接和相关 Package 对齐。
5. Harness 正确保持 `wp_control` 为 `AWAITING_APPROVAL`，没有批准越权 Package Design。
6. 主任务连续三次核对正式 Harness 状态，均得到相同结果：`PACKAGE_LOOP` 中没有活动运行，唯一动作是要求 System Design 修订，CLI 没有可执行的升级入口。
7. 主任务最终将目标标记 blocked，并请求授权修改项目 `target/` 下的临时 Harness 副本。

## Stage2 与 Git 变化

本窗口新增检查点：

| Commit | 时间 | 含义 |
| --- | --- | --- |
| `cad0a17` | 2026-09-01 01:54:29 +08:00 | Stage2 revision 165 检查点 |

当前工作树：

```text
 M .assistant/project.yaml
 M design/control.md
```

当前源码仍只有 `wp_contracts` 的四个 Bundle 文件和两个契约测试。`wp_instruction_queue`、`wp_control` 及其他 Package 尚未生成 RTL 或测试。

## 验证结果

1. 本窗口没有新的编译、定向测试、集成测试或 CoreMark 执行证据。
2. 三轮 Control Package Design 均只产生文档草案，没有修改源码和测试。
3. `wp_control` revision 4 的 shared interface 变化被 Package approval 门禁拒绝，正式 System Design 尚未改变。
4. CoreMark 尚未进入实际验收阶段，当前不能判定 baseline 可运行。

## 困难与阻塞

### 1. Package Loop 缺少返回 System Design 的正式入口

当前 Design 缺口属于跨 Package 连接关系：Control 需要成为三个现有接口的只读消费者。字段、生产者、握手协议和 Architecture 均不改变，System Design 的消费者集合和 Component interfaceIds 必须改变。

现有流程形成闭环缺口：

1. `packageDesignIssues` 要求 shared interface 变化先修订 System Design。
2. `stage2 next` 只能返回 `package_design_revision`。
3. `requestSystemDesignRevision` 在 `src/stage2/workflow.ts:733` 拒绝从 `PACKAGE_LOOP` 调用，只允许 `SYSTEM_DESIGN_APPROVAL` 或已经 pending 的修订。
4. `PRODUCT_PLAN/STAGE2.md` 规定进入 `PACKAGE_LOOP` 后不复用待批准草案的 `stage2 revise` 转换，要求使用 Design reopen 或 Architecture Rework。
5. 当前 CLI 只有 Package reopen 和 Architecture Rework，没有已批准 System Design 的 reopen 或 cross-package realign 入口。

### 2. Package Design 反复重生成无法解除全局门禁

Decision 已回答后，Control Design revision 3 和 revision 4 均保留同一 shared interface 变化。继续重生成 Package Design 无法合法修改 `design/plan.md`，因此不会解除门禁。

### 3. `advance` 再次认领不可自动执行的 full-redraft

revision 171 的 `STAGE2_ADVANCE_CLAIMED` 随即在 revision 172 以缺少明确 full-redraft instruction 失败。该行为与此前 `wp_dcache` 暴露的 `PA-S2-OBS-001` 相同，问题持续存在。

### 4. Read Manifest 修复尚未在 Demo 中完成重试

上一窗口已经修复 `PA-S2-OBS-005`，全局 `processor-agent.cmd` 已链接到修复后的产品。`wp_instruction_queue` 仍保留修复前的 Design gap，因为当前 Control 全局门禁阻止了后续调度。尚无修复后 Implementation run 证据。

## 有限干预及结果

本轮没有发送救援消息，没有恢复或复制任务，没有启动 Worker，也没有修改 Processor Agent 产品逻辑。

原因：目标阻塞已经连续三次复现，且没有受支持的 Harness 绕行。解除阻塞需要新增已批准 System Design 从 `PACKAGE_LOOP` 返回修订态的状态转换，并定义审批失效和受影响 Package realign 语义。该修改会改变状态机和审批边界，触发监听规则第 6.e 条，必须等待用户确认。

监听任务没有修改项目临时 Harness，也没有手工编辑 `.assistant/`。

## 产品设计缺陷

### PA-S2-OBS-006：shared interface 缺口没有从 Package Loop 升级到 System Design 的可执行路径

证据：

1. `wp_control` Design revision 4 明确要求更新 System Design 消费者集合。
2. Harness 将其标记为 `Package Design 改变了已批准 shared interface，需要先修订 System Design`。
3. `stage2 next` 仍只返回 Package Design revision。
4. `requestSystemDesignRevision` 明确拒绝 `PACKAGE_LOOP`。
5. 产品计划声明应使用 Design reopen 或 Architecture Rework，CLI 没有适用于已批准 System Design 的 Design reopen。

影响：任何在实现闭合阶段发现的合法 cross-package interface 变化都会停在 Package approval 前。Agent 只能重复生成 Package Design、错误升级到 Stage1 Architecture Rework，或手工修改 Harness 状态。

建议方向：

1. 新增已批准 System Design 的正式 reopen/revise 入口，输入绑定当前 System Design revision、document hash、修订理由和受影响 Work Package。
2. 进入修订前要求没有活动 Worker，冻结 Agent assignment，并保存旧 approval 作为历史证据。
3. 新 System Design 通过独立 Review 和用户批准后，将受影响 Package 标记 `NEEDS_REALIGN`，保留无关已完成 Package。
4. shared interface finding 应直接生成结构化 System Design revision action，停止继续派发 Package full-redraft。
5. 不使用 Architecture Rework 处理仅改变 Component 消费者连接且不改变已批准 Architecture 的问题。

## 分类说明

1. Control 需要复用现有接口属于 System Design 连接缺口，不属于 Stage1 Architecture 错误。
2. Harness 拒绝批准带 shared interface 变化的 Package Design属于正确门禁。
3. 缺少返回 System Design 的合法状态转换属于产品流程缺陷。
4. 主任务请求修改临时 Harness 是阻塞后的绕行建议，尚未获得授权，也未执行。

## 最小修复判断

`PA-S2-OBS-006` 已连续阻止 revision、实现和验证推进，且不存在现有受支持命令绕行。它满足持续阻塞条件。

修复需要改变 `PACKAGE_LOOP`、`SYSTEM_DESIGN_DRAFT`、System Design approval 失效和 Work Package realign 的状态机语义。监听规则禁止在没有用户确认时实施此类修复。本轮保持产品和 Demo 状态不变。

## 下一小时关注点

1. 用户是否确认新增已批准 System Design 的正式 reopen/revise 流程。
2. 确认后应先实现状态转换、审批哈希绑定、受影响 Package realign 和端到端测试，再恢复目标任务。
3. 恢复后验证 Control 的三个只读消费者连接是否进入 `design/plan.md`，并重新闭合受影响 Package。
4. 使用上一窗口修复后的 Read Manifest 重试 `wp_instruction_queue` Implementation。
5. 继续观察历史 queued run 对状态汇总的污染。
6. CoreMark 仍需等待全部 Package 实现和整核验证完成。
