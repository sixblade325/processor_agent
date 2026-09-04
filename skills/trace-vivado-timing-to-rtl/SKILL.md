---
name: trace-vivado-timing-to-rtl
description: Task-sized forensic analysis of Vivado synthesis and routed timing evidence for processor RTL. Use when Codex must trace a named setup or hold path, audit whole-design timing populations, compare implementation runs, map primitive, LUT, CARRY, BRAM, DSP, MUXF, register, and routed-net stages back to Chisel or generated RTL, distinguish logic from routing pressure, identify missing DCP queries, or write an evidence-backed timing report. This skill is read-only by default and stops at ranked modification directions. Use optimize-chisel-fpga-timing for RTL edits and routed A/B implementation closure.
---

# Trace Vivado Timing to RTL

Build a measured map from Vivado timing evidence to processor RTL. Match the
amount of evidence collection and reporting to the claim being made.

## Keep the boundary clear

Use this skill for read-only timing forensics:

```text
Vivado reports or routed DCP
  -> selected path population
  -> primitive and net stages
  -> RTL and pipeline meaning
  -> ranked structural directions
```

Use `optimize-chisel-fpga-timing` for cycle-contract proof, RTL edits,
assertions, functional verification, emitted-RTL comparison, and routed A/B
closure. For a combined request, freeze this skill's evidence before editing.

## Read authority and artifacts

1. Read repository instructions, target Design, current RTL, generated RTL, and report-directory rules.
2. Identify source revision, dirty state, parameters, top, device, Vivado version, clocks, constraints, strategies, directives, seed, DCP path, and DCP hash.
3. Treat an implementation run as immutable evidence. Compare source hashes with its manifest before semantic mapping.
4. If source drifted, map through the run snapshot, generated RTL, routed netlist, and DCP. Mark current-source correspondence as unverified.
5. Prefer routed DCP evidence. Use post-place, post-synth, emitted RTL, or source only for questions that evidence level can answer.
6. Preserve raw reports and supplemental queries. Write analysis only to the user or project-designated report path.

Read [evidence-and-queries.md](references/evidence-and-queries.md) when a DCP is
available, reports are incomplete, or exact Tcl queries are needed.

## Select the task mode

Choose the smallest mode that supports the requested conclusion.

### Targeted Path Trace

Use for one named path, endpoint, module boundary, signal family, or timing
hypothesis. Query the named path plus its producer, consumer, feedback, and
control boundaries. A full endpoint universe is optional and must not be
generated unless the report makes a global absence, ranking, coverage, or
closure claim.

### Whole-design Timing Audit

Use for global closure, limiting-population, module-coverage, or prioritization
claims. Build the endpoint-worst path universe, distributions, family summaries,
and representative paths. State query caps and truncation.

### Cross-run Comparison

Use for before/after or configuration comparison. First prove top, part, clock,
constraints, strategies, parameters, and source identities are comparable. Use
the same targeted population for a local claim. Use matching endpoint universes
and family classifiers for a global claim.

If the request combines modes, keep each claim bound to the evidence population
that supports it.

## Build the selected path population

For every mode, record setup and hold status separately and preserve the raw
Slack-sorted paths used by the analysis. Explain that longest data delay and
worst Slack can differ because skew, uncertainty, CPR, and endpoint clock paths
differ.

For a whole-design audit or global comparison:

1. Build one worst setup path per endpoint using a stated threshold.
2. Record returned object count, query cap, and truncation status.
3. Summarize delay bins, endpoint pin types, setup violations, and route-ratio distribution.
4. Group by physical startpoint class, endpoint class, shared prefix, pipeline boundary, and event type.
5. Report each family's count, maximum data delay, worst Slack, logic and route split, levels, and representative path.
6. Preserve the identities of both maximum-data and worst-Slack paths when they differ.

For a targeted trace, save exact `-from`, `-to`, and `-through` expressions,
expanded object counts, warnings, and raw path reports. Do not call a module
timing-clean from absence in a top-N list.

## Expand representative paths

Expand every user-targeted family. In a whole-design audit, also expand global
WNS, highest-count families, and longest-data families. Record:

