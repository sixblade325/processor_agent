---
name: optimize-chisel-fpga-timing
description: Diagnose and optimize timing-critical Chisel RTL for FPGA implementation while preserving cycle semantics. Use for Vivado timing bottlenecks, long ready or admission paths, queue and issue selection, free-list bank mapping, priority encoders, one-hot arbitration, wide muxes, late-arriving forwarding or override data, high-fanout controls, cross-module predicates, register-boundary changes, emitted-Verilog inspection, or routed-DCP A/B analysis. Also use when a source-level simplification needs proof that it changes timing without changing architectural state.
---

# Optimize Chisel FPGA Timing

Optimize from cycle contracts and implementation evidence. Treat a source edit as a timing hypothesis until emitted RTL and routed implementation data confirm it.

## Establish authority and scope

1. Read repository instructions, design documents, current RTL, module-local notes, tests, and existing timing reports.
2. Separate target behavior, current implementation, reference implementation, and proposed optimization.
3. Freeze the requested edit boundary and baseline. Put generated experiments and raw evidence in the project Runtime path.
4. Record source revision, configuration, clock constraint, synthesis and implementation strategy, seed, DCP identity, and report paths.

Do not add pipeline latency, table-entry fields, interfaces, or conservative guards without authorization. A timing edit that changes fire timing, ordering, visible latency, or flush behavior is a microarchitecture change and requires explicit approval.

## Freeze the cycle contract

For every affected signal, state:

```text
producer
consumer
combinational expression
register boundary
valid interval
fire condition
hold requirement under backpressure
flush and reset behavior
same-cycle state updates
```

Classify each condition as one of:

- `state-changing`: directly enables allocation, issue, write, release, or architectural effects;
- `admission-only`: only decides whether work may enter;
- `data-select`: chooses data or an index;
- `assertion-only`: checks an upstream contract.

This classification controls which conditions may be removed, delayed, replicated, or converted into registered hints.

## Build an evidence-backed path model

Use the strongest available evidence:

1. Routed DCP path and utilization reports.
2. Post-route netlist and primitive mapping.
3. Post-synthesis netlist.
4. Emitted SystemVerilog.
5. Chisel source topology.

When a routed DCP exists, expose the path stage by stage. Record source and destination pins, requirement, slack, logic delay, route delay, logic levels, primitive sequence, net fanout, sites, and hierarchy crossings. Query related control, incoming, outgoing, and feedback paths.

For a proposed register-boundary move, always inspect this matrix:

```text
old end-to-end path
new register D-input path
new register Q-output path
state feedback or maintenance path
control path to enable/reset/flush
```

Do not infer causality from high fanout, source hierarchy, LUT count, or global WNS alone. Placement and route delay can dominate a logically shallow cone.

Read [vivado-evidence.md](references/vivado-evidence.md) before making measured timing claims.

## Select the smallest topology change

Read only the reference categories matched by the measured path. Read multiple
categories when the path crosses their boundaries.

|Measured topology|Reference|
|---|---|
|Mux width, pure transform, compact comparison, late override, one-hot zero behavior, or DCE|[combinational-data-patterns.md](references/combinational-data-patterns.md)|
|Next-state availability, age priority, registered consumer view, local predicate, or stable update identity|[register-boundary-patterns.md](references/register-boundary-patterns.md)|
|Fixed-width allocation, admission gating, queue handshake, or synchronous RAM control|[protocol-storage-patterns.md](references/protocol-storage-patterns.md)|
|Rare global events, route-dominated registered controls, or physical replication|[physical-control-patterns.md](references/physical-control-patterns.md)|

Prefer balanced trees, masks, one-hot selection, local state, fixed-width cases, and explicit register boundaries. Mux only fields consumed on the critical path.

## Check every register-boundary move

A useful register cut must satisfy all of these:

1. The registered fact is derivable one cycle early.
2. Data, selector, validity, and identity come from the same logical state version.
3. Backpressure stability remains valid.
4. Flush and reset initialize the new register consistently.
5. The new D-input maintenance cone is acceptable.
6. The new Q-output cone is shorter at the real consumer.
7. Feedback does not recreate the original path through another route.

Registering a final result can overload its D input. Registering smaller intermediate results can balance D-side and Q-side delay. Compare both structures in RTL or isolated synthesis before choosing.

## Implement and prove semantic equivalence

Make the minimum source edit. Add assertions for the contract that makes the optimization legal:

```scala
assert(PopCount(selOH) <= 1.U)
assert((allocMask & ~fireMask) === 0.U)
assert(!stateWrite || requestValid)
```

Adapt names and widths to the module. Do not add runtime muxes solely to duplicate an invariant already guaranteed upstream.

Inspect emitted SystemVerilog before a full implementation run:

- confirm the targeted LUT, mux, comparator, encoder, or dependency chain changed;
- confirm unused Bundle fields and registers were removed;
- confirm state writes remain gated by the intended fire event;
- search for accidental serial priority chains and duplicated wide compares;
- verify reset, flush, and valid logic survived as intended.

Run focused Verilator tests covering normal traffic, empty/full boundaries, sparse lanes, simultaneous events, backpressure, flush, reset, and assertions. Use symmetric tests that compare the old and new designs when practical.

## Re-run implementation and compare

Use the same configuration and constraints for A/B comparison. Re-query the exact old path and all new boundary paths. Report:

- path delay and slack changes;
- logic and route delay separately;
- level and primitive changes;
- endpoint migration;
- LUT, FF, BRAM, and hierarchy movement;
- functional test evidence;
- any placement, strategy, or seed differences.

Treat fixed-DCP frequency calculations as estimates. A positive WNS under one constraint proves closure at that constraint and does not prove the maximum frequency. A generated bitstream with negative WNS is still a timing failure.

Read only the relevant section of
[case-studies.md](references/case-studies.md) when comparing alternatives,
reviewing a failed optimization, or checking a known counterexample. Do not load
it for routine application of a closed pattern.

## Deliver

Report concisely:

1. Original path, stage-by-stage delay, and dominant logic or routing segment.
2. Cycle contract and proof that the edit preserves it.
3. Source files and exact topology change.
4. Added assertions and deliberately omitted redundant guards.
5. Emitted-RTL evidence.
6. Verilator commands, seeds, results, and logs.
7. Routed A/B evidence with D-side, Q-side, feedback, and control paths.
8. Resource cost and remaining bottleneck.
9. Unverified claims and the artifact required to verify them.
