# Vivado Timing Evidence

## Evidence levels

Use routed implementation evidence for exact path and frequency claims. Post-synthesis and emitted RTL are useful for topology checks and hypothesis formation.

Preserve:

```text
source revision and dirty-state summary
elaboration parameters
clock and IO constraints
Vivado version
synthesis and implementation strategy
seed and directives
routed DCP path
report commands and report files
```

## Expose a path stage by stage

For each path, record:

|Field|Meaning|
|---|---|
|Startpoint and endpoint|Exact sequential or port pins|
|Requirement|Clock relationship and period|
|Slack|Setup or hold margin|
|Data path delay|Total data delay|
|Logic delay|Cell delay contribution|
|Route delay|Net delay contribution|
|Logic levels|Mapped depth|
|Primitive sequence|LUT, MUXF, carry, RAM, FF, and other cells|
|Net fanout|Load count for each important net|
|Sites and hierarchy|Physical distance and module crossings|

Present the path as ordered steps:

```text
source Q
local decode
cross-module route
bank or lane mux
admission reduction
destination D
```

Do not collapse several route segments into one unexplained number.

## Query a register-boundary change

For an ahead-of-time registered result, query all of:

1. Old source to old consumer.
2. State source to new register D.
3. New register Q to consumer.
4. New state feedback path.
5. Enable, reset, and flush control paths.

The optimization is incomplete if the Q path improves while the D or feedback path becomes the new limiter.

## Verify high-fanout control replication

For replicated flush, reset-like, recovery, or enable controls, source code is insufficient evidence. Check:

1. The post-synthesis and routed netlists contain the intended number of distinct registers.
2. Each replica Q drives only its assigned consumer region.
3. No original global Q net still drives the full consumer set.
4. Fanout, route delay, and placement distance decrease per replica.
5. The common pre-register D expression and reset network remain within timing.
6. Equivalent-register removal, control-set optimization, or physical optimization did not merge the copies.
7. The replicated payload and valid registers remain cycle-aligned.

Report the old driver, each new driver, load count, sites, consumer hierarchy, longest Q path, and shared D path. A lower source-level fanout count without distinct netlist drivers is not evidence of physical replication.

## Compare A and B

Hold configuration, constraints, strategy, and seed fixed when possible. Compare exact path groups and exact endpoints before comparing global WNS.

Report:

```text
old and new slack
old and new logic delay
old and new route delay
logic-level and primitive changes
endpoint migration
resource deltas
functional evidence
run identity differences
```

Placement noise can move global WNS even when the edited local path improves. A clean comparison therefore includes local paths and full-design critical paths.

## Interpret frequency correctly

For a failing setup path under a fixed routed DCP, a rough estimate is:

```text
estimated_period = constrained_period - WNS
estimated_frequency_MHz = 1000 / estimated_period_ns
```

Label this as a fixed-DCP estimate. It does not replace a new implementation run at the proposed clock.

A positive WNS proves timing closure only at the tested constraint. A successful bitstream generation does not prove timing closure. Hold closure must be reported separately.

## Avoid common attribution errors

- High fanout alone does not prove the net dominates delay.
- A LUT visible in source hierarchy may be physically placed near another module.
- Route delay can dominate a shallow logic cone.
- Resource movement between hierarchy levels may reflect flattening or absorption.
- A changed critical endpoint can indicate successful balancing or a displaced bottleneck.
- Source-level simplification may map to identical primitives.
- A local timing gain from one implementation seed is one-run evidence.

## Minimal report conclusion

```text
Measured fact:
The routed path changed from X to Y under the recorded run conditions.

Semantic proof:
The registered or simplified signal preserves the stated cycle and fire contract.

Remaining risk:
The new limiting D, Q, feedback, control, or unrelated path is Z.

Unverified claim:
Maximum frequency requires an independent implementation run at a tighter clock.
```
