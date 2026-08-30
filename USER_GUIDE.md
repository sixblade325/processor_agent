# Processor Agent 用户指南

## 1. 产品用途

Processor Agent 是本地运行的处理器开发工作流 Harness。它负责保存阶段状态、组织架构决策、调用 Codex CLI、生成正式文档、执行门禁，并在批准后建立 Chisel 项目骨架。

当前可用范围是 Stage1 Project Bootstrap 和 Stage2 Module Development Loop。Stage3 优化闭环和本地 Web 工作台仍在开发。

## 2. 文件职责

框架目录：

```text
processor_agent/
├── PRODUCT_PLAN/       产品总纲和阶段计划
├── profiles/           项目生成 Profile
├── skills/             通用处理器开发方法
├── src/                Harness、CLI、Codex Runtime 和 WSL Runner
├── tests/              自动测试
└── USER_GUIDE.md       本指南
```

用户处理器项目：

```text
user_project/
├── AGENTS.md                 项目协作约束
├── architecture/
│   ├── overview.md           整核架构事实和决策
│   └── modules.yaml          模块职责、接口和实施顺序
├── design/                   已生成的模块 Design，按需创建
├── research/                 来源化调研结论，按需创建
├── src/                      Chisel 源码和测试，按 Design 生成
├── verification/
│   ├── plan.md               验证策略和完成门禁
│   └── <module>.md           模块验证记录，按需创建
└── .assistant/
    ├── project.yaml          Stage1/Stage2 状态、revision、哈希和历史
    ├── profile.yaml          当前项目使用的 Profile 快照
    ├── advice/               每个 Decision 的结构化调研结果，按需创建
    └── reviews/              当前 Architecture audit 报告，按需创建
```

`architecture/`、`design/`、`src/`、`verification/` 和 `experiments/` 是项目正式资产。`.assistant/` 由 Processor Agent 维护，用户不应手工修改其中的状态和哈希。

用户项目中的人类可读文档默认使用中文。模块名、信号名、字段名、文件名、命令和代码保持英文。

## 3. 环境准备

当前开发基线：

1. Windows Node.js 22 或更高版本。
2. npm。
3. 已安装并登录的 Codex CLI。当前端到端验证版本为 `0.151.0`。
4. WSL 中安装 Java 17、SBT 和 Verilator。

在框架目录执行：

```powershell
npm install
npm run build
npm test
```

以下示例直接调用构建后的 CLI。也可以使用 `npm link` 注册 `processor-agent` 命令。

## 4. 初始化项目

从空目录或不含 Stage1 正式文档的已有目录初始化：

```powershell
node dist\src\cli.js stage1 init E:\107\my_core --profile dual_issue_demo
```

初始化会：

1. 保留已有 `AGENTS.md` 和 `.gitignore`。
2. 拒绝覆盖已有 `architecture/overview.md`、`architecture/modules.yaml` 和 `verification/plan.md`。
3. 在缺少 Git 仓库时执行 `git init`。
4. 保存 Profile 快照和机器状态。
5. 执行 Profile 声明的环境探测。
6. 生成中文 Architecture、Module Manifest 和 Verification Plan 草案。

查看状态和下一个决策：

```powershell
node dist\src\cli.js stage1 status E:\107\my_core
node dist\src\cli.js stage1 next E:\107\my_core
```

## 5. 自然语言交互

注册命令后，从用户项目外部或内部启动 Workspace Agent：

```powershell
cd E:\107\processor_agent
npm link
processor-agent open E:\107\my_core
```

`open` 会先校验 Stage1 项目和 Codex CLI，再把固定的 Workspace Agent 协议作为初始任务交给 Codex。Agent 随后自动读取项目 `AGENTS.md`、查询 `stage1 status` 和 `stage1 next`。`next` 返回 `research_required` 时，Workspace Agent 先执行 Research Task；返回 `decision_ready` 时只展示一个待确认决策；返回 `review_finding` 时只处理一个审查缺口；旧 audit 缺少修正分类时返回 `audit_refresh_required`。

用户可以直接使用自然语言：

```text
继续
为什么推荐 rv32i？
研究 https://github.com/example/core 对当前异常边界有什么可复用设计
我选择 rv32i，因为第一版先控制验证范围
这项先延期到进入 LSU Design 前
检查全部架构文档
我确认批准当前架构
```

