# Processor Agent V2 Harness 协调模型

状态：当前讨论基线，待产品所有者确认

## 1. 目的

本文定义 Processor Agent V2 的两组底层抽象及其关系：

1. 系统依靠哪些技术组件运行。
2. Thin Harness 持久协调哪些最小对象。

本文不定义 Define、Realize、Improve 的组织形式，不定义工作台界面，也不定义处理器模型。处理器事实继续存在于 Git 管理的权威项目材料中。

---

## 2. 总体抽象

V2 底层结构为：

```text
Git Workspace Substrate
+ Candidate Change Protocol
+ Agent Executor
+ Deterministic Runner
+ Thin Harness
```

Harness 的最小协调对象为：

```text
Task
Run
Evaluation
CandidateDecision
```

两组抽象分别回答：

```text
技术组件：系统靠什么机制运行
协调对象：Harness 记录和协调什么事实
```

---

## 3. 技术组件

### 3.1 Git Workspace Substrate

**定义：** 基于 Git 的内容寻址版本库和隔离工作区服务。

提供：

```text
读取指定 commit
创建隔离 worktree
计算 diff
生成 candidate commit
校验 base commit
原子更新正式 ref
清理临时 worktree
```

统一版本身份：

```text
commit hash = 工作区版本
blob hash   = 单文件版本
tree hash   = 目录版本
parent      = candidate 的修改基线
diff        = candidate 相对基线的变更内容
```

Git Workspace 不解释 Architecture、Design、Source 或 Verification 的处理器语义。

### 3.2 Candidate Change Protocol

**定义：** 将候选版本、评估结果和用户决定绑定到同一个 Git commit，并安全晋升正式版本的协议。

标准流程：

```text
base commit
-> edit
-> candidate commit
-> evaluate
-> user decision
-> promote | reject | revise
```

晋升条件：

```text
CandidateDecision = approved
candidate.parent = current authority commit
要求的 Evaluation 均绑定 candidate commit
```

晋升操作：

```text
compare-and-swap(authorityRef, expectedBase, candidateCommit)
```

批准后禁止自动 rebase、merge、cherry-pick 或修改内容。正式版本发生变化时，旧 candidate 必须重新生成、评估和批准。

### 3.3 Agent Executor

**定义：** 在冻结 Git 版本和受限能力范围内执行概率性认知任务的通用执行器。

输入：

```text
Task
subjectCommit
Skill
Capability Manifest
Output Contract
Task Context Package
```

输出：

```text
candidate commit
Research Report
Review Report
Finding
分析建议
Context Gap
结构化运行失败
```

适用工作：

```text
Research
文档撰写
Design Review
Revision
代码实现
代码 Review
Diagnosis
Optimization Analysis
```

Agent Executor 不更新正式 ref，不记录用户批准，不决定产品概念，不推进设计阶段。

### 3.4 Deterministic Runner

**定义：** 在受控环境中，对指定 Git commit 执行预注册工程命令的确定性执行器。

输入：

```text
Runner Task
inputCommit
commandId
Capability Manifest
Environment Spec
```

输出：

```text
编译结果
仿真结果
测试结果
综合结果
性能测量
stdout / stderr
Runtime Failure
```

每个结果绑定：

```text
inputCommit
commandSpecHash
toolchainDigest
resultHash
```

Runner 只执行 Command Registry 中的命令，不接受 Agent 提供的任意 executable、cwd、环境变量或 shell 命令。

### 3.5 Thin Harness

**定义：** 使用最小持久状态协调 Git Workspace、Candidate Change Protocol、Agent Executor 和 Deterministic Runner 的事件驱动内核。

内部服务：

```text
Task Scheduler
Run Supervisor
Candidate Protocol Coordinator
Append-only Ledger
```

Harness 负责：

```text
登记 Task
检查机械就绪条件
创建和监督 Run
派发 Agent Executor 或 Runner
登记 Evaluation
登记 CandidateDecision
执行 candidate 安全晋升
维护取消、超时和恢复信息
```

Harness 不保存或解释处理器模型。

---

## 4. 最小协调对象

