# Project-Derived Case Studies

These cases came from one LoongArch Chisel FPGA project. Reuse the reasoning pattern and remeasure every design.

## LDQ and STQ priority-pair registers

Initial structure latched a final issue selector after age partition and priority work. The D-input cone remained long. The revised structure latched the high-region and low-region `PriorityEncoderOH` results computed from the same `nextEntries` version, then selected between the two registered OH values on the Q side.

Observed in one routed comparison:

- D-input slack improved by about `0.554 ns`.
- Data path delay fell by about `0.337 ns`.
- Logic levels fell from 15 to 14.
- Q-output slack improved by about `1.113 ns`.
- The D and Q sides became balanced within about `0.066 ns`.
- Full-design cost increased by about 124 LUT and 30 FF.

Lesson: register smaller intermediate results when a final registered result overloads its D cone. Preserve the first issue cycle by deriving entries and selectors from the same next-state version.

## Banked free-list registered availability

The original port `valid` depended on current SubFIFO occupancy plus a rotating port-to-bank mux. Each SubFIFO exposed `nextNoEmpty`, and the outer free-list registered the availability of the bank mapped to each port for the next cycle.

Lesson: next-state facts can move bank occupancy and phase selection off the consumer path. Check standard `Decoupled` hold semantics and align `bits` to the same mapping.

## Dcache narrow-before-select

The load path selected a wide cache-line candidate and then selected one word. The optimized path extracted each candidate word in parallel and performed the final way selection on 32-bit values.

The same pattern was later applied to a three-word ICache fetch group. Each way cropped its fetch group in S2 while tag hit generation ran in parallel, then the hit-way result was selected and registered into S3. This removed hit-way cache-line selection from the S3-to-PreDecoder path. It moved per-way shifts and the hit-way mux into the S2 register D cone, so the optimization required checking that new boundary separately.

Lesson: crop or decode near each producer before a cross-way or cross-module mux. This reduces routed bus width as well as logical mux width. When the narrow result crosses a register boundary, report both the shortened Q-side consumer path and the enlarged producer D path.

## Branch compare-before-select

The branch prediction check selected either a 32-bit taken offset or the 32-bit fall-through offset, then compared the selected value with `predOffset`. The optimized form compared `predOffset` with both candidates in parallel and selected the two 1-bit mismatch results with `realJp`.

The Boolean rewrite is exact for two-state hardware values:

```text
predOffset != Mux(realJp, imm, 4)
  == Mux(realJp, predOffset != imm, predOffset != 4)
```

Emitted SystemVerilog confirmed that the wide mux moved out of the selector-dependent comparison chain. This proves the intended RTL topology, not a routed timing gain. The rewrite duplicates a comparison branch and increases `predOffset` fanout, so `CARRY4`, route delay, endpoint slack, resources, and global WNS still require a same-constraint routed A/B run.

Lesson: distribute a pure transform over mux candidates when it moves expensive work parallel to selector generation and leaves only a narrow result mux. Check duplicated logic and shared-input fanout before accepting it.

## ArithPipe late forwarding override

An arithmetic execute path first selected the forwarded register operand, then passed that result through a second mux that selected register, PC, immediate, or constant operands:

```scala
val srcExec = Mux(fwd.valid, fwd.bits, regSrc)
val aluSrc  = Mux(usesReg, srcExec, nonRegSrc)
```

The rewrite built the ordinary operation-class base in parallel and allowed forwarding to override it only for instructions that consume the register source:

```scala
val baseSrc = Mux(usesReg, regSrc, nonRegSrc)
val aluSrc  = Mux(usesReg && fwd.valid, fwd.bits, baseSrc)
```

The branch checker retained its separate fully forwarded operand view because branch comparison consumes the register operands through a different path.

One routed comparison measured the ArithPipe EX-to-WB path:

- path delay changed from `11.071 ns` to `10.817 ns`;
- logic delay changed from `2.280 ns` to `2.045 ns`;
- route delay changed from `8.791 ns` to `8.772 ns`;
- logic levels changed from 13 to 11.

The measured `0.254 ns` gain came primarily from removing two logic levels. This was a combinational mux reassociation with no new register and no cycle change. Registering the forwarding result would alter the same-cycle WB-to-EX dependency contract and was excluded from this optimization.

Lesson: when a late candidate only overrides one source class, perform ordinary class selection in parallel and put the late candidate on one final qualified mux. Preserve separate consumers and prove the class predicate exactly.

