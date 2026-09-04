# PA3-DEFECT-009：独立组织者无法编译 Chisel verification layers

状态：已修复，run-003 独立验收通过  
发现日期：2026-09-04  
来源：`dual_issue_demo_V2` run-002 Skill 产品预检独立组织者验收

## 产品责任

独立组织者验收器必须能够编译公共 Chisel 生成器产生的受支持多文件 SystemVerilog 输出。递归发现源码时，还需要为 verification layer 的相对 `include` 建立正确搜索路径或生成自包含输入清单。

## 现场证据

候选 commit `8dd143ed372c88f1edf261ed229020ed02b1eb11` 已通过候选仓库内的完整 `acceptance.cmd`。随后从冻结 baseline commit `02048106e7e0958c4efd674cc609b48eb2f8a1ee` 的独立干净 clone 运行组织者验收：

```powershell
.\Experiment\organizer-harness\run.cmd `
  -CandidateRoot E:\107\dual_issue_demo_V2-skill `
  -OutputRoot E:\107\dual_issue_demo_V2-organizer-output-skill-8dd143e
```

不可修改输入检查通过，`GenerateExperimentTop` 成功生成 RTL。Verilator 随后在进入仿真前报告 30 个缺失 include，例如：

```text
rtl\verification\assert\layers-Backend-Verification-Assert.sv:
Cannot find include file: 'layers-Backend-Verification.sv'

rtl\verification\layers-Backend-Verification.sv:
Cannot find include file: 'layers-RegFile-Verification.sv'
```

生成树已经包含相应 verification layer 文件。错误输出显示 Verilator 只搜索当前工作目录和 `obj`，没有加入 `rtl\verification` 与 `rtl\verification\assert` 等生成目录。组织者以退出码 1 结束。

原始会话证据：

```text
thread: 01a065a6-80d5-73f1-a1dc-326bab0417cb
session ordinals: 5453, 5455
```

## 影响

1. 使用标准 Chisel assertion layer 的候选无法进入独立仿真验收。
2. 候选内部验收通过，独立组织者在编译层产生伪失败。
3. Agent 可能通过删除断言或改变生成形式规避组织者限制，降低验证质量。
4. 不同候选的 annotation 数量会改变是否触发该缺陷，破坏 A/B 可比性。

## 目标行为

1. 组织者从生成清单确定全部 SystemVerilog 文件与 include 目录。
2. Verilator 调用显式加入每个受信生成目录，路径排序稳定且不依赖当前目录。
3. 缺失 include 时报告引用文件、目标名称、搜索目录和生成文件清单。
4. assertion layer 是否参与仿真由冻结验收策略决定，候选不能自行删减。

## 关闭条件

1. 最小 Chisel 模块含顶层、子模块和多层 assertions 时，独立组织者可以完成生成、Verilator 编译和仿真。
2. 测试覆盖 `verification/`、`verification/assert/` 和至少三级嵌套 include。
3. 输出根目录含空格、中文和较长路径时仍通过。
4. 删除任一必需 layer 后，组织者以确定非零退出码报告缺失文件。
5. run-002 候选 `8dd143e` 在修复后的独立组织者上完成相同定向用例和两个 CoreMark workload。

## 修复结果

1. organizer 递归发现 `.sv`、`.v`、`.svh` 和 `.vh`，使用同一次字节读取完成 UTF-8 解析、include 扫描、SHA-256 与独占 RTL snapshot 写入。
2. include 闭包覆盖行首与行内字面量 directive，搜索目录按稳定顺序进入 Verilator 参数。
3. 绝对 include、越出 RTL root、reparse point、非字面量 include 和未进入 hash 输入集的目标均在编译前拒绝。
4. 缺失目标报告引用文件、目标、行号、搜索目录和完整生成文件清单。
5. generator 树与 organizer RTL snapshot 在构建前后及仿真后重复核验。

## 验证证据

1. `organizer-support.tests.ps1` 覆盖三级嵌套 include、header 闭包、行内 directive、注释和字符串排除、绝对路径、越界路径、缺失目标及非字面量目标。
2. `organizer-toolchain-smoke.tests.ps1` 从独占 RTL snapshot 完成 Verilator 构建和仿真，输出路径包含空格与中文。
3. run-003 验证了生成器与组织者之间的 portability 合约。候选夹具 commit `2c855723e69b1fa56eb33f76a9f8f921fe83a659` 将 CIRCT basename-only include 解析为生成树内唯一文件，再写成相对当前源文件的路径。
4. 组织者从独立 RTL snapshot 完成 Verilator elaboration、C++ build 和仿真，`rtlInputManifestSha256` 为 `be84f4deeb9538e514b7b3a1626052102d8a60e3595a38964a05fa12958998b5`。
5. 最终结果包含 13 个外部行为定向用例和两个 CoreMark workload，全部通过。证据位于 `E:\107\.runtime\dual_issue_demo_V2\run-003\outputs\organizer-smoke-final-5\results\organizer-result.json`。
