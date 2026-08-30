---
name: orchestrate-chisel-development
description: Coordinate rotating Codex agents in a document-driven Chisel processor workflow. Use when the user explicitly assigns or rotates Shadow Align and Active Coding roles, when one thread closes the next module design while another implements a previous module, when resuming this concurrent workflow, or when cross-thread handoff and shared-interface alignment must be managed.
---

# Orchestrate Chisel Development

Coordinate module-level design and implementation without duplicating the
domain rules in the existing Chisel skills. Treat roles as assignments to a
module stage. Do not permanently bind a role to one thread.

## Establish Authority

Read repository instructions first. Apply authority in this order:

1. The user's latest instruction.
2. Repository `AGENTS.md` files governing the affected paths.
3. User-maintained architecture, protocol, and module documents.
4. Shared workflow state and the latest accepted handoff.
5. Current source, tests, reports, and agent-maintained documents.

Never let workflow metadata override a newer user correction or an authoritative
design document.

## Select Coordination Mode

Use shared-state mode when the repository contains
`.codex/chisel-workflow/state.yaml`. Read
[references/shared-state-schema.md](references/shared-state-schema.md) before
using or updating it.

Use a thread ID only when the host, user, or harness exposes it. Otherwise use
an explicit role assignment or lease token. Do not guess which state entry
belongs to the current thread.

Use manual mode when that file is absent. Derive the role from the user's
explicit assignment or current task:

- Design discussion, document review, or document closure means Shadow Align.
- Implementation, source modification, review closure, or verification means
  Active Coding.
- A status or handoff request keeps the current role.

When the role remains ambiguous and source or user-owned document edits would
occur, report the missing assignment before editing.

For multi-thread manual mode, use a durable handoff under
`.codex/chisel-workflow/handoffs/` or another user-approved shared path. A
conversation-only handoff is sufficient only when the user explicitly relays it
or one thread performs the whole transition.

## Shadow Align Role

1. Locate, read, and follow the available `$design-chisel-processor` skill.
2. Read the architecture overview, protocols, module document, relevant source,
   and reference implementation.
3. Help the user close fields, interfaces, events, cycle boundaries, conflict
   priority, flush, kill, retry, late response, ownership, reuse, assertions,
   and acceptance tests.
4. Preserve repository document ownership. Modify user-maintained documents
   only when the user and repository rules permit it.
5. Keep unresolved correctness and interface choices explicit.
6. Do not mark the module `DESIGN_CLOSED` until every required design gate in
   [references/stage-gates.md](references/stage-gates.md) passes.
7. Produce a handoff using
   [references/handoff-format.md](references/handoff-format.md).

The Shadow Align role does not edit RTL unless the user explicitly changes the
assignment to implementation work.

## Active Coding Role

1. Confirm that the target module is `DESIGN_CLOSED`.
2. Read [references/stage-gates.md](references/stage-gates.md), the accepted
   handoff, [references/handoff-format.md](references/handoff-format.md), and
   the governing documents.
3. Locate, read, and follow both available skills:
   `$design-chisel-processor` and `$implement-chisel-processor`.
4. Record the design revision before editing source.
5. Implement the smallest change that preserves the closed design.
6. Maintain assertions, directed tests, Verilator tests, and agent-owned
   implementation documentation.
7. Dispatch independent static-review and verification subagents when the
   environment supports them.
8. Address valid findings and rerun affected tests.
9. Advance stages only when their evidence gates pass.

If implementation exposes a design defect, stop the affected edit, record the
counterexample, and return the module to `DESIGN_REOPENED`. Retain the paused
source lease while prohibiting further source edits. The user or harness assigns
a Shadow Align owner for the reopened design. After that owner closes the defect
and records a new design revision, the original Active owner rereads the
handoff, validates its lease, and returns the module to `IMPLEMENTING`. Do not
silently invent a field, protocol, priority, or conservative guard.

## Align Concurrent Work

Treat design documents, source, tests, handoffs, and reports as the communication
surface between threads. Do not assume a private cross-thread message channel.

Before editing or final verification:

1. Recheck the current role, lease, and state epoch in shared-state mode.
2. Recompute or recheck the accepted design revision.
3. Search for shared interfaces changed by the Shadow Align agent.
4. Mark dependent implementation modules `NEEDS_REALIGN` when their accepted
   contract changed.
5. Resolve the mismatch in design documents before resuming affected RTL work.
6. Record accepted shared-interface changes and dependent modules in the next
   handoff.

Concurrent work is permitted when file ownership and interface revisions do not
conflict. Two agents must not edit the same source or user-owned document at the
same time.

Recheck the role, lease, and state epoch again before each source-edit phase,
long-running test launch, stage update, and handoff update. Stop immediately
when the lease or assignment changed.

## Rotate Roles

Permit a planned role swap when:

- the current Active module is `COMPLETE`;
- the current Shadow module is `DESIGN_CLOSED`;
- both handoffs are current;
- no shared-interface mismatch remains;
- no required test, report, or subagent session remains unfinished.

After the swap:

- the previous Shadow becomes Active for its closed module;
- the previous Active becomes Shadow for the next user-assigned module;
- each thread rereads repository instructions, shared state, and its accepted
  handoff on its next turn.

In manual mode, report the proposed transition and wait for the user's role
assignment. In shared-state mode, submit a rotation request and wait for the
harness to commit both assignments and leases in one transaction. An agent does
not directly modify another agent's assignment. Each affected thread must
observe and acknowledge the new epoch before writing files.

## Report Each Stage

Keep stage reports concise and include:

- current role, module, and stage;
- governing documents and accepted design revision;
- completed gate evidence;
- modified files or reviewed documents;
- tests, logs, and subagent reports;
- shared-interface changes and dependent modules;
- blockers and the next permitted transition.

Never report a role rotation, design closure, verification pass, or module
completion without the required evidence.