## MemIQ local ROB-head readiness

CACOP eligibility dynamically compared each entry's ROB identity with a global `robHead`, then fed candidate and age arbitration. A per-entry `robHeadReady` bit captured this predicate one cycle earlier. Issue arbitration consumed local Q outputs.

Lesson: replicate cheap D-side compares and store a local predicate when a global identity bus and comparator farm feed a critical issue tree. Prove that one-cycle delay and stale-true behavior are safe.

## Dispatch raw class masks

Load and Store class masks originally ANDed class bits with lane validity on an admission path. Queue and ROB mutations were already gated by `laneFire`. Removing validity from the class mask removed a small LUT level. Invalid-lane class bits could only create a false stall, which the design accepted as a performance effect.

One routed path showed a class-plus-valid LUT2 cell delay of about `0.125 ns`, while adjacent routes were around `1.007 ns` and `0.741 ns`.

Lesson: remove an admission-only gate only after tracing every state mutation. Also inspect route delay, since deleting a small LUT may leave physical routing as the dominant cost.

## Route-dominated cross-module path

One full path contained 15 LUT levels with about `2.121 ns` logic delay and `9.513 ns` route delay. A source-level encoder was visible in the cone, yet cross-module routing dominated the result.

Lesson: expose each timing level and route segment before assigning blame. Do not name a source primitive as the bottleneck from path membership alone.

## Demand-granular LSQ admission

Changing LDQ and STQ admission from a coarse batch threshold to registered low-contiguous capacity masks improved utilization and resource behavior. It also moved pressure to the Dispatch-to-LSQ maintenance path. The registered mask Q-to-ready cone was shallow, while generation and cross-module routing became the important paths.

Lesson: a better capacity policy can shift the bottleneck from admission output to next-state maintenance. Query both sides of the new register boundary.

## Main BTB guarded compact repair comparison

The original repair path retained a 32-bit S1 next-PC value and compared wide selected targets after the synchronous Main BTB read. The optimized path retained one `anyJump` bit and a 15-bit compressed target. Each physical lane compared compact targets in parallel, then lane mapping and first-taken selection operated on narrow results. Full-width targets remained only on redirect-data paths.

Compact target equality was insufficient across a 128 KiB region boundary. An explicit region-crossing guard prevented low-bit aliases when sequential PC crossed that boundary.

Emitted RTL removed the 32-bit `s1NextPcFC` register and full-width repair equality. Directed Verilator tests covered the four S1/S2 jump combinations, the region boundary, address wrap, and 4096 fixed-seed random inputs. This edit had no isolated routed A/B result.

This differs from cache-line cropping. Cache extraction drops bits that the consumer never needs. Compact repair comparison drops identity bits only inside a proven domain and therefore requires an alias guard. The benefit is narrower state, comparisons, selection, and routing. The costs are guard logic, parallel compact comparisons, and boundary-focused verification.

Lesson: use a compact representation on a critical equality path only when an explicit guard makes compact equality equivalent to full equality over every reachable case.

## Main BTB producer-boundary update identity

The response path reconstructed a pending Main BTB update from registered validity, `jumpEn`, way, and physical lane. The optimized design formed the entry one-hot identity at the raw Commit boundary and registered zero for no update. Current and previous forwarding consumed that registered identity, while `query.valid` remained a same-cycle final qualifier.

This differs from MemIQ local ROB-head readiness. The MemIQ bit caches permission to issue. The BTB register caches update identity and leaves query acceptance live in its original cycle. Moving `pfFire` or query acceptance into the producer D cone was deliberately excluded because that preceding path was already tight.

The cost was an 8-bit entry-OH register, producer-side decode, and identity assertions. Verilator passed the directed Main BTB forwarding test and the 9/9 Frontend regression. Emitted RTL showed registered update-valid and entry-OH state directly driving Main BTB update and forwarding. Routed WNS and Fmax benefit remained unmeasured at the time of the edit.

Lesson: precompute stable identity at the earliest safe boundary, while preserving truly late acceptance conditions in their original cycle. Audit the new producer D path before moving any additional qualifier.

## ICache FSM next-state output register

An ICache response-source selector was originally decoded combinationally from the FSM state:

```scala
io.cc.r1H := Mux(mState === mWait, 2.U, 1.U)
```

