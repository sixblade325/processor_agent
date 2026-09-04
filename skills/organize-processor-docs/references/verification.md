# Verification Documents

Formal Verification documents are peers of Architecture and Design. Architecture states acceptance conditions. Design states invariants and verification obligations. Verification states how they are checked and records reproducible results or evidence references.

## Verification entry

`doc/Verification/README.md` should provide:

1. verification levels and reading order;
2. links from Architecture acceptance areas to verification specifications;
3. links from Design modules, Protocols, and Lifecycles to verification specifications;
4. locations of current reproducible results and evidence.

## Verification specification

Cover the applicable items:

1. subject commit or version-binding rule;
2. Architecture property or Design invariant under test;
3. verification level and environment;
4. stimulus and initial conditions;
5. observable signals or outputs;
6. oracle and pass criteria;
7. directed, randomized, assertion, formal, synthesis, timing, or performance scenarios;
8. command ID or reproducible command reference;
9. random seed and workload requirements;
10. expected evidence and result location.

## Results and evidence

Keep human summaries concise and immutable once bound to a commit. Store maintainable result summaries under `doc/Verification/Results/` when useful. Store bulk stdout, stderr, waveforms, reports, and generated artifacts in `.runtime/`, then link them with hashes or stable result references.

A result identifies the input commit, command or method, environment or toolchain, outcome, and evidence location. Waveform images, tool screenshots, and other evidence captures inherit this binding from their result entry or state it beside the capture. They do not require an editable diagram source. A failed result remains evidence and cannot be rewritten into a pass.

Apply the Verification budget in `SKILL.md`. Split by independent subject or verification level and keep repeated setup in one linked environment document.
