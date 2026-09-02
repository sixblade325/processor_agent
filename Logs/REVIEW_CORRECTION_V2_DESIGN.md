# Review Correction v2 设计草案

状态：已实现并通过真实项目 dry-run 验证

记录时间：2026-08-30

关联文档：

1. [Stage1 开发与实跑复盘](./STAGE1_RETROSPECTIVE.md)
2. [Stage1 权威计划](../PRODUCT_PLAN/STAGE1.md)
3. [产品总纲](../PRODUCT_PLAN/PRODUCT_PLAN.md)

## 1. 目标

本方案解决 `dual_issue_demo` Stage1 实跑中暴露的两个问题：

1. Review Correction 在 `.assistant/project.yaml` 中重复保存大型字段的完整旧值和新值，导致状态持续膨胀。
2. Correction 的 `sources` 同时承担 finding 来源和新值依据，真实使用中 10 次 Correction 都只记录 `.assistant/reviews/stage1.json`，无法说明新值基于哪个 Decision、正式文档、Research Evidence、规范或用户新指令。

方案目标：

1. 当前项目事实只保存一份完整值。
2. Correction 历史按增量增长。
3. 任意 Correction 前后的 ProjectSpec 可以精确重建。
4. finding 来源、设计依据和用户授权分别记录。
5. 每个修改目标都能追踪到支撑它的 Evidence。
6. 不新增用户正式文档目录。
7. 不改变现有重新 `review`、独立 `audit` 和 approval hash 门禁。

## 2. 非目标

本方案不负责：

1. 修改已批准的 `dual_issue_demo` Architecture。
2. 改变 Stage1 Decision 内容或 Review Correction 结论。
3. 自动补充缺失 Evidence。
4. 强制所有项目级修正启动外部 Research Task。
5. 实现独立于 Stage2 的任意 Architecture reopen 入口。
6. 实现 Workspace Agent 会话热更新。
7. 在本方案记录阶段修改 Harness、CLI、Schema、测试或用户项目状态。

## 3. 当前问题证据

`dual_issue_demo` 最终状态为 `STAGE1_COMPLETE`，revision 95。真实运行形成 10 个已验证 Review Correction。

当前状态规模：

| 资产 | 规模 |
|---|---:|
| `.assistant/project.yaml` | 338335 bytes |
| `.assistant/` 全部文件 | 约 435 KB |
| workspace runtime | 约 5.8 MB，173 个文件 |

`architecture.modules` 被完整记录 3 次。当前 Correction 记录同时保存：

```yaml
changes:
  - target: architecture.modules
    previousValue: 完整旧 modules 数组
    nextValue: 完整新 modules 数组
```

10 次 Correction 的来源均为：

```yaml
sources:
  - .assistant/reviews/stage1.json
```

该路径可以定位 finding，不能证明新模块职责、协议、测试场景或不变量的设计依据。

## 4. 总体方案

Review Correction v2 由四部分组成：

1. `projectSpec`：当前完整项目事实，保持现有单一事实来源职责。
2. `projectSpecBaseline`：第一条 ProjectSpec 变更前的单次完整基线。
3. `projectSpecEvents`：Profile refresh 和 Review Correction 产生的结构化增量事件。
4. `reviewCorrections`：Correction 的 compact index、finding 来源、Evidence、授权和验证状态。

恢复任意历史版本时执行：

```text
projectSpecBaseline
-> 按 revision 重放 projectSpecEvents
-> 得到指定 revision 的 ProjectSpec
```

日常渲染直接读取当前 `projectSpec`。历史重放只用于迁移验证、审计、诊断和一致性检查。

真实项目 dry-run 表明，内联保存 baseline 和 events 只能使 `project.yaml` 缩小约 5.8%，无法满足规模门禁。最终实现将 `projectSpecHistory` 压缩到内容寻址 sidecar。Harness 在内存中仍使用完整类型，磁盘中的 `project.yaml` 只保存 sidecar 元数据。该调整不新增目录，也不改变用户正式文档。

## 5. 紧凑历史模型

### 5.1 建议状态结构

```yaml
stage1:
  projectSpec: {}

  projectSpecHistoryStorage:
    protocolVersion: 2
    path: .assistant/project-spec-history-<hash>.json.gz
    sha256: <sha256>
    eventCount: 1
    compressedBytes: 1234
    uncompressedBytes: 5678

  overriddenTargets:
    - architecture.modules
    - architecture.stage2Order

  reviewCorrections:
    - id: S1_CORR_001
      findingCodes:
        - PIPELINE_MANIFEST_NOT_CLOSED
      changedTargets:
        - architecture.modules
        - architecture.stage2Order
      eventId: S1_SPEC_EVT_001
      rationale: ...
      findingSource: {}
      evidenceSources: []
      evidenceCoverage: {}
      confirmedAt: ...
      status: verified
      verifiedByAuditAggregateSha256: <sha256>
```

