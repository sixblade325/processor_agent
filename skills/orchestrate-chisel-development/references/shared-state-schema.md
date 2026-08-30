# Shared State Schema

The optional project state file is:

```text
.codex/chisel-workflow/state.yaml
```

The orchestration harness owns creation and atomic updates. This skill may read
the file. It may update fields assigned to the current agent when repository
rules and the state lease permit it.

## Schema

```yaml
version: 1
project_root: /absolute/project/path
updated_at: ISO-8601
epoch: 0

agents:
  <thread-id>:
    role: active | shadow
    module: <module-name>
    status: working | waiting | blocked | done
    lease: <opaque-owner-token>
    observed_epoch: 0

modules:
  <module-name>:
    stage: DESIGNING
    design_documents: []
    module_documents: []
    source_files: []
    test_files: []
    design_revision:
      files:
        <path>: <sha256>
    implementation_revision: <git-commit-or-dirty-marker>
    shared_interfaces: []
    depends_on: []
    handoff: <path>
    evidence:
      test_logs: []
      static_review: null
      verification_review: null
    blockers: []

rotation_requests:
  <request-id>:
    expected_epoch: 0
    status: proposed | committed | acknowledged | rejected
    assignments:
      <thread-id>:
        role: active | shadow
        module: <module-name>
```

Allowed stages:

```text
DESIGNING
DESIGN_REOPENED
DESIGN_CLOSED
IMPLEMENTING
PRIMARY_VERIFIED
REVIEWING
INDEPENDENT_REVIEWED
COMPLETE
NEEDS_REALIGN
BLOCKED
```

## Revision Rules

Use hashes of the actual governing files. A Git commit alone is insufficient
when documents contain uncommitted edits.

For each accepted design revision, record:

- ordered authoritative file paths;
- SHA-256 of each file;
- accepted handoff path;
- shared interfaces covered by the revision.

Before source edits and final verification, compare the current files with the
recorded revision.

## Ownership Rules

1. One agent owns one writable module stage at a time.
2. A Shadow agent owns the assigned design-document work.
3. An Active agent owns the assigned source, tests, and agent documents.
4. Shared-interface changes mark dependent active modules `NEEDS_REALIGN`.
5. An agent updates only its own assignment, evidence, and authorized module
   fields.
6. Role swaps require both stage gates and a fresh lease.
7. Use a thread ID only when the host, user, or harness exposes it. Use an
   explicit assignment or lease token when the current thread ID is unavailable.
8. Do not infer identity from module names, recent file edits, or conversation
   similarity.

## Lease and Rotation Protocol

1. Recheck `epoch`, assignment, and lease before each source-edit phase,
   long-running test launch, stage update, and handoff update.
2. Stop work when the lease is missing, changed, or bound to another assignment.
3. Agents may propose a `rotation_request`.
4. Only the harness commits a request that changes multiple agent assignments.
5. The harness validates `expected_epoch`, updates all assignments and leases,
   increments `epoch`, and marks the request `committed` in one atomic
   transaction.
6. Each affected agent rereads state and records the new `observed_epoch` before
   writing files.
7. Mark the request `acknowledged` only after all affected agents observed the
   committed epoch.
8. When no atomic harness operation exists, leave the request proposed and use
   explicit user assignments in manual mode.

## Operation Without a Harness

When this file does not exist:

- use the user's explicit role and module assignment;
- write multi-thread handoffs to
  `.codex/chisel-workflow/handoffs/<Module>.md` or another user-approved shared
  path;
- use conversation-only handoffs when the user explicitly relays them or one
  thread performs the whole transition;
- do not invent another thread's status;
- do not claim an atomic role swap;
- let the user authorize the next role assignment.
