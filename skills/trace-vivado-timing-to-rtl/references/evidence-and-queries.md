# Vivado Timing Forensics

## Contents

1. Run identity
2. Artifact and source integrity
3. Evidence by task mode
4. Whole-design path universe
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

Bitstream completion does not prove setup or hold closure. A fixed routed DCP
frequency calculation is an estimate tied to that placement and routing.

## 2. Artifact and source integrity

Preserve and hash the artifacts used by the claim:

```text
routed DCP and relevant implementation outputs
run result and configuration manifest
source hash manifest and generated RTL file list
constraints and Tcl scripts
raw timing and supplemental query reports
```

Add QoR, methodology, utilization, power, congestion, clocking, and control-set
reports only when the analysis uses them. Check each source file used for
semantic mapping against the run manifest. Never silently map a routed path
through a newer checkout.

## 3. Evidence by task mode

### Targeted Path Trace

Minimum evidence:

```text
run identity and source integrity
timing summary or equivalent closure context
one full expanded path for each target
exact directed query and object counts
relevant generated RTL, Chisel source, Design, and constraints
```

Collect high-fanout, congestion, utilization, or methodology reports only when
the target path or proposed explanation requires them.

### Whole-design Timing Audit

Start with:

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

Also preserve applicable exception, methodology, DRC, utilization, hierarchical
utilization, RAM, power, congestion, clock interaction, CDC, pulse-width, and
control-set reports. Preserve intermediate DCPs when they are needed to separate
netlist depth from placement and routing.

### Cross-run Comparison

Use the Targeted set for a local before/after claim. Use the Whole-design set for
a global claim. Query the same population, threshold, family classifier, and
report properties in each run. Record every configuration difference before
comparing metrics.

## 4. Whole-design path universe

This section is required only for Whole-design Timing Audit or a global
Cross-run Comparison.

Build one path per endpoint before selecting representatives:

```tcl
set allEpWorst [get_timing_paths -delay_type max \
  -max_paths 250000 -nworst 1 -unique_pins]
puts "ENDPOINT_WORST_COUNT=[llength $allEpWorst]"
```

Use `list_property [lindex $allEpWorst 0]` before exporting fields. Preserve:

```text
startpoint, endpoint, slack, datapath delay
logic delay, route delay, levels
clock group, endpoint pin type
```

Record the query cap and returned count. Treat `returned == cap` as potentially
truncated. Generate delay and Slack bins, endpoint-type counts, one raw
Slack-sorted list, and one family summary derived from real startpoints and
endpoints. Keep separate identities for family maximum data delay and family
worst Slack.

## 5. Directed path queries

Use exact hierarchy discovered from the routed netlist. Save object counts and
warnings beside every query.

```tcl
set fromPins [get_pins -hier -filter {REF_PIN_NAME =~ Q || REF_PIN_NAME =~ C} \
  -regexp {.*producer_pattern.*}]
set toPins [get_pins -hier -regexp {.*consumer_pattern.*(D|CE|R|ENARDEN|ADDRARDADDR).*}]

report_timing -from $fromPins -to $toPins -delay_type max \
  -max_paths 100 -nworst 20 -unique_pins \
  -path_type full_clock_expanded -input_pins \
  -file directed_from_to.rpt
```

Use `-through` only after confirming the object exists on the desired arc:

```tcl
set throughPins [get_pins -hier -regexp {.*selector_or_mask_pattern.*}]
report_timing -through $throughPins -delay_type max \
  -max_paths 100 -nworst 20 -unique_pins \
  -path_type full_clock_expanded -input_pins \
  -file directed_through.rpt
```

Query register D, CE, reset, and memory pins separately when they define
different boundaries. For module coverage, separate:

```text
outside -> module endpoints
module startpoints -> module endpoints
module startpoints -> outside
paths through defining selector, mask, hit, or ready nets
```

Name a family from the real startpoint and endpoint. Report filenames do not
establish path ownership.

## 6. Primitive and net properties

Obtain the path object first:

```tcl
set paths [get_timing_paths -from $fromPins -to $toPins \
  -delay_type max -max_paths 100 -nworst 20 -unique_pins]
set p [lindex $paths 0]
list_property $p
report_property $p
report_timing -of_objects $p -path_type full_clock_expanded \
  -input_pins -file one_path_full.rpt
```

For an ambiguous LUT:

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

Property availability varies by Vivado version and object type. Run
`list_property` before depending on a property name. For long routes, retain
driver and sink sites, fanout, route delay, and hierarchy crossing.

## 7. Family and boundary queries

For a proposed registered intermediate, collect:

```text
old source -> old consumers
all state producers -> newReg.D
newReg.Q -> all consumers
state, update, release, and flush -> maintenance feedback
clock, reset, CE, and flush -> newReg control pins
```

Split relevant processor structures by:

```text
data versus valid and control
entry state versus pointer or mask
candidate generation versus priority versus data mux
RAM DOUT versus ADDR, EN, WE, DIN
ready output versus ready-maintenance D path
forwarding selector versus forwarding data
```

For every group, save query expressions, expanded object counts, path count,
report status, and raw report.

For a local before/after comparison, use the same representative source and
endpoint plus all new boundary paths. For a global comparison, add the same
endpoint-worst query, threshold, family classifier, closure metrics,
hierarchical utilization, and power-confidence basis.

## 8. Evidence limits

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
8. A register cut is safe without measuring producer D and maintenance cones.
9. The current checkout matches the implemented run without hash evidence.