### 4.1 Task

**定义：** 一次待完成工作的不可变执行契约。

```ts
interface Task {
  id: string;
  executor: "agent" | "runner";

  subjectCommit: string;
  objective: string;

  inputRefs: string[];
  prerequisiteRefs: string[];

  skillRefs: string[];
  capabilityManifestRef: string;
  outputContractRef: string;
}
```

Task 描述：

```text
做什么
基于哪个版本
需要哪些输入
必须满足哪些前置条件
采用哪些方法和权限
必须交付什么
```

一个 Task 可以产生多次 Run。

Task 的合法来源：

```text
用户直接发起
用户确认的任务计划
用户预先授权的机械后续规则
```

Finding 不自动创建 Revision Task。

### 4.2 Run

**定义：** Task 的一次实际执行尝试。

```ts
interface Run {
  id: string;
  taskId: string;
  executor: "agent" | "runner";
  inputCommit: string;

  status:
    | "queued"
    | "running"
    | "succeeded"
    | "failed"
    | "cancelled"
    | "orphaned";

  startedAt?: string;
  completedAt?: string;
  resultRef?: string;
  resultHash?: string;
  failureRef?: string;
}
```

关系：

```text
Task 1 -> 0..N Run
```

重试创建新 Run，旧 Run 不覆盖。

### 4.3 Evaluation

**定义：** 针对某个不可变 Git commit 的一次评估结果。

```ts
interface Evaluation {
  id: string;
  subjectCommit: string;

  kind:
    | "human_review"
    | "agent_review"
    | "compile"
    | "test"
    | "simulation"
    | "measurement"
    | "research";

  producer:
    | { type: "human"; actorId: string }
    | { type: "run"; runId: string };

  resultRef: string;
  resultHash: string;
  verdict?: "pass" | "fail" | "inconclusive";
  findingRefs: string[];
  createdAt: string;
}
```

Evaluation 统一承载：

```text
人工审阅结果
Agent Review
Research 结果
编译、测试、仿真和测量结果
```

Evaluation 始终绑定 `subjectCommit`。Commit 变化后，旧 Evaluation 保留，但不证明新版本。

### 4.4 CandidateDecision

**定义：** 用户对某个 candidate commit 的正式处置记录。

```ts
interface CandidateDecision {
  id: string;
  candidateCommit: string;

  decision:
    | "approved"
    | "rejected"
    | "revision_requested";

  actorId: string;
  evaluationRefs: string[];
  note?: string;
  decidedAt: string;
}
```

`approved` 只表示用户接受该精确 candidate。Candidate Change Protocol 仍需验证其 parent、评估绑定和正式 ref 当前值。

---

## 5. 四类对象的调度关系

四类对象并非都接受调度。

| 对象 | 角色 | 调度关系 |
|---|---|---|
| Task | 待完成工作的执行契约 | Scheduler 的直接调度对象 |
| Run | Task 的一次执行尝试 | Scheduler 创建，Run Supervisor 监督 |
| Evaluation | 对 commit 的观察或判断 | 作为 Task 前置条件、候选评估和用户决策输入 |
| CandidateDecision | 用户正式处置 | Candidate Protocol Coordinator 消费 |

Scheduler 只派发 Task。

Scheduler 的机械就绪条件：

```text
subjectCommit 存在
prerequisiteRefs 已满足
Capability Doctor 通过
输入可读
输出位置可写
不存在冲突的活动写任务
不存在同一 Task 的活动 Run
```

Scheduler 不判断处理器设计下一步应做什么。

---

## 6. 技术组件与协调对象的映射

| 技术组件 | 主要使用或产生的对象 |
|---|---|
| Git Workspace | 提供 Task、Run、Evaluation、CandidateDecision 引用的 commit；保存 candidate commit |
| Candidate Change Protocol | 消费 candidate commit、Evaluation、CandidateDecision；推进正式 ref |
| Agent Executor | 执行 Agent 类型 Run；产生 candidate commit 或 Evaluation |
| Deterministic Runner | 执行 Runner 类型 Run；产生 Evaluation |
| Thin Harness | 登记、调度、关联并持久化四类协调对象 |
| Skill | 被 Task 引用，定义 Agent 的任务方法 |
| Workspace Configuration | 为 Task 和 Run 提供命令、权限和环境定义 |

