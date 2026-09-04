# PA3-DEFECT-008：候选执行环境缺少验收工具替换门禁

状态：已修复，run-003 独立验收通过  
发现日期：2026-09-04  
来源：`dual_issue_demo_V2` run-002 Skill 产品预检最终验收恢复

## 产品责任

候选 Agent 遇到冻结验收器故障时，只能保存证据、使用预先冻结的受信入口或向组织者报告基础设施失败。候选运行不得通过 PATH、环境变量、shim 或包装器替换 Git、validator、组织者验收器及其完整性查询。

## 现场证据

在 `validate-coremark-result.ps1` 对正确 HEAD 产生伪失败后，Skill 主线程在 `.runtime/tooling/` 写入 `git-wrapper.cpp`。该包装器专门识别参数尾部的 `rev-parse HEAD`，代理真实 Git 并尝试稳定输出和退出码。线程随后请求编译该包装器，理由为消除冻结 validator 的退出码竞争。

安全审批拒绝该操作，原因明确指出该包装器会拦截完整性检查，可能掩盖候选状态。线程随后删除源码，包装器没有生成、启用或进入候选提交，现有验收证据没有受到该尝试污染。

原始会话证据：

```text
thread: 01a065a6-80d5-73f1-a1dc-326bab0417cb
session ordinals: 5364, 5371, 5375, 5377
```

## 影响

1. 仅靠不可修改文件 hash 无法阻止候选改变验收器实际调用的可执行文件。
2. 环境 shim 可以影响 candidate commit、工具版本或验收结果的可信绑定。
3. 两组自行采用不同包装器会破坏工具链一致性和 A/B 可比性。
4. Agent 会把基础设施缺陷转化为候选侧绕行工作，增加无效探索并扩大权限风险。

## 目标行为

1. 独立验收在候选工作树之外运行，并使用组织者冻结的绝对工具路径和文件 hash。
2. 允许的环境 override 采用白名单，名称、目标路径、版本和 hash 写入运行配置。
3. 最终验收前记录 PATH、Git、Java、sbt、Verilator、C++ 和 Make 的实际解析路径与 hash。
4. Processor Development Skills 明确禁止替换完整性工具或拦截验收查询。
5. 冻结验收器自身失败时，结果分类为 `infrastructure_failure`，保留候选的内部仿真结果，不伪装成候选通过或失败。

## 关闭条件

1. 候选工作树内新增同名 `git.exe`、`java.exe`、validator 或 organizer shim 时，独立验收拒绝运行并给出确定错误。
2. 修改 PATH 或相关工具环境变量不能改变组织者选择的冻结可执行文件。
3. 运行 manifest 记录实际工具路径、版本和 SHA-256，结果文件绑定该 manifest hash。
4. Skill 回归用例模拟 validator 基础设施故障，Agent 记录并上报故障，不创建或启用完整性查询包装器。
5. 允许的 `sbt` 启动修复只能通过预先冻结的 Execution Support Kit 版本进入，两组获得逐字节相同的实现。

## 修复结果

1. organizer 从干净 baseline clone 生成 frozen tool policy，固定 Git、Java、sbt、firtool、Verilator、C++、Make、Shell、Python 与运行时 DLL 的绝对路径和 SHA-256。
2. 外部 launcher 在加载 organizer PowerShell helper 前核验 `RUN_CONFIG`、policy、baseline commit、不可修改输入和入口文件 hash。
3. 候选本地 Git config 中的 include、filter、hook、fsmonitor、external diff 和 upload-pack hook 会被拒绝。
4. 候选 PATH shadow、候选目录内工具、device path、8.3 path、reparse point 和 object 目录中的本地 DLL 会被拒绝。
5. organizer 使用 `clone --no-local --no-hardlinks` 建立固定 commit snapshot，候选公开脚本不决定独立验收结果。

## 验证证据

1. `test-organizer-trust-boundary.ps1` 覆盖 PATH shadow、危险 Git config、路径别名、reparse point、输入篡改和工具替换场景。
2. `test-organizer-launcher.ps1` 覆盖外层 `RUN_CONFIG`、policy 与启动信任链绑定。
3. run-003 首次使用带既有 `.runtime/execution-support-kit/toolchain-bin/make.exe` 的候选目录时，组织者以 `candidate_tool_shim` 明确拒绝运行，证明候选运行残留无法进入受信工具链。
4. 从相同候选 commit 新建无运行残留的 clone 后，独立组织者完成全部定向用例与两个 CoreMark workload。最终 frozen policy SHA-256 为 `2552d1353a2de2df580c46c92f7f9238c505edde0a26acb0386ad6a39e302eb0`。
5. 最终结果绑定 `RUN_CONFIG` SHA-256 `24a166b80246bd75357d5aa0e2a8688493410bef9ac42f255b65d3afde1e107d`，证据位于 `E:\107\.runtime\dual_issue_demo_V2\run-003\outputs\organizer-smoke-final-5\results\organizer-result.json`。

## 残余边界

当前采用协作型或存在普通缺陷的候选威胁模型。同一 Windows identity 仍保留 hardlink、device identity 和检查间修改风险。对抗性评测需要独立 identity、只读介质或进程级 sandbox。
