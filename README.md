# Processor Development Skills

Processor Development Skills 是面向 Codex 的处理器工程 Skill Package。它覆盖处理器项目初始化、文档组织、周期精确设计、Chisel 实现与验证、Vivado 时序追踪和 FPGA 时序优化。

产品依赖 Codex 提供会话、文件编辑、工具调用和 Agent 执行能力。项目自身只提供领域 Skill 与薄执行支撑，不维护 Harness、Stage、Task、Run 或第二份处理器模型。

## Windows 一键初始化

环境要求为 Windows x86-64。进入源码仓库后运行：

```powershell
.\scripts\initialize.cmd
```

该命令依次执行：

1. 检查 Python、Git 和 Codex plugin 能力。
2. 校验插件清单和全部正式 Skill。
3. 运行工具级测试。
4. 构建确定性 ZIP、内容清单和 SHA256。
5. 生成本地 Codex marketplace。
6. 通过 Codex CLI 安装插件。

完成后新建 Codex 会话，使插件和 Skill 进入新会话上下文。

工作树存在未提交修改时，发布构建会停止。开发阶段可以显式运行：

```powershell
.\scripts\initialize.cmd --allow-dirty
```

只构建安装包，不修改 Codex 配置：

```powershell
.\scripts\build.cmd
```

## 环境诊断

```powershell
.\scripts\doctor.cmd --profile package
.\scripts\doctor.cmd --profile chisel
.\scripts\doctor.cmd --profile vivado
.\scripts\doctor.cmd --profile all --json
```

`doctor` 只读取当前 Windows 环境。`chisel` profile 还会核对 Chisel 仿真子进程需要的 MSYS2 `which.exe`、`sh.exe` 和 Verilator runtime。它不安装软件，不修改全局 `PATH`，不配置 Vivado 许可证。

工具不在 `PATH` 时，可以通过以下环境变量指定可执行文件或工具链根目录：

```text
PROCESSOR_SKILLS_GIT
PROCESSOR_SKILLS_CODEX
PROCESSOR_SKILLS_JAVA
PROCESSOR_SKILLS_SBT
PROCESSOR_SKILLS_VERILATOR
PROCESSOR_SKILLS_CXX
PROCESSOR_SKILLS_MAKE
PROCESSOR_SKILLS_VIVADO
PROCESSOR_SKILLS_MSYS2_ROOT
```

MSYS2 UCRT64 只作为 Windows 内部的 Verilator、C++ 和 Make 工具链。产品不支持 WSL 或 Linux 执行。

## 固定工具入口

```powershell
.\scripts\run.cmd doctor --profile package
.\scripts\run.cmd validate-skills
.\scripts\run.cmd check-docs <project-root> --json
.\scripts\read-text.cmd <utf8-text-path>
.\scripts\chisel-run.cmd <project-root> -- sbt -batch test
.\scripts\run.cmd test-tools
.\scripts\run.cmd build
.\scripts\run.cmd initialize
.\scripts\run.cmd uninstall
```

`read-text` 对 UTF-8 和带 BOM 的 UTF-8 执行严格解码。非 UTF-8 输入返回退出码 3 和 `encoding_error`，不会把乱码文本交给 Agent。Windows PowerShell 直接读取项目文档时应使用 `Get-Content -Raw -Encoding utf8 -LiteralPath <path>`。

`chisel-run` 使用 `doctor` 已解析的精确工具路径，在包运行目录按源码 hash 构建 Windows `which` 与 Make 适配器，并只在当前子进程中注入 Chisel、firtool 与 Verilator 所需环境。含空格、非 ASCII 字符或较长根路径的项目会获得单次命令有效的 `subst` ASCII 短路径别名，`CHISEL_PROJECT_ROOT` 将 svsim 生成目录绑定到该别名。sbt 仍在原项目路径启动，命令结束后释放别名。父进程 `PATH` 保持不变。

详细参数和退出码见 [USER_GUIDE.md](USER_GUIDE.md)。环境契约见 [environment/README.md](environment/README.md)。

## 正式 Skill

```text
Processor Development Skill Package
├── bootstrap-processor-project
├── organize-processor-docs
├── design-chisel-processor
├── implement-chisel-processor
├── trace-vivado-timing-to-rtl
└── optimize-chisel-fpga-timing
```

### 6.1 `bootstrap-processor-project`

使用包内固定基线初始化用户项目根目录的 `AGENTS.md`。已有文件只形成增量建议，并在用户确认后修改。写入后由用户项目维护，后续包版本不自动覆盖。该 Skill 不创建文档目录，不探测或配置环境，不修改处理器源码。环境与工具链工作由确定性脚本承担。

### 6.2 `organize-processor-docs`

建立并维护人类和 Agent 共同使用的处理器文档范式。它负责文档角色、事实权威、阅读路径、长度预算、接口表达顺序、可维护性检查和渐进式脚手架。

### 6.3 `design-chisel-processor`

负责周期精确的微架构推理，闭合字段语义、状态生命周期、生产者与消费者、寄存器边界、异常路径、优先级和可验证不变量。

### 6.4 `implement-chisel-processor`

根据已确认的 Architecture 和 Design 实现 Chisel RTL、接口迁移、断言和定向测试，并报告设计缺口和未验证行为。

### 6.5 `trace-vivado-timing-to-rtl`

将 Vivado 物理时序证据映射到生成 RTL、Chisel 源码、流水线语义和路径家族，形成有证据约束的修改方向。

### 6.6 `optimize-chisel-fpga-timing`

根据周期契约和实现证据产生时序优化候选，通过 RTL、测试和实现结果验证收益及语义保持情况。

## 构建产物

默认输出目录为：

```text
.runtime/processor-development-skills/dist/
├── processor-development-skills-0.1.0.zip
├── processor-development-skills-0.1.0.zip.sha256
└── marketplace/
    ├── .agents/plugins/marketplace.json
    └── plugins/processor-development-skills/
```

ZIP 使用固定文件顺序、固定时间戳、UTF-8 与 LF 文本规范化。`PACKAGE_MANIFEST.json` 记录输入 commit、dirty 状态、文件集合、逐文件 hash 和 payload hash。

安装产物不包含 `PRODUCT_PLAN/`、`Logs/`、`tests/`、`.runtime/`、历史 ZIP 或实验数据。

## 卸载

```powershell
.\scripts\uninstall.cmd
```

该命令移除本产品的本地插件和专用 marketplace，不清理源码仓库或 `.runtime/` 构建产物。

## License

当前仓库采用保留全部权利的临时发布边界。公开分发前需要由项目所有者确认最终许可证。
