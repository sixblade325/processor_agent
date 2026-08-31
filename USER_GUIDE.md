# Processor Agent 用户指南

## 1. 产品用途

Processor Agent 是本地运行的处理器开发工作流 Harness。它负责保存阶段状态、组织架构决策、调用 Codex CLI、生成正式文档、执行门禁，并在批准后建立 Chisel 项目骨架。

当前可用范围是 Stage1 Architecture Definition 和 Stage2 System Design 与 Work Package Development Loop。Stage3 优化闭环和本地 Web 工作台仍在开发。

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
│   └── overview.md           整核架构事实、Architecture Role 和决策
├── design/
│   ├── plan.md              Stage2 System Design
│   └── packages/            Package Design，按需创建
├── research/
│   └── stage1.md             Stage1 来源化调研结论
├── src/                      Chisel 源码和测试，按 Design 生成
├── verification/
│   ├── plan.md               验证策略和完成门禁
│   └── packages/            Work Package 验证记录，按需创建
└── .assistant/
    ├── project.yaml          Stage1/Stage2 当前状态、revision、哈希和历史索引
    ├── project-spec-history-<hash>.json.gz
    │                         Review Correction v2 的内容寻址压缩历史
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
2. 拒绝覆盖已有 `architecture/overview.md` 和 `verification/plan.md`。
3. 在缺少 Git 仓库时执行 `git init`。
4. 保存 Profile 快照和机器状态。
5. 执行 Profile 声明的环境探测。
6. 生成中文 Architecture、Research Memo 和 Verification Plan 草案。

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
2. `project_spec`：确认字段语义差异、理由、Evidence 和覆盖关系后使用 `stage1 correct`。
3. `profile`：修复通用 Profile 后使用 `stage1 profile-refresh`。

`project_spec` 修正只允许替换 Intent、Architecture 或 Verification 的受控完整字段，不接受生成文档文本补丁。Workspace Agent 会从当前失败 audit 自动取得 `findingSource`，用户确认的 Proposal 需要提供 `patch`、`rationale`、`evidenceSources` 和每个修改目标的 `evidenceCoverage`。CLI 示例：

Workspace Agent 不向用户回显 Proposal JSON。字符串数组以新增、删除和顺序变化展示；结构化集合按稳定 ID 展示变化；`architecture.roles` 按 Role ID 展示职责差异。未变化实体省略，完整结果由 Harness 写入现有正式文档。

```powershell
$proposal = @'
{"patch":{"intent":{"exclusions":["虚拟内存"]}},"rationale":"删除已经纳入 baseline 的旧 Cache 排除项。","evidenceSources":[{"id":"EV_USER","kind":"user_directive","locator":"INTENT_EXCLUSION_STALE","claim":"用户确认 baseline 包含 Cache，并要求排除项只保留虚拟内存。","locations":[]}],"evidenceCoverage":{"intent.exclusions":["EV_USER"]}}
'@
node dist\src\cli.js stage1 correct E:\107\my_core INTENT_EXCLUSION_STALE --proposal-json $proposal
```

同一根因的多个 finding code 可以依次放在项目路径之后，且必须包含当前第一个 open finding。Audit 报告只属于 `findingSource`，不能充当新值 Evidence。Decision、项目文档、Research 和 Profile Evidence 必须携带当前 revision、digest 或 fingerprint，`user_directive` 必须是可独立理解的完整规则。

Harness 将当前 ProjectSpec 保存在 `.assistant/project.yaml`，将基线和领域增量事件保存在内容寻址压缩 sidecar。Correction 索引不再重复保存大型字段的完整旧值和新值。Harness 重新生成现有正式文档，把旧 finding 标为 `superseded`，并将旧 audit 保存在审查历史中。修正完成后必须再次执行 `stage1 review` 和 `stage1 audit`。新 audit 通过后 Correction 状态才变为 `verified`。

旧 v1 Correction 需要显式迁移。先执行只读检查，确认文档哈希、批准哈希、重放哈希和体积报告，再由用户决定是否应用：

```powershell
node dist\src\cli.js stage1 correction-migrate E:\107\my_core --dry-run
node dist\src\cli.js stage1 correction-migrate E:\107\my_core --apply
```

迁移不会伪造旧记录缺失的 Evidence，这些记录标记为 `legacy_unresolved`。既有 approval 保持有效。Profile refresh 默认保留项目覆盖字段。用户确认某个字段重新由 Profile 管理时显式释放：

