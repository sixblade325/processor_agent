# Vivado Timing Forensics

## Contents

1. Run identity
2. Artifact and source integrity
3. Minimum routed reports
4. Path-universe queries
5. Directed path queries
6. Primitive and net properties
7. Family and boundary queries
8. Evidence limits

## 1. Run identity

Record before analysis:

```text
Vivado version and build
part, package, speed grade, top
source revision and dirty files
elaboration parameters and generated RTL manifest
clock periods and generated clocks
XDC order and timing exceptions
synthesis and implementation strategies
directives, seed, incremental state, phys_opt calls
routed DCP path and SHA256
report command and report hash
```

Bitstream completion does not prove setup or hold closure. A fixed routed DCP frequency calculation is an estimate tied to that placement and routing.

## 2. Artifact and source integrity

Preserve and hash:

```text
routed DCP, bitstream, probes
README, run_result, environment or configuration manifest
source hash manifest and generated RTL file list
constraints and Tcl scripts
all raw timing, QoR, methodology, resource, and power reports
supplemental query Tcl and output
```

Check every source file used for semantic mapping against the run manifest. When a job modified an isolated copy, record the replacement script and use the routed hierarchy to confirm the instantiated variant. Never silently map a routed path through a newer checkout.

## 3. Minimum routed reports

Collect:

```tcl
open_checkpoint soc_top_routed.dcp
report_timing_summary -delay_type min_max -check_timing_verbose \
  -report_unconstrained -file timing_summary.rpt
report_timing -delay_type max -max_paths 500 -nworst 20 \
  -path_type full_clock_expanded -input_pins -file setup_paths.rpt
report_timing -delay_type min -max_paths 500 -nworst 20 \
  -path_type full_clock_expanded -input_pins -file hold_paths.rpt
report_high_fanout_nets -fanout_greater_than 64 -max_nets 1000 \
  -timing -file high_fanout.rpt
report_design_analysis -timing -setup -max_paths 200 \
  -file design_analysis_timing.rpt
report_route_status -file route_status.rpt
report_clock_utilization -file clock_utilization.rpt
report_qor_assessment -file qor_assessment.rpt
```

Also preserve `report_exceptions`, `report_methodology`, `report_drc`, `report_utilization`, hierarchical utilization, RAM utilization, power, congestion, clock interaction, CDC, pulse-width, and control-set reports.

When available, preserve post-synth, post-opt, post-place, post-physopt, and routed DCPs. They separate netlist depth changes from placement and route changes.

## 4. Path-universe queries

Build a one-path-per-endpoint universe before selecting representative paths:

```tcl
set allEpWorst [get_timing_paths -delay_type max \
  -max_paths 250000 -nworst 1 -unique_pins]
puts "ENDPOINT_WORST_COUNT=[llength $allEpWorst]"
```

Use `list_property [lindex $allEpWorst 0]` before exporting fields. Preserve at least:

```text
startpoint, endpoint, slack, datapath delay
logic delay, route delay, levels
clock group, endpoint pin type
```

Record the query cap and returned count. Treat `returned == cap` as potentially truncated. Generate:

1. Delay and Slack bins.
2. Endpoint type counts for register D, CE, reset/set, BRAM address, enable, write enable, input, and output.
3. One raw list sorted by Slack.
4. One family summary built from actual startpoints and endpoints.

The family maximum data delay and family worst Slack can come from different paths. Keep both identities.

## 5. Directed path queries

Use exact hierarchy discovered from the routed netlist. Save object counts and warnings next to every query.

```tcl
set fromPins [get_pins -hier -filter {REF_PIN_NAME =~ Q || REF_PIN_NAME =~ C} \
  -regexp {.*predict.*updateSetReg.*}]
set toPins [get_pins -hier -regexp {.*l1ic.*(D|CE|R|ENARDEN|ADDRARDADDR).*}]

report_timing -from $fromPins -to $toPins -delay_type max \
  -max_paths 100 -nworst 20 -unique_pins \
  -path_type full_clock_expanded -input_pins \
  -file directed_from_to.rpt
```

Use `-through` only after confirming the object exists and is on the desired timing arc:

```tcl
set throughPins [get_pins -hier -regexp {.*issueOH.*|.*hitOH.*}]
report_timing -through $throughPins -delay_type max \
  -max_paths 100 -nworst 20 -unique_pins \
  -path_type full_clock_expanded -input_pins \
  -file through_issue_or_hit.rpt
```

For endpoint diversity, query registers, CE/reset pins, and memory pins separately. For startpoint diversity, run independent queries per state family instead of relying on one global top list.

For module and pipeline coverage, query incoming, internal, outgoing, and through paths separately:

```text
outside -> module endpoints
module startpoints -> module endpoints
module startpoints -> outside
all paths through defining selector, mask, hit, or ready nets
```

Name a path family from the real startpoint and endpoint. A report named for LDQ can contain an upstream LSU path that merely ends inside LDQ.

## 6. Primitive and net properties

Obtain the timing path object first:

```tcl
set paths [get_timing_paths -from $fromPins -to $toPins \
  -delay_type max -max_paths 100 -nworst 20 -unique_pins]
set p [lindex $paths 0]
list_property $p
report_property $p
report_timing -of_objects $p -path_type full_clock_expanded \
  -input_pins -file one_path_full.rpt
```

For every ambiguous LUT:

```tcl
set c [get_cells -hier -filter {NAME == "<full-cell-name>"}]
report_property $c
get_property REF_NAME $c
get_property LOC $c
get_property INIT $c

set inPins [get_pins -of_objects $c -filter {DIRECTION == IN}]
set outPins [get_pins -of_objects $c -filter {DIRECTION == OUT}]
foreach pin $inPins {
  puts "PIN=$pin NET=[get_nets -of_objects $pin] DRIVER=[get_pins -leaf -of_objects [get_nets -of_objects $pin] -filter {DIRECTION == OUT}]"
}
foreach pin $outPins {
  set net [get_nets -of_objects $pin]
  puts "OUT=$pin NET=$net LOADS=[llength [get_pins -leaf -of_objects $net -filter {DIRECTION == IN}]]"
  report_property $net
}
```

Property availability varies by Vivado version and object type. Run `list_property` before depending on a property name. Keep raw output when `INIT`, routed nodes, or timing arcs are unavailable.

For every long route segment, retain driver cell/site, sink cell/site, net fanout, route delay, and hierarchy crossing. Query congestion and replication before assigning cause.

## 7. Family and boundary queries

For a proposed registered intermediate, collect five groups:

```text
old source -> old consumers
all state producers -> newReg.D
newReg.Q -> all consumers
state/update/release/flush -> maintenance feedback
clock/reset/CE/flush -> newReg control pins
```

For processor structures, also split:

```text
data path versus valid/control path
entry state versus global pointer or mask
candidate generation versus priority selection versus data mux
RAM DOUT versus ADDR, EN, WE, DIN
ready output versus ready-maintenance D path
forwarding selector versus forwarding data
```

For every group, save from/to/through expressions, expanded object counts, path count, report status, and raw report.

For before/after comparisons, use this minimum matrix:

```text
same global closure metrics
same endpoint-worst query and threshold
same family classifier
same representative source/end boundary when it still exists
new producer-side D path
new consumer-side Q path
feedback, CE, reset, flush, and hold paths
hierarchical utilization and power confidence
```

## 8. Evidence limits

Use these labels:

| Label | Required evidence |
|---|---|
| measured | Vivado path or object property directly reports it |
| mapped | netlist connectivity, LUT INIT, pins, or emitted RTL closes the mapping |
| inferred | source and consumer constrain the cell to a semantic region |
| unknown | required DCP query, generated RTL, or source contract is absent |

Do not claim:

1. A high-fanout net caused WNS without its route delay on the representative path.
2. A visible LUT is removable without identifying its other inputs and consumers.
3. An old route delay will disappear numerically after a source edit.
4. A module is timing-clean because it is absent from a global top-N report.
5. Maximum frequency from one fixed-DCP WNS calculation.
6. A path is false from architectural intuition alone.
7. A logic edit caused a route improvement from one implementation sample.
8. A register cut is safe without measuring its producer-side D and maintenance cones.
9. A high-fanout signal caused a path when it is absent from that path.
10. The current checkout matches the implemented run without hash evidence.
