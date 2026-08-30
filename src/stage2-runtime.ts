import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { cp, mkdir, readFile, readdir } from "node:fs/promises";
import { basename, dirname, relative, resolve } from "node:path";
import { atomicWriteText, pathExists, readText } from "./io.js";
import type { Stage2AgentTask } from "./types.js";

export interface Stage2AgentCall {
  task: Stage2AgentTask;
  projectRoot: string;
  runtimeRoot: string;
  prompt: string;
  schema: object;
  persistent: boolean;
  sandbox: "read-only" | "workspace-write";
  sessionId?: string;
}

export interface Stage2AgentResponse {
  output: unknown;
  events: string;
  threadId?: string;
}

export type Stage2AgentExecutor = (call: Stage2AgentCall) => Promise<Stage2AgentResponse>;

const GENERATED_DIRECTORIES = new Set([
  ".bloop",
  ".bsp",
  ".metals",
  ".runtime",
  "out",
  "target",
  "test_run_dir",
]);

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
  if (call.sessionId !== undefined) {
    return [
      "exec",
      "resume",
      "--ignore-user-config",
      "--ignore-rules",
      "--json",
      "--skip-git-repo-check",
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
    "--output-schema",
    schemaPath,
    "-o",
    outputPath,
    "-",
  ];
}

export const defaultStage2AgentExecutor: Stage2AgentExecutor = async (
  call,
): Promise<Stage2AgentResponse> => {
  const schemaPath = resolve(call.runtimeRoot, "schema.json");
  const promptPath = resolve(call.runtimeRoot, "prompt.txt");
  const outputPath = resolve(call.runtimeRoot, "result.json");
  const eventsPath = resolve(call.runtimeRoot, "codex.jsonl");
  await atomicWriteText(schemaPath, `${JSON.stringify(call.schema, null, 2)}\n`);
  await atomicWriteText(promptPath, call.prompt);

  const args = buildStage2CodexArguments(call);
  const result = await spawnWithInput(
    "codex",
    args,
    call.prompt,
    1_800_000,
  );
  const events = `${result.stdout}${result.stderr}`;
  await atomicWriteText(eventsPath, events);
  if (result.exitCode !== 0) {
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
  return {
    output,
    events,
    ...(threadId === undefined ? {} : { threadId }),
  };
};

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

async function spawnWithInput(
  command: string,
  args: string[],
  input: string,
  timeoutMs: number,
): Promise<{ exitCode: number | null; stdout: string; stderr: string }> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, {
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"],
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let settled = false;
    const timeout = setTimeout(() => {
      child.kill();
      if (!settled) {
        settled = true;
        reject(new Error(`Stage2 Agent timed out after ${String(timeoutMs)} ms`));
      }
    }, timeoutMs);
    child.stdout.on("data", (chunk: Buffer) => stdout.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));
    child.on("error", (error) => {
      clearTimeout(timeout);
      if (!settled) {
        settled = true;
        reject(new Error(`Failed to start Codex CLI: ${error.message}`));
      }
    });
    child.on("close", (code) => {
      clearTimeout(timeout);
      if (!settled) {
        settled = true;
        resolvePromise({
          exitCode: code,
          stdout: Buffer.concat(stdout).toString("utf8"),
          stderr: Buffer.concat(stderr).toString("utf8"),
        });
      }
    });
    child.stdin.end(input, "utf8");
  });
}
