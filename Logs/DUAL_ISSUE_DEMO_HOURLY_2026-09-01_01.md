# 双发射 Demo 每小时观察：2026-09-01 01

## 观察窗口

- 时区：Asia/Shanghai
- 窗口：2026-09-01 00:53 至 2026-09-01 01:55
- 目标任务：`执行 Processor Agent 启动流程`
- threadId：`01a0580e-7fc0-7050-858c-cff785f5a6db`
- 当前可观察终端：session `86018`
- 本轮最后核对的目标 turn：`01a05897-db4b-7762-b233-4eb18c715bee`

## 证据基线

| 项目 | 当前值 |
| --- | --- |
| Stage2 状态 | `PACKAGE_LOOP` |
| Stage2 revision | `166` |
| workspaceRevision | `149` |
| 完成进度 | `1/8` |
| Active | 空闲，`wp_instruction_queue` Implementation 已返回 Harness 缺口 |
| Shadow | `wp_control`，Design Worker 运行中 |
| 当前 commit | `fc3cc1a98cadea2a3967b1ada8aada2a6e0608e5` |
| 工作树修改 | `.assistant/project.yaml`、`design/instruction_queue.md`、`design/control.md` |

主要证据：

1. `processor-agent.cmd stage2 status . --json`
2. `processor-agent.cmd stage2 next . --json`
3. `E:\107\dual_issue_demo\.assistant\project.yaml`
4. `E:\107\.runtime\processor_agent\dual_issue_demo\stage2\wp_control\package_design\2026-08-31T17-37-46-534Z-b7e41cf2-236a-47f7-a567-fcaa3c040a76`
5. `E:\107\.runtime\processor_agent\dual_issue_demo\stage2\wp_control\package_implementation\2026-08-31T17-43-25-899Z-efcd215c-2555-4a02-ba4e-56f59c06b4fc\result.json`
6. `E:\107\.runtime\processor_agent\dual_issue_demo\stage2\wp_instruction_queue\package_design\2026-08-31T17-43-25-897Z-b97dda12-181a-404c-9627-6c19e6d9dce5\result.json`

桌面任务元数据显示 `notLoaded`，最近 turn 仍标记 `interrupted`。恢复后的 Codex CLI、主进程和当前两个 Worker 均有活动证据。本轮以终端、进程和磁盘状态为准，没有重复恢复会话。

## 主任务活动

本窗口内 Stage2 从 revision 146 推进至 revision 166，workspaceRevision 从 129 推进至 149，完成数仍为 1/8。

1. `wp_control` 的第二、第三和第四次 Package Design 运行均以 `Stage2 Agent produced no events for 600000 ms` 失败。
2. 第四次运行已禁止 Worker 调用读取和搜索工具，仍停在结构化结果生成阶段，说明工具调用并非该轮失败的必要条件。
3. 主任务在 `E:\107\dual_issue_demo\target\processor-agent-timeout` 创建忽略版本控制的临时 Processor Agent 副本，把无事件阈值从 10 分钟提高到 20 分钟，保留 30 分钟硬 deadline。
4. 第五次 `wp_control` Design run `2026-08-31T17-37-46-534Z-b7e41cf2-236a-47f7-a567-fcaa3c040a76` 在约 5 分钟后成功应用，生成 `design/control.md`，随后获得批准。
5. `wp_control` Implementation run `2026-08-31T17-43-25-899Z-efcd215c-2555-4a02-ba4e-56f59c06b4fc` 完成分析且未修改文件。Worker 给出可复现 Design 缺口：冻结的 `ControlCandidates` 无法区分 ICache 与 DCache、已持有请求与新请求、stale drain 进行中与完全空闲，也没有九个流水边界的拍初 valid、ready 和年龄资格。
6. `wp_instruction_queue` 新 Design run 已应用并获得批准。当前新的 Implementation Worker 正在运行。
7. Harness 已同时派发新的 `wp_control` Design 修订和 `wp_instruction_queue` 实现。`wp_instruction_queue` Implementation 于 01:50 返回，三个允许实现路径全部不在 read manifest 中，因此没有形成文件提案。`wp_control` Design Worker 仍在运行。
8. `wp_control` 修订 run `2026-08-31T17-48-30-443Z-a27a76e1-f036-4646-85a3-cd062da77e89` 返回了不存在的 Work Package ID `wp_axi_aributer`，Harness 以 validation failure 拒绝应用。主任务随后重新派发当前 run `2026-08-31T17-54-52-010Z-17842476-ceb6-4e4f-b424-6abe221ec3e2`。

## Stage2 与 Git 变化

本窗口新增检查点：

| Commit | 时间 | 含义 |
| --- | --- | --- |
| `fc3cc1a` | 2026-09-01 01:25:48 +08:00 | Stage2 revision 150 检查点 |

当前工作树：

```text
 M .assistant/project.yaml
 M design/instruction_queue.md
?? design/control.md
```

当前运行：