---

## 7. 完整执行链

```text
用户创建或确认 Task
        |
        v
Task Scheduler 检查机械就绪条件
        |
        v
创建 Run
        |
        +--------------------------+
        |                          |
        v                          v
Agent Executor             Deterministic Runner
        |                          |
        v                          v
candidate commit           Evaluation
或 Evaluation
        \                          /
         \                        /
          v                      v
     Evaluation 集合绑定 candidate
                  |
                  v
       用户作出 CandidateDecision
                  |
                  v
 Candidate Protocol Coordinator 校验
                  |
                  v
      Git Workspace 原子推进正式 ref
```

典型事件：

```text
TaskCreated
RunStarted
RunSucceeded
RunFailed
EvaluationCreated
CandidateApproved
CandidateRejected
CandidateRevisionRequested
AuthorityRefPromoted
```

---

## 8. 辅助定义的位置

### Skill

Task 引用的无状态方法定义。

```text
Task 定义做什么
Skill 定义怎样做
Run 记录做了一次
Executor 实际执行
```

Skill 不控制调度、权限、正式版本和用户批准。

### Capability Manifest

Task/Run 的权限契约，定义：

```text
可读路径
可写路径
可用工具
可执行 Command ID
网络能力
输出目录
时间限制
```

每次 Run 重新绑定能力。

### Output Contract

Task 输出的结构和最低完整性要求。

### Task Context Package

Agent Run 的派生输入：

```text
Task
+ subjectCommit
+ Skill
+ Capability Manifest
+ 相关 Evaluation / Finding
-> Task Context Package
```

它可删除、可重建，不是 Harness 的平级持久对象。

### Finding

Evaluation 中的问题记录。初期不建立独立生命周期；需要跨 commit 跟踪时再由产品所有者决定是否突出该概念。

---

## 9. 最小持久状态

Git 保存：

```text
正式版本
候选版本
文件内容
Diff
历史
版本关系
```

Harness Ledger 保存：

```text
Task
Run
Evaluation
CandidateDecision
必要的活动进程恢复信息
```

优先采用 append-only 记录。重试、重新评估和新决定创建新记录，不覆盖历史。

不进入 Harness 的内容：

```text
处理器模块模型
Architecture Role
接口定义
状态所有权
流水线语义
Design revision
Stage 状态机
Work Package 拓扑
Architecture Rework
System Design Reopen
Package Realign
```

---

## 10. 核心不变量

1. Git commit 是统一的工程版本身份。
2. Task、Run、Evaluation 和 CandidateDecision 均引用精确 commit。
3. Scheduler 只依据版本、依赖、权限和冲突等机械条件调度 Task。
4. 一个 Task 可以有多次 Run；Run 历史不可覆盖。
5. Evaluation 只证明其绑定的 subject commit。
6. CandidateDecision 只处置其绑定的 candidate commit。
7. 正式晋升的 commit 必须与用户批准的 commit 完全相同。
8. Agent 和 Runner 都不能更新正式 ref。
9. Finding 不自动决定 Revision，也不自动创建认知任务。
10. Harness 不保存处理器模型，不决定设计方向和修订内容。

---

## 11. 精炼结论

```text
Git Workspace、Agent Executor、Deterministic Runner
是执行基础设施。

Candidate Change Protocol
是候选版本评估、授权和晋升规则。

Task、Run、Evaluation、CandidateDecision
是 Harness 的最小协调对象。

Thin Harness
通过 Scheduler、Run Supervisor 和 Candidate Coordinator
协调这些对象与底层执行设施。
```

统一定义：

> Processor Agent V2 的 Thin Harness 以 Task、Run、Evaluation 和 CandidateDecision 为最小协调模型，以 Git commit 为统一版本身份，以 Agent Executor 和 Deterministic Runner 为执行后端，并通过 Candidate Change Protocol 完成候选版本的评估、用户授权和安全晋升。