Workspace Agent 负责把这些回答映射为 `research`、`answer`、`custom`、`defer`、`reopen`、`correct`、`review`、`audit` 和 `approve`。Harness 负责调研任务、状态转换和文档更新。推荐选项、自定义架构结论、Review Correction 与 Architecture Approval 都保留显式用户确认门禁。

直接运行 `codex` 只会启动通用 Codex 会话，Harness 不会自动接收用户输入。Processor Agent 的自然语言入口固定为 `processor-agent open <path>`。

检查启动协议但不打开交互界面：

```powershell
processor-agent open E:\107\my_core --print-prompt
```

## 6. 完成架构决策

每个 Decision Packet 包含已知事实、候选方案、推荐、后果和影响产物。推荐只代表 Agent 建议，最终结论由用户确认或显式授权。

每个 Decision 的 `researchPolicy` 取值如下：

1. `required`：展示 Decision 前必须完成充分调研。
2. `conditional`：用户要求依据、比较、建议或指定来源时调研。
3. `none`：直接使用项目事实和 Profile，不创建 Research Task。

执行默认 Research Request：

```powershell
node dist\src\cli.js stage1 research E:\107\my_core S1_DEC_001
```

指定问题、来源和范围：

```powershell
node dist\src\cli.js stage1 research E:\107\my_core S1_DEC_001 --question "比较两个 ISA 范围" --source https://example.com/spec --source E:\107\reference_core --scope "只覆盖第一版 Demo"
```

Harness 先启动只读 Research Worker 收集来源和事实，再启动 Synthesis Worker 比较全部候选项。命令输出包含 `source`、`cacheHit`、`fingerprint`、`runId`、两个 Worker thread ID 和 `evidenceSufficient`。相同指纹直接命中缓存。问题、来源、依赖决策、相关文档或 prompt 版本变化时创建新任务。强制重新执行使用 `--refresh`。

`stage1 advise` 保留为默认 Research Request 的兼容入口。新交互统一使用 `stage1 research`。

接受某个候选方案：

```powershell
node dist\src\cli.js stage1 answer E:\107\my_core S1_DEC_001 rv32i
```

记录自定义方案：

```powershell
node dist\src\cli.js stage1 custom E:\107\my_core S1_DEC_001 --text "自定义结论" --note "选择理由"
```

修正尚未批准的已关闭 Decision：

```powershell
node dist\src\cli.js stage1 reopen E:\107\my_core S1_DEC_001 --reason "修正原因"
node dist\src\cli.js stage1 next E:\107\my_core
```

`reopen` 将目标 Decision 重置为 pending，在 `project.yaml` 和 Architecture Overview 中保留此前结论与修正原因。目标及全部直接和传递依赖 Decision 的旧 advice、research 状态和 Research Memo 投影同时失效。

重新进入该 Decision 时，`next` 返回修正上下文，并把 `revise_previous` 作为修订候选。此前结论是修订基线，Profile 中的固定候选项只作参考。required Research Task 必须读取此前结论和修正原因，Synthesis 推荐 `revise_previous` 时还要输出完整的 `proposedCustomAnswer`。用户确认后，Workspace Agent 使用 `custom` 提交这份完整修订结论。已关闭 Decision 不能被 `answer`、`custom` 或 `defer` 直接覆盖。

延期非 blocking 决策：

```powershell
node dist\src\cli.js stage1 defer E:\107\my_core S1_DEC_XXX --until "进入对应模块 Design 前" --note "延期理由"
```

用户回答后，Harness 立即更新正式草案和 `.assistant/project.yaml`。已有建议继续关联该 Decision，并保留在 `research/stage1.md` 中。下一次运行只依赖磁盘文件恢复。

## 7. 审查、批准与项目骨架

全部 blocking 决策闭合后执行确定性门禁：

```powershell
node dist\src\cli.js stage1 review E:\107\my_core
```

执行独立只读架构审查：

```powershell
node dist\src\cli.js stage1 audit E:\107\my_core
```

Audit finding 包含 `repairKind`、`repairTarget`、`requiredClosure` 和 `status`。三种修正入口如下：