The state Q output therefore passed through a decode LUT before controlling the wide cache/refill response mux. The revised FSM centralized all transitions in `mStateNext` and registered the selector from the same next-state version:

```scala
mState  := mStateNext
r1HReg  := Mux(mStateNext === mWait, 2.U, 1.U)
io.cc.r1H := r1HReg

assert(r1HReg === Mux(mState === mWait, 2.U, 1.U))
```

Because `mState` and `r1HReg` update on the same edge, the selector keeps the original cycle semantics when entering, holding, and leaving `mWait`. Emitted RTL confirmed that the output is driven directly by the selector register Q. Focused Verilator tests passed.

A later routed build showed `r1HReg` itself as the launch register for the active ICache-response path, with no state-decode LUT between the FSM register boundary and the response selector. That build also contained other frontend changes, so it confirms the intended topology and does not isolate this edit's WNS gain.

Lesson: a Moore-style output that is fully determined by FSM state can be registered from `nextState` alongside the state register. This removes state decoding from the consumer path without adding a cycle. Check the new selector-register D path, reset value, hold behavior, and an equivalence assertion before accepting the cut.

## ICache side-effect-free read-enable decoupling

The ICache S1 tag/data BRAM enable depended on `c1s1.rreq`. That request-valid bit was reached from Main BTB repair through Frontend request control, creating a long path to every BRAM `EN` pin.

S1 already owned the array read port, and an invalid read had no side effect. The optimized design enabled the S1 read from ownership alone:

```scala
val arrayEnable = Mux1H(
  addrOH,
  Seq(true.B, c1s2.rreq, c1s3.rreq)
)
```

`c1s1.rreq` still crossed the pipeline and gated miss acquisition, response generation, and FSM ownership. S2 and S3 retained their request-valid enable conditions. Writes retained S3 ownership and request validity, protected by:

```scala
when(memWe.orR) {
  assert(addrOH(2) && c1s3.rreq)
}
```

Generated RTL confirmed that BRAM enable no longer depended on the Frontend request-valid input. The ICache refill Verilator suite passed 8/8. In a later routed build, the previous Predict-commit-to-ICache-BRAM-enable family no longer appeared among paths over 10 ns. The build included other frontend changes, so no isolated slack gain was assigned.

This differs from registering BRAM enable. It adds no cycle and does not create an enable-hold state. It removes a control dependency by accepting unconsumed reads. The cost is BRAM dynamic switching on correction, ADEF, and request-bubble cycles.

Lesson: when a synchronous RAM read is side-effect-free and transaction validity is carried separately, remove late validity from read enable and retain strict gating only on consumers and writes.

## FetchQueue registered next-head view

A FetchQueue-specific ClusterFIFO removed random-read support and registered the next logical dequeue package. The consumer then started from `deqBitsReg` instead of traversing bank mapping and head selection after the clock edge.

This extends the banked free-list availability pattern. The free-list case registers a Boolean availability fact. The FetchQueue case registers a wide consumer package derived from enqueue data, queue next state, bank head candidates, and logical port mapping. It removes more Q-side work and creates a much larger D-input maintenance cone.

A flush-gated `enq.ready` and `deq.valid` variant changed the original external handshake. Commit correction, an old aligned ICache S2 request, and a new ADEF target could overlap. The new global stall then blocked ICache S3/FSM ownership from advancing. Restoring the original visible handshake and giving flush priority only in queue state update repaired the protocol:

```scala
io.enq.foreach(_.ready := allBanksCanEnq)
io.deq(port).valid := deqValidReg(port)
```

In a later routed build, `ICacheFSM r1HReg -> FetchQueue deqBitsReg.D` reached `10.004 ns`. The final three LUT levels belonged to enqueue-package, bank-head, and logical-head next-state selection. This is direct evidence that the optimization transferred pressure to the registered view's D cone.

Lesson: registering a wide next-state consumer view can remove the output mux while making the enqueue-to-view maintenance path critical. Preserve the baseline flush handshake exactly and query the new D endpoint before claiming a net gain.

## PreDecoder source-derived flushOH target generation

The original three-lane redirect path selected `pc` and `offset` independently, guarded both selected values with `flush`, and then added the selected values in NPC:

```scala
val flushOH = PriorityEncoderOH(flushVec.asUInt)
val flush = flushVec.asUInt.orR

val selectedPc =
  Mux(flush, Mux1H(flushOH, lanePc), 0.U)
val selectedOffset =
  Mux(flush, Mux1H(flushOH, laneOffset), 0.U)
val target = selectedPc + selectedOffset
```

