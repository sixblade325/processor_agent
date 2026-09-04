# PA3-DEFECT-004：Windows CMD 包装器破坏多词参数并返回伪成功

状态：已修复并通过 Windows 现场回归  
发现日期：2026-09-03  
来源：`dual_issue_demo_V2` run-002 Skill 产品预检首次验收尝试

## 产品责任

公共 Execution Support Kit 的 `.cmd` 入口必须逐参数保留调用者传入的边界，并可靠传递子进程退出码。包含空格的 sbt 命令、路径和生成器参数属于正常输入。

## 现场证据

Skill 组已完成源代码和文档的第一轮实现。随后通过冻结公共入口生成 `ExperimentTop`：

```powershell
.\scripts\emit-experiment-top.cmd "E:\107\dual_issue_demo_V2-skill\.runtime\precommit-rtl"
```

入口输出：

```text
dualissue.acceptance.GenerateExperimentTop was unexpected at this time.
```

Codex command事件仍记录 `exit_code: 0`。直接调用 `scripts\chisel-run.cmd` 并传入多词参数也复现：

```text
version\\\"" was unexpected at this time.
exit_code: 0
```

向同一入口传入 `echo "hello world"` 时，内部报告 `[WinError 2]`，外层命令仍记录 `exit_code: 0`。

原始证据：

```text
E:\107\.runtime\dual_issue_demo_V2\run-002\skill\events.jsonl
thread: 01a065a6-80d5-73f1-a1dc-326bab0417cb
items: item_90, item_91, item_93, item_94, item_95
```

相关冻结入口：

```text
scripts\emit-experiment-top.cmd
scripts\chisel-run.cmd
scripts\chisel-support.py
```

### run-002 后续现场证据

线程为继续执行冻结入口，在候选仓库的 `.runtime/tooling/` 中临时编译了进程局部 C++ `sbt` 包装器，用于保留带空格的单个 sbt 命令参数。该绕行使 `emit-experiment-top.cmd`、`compile.cmd`、`test.cmd` 和 `coremark.cmd` 能继续运行。

候选 commit `526c60cb31ede922904023c43d562f1a0ee0c4e8` 的第一次 `coremark.cmd` 已在模拟器和组织者层报告 PASS，公共入口随后又报告 `candidate Git HEAD cannot be read` 并以 1 退出。紧接着单独执行 `validate-coremark-result.ps1` 返回 PASS。候选 commit `5640bd2dd12ae7e9fdee041c32e82aa461d129d6` 使用同一临时包装器重跑后，`coremark.cmd` 完整返回 PASS 和退出码 0。

这组证据说明当前入口仍依赖运行线程自行构造参数转发绕行，且组合入口的失败归因和退出码传播缺少稳定回归保证。临时可执行文件位于 `.runtime/`，不属于候选正式源码，也不构成产品修复。

## 影响

1. 多词 sbt 命令无法通过公共入口执行。
2. Agent 被迫研究 PowerShell、CMD 与 Python 的重复转义问题。
3. 失败命令可能以退出码 0 结束，形成编译、生成或验收伪成功。
4. 公共 `acceptance.cmd` 串联这些入口后无法仅依赖退出码判定结果。
5. 两组自行寻找不同绕行方式会引入与 Skill 无关的实验噪声。

## 目标行为

1. CMD 入口原样保存调用者的 Windows 命令行，不交给 PowerShell 重新解释。Python 使用 Windows `CommandLineToArgvW` 解码一次，此后以参数数组贯穿 CLI 和最终子进程。
2. `.cmd` 只承担稳定入口职责，复杂参数转发由 PowerShell 或 Python 的参数数组处理。
3. 任一内部解析、工具或子进程失败时，最外层退出码必须非零。
4. JSON 模式同时记录 requested、resolved、launched 参数数组与真实 child exit code。

## 关闭条件

1. 从 PowerShell、CMD 和 Codex `exec_command` 分别调用公共入口，含空格路径和多词 sbt 命令均能保持参数边界。
2. `runMain dualissue.acceptance.GenerateExperimentTop --target-dir <path>` 能通过固定入口完成生成。
3. 不存在的命令、解析错误和子进程失败均返回非零退出码。
4. 自动测试覆盖嵌套引号、中文路径、空格路径、空参数、尾随反斜杠和失败退出码传播。

## 修复与验证

2026-09-04 完成以下修复：

1. `run.cmd` 和全部固定 `.cmd` 入口通过当前进程环境传递原始参数，PowerShell 启动层不再接收或解释用户参数。
2. 新增 `argument_transport.py`，使用 `CommandLineToArgvW` 恢复参数边界，读取后立即移除传输环境变量。
3. Chisel 子进程不再把 `.bat` 或 `.cmd` 重组为单个 `cmd.exe /c` 字符串，统一通过 `subprocess.run` 参数数组启动。
4. `run.ps1` 立即保存 Python 子进程退出码。固定 `.cmd` 入口立即保存 `run.cmd` 退出码。
5. 结构化 Chisel 结果继续分别记录 `requestedCommand`、`resolvedCommand`、`launchedCommand` 和 `childExitCode`。

原始失败命令 `sbt -batch "show sbtVersion"` 已从 `sbtVersion\"" was unexpected at this time`、`childExitCode=255` 恢复为正常输出 `1.12.11`、`childExitCode=0`。现场回归覆盖通用 `run.cmd`、固定 `chisel-run.cmd`、多词参数、空参数、嵌套引号、中文、空格路径、尾随反斜杠、子进程退出码 23、不存在命令和 CLI 参数错误。

2026-09-04 将同一语义同步到隔离实验基线：

1. `scripts\chisel-run.cmd` 通过 `DUAL_ISSUE_RAW_ARGUMENTS` 保存原始 `%*`，避免在 CMD 括号块内重新解释多词参数。
2. `scripts\chisel-support.py` 使用 `CommandLineToArgvW` 解码一次，并在启动子进程前移除传输变量。
3. `tools\execution_support\chisel.py` 不再把 `.bat` 或 `.cmd` 参数重组为 `cmd.exe /c` 字符串。
4. `test-execution-support.ps1` 覆盖多词参数、空参数与子进程退出码 23 的传播。
5. 修复进入基线 commit `268054c1ef67092b1bbba192f6aeb8a35e43e6b1`。候选 commit `45f8038c7347386e653d0426960689ea259b9987` 连续 10 次完成完整 `acceptance.cmd`，均通过 RTL 生成和两个 CoreMark workload。
