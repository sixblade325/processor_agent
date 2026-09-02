# Design Documents

Design expresses the current concrete processor realization. It owns logical topology, subsystem and module responsibilities, state, interfaces, cycle behavior, cross-module mechanisms, and implementation-facing invariants.

## Design entry

`Design/README.md` is the human entry. Include:

1. the recommended reading order;
2. links to principles and whole-processor overview;
3. the logical topology and links to subsystem or module documents;
4. links to cross-module Protocol and Lifecycle documents;
5. an Architecture realization map containing links rather than copied properties;
6. links to Design ADR and Verification entry points;
7. concise links from implemented Design authorities to their Source and Test locations.

Every current Design document must be reachable from this entry within two document links.

## Logical topology

Use the processor's stable logical ownership as the directory main axis. The user owns top-level subsystem and module concepts. Directory nesting may reflect whole processor, subsystem, module, and internal mechanism when those levels are meaningful.

Do not derive the document tree from Work Packages, Agent assignments, source filenames, implementation order, or Harness state. Source and Design topology may differ physically; explicit links preserve correspondence.

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

Create an independent module document when the subject has stable responsibility, state ownership, interfaces, or an independent maintenance lifecycle. Keep small helpers inside the owning mechanism document.

Split a long module document by internal mechanism only when the extracted mechanism has its own state or reader question. Keep a short parent document that explains composition and links.

Merge documents that always change together, cannot be understood separately, and do not own independent state or contracts.

## Current Design and rationale

Current Design states how the processor works now. Design ADRs state why a concrete mechanism was chosen. Candidate changes edit the current documents in an isolated worktree; approved content replaces the current version without creating `FinalDesign`, `DesignV2`, or backup trees.

## Concision

Use tables, diagrams, state transitions, and invariants when they replace repetitive prose. Keep source excerpts minimal and link to source locations. Apply the overview or module budgets defined in `SKILL.md`.
