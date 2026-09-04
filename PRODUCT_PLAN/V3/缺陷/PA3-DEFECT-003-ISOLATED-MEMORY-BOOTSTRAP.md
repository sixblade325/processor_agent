# PA3-DEFECT-003：隔离 Codex home 的空 Memory 启动未完成上下文重建

状态：已修复，run-003 启动前验收通过  
发现日期：2026-09-03  
来源：`dual_issue_demo_V2` run-002 Skill 产品预检启动审计

## 产品责任

A/B 实验运行器需要从相同的空 `MEMORY.md` 快照启动两个独立且可写的 Codex home，并证明 memory 读取和生成机制在正式线程中有效。配置项为 true 只能证明功能被请求，不能证明上下文重建成功。

## 现场证据

run-002 启动前满足以下条件：

1. Skill 与 Control 的 `MEMORY.md` 均为空文件，SHA256 为 `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855`。
2. 两组 `config.toml` 均启用 `features.memories`、`use_memories` 和 `generate_memories`。
3. 两组只读模型预检成功，未生成持久 rollout，memory hash 保持不变。

Skill 正式线程启动后，Codex 创建了 `raw_memories.md`、`phase2_workspace_diff.md` 和 memory Git 仓库。内部 memory Agent 读取 `phase2_workspace_diff.md` 的命令被执行策略拒绝，随后记录：

```text
memory consolidation artifacts are invalid: read memory summary artifact
E:\107\.runtime\dual_issue_demo_V2\run-002\skill\codex-home\memories\memory_summary.md
```

当时 `memory_summary.md` 不存在。

原始证据：

```text
E:\107\.runtime\dual_issue_demo_V2\run-002\skill\stderr.log
E:\107\.runtime\dual_issue_demo_V2\run-002\skill\codex-home\memories\
thread: 01a065a6-80d5-73f1-a1dc-326bab0417cb
```

run-001 曾出现同类日志，因此该现象具有重复性。

## 影响

1. 当前证据不能证明正式线程实际获得了可用的 Memory 上下文。
2. Memory 生成可能在运行结束前持续失败或只保留不完整中间产物。
3. A/B 实验虽保持相同配置，实际 memory 能力可能与运行配置声明不一致。
4. 内部 Memory Agent 的失败日志会增加噪声并消耗请求资源。

## 目标行为

1. 运行器在正式启动前执行能够覆盖持久 memory 初始化的最小 smoke test。
2. 上下文审计区分“配置启用”“初始化成功”“会话读取成功”和“会话后写回成功”。
3. 自动审批与 sandbox 策略允许 Codex 内部 Memory Agent 读取其专用工作目录中的确定性中间文件。
4. 初始化失败时给出明确状态，避免把该运行标记为 memory 已生效。

## 关闭条件

1. 全新隔离 Codex home 从空 `MEMORY.md` 启动后可生成有效 `memory_summary.md`，且无 consolidation error。
2. 独立持久线程能够在第一条用户消息前读取该 summary。
3. pre 与 post 审计记录完整文件清单、hash 和实际写回状态。未产生新持久事实时不强制制造 summary 变化。
4. Skill 与 Control 使用同一初始化流程并取得对称结果。

## 修复结果

1. Memory 状态拆分为 `configured`、`initialized`、`session_read` 和 `post_write`，每个状态都有独立证据门禁。
2. `prepare` 从同一空 `MEMORY.md` 建立 probe、Skill 与 Control 三个独立可写 home，冻结 config、规则、认证外公共 inventory 和全部证据路径。
3. initialization 使用两个真实持久 Codex session。seed 生成摘要，满足一小时 idle 后由不同 trigger session 验证摘要已在第一条用户消息前注入。
4. `finalize` 校验两个 session 的 thread ID、rollout、prompt、identity、启动参数、时间顺序、memory inventory、摘要生成和摘要读取证据，再把同一摘要原始字节复制给两组。
5. 正式 main 启动前重验 initialized 起点，pre 审计要求达到 `initialized`。正式 main 与后续 trigger 分别提供 `session_read` 与 `post_write` 证据。
6. Memory 专用最小规则允许内部 Memory Agent 读取确定性 workspace diff 和只读文件清单，不开放处理器工程写权限。

## 当前现场证据

1. run-003 `prepare` 已通过，三组从同一空文件 SHA-256 `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855` 建立隔离起点。
2. seed 线程 `01a06b83-a368-7ac1-b1cc-39a0e4543d19` 生成有效 `memory_summary.md`，SHA-256 为 `8c03ca74639f4e25f1acaa010df1c0b7f50fb80c005e25502034366d1928a639`。
3. trigger 线程 `01a06bc3-b1b9-7723-9a4a-8a9d01201ca6` 的 rollout 在 ordinal 3 包含该摘要，第一条用户消息位于 ordinal 6。线程退出码为 0，stderr 为空。
4. Skill 与 Control 的 `MEMORY.md` 均为空，`memory_summary.md` 逐字节相同，两个 home 和两个 repository 分离。
5. 两组绑定最终 `RUN_CONFIG` 的 pre audit 均返回 `ok=true`。启动证据见 `E:\107\.runtime\dual_issue_demo_V2\run-003\evidence\readiness.json`。