The optimized path computes each lane target in parallel and selects the final target:

```scala
val laneTarget = VecInit(
  lanePc.zip(laneOffset).map { case (pc, offset) => pc + offset }
)
val target = Mux1H(flushOH, laneTarget)
```

The two outer guards were redundant because `flush == flushOH.orR`, `flushOH` is one-hot-or-zero, and zero-hot `Mux1H` already returns zero. `flush` remained as a separate redirect-valid signal.

This rewrite paid for three 32-bit lane adders in place of one shared 32-bit adder, a net increase of two adders. Its timing benefit depended on the measured path topology. ICache response and Local PHT data participated in each lane's `npcFlush`, then in `flushOH`. In the old topology, the same late source traversed `flushOH` generation before reaching the shared target adder. In the new topology, each lane adder runs while `flushOH` is being generated, and only the final target `Mux1H` remains after the selector.

This differs from Dcache narrow-before-select. The selected width remains 32 bits, and the gain comes from overlapping a carry chain with source-derived selector generation at the cost of replicated arithmetic. It also differs from Branch compare-before-select. The branch case selects a 1-bit comparison result, while this case still selects a 32-bit result and therefore carries a larger area and routing cost.

One routed comparison between the previous 90 MHz build and the frontend-refactored 95 MHz build observed:

- requested `95.000 MHz`, actual `94.737 MHz`, `WNS = +0.160 ns`, and `TNS = 0`;
- `r1HReg -> Frontend PC` maximum data delay reduced from `10.786 ns` to `8.542 ns`, a `2.244 ns` reduction;
- endpoint-unique paths over `10 ns` reduced from `199` to `6`;
- maximum data delay reduced from `10.786 ns` to `10.073 ns`;
- the bottleneck moved to ICache response-to-RAS/FetchQueue and Local PHT-to-PC paths.

The comparison included other frontend source changes and a new physical implementation. The matching `r1HReg -> Frontend PC` path family is direct local evidence for this topology change; the full-design improvements cannot all be assigned to this one edit.

The cost and remaining pressure were visible in the same build:

- Local PHT-to-PC still traversed a per-lane target carry chain and final NPC selection;
- `r1HReg -> FetchQueue` increased from `9.666 ns` to `10.004 ns`;
- `r1HReg -> RAS` increased from `9.025 ns` to `9.749 ns`;
- replicated adders can increase LUT/CARRY use, candidate-data fanout, and placement pressure.

Directed Decoder and Frontend tests passed, and emitted RTL showed per-lane target adders followed by the final `flushOH` selection.

Lesson: distribute aligned arithmetic before one-hot selection only after proving that the critical source generates the selector and that the shared arithmetic lies after selector generation. Count the replicated operators explicitly and remeasure both the shortened path family and newly tightened consumers.

## Reusable conclusions

1. Register an early fact only when it is available from next-state logic and cycle-aligned with its data.
2. Balance D-side and Q-side work instead of optimizing only the visible output.
3. Reduce width before long selection or routing.
4. Distribute pure transforms across mux candidates when this leaves only a narrow selector-dependent result.
5. Reassociate nested source muxes so late override data reaches the consumer through one qualified final mux.
6. Replace global live predicates with local registered facts when lifetime rules permit.
7. Remove admission-only conditions only after proving all state changes remain fire-gated.
8. Inspect emitted RTL for DCE and encoder behavior before paying for a full implementation run.
9. Treat routed path data as local evidence tied to one build configuration.
10. Remove an outer valid or flush mux around `Mux1H` only when zero-hot selection already provides the required zero result and the removed predicate carries no extra protocol meaning.
11. Move aligned arithmetic before one-hot selection when the selector is derived from the critical source, then account for every replicated operator and any new route pressure.
12. Use guarded compact equality only after proving every alias boundary.
13. Register stable update identity early while leaving late acceptance in its original cycle.
14. Decouple a side-effect-free RAM read from late validity only when every consumer and write remains separately gated.
15. A registered wide queue view transfers timing pressure to its D-input maintenance cone and must preserve the original flush handshake.
16. Pipeline a rare global event only after proving the intervening cycle cannot create an irreversible side effect.
17. Replicate an already registered global control from the same D expression, partition consumers physically, and verify that synthesis retained distinct Q drivers.
