#!/usr/bin/env node

import {
  adviseDecision,
  auditStage1Architecture,
  buildWorkspaceAgentPrompt,
  openWorkspaceAgent,
  researchDecision,
} from "./agent-runtime.js";
import { renderDecisionPacket } from "./render.js";
import { migrateProductSchema } from "./product-migration.js";
import {
  answerCustomDecision,
  answerDecision,
  applyReviewCorrection,
  approveStage1,
  completeStage1,
  deferDecision,
  getNextStage1Action,
  initStage1,
  loadStage1,
  migrateReviewCorrectionsV2,
  probeEnvironment,
  refreshStage1Profile,
  releaseProjectSpecOverride,
  reopenDecision,
  reviewStage1,
  scaffoldStage1,
  summarizeStage1,
  type ReviewCorrectionProposal,
} from "./stage1.js";
import {
  answerTopologyCustom,
  answerTopologyDecision,
  approveModuleDesign,
  approveTopologyPlan,
  initStage2,
  loadStage2,
  migrateLegacyStage2,
  reopenModuleDesign,
  reopenTopologyDecision,
  reviewTopologyPlan,
  runActiveImplementation,
  runModuleVerification,
  runShadowDesign,
  runTopologyPlanning,
  startStage2ArchitectureRework,
  resumeStage2ArchitectureRework,
  summarizeStage2,
} from "./stage2.js";
import {
  answerStage2DecisionRequest,
  advanceStage2Workspace,
  cancelStage2WorkspaceRun,
  approvePackageDesign,
  approveSystemDesign,
  initStage2Workspace,
  loadStage2Workspace,
  migrateStage2Workspace,
  reopenPackageDesign,
  requestSystemDesignRevision,
  runPackageDesign,
  runPackageImplementation,
  runPackageVerification,
  runSystemDesignDraft,
  summarizeStage2Workspace,
} from "./stage2/workflow.js";
import {
  resumeStage2WorkspaceArchitectureRework,
  startStage2WorkspaceArchitectureRework,
} from "./stage2/rework.js";
import type {
  Stage2ArchitectureReworkProposal,
  Stage2NextAction,
  Stage2VerificationMode,
  Stage2WorkspaceNextAction,
  Stage2WorkspaceSummary,
  Stage2WorkspaceArchitectureReworkProposal,
} from "./types.js";

interface ParsedArguments {
  positional: string[];
  options: Map<string, string[]>;
}

async function main(): Promise<void> {
  const input = process.argv.slice(2);
  const scope = input[0];
  if (scope === undefined || scope === "help" || scope === "--help" || scope === "-h") {
    printHelp();
    return;
  }
  if (scope === "open") {
    await commandOpen(parseArguments(input.slice(1)));
    return;
  }
  if (scope === "migrate") {
    await commandProductMigrate(parseArguments(input.slice(1)));
    return;
  }
  const command = input[1];
  if (command === undefined) {
    throw new Error("Use `processor-agent open <path>`, `processor-agent stage1 <command>`, or `processor-agent stage2 <command>`");
  }
  if (scope === "stage2") {
    await commandStage2(command, parseArguments(input.slice(2)));
    return;
  }
  if (scope !== "stage1") {
    throw new Error("Use `processor-agent open <path>`, `processor-agent stage1 <command>`, or `processor-agent stage2 <command>`");
  }
  const args = parseArguments(input.slice(2));
  switch (command) {
    case "init":
      await commandInit(args);
      break;
    case "status":
      await commandStatus(args);
      break;
    case "next":
      await commandNext(args);
      break;
    case "answer":
      await commandAnswer(args);
      break;
    case "custom":
      await commandCustom(args);
      break;
    case "defer":
      await commandDefer(args);
      break;
    case "reopen":
      await commandReopen(args);
      break;
    case "correct":
      await commandCorrect(args);
      break;
    case "correction-migrate":
      await commandCorrectionMigrate(args);
      break;
    case "release-override":
      await commandReleaseOverride(args);
      break;
    case "probe":
      await commandProbe(args);
      break;
    case "profile-refresh":
      await commandProfileRefresh(args);
      break;
    case "advise":
      await commandAdvise(args);
      break;
    case "research":
      await commandResearch(args);
      break;
    case "review":
      await commandReview(args);
      break;
    case "audit":
      await commandAudit(args);
      break;
    case "approve":
      await commandApprove(args);
      break;
    case "scaffold":
      await commandScaffold(args);
      break;
    case "complete":
      await commandComplete(args);
      break;
    default:
      throw new Error(`Unknown Stage1 command: ${command}`);
  }
}

async function commandProductMigrate(args: ParsedArguments): Promise<void> {
  assertOnlyOptions(args, ["profile", "dry-run", "apply", "json"]);
  const dryRun = flag(args, "dry-run");
  const apply = flag(args, "apply");
  if (dryRun === apply) {
    throw new Error("Product migration requires exactly one of --dry-run or --apply");
  }
  const report = await migrateProductSchema(
    requirePositional(args, 0, "project path"),
    {
      profileReference: requireOption(args, "profile"),
      apply,
    },
  );
  if (flag(args, "json")) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    return;
  }
  process.stdout.write(
    [
      `Product migration: ${report.fromProfileVersion} -> ${report.toProfileVersion}`,
      `Stage1: schema ${String(report.fromStage1SchemaVersion)} -> 2, revision ${String(report.sourceStage1Revision)} -> ${String(report.targetStage1Revision)}`,
      `Stage2: ${report.stage2.sourceSchemaVersion === undefined ? "not initialized" : `schema ${String(report.stage2.sourceSchemaVersion)} -> ${String(report.stage2.targetSchemaVersion)}`}`,
      `Retired artifacts: ${report.retiredArtifacts.join(", ") || "none"}`,
      `Ineffective corrections: ${report.ineffectiveCorrectionIds.join(", ") || "none"}`,
      `Applied: ${String(report.applied)}`,
      report.nextRequiredAction,
      "",
    ].join("\n"),
  );
}

