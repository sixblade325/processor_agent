import { spawn, type ChildProcess } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { appendFile, cp, mkdir, readFile, readdir } from "node:fs/promises";
import { basename, dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { atomicWriteText, pathExists, readText } from "./io.js";
import type {
  Stage2AgentSlot,
  Stage2AgentTask,
  Stage2ReadManifest,
  Stage2RuntimeRunStatus,
} from "./types.js";

export interface Stage2AgentStreamEvent {
  at: string;
  stream: "stdout" | "stderr" | "process";
  bytes: number;
  pid?: number;
}

export interface Stage2AgentCall {
  task: Stage2AgentTask;
  projectRoot: string;
  runtimeRoot: string;
  runId?: string;
  runtimeRef?: string;
  slot?: Stage2AgentSlot;
  workPackageId?: string;
  prompt: string;
  schema: object;
  readManifest?: Stage2ReadManifest;
  persistent: boolean;
  sandbox: "read-only" | "workspace-write";
  sessionId?: string;
  deadlineMs?: number;
  noEventTimeoutMs?: number;
  onEvent?: (event: Stage2AgentStreamEvent) => void;
}

export interface Stage2AgentResponse {
  output: unknown;
  events: string;
  threadId?: string;
}

export type Stage2AgentExecutor = (call: Stage2AgentCall) => Promise<Stage2AgentResponse>;

export interface Stage2DiscoveredRunStatus {
  runId: string;
  runtimeRef: string;
  task: Stage2AgentTask;
  status: Stage2RuntimeRunStatus;
  runtimePath: string;
  slot?: Stage2AgentSlot;
  workPackageId?: string;
  startedAt?: string;
  lastEventAt?: string;
  deadlineAt?: string;
  noEventTimeoutMs?: number;
  completedAt?: string;
  pid?: number;
  eventCount: number;
}

const GENERATED_DIRECTORIES = new Set([
  ".bloop",
  ".bsp",
  ".metals",
  ".runtime",
  "out",
  "target",
  "test_run_dir",
]);

const ACTIVE_RUNS = new Map<string, ChildProcess>();

export async function createStage2RunDirectory(
  projectRoot: string,
  moduleId: string,
  task: Stage2AgentTask,
): Promise<string> {
  const runId = `${new Date().toISOString().replace(/[:.]/gu, "-")}-${randomUUID()}`;
  const path = resolve(
    dirname(projectRoot),
    ".runtime",
    "processor_agent",
    basename(projectRoot),
    "stage2",
    moduleId,
    task,
    runId,
  );
  await mkdir(path, { recursive: true });
  return path;
}

export function buildStage2CodexArguments(call: Stage2AgentCall): string[] {
  const outputPath = resolve(call.runtimeRoot, "result.json");
  const schemaPath = resolve(call.runtimeRoot, "schema.json");
  const manifestPath = call.readManifest === undefined
    ? undefined
    : resolve(call.runtimeRoot, "read-manifest.json");
  const projectReaderArgs = stage2ProjectReaderArguments(call.projectRoot, manifestPath);
  if (call.sessionId !== undefined) {
    return [
      "exec",
      "resume",
      "--ignore-user-config",
      "--ignore-rules",
      "--json",
      "--skip-git-repo-check",
      ...projectReaderArgs,
      "--output-schema",
      schemaPath,
      "-o",
      outputPath,
      call.sessionId,
      "-",
    ];
  }

  return [
    "exec",
    "--ignore-user-config",
    "--ignore-rules",
    ...(call.persistent ? [] : ["--ephemeral"]),
    "--json",
    "--skip-git-repo-check",
    "--sandbox",
    call.sandbox,
    "-C",
    call.projectRoot,
    ...projectReaderArgs,
    "--output-schema",
    schemaPath,
    "-o",
    outputPath,
    "-",
  ];
}

function stage2ProjectReaderArguments(
  projectRoot: string,
  manifestPath: string | undefined,
): string[] {
  const serverPath = fileURLToPath(new URL("./project-reader-mcp.js", import.meta.url));
  return [
    "-c",
    `mcp_servers.processor_project.command=${JSON.stringify(process.execPath)}`,
    "-c",
    `mcp_servers.processor_project.args=${JSON.stringify([
      serverPath,
      resolve(projectRoot),
      ...(manifestPath === undefined ? [] : [resolve(manifestPath)]),
    ])}`,
  ];
}

export const defaultStage2AgentExecutor: Stage2AgentExecutor = async (
  call,
): Promise<Stage2AgentResponse> => {
  const schemaPath = resolve(call.runtimeRoot, "schema.json");
  const promptPath = resolve(call.runtimeRoot, "prompt.txt");
  const outputPath = resolve(call.runtimeRoot, "result.json");
  const eventsPath = resolve(call.runtimeRoot, "codex.jsonl");
  const manifestPath = resolve(call.runtimeRoot, "read-manifest.json");
  const statusPath = resolve(call.runtimeRoot, "run-status.json");
  await atomicWriteText(schemaPath, `${JSON.stringify(call.schema, null, 2)}\n`);
  await atomicWriteText(promptPath, call.prompt);
  if (call.readManifest !== undefined) {
    await atomicWriteText(manifestPath, `${JSON.stringify(call.readManifest, null, 2)}\n`);
  }
  await atomicWriteText(eventsPath, "");
  await writeRunStatus(statusPath, {
    runId: call.runId ?? basename(call.runtimeRoot),
    runtimeRef: call.runtimeRef ?? "unregistered",
    task: call.task,
    ...(call.slot === undefined ? {} : { slot: call.slot }),
    ...(call.workPackageId === undefined ? {} : { workPackageId: call.workPackageId }),
    status: "queued",
    startedAt: new Date().toISOString(),
    lastEventAt: new Date().toISOString(),
    deadlineAt: new Date(Date.now() + (call.deadlineMs ?? 1_800_000)).toISOString(),
    noEventTimeoutMs: call.noEventTimeoutMs ?? 600_000,
    eventCount: 0,
  });

  const runId = call.runId ?? basename(call.runtimeRoot);
  const args = buildStage2CodexArguments(call);
  let eventCount = 0;
  let statusWrites = Promise.resolve();
  const updateEvent = (event: Stage2AgentStreamEvent): void => {
    eventCount += 1;
    call.onEvent?.(event);
    statusWrites = statusWrites.then(() => writeRunStatus(statusPath, {
      runId,
      task: call.task,
      status: "running",
      startedAt: undefined,
      lastEventAt: event.at,
      eventCount,
      ...(event.pid === undefined ? {} : { pid: event.pid }),
    }));
  };
  let result: Stage2ProcessResult;
  try {
    result = await spawnStreamingWithInput(
      "codex",
      args,
      call.prompt,
      runId,
      eventsPath,
      call.deadlineMs ?? 1_800_000,
      call.noEventTimeoutMs ?? 600_000,
      updateEvent,
    );
  } catch (error) {
    await statusWrites;
    const completedAt = new Date().toISOString();
    await writeRunStatus(statusPath, {
      runId,
      task: call.task,
      status: "failed",
      lastEventAt: completedAt,
      completedAt,
      eventCount,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
  await statusWrites;
  const events = await readText(eventsPath);
  if (result.exitCode !== 0) {
    await writeRunStatus(statusPath, {
      runId,
      task: call.task,
      status: result.cancelled ? "cancelled" : "failed",
      lastEventAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
      eventCount,
      ...(result.pid === undefined ? {} : { pid: result.pid }),
    });
    if (/401 Unauthorized|Missing bearer or basic authentication|not logged in/iu.test(events)) {
      throw new Error(`Codex CLI authentication failed; run codex login; events: ${eventsPath}`);
    }
    throw new Error(`Codex CLI exited with ${String(result.exitCode)}; events: ${eventsPath}`);
  }
  if (!(await pathExists(outputPath))) {
    throw new Error(`Codex CLI did not create Stage2 output: ${outputPath}`);
  }
  const output = parseJsonOutput(await readText(outputPath), outputPath);
  const threadId = extractThreadId(events);
  await writeRunStatus(statusPath, {
    runId,
    task: call.task,
    status: "model_completed",
    lastEventAt: new Date().toISOString(),
    completedAt: new Date().toISOString(),
    eventCount,
    ...(result.pid === undefined ? {} : { pid: result.pid }),
  });
  return {
    output,
    events,
    ...(threadId === undefined ? {} : { threadId }),
  };
};

export async function discoverStage2RunStatuses(
  projectRoot: string,
): Promise<Stage2DiscoveredRunStatus[]> {
  const root = resolve(
    dirname(projectRoot),
    ".runtime",
    "processor_agent",
    basename(projectRoot),
    "stage2",
  );
  if (!(await pathExists(root))) {
    return [];
  }
  const paths: string[] = [];
  await collectStatusFiles(root, paths);
  const statuses: Stage2DiscoveredRunStatus[] = [];
  for (const path of paths) {
    try {
      const value = JSON.parse(await readText(path)) as Record<string, unknown>;
      if (
        typeof value.runId !== "string"
        || typeof value.runtimeRef !== "string"
        || typeof value.task !== "string"
        || !isRunStatus(value.status)
      ) {
        continue;
      }
      const pid = typeof value.pid === "number" ? value.pid : undefined;
      const startedAt = typeof value.startedAt === "string" ? value.startedAt : undefined;
      const queuedWithoutProcessExpired = value.status === "queued"
        && pid === undefined
        && startedAt !== undefined
        && Date.now() - Date.parse(startedAt) > 30_000;
      const status = queuedWithoutProcessExpired
        || ((value.status === "running" || value.status === "queued")
          && pid !== undefined
          && !processExists(pid))
        ? "orphaned"
        : value.status;
      statuses.push({
        runId: value.runId,
        runtimeRef: value.runtimeRef,
        task: value.task as Stage2AgentTask,
        status,
        runtimePath: dirname(path),
        ...(value.slot === "A" || value.slot === "B" ? { slot: value.slot } : {}),
        ...(typeof value.workPackageId === "string"
          ? { workPackageId: value.workPackageId }
          : {}),
        ...(startedAt === undefined ? {} : { startedAt }),
        ...(typeof value.lastEventAt === "string" ? { lastEventAt: value.lastEventAt } : {}),
        ...(typeof value.deadlineAt === "string" ? { deadlineAt: value.deadlineAt } : {}),
        ...(typeof value.noEventTimeoutMs === "number"
          ? { noEventTimeoutMs: value.noEventTimeoutMs }
          : {}),
        ...(typeof value.completedAt === "string" ? { completedAt: value.completedAt } : {}),
        ...(pid === undefined ? {} : { pid }),
        eventCount: typeof value.eventCount === "number" ? value.eventCount : 0,
      });
    } catch {
      continue;
    }
  }
  return statuses;
}

async function collectStatusFiles(directory: string, output: string[]): Promise<void> {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      await collectStatusFiles(path, output);
    } else if (entry.isFile() && entry.name === "run-status.json") {
      output.push(path);
    }
  }
}

function isRunStatus(value: unknown): value is Stage2RuntimeRunStatus {
  return new Set([
    "queued",
    "running",
    "model_completed",
    "validation_failed",
    "applied",
    "failed",
    "cancelled",
    "orphaned",
  ]).has(String(value));
}

function processExists(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export async function createVerificationWorkspace(
  projectRoot: string,
  runtimeRoot: string,
): Promise<string> {
  const destination = resolve(runtimeRoot, "verification-workspace");
  await cp(projectRoot, destination, {
    recursive: true,
    filter: (source) => {
      const rel = relative(projectRoot, source);
      if (rel === "") {
        return true;
      }
      const normalized = rel.replace(/\\/gu, "/");
      return !isExcludedVerificationPath(normalized);
    },
  });
  return destination;
}

export async function snapshotVerificationInputs(root: string): Promise<Record<string, string>> {
  const snapshot: Record<string, string> = {};
  await snapshotDirectory(root, root, snapshot);
  return snapshot;
}

export async function assertVerificationInputsUnchanged(
  root: string,
  expected: Record<string, string>,
): Promise<void> {
  const actual = await snapshotVerificationInputs(root);
  const paths = [...new Set([...Object.keys(expected), ...Object.keys(actual)])]
    .sort((left, right) => left.localeCompare(right));
  const changed = paths.filter((path) => expected[path] !== actual[path]);
  if (changed.length > 0) {
    throw new Error(`Independent Verification Worker modified protected inputs: ${changed.join(", ")}`);
  }
}

async function snapshotDirectory(
  root: string,
  directory: string,
  snapshot: Record<string, string>,
): Promise<void> {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name);
    const rel = relative(root, path).replace(/\\/gu, "/");
    if (isExcludedVerificationPath(rel)) {
      continue;
    }
    if (entry.isDirectory()) {
      await snapshotDirectory(root, path, snapshot);
    } else if (entry.isFile()) {
      snapshot[rel] = createHash("sha256").update(await readFile(path)).digest("hex");
    }
  }
}

function isExcludedVerificationPath(path: string): boolean {
  const segments = path.split("/");
  return segments.some((segment) => segment === ".git" || segment === ".assistant" || GENERATED_DIRECTORIES.has(segment));
}

function parseJsonOutput(content: string, path: string): unknown {
  const trimmed = content.trim();
  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/u.exec(trimmed);
    if (fenced?.[1] !== undefined) {
      try {
        return JSON.parse(fenced[1]) as unknown;
      } catch {
        // Fall through to the actionable error below.
      }
    }
    throw new Error(`Stage2 Agent returned invalid JSON: ${path}`);
  }
}

