# Processor Agent

`processor_agent` 是面向 Chisel 处理器开发的本地、状态化、文档驱动型 Workflow Harness。项目文件保存正式事实，Codex 上下文只承担一次任务的分析与执行。

用户操作见 [USER_GUIDE.md](./USER_GUIDE.md)。产品总纲位于 [PRODUCT_PLAN/PRODUCT_PLAN.md](./PRODUCT_PLAN/PRODUCT_PLAN.md)。Stage1、Stage2 和 Stage3 的权威计划位于同一目录。`idea/` 保存历史构想，不承担正式产品事实。

## 当前实现

第一版 Stage1 与 Stage2 CLI 已经可运行，支持：

1. 从 Profile 初始化项目并保护已有 `AGENTS.md`、`.gitignore` 和正式文档。
2. 探测 Windows 控制端和 WSL 构建环境。
3. 按依赖顺序推进架构决策，记录用户选择、自定义答案和延期项。
4. 按 Decision 的 `researchPolicy` 自动创建 Research Task，并通过独立 Research Worker 和 Synthesis Worker 生成来源化建议。
5. 持续生成 Architecture Overview、Research Memo 和 Verification Plan，Architecture Role 保存在总体架构中。
6. 使用文档聚合哈希绑定批准，检测批准后的文档漂移。
7. 根据已批准 Profile 生成项目骨架，并在 WSL 中执行 smoke check。
8. 在未批准阶段安全更新 Profile，同时保留未变化的用户决策和调研结果。
9. 通过 `processor-agent open <path>` 启动单一 Workspace Agent，将用户自然语言映射到 Harness 命令。
10. 按 Research Request 指纹缓存结果，输出 cache hit、run ID、两个 Worker thread ID 和证据充分性，并支持显式刷新。
11. 将用户指定的问题、仓库、URL 和范围写入 Research Request，完整 Research Memo 保存在用户项目中。
12. 通过 `stage1 reopen` 修正未批准的已关闭 Decision。Harness 保留此前结论作为修订基线，使旧 advice 与全部传递依赖 Decision 失效，并生成可确认的完整修订候选。
13. 通过只读 Project Reader MCP 向 Research Worker 和 Stage2 Worker 提供受限的项目文件枚举、文本搜索和分段读取能力。
14. 将 Architecture audit finding 分类为 `decision`、`project_spec` 或 `profile`。Review Correction v2 使用领域增量事件、独立 Evidence 覆盖和用户确认修正结构化项目事实，并强制重新 `review` 和 `audit`。
15. 通过 `stage2 init` 从已批准且未漂移的 Architecture Snapshot 建立 Implementation Topology Decision Loop，Implementation Topology 只由 Stage2 拥有。
16. 由独立 Topology Research Worker 收集证据，可恢复 Planner 每次只形成一个 Decision Packet。
17. 支持 Topology option、custom、reopen 和传递失效，将已确认内容持续投影到唯一 `design/plan.md`。
18. 在 Plan 批准前检查 Architecture Role 唯一映射、Interface owner、路径 owner、Unit DAG、wave 和完成条件，并显示完整 Unit 看板。
19. 显式迁移尚无批准 Design、源码和验证证据的 schemaVersion 1 Module Loop，拒绝自动迁移已物化的旧状态。
20. 维护两个可恢复 Codex 上下文、角色、租约与 state epoch，Plan 批准后按 Unit DAG 在 Shadow Align 和 Active Coding 之间轮转。
21. 将 Shadow Design 投影为中文 `design/<unit>.md`，以 `design_revision` 显示缺口，并强制检查 Plan 路径、未决问题和验收命令。
22. 将 Active Coding 的结构化全文件结果限制在批准路径内，校验 Plan、Design 和原文件哈希后再由 Harness 写入。
23. 按 Unit 要求用户选择 `independent_workers` 或 `active_only`，记录主验证、静态审查、最终验证和独立性证据。
24. 从仓库 `skills/` 加载 Topology、Design 与 Implementation 领域方法，在正式记录与 Task Envelope 中保存 Skill 内容哈希。
25. 将 ProjectSpec 基线和增量历史压缩到内容寻址 sidecar，`.assistant/project.yaml` 只保存当前事实、Correction 索引和 sidecar 元数据。旧 Correction 与产品 Schema 分别通过显式 dry-run 与 apply 迁移。
26. Stage2 发现已批准 Architecture 错误时，通过 `rework-start` 冻结 Stage2、返回 Stage1 修正并重新批准，再通过 `rework-resume` 失效受影响的 Topology Decision、Unit Design、Implementation 和 Verification。

`dual_issue_demo` Profile 当前版本为 `0.8.0`，用户可读产物默认使用中文。新 Schema 将 Intent、Architecture Role、全局协议语义和 Verification 完成条件统一纳入 Stage1 ProjectSpec，并由 Stage2 独立拥有 Implementation Topology。实际项目 [dual_issue_demo](../dual_issue_demo/) 的当前动作以该项目的 Harness 状态为准。