```text
source and destination pins
launch and capture clocks
requirement, slack, uncertainty, skew, CPR
data, logic, and route delay
logic levels and primitive counts
ordered primitive cells and sites
following net delay and fanout
cumulative data delay
hierarchy crossings
endpoint pin type
```

Pair each primitive with its following routed net. Run
[extract_timing_path.py](scripts/extract_timing_path.py) on text reports for an
initial stage table, then verify the selected block and semantic labels against
the raw report.

## Map physical stages to RTL

1. From the startpoint, follow generated net names, cell inputs, and source fanout into the path.
2. From the endpoint, trace the consuming register, memory pin, enable, or reset back to its RTL assignment.
3. Search emitted SystemVerilog, Chisel source, parameters, and Design.
4. Partition the path into regions such as decode, compare, overlay, arbitration, mux, add, correction, ready propagation, state maintenance, and memory control.
5. Label each statement `measured`, `mapped`, `inferred`, or `unknown`.

Never infer an exact LUT function from an optimized name. Query `INIT`, input
pins, driving nets, fanout, and generated-RTL correspondence when exact per-LUT
attribution matters. Read
[rtl-mapping-and-reporting.md](references/rtl-mapping-and-reporting.md) for
confidence rules and mode-sized report structures.

## Diagnose logic and routing

1. Report logic depth and route share independently.
2. Call a net high-fanout only from measured fanout. Call it causal only when it appears on the path with a material route segment.
3. Record sites for long routes and inspect replication, hierarchy crossings, endpoint spread, congestion, control sets, and `DONT_TOUCH`.
4. Treat parallel cones as parallel unless one ordered primitive chain traverses both.
5. Determine whether a proposed early signal starts the path or joins it mid-cone.
6. Separate BRAM `DOUT`, `ADDR`, `EN`, `WE`, and `DIN` families.

## Quantify modification directions

For each candidate, identify:

```text
targeted primitive levels and route segments
old cumulative delay to the cut
remaining measured suffix
covered and unaffected path families
new or migrated startpoints
new D, Q, feedback, enable, reset, flush, and hold paths
```

Count removable logic levels separately from routes. Placement replaces removed
routes with new routes, so old route delay is never a guaranteed gain. If only a
mux selector moves, state whether the data mux remains.

For every proposed register cut, measure the producer-side D cone and request:

```text
old end-to-end path
new register D input
new register Q output
feedback or maintenance path
CE, reset, flush, and hold controls
```

## Compare implementations

In Cross-run Comparison mode:

1. Record every configuration or source difference.
2. For a local claim, compare matching boundaries, physical stages, and path families.
3. For a global claim, also compare WNS, TNS, WHS, path populations, delay bins, route ratios, resources, and qualified power.
4. Track families that entered, left, or changed position in the limiting set.
5. Attribute a change to RTL only when source identity and physical evidence support it. Classify isolated route movement as implementation variance.

## Rank recommendations

Rank by measured coverage and structural certainty:

1. Removes primitive levels from the current limiting family.
2. Shortens a high-count shared prefix.
3. Reduces route width, fanout, or physical span.
4. Moves pressure to a measurable D or feedback cone.
5. Changes pipeline, visibility, ordering, forwarding, or flush semantics.

Separate topology edits from microarchitecture changes. This skill does not
claim cycle equivalence. State the contract that an implementation task must
prove.

## Deliver

Every report contains:

1. Answer-first conclusion and exact claim scope.
2. Run and source identity with hashes.
3. Evidence used, missing evidence, and confidence labels.
4. Representative physical paths with primitive and route stages.
5. RTL and cycle-semantic mapping.
6. Ranked modification directions and the boundaries they affect.
7. Exact supplemental DCP queries and raw report index.
8. Implementation handoff with required D, Q, feedback, control, and hold checks.

Add the mode-specific sections defined in
[rtl-mapping-and-reporting.md](references/rtl-mapping-and-reporting.md). Keep
measured facts, mapping, inference, comparison, and recommendation visibly
separate. Report no RTL modification or functional verification unless another
workflow actually performed it.