sidecar 解压后的结构为：

```yaml
protocolVersion: 2
baseline:
  profileDigest: <sha256>
  projectSpecSha256: <sha256>
  value: {}
events:
  - id: S1_SPEC_EVT_001
    kind: review_correction
    revision: 78
    correctionId: S1_CORR_001
    beforeSha256: <sha256>
    afterSha256: <sha256>
    patches: []
```

`reviewCorrections` 不再保存 `previousValue` 和 `nextValue`。精确变化由 `projectSpecHistory.events[].patches` 表达。

### 5.2 Patch 语义

Patch 必须按 ProjectSpec 的领域结构生成，避免把整个数组视为一个不可分割值。

稳定键规则：

| 字段 | 稳定键 |
|---|---|
| `architecture.modules` | `id` |
| `architecture.sharedFields` | `name` |
| `architecture.globalProtocols` | `id` |
| `architecture.counterRules` | `name` |
| `verification.decisionAcceptance` | `decisionId` |

普通字符串数组记录：

1. `add`
2. `remove`
3. 最终顺序

对象集合记录：

1. `upsert` 的稳定键
2. 对象内部字段 patch
3. `remove` 的稳定键
4. 最终稳定键顺序

示例：

```yaml
patches:
  - target: architecture.modules
    collectionKey: id
    operations:
      - op: add_item
        key: instruction_queue
        value:
          id: instruction_queue
          responsibility: ...
          stateOwnership: [...]
          dependsOn: [...]
          interfaces: [...]
      - op: replace_field
        key: issue
        field: dependsOn
        value:
          - instruction_queue
          - regfile
      - op: set_order
        keys:
          - fetch
          - decode
          - instruction_queue
          - issue
```

每个 target 同时保存 `beforeSha256` 和 `afterSha256`。Harness 应在写入前应用 patch，并验证目标哈希与完整 ProjectSpec 哈希。

### 5.3 当前值、基线和历史的职责

| 数据 | 职责 |
|---|---|
| 当前 `projectSpec` | 正常加载和文档渲染 |
| `baseline.value` | 历史链起点 |
| `events[].patches` | 精确重建每次变化 |
| `beforeSha256`、`afterSha256` | 快速发现损坏和错误重放 |
| `overriddenTargets` | Profile refresh 时区分项目覆盖字段 |

完整 ProjectSpec 最多保留当前值和一个 baseline。每次 Correction 只增加实际变化部分。

### 5.4 Profile refresh

Profile refresh 也必须进入同一 ProjectSpec 事件链：

```yaml
- id: S1_SPEC_EVT_011
  kind: profile_refresh
  revision: 96
  fromProfileDigest: <sha256>
  toProfileDigest: <sha256>
  beforeSha256: <sha256>
  afterSha256: <sha256>
  patches: []
```

迁移步骤：

1. 以新 Profile 生成候选 ProjectSpec。
2. 对 `overriddenTargets` 重放当前项目覆盖值。
3. 计算旧 ProjectSpec 到候选 ProjectSpec 的领域 patch。
4. 验证 active Decision contract 门禁。
5. 原子写入新 Profile 快照、ProjectSpec event 和当前 ProjectSpec。

项目覆盖被通用 Profile 正式吸收时，需要显式移除对应 `overriddenTargets`，不能静默改变所有权。

## 6. 来源模型

### 6.1 三类信息必须分开

| 信息 | 回答的问题 |
|---|---|
| `findingSource` | 谁发现了缺口，缺口属于哪个 audit 和 finding |
| `evidenceSources` | 新值依据哪些正式事实、证据或用户新指令 |
| 用户授权 | 谁在什么时间确认应用该修改 |

Audit finding 只进入 `findingSource`。它不能作为唯一 `evidenceSources`。

### 6.2 findingSource

Harness 从当前失败 audit 自动生成：

```yaml
findingSource:
  reportPath: .assistant/reviews/stage1.json
  reviewedAggregateSha256: <sha256>
  findingCodes:
    - MODULE_DEPENDENCIES_INCOMPLETE
```

Workspace Agent 不再通过 `--source .assistant/reviews/stage1.json` 手工提交该信息。

### 6.3 evidenceSources

建议复用 Research Evidence 的来源字段，并增加 Correction 所需的来源类型：

