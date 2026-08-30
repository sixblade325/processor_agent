# Chisel FPGA Timing Patterns

Use these patterns only after closing the local cycle contract. Names are illustrative.

## 1. Register next-state availability

Use when a banked structure's current occupancy and a phase mux form a long `valid` or `ready` path.

Inside each bank, expose the next-state fact that already feeds the state register:

```scala
val noEmptyNext = WireDefault(noEmpty)

when(enqFire && !deqFire) {
  noEmptyNext := true.B
}
when(!enqFire && deqFire) {
  noEmptyNext := !deqRemovesLast
}

io.nextNoEmpty := noEmptyNext
noEmpty := noEmptyNext
```

At the outer level, compute the next port-to-bank mapping and register availability:

```scala
for (p <- 0 until deqWidth) {
  deqValidReg(p) := Mux1H(nextBankOH(p), banks.map(_.io.nextNoEmpty))
}

io.deq(p).valid := deqValidReg(p)
```

Required proof:

- `nextBankOH` is one-hot;
- registered `valid` describes the same bank selected for `bits` next cycle;
- flush initializes bank state and `deqValidReg` consistently;
- a standard `Decoupled` producer holds `valid` and `bits` stable while stalled.

If mapping rotates while `valid && !ready`, add a holding register or freeze the mapping. A specialized non-holding availability protocol must document that exception explicitly.

Do not add flush gates to `ready` or `valid` as part of this optimization unless the original external protocol already requires them. A queue can give flush priority in its internal next-state update while leaving the same-cycle handshake outputs visible. Gating those outputs changes upstream stall timing and can block an unrelated pipeline owner from advancing.

## 2. Register priority pairs from next-state

Use when age-wrap selection and `PriorityEncoderOH` are on the consumer path.

```scala
val nextEntries = WireDefault(entries)
// Apply alloc, wakeup, issue, release, and flush to nextEntries here.

val nextEligible = VecInit(nextEntries.map(entryEligible)).asUInt
val n = entries.length
val lowerMaskNext = (headOHNext - 1.U(n.W))(n - 1, 0)
val upperMaskNext = (~lowerMaskNext)(n - 1, 0)

val highOHNext = PriorityEncoderOH(nextEligible & upperMaskNext)
val lowOHNext  = PriorityEncoderOH(nextEligible & lowerMaskNext)

entries   := nextEntries
highOHReg := highOHNext
lowOHReg  := lowOHNext

val issueOH = Mux(highOHReg.orR, highOHReg, lowOHReg)
```

The entries and both priority results must latch on the same edge from the same next-state version. This preserves the first eligible issue cycle.

Registering only final `issueOH` can place eligibility, wrap selection, and both encoders on one D-input cone. Keeping the two encoder results separate leaves a small Q-side choice and can balance both sides.

For multiple lanes, form each lane's candidate mask in parallel. Avoid feeding one encoder's result into the next encoder when a disjoint partition or precomputed exclusion mask can express the policy.

## 3. Precompute one-hot age masks

For a one-hot head pointer:

```scala
val lowerThanHead = (headOH - 1.U(n.W))(n - 1, 0)
val atOrAfterHead = (~lowerThanHead)(n - 1, 0)
```

Register these masks one cycle before the issue tree when the head update contract allows it. Latch the masks and any selectors derived from them against the same head version.

## 4. Distribute pure work before selecting

When a pure transform is applied after a mux, test whether it can be distributed over the candidates:

```text
f(Mux(sel, a, b)) == Mux(sel, f(a), f(b))
```

This is useful when `f(a)` is narrower than `a`, or when `f` is expensive and otherwise sits serially after selector generation. The transform must have no state, side effects, candidate-specific valid behavior, or selector dependency.

When selecting one word from multiple cache lines, extract all candidate words in parallel and mux only the word:

```scala
val candidateWords = VecInit(lineData.map { line =>
  VecInit.tabulate(wordsPerLine)(w => line(32 * (w + 1) - 1, 32 * w))(wordIdx)
})

val loadWord = Mux1H(hitWayOH, candidateWords)
```

