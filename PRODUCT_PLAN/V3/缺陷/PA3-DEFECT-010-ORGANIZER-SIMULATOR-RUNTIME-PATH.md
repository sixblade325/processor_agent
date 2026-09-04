# PA3-DEFECT-010：独立组织者未固定模拟器运行时 DLL 路径

状态：已修复，run-003 独立验收通过  
发现日期：2026-09-04  
来源：`dual_issue_demo_V2` run-002 Skill 产品预检独立组织者验收

## 产品责任

独立组织者使用指定 C++ 工具链构建 Verilator 模拟器后，必须在与该工具链一致的运行时环境中启动生成的可执行文件。用户 PATH 中其他 MinGW 或 Git DLL 目录不能改变模拟器加载的 runtime。

## 现场证据

修正 verification include 后，独立组织者完成以下步骤：

1. 不可修改输入检查通过。
2. Chisel RTL 生成通过。
3. Verilator elaboration 通过。
4. `D:\msys64\ucrt64\bin\g++.exe` 与 `mingw32-make.exe` 完成 `experiment_harness.exe` 构建。

模拟器启动时立即返回：

```text
Organizer processor simulation failed with exit code -1073741511
```

该值对应 Windows 状态码 `0xC0000139`。运行前 PATH 中 `D:\Git\mingw64\bin` 可见并早于 `D:\msys64\ucrt64\bin`，两处均包含不同的 `libstdc++-6.dll`。组织者只在 Verilator 与 Make 构建期间临时前置 UCRT64 路径，进入模拟器运行前恢复了原 PATH。

原始会话证据：

```text
thread: 01a065a6-80d5-73f1-a1dc-326bab0417cb
session ordinals: 5619, 5621, 5625, 5631, 5633
```

## 影响

1. 编译成功的模拟器在进入第一个周期前终止。
2. 用户安装的 Git 或其他 MinGW 发行版会随机影响验收结果。
3. 两组 PATH 顺序的微小差异会破坏 A/B 环境一致性。
4. 错误只暴露十进制 Windows 状态码，无法直接定位冲突 DLL。

## 目标行为

1. 构建和运行模拟器使用同一个冻结 runtime PATH。
2. 组织者只从已登记的 UCRT64 工具链解析 `libstdc++`、`libgcc`、`winpthread` 等依赖。
3. 运行 manifest 记录 C++ 编译器、Make、Verilator 及 runtime DLL 的绝对路径与 SHA-256。
4. Windows 异常退出同时报告十进制值、十六进制状态码和常见原因。

## 关闭条件

1. 在 PATH 首部放置含不兼容 `libstdc++-6.dll` 的目录，独立组织者仍能运行模拟器并通过 smoke case。
2. 删除冻结 UCRT64 runtime 后，组织者在启动前报告缺失 DLL，不进入模糊的 `0xC0000139` 失败。
3. 测试覆盖 Git for Windows、MSYS2 MINGW64 和 MSYS2 UCRT64 同时安装的环境。
4. run-002 候选在修复后的独立组织者上完成全部定向用例与两个 CoreMark workload。

## 修复结果

1. frozen tool policy 记录 UCRT64 runtime DLL 的绝对路径、大小和 SHA-256。
2. organizer 拒绝 object 目录中的 application-local DLL，并把模拟器和冻结 DLL 复制到隔离 runtime 目录。
3. 构建与运行使用同一受控 PATH。模拟器启动后读取实际加载模块，核验 GNU runtime DLL 的绝对路径和 SHA-256。
4. `simulator-exit-status.json` 同时记录十进制、十六进制状态码和常见 Windows loader 诊断。
5. `runtime-loaded-modules.json` 与 `organizer-toolchain-manifest.json` 绑定最终结果。

## 验证证据

1. `organizer-toolchain-smoke.tests.ps1` 在冲突 GNU runtime PATH 下完成构建和仿真，并验证实际加载模块证据。
2. 回归覆盖 object 目录 DLL 注入、冻结 runtime 缺失和 `0xC0000139` 诊断。
3. run-003 独立组织者完成 `experiment_harness.exe` 构建并连续运行 15 个 case，未出现 `0xC0000139` 或加载路径漂移。
4. 两个 CoreMark workload 均通过。组织者结果中的 performance IPC 为 `0.338346`，validation IPC 为 `0.337316`。
5. 最终结果绑定的 `runtimeLoadedModulesSha256` 为 `c3a5ea3f9eed1f55e6de171bd6b49bd5e21a9bb184013bed8ba3d830f28399d6`。
