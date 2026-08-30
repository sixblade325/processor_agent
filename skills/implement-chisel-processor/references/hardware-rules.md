# Chisel Hardware Rules

## Combinational structure

- Reason about elaborated gates, fanout, mux depth, and register boundaries, not Scala execution order.
- Build candidate sets as `UInt` masks and select with one-hot signals.
- Require `Mux1H` inputs to be one-hot or zero-hot and assert `PopCount(selOH) <= 1.U`.
- Avoid chained priority encoders, serial allocation folds, and ready-to-valid combinational dependencies.
- Use tree reduction for wide OR/AND networks when library support exists.
- Avoid muxing an entire entry when only kind, index, or one data field is consumed.
- Determine whether each `for`, `map`, `fold`, `reduce`, and recursion elaborates to parallel logic or a dependency chain.

## State updates

- Express updates through named events such as `alloc`, `wake`, `issue`, `settle`, `release`, `flush`, and `kill`.
- Centralize conflicts for each register or entry and document priority only when events can overlap.
- Keep orthogonal field updates parallel.
- Use `WireDefault` or explicit next-state wires for composed updates.
- Remember that reading a `Reg` after `:=` in the same elaborated clock cycle observes the old registered value.

## Protocol and queue contracts

- Classify each interface as standard `Decoupled`, no-stall pulse, atomic batch,
  prefix-valid ports, or fire-cycle-only data.
- Standard `Decoupled` producers hold `valid` and `bits` until `fire`; the Bundle
  does not enforce that behavior automatically.
- Separate admission and `ready` calculation from accepted events. Allocation,
  pointer movement, and architectural updates require the documented `fire` or
  equivalent acceptance event.
- State low-number-contiguous masks, bank/slot OH encoding, age-wrap comparison,
  recycle latency, and token uniqueness when a queue depends on them.
- Keep physical occupancy, issue eligibility, and pending recycle as separate
  state when their lifetimes differ.

## Write ownership and parameters

- For every write-port class, list the fields it may update. Zero/default fields
  are safe only when ownership or the partial-write method proves they cannot
  overwrite unrelated state.
- Gate CSR, ROB, LLBit, STQ, predictor, and redirect side effects with their
  documented acceptance event and assert one-shot behavior.
- Add elaboration-time `require` checks for legal widths, divisibility, depths,
  and port counts. Handle `len == 1` and zero-index-width cases statically.
- Build initialized structures from pure Scala literals where required, and
  elaborate representative boundary configurations after parameter changes.

## Redundancy discipline

- Do not duplicate a downstream ready/flush/valid guarantee as runtime logic unless the design requires local enforcement.
- Add an assertion when an upstream module owns the contract.
- Do not add a zero-mask mux around `PriorityEncoderOH`; zero input already produces zero.
- Expect firtool to remove unused internal Bundle fields and logic within an elaborated top. Top-level IO remains externally observable.
- Leave intentional source-level redundancy only when it improves semantic clarity and synthesis can prove equivalence; comment it locally.

## Timing audit

For every remaining chain, report:

1. source location;
2. operands or entry/port count;
3. combinational stages and fanout;
4. critical-path risk;
5. tree, one-hot, banking, clustering, or register-boundary alternative.

Do not rely on Scala hierarchy for FPGA placement. Add a register when a hard timing boundary is required.

## Assertions

Where corresponding structures exist, cover at least:

```scala
assert(PopCount(selOH) <= 1.U)
assert((subMask & ~baseMask) === 0.U)
```

Also assert protocol ownership, conflicting writes, valid/index reuse, flush state, issue-kind exclusion, response identity, and free-list consistency where applicable.
