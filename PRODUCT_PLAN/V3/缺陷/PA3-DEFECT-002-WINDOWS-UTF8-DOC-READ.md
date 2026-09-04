# PA3-DEFECT-002：Windows PowerShell 默认解码破坏中文权威文档

状态：产品修复已实现，待全新 Agent 会话现场验收  
发现日期：2026-09-03  
来源：`dual_issue_demo_V2` run-002 Skill 产品预检启动审计

## 产品责任

`bootstrap-processor-project` 与公共 Windows 执行约束应保证 Agent 能可靠读取项目中的 UTF-8 中文 Markdown。权威文档的实际内容必须进入 Agent 上下文，终端默认代码页不能改变其语义。

## 现场证据

Skill 组启动后第一次读取 `AGENTS.md` 时执行：

```powershell
Get-Content -Raw -LiteralPath AGENTS.md
```

Windows PowerShell 5.1 按默认编码解码文件，事件流中的中文变为 `鍗忎綔瑙勫垯`、`鍙屽彂灏?` 等乱码。文件 SHA256 校验仍然正确，解码后的语义内容已经不可读。

原始证据：

```text
E:\107\.runtime\dual_issue_demo_V2\run-002\skill\events.jsonl
thread: 01a065a6-80d5-73f1-a1dc-326bab0417cb
item: item_1
```

同一线程后续显式使用 `Get-Content -Encoding UTF8` 读取 Package 文件时内容正常，证明问题位于默认解码路径。

## 影响

1. Agent 可能遗漏 `AGENTS.md`、Architecture 和 Design 中的硬约束。
2. 文件 hash 通过无法证明 Agent 实际读到了正确文本。
3. 纯 Windows 项目每个执行 Agent 都需要自行发现并修复编码问题，重复消耗认知资源。
4. A/B 两组可能因各自是否主动补充 `-Encoding UTF8` 产生与 Skill 无关的执行差异。

## 目标行为

1. 项目级 `AGENTS.md` 基线明确要求 Windows PowerShell 读取 UTF-8 文档时使用 `Get-Content -Raw -Encoding utf8`。
2. Bootstrap 或公共脚本提供稳定的 UTF-8 文本读取入口。
3. 启动检查用包含中文的最小文件验证实际解码结果，不能只校验文件 hash。
4. 约束同时覆盖主线程和 subagent。

## 关闭条件

1. 在 Windows PowerShell 5.1 默认代码页下，Agent 的首轮项目读取可以正确获得 UTF-8 中文内容。
2. 自动测试覆盖中文路径、中文文件内容、无 BOM UTF-8 和 UTF-8 BOM。
3. 现场事件流不再出现由默认解码造成的乱码。

## 产品修复

2026-09-04 已完成以下产品侧修改：

1. 仓库 `AGENTS.md`、`bootstrap-processor-project/SKILL.md` 和包内项目级 `AGENTS.md` 基线均要求 Windows PowerShell 使用 `Get-Content -Raw -Encoding utf8 -LiteralPath <path>`。
2. 新增公共 `scripts/read-text.cmd` 与 `read-text` CLI，严格接受无 BOM UTF-8 和 UTF-8 BOM。非法编码返回 `encoding_error` 与退出码 3。
3. 新增包内 `environment/utf8-smoke.txt`。`doctor`、`build`、`initialize` 和 `chisel-run` 在执行前核对其中文内容。
4. 工具级测试覆盖中文目录、中文文件名、中文内容、无 BOM UTF-8、UTF-8 BOM 和 UTF-16 输入拒绝。

自动回归和当前 Codex `exec_command` 入口均已通过。根据用户要求，本次修复未启动额外 Agent。关闭条件 1 和 3 留待下一次全新 Agent 会话审计，不以当前实现线程代替现场证据。