This replaces a wide way mux followed by a dynamic word mux with parallel local extraction plus a narrow way mux. Apply the same rule to Bundles: select an index first, then mux only fields consumed in that stage.

The same rewrite applies to comparisons. Instead of selecting a wide expected value and then comparing it:

```scala
val expected = Mux(taken, imm, 4.U(32.W))
val mismatch = predOffset =/= expected
```

compare both candidates in parallel and select the 1-bit results:

```scala
val takenMismatch = predOffset =/= imm
val fallThroughMismatch = predOffset =/= 4.U(32.W)
val mismatch = Mux(taken, takenMismatch, fallThroughMismatch)
```

This removes the wide mux and comparison from the selector-dependent chain. It can duplicate logic and increase shared-input fanout, so inspect emitted RTL first and use routed A/B evidence to decide whether the trade is beneficial.

### Distribute selector-aligned multi-input work

A distinct form applies when two or more aligned `Mux1H` results feed one shared arithmetic operation:

```scala
val selectedPc = Mux1H(selOH, pcCandidates)
val selectedOffset = Mux1H(selOH, offsetCandidates)
val target = selectedPc + selectedOffset
```

For a one-hot-or-zero selector and fixed-width modular addition:

```text
Mux1H(s, a) + Mux1H(s, b) == Mux1H(s, a + b)
```

The operation can therefore move into each aligned candidate lane:

```scala
val targetCandidates = VecInit(
  pcCandidates.zip(offsetCandidates).map { case (pc, offset) =>
    pc + offset
  }
)
val target = Mux1H(selOH, targetCandidates)
```

This is a timing optimization when the measured critical source also helps generate `selOH`. In the original topology, that source must finish selector generation before it can traverse the shared adder. In the distributed topology, candidate adders run in parallel with selector generation, leaving only the final `Mux1H` after `selOH`.

If `selOH` is independent and joins the data path only at the final mux, this rewrite can add arithmetic resources without shortening the limiting source-to-endpoint path. Confirm all of these conditions:

- `selOH` is one-hot or zero-hot;
- candidate vectors use the same lane ordering;
- each operation is pure and has no selector-dependent operand;
- fixed-width overflow and truncation are identical;
- zero-hot behavior is all zero or is ignored under a separate valid contract;
- the critical source influences selector generation early enough for the duplicated operations to overlap it;
- no new candidate-operation path or increased routing fanout becomes limiting.

For `N` candidates, one shared operator becomes `N` operators. The direct arithmetic cost is `N - 1` additional operators, plus possible LUT, carry-chain, route, and fanout growth. This trade requires emitted-RTL inspection and routed A/B evidence.

### Compare a guarded compact representation

A full-width value can sometimes be replaced on a timing path by a compact representation plus an explicit domain guard:

```scala
val sameTarget =
  sameRegion(a, b) && compactTarget(a) === compactTarget(b)
```

This applies when `compactTarget` is injective inside the guarded region. It can shorten registers, comparators, selectors, and routes while preserving full-width equality.

Required proof:

- define the exact region in which compact equality implies full equality;
- detect every region crossing, wrap, sign-extension, and alignment boundary;
- keep the full-width value wherever it is still needed as output data;
- compare the compact representation before restoring the full-width value;
- test values immediately below, at, and above every guard boundary.

This differs from ordinary bit slicing. The dropped bits still carry identity outside the guarded domain, so omitting the guard creates aliases. The cost is guard logic, duplicated compact comparisons, and additional proof burden. Inspect the previous-stage D path before registering new compact metadata.

If the remaining narrow mux is still on the limiting Q-to-consumer path, test a registered consumer view derived from the same next-state version:

```scala
val issueViewNext = Mux1H(issueOHNext, nextEntries.map(consumerView))

entries  := nextEntries
issueOH  := issueOHNext
issueView := issueViewNext
```

This preserves cycle alignment when all three values latch on the same edge. It moves selection into `issueView`'s D-input cone, so compare that new D path before accepting the change. Do not register a full entry when the consumer reads only a narrow view.

## 5. Reassociate a late-arriving source override

Use when a late forwarding, bypass, replay, or correction candidate is selected before a second mux that determines whether the instruction class consumes that source:

