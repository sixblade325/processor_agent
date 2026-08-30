import { readFile, readdir, realpath, stat } from "node:fs/promises";
import { extname, isAbsolute, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { resolveWithin } from "./io.js";

const DEFAULT_LIST_LIMIT = 1_000;
const MAX_LIST_LIMIT = 5_000;
const MAX_READ_LINES = 500;
const MAX_FILE_BYTES = 2 * 1024 * 1024;
const MAX_SEARCH_BYTES = 8 * 1024 * 1024;
const DEFAULT_SEARCH_RESULTS = 100;
const MAX_SEARCH_RESULTS = 500;

const EXCLUDED_DIRECTORIES = new Set([
  ".bloop",
  ".git",
  ".metals",
  ".runtime",
  ".scala-build",
  "build",
  "dist",
  "generated",
  "node_modules",
  "out",
  "target",
]);

const TEXT_EXTENSIONS = new Set([
  ".c",
  ".cc",
  ".circt",
  ".conf",
  ".cpp",
  ".fir",
  ".h",
  ".hpp",
  ".java",
  ".js",
  ".json",
  ".md",
  ".py",
  ".s",
  ".sbt",
  ".scala",
  ".sc",
  ".sh",
  ".sv",
  ".svh",
  ".tcl",
  ".toml",
  ".ts",
  ".tsx",
  ".txt",
  ".v",
  ".vh",
  ".xdc",
  ".yaml",
  ".yml",
]);

export const PROJECT_READER_TOOLS = [
  {
    name: "list_files",
    description: "List readable project files using paths relative to the project root.",
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        path: { type: "string" },
        limit: { type: "integer", minimum: 1, maximum: MAX_LIST_LIMIT },
      },
    },
  },
  {
    name: "read_file",
    description: "Read a bounded line range from one text file under the project root.",
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["path"],
      properties: {
        path: { type: "string" },
        startLine: { type: "integer", minimum: 1 },
        endLine: { type: "integer", minimum: 1 },
      },
    },
  },
  {
    name: "search_text",
    description: "Search bounded project text files and return path, line number, and matching line.",
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["pattern"],
      properties: {
        pattern: { type: "string", minLength: 1, maxLength: 256 },
        path: { type: "string" },
        isRegex: { type: "boolean" },
        maxResults: { type: "integer", minimum: 1, maximum: MAX_SEARCH_RESULTS },
      },
    },
  },
] as const;

interface WalkResult {
  files: string[];
  truncated: boolean;
}

interface JsonRpcRequest {
  jsonrpc: "2.0";
  id?: number | string | null;
  method: string;
  params?: unknown;
}

export async function listProjectFiles(
  projectRoot: string,
  path = ".",
  limit = DEFAULT_LIST_LIMIT,
): Promise<string> {
  const boundedLimit = boundedInteger(limit, 1, MAX_LIST_LIMIT, "limit");
  const result = await walkProjectFiles(projectRoot, path, boundedLimit);
  const lines = [...result.files];
  if (result.truncated) {
    lines.push(`[truncated after ${boundedLimit} files]`);
  }
  return lines.join("\n");
}

export async function readProjectFile(
  projectRoot: string,
  path: string,
  startLine = 1,
  endLine?: number,
): Promise<string> {
  const absolute = resolveProjectPath(projectRoot, path);
  await assertRealPathWithinProject(projectRoot, absolute);
  const metadata = await stat(absolute);
  if (!metadata.isFile()) {
    throw new Error(`Project path is not a file: ${path}`);
  }
  if (metadata.size > MAX_FILE_BYTES) {
    throw new Error(`Project file exceeds ${MAX_FILE_BYTES} bytes: ${path}`);
  }
  const content = await readTextFile(absolute, path);
  const lines = content.split(/\r?\n/u);
  const first = boundedInteger(startLine, 1, Math.max(lines.length, 1), "startLine");
  const requestedEnd = endLine ?? Math.min(first + MAX_READ_LINES - 1, lines.length);
  if (!Number.isInteger(requestedEnd) || requestedEnd < first) {
    throw new Error("endLine must be an integer greater than or equal to startLine");
  }
  const last = Math.min(requestedEnd, first + MAX_READ_LINES - 1, lines.length);
  return lines
    .slice(first - 1, last)
    .map((line, index) => `${first + index}: ${line}`)
    .join("\n");
}

