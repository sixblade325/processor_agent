# Design 事实所有权倒置问题

状态：严重产品架构问题已确认，作为第二代产品最高优先级重构原则

记录时间：2026-08-31

关联材料：

1. [Human Approval 退化问题](./HUMAN_APPROVAL_READABILITY_FAILURE.md)
2. [龙芯杯 Design 组织方法复用缺口](./LOONG_CUP_DESIGN_ORGANIZATION_REUSE_GAP.md)
3. [产品边界与简化重审记录](./PRODUCT_BOUNDARY_SIMPLIFICATION_REASSESSMENT.md)
4. [Stage1 与 Stage2 模块粒度问题](./STAGE1_STAGE2_MODULE_GRANULARITY_PROBLEM.md)
5. [龙芯杯 Design 总纲](../../loong-cup-materials/WaterHanddoc/Design/总纲.md)
6. [当前 Demo System Design](../../dual_issue_demo/design/plan.md)

本文记录第一代 `processor_agent` 中处理器设计事实所有权倒置的问题。本文只确定问题、边界和第二代重构原则，不修改 Harness、Schema、当前 Demo 或正式产品计划。

## 1. 问题结论

第一代产品让内部结构化 Project Model 逐渐成为处理器架构和设计语义的实际权威来源。面向用户的 Architecture、Design 和 Review Packet 由该模型渲染生成，因而成为内部机器状态的下游投影。

这形成了以下事实流向：

```text
Agent 建立内部理解
-> Harness 写入结构化 Project Model
-> Renderer 生成 Architecture 和 Design
-> 用户阅读生成结果
-> 用户通过 confirm、Correction 或 Rework 间接修改 Project Model
```

用户直接拥有的是生成结果和审批入口。Agent、Schema、Harness 和 Renderer 共同拥有事实的表达方式、修改路径和持久状态。

该结构使 Agent 获得了超出产品定位的设计事实定义权。用户逐渐从处理器设计师退化为 Harness 审批者。

## 2. 龙芯杯项目中的事实关系

龙芯杯项目没有维护一份独立于正式 Design 的完整机器语义模型。处理器设计事实主要存在于 Design、Source 和 Verification 中。

其基本关系为：

```text
Design
  |
  +-> 人类设计师理解和修订
  |
  +-> Agent 读取并建立临时理解
  |
  +-> Source 实现
  |
  +-> Verification 检查
```

人类和 Agent 读取同一份 Design。Agent 的内部推理可以变化、丢失或重新建立，正式 Design 仍保持稳定并接受人类直接修改。

该关系具备以下特征：

1. Design 是人与 Agent 的共享工作表面。
2. 人类可以直接修改设计事实。
3. Agent 必须从文档重新建立处理器理解。
4. Source 与 Verification 可以对 Design 提供实现证据和反例。
5. Agent 的临时理解不具有独立持久权威。
6. 新 Agent 可以通过读取 Design 接管项目。

## 3. 关于语言模型参数的术语边界

开发过程中的 Design 不会直接修改语言模型参数。Design 通过以下方式进入 Agent 当前的处理器理解：

1. 上下文窗口。
2. 文件读取结果。
3. 检索和缓存。
4. 对话历史。
5. Agent 在本次运行中形成的临时推理状态。

因此，更准确的描述是：

```text
Design 是持久事实
-> Agent 每次从 Design 派生当前理解
```

这项术语修正不影响事实所有权问题的结论。

## 4. 第一代产品中的倒置关系

第一代产品逐渐形成以下结构：

```text
Profile 和 Schema
-> Project Model
-> Decision、Correction、Rework 状态机
-> Renderer
-> Architecture、Design 和 Approval Packet
-> 用户 confirm
```

内部模型同时承担了多个职责：

1. 保存处理器目标和总体特性。
2. 保存模块拓扑和状态所有权。
3. 保存跨模块协议和字段。
4. 保存 Work Package 和源码路径。
5. 驱动正式文档生成。
6. 决定哪些修改可以通过状态机进入项目。

Architecture 和 Design 因此失去独立事实地位。用户在生成文档中发现错误后，需要提交 Correction 或 Rework 修改上游机器对象。直接编辑文档可能被 Renderer 覆盖，也可能造成 Harness 审计失败。

## 5. 话语权失衡的形成机制

### 5.1 Agent 决定问题如何被表达

内部 Schema 规定模块、协议、字段和状态的表达形式。用户只能在预设结构中选择、确认或提出修正。处理器设计中尚未被 Schema 表达的问题容易被遗漏。