```scala
val srcExec = Mux(fwd.valid, fwd.bits, regSrc)
val aluSrc  = Mux(usesReg, srcExec, nonRegSrc)
```

The late candidate then passes through two serial selector levels. Reassociate the muxes so ordinary operation-class selection proceeds in parallel with forwarding detection and data arrival:

```scala
val baseSrc = Mux(usesReg, regSrc, nonRegSrc)
val aluSrc  = Mux(usesReg && fwd.valid, fwd.bits, baseSrc)
```

For `usesReg`, both forms select `fwd.bits` on a hit and `regSrc` otherwise. For `!usesReg`, both forms select `nonRegSrc`. The late forwarding path now reaches the consumer through one qualified final override mux.

Required proof:

- `usesReg` exactly identifies every operation that may consume the forwarded register source;
- forwarding has no effect when that operation class selects `nonRegSrc`;
- `fwd.bits`, `fwd.valid`, and the instruction identity refer to the same transaction;
- any separate consumer that always needs the forwarded operand keeps its own `srcExec` view;
- the final qualified override does not create a worse select-fanout or routing cone.

Add a temporary or permanent equivalence assertion around the optimized source:

```scala
val referenceSrc = Mux(usesReg, Mux(fwd.valid, fwd.bits, regSrc), nonRegSrc)
when(instValid) {
  assert(aluSrc === referenceSrc)
}
```

Inspect emitted RTL to confirm that the late data passes through only the final override mux. Then compare the complete late-data-to-consumer path and the ordinary `baseSrc` path in routed A/B builds.

This rewrite adds no register and preserves same-cycle forwarding. Registering the forwarding result one stage earlier changes the same-cycle producer-to-consumer RAW contract and requires a separate latency and dependency proof.

## 6. Capture a cross-module predicate locally

Use when a global compare feeds every candidate and then a wide arbitration tree.

```scala
for (i <- entries.indices) {
  when(entries(i).valid) {
    entries(i).robHeadReady := !entries(i).isSerializing ||
      sameRob(entries(i).robIdx, io.robHead)
  }
}

val eligible = entry.valid && entry.operandsReady && entry.robHeadReady
```

Required proof:

- the predicate may be observed one cycle late;
- a stale true cannot authorize an entry after ownership changes;
- the source state remains stable until the authorized entry issues;
- allocation, flush, and slot reuse initialize the local bit.

This pattern trades per-entry FF and D-side compares for a short local Q-to-arbitration path.

The same structure can capture stable update identity while retaining a genuinely late acceptance condition:

```scala
val rawEntryOH = VecInit(
  rawWayOH.asBools.flatMap { way =>
    rawLaneOH.asBools.map(lane => way && lane)
  }
).asUInt
val updateEntryOHReg = RegNext(
  Mux(rawUpdateValid && rawUpdateEnable, rawEntryOH, 0.U)
)

val currentUpdateOH =
  Mux(queryValid, updateEntryOHReg, 0.U)
```

Register only fields that are already available and stable at the producer boundary. Keep query acceptance, fire, or collision conditions in their original cycle when moving them earlier would lengthen the producer D path or change same-cycle semantics.

This differs from local readiness. A readiness bit caches permission to act. An identity register caches which update would act if a later qualifier permits it. The cost is identity FFs and producer-side decode; the benefit is removal of repeated valid, type, way, and lane reconstruction from the response path.

## 7. Manually map fixed dispatch widths

For widths such as two or three, precompute pointer rotations and mutually exclusive count classes:

```scala
val tail1 = rotateLeft(tailOH, 1)
val tail2 = rotateLeft(tailOH, 2)
val tail3 = rotateLeft(tailOH, 3)

val take0 = laneClass(0)
val take1 = laneClass(1)
val take2 = laneClass(2)

// Enumerate the accepted class combinations directly.
// Select tailOH, tail1, tail2, or tail3 with mutually exclusive terms.
```

This avoids dynamic shifts, generic `PopCount` arithmetic, and serial compaction. Keep each lane's allocation event gated by its own fire event. Assert that generated allocation OHs are disjoint.

## 8. Remove an admission-only valid gate

