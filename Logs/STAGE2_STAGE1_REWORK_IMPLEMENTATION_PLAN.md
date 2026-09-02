# Stage2 返回 Stage1 返工实现计划

状态：已实现并通过自动测试与真实项目无写入验证

记录时间：2026-08-30

关联文档：

1. [Review Correction v2 设计草案](./REVIEW_CORRECTION_V2_DESIGN.md)
2. [Stage1 权威计划](../PRODUCT_PLAN/STAGE1.md)
3. [Stage2 权威计划](../PRODUCT_PLAN/STAGE2.md)
4. [产品总纲](../PRODUCT_PLAN/PRODUCT_PLAN.md)

## 1. 目标

当 Stage2 的 Topology、Unit Design、Implementation 或 Verification 证明已批准 Stage1 Architecture 存在错误时，Harness 必须提供一条可恢复、可审计的正式返工路径：

```text
Stage2 Architecture Rework Finding
-> 用户确认返工目标
-> 冻结 Stage2 和全部 Agent 租约
-> 重开 Stage1 Decision 或 ProjectSpec target
-> Research / Correction / Review / Audit / Approval
-> Stage2 影响分析
-> 重开受影响 Topology Decision
-> 受影响 Unit 重新 Design、Implementation、Verification
-> 恢复 Stage2
```

## 2. 边界

1. Stage2 不直接修改 Stage1 Architecture。
2. 用户确认前不改变正式状态。
3. Harness 是 `.assistant/project.yaml`、Stage1 正式文档、Plan 和批准哈希的唯一写入者。
4. 不创建新的用户正式文档。返工记录进入现有状态，摘要投影到现有状态输出。
5. 已有 Design、源码和验证证据不删除。失效内容保存哈希索引并标记需要重新闭合。
6. 一次返工只允许一个 Stage1 repair target，避免同时重开无关决策。
7. ProjectSpec 修正必须使用 Review Correction v2 Evidence 和覆盖门禁。

## 3. 状态模型

Stage2 增加一个当前 `architectureRework`：

```yaml
id: S2_ARW_001
status: stage1_rework | stage1_reapproved | topology_rework | resumed
source:
  kind: topology | unit_design | implementation | verification | user
  decisionId: S2_TOP_001
  unitId: issue
summary: ...
rationale: ...
repair:
  kind: decision | project_spec
  target: S1_DEC_003 | architecture.modules
requiredClosure: []
evidenceSources: []
affectedTopologyDecisions: []
affectedUnits: []
baseline:
  stage1ApprovalSha256: ...
  planRevision: 0
  planApprovalSha256: ...
invalidatedArtifacts: []
```

Stage1 增加轻量返工链接和 `approvalHistory`。旧 approval 被归档，当前 approval 失效。返工重新批准后生成新 approval，旧批准不覆盖。

## 4. 命令面

```text
processor-agent stage2 rework-start <path> --proposal-json <json>
processor-agent stage2 rework-resume <path>

processor-agent stage1 correct <path> <finding-code> --proposal-json <json>
processor-agent stage1 correction-migrate <path> --dry-run
processor-agent stage1 correction-migrate <path> --apply
processor-agent stage1 release-override <path> <project-spec-target>
```

`rework-start` 只在用户明确确认完整 Proposal 后调用。`rework-resume` 只在 Stage1 新 approval 当前有效时运行。

## 5. Stage1 返工规则

### 5.1 Decision

1. 归档 Stage1 approval 和当前 audit。
2. 重开目标 Decision。
3. 使全部直接和传递依赖 Decision 失效。
4. 保留此前结论、Research 和修正原因索引。
5. 正常执行 Research、回答、Review、Audit 和 Approval。

### 5.2 ProjectSpec

1. Harness 根据 Stage2 Finding 生成当前失败 audit finding。
2. Finding 自动记录 `findingSource`，不能作为新值 Evidence。
3. `stage1 correct --proposal-json` 提交 patch、rationale、`evidenceSources` 和 `evidenceCoverage`。
4. Review Correction v2 计算领域 patch、前后哈希和 compact event。
5. 新 audit pass 后 Correction 才进入 `verified`。

## 6. Stage2 恢复规则

1. Stage1 返工期间 Stage2 状态为 `BLOCKED`，所有持久 Agent 释放租约并递增 `stateEpoch`。
2. Stage1 重新批准后，Harness 使指定 Topology Decision 及其传递依赖失效。
3. 尚无 Unit 资产时直接重建部分 Plan，回到 `TOPOLOGY_DECISION_LOOP`。
4. 已有 Unit 资产时，指定 Unit 及其 DAG 消费者标记为 `NEEDS_REALIGN`。
5. 旧 Design approval、Implementation 和 Verification 保存哈希索引后失效，不删除磁盘文件。
6. 新 Plan 批准后，受影响 Unit 从 Shadow Design 重新闭合；未受影响且证据仍有效的 Unit 保留状态。
7. Unit ID 被移除或路径 owner 改变时保持阻塞，由用户完成显式影响闭合。

