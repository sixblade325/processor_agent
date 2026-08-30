---
name: implement-chisel-processor
description: Document-driven workflow for implementing and modifying Chisel processor and memory-subsystem RTL. Use when Codex must work from user-maintained architecture/design documents, preserve user implementation notes and code fragments, maintain separate agent-authored implementation documentation, reason in synthesized-hardware terms, avoid redundant or overprotective logic, and complete independent static review plus Verilator validation through subagents.
---

# Implement Chisel Processor

## Establish authority

Read repository instructions first. Then locate and read, in order:

1. User-maintained architecture and design documents.
2. User-maintained module-local implementation document.
3. Current source, tests, generated reports, and relevant reference implementation.
4. Agent-maintained `<SourceBase>_codex.md` if present.

Treat the user's latest correction as authoritative. Design documents define
target behavior after applying accepted corrections; source defines current
behavior. Report corrections not yet reflected in documents. Never silently
resolve a conflict. State the target, current implementation, and migration.

Do not modify user-owned design documents unless explicitly requested. Treat module-local documents without `_codex` as user-owned. Prefer their code fragments and naming. If a fragment has a syntax, type, timing, or semantic error, report the exact issue before changing its meaning.

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

## Maintain three documentation layers

Keep ownership explicit:

- Architecture/design documents: maintained by the user; define target semantics.
- Module-local document without `_codex`: maintained by the user; supplies interfaces, local methods, names, and preferred snippets.
- `<SourceBase>_codex.md`: maintained by the agent; records implemented behavior, event priority, assertions, verification, and timing risks.

Update `_codex.md` with every source change. Follow repository line limits, commonly 100 lines per source document. Never use `_codex.md` to override user design.

## Verify and review

Read [verification-review.md](references/verification-review.md). Add focused assertions and directed corner cases, then run Verilator as the default ChiselTest backend. Compilation alone is not verification.

After primary verification, dispatch two independent subagents when the environment supports them:

1. Static-review subagent: inspect source and documents for correctness, redundancy, overprotection, timing paths, dependency chains, assertion quality, and test gaps.
2. Verification subagent: independently run tests, preserve commands, seeds, logs, failures, and concise conclusions.

Give subagents raw paths and acceptance criteria. Do not leak the expected conclusion. Store their short reports in the module test directory using repository naming conventions. If subagents are unavailable, state that explicitly and perform two clearly separated local passes without claiming independence.

Address valid findings, rerun affected tests, and update reports. Do not mark the task complete while required tests fail or sessions remain active.

## Deliver

Report concisely:

- modified files and governing design documents;
- elaboration top, source set, affected dependents, and regression scope;
- reused reference structures and any new fields;
- event priority, assertions, and deliberately omitted redundant logic;
- timing risks and any remaining dependency chain with location and scale;
- Verilator commands, seeds, cycle counts, results, and log paths;
- `_codex.md`, static-review report, and verification report paths;
- unresolved issues or unverified behavior.
