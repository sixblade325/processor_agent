# Stage1 开发与实跑复盘

状态：`dual_issue_demo` Stage1 已完成

复盘时间：2026-08-30

证据范围：

1. `E:\107\dual_issue_demo\.assistant\project.yaml`
2. `E:\107\dual_issue_demo\.assistant\profile.yaml`
3. `E:\107\dual_issue_demo\.assistant\reviews\stage1.json`
4. `E:\107\.runtime\processor_agent\dual_issue_demo\stage1\`
5. 本仓库 [Stage1 计划](../PRODUCT_PLAN/STAGE1.md)、Harness、CLI、Agent Runtime 和自动测试

本文记录第一版 Stage1 在开发和 `dual_issue_demo` 实跑中暴露的问题、已经实现的解决方案、当前状态和剩余问题。聊天上下文不作为事实来源，数字以磁盘状态与 runtime 证据为准。

## 1. 当前状态

截至本次复盘，`dual_issue_demo` 的 Harness 状态为：

```text
profile: dual_issue_demo@0.7.0
status: STAGE1_COMPLETE
revision: 95
decisions: 8 answered, 0 pending, 0 deferred
blockers: 0
approvalCurrent: true
```

Stage1 已形成并批准以下资产：

1. `architecture/overview.md`
2. `architecture/modules.yaml`
3. `verification/plan.md`
4. `research/stage1.md`
5. `build.sbt`
6. `project/build.properties`
7. `.assistant/project.yaml` 中的 Decision、Research、Review Correction、audit、approval 和 scaffold 记录

最终独立 audit 为 `pass`。WSL `sbt -batch compile` 首次因 `E_ACCESSDENIED` 失败，第二次执行成功，Stage1 随后进入 `STAGE1_COMPLETE`。

`STAGE1_COMPLETE` 只表示全局 Architecture、模块边界、验证策略和空项目骨架已经闭合。Baseline RTL、模块 Design、测试实现和集成进入 Stage2。

## 2. 实际使用数据

### 2.1 状态变更操作

| 功能 | 成功记录或尝试数 | 说明 |
|---|---:|---|
| Project 初始化 | 1 | 创建最小工作区、Profile 快照和初始正式草案 |
| `profile-refresh` | 9 | Profile 从 `0.1.0` 演进到 `0.7.0`，包含一次 `0.6.0 -> 0.6.0` 内容刷新 |
| Profile option 回答 | 13 | 包含依赖失效后的重新提交 |
| 自定义回答 | 13 | 最终 8 个 Decision 中有 4 个使用自定义结论 |
| 全部 Decision 提交 | 26 | 平均每个最终 Decision 提交 3.25 次 |
| `reopen` | 5 | `S1_DEC_003` 4 次，`S1_DEC_006` 1 次 |
| 传递依赖失效 | 13 | 由 5 次 reopen 触发 |
| Advice 正式记录 | 27 | 包含 legacy advice、现代 Research 结果和缓存重新挂接 |
| 确定性 `review` | 5 | 每轮独立 audit 前一次 |
| 独立 `audit` | 5 | 4 次 fail，最后一次 pass |
| Review Correction | 10 | 全部在最终 audit 中验证为 `verified` |
| Architecture approval | 1 | 绑定正式文档聚合哈希 |
| Project scaffold | 1 | 生成 SBT 空项目骨架 |
| `complete` 尝试 | 2 | 首次 WSL 失败，第二次编译成功 |
| `defer` | 0 | 当前 Profile 的 8 个 Decision 全部 blocking |
| 初始化后的独立 `probe` | 0 | 环境检查只在初始化和最终 smoke check 中执行 |

`open`、`status`、`next`、cache hit、`--refresh` 和 Profile refresh 高级参数不会写入历史，因此无法从当前证据中得到准确调用次数。

### 2.2 Research 使用

现代 Research Task 共创建 21 个运行目录：

| Decision | 尝试数 | Evidence sufficient | Evidence insufficient | 未形成 Evidence |
|---|---:|---:|---:|---:|
| `S1_DEC_003` | 2 | 2 | 0 | 0 |
| `S1_DEC_006` | 6 | 3 | 3 | 0 |
| `S1_DEC_007` | 10 | 3 | 4 | 3 |
| `S1_DEC_008` | 3 | 3 | 0 | 0 |
| 合计 | 21 | 11 | 7 | 3 |

17 次运行形成 Synthesis，11 次 Evidence 最终充分。按运行目录计算，充分率为 52.4%。`S1_DEC_007` 的 10 次尝试和 3 次充分结果是最集中的重试来源。

21 次现代 Research 中有 4 次使用自定义 question、source 和 scope，全部发生在 `S1_DEC_007`。其余运行使用默认 Research Request。

runtime 还保留 8 次 legacy Advice Worker 和一个直接 legacy artifact。现代 Research 与 Synthesis 共留下 36 个可验证 Worker thread，独立 audit 留下 5 个 Worker thread。

### 2.3 Audit 与 Review Correction

5 次 audit 的结果依次为：

```text
fail(6 findings)
-> fail(9 findings)
-> fail(7 classified findings)
-> fail(3 classified findings)
-> pass(0 findings)
```

前两次 audit 发生在 `repairKind` Schema 实现前，只能通过 Decision reopen、Profile 更新和人工分析恢复。后两次失败 audit 共形成 10 个结构化 `project_spec` finding，并逐项生成 10 个 Review Correction。

Review Correction 实际修改目标如下：

| 目标 | 使用次数 |
|---|---:|
| `architecture.modules` | 3 |
| `architecture.globalProtocols` | 2 |
| `verification.requiredScenarios` | 2 |
| `architecture.stage2Order` | 1 |
| `architecture.sharedFields` | 1 |
| `architecture.invariants` | 1 |
| `verification.referenceModel` | 1 |
| `verification.decisionAcceptance` | 1 |

10 次 Correction 都只处理一个 finding。2 次 Correction 同时修改多个目标字段。`repairKind=decision`、`repairKind=profile` 和一次合并多个 finding 的路径尚未在真实 Demo 中覆盖。

## 3. 暴露过的问题与已实现方案

### 3.1 通用 Codex 会话不会自动执行 Harness 工作流

问题：用户直接在项目目录运行 `codex` 时，Agent 不知道 Stage1 状态机、当前 Decision 和 Harness 唯一写入者规则。

方案：实现 `processor-agent open <path>`。Harness 校验项目和 Codex CLI，注入固定 Workspace Agent 协议。Workspace Agent 每轮重新运行 `status` 和 `next`，只处理一个当前动作，禁止递归调用 `open` 和手工修改 `.assistant/`。

当前状态：已实现并通过端到端验证。已经打开的 Workspace Agent 不会自动获取后续更新的启动协议，协议变化后仍需重新启动会话。

### 3.2 Agent 不主动调研

问题：早期 Workspace Agent 直接根据已有上下文给出建议，Research 只在用户追问后发生，正式 Decision 缺少来源化 Evidence。

方案：为每个 Decision 增加 `researchPolicy=required|conditional|none`。`next` 对 required Decision 自动返回 `research_required`，Evidence 充分前禁止回答。

当前状态：5 个 required、2 个 conditional、1 个 none。最终只有 required Decision 持有 advice，conditional Decision 未触发不必要调研。

### 3.3 调研由主 Agent 完成，没有独立线程证据

问题：早期调研发生在 Workspace Agent 主上下文，无法证明来源收集与建议合成相互隔离，也无法恢复单次任务。

方案：Research Task 使用独立短生命周期 Research Worker 和 Synthesis Worker。Research Worker 只收集 Evidence，Synthesis Worker 只读取结构化 Evidence。Harness 保存 run ID、thread ID、请求、Evidence、Synthesis 和原始 JSONL。

当前状态：现代 Research 的独立线程证据已经落盘。真实 Demo 中共验证 36 个现代 Research 或 Synthesis Worker thread。

### 3.4 Research Worker 的 Shell 读取被执行策略拒绝

问题：Worker 依赖 PowerShell、`rg` 或 `cmd /c` 读取项目时，命令被 read-only 或 execpolicy 拒绝，导致 `evidenceSufficient=false` 或任务中止。

方案：实现只读 Project Reader MCP，只暴露受限的文件枚举、文本搜索和分段读取。Worker 不再依赖 Shell 读取项目。Codex 登录检查也改为正确的 `codex login status`。

当前状态：项目读取边界已经有自动测试。外部网络、认证和来源不可访问仍会产生 Evidence gap。

### 3.5 Advice 缓存和状态关联不稳定

问题：Advice 文件存在但没有挂到当前 Decision 时会成为 orphan；普通重试可能错误创建新 Worker；上下文变化后旧结果可能继续被复用。

方案：实现 Research Request fingerprint、context fingerprint、显式 `--refresh`、有效 orphan advice 重新挂接，以及 Decision 回答时保留 `advicePath` 和 Research 状态。

当前状态：缓存生命周期已通过自动测试。cache hit 和 refresh 次数没有独立遥测，无法审查真实命中率。

### 3.6 已关闭 Decision 无法修正

问题：早期 CLI 只能覆盖 pending Decision。用户发现流水级或协议结论错误后，没有正式 reopen 入口。

方案：实现 `stage1 reopen`。Harness 保存此前结论、修正原因和 revision，将目标重置为 pending，使全部传递依赖 Decision 失效，并删除对应旧 advice。

当前状态：真实 Demo 使用 5 次，产生 13 次依赖失效。该机制有效，使用成本较高。

### 3.7 reopen 后丢弃此前讨论结论

问题：重开 `S1_DEC_003` 后，新的 Agent 把 Profile 候选项当作完整设计空间，放弃此前已经闭合的长文本自定义结论。

方案：增加 revision context 和 `revise_previous`。Decision Packet 显示此前结论与修正原因，Research 和 Synthesis 必须把此前结论作为基线。Synthesis 推荐修订时输出可直接确认的完整 `proposedCustomAnswer`。

当前状态：已通过真实 `S1_DEC_003` 修订和自动测试验证。

### 3.8 Agent 授权和用户批准边界不清

问题：`answer --delegated` 几乎未使用，语义容易把 Agent 推荐误当作用户批准。

方案：删除 delegated answer。推荐选项、自定义结论、Review Correction 和 Architecture approval 全部要求用户明确确认。

当前状态：命令和 Workspace 协议均已移除 delegated 路径，自动测试验证未知参数会被拒绝。

### 3.9 Audit 发现 Decision 之外的问题后无法修正

问题：Module Manifest、共享字段、全局协议和 Verification Contract 的缺口不属于某个 Decision。早期只能强行 reopen 一个相关 Decision，导致无关决策和全部下游 Decision 被重复确认。

方案：Audit finding 增加 `repairKind=decision|project_spec|profile`、`repairTarget`、`requiredClosure` 和 `status`。新增 `REVIEW_CORRECTION` 状态与 `stage1 correct`。`project_spec` 修正写入结构化项目事实，由 Harness 重生成正式文档。

当前状态：真实 Demo 使用 10 次，全部通过新 audit 验证。Review Correction 已成为 Stage1 的核心路径。

### 3.10 修正后可以绕过重新审查

问题：如果 Correction 直接修改生成文档或直接把 finding 标记为通过，approval 可能绑定未经新 audit 验证的内容。

方案：禁止生成文档文本 patch。Correction 只允许替换受控结构化字段，将旧 finding 标记为 `superseded`，保存旧 audit，要求重新执行确定性 `review` 和独立 `audit`。新哈希对应 audit pass 后 Correction 才进入 `verified`。

当前状态：10 个 Correction 均绑定最终 pass audit 的聚合哈希。approval 也会拒绝未验证 Correction。

### 3.11 Profile 在活跃项目中持续变化

问题：Stage1 开发和 Demo 同时推进，Profile 从 `0.1.0` 更新到 `0.7.0`。直接替换快照会破坏已回答 Decision 和缓存。

方案：实现受限 `profile-refresh`。同 ID Profile 才能迁移；活动 Decision Contract 变化时停止；未变化的用户决策和 Evidence 保留；pending advice 只有显式授权才重置；项目级 Correction 在新 Profile 基础上重放。

当前状态：真实 Demo 使用 9 次。该频率属于产品开发期现象，正式 Demo 应冻结 Profile 后再开始用户流程。

### 3.12 WSL smoke check 首次失败

问题：首次 `complete` 调用因 WSL `CreateInstance/E_ACCESSDENIED` 失败，并产生乱码错误文本。

方案：Harness 保留 `SCAFFOLD_SMOKE_BLOCKED`，不把失败标记为完成。环境恢复后可以重新执行同一门禁。第二次 `sbt -batch compile` 成功并进入 `STAGE1_COMPLETE`。

当前状态：恢复路径有效。Windows 到 WSL 的错误输出解码仍不稳定。

## 4. 当前已经闭合的能力

1. 从空目录初始化最小 Stage1 项目。
2. 生成严格项目 `AGENTS.md`，保留已有项目规则。
3. Windows 控制端和 WSL 执行端环境检查。
4. Profile 驱动的 Decision DAG 和单 Decision 交互。
5. required、conditional 和 none 三类 Research policy。
6. 独立 Research Worker、Synthesis Worker 和 Architecture Audit Worker。
7. Research Request、Evidence、Synthesis、fingerprint、cache 和 runtime 证据。
8. option、自定义回答、reopen、修订基线和传递失效。
9. Architecture Overview、Module Manifest、Research Memo 和 Verification Plan 持续生成。
10. `decision`、`project_spec` 和 `profile` 三类 audit 修正所有权。
11. 结构化 Review Correction、旧 audit 历史和重新 audit 门禁。
12. Architecture approval 哈希、文档漂移检测和 scaffold 门禁。
13. SBT 项目骨架生成、WSL smoke check 及失败后恢复。
14. 从 `.assistant/project.yaml` 和 Profile 快照恢复正常关闭的工作流。

## 5. 当前仍存在的问题

### 5.1 Research 成本和失败率偏高

21 次现代运行只有 11 次 Evidence 充分。`S1_DEC_006` 和 `S1_DEC_007` 的重复运行说明以下信息仍然不足：

1. 失败类型没有形成稳定分类。
2. 相同外部阻塞缺少自动停止条件。
3. 用户看不到累计尝试次数、失败原因分布和来源覆盖变化。
4. Evidence 不足后是否继续 Synthesis 的策略仍不统一。

Stage2 开始前不必扩展 Research 功能。下一轮 Stage1 应先补运行指标、失败分类和重复请求抑制。

### 5.2 只读交互缺少可观测性

`open`、`status`、`next`、cache hit 和 refresh 不进入项目历史。当前无法回答 Workspace Agent 启动次数、用户查看同一 Decision 的次数、缓存真实命中率和手工 refresh 次数。

这些记录不应写入正式项目事实。合适位置是工作区级 runtime telemetry，并需要明确保留周期和隐私边界。

### 5.3 Review Correction 导致状态文件膨胀

当前文件体积：

| 资产 | 体积或规模 |
|---|---:|
| `.assistant/project.yaml` | 约 294 KB |
| `.assistant/` 全部文件 | 约 435 KB |
| `research/stage1.md` | 约 79 KB，570 行 |
| `architecture/overview.md` | 约 43 KB，416 行 |
| `architecture/modules.yaml` | 约 45 KB，639 行 |
| workspace runtime | 约 5.8 MB，173 个文件 |

主要原因是每次 Correction 在 `project.yaml` 中保存大型字段的完整旧值和新值。`architecture.modules` 被完整记录 3 次。后续应评估保存结构化 patch、字段哈希和必要检查点，避免重复保存完整数组。历史证据不能直接删除。

后续状态：Review Correction v2 已实现领域增量事件和内容寻址压缩 sidecar。真实 `dual_issue_demo` dry-run 中，`project.yaml` 估算从 338335 bytes 降到 190209 bytes，降幅 43.78%；Correction 与 history 负载从 137172 bytes 降到 40544 bytes，降幅 70.44%。实际项目未执行 apply。

### 5.4 Correction 来源记录过弱

10 次 Correction 的 `sources` 都只有 `.assistant/reviews/stage1.json`。这能追踪 finding，不能证明新值来自哪个 Decision、Architecture 事实、规范或源码证据。

后续 Schema 应区分：

1. `findingSource`：指出缺口的 audit。
2. `evidenceSources`：支撑新值的正式文档、Decision、源码位置或外部规范。

后续状态：v2 已将 `findingSource`、`evidenceSources`、`evidenceCoverage` 和用户确认分离。Audit report 不能作为新值 Evidence，Decision、项目文档、Research 和 Profile Evidence 均校验当前版本。

### 5.5 新修正分流的覆盖不完整

真实 Demo 只覆盖 `repairKind=project_spec`。以下路径仍只有自动测试或协议定义：

1. audit finding 触发 `repairKind=decision` 后进入 reopen。
2. audit finding 触发 `repairKind=profile` 后升级 Profile。
3. 一次 Correction 合并相同根因的多个 finding。
4. Profile refresh 后重放多个项目级 Correction 的真实端到端行为。

### 5.6 Deterministic review 的名称与实际职责不一致

5 次确定性 `review` 都成功，后续 4 次独立 audit 失败。当前 `review` 只验证环境、Decision、Research 和状态门禁，不执行完整语义审查。

产品文案应明确其为 deterministic gate 或 audit preparation，避免用户把它理解为架构已经审查通过。

### 5.7 早期 audit 历史不完整

前两次旧 Schema audit 的 JSON 和 JSONL 仍在 workspace runtime，未进入当前 `reviewHistory`。Review Correction 实现后的两个失败 audit 和最终 pass audit已经被状态正确引用。

该问题属于历史迁移缺口。后续若需要完整产品演示报告，应从 runtime 生成一次只读索引，不应手工伪造旧状态记录。

### 5.8 Workspace Agent 协议没有版本握手

Harness 更新 Workspace prompt 后，已经打开的 Codex 会话继续使用旧协议。当前只能关闭并重新运行 `processor-agent open <path>`。

后续可在 `status` 中暴露 protocol version，并要求 Workspace Agent 每轮检查版本漂移。第一版不需要实现会话热更新。

### 5.9 Windows 与 WSL 错误文本解码不稳定

第一次 smoke check 的 `E_ACCESSDENIED` 输出以 UTF-16 字节形式进入 UTF-8 状态字段，形成乱码。命令结果仍能判定失败，恢复条件对用户不够清晰。

Runner 应根据 BOM、NUL 分布或 `wsl.exe` 行为规范化 stderr 编码，再写入状态。

### 5.10 当时尚未实现的 Stage1 能力

1. 批准后的 Architecture reopen。
2. 命令中断期间的多文件事务恢复。
3. 自由形式 discovery 与 synthesis。
4. 本地 Web 工作台。

后续状态：第 1 项已通过 Stage2 Architecture Rework 实现。第 2 至第 4 项仍未实现。

## 6. 产品判断

### 6.1 应保留为 Stage1 核心

1. `custom`。真实使用次数与 option answer 相同。
2. required Research Task 和独立 Evidence/Synthesis。
3. `reopen` 与传递失效。
4. 独立 architecture audit。
5. Review Correction 和重新 audit 门禁。
6. approval hash、scaffold 和可重试 smoke check。

### 6.2 可以退出 Demo 主路径

1. `advise`。现代交互已统一到 `research`，可保留隐藏兼容别名。
2. `defer`。当前 Demo 没有 non-blocking Decision，用户不需要看到该入口。
3. 独立 `probe`。保留为恢复命令，无需在正常流程主动展示。
4. Profile refresh 高级参数。只在框架开发或迁移时展示。

### 6.3 进入 Stage2 前的边界

当前 Stage1 事实已经批准，不应继续为了完善 Stage1 工具而修改 `dual_issue_demo` Architecture。后续动作应是：

1. 冻结当前 Stage1 产物和 Profile。
2. 进入 Stage2，按 `architecture.modules.yaml` 的顺序闭合模块 Design。
3. 将 Stage1 剩余问题留在框架仓库，不混入 baseline RTL 实现。
4. Baseline 完成后创建冻结 commit，再开始 Processor Agent 与 Direct Codex 的受控优化对比。

## 7. 总结

Stage1 已经完成从自然语言目标到已批准 Project Blueprint 和可编译项目骨架的完整闭环。真实使用表明，Research、Decision 修订和 audit 修正构成主要工作量。Review Correction 解决了最关键的结构性缺口，使项目事实修正不再依赖错误的 Decision reopen。

当前剩余问题集中在运行成本、可观测性、历史体积、来源质量和少数未覆盖分支。它们不阻塞 Stage2。下一阶段应冻结 Stage1，开始模块级 Design、Implementation 和 Verification。