export async function searchProjectText(
  projectRoot: string,
  pattern: string,
  options: { path?: string; isRegex?: boolean; maxResults?: number } = {},
): Promise<string> {
  const normalizedPattern = pattern.trim();
  if (normalizedPattern === "" || normalizedPattern.length > 256) {
    throw new Error("Search pattern must contain between 1 and 256 characters");
  }
  const maxResults = boundedInteger(
    options.maxResults ?? DEFAULT_SEARCH_RESULTS,
    1,
    MAX_SEARCH_RESULTS,
    "maxResults",
  );
  const matcher = options.isRegex === true
    ? new RegExp(normalizedPattern, "iu")
    : undefined;
  const walk = await walkProjectFiles(projectRoot, options.path ?? ".", MAX_LIST_LIMIT);
  const matches: string[] = [];
  let scannedBytes = 0;
  let byteLimitReached = false;

  for (const path of walk.files) {
    if (!isSearchableTextPath(path)) {
      continue;
    }
    const absolute = resolveProjectPath(projectRoot, path);
    const metadata = await stat(absolute);
    if (metadata.size > MAX_FILE_BYTES || scannedBytes + metadata.size > MAX_SEARCH_BYTES) {
      byteLimitReached = scannedBytes + metadata.size > MAX_SEARCH_BYTES;
      if (byteLimitReached) {
        break;
      }
      continue;
    }
    scannedBytes += metadata.size;
    const content = await readTextFile(absolute, path);
    const lines = content.split(/\r?\n/u);
    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index] ?? "";
      const matched = matcher === undefined
        ? line.toLocaleLowerCase().includes(normalizedPattern.toLocaleLowerCase())
        : matcher.test(line);
      if (!matched) {
        continue;
      }
      matches.push(`${path}:${index + 1}:${line.slice(0, 500)}`);
      if (matches.length >= maxResults) {
        matches.push(`[truncated after ${maxResults} matches]`);
        return matches.join("\n");
      }
    }
  }

  if (walk.truncated) {
    matches.push(`[file index truncated after ${MAX_LIST_LIMIT} files]`);
  }
  if (byteLimitReached) {
    matches.push(`[search truncated after ${MAX_SEARCH_BYTES} bytes]`);
  }
  return matches.length === 0 ? "No matches." : matches.join("\n");
}

async function walkProjectFiles(
  projectRoot: string,
  path: string,
  limit: number,
): Promise<WalkResult> {
  const absoluteRoot = resolve(projectRoot);
  const start = resolveProjectPath(absoluteRoot, path);
  await assertRealPathWithinProject(absoluteRoot, start);
  const metadata = await stat(start);
  if (!metadata.isDirectory()) {
    throw new Error(`Project path is not a directory: ${path}`);
  }
  const directories = [start];
  const files: string[] = [];

  while (directories.length > 0) {
    const directory = directories.pop();
    if (directory === undefined) {
      break;
    }
    const entries = (await readdir(directory, { withFileTypes: true }))
      .sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      if (entry.isSymbolicLink()) {
        continue;
      }
      const absolute = resolve(directory, entry.name);
      if (entry.isDirectory()) {
        if (!EXCLUDED_DIRECTORIES.has(entry.name)) {
          directories.push(absolute);
        }
        continue;
      }
      if (!entry.isFile()) {
        continue;
      }
      files.push(toProjectPath(absoluteRoot, absolute));
      if (files.length >= limit) {
        return { files: files.sort(), truncated: true };
      }
    }
  }
  return { files: files.sort(), truncated: false };
}

function resolveProjectPath(projectRoot: string, path: string): string {
  const normalized = path.trim() === "" ? "." : path.trim();
  if (normalized.split(/[\\/]+/u).some((segment) => EXCLUDED_DIRECTORIES.has(segment))) {
    throw new Error(`Project path is excluded from research: ${path}`);
  }
  return resolveWithin(resolve(projectRoot), normalized);
}

async function assertRealPathWithinProject(projectRoot: string, target: string): Promise<void> {
  const realRoot = await realpath(resolve(projectRoot));
  const realTarget = await realpath(target);
  const path = relative(realRoot, realTarget);
  if (path.startsWith("..") || isAbsolute(path)) {
    throw new Error("Project path resolves outside the project root");
  }
}

function toProjectPath(projectRoot: string, absolute: string): string {
  return relative(projectRoot, absolute).replace(/\\/gu, "/");
}

function isSearchableTextPath(path: string): boolean {
  const extension = extname(path).toLowerCase();
  return TEXT_EXTENSIONS.has(extension)
    || path.endsWith("/Makefile")
    || path === "Makefile";
}

async function readTextFile(absolute: string, displayPath: string): Promise<string> {
  const content = await readFile(absolute);
  if (content.includes(0)) {
    throw new Error(`Project file is binary: ${displayPath}`);
  }
  return content.toString("utf8");
}