async function commandStage2(command: string, args: ParsedArguments): Promise<void> {
  switch (command) {
    case "init": {
      assertOnlyOptions(args, []);
      const loaded = await initStage2Workspace(requirePositional(args, 0, "project path"));
      printStage2WorkspaceSummary(await summarizeStage2Workspace(loaded));
      break;
    }
    case "migrate": {
      assertOnlyOptions(args, ["dry-run", "apply", "json"]);
      const dryRun = flag(args, "dry-run");
      const apply = flag(args, "apply");
      if (dryRun === apply) {
        throw new Error("Stage2 migration requires exactly one of --dry-run or --apply");
      }
      const report = await migrateStage2Workspace(
        requirePositional(args, 0, "project path"),
        apply,
      );
      if (flag(args, "json")) {
        process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
      } else {
        process.stdout.write(
          [
            `Stage2 migration: schema ${String(report.sourceSchemaVersion)} -> ${String(report.targetSchemaVersion)}`,
            `Revision: ${String(report.sourceRevision)} -> ${String(report.targetRevision)}`,
            `Retained evidence: ${String(report.retainedEvidence.length)}`,
            `Retired mechanisms: ${report.retiredMechanisms.join(", ")}`,
            `Applied: ${String(report.applied)}`,
            report.nextRequiredAction,
            "",
          ].join("\n"),
        );
      }
      break;
    }
    case "status": {
      assertOnlyOptions(args, ["json"]);
      const projectPath = requirePositional(args, 0, "project path");
      if (await usesStage2WorkspaceSchema(projectPath)) {
        const summary = await summarizeStage2Workspace(await loadStage2Workspace(projectPath));
        if (flag(args, "json")) {
          process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
        } else {
          printStage2WorkspaceSummary(summary);
        }
        break;
      }
      const summary = await summarizeStage2(await loadStage2(projectPath));
      if (flag(args, "json")) {
        process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
      } else {
        printStage2Summary(summary);
      }
      break;
    }
    case "next": {
      assertOnlyOptions(args, ["json"]);
      const projectPath = requirePositional(args, 0, "project path");
      if (await usesStage2WorkspaceSchema(projectPath)) {
        const actions = (await summarizeStage2Workspace(
          await loadStage2Workspace(projectPath),
        )).readyActions;
        if (flag(args, "json")) {
          process.stdout.write(`${JSON.stringify(actions, null, 2)}\n`);
        } else {
          printStage2WorkspaceActions(actions);
        }
        break;
      }
      const actions = (await summarizeStage2(await loadStage2(projectPath))).readyActions;
      if (flag(args, "json")) {
        process.stdout.write(`${JSON.stringify(actions, null, 2)}\n`);
      } else {
        printStage2Actions(actions);
      }
      break;
    }
    case "advance": {
      assertOnlyOptions(args, ["json"]);
      const report = await advanceStage2Workspace(
        requirePositional(args, 0, "project path"),
      );
      if (flag(args, "json")) {
        process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
      } else {
        process.stdout.write(
          [
            `Stage2 dispatch: ${report.dispatchId}`,
            ...report.results.map((result) =>
              `${result.kind}/${result.workPackageId ?? "system"}: ${result.status}${result.error === undefined ? "" : `; ${result.error}`}`
            ),
            "",
          ].join("\n"),
        );
      }
      break;
    }
    case "cancel": {
      assertOnlyOptions(args, ["json"]);
      const result = await cancelStage2WorkspaceRun(
        requirePositional(args, 0, "project path"),
        requirePositional(args, 1, "run id or runtime ref"),
      );
      if (flag(args, "json")) {
        process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
      } else {
        process.stdout.write(`Cancelled Stage2 run: ${result.runId}\n`);
      }
      break;
    }
    case "start":
    case "draft": {
      assertOnlyOptions(args, ["instruction"]);
      const result = await runSystemDesignDraft(
        requirePositional(args, 0, "project path"),
        option(args, "instruction"),
      );
      process.stdout.write(
        `System Design drafted and reviewed\nrunId: ${result.runId}\nruntimeRef: ${result.runtimeRef}\n`,
      );
      printStage2WorkspaceSummary(await summarizeStage2Workspace(result.loaded));
      break;
    }
    case "revise": {
      assertOnlyOptions(args, ["revision", "instruction", "affected"]);
      const loaded = await requestSystemDesignRevision(
        requirePositional(args, 0, "project path"),
        requireNonNegativeIntegerOption(args, "revision"),
        requireOption(args, "instruction"),
        {
          affectedWorkPackages: options(args, "affected")
            .map((item) => item.trim())
            .filter((item) => item !== "" && item !== "true"),
        },
      );
      printStage2WorkspaceSummary(await summarizeStage2Workspace(loaded));
      break;
    }
    case "decide": {
      assertOnlyOptions(args, ["text", "note"]);
      const optionId = args.positional[2];
      const customConclusion = option(args, "text");
      const loaded = await answerStage2DecisionRequest(
        requirePositional(args, 0, "project path"),
        requirePositional(args, 1, "DecisionRequest id"),
        {
          ...(optionId === undefined ? {} : { optionId }),
          ...(customConclusion === undefined ? {} : { customConclusion }),
          ...(option(args, "note") === undefined ? {} : { note: option(args, "note")! }),
        },
      );
      printStage2WorkspaceSummary(await summarizeStage2Workspace(loaded));
      break;
    }
    case "plan": {
      assertOnlyOptions(args, ["instruction", "refresh"]);
      const result = await runTopologyPlanning(
        requirePositional(args, 0, "project path"),
        args.positional[1],
        option(args, "instruction"),
        { refreshResearch: flag(args, "refresh") },
      );
      process.stdout.write(
        `Topology proposal drafted: ${result.output.decisionId}\nrunId: ${result.runId}\nthreadId: ${result.threadId}\n`,
      );
      printStage2Summary(await summarizeStage2(result.loaded));
      break;
    }
    case "answer": {
      const loaded = await answerTopologyDecision(
        requirePositional(args, 0, "project path"),
        requirePositional(args, 1, "Topology Decision id"),
        requirePositional(args, 2, "option id"),
        option(args, "note"),
      );
      printStage2Summary(await summarizeStage2(loaded));
      break;
    }
    case "custom": {
      const loaded = await answerTopologyCustom(
        requirePositional(args, 0, "project path"),
        requirePositional(args, 1, "Topology Decision id"),
        requireOption(args, "text"),
        option(args, "note"),
      );
      printStage2Summary(await summarizeStage2(loaded));
      break;
    }
    case "review": {
      const loaded = await reviewTopologyPlan(requirePositional(args, 0, "project path"));
      printStage2Summary(await summarizeStage2(loaded));
      break;
    }
    case "approve-plan": {
      const loaded = await approveTopologyPlan(requirePositional(args, 0, "project path"));
      printStage2Summary(await summarizeStage2(loaded));
      break;
    }
    case "topology-reopen": {
      const loaded = await reopenTopologyDecision(
        requirePositional(args, 0, "project path"),
        requirePositional(args, 1, "Topology Decision id"),
        requireOption(args, "reason"),
      );
      printStage2Summary(await summarizeStage2(loaded));
      break;
    }
    case "rework-start": {
      assertOnlyOptions(args, ["proposal-json"]);
      const projectPath = requirePositional(args, 0, "project path");
      const proposalText = requireOption(args, "proposal-json");
      let proposal: unknown;
      try {
        proposal = JSON.parse(proposalText) as unknown;
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        throw new Error(`Invalid --proposal-json: ${detail}`);
      }
      if (await usesStage2WorkspaceSchema(projectPath)) {
        const loaded = await startStage2WorkspaceArchitectureRework(
          projectPath,
          proposal as Stage2WorkspaceArchitectureReworkProposal,
        );
        printStage2WorkspaceSummary(await summarizeStage2Workspace(loaded));
        break;
      }
      const loaded = await startStage2ArchitectureRework(
        projectPath,
        proposal as Stage2ArchitectureReworkProposal,
      );
      printStage2Summary(await summarizeStage2(loaded));
      break;
    }
    case "rework-resume": {
      assertOnlyOptions(args, []);
      const projectPath = requirePositional(args, 0, "project path");
      if (await usesStage2WorkspaceSchema(projectPath)) {
        const loaded = await resumeStage2WorkspaceArchitectureRework(projectPath);
        printStage2WorkspaceSummary(await summarizeStage2Workspace(loaded));
        break;
      }
      const loaded = await resumeStage2ArchitectureRework(
        projectPath,
      );
      printStage2Summary(await summarizeStage2(loaded));
      break;
    }
    case "design": {
      const projectPath = requirePositional(args, 0, "project path");
      if (await usesStage2WorkspaceSchema(projectPath)) {
        assertOnlyOptions(args, ["instruction"]);
        const result = await runPackageDesign(
          projectPath,
          args.positional[1],
          option(args, "instruction"),
        );
        process.stdout.write(
          `Package Design drafted: ${result.output.workPackageId}\nrunId: ${result.runId}\nruntimeRef: ${result.runtimeRef}\n`,
        );
        printStage2WorkspaceSummary(await summarizeStage2Workspace(result.loaded));
        break;
      }
      const result = await runShadowDesign(
        projectPath,
        args.positional[1],
        option(args, "instruction"),
      );
      process.stdout.write(
        `Stage2 Design drafted: ${result.output.moduleId}\nrunId: ${result.runId}\nthreadId: ${result.threadId}\n`,
      );
      printStage2Summary(await summarizeStage2(result.loaded));
      break;
    }
    case "approve": {
      const projectPath = requirePositional(args, 0, "project path");
      if (await usesStage2WorkspaceSchema(projectPath)) {
        assertOnlyOptions(args, []);
        const loaded = args.positional[1] === undefined
          ? await approveSystemDesign(projectPath)
          : await approvePackageDesign(projectPath, args.positional[1]);
        printStage2WorkspaceSummary(await summarizeStage2Workspace(loaded));
        break;
      }
      const mode = requireOption(args, "verification-mode");
      if (mode !== "independent_workers" && mode !== "active_only") {
        throw new Error(`Invalid --verification-mode: ${mode}`);
      }
      const loaded = await approveModuleDesign(
        projectPath,
        requirePositional(args, 1, "module id"),
        mode as Stage2VerificationMode,
      );
      printStage2Summary(await summarizeStage2(loaded));
      break;
    }
    case "implement": {
      const projectPath = requirePositional(args, 0, "project path");
      if (await usesStage2WorkspaceSchema(projectPath)) {
        assertOnlyOptions(args, []);
        const result = await runPackageImplementation(projectPath, args.positional[1]);
        process.stdout.write(
          `Package implementation processed: ${result.output.workPackageId}\nrunId: ${result.runId}\nruntimeRef: ${result.runtimeRef}\n`,
        );
        printStage2WorkspaceSummary(await summarizeStage2Workspace(result.loaded));
        break;
      }
      const result = await runActiveImplementation(
        projectPath,
        args.positional[1],
      );
      process.stdout.write(
        `Stage2 implementation processed: ${result.output.moduleId}\nrunId: ${result.runId}\nthreadId: ${result.threadId}\n`,
      );
      printStage2Summary(await summarizeStage2(result.loaded));
      break;
    }
    case "verify": {
      const projectPath = requirePositional(args, 0, "project path");
      if (await usesStage2WorkspaceSchema(projectPath)) {
        assertOnlyOptions(args, []);
        const loaded = await runPackageVerification(
          projectPath,
          requirePositional(args, 1, "Work Package id"),
        );
        printStage2WorkspaceSummary(await summarizeStage2Workspace(loaded));
        break;
      }
      const loaded = await runModuleVerification(
        projectPath,
        args.positional[1],
      );
      printStage2Summary(await summarizeStage2(loaded));
      break;
    }
    case "reopen": {
      const projectPath = requirePositional(args, 0, "project path");
      if (await usesStage2WorkspaceSchema(projectPath)) {
        assertOnlyOptions(args, ["reason"]);
        const loaded = await reopenPackageDesign(
          projectPath,
          requirePositional(args, 1, "Work Package id"),
          requireOption(args, "reason"),
        );
        printStage2WorkspaceSummary(await summarizeStage2Workspace(loaded));
        break;
      }
      const loaded = await reopenModuleDesign(
        projectPath,
        requirePositional(args, 1, "module id"),
        requireOption(args, "reason"),
      );
      printStage2Summary(await summarizeStage2(loaded));
      break;
    }
    default:
      throw new Error(`Unknown Stage2 command: ${command}`);
  }
}

