# Register Boundary Patterns

Read this reference when a consumer path can use a fact derived from the prior
cycle or from the same next-state version as its governing state.

## Register next-state availability

Expose the next-state fact already used to update a bank or queue:

```scala
val nonEmptyNext = WireDefault(nonEmpty)
when(enqFire && !deqFire) { nonEmptyNext := true.B }
when(!enqFire && deqFire) { nonEmptyNext := !deqRemovesLast }

io.nextNonEmpty := nonEmptyNext
nonEmpty := nonEmptyNext
```

An outer selector may register availability for the mapping used next cycle:

```scala
validReg := Mux1H(nextBankOH, banks.map(_.io.nextNonEmpty))
```

Prove mapping, payload, and validity refer to the same logical state version.
If `valid && !ready` must hold, freeze the mapping or hold both data and valid.
Keep externally visible flush handshake semantics unchanged.

## Register priority results from next-state

When age partitioning and priority encoding sit on a consumer path, derive
smaller priority results from the same `nextEntries` version that is registered:

```scala
val eligibleNext = VecInit(nextEntries.map(isEligible)).asUInt
val highOHNext = PriorityEncoderOH(eligibleNext & highMaskNext)
val lowOHNext = PriorityEncoderOH(eligibleNext & lowMaskNext)

entries := nextEntries
highOHReg := highOHNext
lowOHReg := lowOHNext

val selectedOH = Mux(highOHReg.orR, highOHReg, lowOHReg)
```

This can balance producer D and consumer Q cones better than registering one
final selector. Latch entries, masks, and priority results from the same version.
For a one-hot head, age-region masks may be precomputed as:

```scala
val lower = (headOH - 1.U(n.W))(n - 1, 0)
val upper = (~lower)(n - 1, 0)
```

## Register a narrow consumer view

If a narrow mux remains limiting, register only the fields the next stage uses:

```scala
val viewNext = Mux1H(selectOHNext, nextEntries.map(consumerView))
entries := nextEntries
selectOHReg := selectOHNext
viewReg := viewNext
```

This moves selection to the new register D cone. Measure that D path before
accepting the change. Avoid registering a full entry for a narrow consumer.

## Capture a local predicate

A global identity comparison feeding every arbitration candidate can become a
local per-entry predicate one cycle earlier. Prove:

- one-cycle-old permission is architecturally legal;
- stale true cannot authorize a new owner;
- source identity remains stable through use;
- allocation, flush, release, and reuse initialize the predicate;
- D-side comparison cost and added FFs are acceptable.

This trades distributed D-side work and state for a shorter local Q path.

## Capture stable update identity

When a response reconstructs an update target from stable fields plus a late
acceptance signal, register the stable identity at its producer boundary:

```scala
val updateOHReg = RegNext(
  Mux(rawValid && rawEnable, rawEntryOH, 0.U)
)
val acceptedUpdateOH = Mux(lateAccept, updateOHReg, 0.U)
```

Keep acceptance, collision, or fire conditions in their original cycle when
moving them would change behavior or overload the producer D cone. Distinguish
cached identity from cached permission.

## Register-cut acceptance

Every cut must satisfy:

1. The fact is available early enough.
2. Data, selector, validity, and identity use one state version.
3. Backpressure stability remains valid.
4. Flush and reset initialize all coupled registers consistently.
5. The new D maintenance cone is acceptable.
6. The Q consumer cone is shorter.
7. Feedback does not recreate the old path.

Measure old end-to-end, new D, new Q, feedback, CE, reset, flush, and hold paths.
An improved consumer path with a worse producer D path is bottleneck movement,
not closure.
