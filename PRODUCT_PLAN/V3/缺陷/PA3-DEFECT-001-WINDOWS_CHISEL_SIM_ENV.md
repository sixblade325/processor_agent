# PA3-DEFECT-001：Windows Chisel 仿真入口未建立完整工具链环境

状态：已修复，已验证  
发现日期：2026-09-03  
来源：`dual_issue_demo_V2` run-002 Skill 产品预检

## 产品责任

V3 的 `Execution Support Kit` 应为纯 Windows 项目提供固定测试与仿真入口，完成已登记工具路径的临时注入，避免末端 Agent 重复研究平台命令、Shell 和路径配置。

## 现场证据

Skill 组执行候选仓库的 `scripts\test.cmd` 时，Scala 编译成功，Chisel 7.14 仿真启动失败：

```text
java.io.IOException: Cannot run program "which": CreateProcess error=2
```

公共脚本与工具状态如下：

1. `scripts\test.cmd` 只检查 `sbt.bat`，随后直接执行 `sbt test`。
2. `scripts\doctor.ps1` 可以定位 Verilator 与 MSYS2 `sh.exe`，只输出诊断结果。
3. `which.exe` 位于已安装的 MSYS2 `usr\bin`，测试子进程的 `PATH` 未包含该目录。
4. 补齐 `PATH` 后还暴露了 Chisel 7.14 svsim 生成的 POSIX Make recipe、`which verilator`、DPI 导出、`getline`、`sc_time_stamp`和 `/dev/null` 与 MinGW 的兼容性问题。
5. Chisel 下载的 firtool PE 文件没有 `.exe` 后缀，Windows `CreateProcess` 无法直接启动。
6. 项目路径包含空格、非 ASCII 字符或根路径较长时，svsim 产生的 Makefile 与 Windows 路径规则冲突。较长根路径叠加 suite、test 和生成目录后还会超过后端工具的传统路径边界。

原始运行证据位于实验运行目录：

```text
E:\107\.runtime\dual_issue_demo_V2\run-001\skill\events.jsonl
```

## 影响

1. 一键 `test` 入口无法可靠启动 Chisel 默认仿真后端。
2. Agent 会把认知资源消耗在 `which`、Make、MSYS2 和 Verilator 的重复探索上。
3. `doctor` 通过不能证明固定仿真入口可执行。
4. 当前工具级测试未覆盖从环境发现到最小 Chisel 仿真的完整链路。

## 目标行为

1. 产品提供公共的进程级工具链环境解析逻辑。
2. `test`、`simulate` 和依赖 Verilator 的入口复用该逻辑。
3. 路径注入只影响当前脚本及其子进程，不修改用户或系统全局 `PATH`。
4. `doctor` 明确检查 Chisel 后端实际依赖的 `which.exe`、`sh.exe`、Make、C++ 编译器和 Verilator。
5. 错误输出指出缺失工具、已搜索位置和修复入口。

## 关闭条件

1. 在新的纯 Windows PowerShell 进程中执行固定命令即可完成最小 Chisel elaboration、Verilator 构建和单周期 smoke simulation。
2. 删除 MSYS2 `usr\bin` 的临时可见性后，测试以确定退出码失败并准确报告 `which.exe` 或 Shell 缺失。
3. 执行结束后全局和父进程 `PATH` 保持不变。
4. 工具级测试覆盖成功路径、缺失工具路径、含空格路径和非仓库当前目录调用。

## 修复结果

1. `tools/processor_skills/doctor.py` 统一解析 Java、sbt、Verilator、C++、Make、MSYS2 `which.exe`、`sh.exe` 和 Verilator runtime。
2. `tools/processor_skills/chisel.py` 只为子进程构建环境，按源码 hash 缓存 Windows `which` 与 Make 适配器，并为 firtool 创建 `.exe` 别名。
3. Make 适配器修正 svsim 生成文件中的 Shell、路径、DPI 和 Windows runtime 差异。
4. 含空格、非 ASCII 字符或较长根路径的项目在命令期间使用临时 `subst` 盘符，结束后自动释放。

## 验证证据

1. `python -X utf8 -m unittest discover -s tests -p "test_*.py" -v`：32 项，30 通过，2 项现场工具链测试按环境开关跳过。
2. `PROCESSOR_SKILLS_RUN_CHISEL_SMOKE=1` 下运行两项现场测试：CMD 参数边界回归通过，Chisel elaboration、Verilator 构建和单周期仿真通过。
3. 现场 Chisel 测试分别覆盖含空格与中文的项目根、较长 ASCII 项目根，并确认 `CHISEL_PROJECT_ROOT` 指向临时别名。
4. run-003 候选 commit `45f8038c7347386e653d0426960689ea259b9987` 从较长实验路径完成编译、10 项 Chisel 测试、RTL 生成和两个 CoreMark workload。
5. `scripts\doctor.cmd --profile chisel --json`：全部必需工具与 runtime 检查通过。
6. 现场测试后 `subst` 无残留盘符，父进程环境不变。
