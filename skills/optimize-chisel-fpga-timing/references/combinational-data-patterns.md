# Combinational Data Patterns

Read this reference when the measured path is dominated by selection, wide
transport, comparison, arithmetic, late data, or redundant zero handling.

## Distribute pure work before selection

For a pure transform with no state, side effects, or selector dependence:

```text
f(Mux(sel, a, b)) == Mux(sel, f(a), f(b))
```

Apply `f` to candidates in parallel when the result is narrower or when the
selector is late. For a wide storage line, extract the consumed slice from each
candidate before the final selection:

```scala
val candidateWords = VecInit(lines.map(extractWord))
val selectedWord = Mux1H(wayOH, candidateWords)
```

The same transformation can compare each candidate in parallel and select a
one-bit result. Verify duplicated logic, shared-input fanout, and emitted RTL.

## Distribute selector-aligned operations

If aligned one-hot selections feed one pure operation:

```scala
val a = Mux1H(selOH, aCandidates)
val b = Mux1H(selOH, bCandidates)
val result = a + b
```

test the lane-parallel form:

```scala
val candidates = VecInit(
  aCandidates.zip(bCandidates).map { case (x, y) => x + y }
)
val result = Mux1H(selOH, candidates)
```

This is useful only when the limiting source also participates in generating
`selOH`, allowing candidate operations to overlap selector generation. Prove:

- `selOH` is one-hot or zero-hot;
- lane ordering and widths match;
- overflow and truncation are identical;
- zero-hot behavior is valid or separately qualified;
- selector-dependent operands are absent;
- replicated operators and routes do not become limiting.

Count all added operators. Compare both emitted RTL and routed paths.

## Use a guarded compact representation

Replace a full-width comparison with compact identity only inside a domain where
the compact function is injective:

```scala
val same = sameRegion(a, b) && compact(a) === compact(b)
```

Define the region exactly. Cover crossings, wrap, sign extension, and alignment
boundaries. Keep full-width data wherever consumers still need it. Test values
immediately below, at, and above each boundary. Missing a guard creates aliases.

## Reassociate a late override

When a late candidate passes through a second operation-class mux:

```scala
val first = Mux(overrideValid, overrideData, ordinaryData)
val result = Mux(usesOrdinary, first, alternateData)
```

build the ordinary class result in parallel and use one qualified final
override:

```scala
val base = Mux(usesOrdinary, ordinaryData, alternateData)
val result = Mux(usesOrdinary && overrideValid, overrideData, base)
```

Prove the class predicate covers every legal override consumer, data and valid
refer to the same transaction, and other consumers retain their required view.
Use an equivalence assertion during validation when practical.

## Use natural zero behavior and DCE

`PriorityEncoderOH(0.U)` returns zero, so this guard is redundant:

```scala
Mux(mask.orR, PriorityEncoderOH(mask), 0.U)
```

For a one-hot-or-zero selector, `Mux1H` also returns zero. Remove an outer zero
mux only after proving its predicate adds no flush, kill, hold, or transaction
validity semantics:

```scala
assert(PopCount(selOH) <= 1.U)
val selected = Mux1H(selOH, candidates)
```

Within one elaborated top, firtool can remove internal fields that reach no
consumer. Check emitted RTL before adding source-level packing solely for DCE.
Top-level IO remains observable.

## Required evidence

For every selected pattern:

1. Identify the exact selector, data, and operation stages on the measured path.
2. State which primitive levels are expected to leave or move.
3. Inspect emitted RTL for the intended topology and new duplication.
4. Re-query the original family and any new selector, operator, and fanout paths.
5. Run equivalence-focused functional tests and one-hot assertions.
