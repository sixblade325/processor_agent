# Handoff Format

Use one handoff per module and transition. Keep it concise enough for the next
agent to read before touching files.

For multi-thread manual mode, default to:

```text
.codex/chisel-workflow/handoffs/<Module>.md
```

Use another path when repository instructions or the user specify one.

```markdown
# <Module> Handoff

## Assignment

- From role:
- To role:
- Module:
- Stage:
- Scope:
- Explicit exclusions:

## Authority

- Repository instructions:
- Architecture documents:
- Protocol documents:
- Module-local documents:
- Reference implementation:
- Accepted design revision:

## Closed Semantics

- Interfaces and fields:
- Event definitions:
- Cycle boundaries:
- Same-cycle priority:
- Flush, kill, retry, and late-response rules:
- Ownership, release, and reuse invariants:

## Implementation Surface

- Source files:
- Test files:
- Agent-maintained documents:
- Shared interfaces:
- Dependent modules:

## Acceptance Evidence

- Assertions:
- Directed cases:
- Pressure cases:
- Verification command:
- Seed and cycle count:
- Logs:
- Static-review report:
- Verification report:

## Open Items

- Blocking decisions:
- Nonblocking exclusions:
- Known timing risks:
- Next permitted action:
```

Rules:

1. Record observed facts and accepted decisions.
2. Do not hide failed tests or unresolved interface choices.
3. Use exact paths, signals, events, and cycle names.
4. Preserve user wording for accepted semantics where practical.
5. Update the handoff after every accepted review fix or shared-interface
   change.