```yaml
evidenceSources:
  - id: EV_001
    kind: decision
    locator: S1_DEC_003
    revision: 64
    locations:
      - pipeline boundary
    claim: Instruction Queue 位于 ID 与 Issue/RR 之间

  - id: EV_002
    kind: project_document
    locator: architecture/overview.md
    digest: <sha256>
    locations:
      - 架构决策/S1_DEC_006
    claim: memory_request_owner 由 M1 持有至 response

  - id: EV_003
    kind: research
    locator: .assistant/advice/S1_DEC_006.json
    fingerprint: <sha256>
    locations:
      - facts/2
    claim: data_memory response 必须匹配唯一 owner

  - id: EV_004
    kind: user_directive
    locator: S1_CORR_001
    claim: 用户新增并确认的完整架构规则
```

允许的 `kind`：

1. `decision`
2. `project_document`
3. `research`
4. `profile`
5. `user_directive`
6. `external`

`user_directive` 必须保存完整、可独立理解的规则。只写“用户确认”不构成有效 Evidence。

外部 URL 应优先通过 Research Evidence 引用。裸 URL 只能表示来源位置，不能表示 Worker 已经核验其内容。

### 6.4 evidenceCoverage

每个修改目标都必须映射到一个或多个 Evidence：

```yaml
evidenceCoverage:
  architecture.modules:
    - EV_001
    - EV_002
  architecture.globalProtocols:
    - EV_002
    - EV_003
```

如果一个 Correction 修改两个目标，两个目标都必须有覆盖。Evidence 可以被多个目标复用。

## 7. Harness 工作流

Review Correction v2 的完整流程：

```text
audit fail
-> Harness 生成 findingSource
-> Workspace Agent 形成 patch、rationale、evidenceSources 和 evidenceCoverage
-> 向用户展示旧事实摘要、新事实摘要、设计依据和影响目标
-> 用户明确确认
-> Harness 校验 Evidence 与覆盖关系
-> Harness 计算领域 patch 和前后哈希
-> 原子更新 projectSpec、history event 和 correction index
-> 重新生成正式文档
-> deterministic review
-> independent audit
-> Correction verified
-> approve
```

Harness 负责计算：

1. `findingSource`
2. 旧值
3. 新值
4. patch
5. `beforeSha256`
6. `afterSha256`
7. 当前 ProjectSpec 聚合哈希

Workspace Agent 只提交：

1. finding code
2. 结构化目标值
3. rationale
4. `evidenceSources`
5. `evidenceCoverage`

## 8. 校验门禁

`stage1 correct` 必须拒绝以下输入：

1. finding 不属于当前失败 audit。
2. finding 不是 `project_spec`。
3. patch 没有覆盖 finding 的 `repairTarget`。
4. 修改目标超出允许的 ProjectSpec 字段。
5. 任一目标没有 `evidenceCoverage`。
6. Evidence ID 不存在或重复。
7. `.assistant/reviews/stage1.json` 被当作 Evidence 使用。
8. Decision revision 与当前状态不一致。
9. Profile digest 与当前快照不一致。
10. 项目文档 digest 与当前文件不一致。
11. Research fingerprint 与 advice 不一致。
12. patch 应用后的目标哈希或 ProjectSpec 哈希不一致。
13. 用户没有明确确认。
14. 当前存在未按顺序处理的 open finding。

## 9. CLI 输入

现有 `--patch-json`、`--reason` 和重复 `--source` 无法完整表达 Evidence 结构。

当前 CLI 已收敛为单个 Correction Proposal：

```text
processor-agent stage1 correct <path> <finding-code> \
  --proposal-json <json>
```

Proposal 结构：

```json
{
  "patch": {
    "architecture": {
      "modules": []
    }
  },
  "rationale": "补齐 Instruction Queue 所有权和依赖关系。",
  "evidenceSources": [],
  "evidenceCoverage": {
    "architecture.modules": ["EV_001"]
  }
}
```

用户仍通过自然语言与 Workspace Agent 交互，不需要手工编写 JSON。

## 10. v1 到 v2 迁移

### 10.1 原则

1. 已完成的 `dual_issue_demo` 默认保持只读。
2. 新项目直接使用 v2。
3. 旧项目先执行 dry-run，不在 `status` 或 `next` 中静默写回。
4. 迁移前后正式文档内容和 approval hash 必须不变。
5. 旧来源质量不能在迁移时伪造为新 Evidence。

### 10.2 迁移步骤

1. 读取 v1 `projectSpec` 和全部 Correction。
2. 使用第一条 Correction 的 `previousValue` 建立 baseline。
3. 按 revision 将每组 `previousValue -> nextValue` 转换为领域 patch。
4. 重放全部 patch，要求结果等于当前 `projectSpec`。
5. 计算每个事件和目标的前后哈希。
6. 收集全部被修改 target，生成 `overriddenTargets`。
7. 将旧 `.assistant/reviews/stage1.json` 来源迁移到 `findingSource`。
8. 缺少设计依据的旧记录标记为 `legacy_unresolved`，不生成虚假 Evidence。
9. 比较迁移前后正式文档哈希和 approval hash。
10. dry-run 通过并得到用户确认后再原子写入 v2 状态。

