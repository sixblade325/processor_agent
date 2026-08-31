import { basename } from "node:path";
import { sha256 } from "../io.js";
import {
  cancelStage2AgentRun,
  defaultStage2AgentExecutor,
  type Stage2AgentExecutor,
  type Stage2AgentResponse,
  type Stage2AgentStreamEvent,
} from "../stage2-runtime.js";
import type {
  Stage2AgentSlot,
  Stage2AgentTask,
  Stage2ReadManifest,
  Stage2RuntimeRegistryEntry,
  Stage2RuntimeRunRecord,
  Stage2RuntimeRunStatus,
} from "../types.js";

const MAX_SESSION_RUNS = 8;
const MAX_SESSION_PROMPT_BYTES = 1_000_000;

export interface AgentCapabilities {
  persistentSessions: boolean;
  structuredOutput: boolean;
  readOnlySandbox: boolean;
  workspaceWriteSandbox: boolean;
  streamingEvents: boolean;
  processCancellation: boolean;
}

export interface AgentRequest {
  task: Stage2AgentTask;
  projectRoot: string;
  runtimeRoot: string;
  prompt: string;
  schema: object;
  readManifest: Stage2ReadManifest;
  persistent: boolean;
  sandbox: "read-only" | "workspace-write";
  inputArtifactHashes: Record<string, string>;
  slot?: Stage2AgentSlot;
  workPackageId?: string;
  deadlineMs?: number;
  noEventTimeoutMs?: number;
}

export interface AgentInput extends AgentRequest {}

export interface AgentRun {
  runtimeRef: string;
  runId: string;
  output: unknown;
  events: string;
  externalSessionId?: string;
}

export interface AgentRunHandle {
  runId: string;
  runtimeRef: string;
  eventsPath: string;
  resultPath: string;
  startedAt: string;
  completion: Promise<AgentRun>;
}

export interface AgentRuntime {
  capabilities(): AgentCapabilities;
  start(request: AgentRequest): Promise<AgentRunHandle>;
  resume(runtimeRef: string, input: AgentInput): Promise<AgentRunHandle>;
  cancel(runtimeRefOrRunId: string): Promise<void>;
}

export interface CodexCliRuntimeOptions {
  executor?: Stage2AgentExecutor;
  now?: () => Date;
}

export class CodexCliRuntime implements AgentRuntime {
  readonly #registry: Record<string, Stage2RuntimeRegistryEntry>;
  readonly #runs: Record<string, Stage2RuntimeRunRecord>;
  readonly #executor: Stage2AgentExecutor;
  readonly #now: () => Date;

  constructor(
    registry: Record<string, Stage2RuntimeRegistryEntry>,
    runs: Record<string, Stage2RuntimeRunRecord>,
    options: CodexCliRuntimeOptions = {},
  ) {
    this.#registry = registry;
    this.#runs = runs;
    this.#executor = options.executor ?? defaultStage2AgentExecutor;
    this.#now = options.now ?? (() => new Date());
  }

  capabilities(): AgentCapabilities {
    return {
      persistentSessions: true,
      structuredOutput: true,
      readOnlySandbox: true,
      workspaceWriteSandbox: true,
      streamingEvents: true,
      processCancellation: true,
    };
  }

  async start(request: AgentRequest): Promise<AgentRunHandle> {
    const runtimeRef = `runtime_${sha256(`${request.task}:${request.runtimeRoot}`).slice(0, 24)}`;
    if (this.#registry[runtimeRef] !== undefined) {
      throw new Error(`Runtime reference already exists: ${runtimeRef}`);
    }
    const timestamp = this.#now().toISOString();
    this.#registry[runtimeRef] = {
      runtimeRef,
      provider: "codex-cli",
      phase: stage2TaskPhase(request.task),
      status: "idle",
      runCount: 0,
      cumulativePromptBytes: 0,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    return this.#launch(runtimeRef, request, undefined);
  }

  async resume(runtimeRef: string, input: AgentInput): Promise<AgentRunHandle> {
    const entry = this.#registry[runtimeRef];
    if (entry === undefined) {
      throw new Error(`Unknown runtimeRef: ${runtimeRef}`);
    }
    if (
      entry.externalSessionId === undefined
      || entry.phase !== stage2TaskPhase(input.task)
      || entry.runCount >= MAX_SESSION_RUNS
      || entry.cumulativePromptBytes + Buffer.byteLength(input.prompt, "utf8") > MAX_SESSION_PROMPT_BYTES
    ) {
      entry.status = "idle";
      entry.updatedAt = this.#now().toISOString();
      return this.start(input);
    }
    return this.#launch(runtimeRef, input, entry.externalSessionId);
  }

