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

## 9. Skill 使用方式

### 9.1 通用调用方式

完成初始化并打开新的 Codex 会话后，进入目标处理器项目的 Git 仓库根目录。在请求中显式写出 `$<skill-name>`，同时给出任务范围、权威文档、固定基线、验收标准和已有证据路径。

```text
使用 $<skill-name> 完成 <任务>。
权威材料：<AGENTS.md、Architecture、Design 或其他文档路径>。
修改范围：<允许修改的目录和文件>。
固定基线：<commit、DCP、报告或配置>。
验收标准：<测试、时序、文档或审查要求>。
```

Agent 会先读取目标项目中适用的 `AGENTS.md`。环境诊断、Chisel 命令封装和文档确定性检查继续使用本指南中的脚本入口。

常见组合如下：

| 目标 | 推荐顺序 |
|---|---|
| 新项目建立协作规则和文档框架 | `$bootstrap-processor-project`，随后 `$organize-processor-docs` |
| 从架构目标形成 RTL | `$design-chisel-processor`，随后 `$implement-chisel-processor` |
| 定位并修复 FPGA 时序问题 | `$trace-vivado-timing-to-rtl`，随后 `$optimize-chisel-fpga-timing` |

### 9.2 `$bootstrap-processor-project`

用于创建项目根目录 `AGENTS.md`，或将已有 `AGENTS.md` 与包内基线按职责进行比较。

缺少 `AGENTS.md` 时，可以直接要求初始化：

```text
使用 $bootstrap-processor-project 初始化 E:\projects\my-cpu 的项目级 AGENTS.md。
只采用仓库中可验证的目录和命令，只允许修改根目录 AGENTS.md。
```

已有 `AGENTS.md` 时，先请求增量建议：

```text
使用 $bootstrap-processor-project 比较当前 AGENTS.md 与包内基线。
保留现有项目规则，先报告建议新增项、冲突和过时规则，经我确认后再修改。
```

该 Skill 的写入范围只有目标项目根目录 `AGENTS.md`。环境检查、工具安装、文档脚手架、源码和测试均不在其职责内。

### 9.3 `$organize-processor-docs`

用于渐进建立、撰写、重构或审查项目根目录 `doc/` 下的人类可读文档网络。它提供三种模式：

| 模式 | 使用时机 | 主要结果 |
|---|---|---|
| `Bootstrap` | 项目缺少清晰文档框架，或现有材料需要归位 | 权威映射、阅读路径和必要目录 |
| `Author` | 新建或修订 Architecture、Design、Protocol、Lifecycle、ADR、Verification、Research 或 Review | 符合对应内容契约的文档 |
| `Maintain` | 拆分、合并、迁移、裁剪或审计现有文档 | 保持单一事实来源的精简文档网络 |

调用示例：

```text
使用 $organize-processor-docs 的 Bootstrap 模式整理当前项目文档。
以一个 doc/ 为正式文档根，建立 README 阅读入口；Design/Module 按稳定物理模块拓扑组织，并链接 Protocol、Lifecycle、ADR 和 Verification。
先列出权威归属、目标路径和需要用户决定的冲突，再实施已确定的部分。
```

涉及接口时，文档按 `Scala declaration -> semantics` 顺序解释。涉及周期精确的状态、握手、冲突优先级、flush、replay 或生命周期语义时，同时调用 `$design-chisel-processor`。修改完成后，可以从本产品源码仓库根目录运行：

```powershell
.\scripts\run.cmd check-docs E:\projects\my-cpu --json
```

### 9.4 `$design-chisel-processor`

用于实现前的 Chisel 处理器微架构设计、设计审查和设计文档闭合。

```text
使用 $design-chisel-processor 设计当前 IssueQueue 的双路选择机制。
保持 Architecture 定义的对外行为和已确认模块边界。
明确每个字段的 producer、consumer、置位与清除条件、有效期、同周期优先级、寄存器边界、flush 与安全复用规则。
给出状态转换表、失败反例、断言和定向测试要求，并同步维护相关 Design 文档。
```

有效输入包括 Architecture、当前 Design、相关 RTL、参考实现、接口约束和验收目标。交付结果应区分现有实现、当前设计、参考实现和新建议，并标记缺少验证证据的判断。

### 9.5 `$implement-chisel-processor`

用于依据已经闭合的 Architecture 和 Design 实现、审查并验证 Chisel 处理器 RTL。请求中应给出真实 elaboration top、允许修改的源码范围、相关测试入口和验收标准。

```text
使用 $implement-chisel-processor 按 doc/Architecture 和 doc/Design 实现 IssueQueue。
修改范围限于指定 Scala 源码、对应测试和同目录 _codex.md。
追踪 Bundle 的定义、构造、存储、producer、consumer、宽度和端口顺序。
运行聚焦 Verilator 测试并报告命令、seed、周期数、结果和日志路径。
```

每个由项目维护且在任务中新增或修改的 `.scala` 文件，都必须在同目录创建或更新 `<SourceBase>_codex.md`。双 subagent 核验默认关闭。需要独立静态审查和独立测试时，在当前请求中显式加入：

```text
本任务显式开启 dual-subagent verification。
一个 subagent 只读审查源码和文档，另一个 subagent 独立运行已批准测试并保存原始证据。
```

### 9.6 `$trace-vivado-timing-to-rtl`

用于只读分析 Vivado synthesis 或 routed timing 证据，并将物理路径映射回生成 RTL、Chisel 源码和流水级语义。根据结论范围选择模式：

| 模式 | 使用时机 |
|---|---|
| `Targeted Path Trace` | 分析一个命名路径、端点、模块边界或信号族 |
| `Whole-design Timing Audit` | 判断全局收敛、限制路径族、覆盖率或优化优先级 |
| `Cross-run Comparison` | 比较两个配置可比的实现运行 |

```text
使用 $trace-vivado-timing-to-rtl 的 Targeted Path Trace 模式分析该 setup path。
DCP：<routed DCP path>；时序报告：<report path>；源码基线：<commit>。
记录 source/destination pin、clock、slack、logic/route delay、primitive、net fanout 和 hierarchy crossing。
将每段结论标记为 measured、mapped、inferred 或 unknown，保持 Design 和 RTL 只读，输出按证据排序的修改方向。
```

全局结论需要 `Whole-design Timing Audit` 的 endpoint universe 和明确的查询上限。跨运行结论需要先核对 top、part、clock、constraints、strategy、parameters、seed 和源码身份。

### 9.7 `$optimize-chisel-fpga-timing`

用于在保持周期语义的前提下修改 Chisel RTL，并通过 emitted RTL、Verilator 和 routed implementation A/B 证据验证时序效果。适用于 ready 或 admission 长路径、priority encoder、one-hot arbitration、宽 mux、高扇出控制、跨模块 predicate 和寄存器边界调整。

```text
使用 $optimize-chisel-fpga-timing 优化已定位的关键路径。
基线证据：<commit、DCP、timing report、clock constraint、strategy 和 seed>。
先冻结受影响信号的 producer、consumer、组合表达式、寄存器边界、fire、backpressure、flush、reset 和同周期更新契约。
实施最小拓扑修改，增加必要断言，检查 emitted RTL，运行聚焦 Verilator 测试，再以相同配置执行 routed A/B 比较。
```

增加流水级延迟、表项字段、接口或保守保护条件需要用户明确授权。交付结果应分别报告 D input、Q output、feedback、control 和 hold 路径，以及资源代价、剩余瓶颈和未验证判断。
