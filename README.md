# Processor Agent

`processor_agent` 是面向 Chisel 处理器开发的本地、状态化、文档驱动型 Workflow Harness。项目文件保存正式事实，Agent 上下文只承担当前任务的分析与执行。

用户操作见 [USER_GUIDE.md](./USER_GUIDE.md)。产品总纲位于 [PRODUCT_PLAN/PRODUCT_PLAN.md](./PRODUCT_PLAN/PRODUCT_PLAN.md)，阶段权威计划位于同一目录。`idea/` 保存历史构想，不承担正式产品事实。

## 当前实现

Stage1 与 Stage2 CLI 已经可运行。

Stage1 支持：

1. 从 Profile 初始化项目并保护现有正式资产。
2. 探测 Windows 控制端和 WSL 构建环境。
3. 按依赖推进 Architecture Decision。
4. 由独立 Research Worker 和 Synthesis Worker 生成来源化建议。
5. 生成并维护 Architecture Overview、Research Memo 和 Verification Plan。
6. 通过 Review Correction v2 修正结构化 Architecture 事实。
7. 使用文档聚合哈希绑定用户批准并检测漂移。
8. 生成项目骨架并执行 smoke check。

Stage2 schemaVersion 5 支持：

1. Agent A 生成 System Design，Agent B 使用独立可恢复上下文审查。
2. 通过动态 `DecisionRequest` 将高风险实现决策交给用户。
3. 用户可以批准待审 `design/plan.md`，也可以登记带 revision 和 hash 基线的修订请求。
4. Shadow Agent 生成 Package Design，用户批准后由 Active Agent 实现。
5. `stage2 advance` 由 Harness 同时派发一个 Active Implementation 与一个 Shadow Package Design。
6. Agent A 与 Agent B 按 Work Package 轮转，无依赖、无 shared interface change 时允许在验证期间提前轮转。
7. 每个 Work Package 固定运行独立 Static Review Worker 与独立 Verification Worker。
8. Harness 校验 assignment、批准哈希、允许路径、原文件哈希和验证证据。
9. 通过 Read Manifest 限制 Worker 的项目读取范围，超范围读取返回 `read_scope_gap`。
10. Package Design 先执行确定性 canonicalization，局部缺口使用 base hash 绑定 Patch。
11. Runtime Session 与不可变 Run Ledger 分离，记录 queued、running、model completed、validation failed、applied、failed、cancelled 和 orphaned。
12. Work Package 分别声明 Design、Implementation 和 Integration 依赖。
13. 通过 provider-neutral `AgentRuntime` 隔离 AI provider，当前适配器为 `CodexCliRuntime`。
14. 通过 Architecture Rework 返回 Stage1，并选择性失效受影响 Package。
15. 显式迁移 schemaVersion 3 和 4，保留可验证的批准与运行证据。

Stage3、本地 Web 工作台、正式对照实验和中断中的多文件事务自动恢复尚未实现。

## 运行要求

1. Node.js 22 或更高版本。
2. npm 和仓库内 `package-lock.json`。
3. 已安装并登录的 Codex CLI。
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
```

Stage1 常用命令：

```powershell
processor-agent stage1 status E:\107\dual_issue_demo
processor-agent stage1 next E:\107\dual_issue_demo
processor-agent stage1 advise E:\107\dual_issue_demo
processor-agent stage1 research E:\107\dual_issue_demo S1_DEC_007
processor-agent stage1 answer E:\107\dual_issue_demo S1_DEC_001 rv32i
processor-agent stage1 review E:\107\dual_issue_demo
processor-agent stage1 audit E:\107\dual_issue_demo
processor-agent stage1 approve E:\107\dual_issue_demo
```

Stage2 schemaVersion 5 常用命令：

```powershell
processor-agent stage2 init E:\107\dual_issue_demo
processor-agent stage2 migrate E:\107\dual_issue_demo --dry-run
processor-agent stage2 migrate E:\107\dual_issue_demo --apply
processor-agent stage2 status E:\107\dual_issue_demo
processor-agent stage2 next E:\107\dual_issue_demo
processor-agent stage2 advance E:\107\dual_issue_demo
processor-agent stage2 cancel E:\107\dual_issue_demo <run-id-or-runtime-ref>
processor-agent stage2 start E:\107\dual_issue_demo
processor-agent stage2 draft E:\107\dual_issue_demo
processor-agent stage2 revise E:\107\dual_issue_demo --revision <n> --instruction "修订要求"
processor-agent stage2 decide E:\107\dual_issue_demo <decision-id> <option-id>
processor-agent stage2 decide E:\107\dual_issue_demo <decision-id> --text "完整结论"
processor-agent stage2 approve E:\107\dual_issue_demo
processor-agent stage2 design E:\107\dual_issue_demo <work-package-id>
processor-agent stage2 approve E:\107\dual_issue_demo <work-package-id>
processor-agent stage2 implement E:\107\dual_issue_demo <work-package-id>
processor-agent stage2 verify E:\107\dual_issue_demo <work-package-id>
processor-agent stage2 reopen E:\107\dual_issue_demo <work-package-id> --reason "修订原因"
processor-agent stage2 rework-start E:\107\dual_issue_demo --proposal-json <json>
processor-agent stage2 rework-resume E:\107\dual_issue_demo
```

正常机器动作统一使用 `stage2 advance`。`draft`、`design`、`implement` 和 `verify` 保留为诊断与精确重试入口。

完整命令列表：

```powershell
processor-agent --help
```

## 仓库边界

```text
processor_agent/
├── PRODUCT_PLAN/       产品总纲与阶段计划
├── idea/               历史构想
├── profiles/           项目生成 Profile
├── skills/             通用处理器开发方法
├── src/                Harness、CLI、Runtime 和 runner
│   ├── stage1/         ProjectSpec 与事实来源逻辑
│   └── stage2/         System Design、Package、轮转、门禁与 Runtime Port
├── tests/              状态机、运行时与生成器测试
└── USER_GUIDE.md       用户操作指南
```

具体处理器的 Architecture、Design、源码、验证和实验事实进入用户项目。缓存、Agent 原始事件、冻结副本、生成 RTL、波形和构建产物进入工作区级 `.runtime/` 或用户项目忽略的构建目录。
