# PA3-DEFECT-005：Codex 上游 404 缺少实验运行恢复机制

状态：现场运行已恢复，产品化修复待完成  
发现日期：2026-09-03  
来源：`dual_issue_demo_V2` run-002 Skill 产品预检

## 产品责任

实验运行基础设施必须把 Codex 上游服务故障与候选实现失败分开。上游短时不可用时，应保留原 thread、工作树、隔离环境和冻结输入，暂停有效计时，服务恢复后从同一 thread 继续。

## 现场证据

2026-09-03 22:45:12 起，三个 review subagent 连续返回：

```text
unexpected status 404 Not Found: Unknown error
url: https://chatgpt.com/backend-api/codex/responses
```

原始证据位于：

```text
E:\107\.runtime\dual_issue_demo_V2\run-002\skill\codex-home\sessions\2026\09\03\rollout-2026-09-03T13-03-25-01a065a6-80d5-73f1-a1dc-326bab0417cb.jsonl
```

关键 ordinal 为 3675、3677、3679、3727、3731 和 3740。监控侧自动审批也在同一时间窗口两次因 Responses 后端 404 无法写入归档，说明故障跨越主线程与 subagent 调用路径。

2026-09-03 23:23，使用相同 Skill 组认证执行无工具、无 Memory、ephemeral 健康检查，返回 `UPSTREAM_OK`，退出码为 0。23:24:06 原 thread ID 重新出现 `task_started`，新进程 PID 为 `10408`。

运行恢复证据：

```text
E:\107\.runtime\dual_issue_demo_V2\run-002\skill\timing\segment-002-stop.json
E:\107\.runtime\dual_issue_demo_V2\run-002\skill\timing\segment-003-start.json
E:\107\.runtime\dual_issue_demo_V2\run-002\skill\interventions\H-002
```

## 影响

1. 多个 subagent 可在同一时间窗口同时失败。
2. 人类只能反复发送 `continue` 判断服务是否恢复。
3. 没有自动暂停计时会把上游不可用时间计入实验结果。
4. 误建新线程会破坏 Memory、上下文和实验身份连续性。
5. 运行状态可能停留在旧 PID 和旧 observation，监控记录失真。

## 本次恢复

1. 以第一条聚集性 404 的时间 `2026-09-03T14:45:11.987Z` 停止 segment 2。
2. 排除上游故障与人工恢复区间。
3. 通过 ephemeral 健康检查确认 Responses 服务恢复。
4. 保持正式 thread ID、工作树、隔离 `CODEX_HOME` 和模型配置不变。
5. 从新 Codex 进程启动时间开启 segment 3。

## 目标行为

1. 监控器识别同一时间窗口内的 Responses 404，并将运行标记为 `infrastructure_paused`。
2. 首次确认上游故障时关闭当前计时 segment，不重复关闭。
3. 使用不调用工具、不读取项目内容、不生成 Memory 的 ephemeral 请求执行限频健康检查。
4. 健康检查通过后只允许恢复原 thread ID，禁止静默创建新正式线程。
5. 用新进程启动时间开启计时 segment，并更新监控 PID 与下次观察时间。
6. 记录失败的 subagent task，允许主 Agent 按需重试，已经成功完成的 task 不重复运行。
7. 恢复全过程生成机器可读事件与人类可读摘要。

## 关闭条件

1. 使用故障注入稳定复现 Responses 404、暂停、健康检查和同线程恢复。
2. 故障区间不计入有效运行时间，多个 404 只产生一个 pause segment。
3. 恢复前后 thread ID、工作树、`CODEX_HOME`、模型和冻结输入保持一致。
4. 旧进程不存在时更新为新 PID，旧进程仍存活时拒绝启动竞争进程。
5. 自动测试覆盖 root turn 404、subagent 404、审批 404、健康检查仍失败和恢复后再次失败。
