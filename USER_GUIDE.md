# Processor Development Skills 用户指南

## 1. 初始化

在 Windows x86-64 的源码仓库根目录运行：

```powershell
.\scripts\initialize.cmd
```

这是用户初始化的唯一一键入口。它完成环境预检、结构校验、工具测试、可复现构建和 Codex plugin 安装。脚本只把生成物写入 `.runtime/processor-development-skills/`，Codex 配置写入由明确执行该命令授权。

初始化成功后打开新的 Codex 会话。随后可以在目标处理器项目中调用 `$bootstrap-processor-project` 初始化项目级 `AGENTS.md`。

## 2. 命令

| 命令 | 作用 | 外部状态 |
|---|---|---|
| `scripts\doctor.cmd` | 探测环境和工具版本 | 只读 |
| `scripts\build.cmd` | 校验、测试并构建安装包 | 只写 `.runtime/` |
| `scripts\initialize.cmd` | 执行 build 并安装本地 Codex plugin | 修改 Codex plugin 配置 |
| `scripts\uninstall.cmd` | 移除插件和专用 marketplace | 修改 Codex plugin 配置 |
| `scripts\run.cmd validate-skills` | 校验插件与全部 Skill | 只读 |
| `scripts\run.cmd check-docs <root>` | 检查用户项目文档 | 只读 |
| `scripts\read-text.cmd <path>` | 严格按 UTF-8 读取文本 | 只读 |
| `scripts\chisel-run.cmd <root> -- <command>` | 在进程级 Chisel 工具链环境中执行命令 | 用户项目运行数据 |
| `scripts\run.cmd test-tools` | 执行工具级测试 | 临时文件 |

所有入口最终调用同一个 Python CLI，并使用参数数组启动外部命令。

CMD 入口把原始 Windows 参数保存在当前进程环境中，不交给 PowerShell 重新解释。Python 入口通过 `CommandLineToArgvW` 解码一次，CLI 和子进程调用随后只使用参数数组。结构化 `chisel-run` 结果同时记录 `requestedCommand`、`resolvedCommand`、`launchedCommand` 和 `childExitCode`。

## 3. Doctor Profile

### Package

```powershell
.\scripts\doctor.cmd --profile package
```

要求 Python 3.10 以上、Git 2.30 以上，以及支持 `plugin` 命令组的 Codex CLI。

### Chisel

```powershell
.\scripts\doctor.cmd --profile chisel
```

额外要求 Java 17 以上、sbt、Verilator 5 以上、C++ 编译器、GNU Make、MSYS2 `which.exe` 与 `sh.exe`，以及完整 Verilator runtime。当前验证基线是 Chisel 7.14 与 `firtool 1.155.0`。项目解析的 firtool 不要求加入全局 `PATH`。

执行 Chisel 测试时使用固定入口：

```powershell
.\scripts\chisel-run.cmd E:\projects\my-cpu -- sbt -batch test
```

该命令可以从任意当前目录调用。它为子进程设置 `PATH`、`VERILATOR_ROOT` 与 firtool 路径，并使用包内源码即时构建的 Windows `which` 和 Make 适配器。含空格、非 ASCII 字符或较长根路径的项目会在命令期间使用临时 `subst` ASCII 短路径别名，`CHISEL_PROJECT_ROOT` 将 svsim 生成目录绑定到该别名，结束后自动释放。父 PowerShell、用户环境和系统环境保持不变。结构化调用将 `--json` 放在项目路径前：

```powershell
.\scripts\run.cmd chisel-run --json E:\projects\my-cpu -- sbt -batch test
```

### Vivado

```powershell
.\scripts\doctor.cmd --profile vivado
```

要求 Vivado 命令可执行。许可证和器件支持仍由 Vivado 安装负责。

### 结构化结果

```powershell
.\scripts\doctor.cmd --profile all --json
```

JSON 会报告平台、required 状态、解析路径、版本、最低版本、失败分类和恢复提示。

## 4. 明确工具路径

工具没有进入 `PATH` 时，在当前终端设置对应变量：

```powershell
$env:PROCESSOR_SKILLS_MSYS2_ROOT = "C:\msys64"
$env:PROCESSOR_SKILLS_VIVADO = "C:\Xilinx\Vivado\2025.1\bin\vivado.bat"
.\scripts\doctor.cmd --profile all
```

各工具也可以使用独立的 `PROCESSOR_SKILLS_*` 可执行文件变量。脚本只读取这些变量，不写入用户或系统环境。

## 5. 构建

正式构建要求 Git 工作树干净：

```powershell
.\scripts\build.cmd
```

开发阶段允许 dirty 输入：

```powershell
.\scripts\build.cmd --allow-dirty
```

指定输出目录：

```powershell
.\scripts\build.cmd --output E:\packages\processor-skills
```

相同 commit 和相同文件内容应产生相同 ZIP SHA256。构建结果中的 `sourceDirty` 会记录是否使用了开发模式。

## 6. 文档检查

```powershell
.\scripts\run.cmd check-docs E:\projects\my-cpu --json
```

自定义文档根可以重复传入：

```powershell
.\scripts\run.cmd check-docs E:\projects\my-cpu `
  --root Architecture `
  --root Microarchitecture
```

原始日志、生成 RTL、波形和临时报告继续进入用户项目的 `.runtime/`。

### UTF-8 文本读取

Windows PowerShell 5.1 不能依赖默认编码读取 UTF-8 中文文档。Agent 和用户可以调用：

```powershell
.\scripts\read-text.cmd E:\projects\my-cpu\AGENTS.md
.\scripts\run.cmd read-text E:\projects\my-cpu\AGENTS.md --json
```

该入口接受无 BOM UTF-8 和 UTF-8 BOM。UTF-16LE、历史代码页或损坏输入返回 `encoding_error` 和退出码 3。直接使用 PowerShell 时采用：

```powershell
Get-Content -Raw -Encoding utf8 -LiteralPath E:\projects\my-cpu\AGENTS.md
```

## 7. 退出码

| 退出码 | 含义 |
|---:|---|
| `0` | 请求完成 |
| `2` | 必需工具缺失、不可执行或版本不足 |
| `3` | 契约、插件、Skill、测试或包结构无效 |
| `4` | Codex CLI 或其他外部命令执行失败 |

Agent 应根据退出码和 JSON 诊断处理缺口，不重复猜测命令。

## 8. 安全边界

1. 产品只支持纯 Windows x86-64。
2. 初始化不会安装 Python、Git、Java、sbt、Verilator 或 Vivado。
3. 初始化不会修改全局 `PATH`、许可证或系统包管理器。
4. `bootstrap-processor-project` 仍然只负责项目级 `AGENTS.md`。
5. 环境脚本不创建 Architecture、Design、Source 或 Verification。
6. 插件安装与卸载只处理 `processor-development-skills-local` marketplace。