async function commandOpen(args: ParsedArguments): Promise<void> {
  const path = requirePositional(args, 0, "project path");
  if (flag(args, "print-prompt")) {
    process.stdout.write(`${await buildWorkspaceAgentPrompt(path)}\n`);
    return;
  }
  const status = await openWorkspaceAgent(path);
  if (status !== 0) {
    process.exitCode = status;
  }
}

async function commandInit(args: ParsedArguments): Promise<void> {
  const path = requirePositional(args, 0, "project path");
  const profile = option(args, "profile") ?? "dual_issue_demo";
  const projectName = option(args, "name");
  const goal = option(args, "goal");
  const useCase = option(args, "use-case");
  const constraints = options(args, "constraint");
  const exclusions = options(args, "exclude");
  const loaded = await initStage1(path, profile, {
    ...(projectName === undefined ? {} : { projectName }),
    ...(goal === undefined ? {} : { goal }),
    ...(useCase === undefined ? {} : { useCase }),
    ...(constraints.length === 0 ? {} : { constraints }),
    ...(exclusions.length === 0 ? {} : { exclusions }),
    skipProbe: flag(args, "skip-probe"),
  });
  printSummary(await summarizeStage1(loaded));
  printNext(loaded);
}

async function commandStatus(args: ParsedArguments): Promise<void> {
  const loaded = await loadStage1(requirePositional(args, 0, "project path"));
  const summary = await summarizeStage1(loaded);
  if (flag(args, "json")) {
    process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
  } else {
    printSummary(summary);
  }
}