## 7. Review Correction v2 联动

本轮同时实现：

1. `projectSpecHistory.baseline` 和增量 `events`。
2. keyed collection、字符串数组和 replace 三类领域 patch。
3. `findingSource`、`evidenceSources`、`evidenceCoverage` 和用户授权分离。
4. `overriddenTargets` 及显式 release。
5. Profile refresh 与 Correction 共用事件链。
6. v1 dry-run 和显式迁移。
7. 历史重放和哈希一致性检查。
8. baseline 与 events 使用内容寻址压缩 sidecar，`project.yaml` 只保存 compact index 和存储元数据。

旧 Correction 缺少设计依据时迁移为 `legacy_unresolved`，不伪造 Evidence。既有 approval 保持有效；后续报告继续暴露该历史债务。

## 8. 门禁

Harness 必须拒绝：

1. Stage2 rework Proposal 缺少 Evidence、目标或影响范围。
2. 同时存在另一个未完成 Architecture Rework。
3. Correction 使用 audit report 作为 Evidence。
4. 任一修改 target 没有 Evidence coverage。
5. Decision revision、Profile digest、文档 digest或 Research fingerprint 漂移。
6. Stage1 未重新批准时恢复 Stage2。
7. 受影响 Unit 未声明却发生 Unit ID、路径 owner 或 DAG 变化。
8. 旧 Agent 使用失效 lease 或 state epoch 提交结果。

## 9. 测试与验收

1. Review Correction 只保存 compact event，不重复完整大型数组。
2. Baseline 与 event chain 能重建每个 ProjectSpec revision。
3. Profile refresh 保留项目覆盖并生成 event。
4. v1 dry-run 不写文件，apply 后正式文档和 approval hash 不变。
5. Stage2 Decision 和 ProjectSpec 两类返工均能返回 Stage1。
6. Stage1 新 approval 前 Stage2 始终阻塞。
7. 无 Unit 资产时能重新进入目标 Topology Decision。
8. 有 Unit 资产时受影响 Unit 和 DAG 消费者进入 `NEEDS_REALIGN`，无关 Unit 保留。
9. 旧线程结果因 `stateEpoch` 或 lease 变化被拒绝。
10. `dual_issue_demo` 只执行 v1 migration dry-run 和状态查询，不提交真实返工，不改变当前 `S2_TOP_001` 用户门禁。

## 10. 实现结果

2026-08-30 已完成：

1. `stage2 rework-start` 校验 Proposal、单一 repair target、来源 Evidence、Topology Decision 和 Unit 影响范围。
2. 启动返工后归档 Stage1 approval 与 review，冻结 Stage2，释放全部租约并递增 `stateEpoch`。
3. Decision 返工重开目标与全部传递依赖；ProjectSpec 返工创建 Harness 管理的失败 audit finding，并强制使用 Review Correction v2。
4. Stage1 新 approval 前 `rework-resume` 保持阻塞。恢复命令校验新 approval、Plan 内容和冻结后的 Stage2 revision。
5. 恢复时失效声明的 Topology Decision 及传递依赖，受影响 Unit 及 DAG 消费者进入 `NEEDS_REALIGN`，旧 Design、Implementation 和 Verification 只保留哈希索引。
6. 新 Plan review 拒绝未声明 Unit 的修改或删除。未重开 `S2_TOP_001` 时拒绝新增 Unit。
7. 新 Plan 批准后保留无关 Unit 的状态和证据，并从第一个 ready 的 `NEEDS_REALIGN` Unit 恢复 Shadow Design。
8. Workspace Agent 协议、CLI help、Stage1 项目 `AGENTS.md` 生成规则和用户指南已同步。

自动测试覆盖 Decision 返工、ProjectSpec 返工、Stage1 新批准门禁、无物化 Unit 恢复、有物化 Unit 的传递失效和无关 Unit 证据保留。完整测试共 55 项。

真实 `dual_issue_demo` 只执行 Review Correction v1 到 v2 dry-run。`.assistant/project.yaml` 前后 SHA-256 均为 `8E409E0F351C87C2EC53E8FF2901561D18D12D6EF896789CC93E79B8019FCC2F`，Stage1 仍为 revision 95 的 `STAGE1_COMPLETE`，Stage2 当前用户门禁仍为 `S2_TOP_001`。未对真实项目启动 Architecture Rework。

当前剩余问题是通用多文件事务自动恢复。Rework 会更新 Stage1 正式文档、audit、`design/plan.md` 和状态文件。内容寻址 ProjectSpec history 已采用先写 sidecar、再原子替换状态的顺序，其他多文件更新仍依赖命令重试和哈希检查恢复。