An invalid-lane class bit may be removed from a timing-critical admission cone only when all of these hold:

```text
the class result never directly writes state
all allocation and write events remain gated by laneFire and lane valid
invalid lanes cannot grant themselves or suppress a valid lane selectively
stale class bits can only create an accepted false stall
the user accepts that performance behavior
```

Typical structure:

```scala
val requestClassMask = rawClassBits
val batchReady = capacityAccepts(requestClassMask)

val laneFire = dispatchFire && lane.valid
val allocate = laneFire && rawClassBits(lane)
```

Add assertions tying every state mutation to `laneFire`. Test all invalid-lane class combinations, including stale high bits.

## 9. Decouple side-effect-free RAM reads from late validity

Use when a synchronous RAM read enable is driven by a late transaction-valid or correction signal, while the read itself has no architectural side effect and all consumers retain a separate valid bit.

Original structure:

```scala
ram.io.en := portOwnsArray && requestValid
```

Timing-oriented structure:

```scala
ram.io.en := portOwnsArray

when(requestValidReg) {
  consume(ram.io.rdata)
}
```

For a fixed read phase, `portOwnsArray` can be constant true. Invalid or correction cycles then perform unconsumed reads.

Required proof:

- a read has no state-changing effect outside the RAM's registered output;
- request identity and validity are pipelined separately to every consumer;
- miss detection, response generation, FSM ownership, and refill acquisition remain valid-gated;
- write enable remains transaction-gated and selects the write-owner address;
- RAM read-during-write semantics remain acceptable;
- reset and power-management logic do not rely on the removed enable gate.

Add a write-owner assertion:

```scala
when(writeEnable) {
  assert(writePortOwnsArray && writeRequestValid)
}
```

The benefit is removal of the late valid or correction cone from RAM `EN`. The costs are extra BRAM output toggles, dynamic power, and potentially more read-address activity. This pattern cannot be used when a read launches externally visible work or when enable is required to hold the previous output.

## 10. Pipeline a rare global control event

Use when a global flush, recovery, invalidation, or redirect event has a long combinational path to distant consumers and the architecture can tolerate one additional cycle before those consumers observe it.

Delay the validity and every coupled payload together:

```scala
val flushValidReg = RegNext(io.flush.valid, false.B)
val flushTargetReg = RegEnable(io.flush.target, io.flush.valid)
val flushCauseReg = RegEnable(io.flush.cause, io.flush.valid)

remote.flush.valid := flushValidReg
remote.flush.target := flushTargetReg
remote.flush.cause := flushCauseReg
```

Rarity affects average recovery penalty only. It provides no correctness proof. Close all of these conditions:

- the extra cycle cannot commit, issue, write memory, update CSR state, release storage, or perform another irreversible effect for work that should be killed;
- any local consumer that must react immediately uses an explicitly separate local event;
- redirect target, cause, epoch, ROB identity, and other payloads remain aligned with delayed valid;
- back-to-back and multi-cycle events are preserved without pulse loss;
- delayed consumers do not reuse an index or accept a late response during the intervening cycle;
- the delayed event retains highest priority over normal state updates when it arrives;
- upstream and downstream handshake behavior remains defined while the event is in flight.

If the remote region can still create side effects during the extra cycle, add an immediate local block or pending bit. Include that block in the timing analysis because it can recreate the original high-fanout path.

The benefit is a hard register boundary between event generation and remote distribution. The costs are one cycle of flush or redirect penalty, payload registers, possible pending-state logic, and a new register D path. Query the source-to-register D path, register Q-to-consumer paths, and the pending or feedback cone.

## 11. Replicate a registered global control by consumer region

Use when a registered flush or global control has shallow logic and route-dominated delay caused by high fanout and physical distance. Replace one global Q net with several same-cycle registered Q nets, each driving a disjoint consumer region.

Create all replicas from the same pre-register expression:

```scala
val flushNext = flushEvent
val flushRegs = Seq.fill(nRegions)(RegInit(false.B))

flushRegs.foreach(_ := flushNext)

frontend.io.flush := flushRegs(0)
backend.io.flush := flushRegs(1)
memory.io.flush := flushRegs(2)
```

