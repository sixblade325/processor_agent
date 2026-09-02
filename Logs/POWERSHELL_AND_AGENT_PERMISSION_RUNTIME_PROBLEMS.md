# PowerShell 与 Agent 权限 Runtime 问题

状态：第一代严重 Runtime 问题已确认，第二代最小修复方案待实施

记录时间：2026-09-01

关联材料：

1. [Windows 原生 Chisel 与 Verilator Toolchain Spike](./WINDOWS_NATIVE_CHISEL_VERILATOR_TOOLCHAIN_SPIKE.md)
2. [当前产品核心问题图谱](./CURRENT_PRODUCT_CORE_PROBLEM_MAP.md)
3. [Stage1 开发与实跑复盘](./STAGE1_RETROSPECTIVE.md)
4. [Stage2 Runtime 与并发重构记录](./STAGE2_RUNTIME_AND_CONCURRENCY_REFACTOR_PLAN.md)
5. [产品边界与简化重审记录](./PRODUCT_BOUNDARY_SIMPLIFICATION_REASSESSMENT.md)

本文单独记录第一代 `processor_agent` 中 Agent 与 PowerShell 冲突、Agent 权限不可预测两组严重 Runtime 问题。本文只定义证据、根因、第二代边界和验收条件，不修改 Harness、Runner、权限、当前 Demo 或用户环境。

## 1. 总体结论

第一代让 Agent 同时承担处理器工程判断和本机基础设施操作。Agent 需要生成或解释 PowerShell、`cmd`、Bash、WSL、路径转换、CLI 参数、登录状态和 sandbox 权限。

这形成两组独立问题：

```text
Agent 与 PowerShell 冲突
-> Prompt 和结构化数据经过 shell 字符串
-> 转义、编码、路径和命令策略进入模型推理

Agent 权限不可预测
-> Worker 启动后才发现读写或命令权限不足
-> 正式任务失败
-> Runtime Failure 被误认为 Research、Design 或实现缺口
```

第二代需要将本机执行全部收敛到结构化 Runner，将 Agent 权限收敛到项目初始化时可验证的 Capability Manifest。

## 2. 第一代 PowerShell 问题证据

### 2.1 大型结构化数据经过 CLI

第一代存在以下正式入口：

```text
stage1 correct ... --proposal-json <json>
stage2 rework-start ... --proposal-json <json>
```

Proposal 包含中文、路径、数组、换行和引号。通过 PowerShell 命令行传递时，需要调用方正确处理多层 JSON 和 shell 转义。真实使用中已经出现 JSON 引号被 shell 改写、CLI 报 `Invalid --proposal-json`、随后改用环境变量或 Node.js 中转的情况。

该问题说明业务 Artifact 不应通过命令行字符串传输。

### 2.2 Agent 生成自由形式命令

早期 Research Worker 使用 PowerShell、`rg` 或 `cmd /c` 读取项目。只读操作仍可能被 Codex execpolicy 拒绝，最终形成 `evidenceSufficient=false` 或任务中止。

第一代随后增加 Project Reader MCP，证明项目读取可以脱离 shell。Stage2 仍保留 shell quoting、Windows 到 WSL 路径转换和动态 Bash script。

### 2.3 Windows、Bash 和 WSL 多层解析

第一代命令链可以同时经过：

```text
Agent 输出
-> PowerShell 或 Node CLI
-> wsl.exe
-> bash -lc
-> SBT、Git、rg 或 EDA 工具
```

每层具有不同的引号、环境变量、工作目录和错误编码规则。Agent 在任一层做出的假设都可能破坏后续命令。

### 2.4 错误文本编码不稳定

Stage1 首次 WSL smoke check 返回 `CreateInstance/E_ACCESSDENIED`。错误文本以 UTF-16 字节形式进入 UTF-8 状态字段，导致恢复条件难以阅读。

这类错误属于 Runner 编码和进程边界问题，不应由 Agent根据乱码推断原因。

### 2.5 PowerShell 成为产品知识

为绕过环境问题，Workspace Agent 需要知道：

1. 当前位于 PowerShell、`cmd` 或 Bash。
2. 如何引用 Windows 路径和 WSL 路径。
3. 如何保存大型 JSON。
4. 如何调用登录状态命令。
5. 哪些命令会被执行策略拒绝。
6. 如何从失败命令恢复。

