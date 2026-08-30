# Chisel Implementation Guidance

## Express topology

Use per-entry candidate generation:

```scala
val candidate = VecInit(entries.indices.map { i =>
  valid(i) && condition(i)
}).asUInt
```

Keep independent issue lanes structurally separate when they require independent comparison and selection networks.

## State updates

Compute next state from one priority tree:

```scala
when(reset) {
  // reset
}.elsewhen(flush) {
  // invalidate
}.elsewhen(release) {
  // release
}.elsewhen(response) {
  // update
}.elsewhen(allocate) {
  // allocate
}
```

Use explicit exceptions for committed state or non-cancelable transactions.

When committed and speculative entries share a structure, compute flush next state per entry:

```scala
when(flush) {
  nextValid(i) := valid(i) && committed(i)
}
```

Do not apply one blanket clear rule to mixed-lifetime entries.

## Masks

State mask semantics independently from physical representation.

```scala
nextMask := (oldMask & ~clearMask) | setMask
```

Define whether clear or set wins for overlapping bits. Assert impossible overlaps when required.

## Responses

For fixed pipelines, carry the minimum identity proven necessary. A bare index is valid when the target cannot be released and reused before the response. Add ROB tag, generation, or epoch only when a concrete lifetime permits stale targeting. Block all forbidden writes on flush before clearing pipeline registers.

For long-latency structures, retain ownership until response:

```text
valid owner
-> external request
-> response
-> state update
-> owner clear
-> slot release
```

## Assertions

Useful forms:

```scala
assert(PopCount(selectOH) <= 1.U)
assert(!(releaseMask & allocateMask).orR)
assert((subMask & ~parentMask) === 0.U)
```

Assert ownership:

```scala
when(response.valid) {
  assert(owner.valid)
  assert(targetEntry.valid)
}
```

Assert flush:

```scala
when(globalFlush) {
  assert(!architecturalWrite)
  assert(!newQueueAllocation)
}
```

## FPGA timing

RTL cannot guarantee placement. Synthesis may share, duplicate, absorb, or restructure common expressions.

Use timing reports to decide:

- signal replication;
- register insertion;
- memory implementation;
- lane partitioning;
- floorplanning or vendor attributes.

Only register boundaries reliably force a cycle cut.
