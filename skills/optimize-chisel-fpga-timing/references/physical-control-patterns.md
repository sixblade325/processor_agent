# Physical Control Patterns

Read this reference when a global event or registered control is dominated by
fanout, distance, and routed-net delay.

## Pipeline a rare global event

Use only with explicit approval for the additional observation cycle. Delay
validity and every coupled payload together:

```scala
val eventValidReg = RegNext(event.valid, false.B)
val eventTargetReg = RegEnable(event.target, event.valid)
val eventCauseReg = RegEnable(event.cause, event.valid)
```

Event rarity affects average penalty and proves no correctness property. Prove
that the intervening cycle cannot commit, issue, write, release, reuse, or create
another irreversible effect for work that should be suppressed. Cover local
immediate consumers, back-to-back events, pulse preservation, delayed priority,
payload alignment, late responses, and handshakes.

An immediate block or pending bit can recreate the original high-fanout path.
Include it in timing analysis. Query source-to-register D, register Q-to-sinks,
and all pending or feedback cones.

## Replicate an already registered control

For a shallow, route-dominated registered control, create same-edge replicas
from one pre-register expression and partition consumers by physical region:

```scala
val controlNext = controlEvent
val controlRegs = Seq.fill(regionCount)(RegInit(false.B))
controlRegs.foreach(_ := controlNext)
```

Do not feed replicas from the existing control Q when same-cycle behavior is
required, because that adds a cycle. Prove every replica has the same D
expression, edge, reset, enable, pulse semantics, and cycle-aligned payload.
Consumer groups must remain disjoint and must not reconverge through a new
global mux or OR.

## Do not treat aliases as replicas

Multiple `Wire` aliases can collapse to one net. Equivalent registers can also
merge. Inspect post-synthesis or routed connectivity to prove distinct Q
drivers and consumer partitioning. Use preservation attributes only under
project policy and only after checking their effect on placement and physical
optimization.

## Required evidence

1. Show the control net on the measured path and report its route delay and fanout.
2. Record source and sink sites and consumer spread.
3. Measure the shared replica D path and every regional Q path.
4. Verify no consumer remains on the original high-fanout net.
5. Report added FF, clock, reset, payload, and congestion cost.
6. Treat missing physical replication or unchanged routing as a rejected hypothesis.