### 10.3 dual_issue_demo 处理

`dual_issue_demo` 当前已经 `STAGE1_COMPLETE`。进入 Stage2 前不执行状态迁移。它继续作为 v1 实跑证据和 v2 迁移测试输入。

2026-08-30 已对真实项目执行只读 dry-run。迁移未修改 `dual_issue_demo`：

| 指标 | 结果 |
|---|---:|
| v1 Correction | 10 |
| v2 events | 10 |
| `project.yaml` 迁移前 | 338335 bytes |
| `project.yaml` 迁移后估算 | 190209 bytes |
| 压缩 history sidecar | 25008 bytes |
| 迁移后两文件合计 | 215217 bytes |
| `project.yaml` 降幅 | 43.78% |
| Correction 与 history 负载降幅 | 70.44% |

当前 ProjectSpec 与重放结果哈希均为 `df3ffd708bfa20465455b0fdfc250cca29ca9b04bdce0e8c0146a857a3521748`。正式文档哈希和 approval hash 保持不变。dry-run 前后 `.assistant/project.yaml` SHA-256 均为 `8E409E0F351C87C2EC53E8FF2901561D18D12D6EF896789CC93E79B8019FCC2F`。实际项目继续保留 v1 状态，等待用户单独确认 apply。

## 11. 自动测试计划

至少覆盖：

1. 三次修改同一个 module 只增加对应 item patch。
2. baseline 与事件链能够恢复每次 Correction 前后的精确 ProjectSpec。
3. patch 重放结果与当前 ProjectSpec 哈希一致。
4. Profile refresh 与 Review Correction 共用同一事件链。
5. Profile refresh 保留 `overriddenTargets`。
6. 删除项目覆盖需要显式操作。
7. audit report 不能作为 `evidenceSources`。
8. 每个目标必须有 Evidence 覆盖。
9. `user_directive` 缺少完整 claim 时拒绝。
10. Decision revision、Profile digest、文档 digest 和 Research fingerprint 漂移时拒绝。
11. Correction 后必须重新 review 和 audit。
12. 未验证 Correction 不能 approve。
13. v1 dry-run 迁移不写文件。
14. v1 迁移后正式文档和 approval hash 不变。
15. 原子写入中断时保留旧状态。

## 12. 验收标准

功能验收：

1. 10 次现有 Correction 可以逐项恢复旧值和新值。
2. 任意 revision 的 ProjectSpec 可以从 baseline 和事件链重建。
3. 当前 ProjectSpec 继续作为正式文档生成输入。
4. 每个 Correction 的 finding、设计依据、用户确认和验证 audit 可以独立追踪。
5. Correction 不能只使用 audit finding 作为新值依据。
6. 迁移前后 `dual_issue_demo` 正式文档和 approval hash 不变。

规模验收：

1. 现有 10 次 Correction 的历史负载至少减少 70%。
2. `.assistant/project.yaml` 总体积至少减少 40%。
3. 重复修改单个 module 时，状态增长只与该 module 的变化量相关。
4. 不创建按 Correction 编号增长的新目录或正式文档。

## 13. 实现结果

实际实现涉及：

1. `src/types.ts`
2. `src/stage1.ts`
3. `src/cli.ts`
4. `src/agent-runtime.ts`
5. `src/io.ts`
6. `tests/stage1.test.ts`
7. `PRODUCT_PLAN/STAGE1.md`
8. `USER_GUIDE.md`

已确定的实现选择：

1. 使用 ProjectSpec 领域 patch，不引入通用 JSON Patch 依赖。
2. 当前完整 `projectSpec` 继续保留，正常渲染不依赖历史重放。
3. `legacy_unresolved` 作为历史 Evidence 债务展示，不阻止既有项目重新 approval。
4. Profile refresh 默认保留 `overriddenTargets`，`release-override` 显式交还字段所有权。
5. 新项目直接使用 protocol v2，旧项目只通过显式 dry-run 和 apply 迁移。
6. sidecar 使用完整压缩内容 SHA-256 校验和前 20 位内容寻址文件名。写入顺序为新 sidecar、原子状态替换、旧 sidecar 删除。

当前剩余风险是通用多文件事务恢复。进程在新 sidecar 写入后、状态替换前退出时，旧状态仍然有效，可能留下一个未引用 sidecar。框架尚未自动回收该孤立文件。