Stage2 Implementation Topology Decision Loop、Unit Loop 和 Stage2 到 Stage1 Architecture Rework 已实现。产品迁移支持只读预检、历史重放校验、退役 Stage1 Module Manifest 和按 Architecture Role 重建 Stage2。Stage3、本地 Web 工作台和中断中的多文件事务自动恢复尚未实现。

实际 `dual_issue_demo` 已完成结构迁移：Stage1 schemaVersion 2、ProjectSpec history protocolVersion 3、Stage2 schemaVersion 3。当前 Stage1 停在独立 Audit 生成的 `S1_REVIEW_RESET_VECTOR_COVERAGE` 用户修正确认门禁，Stage2 保持 `S2_ARW_001` 活动且未生成 Unit Design 或 RTL。

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
node dist\src\cli.js stage1 correct E:\107\dual_issue_demo INTENT_EXCLUSION_STALE --proposal-json '{"patch":{"intent":{"exclusions":["虚拟内存"]}},"rationale":"删除已经纳入 baseline 的旧 Cache 排除项。","evidenceSources":[{"id":"EV_USER","kind":"user_directive","locator":"INTENT_EXCLUSION_STALE","claim":"用户确认 baseline 包含 Cache，并要求排除项只保留虚拟内存。","locations":[]}],"evidenceCoverage":{"intent.exclusions":["EV_USER"]}}'
node dist\src\cli.js stage1 correction-migrate E:\107\dual_issue_demo --dry-run
node dist\src\cli.js stage1 release-override E:\107\dual_issue_demo intent.exclusions
node dist\src\cli.js stage1 advise E:\107\dual_issue_demo
node dist\src\cli.js stage1 advise E:\107\dual_issue_demo S1_DEC_001 --refresh
node dist\src\cli.js stage1 answer E:\107\dual_issue_demo S1_DEC_001 rv32i

node dist\src\cli.js migrate E:\107\dual_issue_demo --profile dual_issue_demo --dry-run --json
node dist\src\cli.js migrate E:\107\dual_issue_demo --profile dual_issue_demo --apply --json

node dist\src\cli.js stage2 init E:\107\dual_issue_demo
node dist\src\cli.js stage2 status E:\107\dual_issue_demo
node dist\src\cli.js stage2 next E:\107\dual_issue_demo
node dist\src\cli.js stage2 plan E:\107\dual_issue_demo S2_TOP_001 --instruction "优先检查状态 owner 和既定寄存边界"
node dist\src\cli.js stage2 plan E:\107\dual_issue_demo S2_TOP_001 --instruction "重新核对现有源码边界" --refresh
node dist\src\cli.js stage2 answer E:\107\dual_issue_demo S2_TOP_001 recommended
node dist\src\cli.js stage2 topology-reopen E:\107\dual_issue_demo S2_TOP_001 --reason "Unit 边界需要修正"
node dist\src\cli.js stage2 review E:\107\dual_issue_demo
node dist\src\cli.js stage2 approve-plan E:\107\dual_issue_demo
node dist\src\cli.js stage2 design E:\107\dual_issue_demo regfile
node dist\src\cli.js stage2 approve E:\107\dual_issue_demo regfile --verification-mode independent_workers
node dist\src\cli.js stage2 implement E:\107\dual_issue_demo regfile
node dist\src\cli.js stage2 verify E:\107\dual_issue_demo regfile
node dist\src\cli.js stage2 rework-start E:\107\dual_issue_demo --proposal-json '{"summary":"Stage2 发现已批准 Architecture 缺少寄存器文件同拍语义。","rationale":"Unit Design 无法在现有 Contract 下闭合。","source":{"kind":"unit_design","unitId":"regfile"},"repair":{"kind":"decision","target":"S1_DEC_003"},"requiredClosure":["补齐同拍读写语义"],"evidenceSources":[{"id":"EV_USER","kind":"user_directive","locator":"S2_REWORK","claim":"用户确认该缺口属于 Stage1 Architecture，并要求正式返工。","locations":[]}],"affectedTopologyDecisions":["S2_TOP_001"],"affectedUnits":["regfile"]}'
node dist\src\cli.js stage2 rework-resume E:\107\dual_issue_demo
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
├── src/                Harness、CLI、Codex Runtime 和 WSL Runner
│   ├── stage1/         ProjectSpec 与事实来源逻辑
│   └── stage2/         Topology、展示、Worker Contract 与 Proposal 校验
├── tests/              状态机、运行时与生成器测试
└── USER_GUIDE.md       用户操作指南
```

具体处理器的 Architecture、Design、源码、验证和实验事实进入用户项目。缓存、Agent 原始事件、生成 RTL、波形和构建产物进入工作区级 `.runtime/` 或用户项目忽略的构建目录。
