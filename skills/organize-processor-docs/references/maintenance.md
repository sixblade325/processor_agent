# Documentation Maintenance and Audit

Use this reference after edits and when a document framework becomes difficult to navigate or maintain.

## Concision pass

When a document exceeds its target budget, apply this order:

1. remove repeated normative facts;
2. remove chat history, task chronology, obsolete states, and implementation diary content;
3. move full research narratives to Research and retain only adopted conclusions with links;
4. move raw commands, logs, waveforms, and generated reports to Verification evidence or runtime storage;
5. replace nondecisive copied source and external specifications with precise references;
6. consolidate repeated prose into a state table, field table, invariant, or diagram;
7. shorten overview detail to a summary and authority link;
8. split only at a stable responsibility, ownership, Protocol, Lifecycle, or independent reader question.

If a provisional hard budget remains exceeded, record why the document cannot be made more concise or split at a stable boundary. Treat it as blocking only when the project or evaluation protocol selected strict hard-limit enforcement.

## Split review

Approve a split only when each resulting document can state:

1. an independent reader question;
2. its owned facts;
3. its inbound and outbound links;
4. a stable reason to change independently.

Reject `Part1`, `Part2`, chronological fragments, and arbitrary size slices. Keep a concise parent map when several child documents compose one subsystem or mechanism.

## Merge review

Merge documents when they duplicate facts, always change together, or require each other to answer the same reader question. Choose one authority location, migrate inbound links, and remove the duplicate current text in the same candidate change.

## Deterministic audit

Run:

```text
python <skill-dir>/scripts/check_docs.py <project-root>
python <skill-dir>/scripts/check_docs.py <project-root> --json
```

The checker scans existing Architecture, Design, Verification, and Research roots case-insensitively. Use repeated `--root <path>` for custom document roots.

It checks:

1. entry `README.md` presence;
2. target and provisional hard character and nonblank-line budgets;
3. local file and Markdown heading links;
4. document reachability and Architecture or Design reading paths deeper than two links;
5. merge conflict markers;
6. duplicate-current, backup, and old-tree path components;
7. editable sources for explanatory raster diagrams, with evidence-directory captures exempted;
8. invalid Markdown encoding without aborting the full audit.

Target-budget findings are warnings. Provisional hard-budget findings are warnings by default. Use `--hard-limit-policy error` when a project or evaluation has chosen blocking enforcement, and `--hard-limit-policy off` when only target warnings are required. Use `--budget-config <json>` to override provisional values for a project evaluation. Fix structural failures rather than excluding files.

Budget configuration uses profile names and any subset of the reported fields:

```json
{
  "design": {
    "targetEffectiveChars": 9000,
    "targetNonBlankLines": 210,
    "hardEffectiveChars": 15000,
    "hardNonBlankLines": 320
  }
}
```

## Semantic audit

The Agent must separately check:

1. one authority body per normative fact;
2. Architecture properties separated from Design realization;
3. overview summaries aligned with topic authorities;
4. module state and Protocol field ownership;
5. Chisel-facing interfaces presented as minimal Scala declarations followed by field semantics in declaration order;
6. non-interface Scala limited to decisive structure that needs code-level precision;
7. complete Lifecycle terminal paths and safe reuse;
8. implemented Design linked concisely to relevant Source and Test locations;
9. explanatory raster diagrams paired with maintained editable sources, and evidence captures bound to an input commit, run or method, and evidence location;
10. ADR decisions aligned with current documents;
11. Research observations separated from inference and linked to adopted authorities;
12. Review and Finding bound to a frozen subject with evidence and uncovered scope;
13. Verification coverage for Architecture acceptance and Design invariants;
14. stale names, rejected mechanisms, dead links, and orphan concepts;
15. reading paths that stay within two links from the appropriate entry;
16. direct readability without Harness data.

## Change report

Report:

1. files created, modified, relocated, merged, or retired;
2. facts whose authority moved;
3. reading paths changed;
4. length before and after for affected files;
5. deterministic command and result;
6. semantic findings and remaining user decisions.
