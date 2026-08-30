# RTL Mapping and Timing Report Structure

## Contents

1. Mapping procedure
2. Primitive interpretation
3. Structural opportunity accounting
4. Cross-run comparison
5. Report template
6. Implementation handoff

## 1. Mapping procedure

For each representative path:

1. Locate the launch register or memory output in current RTL.
2. Locate the destination pin and its exact assignment or inferred memory port.
3. Search every physical net and cell name in generated SystemVerilog.
4. Trace input pins and LUT `INIT` when a single-cell Boolean claim is needed.
5. Read Chisel source, parameters, and design documentation for event and cycle meaning.
6. Divide the physical chain at natural RTL boundaries.
7. Label each region with confidence: measured, mapped, inferred, or unknown.

Optimized names often inherit unrelated source names after flattening and logic sharing. A cell named after `valid`, `pc`, or `memory0` can implement logic from several source expressions.

## 2. Primitive interpretation

| Primitive | Questions to answer |
|---|---|
| LUT2 to LUT6 | exact INIT, active input pin, packed compares or muxes, removable inputs |
| MUXF7/MUXF8 | candidate width, selector arrival, whether selection can move earlier |
| CARRY4 | add, subtract, equality, age boundary, popcount, or priority structure |
| FDRE/FDSE | D, CE, reset/set, replicated driver, state version |
| RAMB18/RAMB36 | clock-to-output, ADDR, EN, WE, DIN path, read-first/write-first mode |
| LUTRAM/SRL | asynchronous or synchronous read, replicated banks, reset behavior |
| DSP | operation mode, preadder, cascade, input/output register use |
| BUFG/PLL/MMCM | launch/capture clock path only, never mix into data delay |

Pair every cell with the following routed net. A low cell delay followed by a long route is a placement or fanout problem in that physical run. Logic structure can still create the placement pressure.

Treat separate timing paths through `high` and `low` selectors as sibling cones unless a single ordered primitive chain traverses both. Vivado reports one sensitized arc per path.

## 3. Structural opportunity accounting

At a proposed cut point, report:

```text
old cumulative data delay to the next primitive input
cell levels certainly removed
old routes associated with the removed levels
replacement C/Q and route that will still exist
remaining measured suffix
covered path and endpoint counts
other startpoint families that bypass the cut
new D, Q, feedback, CE, reset, and flush paths
```

Example conclusion:

```text
Measured: the old Q-to-cut prefix is 2.680 ns and contains two LUT6 levels.
Guaranteed structural change: two LUT6 levels leave the consumer path.
Unmeasured: the new register Q route and post-route end-to-end gain.
Remaining suffix: 9.155 ns before rerouting.
```

When precomputing only a selector:

```text
selector compare may move to a register D cone
data mux remains on the Q-side data arc
guaranteed removed data levels can be zero
packing, fan-in, and route may still improve
```

Before claiming an earlier result removes a level, locate where that result joins the measured path:

```text
signal starts the path before the target mux: the level can move across a register
signal joins the path at the target mux: source-to-endpoint depth may stay unchanged
signal only controls CE, reset, or valid: the data path may be unaffected
```

## 4. Cross-run comparison

Compare only runs with compatible top, part, shell, constraints, clock definition, strategies, and parameters. Record all differences.

Use four independent views:

1. Closure: WNS, TNS, WHS, THS, pulse width, unconstrained endpoints.
2. Population: path count above threshold, delay bins, endpoint types, route-ratio distribution.
3. Topology: family count, maximum data, worst Slack, levels, shared prefixes, endpoints.
4. Cost: hierarchical LUT, LUTRAM, FF, BRAM, DSP, control sets, and qualified power.

Track path-family migration. A modification can remove hundreds of long paths while exposing a different global WNS family. Do not use WNS alone to judge the change.

Use source hashes and full physical chains to classify changes:

| Observation | Permitted conclusion |
|---|---|
| Fewer primitive levels on matching boundary | structural logic improvement |
| Same levels, shorter route in one run | routed implementation improvement for that run |
| Family disappears above threshold | improved or migrated below threshold; run a directed query |
| New family becomes WNS | bottleneck migration |
| Resource delta without matching hierarchy identity | unassigned delta |

## 5. Report template

```markdown
# <Configuration> Vivado timing analysis

## 1. Conclusions

Closure verdict, margin, threshold population, global WNS family, major improvements, new bottlenecks, and ranked next action.

## 2. Run identity

| Field | Value |
|---|---|
| Raw run | ... |
| Routed DCP SHA256 | ... |
| Vivado and part | ... |
| CPU clock | ... |
| Source revision | ... |
| Shell and top | ... |
| Synthesis and implementation strategy | ... |
| Architectural parameters | ... |

## 3. Evidence completeness

Original delivery, supplemental DCP pulls, hashes, source-match boundary, query size, truncation, constraints, and missing artifacts.

## 4. Comparable-run differences

Configuration equality, RTL changes, closure, path population, topology migration, resources, and power confidence.

## 5. Full path universe

Delay bins, endpoint pin types, route-ratio distribution, violation count, object count, query cap, and truncation status.

## 6. Raw Slack-tight paths

| Rank | Slack | Data | Logic/Route | Levels | Source | Destination |
|---:|---:|---:|---:|---:|---|---|

Explain any difference between Slack order and data-delay order.

## 7. Path-family summary

| Family | Count | Data | Logic | Route | Levels | Worst slack |
|---|---:|---:|---:|---:|---:|---:|

State when `Data` and `Worst slack` come from different endpoints.

## 8. Global WNS and limiting families

Source, destination, requirement, slack, clock skew, uncertainty, and primitive counts.

| Stage | Primitive | Cell/site | Logic/route ns | Fanout | Cumulative ns | RTL region | Confidence |
|---:|---|---|---:|---:|---:|---|---|

## 9. Targeted boundary analysis

For every proposed precompute or register:

| Boundary | Producer D | Consumer Q | Feedback | Control and hold | Result |
|---|---:|---:|---:|---:|---|

Include shared prefixes, endpoint tails, the exact join point of side inputs, and remaining measured suffixes.

## 10. High fanout, route, and implementation quality

High-fanout paths, causal route segments, replication, congestion, route status, constraints, methodology, QoR, and `DONT_TOUCH`.

## 11. Resources and power

Current hierarchy, comparable-run deltas, and power confidence.

## 12. Candidate coverage

| Candidate | Covered paths | Removed levels | Remaining suffix | New pressure | Contract to prove |
|---|---:|---:|---:|---|---|

## 13. Ranked directions

Measured rationale, source location, expected structural change, and uncertainty.

## 14. Missing evidence

Exact DCP and Tcl commands.

## 15. Raw report index

Link every report, supplemental Tcl, extracted stage table, CSV, DCP, manifest, and hash file used.

## 16. Implementation handoff

Files, cycle contract, assertions, tests, and routed A/B query matrix.
```

Keep the report answer-first. Put the full path universe before selected module narratives so absence claims remain auditable.

## 6. Implementation handoff

The handoff to `optimize-chisel-fpga-timing` must contain:

1. Exact source files and source expressions.
2. Current producer, consumer, register boundary, valid interval, and event type.
3. Primitive levels and routes targeted by the change.
4. Covered and unaffected path families.
5. Remaining suffix after the proposed boundary.
6. New D, Q, feedback, control, and reset paths to measure.
7. Any interface, latency, ordering, forwarding, flush, or hold-semantic risk.
8. Raw report and routed DCP identity.
9. Previous and current family counts, resource delta, and bottleneck migration.
10. Producer D, consumer Q, feedback, control, and hold queries required after implementation.

Do not hand off a guaranteed nanosecond gain. Hand off a structural hypothesis and the evidence needed to accept or reject it.