async function commandNext(args: ParsedArguments): Promise<void> {
  const loaded = await loadStage1(requirePositional(args, 0, "project path"));
  const action = getNextStage1Action(loaded.state, loaded.loadedProfile.profile);
  if (action === undefined) {
    process.stdout.write(`No ready decision. Current state: ${loaded.state.stage1.status}\n`);
    return;
  }
  if (flag(args, "json")) {
    process.stdout.write(`${JSON.stringify(action, null, 2)}\n`);
  } else if (action.kind === "research_required") {
    process.stdout.write(
      `Research required: ${action.decision.id}\nRun: processor-agent stage1 research . ${action.decision.id}\n`,
    );
  } else if (action.kind === "decision_ready") {
    process.stdout.write(renderDecisionPacket(action.decision, loaded.state));
  } else {
    printReviewAction(action);
  }
}

async function commandAnswer(args: ParsedArguments): Promise<void> {
  assertOnlyOptions(args, ["note"]);
  const path = requirePositional(args, 0, "project path");
  const decision = requirePositional(args, 1, "decision id");
  const selected = requirePositional(args, 2, "option id");
  const note = option(args, "note");
  const loaded = await answerDecision(path, decision, selected, note);
  printSummary(await summarizeStage1(loaded));
  printNext(loaded);
}

async function commandCustom(args: ParsedArguments): Promise<void> {
  const path = requirePositional(args, 0, "project path");
  const decision = requirePositional(args, 1, "decision id");
  const text = requireOption(args, "text");
  const loaded = await answerCustomDecision(path, decision, text, option(args, "note"));
  printSummary(await summarizeStage1(loaded));
  printNext(loaded);
}

async function commandDefer(args: ParsedArguments): Promise<void> {
  const path = requirePositional(args, 0, "project path");
  const decision = requirePositional(args, 1, "decision id");
  const loaded = await deferDecision(
    path,
    decision,
    requireOption(args, "until"),
    requireOption(args, "note"),
  );
  printSummary(await summarizeStage1(loaded));
  printNext(loaded);
}

async function commandReopen(args: ParsedArguments): Promise<void> {
  const path = requirePositional(args, 0, "project path");
  const decision = requirePositional(args, 1, "decision id");
  const result = await reopenDecision(path, decision, requireOption(args, "reason"));
  process.stdout.write(`Reopened Decision: ${decision}\n`);
  if (result.invalidatedDecisionIds.length > 0) {
    process.stdout.write(`Invalidated dependents: ${result.invalidatedDecisionIds.join(", ")}\n`);
  }
  printSummary(await summarizeStage1(result.loaded));
  printNext(result.loaded);
}