```powershell
node dist\src\cli.js stage1 release-override E:\107\my_core intent.exclusions
```

审查通过后，由用户确认当前文档并批准：

```powershell
node dist\src\cli.js stage1 approve E:\107\my_core
```

批准会绑定 Architecture、Research Memo 和 Verification Plan 的聚合哈希。批准后的文档发生变化时，对外状态显示为 `NEEDS_REVISION`，项目骨架和后续阶段门禁停止推进。

生成 Chisel 骨架并执行 smoke check：

```powershell
node dist\src\cli.js stage1 scaffold E:\107\my_core
node dist\src\cli.js stage1 complete E:\107\my_core
```

`STAGE1_COMPLETE` 表示全局架构、Architecture Role、验证策略和构建骨架已经闭合。Design Component、Interface Skeleton、Work Package 和 Chisel Module 边界在 Stage2 确定，Baseline RTL 也在 Stage2 实现。

## 8. Stage2 引导式实现

Stage2 只接受 `STAGE1_COMPLETE` 且 Architecture 批准哈希未漂移的项目。初始化后，Harness 生成唯一 `design/plan.md`，Agent A 形成 System Design 草案，Agent B 在独立可恢复上下文中审查。权威设计见 [PRODUCT_PLAN/STAGE2.md](./PRODUCT_PLAN/STAGE2.md)。

```powershell
node dist\src\cli.js stage2 init E:\107\my_core
node dist\src\cli.js stage2 status E:\107\my_core
node dist\src\cli.js stage2 next E:\107\my_core
```

schemaVersion 3 或 4 的项目必须先只读预检，再显式迁移：

```powershell
node dist\src\cli.js stage2 migrate E:\107\my_core --dry-run
node dist\src\cli.js stage2 migrate E:\107\my_core --apply
```

旧 Topology Decision、Plan、Worker run 和 Architecture Rework 只保留为 `legacyEvidence`。旧 Unit 边界和路径不会自动获得新的 System Design approval。

schemaVersion 4 项目的单一 `dependsOn` 会保守迁移为 Design、Implementation 和 Integration 三类依赖。Runtime entry 拆为 Session 与不可变 Run。已经批准的 Design 在哈希可验证时保留。schemaVersion 5 项目重复执行迁移时只清理 Runtime Registry 之外残留的 provider session ID。

运行两个 System Design Agent：

```powershell
node dist\src\cli.js stage2 start E:\107\my_core
```

`stage2 start` 先让 Agent A 生成 Component、Interface Skeleton、Work Package、路径 owner 和 Package DAG，再让 Agent B 独立审查。两者需要修订时继续运行：

```powershell
node dist\src\cli.js stage2 draft E:\107\my_core
```

Author 或 Reviewer 只为高风险未知项创建动态 `DecisionRequest`。`stage2 next` 一次返回一个当前用户门禁。用户可以选择候选或提交完整结论：

```powershell
node dist\src\cli.js stage2 decide E:\107\my_core <decision-id> <option-id>
node dist\src\cli.js stage2 decide E:\107\my_core <decision-id> --text "完整结论"
```

回答后旧草案和旧审查失效。再次运行 `stage2 draft`，直到独立 Review 通过且没有开放 Decision。用户审阅完整 `design/plan.md` 后可以批准，也可以登记修订要求：

```powershell
node dist\src\cli.js stage2 approve E:\107\my_core
node dist\src\cli.js stage2 revise E:\107\my_core --revision 3 --instruction "Issue 逻辑进入 Instruction Queue，删除独立 Issue Component。"
```

`stage2 revise` 只接受当前待批准的 System Design revision。Harness 绑定当前文档 hash、持久化 instruction、失效旧 Review，并返回 `SYSTEM_DESIGN_DRAFT`。Author 尚未启动时，重复执行相同 revision 的命令会更新 pending Revision Request。随后运行 `stage2 draft`，Agent A 自动读取该请求，Agent B 重新独立审查。PowerShell `.cmd` 对多行参数可能截断，第一版请把多项要求组织在一个单行参数中。

System Design 批准后，Harness 建立 Work Package board 并把第一个 ready Package 分配给 Shadow Agent：

```powershell
node dist\src\cli.js stage2 advance E:\107\my_core
```

