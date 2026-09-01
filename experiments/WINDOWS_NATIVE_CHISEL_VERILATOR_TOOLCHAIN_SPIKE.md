# Windows 原生 Chisel 与 Verilator Toolchain 可行性及 Spike 计划

状态：Windows 原生方案具备可行性，正式架构决策等待 Toolchain Spike

记录时间：2026-09-01

关联材料：

1. [当前产品核心问题图谱](./CURRENT_PRODUCT_CORE_PROBLEM_MAP.md)
2. [Stage2 Runtime 与并发重构记录](./STAGE2_RUNTIME_AND_CONCURRENCY_REFACTOR_PLAN.md)
3. [产品边界与简化重审记录](./PRODUCT_BOUNDARY_SIMPLIFICATION_REASSESSMENT.md)
4. [Chisel 官方安装文档](https://www.chisel-lang.org/docs/installation)
5. [Verilator 官方 Windows CMake 安装文档](https://github.com/verilator/verilator/blob/master/docs/guide/install-cmake.rst)
6. [MSYS2 Verilator 包](https://packages.msys2.org/base/mingw-w64-verilator)
7. [MSYS2 UCRT64 环境说明](https://www.msys2.org/docs/environments/)
8. [YosysHQ OSS CAD Suite](https://github.com/YosysHQ/oss-cad-suite-build)

本文记录第二代 `processor_agent` 将 Chisel、firtool、Verilator 和 CoreMark 工具链统一到 Windows 的候选方案。本文只定义可行性、项目初始化边界、Runner 契约和 Spike 门禁，不安装工具、不修改 Harness、不改变当前 Demo 状态。

## 1. 决策候选

第二代可以取消 Windows Control 与 Linux/WSL Execution 的双系统架构，改为全部持久运行在 Windows：

```text
Windows
├── processor-agentd
├── Workspace Agent
├── Codex Worker
├── Git Worktrees
├── Java、SBT、Chisel 和 firtool
└── Runner
    └── MSYS2 UCRT64
        ├── Verilator
        ├── GCC
        └── Make
```

该方案成立需要满足：

1. Chisel 7.14.0 可以在 Windows 稳定编译和 elaboration。
2. Chisel 管理的 firtool 可以稳定生成 SystemVerilog。
3. MSYS2 UCRT64 Verilator 可以编译生成的 SystemVerilog。
4. 生成的 C++ 可以在 Windows 链接和执行。
5. CoreMark 仿真不依赖 WSL 专属行为。
6. Node.js Runner 可以绕过 Agent 和 PowerShell，确定性启动全部命令。
7. Codex sandbox 可以在隔离 worktree 中获得可预检的读写权限。

在全部 Spike 门禁通过前，“第二代必须持久运行在 Linux”继续作为回退方案。Spike 通过后，第二代正式改为 Windows 原生持久运行。

## 2. 当前机器事实

2026-09-01 的只读检查结果为：

| 项目 | 当前状态 |
|---|---|
| 项目 Scala | 2.13.18 |
| 项目 Chisel | 7.14.0 |
| 项目 SBT | 1.12.11 |
| Java | Temurin 17.0.19 |
| Windows SBT | 已安装并可启动 |
| MSYS2 | 已安装在 `D:\msys64` |
| UCRT64 `make` | 已存在 |
| UCRT64 `g++` | 已存在 |
| Verilator | 当前不在 Windows `PATH` |
| firtool | 当前不在 Windows `PATH` |

Chisel 6 以后会在多数系统中管理匹配版本的 firtool，因此 `firtool` 不在全局 `PATH` 不能直接判定 elaboration 失败。项目初始化需要实际运行 Chisel 到 SystemVerilog 的完整 smoke test，并记录 Chisel 最终解析的 firtool 路径和版本。

## 3. 上游支持情况

### 3.1 Chisel

Chisel 官方安装文档提供 Windows 的 Java、SBT 和 Mill 安装方式，并说明 Chisel 6 以后在多数系统中管理 firtool。当前项目使用的 Java 17、Scala 2.13.18 和 Chisel 7.14.0 符合官方兼容范围。

官方文档同时提示 Windows 使用体验仍有改进空间，因此产品不能依赖任意用户环境。第二代需要固定工具版本并运行端到端初始化检查。

### 3.2 Verilator

Verilator 官方文档提供 Windows MSVC 与 CMake 构建方式，并将 Windows MSVC 列为测试平台之一。MSYS2 当前提供 UCRT64、CLANG64 和 MINGW64 的 Verilator 二进制包。

本机已有 UCRT64 GCC 和 Make，最小 Spike 优先使用：

```text
mingw-w64-ucrt-x86_64-verilator
```

MSYS2 当前包版本为 5.050-1。MSYS2 是滚动发行环境，Spike 成功后必须保存精确包版本、下载摘要和依赖快照，不能在正式实验中无锁更新。

### 3.3 OSS CAD Suite

Chisel 官方文档推荐 Windows 用户评估 YosysHQ OSS CAD Suite。OSS CAD Suite 提供 Windows x64 构建，也明确建议 Windows 用户在 WSL 中使用 Linux x64 版本获得更稳定体验。

当前候选方案以 MSYS2 UCRT64 为第一选择。OSS CAD Suite 作为备选 Toolchain Adapter，不与 MSYS2 混用同一次实验环境。

## 4. 项目初始化的新边界

第二代项目进入 Stage1 前，必须先完成 Workspace Initialization：

```text
Workspace Initialization
-> Toolchain Resolve
-> Environment Doctor
-> Codex Capability Doctor
-> Minimal Chisel to Verilator Smoke Test
-> toolchain.lock
-> Project Scaffold
-> Stage1
```

规则：

1. Toolchain 初始化属于 Runtime，不属于 Stage1。
2. 初始化失败不能生成 Architecture Decision、Correction 或 Rework。
3. 初始化成功后，Stage1 和 Stage2 只使用锁定工具链。
4. 工具链漂移使新的 Run 失效，不修改已批准 Artifact。
5. 用户项目导入时执行相同 doctor，并记录现有环境与目标锁的差异。
6. 安装操作需要一次明确授权，后续正常运行不再请求系统权限。

## 5. Windows Toolchain Bundle

第二代候选 Toolchain Bundle 包含：

```text
Java 17
SBT launcher
Scala and Chisel dependencies
Chisel resolved firtool
MSYS2 UCRT64 runtime
Verilator
GCC
Make
fixed Runner scripts
```

缓存候选位置为：

```text
%LOCALAPPDATA%\processor-agent\toolchains\windows-x64\<digest>\
```

用户项目只保存 `toolchain.lock`，不复制完整 JDK、MSYS2 和 Maven 缓存。

第一版可以复用本机已安装的 Java、SBT 和 MSYS2。正式第二代需要支持下载经过验证的 Bundle 或检查用户安装是否与锁一致。

## 6. toolchain.lock

项目初始化成功后生成可读锁文件：

```yaml
schemaVersion: 1
platform: windows-x64
java:
  vendor: Temurin
  version: 17.0.19
sbt:
  version: 1.12.11
scala:
  version: 2.13.18
chisel:
  version: 7.14.0
firtool:
  version: resolved-by-chisel
  path: <absolute-toolchain-path>
msys2:
  environment: UCRT64
  snapshot: <package-database-digest>
verilator:
  package: mingw-w64-ucrt-x86_64-verilator
  version: 5.050-1
gcc:
  version: <resolved-version>
make:
  version: <resolved-version>
toolchainDigest: <sha256>
```

正式格式需要避免在 Git 中保存不可迁移的用户绝对路径。上例中的绝对路径只用于 Runtime 解析结果，仓库版本应保存 Bundle ID、相对路径和 digest。

## 7. Runner 契约

Agent 不调用 PowerShell、Bash、SBT、Verilator、GCC 或 Make。Agent 只请求固定 Runner Command ID：

```text
toolchain-smoke
compile
elaborate
unit-test
integration-test
coremark
```

Node.js Runner 负责：

1. 使用 `spawn` 或 `execFile` 和参数数组启动进程。
2. 禁止 `shell: true` 和自由形式命令字符串。
3. 设置固定 executable、args、cwd、env 和 timeout。
4. 为 MSYS2 设置 UCRT64 环境。
5. 将 Windows 路径确定性转换为 MSYS2 路径。
6. 统一规范化 stdout、stderr 和 JSONL 为 UTF-8。
7. 保存 PID、心跳、退出码和不可变日志。
8. 支持真实超时和子进程终止。

MSYS2 内部仍使用 POSIX 兼容环境。该细节只存在于 Runner Adapter 中，不暴露给 Workspace Agent、Worker 或用户 Design 流程。

## 8. PowerShell 边界

Windows 原生工具链不能自动消除 Agent 与 PowerShell 的冲突。第二代仍需明确：

1. PowerShell 只用于一次性 bootstrap、人工诊断和薄客户端启动。
2. Prompt、Proposal 和大型 JSON 通过文件、stdin 或本地 HTTP body 传递。
3. 业务参数不经过 PowerShell 字符串插值。
4. Runner 不拼接 `powershell -Command` 或 `cmd /c`。
5. Agent 输出命令文本不能直接执行。
6. 所有业务执行通过固定 Runner Command ID。

纯 Windows 架构可以消除 Windows 与 WSL 的路径、认证、工具版本和进程边界。PowerShell 仍需要通过结构化 Runner API 隔离。

## 9. Agent 权限边界

Windows 原生工具链也不能自动解决 Codex sandbox 权限问题。项目初始化必须增加 Capability Doctor：

1. 验证 Agent 可以读取批准的 Architecture、Design、Source 和 Verification。
2. 验证 Agent 无法读取 Read Manifest 外路径。
3. 在隔离 Git worktree 中执行受控写入和删除测试。
4. 验证 Agent 无法修改主工作树和 `.assistant/`。
5. 验证 Agent 可以请求固定 Runner Command ID。
6. 验证 Agent 无法执行任意 shell 命令。
7. 验证权限不足在正式模型任务启动前被发现。

权限失败生成 `RuntimeFailure.permission_denied`，只影响 Task 和 Run。

## 10. Toolchain Spike

Spike 时间预算为两小时。全部操作在独立临时工作区完成，不修改 `dual_issue_demo` 正式状态。

### 10.1 Phase A：工具解析

1. 验证 Java 17 和 SBT 1.12.11。
2. 验证 Scala 2.13.18 和 Chisel 7.14.0 依赖解析。
3. 查询并记录 Chisel 对应的 firtool 版本。
4. 安装或解析 MSYS2 UCRT64 Verilator。
5. 记录 GCC、Make、Perl 和 Verilator 版本。

### 10.2 Phase B：Chisel 到 SystemVerilog

1. 编译最小 Chisel Module。
2. 执行 elaboration。
3. 调用 Chisel 解析的 firtool。
4. 生成 SystemVerilog。
5. 检查输出文件、退出码和日志编码。

### 10.3 Phase C：SystemVerilog 到可执行仿真

1. 使用 MSYS2 UCRT64 Verilator 编译 SystemVerilog。
2. 生成 C++ 仿真模型。
3. 使用同一 UCRT64 GCC 和 Make 编译链接。
4. 运行 Windows 仿真程序。
5. 检查预期输出和退出码。

### 10.4 Phase D：真实项目 Smoke

1. 在独立 worktree 中运行 `dual_issue_demo` compile。
2. 对最小已实现模块执行 Chisel 到 Verilator 流程。
3. 运行至少一个 ScalaTest 和一个 Verilator test。
4. 验证路径位于外置硬盘时行为一致。
5. 重复运行一次并比较结果摘要。

### 10.5 Phase E：权限与 Runner

1. Node.js 使用参数数组启动全部命令。
2. Agent 无需生成 PowerShell 或 Bash 命令。
3. Read Manifest 和 write root 检查通过。
4. 超时可以终止真实子进程。
5. Runtime Failure 不修改 Architecture 或 Design。

## 11. Spike 通过条件

全部条件必须满足：

1. Chisel compile 和 elaboration 成功。
2. firtool 生成合法 SystemVerilog。
3. Verilator 编译成功。
4. C++ 仿真程序链接并执行成功。
5. 一个真实 Chisel test 通过。
6. 第二次执行不依赖手工环境修复。
7. 全部版本和路径可以写入锁文件。
8. Node Runner 不使用自由形式 PowerShell 命令。
9. 外置硬盘工作区没有路径或权限错误。
10. 失败和日志可以被稳定分类与读取。

以下情况判定 Spike 失败：

1. 需要 Agent 临场修改 PATH、转义或 shell 命令。
2. Verilator 只能在未锁定的交互式 MSYS2 shell 中工作。
3. firtool 在 Windows 上不稳定退出。
4. 仿真依赖无法归档的全局环境状态。
5. Codex sandbox 无法获得稳定且最小的项目权限。
6. 两小时内无法形成可重复的最小闭环。

## 12. 失败回退

Spike 失败后采用单一 Linux Runtime：

```text
processor-agentd、Codex Worker、Runner、SBT 和 Verilator
全部运行在 WSL 或 Linux 原生文件系统
```

失败原因写入 Runtime 实验记录，不进入 Architecture 或 Design。提交前不同时维护 Windows 与 Linux 两套正式 Runner。

## 13. 对第二代产品的影响

Spike 通过后，第二代环境问题收敛为三项：

1. Agent 与 PowerShell 隔离。
2. Agent Capability 和 sandbox 权限预检。
3. Windows Toolchain Bundle 的版本锁定与初始化验证。

第二代无需维护 Windows Control、WSL Agent、Linux EDA 和跨系统路径转换四套边界。`processor_agent` 可以作为 Windows 常驻 Node.js 服务运行，Codex Desktop、CLI、项目文件和 Runner 共用同一操作系统与路径模型。

## 14. 实验一致性

Product 组和 Direct 组必须共用：

1. 相同 `toolchain.lock`。
2. 相同 Windows Runner。
3. 相同 Git 起点和外置测试环境。
4. 相同构建、定向测试、集成测试和 CoreMark Command ID。
5. 相同 timeout 和日志采集规则。

两组只在 Processor Agent 工作流、Artifact、Skill 和用户交互上存在差异。工具链不能成为实验变量。

## 15. 当前结论

Windows 原生 Chisel 与 Verilator 工具链在技术上可行，本机已有大部分基础环境。正式采用仍以两小时 Spike 的可重复结果为门禁。

Spike 通过后，撤销第二代必须持久运行在 Linux 的约束。Spike 失败后，保留 Linux 单环境方案，停止继续调试 Windows 工具链。