async function commandCorrect(args: ParsedArguments): Promise<void> {
  assertOnlyOptions(args, ["proposal-json"]);
  const path = requirePositional(args, 0, "project path");
  const findingCodes = args.positional.slice(1);
  const proposalText = requireOption(args, "proposal-json");
  let proposal: ReviewCorrectionProposal;
  try {
    proposal = JSON.parse(proposalText) as ReviewCorrectionProposal;
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`Invalid --proposal-json: ${detail}`);
  }
  if (
    typeof proposal !== "object"
    || proposal === null
    || !("patch" in proposal)
    || typeof proposal.rationale !== "string"
    || !Array.isArray(proposal.evidenceSources)
    || typeof proposal.evidenceCoverage !== "object"
    || proposal.evidenceCoverage === null
  ) {
    throw new Error("Correction Proposal requires patch, rationale, evidenceSources, and evidenceCoverage");
  }
  const loaded = await applyReviewCorrection(path, {
    findingCodes,
    patch: proposal.patch,
    rationale: proposal.rationale,
    evidenceSources: proposal.evidenceSources,
    evidenceCoverage: proposal.evidenceCoverage,
  });
  const correction = loaded.state.stage1.reviewCorrections?.at(-1);
  process.stdout.write(`Applied Review Correction: ${correction?.id ?? "missing"}\n`);
  printSummary(await summarizeStage1(loaded));
  printNext(loaded);
}

async function commandCorrectionMigrate(args: ParsedArguments): Promise<void> {
  assertOnlyOptions(args, ["dry-run", "apply"]);
  const dryRun = flag(args, "dry-run");
  const apply = flag(args, "apply");
  if (dryRun === apply) {
    throw new Error("Use exactly one of --dry-run or --apply");
  }
  const report = await migrateReviewCorrectionsV2(
    requirePositional(args, 0, "project path"),
    apply,
  );
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}

async function commandReleaseOverride(args: ParsedArguments): Promise<void> {
  assertOnlyOptions(args, []);
  const loaded = await releaseProjectSpecOverride(
    requirePositional(args, 0, "project path"),
    requirePositional(args, 1, "ProjectSpec target"),
  );
  printSummary(await summarizeStage1(loaded));
  printNext(loaded);
}

async function commandProbe(args: ParsedArguments): Promise<void> {
  const loaded = await probeEnvironment(requirePositional(args, 0, "project path"));
  printSummary(await summarizeStage1(loaded));
}

async function commandProfileRefresh(args: ParsedArguments): Promise<void> {
  const loaded = await refreshStage1Profile(
    requirePositional(args, 0, "project path"),
    undefined,
    {
      adoptProfileDefaults: flag(args, "adopt-profile-defaults"),
      resetChangedAdvice: flag(args, "reset-changed-advice"),
    },
  );
  printSummary(await summarizeStage1(loaded));
}

async function commandAdvise(args: ParsedArguments): Promise<void> {
  const advice = await adviseDecision(
    requirePositional(args, 0, "project path"),
    args.positional[1],
    { refresh: flag(args, "refresh") },
  );
  process.stdout.write(`${JSON.stringify(advice, null, 2)}\n`);
}