Harness 将结果写入 `design/packages/wp_regfile.md`。Package Design 可以携带未决问题，此时保持 `AWAITING_APPROVAL`。正常机器动作都通过 `stage2 advance` 派发。用户回答后需要精确修订同一 Package 时使用诊断入口：

```powershell
node dist\src\cli.js stage2 design E:\107\my_core wp_regfile --instruction "读端口为两个组合读口，写口在时钟上升沿提交"
```

每个 Work Package 固定拥有自己的 Component、Design 文档、源码路径和测试路径。Harness 拒绝 path owner 重叠。Package Design 改变 shared interface 时无法批准，必须先修订 System Design。

Package Design 闭合后由用户批准：

```powershell
node dist\src\cli.js stage2 approve E:\107\my_core wp_regfile
```

批准后继续推进：

```powershell
node dist\src\cli.js stage2 advance E:\107\my_core
```

`stage2 implement` 与 `stage2 verify` 保留为精确重试入口。一次 `stage2 advance` 可以同时运行一个 Active Implementation 和一个 Shadow Package Design。

旧 Verification Worker 因 `COMMAND_EXECUTION_BLOCKED` 或 `REVIEW_SCOPE_INCOMPLETE` 留下基础设施 blocker 时，修复 Harness 后直接重跑 `stage2 verify`。Harness 会复核批准 Design、实现哈希和文件状态，再恢复独立验证，不会要求 Active Agent 重写源码。

Active Agent 只提交批准路径内的完整文件内容。Harness 检查 `stateEpoch`、Package revision、Design 哈希、assignment lease、原文件哈希和允许路径后写入，再执行批准命令。实现发现 Design 缺口时必须返回理由和反例，Harness 自动重开 Design。用户也可以显式重开：

```powershell
node dist\src\cli.js stage2 reopen E:\107\my_core wp_regfile --reason "同地址读写语义需要修正"
```

主验证通过后，Harness 总是创建两个独立短生命周期 Worker。Static Review Worker 只读检查 Design 一致性。Harness 在另一份冻结副本运行全部批准命令，Verification Worker 只读审查这份命令证据和验证覆盖。两者均通过后 Package 才进入 `COMPLETE`。

Agent A 与 Agent B 在 Shadow Design 和 Active Implementation 间轮转。当前 Active 进入 `VERIFYING` 后，无依赖、无 shared interface change 且路径不重叠的 Shadow Package 可以提前晋升。

Harness 按任务加载 `design-chisel-processor` 与 `implement-chisel-processor`。Skill 名称和内容哈希随 Design、Implementation、Review 与 Task Envelope 记录，正文不复制到用户项目。

正式状态、批准和证据索引保存在 `.assistant/project.yaml`。Design 和验证摘要进入项目正式文档，Agent 原始事件、Task Envelope、结构化输出和验证副本进入项目同级 `.runtime/processor_agent/`。

每个 Worker 只能通过 Task Envelope 中的 Read Manifest 读取项目。超范围访问返回 `read_scope_gap`，由 Harness 扩展范围后创建新 run。`stage2 status` 展示最近 run 的 queued、running、model completed、validation failed、applied、failed、cancelled 和 orphaned 状态。需要停止运行时使用：

```powershell
node dist\src\cli.js stage2 cancel E:\107\my_core <run-id-or-runtime-ref>
```

### 8.1 Stage2 返回 Stage1 Architecture Rework

System Design、Package Design、Implementation 或 Verification 证明已批准 Architecture 有误时，Workspace Agent 先形成单一修正目标的 Architecture Rework Proposal。Proposal 必须包含来源、Stage1 修正目标、闭合条件、Evidence、受影响 Component 和 Work Package。用户确认后启动返工：

```powershell
$rework = @'
{"summary":"Stage2 发现已批准 Architecture 缺少寄存器文件同拍语义。","rationale":"Package Design 无法在现有 Contract 下闭合。","source":{"kind":"unit_design","workPackageId":"wp_regfile"},"repair":{"kind":"decision","target":"S1_DEC_003"},"requiredClosure":["补齐同拍读写语义"],"evidenceSources":[{"id":"EV_USER","kind":"user_directive","locator":"S2_REWORK","claim":"用户确认该缺口属于 Stage1 Architecture，并要求正式返工。","locations":[]}],"affectedComponents":["regfile"],"affectedWorkPackages":["wp_regfile"]}
'@
node dist\src\cli.js stage2 rework-start E:\107\my_core --proposal-json $rework
```