1. `decision`：确认修订方向后使用 `stage1 reopen`。
2. `project_spec`：确认字段旧值、新值、理由和来源后使用 `stage1 correct`。
3. `profile`：修复通用 Profile 后使用 `stage1 profile-refresh`。

`project_spec` 修正只允许替换 Architecture 或 Verification 的受控完整字段，不接受生成文档文本补丁。CLI 示例：

```powershell
node dist\src\cli.js stage1 correct E:\107\my_core STAGE2_ORDER_INCOMPLETE --patch-json '{"architecture":{"stage2Order":["frontend","core"]}}' --reason "补齐当前项目的 Stage2 实施顺序" --source "architecture/overview.md"
```

同一根因的多个 finding code 可以依次放在项目路径之后。Harness 将结构化事实写入 `.assistant/project.yaml`，重新生成现有正式文档，把旧 finding 标为 `superseded`，并将旧 audit 保存在审查历史中。修正完成后必须再次执行 `stage1 review` 和 `stage1 audit`。新 audit 通过后 Correction 状态才变为 `verified`。

审查通过后，由用户确认当前文档并批准：

```powershell
node dist\src\cli.js stage1 approve E:\107\my_core
```

批准会绑定 Architecture、Module Manifest、Research Memo 和 Verification Plan 的聚合哈希。批准后的文档发生变化时，对外状态显示为 `NEEDS_REVISION`，项目骨架和后续阶段门禁停止推进。

生成 Chisel 骨架并执行 smoke check：

```powershell
node dist\src\cli.js stage1 scaffold E:\107\my_core
node dist\src\cli.js stage1 complete E:\107\my_core
```

`STAGE1_COMPLETE` 表示全局架构、模块边界、验证策略和构建骨架已经闭合。Baseline RTL 在 Stage2 实现。

## 8. Stage2 模块开发

Stage2 只接受状态为 `STAGE1_COMPLETE` 且批准文档哈希未漂移的项目。初始化后，模块顺序来自 `architecture/modules.yaml`：

```powershell
node dist\src\cli.js stage2 init E:\107\my_core
node dist\src\cli.js stage2 status E:\107\my_core
node dist\src\cli.js stage2 next E:\107\my_core
```

为当前模块启动 Shadow Align：

```powershell
node dist\src\cli.js stage2 design E:\107\my_core regfile
```

Harness 将结果写入 `design/regfile.md`。Design 可以携带未决问题落盘，此时状态保持 `AWAITING_APPROVAL`，`stage2 next` 返回 `design_revision` 和完整缺口，批准门禁拒绝继续。用户回答后，通过附加指令让同一 Shadow 上下文修订：

```powershell
node dist\src\cli.js stage2 design E:\107\my_core regfile --instruction "读端口为两个组合读口，写口在时钟上升沿提交"
```

每个 Module ID 固定对应 `design/<module-id>.md`，Design 中的 `implementation.sourcePaths` 和 `implementation.testPaths` 声明该模块独占的实现路径。Harness 拒绝跨模块路径重叠。共享源码和集成文件也需要一个明确 owner。路径归属变化必须先修订 Design。

Design 闭合后，用户必须为该模块明确选择验证模式：

```powershell
node dist\src\cli.js stage2 approve E:\107\my_core regfile --verification-mode independent_workers
node dist\src\cli.js stage2 approve E:\107\my_core regfile --verification-mode active_only
```

`independent_workers` 在主验证通过后并行启动只读 Static Review Worker 和隔离 Verification Worker。`active_only` 由当前 Active Coding Agent 顺序完成静态自审和最终验证，正式记录包含 `independent: false` 与 `waivedByUser: true`。选择不从上一个模块继承。

批准后执行实现与验证：

```powershell
node dist\src\cli.js stage2 implement E:\107\my_core regfile
node dist\src\cli.js stage2 verify E:\107\my_core regfile
```

Active Coding 只提交批准路径内的完整文件内容。Harness 检查 Design 哈希、租约、state epoch、原文件哈希和允许路径后写入，再执行批准命令。实现发现 Design 缺口时必须返回理由和反例，Harness 自动重开 Design。用户也可以显式重开：

```powershell
node dist\src\cli.js stage2 reopen E:\107\my_core regfile --reason "同地址读写语义需要修正"
```

