# Processor Design Document Template

## 1. Scope

- Goal
- Current stage
- Supported operations
- Explicit exclusions
- Reference implementations and their status

## 2. Module boundary

| Module | Owns state | Inputs | Outputs | Backpressure |
|---|---|---|---|---|

## 3. Pipeline cycles

| Cycle | Stage | Same-cycle stages | Combinational work | Registered result |
|---|---|---|---|---|

Use subsystem-qualified names.

## 4. State fields

For each field:

```text
semantics:
set:
clear:
valid interval:
consumers:
same-cycle priority:
invariant:
```

## 5. State transition table

| Current state | Event | Next state | Side effects | Retry or release |
|---|---|---|---|---|

## 6. Normal and failure paths

- hit or success
- miss-owned
- miss-nack
- dependency wait
- kill
- flush
- replay or retry
- external response

## 7. Same-cycle priorities

Write one total order for each state group.

```text
reset
> flush
> release
> response
> wake or mask update
> allocation
```

Document justified exceptions separately.

## 8. Ownership and reuse

For every index or tag:

```text
allocator:
owner:
references:
release condition:
same-cycle reuse:
late-response defense:
```

## 9. Correctness invariants

List invariants suitable for Chisel assertions. Include program order, visibility, uniqueness, ownership, and no-stale-write properties.

## 10. Timing and area

- comparator network
- priority/select network
- mux width
- broadcast fanout
- long buses
- storage ports and mapping
- likely critical paths
- possible pipeline cuts

## 11. Verification

- directed scenarios
- randomized scenarios
- assertions
- formal properties where useful
- synthesis and timing checks

## 12. Open decisions

Mark unresolved facts `TODO`. Include alternatives, decision criteria, and affected invariants.