function extractThreadId(events: string): string | undefined {
  for (const line of events.split(/\r?\n/u)) {
    if (line.trim() === "") {
      continue;
    }
    try {
      const event = JSON.parse(line) as Record<string, unknown>;
      if (event.type === "thread.started" && typeof event.thread_id === "string") {
        return event.thread_id;
      }
    } catch {
      continue;
    }
  }
  return undefined;
}

interface Stage2ProcessResult {
  exitCode: number | null;
  pid?: number;
  cancelled: boolean;
}

export async function cancelStage2AgentRun(runId: string): Promise<void> {
  const child = ACTIVE_RUNS.get(runId);
  if (child === undefined || child.pid === undefined) {
    return;
  }
  await terminateProcessTree(child);
}

export async function cancelDiscoveredStage2AgentRun(
  projectRoot: string,
  runtimeRefOrRunId: string,
): Promise<Stage2DiscoveredRunStatus> {
  const candidates = (await discoverStage2RunStatuses(projectRoot))
    .filter((status) =>
      status.runId === runtimeRefOrRunId || status.runtimeRef === runtimeRefOrRunId
    )
    .sort((left, right) => (right.startedAt ?? "").localeCompare(left.startedAt ?? ""));
  const status = candidates.find((candidate) =>
    candidate.status === "queued"
    || candidate.status === "running"
    || candidate.status === "orphaned"
  );
  if (status === undefined) {
    throw new Error(`No cancellable Stage2 run: ${runtimeRefOrRunId}`);
  }
  const active = ACTIVE_RUNS.get(status.runId);
  if (active !== undefined) {
    await terminateProcessTree(active);
  } else if (status.pid !== undefined && processExists(status.pid)) {
    await terminateProcessId(status.pid);
  }
  const completedAt = new Date().toISOString();
  await writeRunStatus(resolve(status.runtimePath, "run-status.json"), {
    runId: status.runId,
    runtimeRef: status.runtimeRef,
    task: status.task,
    status: "cancelled",
    lastEventAt: completedAt,
    completedAt,
    eventCount: status.eventCount,
    ...(status.pid === undefined ? {} : { pid: status.pid }),
  });
  return { ...status, status: "cancelled", lastEventAt: completedAt, completedAt };
}

