# Protocol and Lifecycle Documents

Protocol and Lifecycle are orthogonal views over the Design topology. Create them when a cross-module fact cannot be maintained clearly inside one owning module document.

## Protocol authority

A Protocol document owns a shared interface, Bundle, event family, field vocabulary, or handshake contract consumed by multiple modules.

Open with:

1. purpose and scope;
2. participants and direction;
3. ownership and authoritative field set;
4. relationship to Architecture properties and Lifecycles.

Cover the applicable details:

1. field name, width or type, semantics, producer, consumer, and valid interval;
2. ready, valid, fire, hold, and backpressure rules;
3. register boundaries and same-cycle combinational paths;
4. request, response, ownership, and completion identity;
5. kill, flush, cancellation, drain, retry, and error behavior;
6. same-cycle event priority;
7. stability and one-hot requirements;
8. protocol invariants and assertions;
9. linked module responsibilities and Verification.

Split a monolithic Protocol document by independently owned interface family or transaction contract. Never split alphabetically or by line count alone.

## Scala-first interface exposition

For every Chisel-facing interface, present information in this order:

1. identify whether the declaration is current source, current proposed Design, or a reference implementation;
2. state the module viewpoint from which `Input`, `Output`, and `Flipped` directions are defined;
3. show the minimal relevant Scala `Bundle`, `IO`, `Enum`, request, response, or event declaration;
4. preserve declaration order, exact field names, nesting, types, widths, directions, and encodings;
5. explain each field semantically in the same order as the Scala declaration;
6. explain producer, consumer, valid interval, handshake, register boundary, ownership, backpressure, and side effects after the structural declaration;
7. state cross-field rules, same-cycle priority, kill, flush, retry, stability, and assertions after the field-by-field explanation.

Existing source declarations must link to the exact source path. A Design that precedes implementation can own a proposed Scala interface declaration. If source and Design disagree, label current implementation and target Design separately.

Keep the Scala excerpt limited to the interface surface. Exclude module implementation, helper logic, and unrelated imports. Update the Scala declaration and semantic explanation in the same candidate change. A semantic table cannot precede the Scala declaration for a Chisel-facing interface.

## Lifecycle authority

A Lifecycle document owns an end-to-end processor behavior that crosses module boundaries, such as load, store, redirect, flush, replay, refill, exception, or retirement.

Open with:

1. initiating event and completion condition;
2. participating modules;
3. state and transaction owner at every phase;
4. relevant Protocol links.

Trace:

1. admission or allocation;
2. registered and combinational work by qualified cycle boundary;
3. ownership transfer;
4. all possible responses;
5. success and externally visible side effects;
6. stall, miss, nack, kill, flush, replay, retry, exception, and late response;
7. release and safe reuse;
8. same-cycle interactions with competing events;
9. cross-module invariants and directed scenarios.

A Lifecycle refers to module-owned state and Protocol-owned fields. It does not redefine them.

## Protocol versus Lifecycle

Use Protocol when the reader asks what crosses a boundary and under which handshake or identity rules.

Use Lifecycle when the reader asks how one operation moves from initiation through completion, retry, or cancellation.

One mechanism can need both documents. Cross-link them and keep each normative fact in its owning view.

## Concision

Use field tables for contracts and numbered phase or cycle tables for Lifecycles. Replace repeated module internals with links. Apply the Protocol and Lifecycle budgets defined in `SKILL.md`.