Harness 会冻结 Stage2、释放全部 Agent assignment 并递增 workspace revision。`repair.kind=decision` 进入 Decision reopen；`repair.kind=project_spec` 创建当前失败 finding，并使用 Review Correction v2。完成新的 Stage1 Research、Review、Audit 和用户批准后恢复 Stage2：

```powershell
node dist\src\cli.js stage2 rework-resume E:\107\my_core
```

恢复时，Harness 撤销旧 System Design approval，使受影响 Work Package 及其 DAG 消费者进入 `NEEDS_REALIGN`，并失效对应 Package Design approval、Implementation 和 Verification。旧证据只保留哈希索引。未受影响 Package 的状态和证据继续保留。重新审查并批准 `design/plan.md` 后，Stage2 从第一个 ready 的 Package 继续。

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

Stage1 schemaVersion 1 或 Stage2 schemaVersion 2 的旧项目必须先执行顶层产品迁移。先只读预检，确认保留的 Decision、Correction、历史重放哈希、退役文件和 Stage2 失效范围，再显式应用：

```powershell
node dist\src\cli.js migrate E:\107\my_core --profile dual_issue_demo --dry-run --json
node dist\src\cli.js migrate E:\107\my_core --profile dual_issue_demo --apply --json
```

顶层迁移将 Intent 纳入 ProjectSpec，删除 Stage1 Module Manifest 和 `stage2Order`，并把 Global Protocol 改为 Architecture Role 关系。迁移不会替用户重新批准 Architecture。完成后必须运行 `stage1 review`、独立 `stage1 audit` 和用户 `stage1 approve`。旧 Stage2 schemaVersion 3 再通过 `stage2 migrate --dry-run|--apply` 进入 System Design 流程；存在活动 Architecture Rework 时，先完成 Stage1 新批准，再执行 `stage2 rework-resume`。

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
6. Research Worker 或 Stage2 Worker 报告项目文件不可访问时，检查运行记录中是否存在 `server=processor_project` 的 MCP 调用。新版 Worker 在新线程和恢复线程中都通过只读 Project Reader MCP 枚举、搜索和读取文件，不依赖 Shell 命令或交互会话的 execpolicy allowlist。
7. System Design Review 报告 Role 映射、owner、路径或 DAG 问题时，再次运行 `stage2 draft`。高风险未知项由 Agent 创建动态 DecisionRequest，用户回答后继续修订，不直接编辑 `design/plan.md`。
8. Package Design 存在未决问题时继续与 Shadow Align 讨论。局部字段缺口由 Patch 修订，语义变化才使用带 `--instruction` 的完整 Design 重生成。不要手工补写 `.assistant/project.yaml`。
9. Stage2 实现或最终验证失败时查看 `stage2 status` 中的 blocker 和 run 状态。修复必须经过原 Active assignment，正常恢复使用 `stage2 advance`，精确重试可以使用 `implement` 或 `verify`。
10. schemaVersion 3 或 4 项目报告需要迁移时，先执行 `stage2 migrate --dry-run`，确认保留 Evidence 与下一动作后执行 `--apply`。

Stage2 暴露已批准 Architecture 错误时使用 `stage2 rework-start`，禁止手工修改 `.assistant/`。当前版本未提供命令中断期间的多文件事务自动恢复。内容寻址 ProjectSpec history 先写新 sidecar，再原子替换状态；命令在状态替换前中断时旧状态仍可读取，可能遗留一个未引用 sidecar，需要检查后再清理。

## 12. 当前 Demo

实际演示项目位于 `E:\107\dual_issue_demo`。查看当前状态：

```powershell
processor-agent open E:\107\dual_issue_demo

node dist\src\cli.js stage1 status E:\107\dual_issue_demo
node dist\src\cli.js stage1 next E:\107\dual_issue_demo
```

该项目使用 Stage2 schemaVersion 5。具体 revision、当前 DecisionRequest、System Design Review、Package board 和 Runtime run 以 `stage2 status` 与 `stage2 next` 的磁盘结果为准，不在指南中维护易过期的状态副本。Harness 不会把迁移前的 Topology、Unit 或 Worker 记录自动升级为新批准。