async function spawnStreamingWithInput(
  command: string,
  args: string[],
  input: string,
  runId: string,
  eventsPath: string,
  deadlineMs: number,
  noEventTimeoutMs: number,
  onEvent: (event: Stage2AgentStreamEvent) => void,
): Promise<Stage2ProcessResult> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, {
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"],
    });
    ACTIVE_RUNS.set(runId, child);
    let settled = false;
    let cancelled = false;
    let lastEventAt = Date.now();
    let appendChain = Promise.resolve();
    const append = (stream: "stdout" | "stderr", chunk: Buffer): void => {
      const at = new Date().toISOString();
      lastEventAt = Date.now();
      appendChain = appendChain.then(() => appendFile(eventsPath, chunk));
      onEvent({
        at,
        stream,
        bytes: chunk.byteLength,
        ...(child.pid === undefined ? {} : { pid: child.pid }),
      });
    };
    const deadline = setTimeout(() => {
      cancelled = true;
      void terminateProcessTree(child).finally(() => {
        if (!settled) {
          settled = true;
          ACTIVE_RUNS.delete(runId);
          reject(new Error(`Stage2 Agent exceeded deadline ${String(deadlineMs)} ms`));
        }
      });
    }, deadlineMs);
    const noEventTimer = setInterval(() => {
      if (Date.now() - lastEventAt <= noEventTimeoutMs || settled) {
        return;
      }
      cancelled = true;
      void terminateProcessTree(child).finally(() => {
        if (!settled) {
          settled = true;
          clearTimeout(deadline);
          clearInterval(noEventTimer);
          ACTIVE_RUNS.delete(runId);
          reject(new Error(`Stage2 Agent produced no events for ${String(noEventTimeoutMs)} ms`));
        }
      });
    }, Math.min(5_000, Math.max(250, Math.floor(noEventTimeoutMs / 4))));
    child.stdout.on("data", (chunk: Buffer) => append("stdout", chunk));
    child.stderr.on("data", (chunk: Buffer) => append("stderr", chunk));
    onEvent({
      at: new Date().toISOString(),
      stream: "process",
      bytes: 0,
      ...(child.pid === undefined ? {} : { pid: child.pid }),
    });
    child.on("error", (error) => {
      clearTimeout(deadline);
      clearInterval(noEventTimer);
      ACTIVE_RUNS.delete(runId);
      if (!settled) {
        settled = true;
        reject(new Error(`Failed to start Codex CLI: ${error.message}`));
      }
    });
    child.on("close", (code, signal) => {
      clearTimeout(deadline);
      clearInterval(noEventTimer);
      ACTIVE_RUNS.delete(runId);
      if (!settled) {
        void appendChain.then(() => {
          if (settled) {
            return;
          }
          settled = true;
          resolvePromise({
            exitCode: code,
            ...(child.pid === undefined ? {} : { pid: child.pid }),
            cancelled: cancelled || signal !== null,
          });
        }, reject);
      }
    });
    child.stdin.end(input, "utf8");
  });
}

async function terminateProcessTree(child: ChildProcess): Promise<void> {
  if (child.pid === undefined || child.exitCode !== null) {
    return;
  }
  await terminateProcessId(child.pid, child);
}

async function terminateProcessId(pid: number, child?: ChildProcess): Promise<void> {
  if (process.platform !== "win32") {
    process.kill(pid, "SIGTERM");
    return;
  }
  await new Promise<void>((resolvePromise) => {
    const killer = spawn("taskkill", ["/PID", String(pid), "/T", "/F"], {
      windowsHide: true,
      stdio: "ignore",
    });
    killer.once("close", () => resolvePromise());
    killer.once("error", () => {
      child?.kill();
      resolvePromise();
    });
  });
}

async function writeRunStatus(
  path: string,
  patch: Record<string, unknown>,
): Promise<void> {
  let current: Record<string, unknown> = {};
  if (await pathExists(path)) {
    try {
      current = JSON.parse(await readText(path)) as Record<string, unknown>;
    } catch {
      current = {};
    }
  }
  const clean = Object.fromEntries(
    Object.entries(patch).filter(([, value]) => value !== undefined),
  );
  await atomicWriteText(path, `${JSON.stringify({ ...current, ...clean }, null, 2)}\n`);
}
