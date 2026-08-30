# Processor Agent 用户指南

## 1. 产品用途

Processor Agent 是本地运行的处理器开发工作流 Harness。它负责保存阶段状态、组织架构决策、调用 Codex CLI、生成正式文档、执行门禁，并在批准后建立 Chisel 项目骨架。

当前可用范围是 Stage1 Project Bootstrap。Stage2 模块设计与实现、Stage3 优化闭环和本地 Web 工作台仍在开发。

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
├── research/                 来源化调研结论，按需创建
├── verification/
│   └── plan.md               验证策略和完成门禁
└── .assistant/
    ├── project.yaml          Stage1 状态、revision、哈希和历史
    └── profile.yaml          当前项目使用的 Profile 快照
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

`open` 会先校验 Stage1 项目和 Codex CLI，再把固定的 Workspace Agent 协议作为初始任务交给 Codex。Agent 随后自动读取项目 `AGENTS.md`、查询 `stage1 status` 和 `stage1 next`，每轮只展示一个待确认决策。

用户可以直接使用自然语言：

```text
继续
为什么推荐 rv32i？
我选择 rv32i，因为第一版先控制验证范围
这项先延期到进入 LSU Design 前
检查全部架构文档
我确认批准当前架构
```

Workspace Agent 负责把这些回答映射为 `advise`、`answer`、`custom`、`defer`、`review`、`audit` 和 `approve`。Harness 负责提交状态转换和文档更新。推荐、delegated decision 与 Architecture Approval 都保留显式用户确认门禁。

直接运行 `codex` 只会启动通用 Codex 会话，Harness 不会自动接收用户输入。Processor Agent 的自然语言入口固定为 `processor-agent open <path>`。

检查启动协议但不打开交互界面：

```powershell
processor-agent open E:\107\my_core --print-prompt
```

## 6. 完成架构决策

每个 Decision Packet 包含已知事实、候选方案、推荐、后果和影响产物。推荐只代表 Agent 建议，最终结论由用户确认或显式授权。

生成来源化建议：

```powershell
node dist\src\cli.js stage1 advise E:\107\my_core S1_DEC_001
```

同一 Decision 已有有效建议时，`advise` 直接复用 `.assistant/advice/` 中的结果，不重复调用 Codex。需要重新调研时显式刷新：

```powershell
node dist\src\cli.js stage1 advise E:\107\my_core S1_DEC_001 --refresh
```

接受某个候选方案：

```powershell
node dist\src\cli.js stage1 answer E:\107\my_core S1_DEC_001 rv32i
```

记录自定义方案：

```powershell
node dist\src\cli.js stage1 custom E:\107\my_core S1_DEC_001 --text "自定义结论" --note "选择理由"
```

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

## 8. Windows 与 WSL

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

## 9. Profile 更新

未批准项目可以更新到同 ID 的新 Profile：

```powershell
node dist\src\cli.js stage1 profile-refresh E:\107\my_core
```

已经回答的 Decision 定义发生变化时，迁移会停止。只有 pending Decision 的建议失效时，可以显式丢弃旧建议后迁移：

```powershell
node dist\src\cli.js stage1 profile-refresh E:\107\my_core --reset-changed-advice
```

该操作会删除对应旧建议和失效的 Research Memo，随后需要重新运行 `stage1 advise`。

用户确认需要用新版 Profile 默认目标和约束替换当前项目意图时，显式执行：

```powershell
node dist\src\cli.js stage1 profile-refresh E:\107\my_core --adopt-profile-defaults
```

## 10. 恢复与故障处理

正常关闭后，直接运行 `stage1 status` 即可恢复。常见阻塞处理：

1. 环境探测失败时修复对应工具，再运行 `stage1 probe`。
2. 正式草案被外部编辑时，Harness 停止覆盖并报告具体文件。
3. 独立审查失败时，先修正 Profile 或用户决策，再重新执行 `review` 和 `audit`。
4. Smoke check 失败时保留 `BLOCKED` 状态和命令输出，修复环境后重新运行 `complete`。

当前版本尚未提供批准后的显式 reopen，也未提供命令中断期间的多文件事务自动恢复。遇到这两类情况时，停止手工修改 `.assistant/`，先检查状态文件和正式文档差异。

## 11. 当前 Demo

实际演示项目位于 `E:\107\dual_issue_demo`。查看当前状态：

```powershell
processor-agent open E:\107\dual_issue_demo

node dist\src\cli.js stage1 status E:\107\dual_issue_demo
node dist\src\cli.js stage1 next E:\107\dual_issue_demo
```

该项目用于先生成一个保守的顺序双发射 baseline，再从同一冻结 commit 分别运行 Processor Agent 工作流和 Direct Codex 优化实验。