| Work Package | 任务 | runId | 状态 | 最近事件 |
| --- | --- | --- | --- | --- |
| `wp_instruction_queue` | implementation | `2026-08-31T17-48-30-444Z-59b60c5e-7db7-42e8-aff3-53cd46cc062d` | applied，未产生文件 | 2026-09-01 01:50:25 +08:00 |
| `wp_control` | design | `2026-08-31T17-54-52-010Z-17842476-ceb6-4e4f-b424-6abe221ec3e2` | running | 2026-09-01 01:55:07 +08:00 |

两项运行均使用 20 分钟无事件阈值和 30 分钟硬 deadline。

## 验证结果

1. 本窗口没有新的编译、定向测试、集成测试或 CoreMark 完整执行证据。
2. `wp_control` Implementation Worker 没有提交源码和测试，按 Design 缺口结束。
3. `wp_instruction_queue` Implementation Worker 没有提交源码和测试。其 read manifest 的 `allowedRoots` 为空，三个实现路径均返回 `file_not_allowed` 或 `directory_not_allowed`。
4. CoreMark 尚未进入实际验收阶段。
5. Harness 正确拒绝了引用未知 Work Package `wp_axi_aributer` 的 Control Design，没有污染正式 Design。

## 困难与阻塞

### 1. Control Design Worker 连续无事件超时

`wp_control` 连续四次 Design 运行失败。前两次和第三次包含较多项目读取，第四次禁止工具调用后仍在结构化输出阶段失败。临时副本延长阈值后，第五次运行成功，当前阻塞已解除。

### 2. Control Design 已批准后证明不可实现

Implementation Worker 给出的同值反例表明，当前输入编码无法确定资源身份和持续状态：

1. 相同的 `cacheRequestEvent=1` 既可以表示应保留的较老 DCache 请求，也可以表示 redirect 后应禁止的年轻 ICache 请求。
2. 相同的 `icacheStaleDone=0` 既可以表示 stale drain 尚未完成，也可以表示 ICache 完全空闲。
3. `StageControl` 要求分别输出九个边界的 `fire`、`hold` 和 `kill`，输入没有提供各边界的资格条件。

该缺口需要修订 Package Design 或共享 contracts。当前新 Design Worker正在处理。

### 3. Instruction Queue 继续处于 Design 与 Implementation 循环

`wp_instruction_queue` 已再次生成并批准 Design。当前 Implementation Worker 将验证新版本是否真正闭合此前的 DCache completion 与退休 forwarding 可观测性问题。

### 4. 历史 queued run 继续污染 `runs_in_progress`

以下两个历史 run 仍出现在当前 `readyActions`：

- `2026-08-31T13-47-27-309Z-e6e80860-7d6f-404d-87a6-923a9fafe559`
- `2026-08-31T14-44-48-926Z-a88787f5-e27c-4f81-bd30-31db951b7ef4`

它们没有对应活动进程，持续问题 `PA-S2-OBS-003` 尚未解决。

### 5. Implementation Worker 无法读取自己获准修改的路径

当前 `wp_instruction_queue` Implementation Task Envelope 把三个源码和测试路径列入 `allowedPaths`，read manifest 没有把这些尚不存在文件的父目录列入 `allowedRoots`。Worker 无法判定文件存在性，也无法提供正确的 `baseSha256`。

相同事实已在上一轮 `wp_instruction_queue` Implementation run `2026-08-31T16-30-40-557Z-b63952a2-4bbf-4ed8-8f2f-9b8cabd3c8da` 中出现。本轮该问题成为唯一直接阻断原因。

### 6. Control 修订输出引用错误 Work Package ID

一次 Control Design 修订输出引用 `wp_axi_aributer`，正式 Work Package ID 为 `wp_axi`。Harness validator 在应用前拒绝结果，主任务已重新派发。该事件当前归类为单次 Agent 输出错误，Harness 门禁工作正常，不计为新的产品缺陷。

## 有限干预及结果

主任务自行执行了超时临时绕行：复制已安装的 Processor Agent 到项目 `target/`，仅在临时副本中把 Design Worker 无事件阈值提高到 20 分钟。第五次 `wp_control` Design 成功，证明该绕行在本轮有效。

01:50 后 `wp_instruction_queue` Implementation 第二次暴露相同 Read Manifest 缺口，且本次没有其他 Design blocker。监听任务按新规则完成一次 Harness 最小修复：

1. 修改 `E:\107\processor_agent\src\stage2\read-manifest.ts`，不再删除尚未创建的规划 source/test 父目录。
2. 修改 `E:\107\processor_agent\tests\stage2.test.ts`，覆盖绿色项目首次 Implementation 时 `src/main/scala/demo` 和 `src/test/scala/demo` 尚不存在的情况。
3. 执行 `npm run build`，结果通过。
4. 执行 `node --test dist/tests/stage2.test.js dist/tests/stage2-workspace.test.js`，共 42 项测试通过，0 项失败。
5. 执行 `npm link`，全局 `processor-agent.cmd` 已链接至 `E:\107\processor_agent`。
6. 尝试向目标任务发送恢复指令，要求当前 Control run 完成后使用正式入口重试 IQ Implementation。发送被 Codex 拒绝，原因是目标任务已有 active writer。本轮没有重复发送，也没有中断当前 Worker。