### 5.2 用户无法直接修改权威事实

用户看到的 Design 位于派生链下游。一次自然的文档修订会触发 hash、审计、Profile、Renderer 或 Project Model 冲突。用户需要理解产品内部机制才能修改自己的处理器设计。

### 5.3 Agent 的早期误解会自我强化

错误的内部模型可以同时投影到 Architecture、Design、Verification Plan 和 Approval Packet。多个生成文档重复同一事实后，会形成虚假的一致性证据。后续 Agent继续读取这些文档时，错误进一步固化。

### 5.4 Approval 逐渐失去设计含义

用户批准的实际对象经常是 Harness 当前状态或机器 Proposal。用户难以确认本次批准对应哪份可读设计、哪些语义变化和哪些后续影响。连续 `confirm` 只能证明流程获得授权，无法证明设计师理解并认可处理器方案。

### 5.5 Agent 从助手转变为事实维护者

Agent 创建机器模型、解释机器模型、渲染 Design、诊断冲突并提出 Correction。用户主要负责授权状态推进。产品角色由此偏离“处理器设计师的助手”。

## 6. 严重度与已有问题的关系

该问题属于产品事实模型级缺陷，严重度高于单纯的文档排版和 Review Packet 可读性问题。

它可以解释第一代产品已经暴露的多组现象：

1. Design 文档内容完整但难以阅读。
2. 用户讨论逐渐退化为 `confirm`。
3. Stage1 和 Stage2 持续争论模块粒度。
4. Correction 需要替换大型结构化字段。
5. Renderer 与 Profile 缺陷会阻塞架构修订。
6. Harness 状态恢复问题会阻塞 Design 修改。
7. 用户需要理解内部状态机才能表达设计意图。
8. 删除 `.assistant/` 后无法完整恢复产品所理解的处理器模型。

Human Approval 退化是外部表现，Design 事实所有权倒置是核心根因之一。

## 7. 第二代产品的权威事实模型

第二代需要采用 Artifact-centered 的事实关系：

```text
用户与 Agent 讨论
-> 可读 Architecture 或 Design Draft
-> 用户直接修订并批准 Artifact
-> Harness 记录 revision、hash 和 approval
-> 派生机器索引、依赖图和任务
-> Implementation 与 Verification
```

权威层级为：

```text
Architecture
-> Design
-> Source 和 Verification Evidence
```

当 Source、Verification 和批准 Design 发生冲突时，Harness 生成 Finding。冲突进入新的 Design revision、Implementation 修复或验证修复，任何内部缓存都不能自行改写正式语义。

## 8. Architecture 与 Design 的权利

第二代中，Architecture 和 Design 必须拥有以下权利：

1. 定义处理器行为、时序、模块边界、接口和不变量。
2. 接受用户和 Agent 的直接协作编辑。
3. 作为 Implementation Agent 和 Verification Agent 的主要输入。
4. 以 Git 和 Artifact revision 保存历史。
5. 在没有 `.assistant/` 的情况下保持完整可读。
6. 支持从文档重新派生机器索引。
7. 明确区分草案、已批准版本和被取代版本。

正式 Artifact 可以包含人类可读的表格、代码块、字段列表和稳定 ID。所有结构化内容都必须直接出现在用户可检查和修改的文档中。

## 9. 内部机器状态的允许范围

`.assistant/` 可以保存：

1. Artifact path、revision、content hash 和 approval。
2. Task、Run、Agent assignment、Lease 和执行状态。
3. 从 Artifact 派生的引用图和依赖图。
4. Finding、Review、验证结果和证据路径。
5. 带原文位置的解析索引。
6. 缓存、检索结果和运行恢复信息。

这些状态必须满足：

1. 可以从正式 Artifact 和运行证据重新构建。
2. 删除后不损失处理器设计语义。
3. 不拥有文档中不存在的处理器事实。
4. 不阻止用户直接修订 Design Draft。
5. 不决定人类 Design 的目录和章节结构。

## 10. 内部机器状态的禁止范围

第二代内部状态不得：

1. 独占模块拓扑、接口字段、周期行为或全局协议的权威定义。
2. 保存无法追溯到 Artifact 原文位置的处理器语义。
3. 通过 Renderer 覆盖用户对正式 Design Draft 的修改。
4. 要求用户通过内部状态机才能修正文档事实。
5. 将 Work Package、Worker 或 Run 拓扑投影为处理器 Design 拓扑。
6. 把一般 Stage 状态作为用户批准对象。
7. 使用多个生成文档的相互一致性替代源码、规范和验证证据。