function boundedInteger(value: number, minimum: number, maximum: number, label: string): number {
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${label} must be an integer between ${minimum} and ${maximum}`);
  }
  return value;
}

async function handleToolCall(projectRoot: string, params: unknown): Promise<object> {
  if (typeof params !== "object" || params === null || Array.isArray(params)) {
    throw new Error("tools/call params must be an object");
  }
  const value = params as { name?: unknown; arguments?: unknown };
  const args = typeof value.arguments === "object" && value.arguments !== null
    ? value.arguments as Record<string, unknown>
    : {};
  let text: string;
  switch (value.name) {
    case "list_files":
      text = await listProjectFiles(
        projectRoot,
        optionalString(args.path) ?? ".",
        optionalNumber(args.limit) ?? DEFAULT_LIST_LIMIT,
      );
      break;
    case "read_file":
      text = await readProjectFile(
        projectRoot,
        requiredString(args.path, "path"),
        optionalNumber(args.startLine) ?? 1,
        optionalNumber(args.endLine),
      );
      break;
    case "search_text": {
      const searchPath = optionalString(args.path);
      const maxResults = optionalNumber(args.maxResults);
      text = await searchProjectText(
        projectRoot,
        requiredString(args.pattern, "pattern"),
        {
          ...(searchPath === undefined ? {} : { path: searchPath }),
          ...(typeof args.isRegex !== "boolean" ? {} : { isRegex: args.isRegex }),
          ...(maxResults === undefined ? {} : { maxResults }),
        },
      );
      break;
    }
    default:
      throw new Error(`Unknown project reader tool: ${String(value.name)}`);
  }
  return { content: [{ type: "text", text }] };
}

function requiredString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${label} must be a non-empty string`);
  }
  return value;
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function optionalNumber(value: unknown): number | undefined {
  return typeof value === "number" ? value : undefined;
}

function sendResult(id: JsonRpcRequest["id"], result: unknown): void {
  process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", id, result })}\n`);
}

function sendError(id: JsonRpcRequest["id"], code: number, message: string): void {
  process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", id, error: { code, message } })}\n`);
}

async function handleRequest(projectRoot: string, request: JsonRpcRequest): Promise<void> {
  if (request.id === undefined) {
    return;
  }
  try {
    switch (request.method) {
      case "initialize": {
        const params = request.params as { protocolVersion?: unknown } | undefined;
        sendResult(request.id, {
          protocolVersion: typeof params?.protocolVersion === "string"
            ? params.protocolVersion
            : "2025-06-18",
          capabilities: { tools: {} },
          serverInfo: { name: "processor-agent-project-reader", version: "0.1.0" },
        });
        break;
      }
      case "ping":
        sendResult(request.id, {});
        break;
      case "tools/list":
        sendResult(request.id, { tools: PROJECT_READER_TOOLS });
        break;
      case "tools/call":
        sendResult(request.id, await handleToolCall(projectRoot, request.params));
        break;
      case "resources/list":
        sendResult(request.id, { resources: [] });
        break;
      case "resources/templates/list":
        sendResult(request.id, { resourceTemplates: [] });
        break;
      case "prompts/list":
        sendResult(request.id, { prompts: [] });
        break;
      default:
        sendError(request.id, -32601, `Method not found: ${request.method}`);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (request.method === "tools/call") {
      sendResult(request.id, { content: [{ type: "text", text: message }], isError: true });
      return;
    }
    sendError(request.id, -32603, message);
  }
}

async function runServer(projectRoot: string): Promise<void> {
  await stat(resolve(projectRoot));
  process.stdin.setEncoding("utf8");
  let buffered = "";
  for await (const chunk of process.stdin) {
    buffered += chunk;
    let newline = buffered.indexOf("\n");
    while (newline >= 0) {
      const line = buffered.slice(0, newline).trim();
      buffered = buffered.slice(newline + 1);
      if (line !== "") {
        const request = JSON.parse(line) as JsonRpcRequest;
        await handleRequest(projectRoot, request);
      }
      newline = buffered.indexOf("\n");
    }
  }
}

const invokedPath = process.argv[1] === undefined ? undefined : resolve(process.argv[1]);
if (invokedPath === fileURLToPath(import.meta.url)) {
  const projectRoot = process.argv[2];
  if (projectRoot === undefined) {
    process.stderr.write("Project root argument is required.\n");
    process.exitCode = 1;
  } else {
    runServer(projectRoot).catch((error: unknown) => {
      process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
      process.exitCode = 1;
    });
  }
}
