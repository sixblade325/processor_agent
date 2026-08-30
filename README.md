# Processor Agent

`processor_agent` 是面向 Chisel 处理器开发的本地、状态化、文档驱动型 Workflow Harness。项目文件保存正式事实，Codex 上下文只承担一次任务的分析与执行。

用户操作见 [USER_GUIDE.md](./USER_GUIDE.md)。产品总纲位于 [PRODUCT_PLAN/PRODUCT_PLAN.md](./PRODUCT_PLAN/PRODUCT_PLAN.md)。Stage1、Stage2 和 Stage3 的权威计划位于同一目录。`idea/` 保存历史构想，不承担正式产品事实。

## 当前实现

第一版 Stage1 CLI 已经可运行，支持：

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

`dual_issue_demo` Profile 当前版本为 `0.7.0`，用户可读产物默认使用中文。隔离端到端运行已经到达 `STAGE1_COMPLETE`，独立架构审查通过，WSL 中的 `sbt -batch compile` 通过。实际项目 [dual_issue_demo](../dual_issue_demo/) 已迁移到 `0.7.0`，当前动作为 `S1_DEC_007` 的 required Research Task。

Stage2、Stage3、本地 Web 工作台、显式架构重开流程和中断中的多文件事务恢复尚未实现。

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
node dist\src\cli.js stage1 advise E:\107\dual_issue_demo
node dist\src\cli.js stage1 advise E:\107\dual_issue_demo S1_DEC_001 --refresh
node dist\src\cli.js stage1 answer E:\107\dual_issue_demo S1_DEC_001 rv32i
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
├── src/                Stage1 Harness、CLI、Codex Runtime 和 WSL Runner
├── tests/              状态机与生成器测试
└── USER_GUIDE.md       用户操作指南
```

具体处理器的 Architecture、Design、源码、验证和实验事实进入用户项目。缓存、Agent 原始事件、生成 RTL、波形和构建产物进入工作区级 `.runtime/` 或用户项目忽略的构建目录。