Harness 按任务加载 `design-chisel-processor` 与 `implement-chisel-processor`，将适用方法注入 Codex 上下文。Skill 名称和内容哈希随 Design、Implementation、Review 与 Task Envelope 记录，正文不复制到用户项目。

正式状态、批准和证据索引保存在 `.assistant/project.yaml`。Design 和验证摘要进入项目正式文档，Agent 原始事件、Task Envelope、结构化输出和验证副本进入项目同级 `.runtime/processor_agent/`。

## 9. Windows 与 WSL

`dual_issue_demo` 默认采用 Windows Control Plane 和 WSL Execution Runner：

1. Processor Agent 和 Codex CLI 在 Windows 运行。
2. Chisel、SBT 和 Verilator 命令在 WSL 运行。
3. 当前 Runner 支持将 `E:\path` 形式的盘符路径转换为 `/mnt/e/path`。
4. 原始 Agent 事件和审查中间结果保存到用户项目同级工作区的 `.runtime/processor_agent/`。
5. SBT、Verilator、波形和生成 RTL 不进入正式文档目录。

环境变化后，在批准前重新探测：

```powershell
node dist\src\cli.js stage1 probe E:\107\my_core
```

## 10. Profile 更新

未批准项目可以更新到同 ID 的新 Profile：

```powershell
node dist\src\cli.js stage1 profile-refresh E:\107\my_core
```

已经回答的 Decision 定义发生变化时，迁移会停止。只有 pending Decision 的建议失效时，可以显式丢弃旧建议后迁移：

```powershell
node dist\src\cli.js stage1 profile-refresh E:\107\my_core --reset-changed-advice
```

该操作会删除对应旧建议和失效的 Research Memo，随后需要重新运行 `stage1 research`。

用户确认需要用新版 Profile 默认目标和约束替换当前项目意图时，显式执行：

```powershell
node dist\src\cli.js stage1 profile-refresh E:\107\my_core --adopt-profile-defaults
```

## 11. 恢复与故障处理

正常关闭后，直接运行 `stage1 status` 即可恢复。常见阻塞处理：

1. 环境探测失败时修复对应工具，再运行 `stage1 probe`。
2. 正式草案被外部编辑时，Harness 停止覆盖并报告具体文件。
3. 独立审查失败时，根据 finding 的 `repairKind` 使用 `reopen`、`correct` 或 `profile-refresh`，再重新执行 `review` 和 `audit`。
4. Smoke check 失败时保留 `BLOCKED` 状态和命令输出，修复环境后重新运行 `complete`。
5. Research Task 报告 `Codex CLI authentication unavailable` 或 `Codex CLI authentication failed` 时运行 `codex login`，登录成功后重试同一 `stage1 research` 命令。已经启动的失败运行会把原始事件保存在工作区级 `.runtime/processor_agent/`。
6. Research Worker 报告项目文件不可访问时，检查运行记录中是否存在 `server=processor_project` 的 MCP 调用。新版 Worker 通过只读 Project Reader MCP 枚举、搜索和读取文件，不依赖 Shell 命令或交互会话的 execpolicy allowlist。
7. Stage2 Design 存在未决问题时继续与 Shadow Align 讨论并重新运行 `stage2 design`，不要手工补写 `.assistant/project.yaml`。
8. Stage2 实现或最终验证失败时查看 `stage2 status` 中的 blocker。修复必须经过原 Active Coding 租约，随后重新执行 `implement` 或 `verify`。

当前版本尚未提供批准后的 Architecture reopen，也未提供命令中断期间的多文件事务自动恢复。遇到这两类情况时，停止手工修改 `.assistant/`，先检查状态文件和正式文档差异。

## 12. 当前 Demo

实际演示项目位于 `E:\107\dual_issue_demo`。查看当前状态：

```powershell
processor-agent open E:\107\dual_issue_demo

node dist\src\cli.js stage1 status E:\107\dual_issue_demo
node dist\src\cli.js stage1 next E:\107\dual_issue_demo
```

当前 Profile 为 `0.7.0`。下一动作以 `stage1 next` 的磁盘状态为准。Stage1 达到 `STAGE1_COMPLETE` 后才能运行 `stage2 init`。该项目用于先生成一个保守的顺序双发射 baseline，再从同一冻结 commit 分别运行 Processor Agent 工作流和 Direct Codex 优化实验。