这些知识没有提高处理器 Architecture Fidelity，也没有缩短设计闭合过程。

## 3. 第一代 Agent 权限问题证据

### 3.1 只读 sandbox 仍无法完成项目读取

第一代 Research Worker 被配置为 read-only，Worker 仍可能无法通过 Shell、PowerShell、`rg` 或 `cmd /c` 读取允许范围内的项目文件。权限名称与实际可用能力不一致。

### 3.2 权限失败发生在模型运行后

Worker 已经消耗模型调用和上下文后，才在工具调用阶段发现：

1. 命令被 policy 拒绝。
2. 路径不在 sandbox 范围内。
3. 文件无法读取。
4. worktree 无写权限。
5. 网络或认证不可用。
6. WSL 进程无法启动。

该顺序造成模型成本浪费，也让用户误以为 Agent 正在处理设计问题。

### 3.3 权限与 Design Work Package 耦合

第一代将 Work Package 同时作为 Design、源码路径、Agent assignment 和权限单位。硬件逻辑拓扑发生修订时，权限拓扑也需要迁移。

这种耦合导致：

1. Design 修订可能使合法 Worker result 失效。
2. 权限配置进入用户 Design 文档。
3. 局部实现路径变化需要修改 Harness 状态。
4. Agent 角色和模块边界相互约束。

### 3.4 过宽与过窄权限同时存在

部分 Worker 读取范围无界，可以搜索无关源码、遗产和 Runtime。部分 Worker 又无法执行允许范围内的只读命令。产品缺少统一、可预检且与具体 Task 绑定的 Capability 模型。

### 3.5 权限失败污染 Domain 流程

权限或执行策略失败曾造成：

1. Research Evidence 不充分。
2. Design Task 中止。
3. 用户无法判断是否需要重新调研。
4. Harness 进入恢复门禁。
5. 环境问题与 Architecture 缺口混合呈现。

Runtime Failure 不应产生 Architecture、Design、Correction 或 Rework。

## 4. 两组问题的共同根因

### 4.1 Agent 直接操作基础设施

Agent 同时决定做什么和如何调用本机 shell。模型输出具有概率性，本机命令要求确定性，两者缺少结构化边界。

### 4.2 Task 没有完整执行契约

第一代 Worker 启动时没有统一保证以下条件全部成立：

1. 输入 Artifact 已冻结。
2. 读取范围可用。
3. 写入范围可用。
4. 允许命令可执行。
5. 网络和认证满足要求。
6. timeout 和 cancel 可用。
7. 输出位置可以持久化。

### 4.3 Runtime Failure 模型不独立

权限、shell、工具链和编码问题被嵌入 Stage1 或 Stage2 状态。每类环境事故推动一个新门禁、恢复入口或特殊状态。

### 4.4 CLI 承担了内部 IPC

CLI 同时面向用户和 Harness 内部调用。大型 Proposal、Agent Result 和状态迁移通过字符串参数传递，导致 PowerShell 参与内部数据协议。

## 5. 第二代核心原则

第二代采用以下规则：

1. Agent 只提出 Artifact Patch、Task Intent 和 Runner Command ID。
2. Agent 不生成可以直接执行的 shell 命令。
3. Runner 只接受预注册 Command Spec。
4. Prompt、Proposal、Result 和 Evidence 通过文件、stdin 或本地 IPC 传递。
5. 每个 Task 启动前完成真实权限预检。
6. 每个 Worker 只获得当前 Task 所需能力。
7. Implementation Worker 只写隔离 Git worktree。
8. Runtime Failure 只改变 Task 和 Run。
9. Architecture 和 Design 不保存 shell、sandbox、Lease 或权限状态。
10. 用户只处理安装、网络、工作区外访问等明确授权。

## 6. 结构化 Runner

目标调用关系为：

```text
Agent
-> Runner Command ID
-> Command Registry
-> Node.js spawn or execFile
-> Process
-> Structured Result
```

Command Spec 示例：

```yaml
id: unit-test
executable: <resolved-toolchain-executable>
args:
  - -batch
  - test
cwd: <isolated-worktree>
timeoutMs: 900000
encoding: utf8
allowedExitCodes:
  - 0
```

Runner 规则：