async function commandResearch(args: ParsedArguments): Promise<void> {
  const question = option(args, "question");
  const scope = option(args, "scope");
  const sources = options(args, "source");
  const result = await researchDecision(
    requirePositional(args, 0, "project path"),
    args.positional[1],
    {
      refresh: flag(args, "refresh"),
      request: {
        ...(question === undefined ? {} : { question }),
        ...(sources.length === 0 ? {} : { sources }),
        ...(scope === undefined ? {} : { scope }),
      },
    },
  );
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

async function commandReview(args: ParsedArguments): Promise<void> {
  const loaded = await reviewStage1(requirePositional(args, 0, "project path"));
  printSummary(await summarizeStage1(loaded));
  process.stdout.write("Deterministic review gate passed. Run `stage1 audit` before approval.\n");
}

async function commandAudit(args: ParsedArguments): Promise<void> {
  const report = await auditStage1Architecture(requirePositional(args, 0, "project path"));
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}

async function commandApprove(args: ParsedArguments): Promise<void> {
  const loaded = await approveStage1(requirePositional(args, 0, "project path"));
  printSummary(await summarizeStage1(loaded));
  process.stdout.write(`Approved aggregate: ${loaded.state.stage1.approval?.aggregateSha256 ?? "missing"}\n`);
}

async function commandScaffold(args: ParsedArguments): Promise<void> {
  const loaded = await scaffoldStage1(requirePositional(args, 0, "project path"));
  printSummary(await summarizeStage1(loaded));
}

async function commandComplete(args: ParsedArguments): Promise<void> {
  const loaded = await completeStage1(requirePositional(args, 0, "project path"));
  printSummary(await summarizeStage1(loaded));
}

function printSummary(summary: Awaited<ReturnType<typeof summarizeStage1>>): void {
  process.stdout.write(
    [
      `Project: ${summary.projectName}`,
      `Profile: ${summary.profile}`,
      `Stage1: ${summary.status}`,
      `Revision: ${summary.revision}`,
      `Decisions: ${summary.answered} answered, ${summary.pending} pending, ${summary.deferred} deferred`,
      `Approval current: ${summary.approvalCurrent ? "yes" : "no"}`,
      `ProjectSpec history: v${String(summary.projectSpecProtocolVersion)}, ${String(summary.projectSpecHistoryEvents)} events`,
      `Legacy unresolved Corrections: ${String(summary.legacyUnresolvedCorrections)}`,
      ...(summary.architectureRework === undefined
        ? []
        : [`Architecture rework: ${summary.architectureRework.id}, ${summary.architectureRework.status}, ${summary.architectureRework.repairKind}:${summary.architectureRework.repairTarget}`]),
      ...(summary.blockers.length === 0 ? [] : summary.blockers.map((item) => `Blocker: ${item}`)),
    ].join("\n") + "\n",
  );
}

function printStage2Summary(summary: Awaited<ReturnType<typeof summarizeStage2>>): void {
  process.stdout.write(
    [
      `Project: ${summary.projectName}`,
      `Stage2: ${summary.status}`,
      `Revision: ${summary.revision}`,
      `State epoch: ${summary.stateEpoch}`,
      `Plan: ${summary.plan.path}, revision ${summary.plan.revision}, Decisions ${summary.plan.answeredDecisions}/${summary.plan.totalDecisions}, approval current=${String(summary.plan.approvalCurrent)}`,
      ...(summary.plan.currentDecisionId === undefined ? [] : [`Current Decision: ${summary.plan.currentDecisionId}`]),
      `Units: ${summary.complete}/${summary.total} complete`,
      ...(summary.active?.moduleId === undefined
        ? []
        : [`Active: slot ${summary.active.slot}, Unit ${summary.active.moduleId}`]),
      ...(summary.shadow?.moduleId === undefined
        ? []
        : [`Shadow: slot ${summary.shadow.slot}, Unit ${summary.shadow.moduleId}`]),
      ...(summary.currentUserGate === undefined ? [] : [`User gate: ${summary.currentUserGate}`]),
      ...(summary.architectureRework === undefined
        ? []
        : [
            `Architecture rework: ${summary.architectureRework.id}, ${summary.architectureRework.status}`,
            `Stage1 repair: ${summary.architectureRework.repair.kind}:${summary.architectureRework.repair.target}`,
            `Affected Topology: ${summary.architectureRework.affectedTopologyDecisions.join(",")}`,
            `Affected Units: ${summary.architectureRework.affectedUnits.join(",") || "none"}`,
          ]),
      ...summary.nextMachineActions.map((item) => `Machine action: ${item}`),
      ...(summary.blockers.length === 0 ? [] : summary.blockers.map((item) => `Blocker: ${item}`)),
      ...(summary.board.length === 0
        ? ["Board: no Implementation Unit has been confirmed"]
        : [
            "Board:",
            "Unit | Architecture | DependsOn | Wave | Status | Agent | Design | Source | Test | Verification | Blocker",
            ...summary.board.map((row) => [
              row.unitId,
              row.architectureRoles.join(",") || "-",
              row.dependsOn.join(",") || "-",
              row.wave === null ? "-" : String(row.wave),
              row.status,
              row.agentRole,
              row.designRevision === undefined ? row.designPath || "-" : `${row.designPath}@${String(row.designRevision)}`,
              row.sourcePaths.join(",") || "-",
              row.testPaths.join(",") || "-",
              row.verificationStatus,
              row.blockers.join("; ") || "-",
            ].join(" | ")),
          ]),
    ].join("\n") + "\n",
  );
}

function printStage2Actions(actions: Stage2NextAction[]): void {
  if (actions.length === 0) {
    process.stdout.write("No ready Stage2 action.\n");
    return;
  }
  for (const action of actions) {
    switch (action.kind) {
      case "architecture_rework_stage1":
        process.stdout.write(
          `Architecture Rework ${action.reworkId}: complete Stage1 ${action.repairKind}:${action.repairTarget}\n`,
        );
        break;
      case "architecture_rework_resume":
        process.stdout.write(`Architecture Rework ready to resume: ${action.reworkId}\n`);
        break;
      case "topology_planning":
        process.stdout.write(
          `Topology planning: ${action.decisionId}, ${action.topic}, researchPolicy=${action.researchPolicy}, slot ${action.slot}\n`,
        );
        break;
      case "topology_decision":
        process.stdout.write(
          [
            `Topology Decision: ${action.decision.id}`,
            action.decision.question,
            `Plan: ${action.planPath}@${String(action.planRevision)}`,
            `Structured option details: ${action.planPath}`,
            `Recommendation: ${action.proposal.recommendation}`,
            ...action.proposal.options.map((option) =>
              `- ${option.id}: ${option.label}; ${option.summary}; benefits=${option.benefits.join("; ") || "none"}; costs=${option.costs.join("; ") || "none"}; risks=${option.risks.join("; ") || "none"}`
            ),
            ...action.proposal.openQuestions.map((question) => `Open question: ${question}`),
          ].join("\n") + "\n",
        );
        break;
      case "topology_review":
        process.stdout.write(
          `Topology review: ${action.planPath}@${String(action.planRevision)}${action.issues.length === 0 ? "" : `\n${action.issues.map((item) => `- ${item}`).join("\n")}`}\n`,
        );
        break;
      case "topology_approval":
        process.stdout.write(
          `Topology approval required: ${action.planPath}@${String(action.planRevision)}, sha256=${action.planDocumentSha256}\n`,
        );
        break;
      case "shadow_design":
        process.stdout.write(`Shadow Design: Unit ${action.moduleId}, slot ${action.slot}\n`);
        break;
      case "design_revision":
        process.stdout.write(
          `Design revision required: ${action.moduleId}, ${action.designPath}, sha256=${action.designSha256}\n${action.issues.map((item) => `- ${item}`).join("\n")}\n`,
        );
        break;
      case "design_approval":
        process.stdout.write(
          `Design approval required: ${action.moduleId}, ${action.designPath}, sha256=${action.designSha256}\n`,
        );
        break;
      case "waiting_for_rotation":
        process.stdout.write(`Design closed, waiting for rotation: ${action.moduleId}, slot ${action.slot}\n`);
        break;
      case "active_implementation":
        process.stdout.write(`Active Implementation: ${action.moduleId}, slot ${action.slot}\n`);
        break;
      case "verification":
        process.stdout.write(`Verification: ${action.moduleId}, mode=${action.mode}, slot ${action.slot}\n`);
        break;
      case "blocked":
        process.stdout.write(`Blocked: ${action.moduleId}: ${action.blockers.join("; ")}\n`);
        break;
      case "baseline_complete":
        process.stdout.write("Stage2 baseline is complete.\n");
        break;
    }
  }
}

function printStage2WorkspaceSummary(summary: Stage2WorkspaceSummary): void {
  process.stdout.write(
    [
      `Project: ${summary.projectName}`,
      `Stage2: ${summary.status}`,
      `Revision: ${String(summary.revision)}`,
      `Workspace revision: ${String(summary.workspaceRevision)}`,
      `System Design: ${summary.systemDesign.path}@${String(summary.systemDesign.revision)}, drafted=${String(summary.systemDesign.drafted)}, open Decisions=${String(summary.systemDesign.openDecisions)}, approval current=${String(summary.systemDesign.approvalCurrent)}`,
      ...(summary.systemDesign.reviewVerdict === undefined
        ? []
        : [`System Design review: ${summary.systemDesign.reviewVerdict}`]),
      ...(summary.systemDesign.revisionRequest === undefined
        ? []
        : [
          `System Design revision request: ${summary.systemDesign.revisionRequest.id}, status=${summary.systemDesign.revisionRequest.status}, base=${String(summary.systemDesign.revisionRequest.baseDesignRevision)}`,
        ]),
      `Work Packages: ${String(summary.complete)}/${String(summary.total)} complete`,
      ...(summary.active?.workPackageId === undefined
        ? []
        : [`Active: slot ${summary.active.slot}, Package ${summary.active.workPackageId}`]),
      ...(summary.shadow?.workPackageId === undefined
        ? []
        : [`Shadow: slot ${summary.shadow.slot}, Package ${summary.shadow.workPackageId}`]),
      ...(summary.currentUserGate === undefined ? [] : [`User gate: ${summary.currentUserGate}`]),
      ...summary.nextMachineActions.map((item) => `Machine action: ${item}`),
      ...(summary.blockers.length === 0 ? [] : summary.blockers.map((item) => `Blocker: ${item}`)),
      ...(summary.board.length === 0
        ? ["Board: System Design 尚未批准"]
        : [
          "Board:",
          "Package | Components | DesignDeps | ImplementationDeps | IntegrationDeps | Status | Agent | Design | Source | Test | Verification | Blocker",
          ...summary.board.map((row) => [
            row.workPackageId,
            row.componentIds.join(",") || "-",
            row.designDependsOn.join(",") || "-",
            row.implementationDependsOn.join(",") || "-",
            row.integrationDependsOn.join(",") || "-",
            row.status,
            row.agentRole,
            row.designRevision === undefined
              ? row.designPath
              : `${row.designPath}@${String(row.designRevision)}`,
            row.sourcePaths.join(",") || "-",
            row.testPaths.join(",") || "-",
            row.verificationStatus,
            row.blockers.join("; ") || "-",
          ].join(" | ")),
        ]),
      ...(summary.runs.length === 0
        ? []
        : [
          "Recent runs:",
          ...summary.runs.map((run) =>
            `${run.runId} | ${run.task} | ${run.status} | ${run.slot ?? "-"}/${run.workPackageId ?? "-"} | elapsed=${formatElapsed(run.startedAt, run.completedAt)} | last=${run.lastEventAt ?? "-"} | deadline=${run.deadlineAt ?? "-"} | events=${String(run.eventCount)} | pid=${run.pid === undefined ? "-" : String(run.pid)}`
          ),
        ]),
    ].join("\n") + "\n",
  );
}

function formatElapsed(startedAt: string | undefined, completedAt: string | undefined): string {
  if (startedAt === undefined) {
    return "-";
  }
  const start = Date.parse(startedAt);
  const end = completedAt === undefined ? Date.now() : Date.parse(completedAt);
  if (!Number.isFinite(start) || !Number.isFinite(end)) {
    return "-";
  }
  return `${String(Math.max(0, Math.round((end - start) / 1_000)))}s`;
}

function printStage2WorkspaceActions(actions: Stage2WorkspaceNextAction[]): void {
  if (actions.length === 0) {
    process.stdout.write("No ready Stage2 action.\n");
    return;
  }
  for (const action of actions) {
    switch (action.kind) {
      case "system_design_draft":
        process.stdout.write(`System Design Draft: slot ${action.slot}\n`);
        break;
      case "system_design_revision":
        process.stdout.write(
          `System Design revision: slot ${action.slot}${action.issues.length === 0 ? "" : `\n${action.issues.map((item) => `- ${item}`).join("\n")}`}\n`,
        );
        break;
      case "decision_request":
        process.stdout.write(
          [
            `DecisionRequest: ${action.decision.id}`,
            `Scope: ${action.scope}${action.workPackageId === undefined ? "" : `/${action.workPackageId}`}`,
            action.decision.question,
            `Reason: ${action.decision.whyUserDecisionIsRequired}`,
            `Recommendation: ${action.decision.recommendation}`,
            ...action.decision.options.map((item) =>
              `- ${item.id}: ${item.label}; ${item.summary}; consequences=${item.consequences.join("; ")}`
            ),
          ].join("\n") + "\n",
        );
        break;
      case "system_design_approval":
        process.stdout.write(
          `System Design approval required: ${action.path}@${String(action.revision)}, sha256=${action.documentSha256}\n`,
        );
        break;
      case "package_design":
        process.stdout.write(`Package Design: ${action.workPackageId}, slot ${action.slot}\n`);
        break;
      case "package_design_revision":
        process.stdout.write(
          `Package Design revision: ${action.workPackageId}, slot ${action.slot}\n${action.issues.map((item) => `- ${item}`).join("\n")}\n`,
        );
        break;
      case "package_design_approval":
        process.stdout.write(
          `Package Design approval required: ${action.workPackageId}, ${action.path}, sha256=${action.designSha256}\n`,
        );
        break;
      case "active_implementation":
        process.stdout.write(`Active Implementation: ${action.workPackageId}, slot ${action.slot}\n`);
        break;
      case "verification":
        process.stdout.write(`Independent Static Review and Verification: ${action.workPackageId}\n`);
        break;
      case "runs_in_progress":
        process.stdout.write(`Stage2 runs in progress: ${action.runIds.join(", ")}\n`);
        break;
      case "waiting_for_rotation":
        process.stdout.write(`Package ready, waiting for rotation: ${action.workPackageId}, slot ${action.slot}\n`);
        break;
      case "architecture_rework_stage1":
        process.stdout.write(
          `Architecture Rework ${action.reworkId}: complete Stage1 ${action.repairKind}:${action.repairTarget}\n`,
        );
        break;
      case "architecture_rework_resume":
        process.stdout.write(`Architecture Rework ready to resume: ${action.reworkId}\n`);
        break;
      case "blocked":
        process.stdout.write(`Blocked: ${action.blockers.join("; ")}\n`);
        break;
      case "baseline_complete":
        process.stdout.write("Stage2 baseline is complete.\n");
        break;
    }
  }
}

async function usesStage2WorkspaceSchema(projectPath: string): Promise<boolean> {
  const schema = (await loadStage1(projectPath)).state.stage2?.schemaVersion;
  return schema === 4 || schema === 5;
}

function printNext(loaded: Awaited<ReturnType<typeof loadStage1>>): void {
  const action = getNextStage1Action(loaded.state, loaded.loadedProfile.profile);
  if (action === undefined) {
    return;
  }
  process.stdout.write("\n");
  if (action.kind === "research_required") {
    process.stdout.write(
      `Research required: ${action.decision.id}\nRun: processor-agent stage1 research . ${action.decision.id}\n`,
    );
  } else if (action.kind === "decision_ready") {
    process.stdout.write(renderDecisionPacket(action.decision, loaded.state));
  } else {
    printReviewAction(action);
  }
}

function printReviewAction(
  action: Extract<ReturnType<typeof getNextStage1Action>, { kind: "review_finding" | "audit_refresh_required" }>,
): void {
  if (action === undefined) {
    return;
  }
  if (action.kind === "audit_refresh_required") {
    process.stdout.write(`Audit refresh required: ${action.reason}\n`);
    return;
  }
  process.stdout.write(
    [
      `Review finding: ${action.finding.code}`,
      `Repair kind: ${action.finding.repairKind}`,
      `Repair target: ${action.finding.repairTarget}`,
      `Required closure: ${action.finding.requiredClosure.join("; ")}`,
      `Finding: ${action.finding.message}`,
    ].join("\n") + "\n",
  );
}

function parseArguments(input: string[]): ParsedArguments {
  const positional: string[] = [];
  const optionMap = new Map<string, string[]>();
  for (let index = 0; index < input.length; index += 1) {
    const token = input[index];
    if (token === undefined) {
      continue;
    }
    if (!token.startsWith("--")) {
      positional.push(token);
      continue;
    }
    const name = token.slice(2);
    const next = input[index + 1];
    const value = next !== undefined && !next.startsWith("--") ? next : "true";
    if (value !== "true") {
      index += 1;
    }
    const existing = optionMap.get(name) ?? [];
    existing.push(value);
    optionMap.set(name, existing);
  }
  return { positional, options: optionMap };
}

function requirePositional(args: ParsedArguments, index: number, label: string): string {
  const value = args.positional[index];
  if (value === undefined) {
    throw new Error(`Missing ${label}`);
  }
  return value;
}

function option(args: ParsedArguments, name: string): string | undefined {
  return args.options.get(name)?.at(-1);
}

function options(args: ParsedArguments, name: string): string[] {
  return args.options.get(name) ?? [];
}

function requireOption(args: ParsedArguments, name: string): string {
  const value = option(args, name);
  if (value === undefined || value === "true") {
    throw new Error(`Missing --${name}`);
  }
  return value;
}

function requireNonNegativeIntegerOption(args: ParsedArguments, name: string): number {
  const value = requireOption(args, name);
  if (!/^\d+$/u.test(value)) {
    throw new Error(`--${name} must be a non-negative integer`);
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) {
    throw new Error(`--${name} is outside the safe integer range`);
  }
  return parsed;
}

function flag(args: ParsedArguments, name: string): boolean {
  return option(args, name) === "true";
}

function assertOnlyOptions(args: ParsedArguments, allowed: string[]): void {
  const allowedSet = new Set(allowed);
  const unknown = [...args.options.keys()].find((name) => !allowedSet.has(name));
  if (unknown !== undefined) {
    throw new Error(`Unknown option --${unknown}`);
  }
}

function printHelp(): void {
  process.stdout.write(`processor-agent commands:
  open <path> [--print-prompt]
  migrate <path> --profile id --dry-run|--apply [--json]

processor-agent stage1 commands:
  init <path> [--profile id] [--name name] [--goal text] [--use-case text]
  status <path> [--json]
  next <path> [--json]
  answer <path> <decision-id> <option-id> [--note text]
  custom <path> <decision-id> --text text [--note text]
  defer <path> <decision-id> --until point --note rationale
  reopen <path> <decision-id> --reason rationale
  correct <path> <finding-code> [finding-code...] --proposal-json json
  correction-migrate <path> --dry-run|--apply
  release-override <path> <project-spec-target>
  probe <path>
  profile-refresh <path> [--adopt-profile-defaults] [--reset-changed-advice]
  advise <path> [decision-id] [--refresh]
  research <path> [decision-id] [--question text] [--source locator] [--scope text] [--refresh]
  review <path>
  audit <path>
  approve <path>
  scaffold <path>
  complete <path>

processor-agent stage2 commands:
  init <path>
  migrate <path> --dry-run|--apply [--json]
  status <path> [--json]
  next <path> [--json]
  advance <path> [--json]
  cancel <path> <run-id-or-runtime-ref> [--json]
  start <path> [--instruction text]
  draft <path> [--instruction text]
  revise <path> --revision number --instruction text [--affected work-package-id ...]
  decide <path> <decision-id> [option-id] [--text conclusion] [--note text]
  approve <path> [work-package-id]
  design <path> [work-package-id] [--instruction text]
  implement <path> [work-package-id]
  verify <path> <work-package-id>
  reopen <path> <work-package-id> --reason rationale
  rework-start <path> --proposal-json json
  rework-resume <path>
`);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`Error: ${message}\n`);
  process.exitCode = 1;
});
