# Processor Agent Skills

Generated: 2026-09-03

## Available Skills

Each directory contains a `SKILL.md` entrypoint.

- `bootstrap-processor-project`
- `design-chisel-processor`
- `implement-chisel-processor`
- `organize-processor-docs`
- `optimize-chisel-fpga-timing`
- `trace-vivado-timing-to-rtl`

## Notes

- The initial processor implementation and timing Skills were extracted from the LoongArch Cup legacy bundle on 2026-08-29.
- `bootstrap-processor-project` creates or safely compares one user-owned project-root `AGENTS.md`; environment and toolchain work remains in deterministic scripts.
- `organize-processor-docs` is a stateless Skill for a human-first `doc/` processor documentation network, evidence, and review.
- Its Bootstrap, Author, and Maintain workflows use a Design directory axis aligned with physical Chisel or RTL module topology, target-budget warnings, configurable provisional hard thresholds, two-link Architecture and Design navigation checks, encoding diagnostics, and separate handling for explanatory diagrams and evidence captures.
- Project-specific facts remain in the legacy project and user projects.
- Generated caches are excluded.
- Agent sessions, task execution, and tool calls remain Agent Runtime responsibilities. Skills do not maintain Harness workflow state.
