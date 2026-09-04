# 环境与工具链契约

本目录定义 Processor Development Skills 的纯 Windows 运行条件。它不保存处理器架构事实，也不复制用户项目的构建配置。

## Profile

| Profile | 用途 | 必需工具 |
|---|---|---|
| `build` | 源仓库校验和可复现构建 | Python、Git |
| `package` | 构建、安装和调用 Skill Package | Python、Git、Codex CLI |
| `chisel` | Chisel 实现与 Verilator 验证 | Python、Git、Java、sbt、Verilator、C++ 编译器、Make、MSYS2 `which.exe` 与 `sh.exe`、Verilator runtime |
| `vivado` | Vivado 时序证据获取 | Python、Git、Vivado |
| `all` | 完整开发环境检查 | 全部登记工具 |

工具版本、探测命令和恢复提示由 [toolchains.json](toolchains.json) 唯一定义。

## 平台边界

1. 产品只支持 Windows x86-64，不提供 WSL、Linux 或跨系统路径适配。
2. PowerShell 和 CMD 文件只负责定位 Python 并转发参数。
3. Chisel、Verilator、Vivado 和 Codex 全部从同一 Windows 会话启动。
4. MSYS2 UCRT64 可以作为 Verilator、GCC 和 Make 的内部 Windows 工具链，不形成第二套项目运行环境。
5. 一个工程任务只使用一个已声明的 Chisel 与 Verilator 工具链配置。
6. Vivado 由用户独立安装并配置许可证，产品只执行探测和固定命令。
7. Chisel 7.14 当前支持基线使用 `firtool 1.155.0`。入口优先保留用户提供的 `CHISEL_FIRTOOL_PATH`，否则把依赖解析缓存中的无扩展名 PE 文件复制为包运行目录中的 `firtool.exe`。
8. Windows PowerShell 读取 UTF-8 文档必须显式指定 `-Encoding utf8`，也可以使用 `scripts\read-text.cmd`。`doctor` 会验证包内中文 smoke 文件的严格 UTF-8 解码结果。

## Chisel 子进程环境

固定入口：

```powershell
.\scripts\chisel-run.cmd <project-root> -- sbt -batch test
```

该入口先执行 `chisel` profile 诊断，再从已解析的 Verilator 路径或 `PROCESSOR_SKILLS_MSYS2_ROOT` 定位 MSYS2 root。它在包运行目录中按源码 hash 构建 `which.exe` 和 Windows Make 适配器，并为当前子进程注入适配器、`ucrt64\bin`、`usr\bin`、已解析工具目录、`VERILATOR_ROOT` 与 firtool 路径。适配器处理 Chisel svsim 生成文件中的 POSIX `which`、Make recipe、路径分隔符、DPI 导出和 Windows C++ runtime 差异。

CMD 入口把原始 Windows 参数保存在当前进程环境中，不交给 PowerShell 重新解释。Python 入口通过 `CommandLineToArgvW` 解码一次，CLI 和子进程调用随后只使用参数数组。`.bat` 与 `.cmd` 子进程交由 Windows 原生进程启动规则处理，入口不再重新拼接 `cmd.exe /c` 命令字符串。每次 Chisel 命令记录请求参数、解析参数、启动参数和真实子进程退出码。

含空格、非 ASCII 字符或较长根路径的项目使用临时 `subst` 盘符为 Make 提供 ASCII 短路径别名，并通过 `CHISEL_PROJECT_ROOT` 将 svsim 生成目录绑定到该别名。该路径为 suite、test 和后端生成目录预留长度。sbt 仍从原项目目录启动，适配器只重写传给 Make 及其生成文件的项目路径。命令结束时释放临时盘符。父进程、用户和系统环境均不修改。项目路径必须显式传入，因此调用者可以从任意当前目录启动。

Chisel 后端缺少 `which.exe`、`sh.exe` 或 Verilator runtime 时，`doctor` 返回退出码 2，并列出已检查的 root 与恢复入口。

## 状态修改边界

`doctor` 只读。`chisel-run` 只修改当前子进程环境，在包运行目录缓存适配器与 firtool 别名，并由用户项目中的构建或测试决定项目运行数据写入位置。临时 `subst` 盘符只在单次命令期间存在。`build` 只写入仓库的 `.runtime/processor-development-skills/`。`initialize` 会在完成相同检查和构建后调用 Codex CLI 安装本地插件。运行 `initialize` 即表示用户授权该次 Codex plugin 和 marketplace 配置写入。

脚本不修改全局 `PATH`，不安装 Vivado，不写入许可证，不调用系统包管理器。缺失项通过结构化诊断和明确恢复提示返回。

## 退出码

| 退出码 | 含义 |
|---:|---|
| `0` | 请求完成 |
| `2` | 必需工具缺失、不可执行或版本不足 |
| `3` | 契约、Skill、插件或包结构无效 |
| `4` | 外部命令执行失败 |
