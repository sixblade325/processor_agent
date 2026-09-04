# Protocol and Storage Patterns

Read this reference when the timing cone contains allocation arithmetic,
admission control, queue handshakes, or synchronous memory controls.

## Preserve the protocol boundary

Before editing, classify the interface as standard `Decoupled`, pulse,
fire-cycle-only data, atomic batch, or another documented protocol. Separate:

```text
admission and ready calculation
accepted fire event
state mutation
visible valid and data holding
flush priority in next-state update
```

A timing edit must not silently change upstream stall, downstream visibility,
or same-cycle ownership.

## Map small fixed allocation widths directly

For a fixed width such as two or three, precompute pointer rotations and
mutually exclusive accepted-count classes:

```scala
val tail1 = rotateLeft(tailOH, 1)
val tail2 = rotateLeft(tailOH, 2)
val tail3 = rotateLeft(tailOH, 3)
```

Select among these fixed values with explicit disjoint terms. This can avoid a
generic `PopCount`, dynamic shift, or serial compaction chain. Keep each lane's
allocation gated by its own acceptance event and assert allocation OHs are
disjoint.

## Remove an admission-only valid gate

Remove a late condition from admission only when all of these hold:

- the condition never directly writes state;
- every allocation and write remains gated by lane acceptance and validity;
- an invalid lane cannot grant itself or selectively suppress a valid lane;
- stale classification can cause only a documented false stall;
- the performance effect is accepted.

```scala
val classMask = rawClassBits
val batchReady = capacityAccepts(classMask)

val laneFire = dispatchFire && lane.valid
val allocate = laneFire && rawClassBits(lane)
```

Assert that every state mutation implies `laneFire`. Test invalid-lane class
combinations, including stale high bits.

## Decouple a side-effect-free RAM read from late validity

If a synchronous RAM read is side-effect-free and all consumers carry separate
validity, remove late transaction validity from the read enable:

```scala
ram.io.en := portOwnsArray

when(requestValidReg) {
  consume(ram.io.rdata)
}
```

Prove:

- an unused read causes no state-changing effect;
- identity and validity reach every consumer together;
- responses, ownership changes, and external requests remain valid-gated;
- writes retain transaction validity and the correct write-owner address;
- read-during-write, output-hold, reset, and power semantics remain acceptable.

```scala
when(writeEnable) {
  assert(writePortOwnsArray && writeRequestValid)
}
```

The likely cost is extra memory-output toggling and dynamic power. Reject this
pattern when read enable launches work or is required to hold prior output.

## Flush and queue visibility

Giving flush priority in internal next-state updates does not automatically
authorize combinationally gating `ready`, `valid`, or `bits`. Such gating can
change stall timing and prevent another pipeline owner from advancing. Preserve
the documented visible handshake while clearing state at the specified edge.

Test normal traffic, full and empty boundaries, simultaneous enqueue and
dequeue, backpressure, flush overlap, invalid lanes, and reset.