1. 使用参数数组，不拼接命令字符串。
2. 禁止 `shell: true`。
3. 禁止 Agent 提供 executable、cwd 和环境变量。
4. 禁止业务流程使用 `powershell -Command` 和 `cmd /c`。
5. 必须记录 resolved executable、args、cwd、env digest 和 timeout。
6. 必须流式保存 stdout、stderr、心跳和退出状态。
7. 必须支持真实进程树终止。
8. 必须对 UTF-8、UTF-16LE、BOM 和 NUL 分布进行规范化。
9. 必须返回结构化 `RunResult` 或 `RuntimeFailure`。

## 7. Artifact 与 IPC

以下数据不得通过普通命令行参数传输：

1. Prompt。
2. Architecture 或 Design Proposal。
3. Patch。
4. Evidence。
5. Agent Result。
6. 大型自然语言 instruction。

第二代使用：

```text
task-envelope.json
capability-manifest.json
agent-result.json
run-result.json
stdout.jsonl
stderr.log
```

CLI 参数只传递短 ID 和路径：

```text
processor-agent run --task <task-id>
processor-agent approve --artifact <artifact-id> --revision <revision>
```

用户自然语言通过 Workspace Agent 或本地 IPC 进入产品，不经过 shell 插值。

## 8. Capability Manifest

每个 Task 创建显式能力清单：

```yaml
taskId: implement-frontend
read:
  roots:
    - architecture
    - design
    - verification
    - src/main/scala
    - src/test/scala
  files:
    - build.sbt
    - project/build.properties
write:
  worktree: <isolated-worktree-id>
  roots:
    - src/main/scala/dualissue/frontend
    - src/test/scala/dualissue/frontend
commands:
  - compile
  - unit-test
network:
  enabled: false
timeoutMs: 1800000
```

Capability Manifest 只描述当前 Task 的运行权限，不表达处理器模块职责或 Design 拓扑。

## 9. Capability Doctor

Worker 启动前必须执行真实预检。

### 9.1 Read Doctor

1. 读取每个允许 root 中的测试文件。
2. 读取每个显式 entry file。
3. 确认路径 canonicalization 后仍位于项目内。
4. 确认 symlink 或 junction 不能逃逸范围。
5. 确认 Manifest 外探测被拒绝。

### 9.2 Write Doctor

1. 创建隔离 Git worktree。
2. 在允许 root 创建临时文件。
3. 修改并恢复临时文件。
4. 验证主工作树保持不变。
5. 验证 `.assistant/` 和批准 Artifact 不可写。

### 9.3 Command Doctor

1. 解析每个 Runner Command ID。
2. 验证 executable 存在。
3. 验证 cwd 和环境变量有效。
4. 运行固定的无副作用 probe。
5. 验证 timeout 和 cancel。

### 9.4 Network Doctor

1. `network.enabled=false` 时不执行网络探测。
2. Research Task 需要网络时，在模型启动前验证目标能力。
3. 登录或认证失败直接返回 Runtime Failure。

任何 Doctor 失败都会阻止 Worker 启动。

## 10. 串行 Worker 权限模型

第二代 Alpha 暂时只有一个活动 Worker，权限仍按 Task 变化。

| Task 类型 | 项目读取 | 项目写入 | Runner | 网络 |
|---|---|---|---|---|
| Research | Manifest 内只读 | 无 | 无或固定 probe | 显式开启 |
| Architecture Draft | 正式 Artifact 只读 | 只输出 Patch | 无 | 默认关闭 |
| Design Draft | 正式 Artifact 与 Source 只读 | 只输出 Patch | 固定只读检查 | 默认关闭 |
| Implementation | Artifact 与允许 Source 只读 | 隔离 worktree 允许路径 | compile、test | 关闭 |
| Verification | Artifact、Source、测试和 Run Evidence 只读 | 只输出 Review | test result review | 关闭 |

逻辑 Worker 可以持续复用同一任务槽位。每次 Task 都创建新的 Capability Manifest、Run ID 和隔离输出目录。

## 11. Runtime Failure 分类

第二代最小分类为：

```text
environment_not_ready
permission_denied
command_not_allowed
tool_not_found
authentication_failed
path_invalid
encoding_error
timeout
cancelled
process_failed
agent_result_invalid
```

每个 Runtime Failure 至少保存：