Feeding `RegNext(existingFlushReg)` into each region adds a cycle. Cloning the register that captures `flushNext` preserves the original registered event cycle.

Plain Wire aliases do not establish physical copies:

```scala
val flushA = WireDefault(flush)
val flushB = WireDefault(flush)
```

Synthesis can collapse those aliases into one net. It can also merge equivalent registers. Prove the implementation structure with the post-synthesis or routed netlist. Use preservation attributes only when repository rules allow them and after checking that they do not block useful placement, retiming, or physical fanout optimization.

Required proof:

- every replica captures the same D expression on the same edge;
- reset, enable, and pulse semantics are identical;
- coupled payloads are replicated or distributed from cycle-aligned registers;
- consumer groups are disjoint and do not reconverge through a new global OR or mux;
- no consumer remains on the original high-fanout net;
- the shared D expression now drives only the replica count, and its D path remains acceptable.

The benefit is reduced Q fanout, shorter local routes, and placement freedom near each consumer group. The costs are extra FFs, clock and reset loads, multiple payload copies, possible congestion, and potential register merging. Replication helps route-dominated paths and does not remove expensive event-generation logic.

## 12. Use natural zero behavior and DCE

`PriorityEncoderOH(0.U)` produces zero. This wrapper adds redundant logic:

```scala
Mux(mask.orR, PriorityEncoderOH(mask), 0.U)
```

Use:

```scala
PriorityEncoderOH(mask)
```

`Mux1H` also produces zero for a zero-hot selector. When the output must be zero while no candidate is selected, this wrapper is redundant:

```scala
val selected = Mux(selOH.orR, Mux1H(selOH, candidates), 0.U)
```

Use:

```scala
val selected = Mux1H(selOH, candidates)
```

Required proof:

- `PopCount(selOH) <= 1.U`;
- the false branch is exactly zero;
- `selOH.orR` is the only meaning of the removed predicate;
- the removed predicate does not also encode flush, kill, hold, or transaction validity;
- downstream logic either consumes the zero result or uses a separate valid signal.

This differs from the `PriorityEncoderOH` case. The encoder rewrite removes a redundant zero-input guard around index generation. The `Mux1H` rewrite removes a redundant zero-output guard around data selection and depends on the output protocol.

For internal Bundles within one elaborated top, firtool removes fields, ports, and registers that do not reach a consumer. Keep semantic Bundles when they improve source clarity, then inspect emitted RTL. Top-level IO fields remain externally observable and cannot be assumed dead.

## 13. Assertions that support timing edits

```scala
assert(PopCount(selectOH) <= 1.U)
assert((writeOH & ~validMask) === 0.U)
assert((allocOH.reduce(_ | _) & releasedOH) === 0.U)
assert(!stateWrite || laneFire)
```

Assertions document the proof boundary. They do not repair an invalid protocol or compensate for misaligned registered data and control.

## 14. Patterns to challenge

- Serial `PriorityEncoderOH` chains for multi-port allocation.
- `PopCount` followed by dynamic rotate for width two or three.
- Whole-entry `Mux1H` when the stage reads only a few fields.
- A wide mux followed by a pure narrow transform that can be distributed across candidates.
- Aligned one-hot selections followed by a shared arithmetic operation when the selector is derived from the critical source.
- Full-width equality or transport where a guarded compact representation is sufficient.
- An outer zero-producing valid mux around a one-hot-or-zero `Mux1H`.
- Late forwarding or override data passing through an avoidable operation-class mux before reaching the consumer.
- Replicated wide equality comparisons directly inside an issue tree.
- Late transaction validity driving a side-effect-free synchronous RAM read enable.
- A rare global event pipelined without proving the intervening cycle is side-effect-free.
- Wire aliases assumed to create physical high-fanout control copies.
- Registered control replicas fed from an existing control Q when same-cycle semantics are required.
- Registering a final selector without checking its D-input cone.
- `dontTouch` used to force speculative timing structure.
- A source-level six-input expression assumed to map to one LUT6 without netlist evidence.
- A register added to `ready` without checking `valid` and `bits` stability.
