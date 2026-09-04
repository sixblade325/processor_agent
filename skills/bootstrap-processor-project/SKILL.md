---
name: bootstrap-processor-project
description: Initialize or safely upgrade a processor project's root AGENTS.md from a maintained baseline. Use when starting a processor project, adding project-level Agent collaboration rules, or comparing an existing AGENTS.md with the package baseline. This skill only handles AGENTS.md; it does not scaffold documentation, inspect or configure environments, install tools, or modify processor source.
metadata:
  short-description: Bootstrap processor project rules
---

# Bootstrap Processor Project

Create one human-editable, project-owned `AGENTS.md` at the processor project root. Preserve existing project authority and keep every other project file unchanged.

## Baseline

Read [assets/AGENTS.md](assets/AGENTS.md) completely before drafting or comparing a project file. Treat it as a maintained output template. It becomes project authority only after the user accepts it or it is written into a project that lacks `AGENTS.md` under an explicit bootstrap request.

On Windows PowerShell, read UTF-8 project documents with `Get-Content -Raw -Encoding utf8 -LiteralPath <path>`. Never depend on the Windows PowerShell 5.1 default file encoding. Apply this rule before inspecting an existing `AGENTS.md` and throughout the bootstrap task.

## Boundary

1. This skill may create or revise only the target project's root `AGENTS.md`.
2. Do not create Architecture, Design, Source, Verification, runtime, configuration, or placeholder files.
3. Do not inspect, install, configure, repair, or validate the development environment. Environment and toolchain responsibilities belong to deterministic scripts outside this skill.
4. Do not run builds, tests, simulators, synthesis tools, package managers, or environment setup commands.
5. Do not modify nested `AGENTS.md` files unless the user explicitly names one as the target.
6. Do not add machine-specific absolute paths, usernames, local tool locations, project-specific processor facts, or inferred architecture decisions.
7. After creation, the user project owns its `AGENTS.md`. Never synchronize or overwrite it from a later package version automatically.

## Resolve the target

1. Use the project root explicitly named by the user.
2. When no path is named, use the current Git worktree root if it is unambiguous and within the user's stated scope.
3. If multiple repositories or possible roots remain, ask the user to identify the target before writing.
4. Read all applicable existing `AGENTS.md` instructions before examining or changing the target.

## Missing `AGENTS.md`

1. Inspect the repository layout and tracked project documentation read-only.
2. Copy the baseline to `<project-root>/AGENTS.md`.
3. Adapt only facts directly supported by the repository or an explicit user decision:
   - project title;
   - Architecture, Design, Source, Verification, and Runtime path mapping;
   - declared build, test, simulation, synthesis, and static-check script entrypoints.
4. Keep the complete `最高优先级` section unless the user explicitly changes a rule.
5. Leave a default mapping unchanged when no contrary project evidence exists. Do not invent commands or paths.
6. Write no other file.

An explicit request to initialize or bootstrap the named project authorizes creating a missing root `AGENTS.md`. It does not authorize any other project or environment change.

## Existing `AGENTS.md`

1. Read the existing file and treat its current project rules as authoritative.
2. Do not replace it with the baseline.
3. Compare by responsibility: highest-priority behavior, authority, permissions, Architecture and Design gates, implementation, verification, runtime data, environment-script boundary, and delivery.
4. Preserve every existing rule unless the user explicitly approves its removal or replacement.
5. Report proposed additions, conflicts, and obsolete project-specific rules as an incremental change set.
6. Apply the change set only after the user explicitly authorizes the revision.

## Acceptance

Before completing, verify:

1. At most one target file changed, `<project-root>/AGENTS.md`.
2. A pre-existing file was not overwritten or reduced without explicit authorization.
3. The file contains no unresolved scaffold markers, guessed commands, or machine-specific paths.
4. The authority rules distinguish explicit user decisions, current Git authorities, implementation evidence, and external references.
5. The file retains user interaction, authorization, evidence, and no-auto-overwrite constraints.
6. No environment command or unrelated project action ran.

Report the target path, whether the operation created or revised the file, the evidence-backed adaptations, validation performed, and unresolved user choices.