## 产品设计缺陷

### PA-S2-OBS-002：Package Design 缺少接口可观测性校验与升级机制，新增 Control 证据

`wp_control` Design 通过生成和批准后，Implementation Worker 才证明冻结输入无法区分必须产生不同控制结果的系统状态。该模式与 `wp_instruction_queue` 的多轮失败相同。

影响：Package 可以在关键输入信息不足时获得批准，随后由 Implementation Worker承担发现不可实现性的成本，工作流反复消耗 Design 和 Implementation run。

建议方向：

1. Package Design 提交前校验每个输出义务所需的输入可达性、资源身份、持续状态和周期资格。
2. Worker 必须为优先级规则生成至少一组可区分性反例检查。
3. 缺口涉及共享输入或跨 Package owner 时，直接升级到 System Design 或 contracts 修订。
4. Package approval 拒绝存在同输入、不同预期输出反例的 Design。

### PA-S2-OBS-003：运行状态缺少 runtime 终态和活动态自动对账，持续存在

两个历史 queued run 继续出现在 `runs_in_progress`。本窗口第五次 Control Design 运行期间还短暂出现 runtime 为 `running`、项目状态仍为 `queued`、`next` 仍返回 `package_design` 的不一致窗口。

影响：可能重复派发同一 Package，历史记录也可能在真实 Worker 完成后阻止机器动作。

建议方向：每次 `status`、`next` 和 dispatch 前对账 runtime 状态、进程存活和更新 run，旧 queued run 应标记为 `superseded`。

### PA-S2-OBS-004：无事件计时把 stderr 诊断当作有效进展

四次 Control Design 失败期间，Codex CLI 周期性输出模型信息刷新错误。Harness 对任意 stdout 或 stderr 数据刷新 `lastEventAt`，错误日志会延后 10 分钟无事件判定。第三次运行因此持续约 24 分钟才结束。

影响：Worker 已无设计进展时仍被视为活跃。相同任务连续重试会形成长时间活锁。

建议方向：

1. 区分协议进展事件、模型内容事件和 stderr 诊断。
2. 仅让可证明任务推进的事件刷新无进展计时器。
3. 对相同 task、输入哈希和错误指纹设置有界重试与升级策略。
4. 保留独立 wall-clock deadline，超时报告中列出最后一次有效进展和最后一次诊断输出。

### PA-S2-OBS-005：Implementation 的写权限路径没有同步进入读权限范围

证据：`wp_instruction_queue` 的 `allowedPaths` 包含 `InstructionQueue.scala` 和两个测试文件。`buildStage2ReadManifest` 只保留当前已存在的父目录。绿色项目中这些目录和文件尚未创建，最终 `allowedRoots=[]`，三个路径全部被 Project Reader 拒绝。

影响：Worker 获得创建源码的写权限后仍无法核验目标文件是否存在。它无法选择 `baseSha256=null` 或当前文件哈希，所有绿色实现 Package 都可能在首次实现时无条件阻塞。

建议的最小修复：

1. Package implementation、static review 和 verification 的 read manifest 保留规划允许路径的父目录，即使目录尚不存在。
2. Project Reader 继续执行项目根边界和 excluded roots 检查。
3. 为尚不存在的 source/test 目录增加回归测试，确认 Task Envelope 的 `allowedRoots` 包含规划父目录。

## 最小修复判断

`PA-S2-OBS-004` 已满足重复失败证据条件。主任务的临时绕行已成功完成第五次 Control Design，当前超时问题没有继续阻塞，因此本轮不修改该逻辑。

`PA-S2-OBS-005` 已在同一 Package 的两个 Implementation run 中重复出现，当前 run 明确以该单一原因结束，现有 Harness 没有可用命令绕行。它满足监听规则的最小修复条件。本轮已实施 read manifest 最小修复，只修改 `src/stage2/read-manifest.ts` 和对应测试，不改变 Schema、状态机、审批边界或用户项目事实。构建和 42 项 Stage2 测试通过。全局运行入口已更新，目标任务尚未完成修复后的 IQ Implementation 重试。

若相同超时在当前或下一 Worker 再次形成持续阻塞，且临时绕行失效，后续窗口可按规则处理有效进展计时和同指纹重试控制。

## 下一小时关注点

1. `wp_instruction_queue` Implementation 是否生成源码和测试，或再次返回同类可观测性缺口。
2. `wp_control` 新 Design 是否补足资源身份、stale 持续状态和各流水边界资格。
3. 两个当前 Worker 是否在 20 分钟阈值内完成。
4. 历史 queued run 是否继续污染 `runs_in_progress`。
5. revision 165 附近是否生成下一次 Git 检查点。
6. 是否出现编译、定向测试、集成测试或 CoreMark 证据。
7. 目标任务当前 active writer 结束后，是否切换回正式 `processor-agent.cmd` 并使用修复后的 Read Manifest 重试 IQ Implementation。
