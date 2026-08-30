# Processor Agent

`processor_agent` 是面向 Chisel 处理器开发的本地、状态化、文档驱动型 Workflow Harness。项目文件保存正式事实，Codex 上下文只承担一次任务的分析与执行。

用户操作见 [USER_GUIDE.md](./USER_GUIDE.md)。产品总纲位于 [PRODUCT_PLAN/PRODUCT_PLAN.md](./PRODUCT_PLAN/PRODUCT_PLAN.md)。Stage1、Stage2 和 Stage3 的权威计划位于同一目录。`idea/` 保存历史构想，不承担正式产品事实。

## 当前实现

第一版 Stage1 与 Stage2 CLI 已经可运行，支持：

1. 从 Profile 初始化项目并保护已有 `AGENTS.md`、`.gitignore` 和正式文档。
2. 探测 Windows 控制端和 WSL 构建环境。
3. 按依赖顺序推进架构决策，记录用户选择、自定义答案和延期项。
4. 按 Decision 的 `researchPolicy` 自动创建 Research Task，并通过独立 Research Worker 和 Synthesis Worker 生成来源化建议。
5. 持续生成 Architecture Overview、Module Manifest、Research Memo 和 Verification Plan。
6. 使用文档聚合哈希绑定批准，检测批准后的文档漂移。
7. 根据已批准 Profile 生成项目骨架，并在 WSL 中执行 smoke check。
8. 在未批准阶段安全更新 Profile，同时保留未变化的用户决策和调研结果。
9. 通过 `processor-agent open <path>` 启动单一 Workspace Agent，将用户自然语言映射到 Harness 命令。
10. 按 Research Request 指纹缓存结果，输出 cache hit、run ID、两个 Worker thread ID 和证据充分性，并支持显式刷新。
11. 将用户指定的问题、仓库、URL 和范围写入 Research Request，完整 Research Memo 保存在用户项目中。
12. 通过 `stage1 reopen` 修正未批准的已关闭 Decision。Harness 保留此前结论作为修订基线，使旧 advice 与全部传递依赖 Decision 失效，并生成可确认的完整修订候选。
13. 通过只读 Project Reader MCP 向 Research Worker 提供受限的项目文件枚举、文本搜索和分段读取能力。
14. 将 Architecture audit finding 分类为 `decision`、`project_spec` 或 `profile`，通过 `stage1 correct` 修正结构化项目事实，保留旧 audit，并强制重新 `review` 和 `audit`。
15. 通过 `stage2 init` 从已批准且未漂移的 Architecture Snapshot 建立按模块推进的 `Design -> Implementation -> Verification` 状态机。
16. 维护两个可恢复 Codex 模块上下文、角色、租约与 state epoch，在 Shadow Align 和 Active Coding 之间按门禁轮转。
17. 将 Shadow Design 投影为中文 `design/<module>.md`，允许未闭合 Design 落盘，以 `design_revision` 显示缺口，并在用户批准前强制检查未决问题、实现路径、测试路径和验收命令。
18. 将 Active Coding 的结构化全文件结果限制在批准路径内，校验 Design 哈希和原文件哈希后再由 Harness 写入。
19. 按模块要求用户选择 `independent_workers` 或 `active_only`，记录主验证、静态审查、最终验证和独立性证据。
20. 支持显式 Design reopen、实现阶段带反例自动 reopen、共享接口影响失效和双 Agent 原子轮转。
21. 从仓库 `skills/` 加载 Design 与 Implementation 领域方法，将正文注入对应任务，并在正式记录与 Task Envelope 中保存 Skill 内容哈希。

`dual_issue_demo` Profile 当前版本为 `0.7.0`，用户可读产物默认使用中文。隔离端到端运行已经到达 `STAGE1_COMPLETE`，独立架构审查通过，WSL 中的 `sbt -batch compile` 通过。实际项目 [dual_issue_demo](../dual_issue_demo/) 已迁移到 `0.7.0`，当前动作以该项目的 Harness 状态为准。

Stage2 Module Development Loop 已实现。Stage3、本地 Web 工作台、批准后的 Architecture reopen 和中断中的多文件事务恢复尚未实现。实际 `dual_issue_demo` 需先完成当前 Stage1 审查修正，才能初始化 Stage2。

## 运行要求

1. Node.js 22 或更高版本。
2. npm 和仓库内 `package-lock.json`。
3. 已安装并登录的 Codex CLI。当前端到端验证版本为 `0.151.0`。
4. `dual_issue_demo` 使用 Windows 控制端和 WSL 执行端。WSL 需要 Java 17、SBT 和 Verilator。

产品运行不依赖 ChatGPT 客户端。

## 开发与验证

```powershell
npm install
npm test
```

构建后可以直接运行 CLI：

```powershell
npm link
processor-agent open E:\107\dual_issue_demo

node dist\src\cli.js stage1 status E:\107\dual_issue_demo
node dist\src\cli.js stage1 next E:\107\dual_issue_demo
node dist\src\cli.js stage1 research E:\107\dual_issue_demo S1_DEC_007
node dist\src\cli.js stage1 research E:\107\dual_issue_demo S1_DEC_007 --question "比较异常边界" --source https://example.com/reference --scope "只研究第一版 baseline"
node dist\src\cli.js stage1 reopen E:\107\dual_issue_demo S1_DEC_003 --reason "修正流水级边界"
node dist\src\cli.js stage1 correct E:\107\dual_issue_demo STAGE2_ORDER_INCOMPLETE --patch-json '{"architecture":{"stage2Order":["frontend","core"]}}' --reason "补齐实施顺序" --source "architecture/overview.md"
node dist\src\cli.js stage1 advise E:\107\dual_issue_demo
node dist\src\cli.js stage1 advise E:\107\dual_issue_demo S1_DEC_001 --refresh
node dist\src\cli.js stage1 answer E:\107\dual_issue_demo S1_DEC_001 rv32i

node dist\src\cli.js stage2 init E:\107\dual_issue_demo
node dist\src\cli.js stage2 status E:\107\dual_issue_demo
node dist\src\cli.js stage2 next E:\107\dual_issue_demo
node dist\src\cli.js stage2 design E:\107\dual_issue_demo regfile
node dist\src\cli.js stage2 approve E:\107\dual_issue_demo regfile --verification-mode independent_workers
node dist\src\cli.js stage2 implement E:\107\dual_issue_demo regfile
node dist\src\cli.js stage2 verify E:\107\dual_issue_demo regfile
```

创建新项目：

```powershell
node dist\src\cli.js stage1 init E:\107\new_processor --profile dual_issue_demo
```

完整命令列表通过以下命令查看：

```powershell
node dist\src\cli.js --help
```

## 仓库边界

```text
processor_agent/
├── PRODUCT_PLAN/       产品总纲与阶段计划
├── idea/               历史构想
├── profiles/           项目生成 Profile
├── skills/             通用处理器开发方法
├── src/                Stage1/Stage2 Harness、CLI、Codex Runtime 和 WSL Runner
├── tests/              状态机、运行时与生成器测试
└── USER_GUIDE.md       用户操作指南
```

具体处理器的 Architecture、Design、源码、验证和实验事实进入用户项目。缓存、Agent 原始事件、生成 RTL、波形和构建产物进入工作区级 `.runtime/` 或用户项目忽略的构建目录。
