---
name: implement-chisel-processor
description: Document-driven workflow for implementing, reviewing, and verifying Chisel processor and memory-subsystem RTL. Use when Codex must work from maintained Architecture and Design, trace a complete integration surface, reason in synthesized-hardware terms, keep source-adjacent _codex.md summaries current, avoid redundant or overprotective logic, or run focused functional verification.
---

# Implement Chisel Processor

## Establish authority

Read repository instructions first. Then locate and read, in order:

1. The Architecture documents that define target properties and boundaries.
2. The current Design documents that define the concrete module, protocol, lifecycle, and cycle semantics.
3. Current source, module-local notes, source-adjacent `_codex.md` summaries, tests, generated reports, and relevant reference implementation.
4. The user's explicit task scope and acceptance criteria.

Treat explicit user decisions and the current Git authority as authoritative.
Treat a later ordinary user statement as change intent unless the user clearly
supersedes an existing fact. Architecture defines target properties, Design
defines intended implementation, and Source plus Verification define proven
current behavior. Never silently resolve a conflict. State the target, current
implementation, evidence, and required migration.

Do not modify Architecture or Design unless the current task authorizes those
edits. Prefer their naming and interface fragments. If a fragment has a syntax,
type, timing, or semantic error, report the exact Design gap before changing its
meaning. Treat a module-local document without the `_codex` suffix as
human-maintained unless project instructions assign different ownership.

## Confirm design closure

Use `$design-chisel-processor` when field semantics, ownership lifetime, cycle
boundaries, conflict priority, late-response handling, identity protection, or
acceptance criteria remain unresolved. Begin RTL work only after choices that
affect correctness or interfaces are closed.

Do not repeat questions already answered by the user's latest instruction or
accepted documents. Ask before adding a field, protocol, or identity mechanism
only when its necessity or semantics remain unresolved. Do not invent
unspecified protocols or conservative guards.

## Close the integration surface

Before editing, identify the real elaboration top, source set, immediate
dependencies, and downstream regression scope. Search for stale paths, duplicate
top-level definitions, and incompatible local copies of shared packages.

For every changed Bundle or protocol, trace definitions, constructors, storage,
all producers, all consumers, partial-write methods, tests, widths, encodings,
and port order. Separate mechanical ABI migration from semantic redesign.
Record which pipeline owns each writable field and which architectural side
effects consume it.

Trace a reference implementation through its complete producer-to-consumer path
before declaring a local fragment incorrect. Classify each mismatch as design,
interface, implementation, documentation, test, or tooling so the correct owner
and migration action are explicit.

## Implement as hardware

Read [hardware-rules.md](references/hardware-rules.md) before writing RTL.

Make the smallest change that preserves the documented semantics. Reuse the repository's reference processor structure when requested. Keep event generation parallel and centralize state-update priority. Use masks and one-hot selections for candidate networks. Mux only fields consumed on the critical path.

Before each added condition, field, register, or mux, determine whether existing invariants already imply it. Prefer an assertion for an upstream contract over duplicated runtime protection when the design assigns that responsibility upstream.

Organize substantial Scala source with the repository's required functional separators. Add concise comments only for cycle contracts, non-obvious invariants, intentional redundancy left for synthesis, and timing-sensitive choices.

## Maintain source summaries as a hard gate

The Agent maintains source-adjacent summaries. Every project-authored `.scala`
source created or changed by the task must have a same-directory
`<SourceBase>_codex.md` summary. Create a missing summary and update an existing
summary in the same change. Generated, vendored, and third-party Scala sources
are excluded unless the project explicitly owns them.

Each summary records only implementation-facing facts:

- source responsibility and governing Design links;
- public interfaces and field semantics;
- events, same-cycle priority, and state lifecycle;
- producer, register boundary, consumer, and architectural side effects;
- assertions, tests, evidence, timing risks, and unverified behavior.

Keep the summary concise and maintainable. It describes the source and cannot
override Architecture or Design. Before delivery, check every changed
project-authored `.scala` path for its matching summary. The task is incomplete
while any required summary is missing or stale.

## Verify and review

Read [verification-review.md](references/verification-review.md). Add focused assertions and directed corner cases, then run Verilator as the default ChiselTest backend. Compilation alone is not verification.

For a review-only task, inspect source and documents for correctness, redundancy,
overprotection, timing paths, dependency chains, assertion quality, and test
gaps without modifying files. For an implementation task, the active Agent owns
the edit, focused verification, and final reconciliation.

Dual-subagent verification is disabled by default. Enable it only when the user
explicitly requests dual-subagent verification for the current task. Preserve
these two independent roles when enabled:

1. A static-review subagent performs a read-only source and document review.
2. A verification subagent independently runs the approved tests and records raw evidence.

Give both roles source paths, authority documents, the fixed baseline, and
acceptance criteria. Do not give them an expected conclusion. If two independent
subagents are unavailable, report that fact and do not claim independent
verification. The active Agent resolves findings, applies authorized fixes,
reruns affected tests, and updates every affected `_codex.md` summary.

When an implementation task follows a failed review, address valid findings and rerun affected tests. Review roles report findings without modifying files. Do not report completion while required tests fail.

## Deliver

Report concisely:

- modified files and governing design documents;
- elaboration top, source set, affected dependents, and regression scope;
- reused reference structures and any new fields;
- event priority, assertions, and deliberately omitted redundant logic;
- timing risks and any remaining dependency chain with location and scale;
- created or updated `_codex.md` summaries;
- Verilator commands, seeds, cycle counts, results, and log paths;
- whether dual-subagent verification remained disabled or was explicitly enabled;
- Architecture and Design revisions or hashes used as authority;
- unresolved issues or unverified behavior.
