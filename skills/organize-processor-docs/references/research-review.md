# Research, Review, Finding, and Diagnosis

These documents provide evidence. They cannot define current Architecture or Design, approve a candidate, or silently select a correction.

## Research

Use Research when a processor property, design choice, external specification, reference implementation, or measured fact requires sourced investigation.

Cover:

1. question, scope, and stopping condition;
2. source identity, version or commit, and stable location;
3. directly observed facts separated from inference;
4. applicability and limits for the current processor;
5. candidate conclusions and decisive evidence;
6. adopted conclusions linked from their Architecture or Design authority;
7. unresolved evidence gaps.

When maintained by the project, `doc/Research/README.md` maps questions to reports and adopted authority links. Research remains support material after adoption.

## Review

A Review evaluates one frozen subject. Record:

1. subject commit and reviewed paths;
2. applicable Architecture, Design, Protocol, Lifecycle, ADR, and Verification authorities;
3. review method and excluded scope;
4. findings by severity;
5. areas checked with no finding;
6. evidence references and coverage limits.

## Finding

Use the project severity vocabulary. If none exists, use:

```text
P0 deterministic correctness failure
P1 high-risk correctness defect
P2 incomplete or conflicting contract
P3 structure, readability, or verification gap
```

Each Finding contains:

1. subject commit;
2. file and line or section;
3. precise observation;
4. evidence reference;
5. concrete counterexample, event trace, or failure condition when applicable;
6. affected property, contract, or invariant;
7. correction direction without claiming user approval;
8. unreviewed or unverified scope.

## Diagnosis

A diagnosis report records reproduction, expected and observed behavior, evidence chain, root cause, impact boundary, correction direction, and validation required. Keep current Design, proposed correction, and current implementation explicitly labeled.

## Concision

Lead with the question or finding and decisive evidence. Link specifications, source, logs, and full measurements instead of copying them. Apply the Research, Review, or Finding budget from `SKILL.md`.
