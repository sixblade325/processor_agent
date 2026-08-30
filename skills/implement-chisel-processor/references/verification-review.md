# Verification And Review

## Primary verification

Use Verilator by default. Put tests only at approved test paths and put raw logs at the Task Envelope's evidence location. Record the exact command and random seed.

Cover applicable cases:

- normal completion and backpressure;
- empty, full, single-entry, and simultaneous-port states;
- same-cycle event conflicts and documented priority;
- flush, kill, late response, retry, and index reuse;
- one-hot, mask-subset, and mutual-exclusion assertions;
- narrow-address repeated reads and writes;
- same-cache-line ordering and cross-line concurrency;
- hit, miss-owned, miss-nack, forwarding full/partial coverage;
- allocation/merge conflicts, refill/install/writeback interactions;
- reset and long randomized stress with a reference model or scoreboard.

Use Treadle only when explicitly requested or for Verilator environment diagnosis. State the reason.

## Verification ladder

Select applicable levels from:

1. module unit tests;
2. adjacent queue/pipeline or producer/consumer cascade;
3. subsystem integration;
4. complete Backend or CPU functional/difftest.

Run every affected and available level before delivery. The order may change
when an independently runnable higher-level harness provides earlier feedback.
A pass at one level does not close another. ABI or shared-package changes must
use the real dependent source set and rerun affected downstream levels.

The reference model must represent distinct physical states when hardware
separates occupancy, issue existence, pending recycle, committed state, or
uncancelable ownership.

## Fresh artifacts and evidence

Regenerate RTL before using it as evidence, and before delivery when generated
RTL is part of acceptance. Record the elaboration top, source set, command, and
output location; stale generated output is not evidence for current source.

Separate these evidence levels:

```text
elaboration
Scala/C++ compilation
directed functional test
random or pressure test
cascade or subsystem integration
Backend or CPU validation
synthesis or timing evidence
```

Report completed cycles and explicit coverage boundaries. An interrupted stress
run remains open. A Verilator or build-tool failure is tooling evidence until
the RTL failure is reproduced.

When DCE, field retention, encoder behavior, or generated topology is disputed,
use an isolated comparison probe and inspect emitted FIRRTL/SystemVerilog.

## Failure record

Record:

```text
测试名：
复现命令：
随机种子：
失败周期：
失败信号：
实际行为：
期望行为：
定位模块：
根因：
修复建议：
```

## Static review

Provide design paths, source paths, tests, and acceptance criteria. Ask it to return findings ordered by severity with file and line references. Require checks for:

- mismatch between target documents and implementation;
- redundant conditions, overprotection, or invented protocol;
- serial dependency chains, wide muxes, fanout, and ready/valid loops;
- event overlap, missing assertions, late responses, and index reuse;
- weak tests whose observed result cannot distinguish the intended behavior.

## Verification review

Provide source and test paths plus commands, without the primary agent's expected verdict. Require an independent run and a short report containing backend, seed, cycle count, pass/fail, log path, and uncovered behavior.

## Evidence ownership

Follow the Task Envelope for evidence paths and output format. Do not create standalone review documents when the Harness projects both reviews into one module verification record. After fixes, rerun every affected directed test and the relevant stress test. Preserve failure logs when they explain a resolved bug; ignore generated logs in Git when repository policy requires it.