## 11. 派生机器模型的正确定位

第二代仍可维护解析后的机器模型，用于自动检查、检索、依赖分析和 Agent 上下文准备。其定位相当于编译器中间表示或搜索索引。

正确方向为：

```text
Architecture 和 Design
-> Parser 与 Linter
-> Derived IR
-> Navigation、Review、Impact Analysis 和 Task Generation
```

Derived IR 需要满足以下约束：

1. 每个语义字段携带 Artifact path、revision 和 source span。
2. Artifact 变化后对应缓存立即失效。
3. Derived IR 可以确定性重建。
4. Agent 提议改变语义时生成文档 Patch。
5. 用户批准文档 Patch 后重新生成 Derived IR。
6. Derived IR 只生成导航、差异、检查结果和任务视图。

## 12. 用户与 Agent 的协作闭环

第二代 Design 阶段采用以下闭环：

```text
Agent 读取已批准 Architecture 和现有 Design
-> Agent 与用户讨论一个具体设计问题
-> Agent 修改可读 Design Draft
-> 用户直接审阅和修订 Draft
-> Harness 检查引用、完整性和冲突
-> 用户批准具名 Artifact revision
-> Harness 派生任务和内部索引
```

实现或验证发现缺口时：

```text
Source 或 Verification Evidence
-> Finding
-> Design Change Proposal
-> 新的 Design revision
-> 用户审批
-> 后续实现和验证
```

整个闭环中的语义变更始终发生在正式 Artifact 上。

## 13. 对三个阶段的影响

### Stage1

Stage1 的交付物是用户和 Agent 共同编写并批准的 Architecture。Stage1 内部状态只跟踪文档修订、研究证据、待解决问题和批准记录。

### Stage2

Stage2 的交付物是按处理器逻辑拓扑组织的 Design。模块拓扑、接口、周期和不变量直接写入 Design。Agent assignment 和 Work Package 从批准 Design 派生。

### Stage3

Stage3 根据性能和验证证据提出 Design Change。优化结果需要回写 Design revision，再进入实现和验证。实验数据库和性能统计不拥有正式设计语义。

## 14. 第一代产品处理边界

第一代继续以完成 `dual_issue_demo` 和 CoreMark 为目标。本轮不对当前 Project Model、Renderer 和 Harness 进行根本重写。

第一代需要保留以下证据：

1. 内部状态与正式 Design 不一致的案例。
2. 用户直接修改 Design 被拒绝或覆盖的案例。
3. Correction 和 Rework 因机器模型约束膨胀的案例。
4. 用户无法从 Design 理解批准对象的案例。
5. Renderer、Profile 或状态机缺陷阻塞设计修订的案例。

CoreMark 完成后冻结第一代状态。第二代从正式 Artifact 权威模型重新设计，不继承第一代内部 Project Model 的兼容负担。

## 15. 第二代迁移原则

迁移 `dual_issue_demo` 时采用以下过程：

1. 从第一代 Architecture、Design、Source 和 Verification 中提取候选事实。
2. 由人类和 Agent 重新整理为可读 Architecture 和 Design。
3. 对冲突、重复和缺失事实逐项审查。
4. 用户批准新的 Artifact revision。
5. 从批准文档生成第二代内部索引和任务。
6. 第一代 `.assistant/` 只作为历史证据，不作为迁移后的权威输入。

## 16. 验收标准

事实所有权倒置完成修复需要满足：

1. 删除 `.assistant/` 后，处理器 Architecture 和 Design 语义完整保留。
2. 内部机器模型可以从正式 Artifact 确定性重建。
3. 每个派生语义字段都可以追溯到文档原文位置。
4. 用户直接修改 Design Draft 后，系统执行检查并保留修改。
5. Agent 改变设计事实时必须提交可读文档 Patch。
6. 用户批准绑定 Artifact path、revision、content hash 和语义差异。
7. Work Package 和 Agent 拓扑不会出现在 Design 主导航中。
8. 新 Agent 只读取 Architecture、Design、Source 和 Verification 即可接管项目。
9. Renderer 故障不会阻止用户继续阅读和修订正式 Design。
10. Harness 状态恢复不会改变已经批准的处理器语义。

## 17. 核心原则

第二代产品采用以下最高优先级原则：

> Architecture 和 Design 拥有处理器事实。Agent 从文档派生理解，Harness 从文档派生状态，用户直接拥有并维护文档。

Design 是人类设计师与 Agent 的共同工作表面。内部机器模型只承担索引、检查、调度和恢复职责。