1. Task ID 和 Run ID。
2. 失败阶段。
3. Capability Manifest digest。
4. Toolchain digest。
5. 结构化错误类型。
6. 用户可读原因。
7. 可执行恢复动作。
8. stdout 和 stderr 路径。

恢复只创建新的 Run 或修订 Task。正式 Artifact 不发生变化。

## 12. PowerShell 的最终职责

第二代 Windows 版本中，PowerShell 只承担：

1. 用户显式启动或停止本地服务。
2. 首次 Toolchain bootstrap。
3. 人工 doctor 和故障诊断。
4. 薄客户端查询。

PowerShell 不承担：

1. Agent Prompt 传输。
2. Proposal 和 Result 传输。
3. Agent 自由命令执行。
4. 处理器构建命令拼接。
5. 路径授权和权限升级。
6. Artifact 状态迁移。

正式 Runtime 可以直接调用 `.exe`，或调用固定 MSYS2 Runner script。Agent 无法看到或修改底层 shell 实现。

## 13. 用户授权边界

以下操作需要用户明确授权：

1. 安装或更新 Toolchain。
2. 访问项目根目录外文件。
3. 开启 Research 网络访问。
4. 使用系统级凭据。
5. 执行需要管理员权限的操作。
6. 修改全局 Codex 或系统配置。

普通 Architecture、Design、Implementation 和 Verification Task 不应在运行中请求临时权限升级。需要新增能力时，Task 在启动前停止并展示差异化 Capability Manifest。

## 14. 第二代 Alpha 最小实现范围

提交前只实现：

1. 使用文件替代 `--proposal-json`。
2. 固定 Runner Command Registry。
3. Node.js 参数数组进程启动。
4. Capability Manifest。
5. Read、Write 和 Command Doctor。
6. 串行 Worker 的隔离 Git worktree。
7. Runtime Failure 分类。
8. UTF 编码规范化。
9. timeout 和真实 cancel。

以下内容延期：

1. 团队 RBAC。
2. 远程 Worker 权限。
3. 多租户凭据管理。
4. 动态提权。
5. 多 Agent 并发权限合并。
6. 任意第三方 shell Adapter。

## 15. 验收测试

### 15.1 PowerShell 隔离

1. 中文、换行、单引号和双引号不会破坏 Task Envelope。
2. 大于 100 KB 的 Proposal 不经过命令行。
3. 项目路径包含空格时 Runner 正常工作。
4. Agent 输出 shell 命令时 Harness 拒绝执行。
5. Runner 日志可以稳定显示 UTF-8 和 Windows 错误文本。
6. 产品正常主路径不启动 `powershell -Command` 或 `cmd /c`。

### 15.2 权限

1. Worker 可以读取 Manifest 内文件。
2. Worker 无法读取 Manifest 外路径。
3. Implementation Worker 只能写隔离 worktree 的允许 root。
4. Worker 无法修改主工作树、`.assistant/` 和已批准 Artifact。
5. 权限不足在模型启动前失败。
6. 网络关闭时 Worker 无法启动网络工具。
7. 合法代码 diff 可以通过 Harness 校验并进入用户批准。

### 15.3 失败隔离

1. Permission Failure 不修改 Architecture 和 Design。
2. Runner timeout 能终止真实进程树。
3. 失败 Run 可以使用同一 Task 创建新 Run。
4. 重启服务后可以识别未完成 Run。
5. Product 与 Direct 实验可以共用相同 Runner 和权限基线。

## 16. 实验门禁

Product 与 Direct 对照实验启动前必须确认：

1. 两组使用相同 Toolchain lock。
2. 两组使用相同 Runner Command Registry。
3. 两组使用相同 workspace write root。
4. 两组具有相同构建和验证权限。
5. Product 组额外能力只包含 Processor Agent Artifact、Skill 和工作流。
6. Direct 组不能读取 Product 组文档和状态。
7. 任一环境或权限失败都从产品效果统计中单独报告。

PowerShell 和权限不能成为实验组差异。

## 17. 当前结论

PowerShell 问题的修复目标是取消 shell 对内部数据协议和业务执行的控制。Agent 权限问题的修复目标是在模型启动前证明当前 Task 的最小能力集合真实可用。

两项修复均属于第二代 Runtime 最小内核。Windows 原生 Toolchain Spike 通过后，跨系统边界可以删除，剩余环境设计集中在结构化 Runner、Capability Doctor 和隔离 worktree。
