# Progressive Framework Bootstrap

Use this reference to establish a document framework from a new processor idea or an existing project.

## Inputs

Read, when present:

1. project instructions;
2. root and document entry files;
3. Architecture, Design, Verification, and Research documents;
4. current Chisel or RTL instance hierarchy, responsibility boundaries, source, and tests for an existing implementation;
5. reference implementations, keeping them separate from project authority.

Do not infer current design facts from caches, generated logs, old backup trees, or reference projects.

## Inventory before structure

For every existing document, record:

1. its current path;
2. the reader question it answers;
3. the facts it appears to own;
4. the documents that repeat or contradict those facts;
5. whether it represents current intent, current design, rationale, verification, research, review, finding, or history.

Preserve existing paths until the proposed authority and link migration are understood. An existing project first needs an index and ownership audit; immediate bulk relocation obscures conflicts.

## Derive reading paths

The framework must support these reader tasks:

1. understand what processor is intended;
2. find a processor property and its acceptance condition;
3. understand whole-processor topology and core mechanisms;
4. find a subsystem or module design;
5. trace a Protocol or Lifecycle across modules;
6. understand why a durable decision was made;
7. find how a property or invariant is verified;
8. inspect the evidence and findings behind a proposed correction.

Use the smallest set of documents that supports the actual tasks. Do not create one file per checklist item.

## Canonical directory layout

Place the maintained processor document network under the project-root `doc/` directory:

```text
doc/
  README.md
  Architecture/
    README.md
    <property-topic>.md
    ADR/
  Design/
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
  Verification/
    README.md
    <verification-topic>.md
    Results/
  Research/
    README.md
    <research-topic>.md
```

`doc/README.md` is the overall documentation entry and links directly to every domain entry that exists. The shown topic files and child directories are conditional patterns rather than mandatory placeholders. Keep project instructions, the repository README, and user operation guides at the repository root. Keep source and tests in their implementation directories. Store maintainable verification summaries in `doc/Verification/Results/` when needed. Store raw logs, generated RTL, waveforms, and transient tool reports in `.runtime/`.

The Design subtree uses physical module structure as its main axis. Protocols, Lifecycles, ADRs, and Verification provide independent cross-cutting views. Read [design.md](design.md) before proposing Design paths.

## Propose the map

Before changing long-term organization, show one candidate map. For each proposed document state:

```text
path
one-sentence responsibility
authoritative facts
upstream and downstream links
reason it must be independent
split condition
```

Mark each operation as keep, create, merge, split, relocate, or retire. Identify every fact whose authority would move.

## User decisions

Request explicit confirmation before:

1. introducing a new document domain under `doc/`;
2. choosing or changing Architecture topic boundaries;
3. choosing or changing the Design physical module topology or an exception to its Source correspondence;
4. creating a new cross-module Protocol or Lifecycle authority;
5. relocating normative facts between Architecture, Design, and Verification;
6. retiring a current authority document.

Ordinary link repair, navigation summaries, and terminology alignment can enter the candidate diff without becoming new product concepts.

## Materialize progressively

For a new project:

1. create `doc/README.md` as soon as the first maintained processor document domain exists;
2. create `doc/Architecture/README.md` when Architecture content exists;
3. create only the Architecture documents needed to record current goals and properties;
4. create `doc/Design/README.md` when concrete design work begins;
5. add module, Protocol, Lifecycle, ADR, and Verification documents only when they own real content;
6. create `doc/Research/README.md` only when project-maintained research or review material exists;
7. keep Research, Review, and Finding separate from adopted facts.

For an existing project:

1. preserve user-authored content;
2. add or repair entry maps first;
3. resolve conflicting authority before moving files;
4. report document roots outside `doc/` as migration candidates and obtain user confirmation before relocation;
5. relocate one coherent responsibility at a time;
6. update inbound and outbound links in the same candidate change;
7. remove duplicate current copies after their facts have a confirmed owner.

## Bootstrap result

Completion requires the human-first acceptance rules in `SKILL.md`, one authority for each normative fact encountered, passing checks, and an explicit list of unresolved user decisions. Create no empty scaffold, backup tree, or generated second representation.
