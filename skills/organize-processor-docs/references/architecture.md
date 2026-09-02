# Architecture Documents

Architecture expresses the current processor properties and design goals chosen by the user. It constrains acceptable Design implementations and remains current throughout active project work.

## Architecture entry

`Architecture/README.md` is the human entry. Keep it short and include:

1. a concise processor portrait;
2. the recommended reading order;
3. links to the document owning each property area;
4. links to Architecture ADRs;
5. links to the Design realization entry and Verification acceptance entry when present;
6. explicit deferred scope that affects how the current Architecture is read.

Do not duplicate detailed property definitions in the entry.

## Architecture principles or total document

Use one total document when the project needs a sustained explanation of:

1. user goals and intended workloads;
2. success conditions and priority order;
3. supported scope and exclusions;
4. processor-wide required properties;
5. performance, area, timing, resource, or verification targets;
6. freedoms intentionally left to Design;
7. project-level acceptance conditions.

A small project can keep this content in one document. Split only when a property area has an independent reader question and change lifecycle.

## Property topics

Organize topics by stable processor properties rather than the current module tree. Typical concerns include:

1. ISA and software-visible state;
2. execution and retirement properties;
3. memory ordering, caches, virtual memory, and MMIO properties;
4. exception, interrupt, privilege, and debug scope;
5. external platform, reset, boot, and integration constraints;
6. observability, workload, and performance requirements;
7. technology, FPGA, frequency, area, and resource constraints.

These are candidate concerns, not mandatory files. The user controls the actual property vocabulary and grouping.

## Internal logic of an Architecture topic

Answer only the sections needed for the topic, while covering:

1. intent and reader question;
2. authoritative property statements;
3. scope, exclusions, and forbidden behavior;
4. externally observable or user-selected semantics;
5. remaining Design freedom;
6. acceptance conditions and observable outcomes;
7. links to rationale, Design realization, Research evidence, and Verification.

State the property directly. Move candidate comparison and historical narrative to an ADR or Research document.

## Boundary tests

Use these ownership rules:

1. A condition used by the user to accept the processor belongs to Architecture.
2. A chosen processor property such as ISA scope, execution width, retirement order, cache requirement, exception scope, or target metric belongs to Architecture.
3. Module boundaries, state fields, signal interfaces, cycle placement, event priority, and implementation state machines belong to Design.
4. Test procedures and observed results belong to Verification.
5. Sources and candidate analyses belong to Research.

Architecture invariants describe acceptable processor behavior. Design invariants prove the concrete mechanism satisfies that behavior.

## Architecture ADRs

Place an ADR under Architecture when the decision changes a processor property, design goal, external contract, acceptance condition, or permitted Design freedom. Keep the current property statement in the Architecture topic and link to the ADR for rationale.

## Version and approval

Keep only current Architecture content in the current tree. Candidate commits carry proposed changes. Git carries history. Approval records bind the exact candidate commit; avoid duplicating approval state or generated decision ledgers inside prose documents.

## Concision

Prefer a short property statement, explicit scope, and measurable acceptance condition. Remove detailed module descriptions, copied specifications, full research narratives, implementation code, and verification logs. Apply the Architecture budgets defined in `SKILL.md`.
