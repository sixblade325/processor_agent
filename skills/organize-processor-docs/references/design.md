# Design Documents

Design expresses the current concrete processor realization. It owns physical module topology, subsystem and module responsibilities, state, interfaces, cycle behavior, cross-module mechanisms, and implementation-facing invariants.

## Design entry

`doc/Design/README.md` is the human entry. Include:

1. the recommended reading order;
2. links to principles and whole-processor overview;
3. the physical module topology and links to subsystem or module documents;
4. links to cross-module Protocol and Lifecycle documents;
5. an Architecture realization map containing links rather than copied properties;
6. links to Design ADR and Verification entry points;
7. concise links from implemented Design authorities to their Source and Test locations.

Every current Design document must be reachable from this entry within two document links.

## Directory shape

Use this conditional pattern:

```text
doc/Design/
  README.md
  OVERVIEW.md
  <Subsystem>/
    README.md
    <Module>/
      README.md
      <InternalMechanism>.md
  Protocols/
  Lifecycles/
  ADR/
```

Each shown child path is conditional. Create it only when it owns current content.

## Physical module topology

Use the stable Chisel or RTL structural hierarchy and responsibility boundaries as the Design directory main axis. Here physical module topology means instantiated structural topology, not post-placement physical layout. Align the Design module view as closely as possible with instantiated hardware modules and their ownership. Source filenames alone do not define this topology. Work Packages, Agent assignments, implementation order, and Harness state never define it.

A stable instantiated module that owns an independent responsibility, state, interface, or maintenance lifecycle normally receives its own module directory and `README.md`. A parent subsystem or module `README.md` explains composition and links to its documented children. An overview that lists several independent state owners cannot replace their module authorities.

Shared Bundles and types, generated code, thin wrappers, adapters, and deliberately co-located mechanisms may justify a different document boundary. Record every material difference with an explicit Design-to-Source mapping, its reason, and its maintenance consequence. A significant divergence requires user approval and a Design ADR. This skill reports an unexplained mismatch and does not authorize source restructuring.

Protocols, Lifecycles, ADRs, and Verification remain orthogonal views. Link them to the module axis and keep their owned facts outside module summaries.

## Principles and overview

A principles document owns current global design rules, hardware contracts, and processor-wide implementation invariants.

An overview owns:

1. whole-processor topology;
2. major data and control flow;
3. core mechanisms;
4. subsystem boundaries and state ownership;
5. qualified pipeline boundaries;
6. links to detailed module, Protocol, and Lifecycle authorities.

Overview summaries must remain shorter than their authorities and cannot add unowned detail.

## Subsystem or module document

Open with the reader question, functional boundary, owned state, and exclusions. Cover the relevant items:

1. implemented Architecture properties, functional boundary, internal components, and state owners;
2. external interfaces and backpressure, using the [Scala-first interface exposition](protocol-lifecycle.md#scala-first-interface-exposition) rule;
3. state semantics, transitions, same-cycle priorities, side effects, ownership, and safe reuse required by `design-chisel-processor`;
4. qualified pipeline boundaries and links to applicable Protocol and Lifecycle authorities;
5. correctness invariants, timing or physical risks, and verification obligations;
6. concise links to current Source and Test locations when implementation exists;
7. open decisions that genuinely require user authority.

Do not copy full field tables owned by a Protocol document or full cross-module traces owned by a Lifecycle document.

## Precise Scala

Chisel-facing interfaces always follow the Scala-first rule. For state updates, allocation, selection, priority, or assertions, include Scala only when prose, a table, or a diagram would leave the hardware structure ambiguous.

State the design intent before a non-interface Scala fragment and explain its hardware topology afterward. Keep only decisive declarations and equations. Exclude complete module bodies, imports, boilerplate, repeated source, and helper logic unrelated to the documented fact.

## Diagrams

Use diagrams when topology, ownership, timing, or state transitions are materially clearer visually. Keep a same-stem `.drawio`, `.svg`, `.mmd`, `.dot`, `.puml`, `.plantuml`, or generating `.py` source beside each explanatory raster image and update both in the same candidate. Waveforms, tool screenshots, and other evidence captures instead identify their input commit, run or method, and evidence location. A diagram supplements the owning prose and cannot become an unreferenced second specification.

## Split and merge

Create an independent module document when the subject has stable responsibility, state ownership, interfaces, or an independent maintenance lifecycle. For implemented designs, apply this rule to stable instantiated Chisel or RTL modules unless a documented exception above applies. Keep small helpers inside the owning mechanism document.

Split a long module document by internal mechanism only when the extracted mechanism has its own state or reader question. Keep a short parent document that explains composition and links.

Merge documents that always change together, cannot be understood separately, and do not own independent state or contracts.

## Current Design and rationale

Current Design states how the processor works now. Design ADRs state why a concrete mechanism was chosen. Candidate changes edit the current documents in an isolated worktree; approved content replaces the current version without creating `FinalDesign`, `DesignV2`, or backup trees.

## Concision

Use tables, diagrams, state transitions, and invariants when they replace repetitive prose. Keep source excerpts minimal and link to source locations. Apply the overview or module budgets defined in `SKILL.md`.
