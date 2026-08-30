# Stage Gates

Use these gates before changing a module stage. A stage records evidence, not
intent.

## DESIGNING

Required:

- module and scope are named;
- governing architecture, protocol, and module documents are identified;
- current RTL and reference RTL are separated from proposed behavior;
- document ownership is known.

## DESIGN_CLOSED

All of the following must be explicit:

- interfaces, directions, widths, encodings, and identity representation;
- producer, consumer, storage point, and valid interval for every field;
- allocation, wakeup, issue, response, completion, retry, release, and reuse;
- cycle boundaries and combinational work between registers;
- same-cycle conflicts and total update priority;
- flush, kill, replay, late response, and uncancelable transaction behavior;
- ownership and stale-response protection;
- full, empty, collision, and multi-lane behavior;
- assertions and directed acceptance tests;
- intentionally unsupported behavior and its containment.

The handoff must contain no unresolved choice that changes correctness,
cross-module interfaces, or table-entry fields.

## IMPLEMENTING

Required:

- accepted handoff exists;
- design revision is recorded;
- writable source, test, and agent-document paths are assigned;
- another agent does not own those files;
- required reference implementation has been read.

## PRIMARY_VERIFIED

Required:

- elaboration and compilation succeed;
- directed tests pass with the required backend;
- required randomized or pressure tests pass;
- assertion failures are absent;
- command, seed, cycle count, result, and log path are recorded;
- agent-maintained implementation documentation matches the source.

Compilation alone does not satisfy this gate.

## INDEPENDENT_REVIEWED

Required:

- static-review report exists;
- independent verification report exists;
- required subagent sessions have ended;
- accepted findings are fixed;
- affected tests have been rerun;
- rejected findings include a concrete invariant or evidence.

If subagents are unavailable, record that limitation and run two separated local
passes without describing them as independent.

## COMPLETE

Required:

- all earlier gates pass;
- source, documents, tests, logs, and reports are aligned;
- no required work remains;
- unresolved exclusions are recorded for downstream modules;
- final handoff identifies the next integration consumer.

## Return Transitions

- Design defect during implementation: `DESIGN_REOPENED`. Pause source writes,
  retain the source lease, and assign a Shadow Align owner for the defect.
- Reopened design closed: record a new design revision, update the handoff, let
  the original Active owner validate its lease, then return to `IMPLEMENTING`.
- Shared contract changed: `NEEDS_REALIGN`.
- Test or assertion failure: `IMPLEMENTING`.
- Unresolved review finding: `REVIEWING`.
- Missing user decision that affects correctness or interfaces: `BLOCKED`.