  async cancel(runtimeRefOrRunId: string): Promise<void> {
    const directRun = this.#runs[runtimeRefOrRunId];
    const session = this.#registry[runtimeRefOrRunId];
    const runId = directRun?.runId ?? session?.latestRunId;
    if (runId === undefined) {
      throw new Error(`Unknown or idle Stage2 runtime: ${runtimeRefOrRunId}`);
    }
    await cancelStage2AgentRun(runId);
    const run = this.#runs[runId];
    if (run !== undefined) {
      setRunStatus(run, "cancelled", this.#now(), "Cancelled by Harness");
    }
    const runtime = this.#registry[run?.runtimeRef ?? runtimeRefOrRunId];
    if (runtime !== undefined) {
      runtime.status = "cancelled";
      runtime.updatedAt = this.#now().toISOString();
    }
  }

  async #launch(
    runtimeRef: string,
    request: AgentRequest,
    sessionId: string | undefined,
  ): Promise<AgentRunHandle> {
    const entry = this.#registry[runtimeRef]!;
    const runId = basename(request.runtimeRoot);
    if (this.#runs[runId] !== undefined) {
      throw new Error(`Runtime run already exists: ${runId}`);
    }
    const startedAt = this.#now().toISOString();
    const record: Stage2RuntimeRunRecord = {
      runId,
      runtimeRef,
      task: request.task,
      ...(request.slot === undefined ? {} : { slot: request.slot }),
      ...(request.workPackageId === undefined ? {} : { workPackageId: request.workPackageId }),
      status: "queued",
      promptDigest: sha256(request.prompt),
      inputArtifactHashes: { ...request.inputArtifactHashes },
      outputArtifactHashes: {},
      toolPolicy: request.sandbox,
      runtimePath: request.runtimeRoot,
      startedAt,
      lastEventAt: startedAt,
      deadlineAt: new Date(
        this.#now().getTime() + (request.deadlineMs ?? 1_800_000),
      ).toISOString(),
      noEventTimeoutMs: request.noEventTimeoutMs ?? 600_000,
      eventCount: 0,
    };
    this.#runs[runId] = record;
    entry.latestRunId = runId;
    entry.runCount += 1;
    entry.cumulativePromptBytes += Buffer.byteLength(request.prompt, "utf8");
    entry.status = "active";
    entry.updatedAt = startedAt;

    const completion = this.#execute(runtimeRef, request, sessionId, record);
    return {
      runId,
      runtimeRef,
      eventsPath: `${request.runtimeRoot}/codex.jsonl`,
      resultPath: `${request.runtimeRoot}/result.json`,
      startedAt,
      completion,
    };
  }

  async #execute(
    runtimeRef: string,
    request: AgentRequest,
    sessionId: string | undefined,
    record: Stage2RuntimeRunRecord,
  ): Promise<AgentRun> {
    const entry = this.#registry[runtimeRef]!;
    const onEvent = (event: Stage2AgentStreamEvent): void => {
      record.status = "running";
      record.lastEventAt = event.at;
      record.eventCount += 1;
      if (event.pid !== undefined) {
        record.pid = event.pid;
      }
    };
    let response: Stage2AgentResponse;
    try {
      response = await this.#executor({
        task: request.task,
        projectRoot: request.projectRoot,
        runtimeRoot: request.runtimeRoot,
        runId: record.runId,
        runtimeRef,
        ...(request.slot === undefined ? {} : { slot: request.slot }),
        ...(request.workPackageId === undefined ? {} : { workPackageId: request.workPackageId }),
        prompt: request.prompt,
        schema: request.schema,
        readManifest: request.readManifest,
        persistent: request.persistent,
        sandbox: request.sandbox,
        ...(request.deadlineMs === undefined ? {} : { deadlineMs: request.deadlineMs }),
        ...(request.noEventTimeoutMs === undefined
          ? {}
          : { noEventTimeoutMs: request.noEventTimeoutMs }),
        ...(sessionId === undefined ? {} : { sessionId }),
        onEvent,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setRunStatus(
        record,
        record.status === "cancelled" ? "cancelled" : "failed",
        this.#now(),
        message,
      );
      entry.status = record.status === "cancelled" ? "cancelled" : "failed";
      entry.updatedAt = this.#now().toISOString();
      throw error;
    }
    if (response.threadId !== undefined) {
      entry.externalSessionId = response.threadId;
    }
    record.outputArtifactHashes = {
      result: sha256(JSON.stringify(response.output)),
      events: sha256(response.events),
    };
    record.status = "model_completed";
    record.completedAt = this.#now().toISOString();
    entry.status = "idle";
    entry.updatedAt = record.completedAt;
    return {
      runtimeRef,
      runId: record.runId,
      output: response.output,
      events: response.events,
      ...(entry.externalSessionId === undefined
        ? {}
        : { externalSessionId: entry.externalSessionId }),
    };
  }
}

export function setRunStatus(
  record: Stage2RuntimeRunRecord,
  status: Stage2RuntimeRunStatus,
  now: Date,
  error?: string,
): void {
  record.status = status;
  if (status !== "queued" && status !== "running") {
    record.completedAt = now.toISOString();
  }
  if (error === undefined) {
    delete record.error;
  } else {
    record.error = error;
  }
}

export function stage2TaskPhase(task: Stage2AgentTask): Stage2RuntimeRegistryEntry["phase"] {
  if (task === "system_design_draft" || task === "system_design_review") {
    return "system_design";
  }
  if (
    task === "package_static_review"
    || task === "package_verification"
    || task === "independent_static_review"
    || task === "independent_verification"
  ) {
    return "verification";
  }
  if (
    task === "package_design"
    || task === "package_design_patch"
    || task === "package_implementation"
    || task === "shadow_design"
    || task === "active_implementation"
  ) {
    return "package";
  }
  return "legacy";
}
