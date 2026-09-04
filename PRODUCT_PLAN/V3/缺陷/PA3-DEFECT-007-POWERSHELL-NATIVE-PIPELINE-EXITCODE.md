# PA3-DEFECT-007：PowerShell 原生命令管道产生错误退出码

状态：已修复，已验证  
发现日期：2026-09-04  
来源：`dual_issue_demo_V2` run-002 Skill 产品预检最终验收

## 产品责任

公共验收脚本必须在读取 Git、编译器和仿真器输出时保存原生命令的真实退出码。文本截取、排序或格式化不能改变对命令成败的判断。

## 现场证据

`scripts/validate-coremark-result.ps1` 使用以下表达式读取候选 commit：

```powershell
$Head = (& git -C $RepoRoot rev-parse HEAD 2>$null | Select-Object -First 1).Trim()
if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($Head)) {
    $Errors.Add("candidate Git HEAD cannot be read")
}
```

候选 commit `8dd143ed372c88f1edf261ed229020ed02b1eb11` 上，`git rev-parse HEAD` 已输出正确 commit，管道结束后的 `$LASTEXITCODE` 连续十次均为 `-1`：

```text
run=1 last=-1 head=8dd143ed372c88f1edf261ed229020ed02b1eb11
...
run=10 last=-1 head=8dd143ed372c88f1edf261ed229020ed02b1eb11
```

同一次 `coremark.cmd` 中，13 个定向用例、两个 CoreMark workload 和 organizer acceptance 全部报告 PASS，末端 validator 随后报告：

```text
CoreMark result: FAIL
  candidate Git HEAD cannot be read
```

工作树中单独执行 `git rev-parse HEAD` 仍返回正确 commit。该失败没有对应的处理器、Git object 或结果 JSON 错误。

原始会话证据：

```text
thread: 01a065a6-80d5-73f1-a1dc-326bab0417cb
session ordinals: 5330, 5336, 5342, 5350, 5356
```

## 原因边界

现场已经把问题约束到原生 Git 输出直接进入 `Select-Object -First 1`，随后读取 `$LASTEXITCODE` 的组合。相同 HEAD 文本下，`D:\Git\cmd\git.exe` 连续二十次得到 `-1`，`D:\Git\mingw64\bin\git.exe` 二十次中十九次得到 `0`、一次得到 `-1`。因此该结果还受 Git 入口和原生管道完成时序影响，不能把 `-1` 当作稳定的 Git 退出码。现有实现没有先完整收集 Git 输出和立即冻结 Git 进程的真实退出状态。

## 影响

1. 已通过的 CoreMark 和组织者验收被公共 validator 误判为失败。
2. Agent 重复运行数百万周期 workload，浪费时间和计算资源。
3. 组合命令继续执行后，后续成功命令可能再次覆盖 `$LASTEXITCODE`，产生相反方向的伪成功。
4. A/B 两组可能随机遭遇不同次数的伪失败，破坏时间和工具调用可比性。

## 目标行为

1. 先完整捕获原生命令输出，再立即保存该命令的 `$LASTEXITCODE`。
2. 文本选择和格式化只处理已经捕获的数组，不参与原生命令管道。
3. 每个公共脚本显式返回自身验收结果，禁止依赖后续命令留下的 `$LASTEXITCODE`。
4. 失败消息区分命令启动失败、非零退出、空输出和内容不匹配。

## 关闭条件

1. 对正确仓库连续运行 validator 至少 100 次，均读取相同 HEAD 并返回 0。
2. Git 不可用、非仓库目录、空输出和错误 commit 各自稳定返回非零。
3. 自动测试覆盖原生命令输出经过 `Select-Object`、`Where-Object` 和格式化处理的场景。
4. `coremark.cmd` 与 `acceptance.cmd` 在干净候选上连续运行至少 10 次，不出现 `candidate Git HEAD cannot be read` 伪失败。
5. 测试确认附加成功命令不能覆盖 validator 的最终退出码。

## 修复结果

1. validator 先把 Git 原生命令输出完整收集为数组，并在下一条语句立即保存 `$LASTEXITCODE`。
2. `Select-Object`、`Where-Object` 和格式化只处理已经收集的输出。
3. validator 支持传入冻结 Git 绝对路径，并分别报告启动失败、非零退出、空输出、非法 HEAD 和 commit 不匹配。
4. 调用端显式保存 validator 退出码，后续成功命令不能覆盖验收结论。

## 验证证据

1. `Experiment\tests\test-validator-native-exit.ps1` 对正确仓库连续执行 100 次 validator，全部返回相同 HEAD 和退出码 0。
2. 同一测试覆盖非仓库、Git 缺失、空输出、错误 commit、三类文本变换和后续成功命令覆盖场景。
3. run-003 候选 commit `45f8038c7347386e653d0426960689ea259b9987` 连续执行 10 次完整 `acceptance.cmd`，10 次均返回 0。
4. 耐久性证据保存在 `E:\107\.runtime\dual_issue_demo_V2\run-003\evidence\public-acceptance-stability\summary.json`，SHA-256 为 `18454c2a91aba8c1886cc3bc500ad8092c435e2fa1eb64c9688ad47134d251da`。
