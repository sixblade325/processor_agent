import { createHash } from "node:crypto";
import { mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve } from "node:path";

export async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return false;
    }
    throw error;
  }
}

export async function readText(path: string): Promise<string> {
  return readFile(path, "utf8");
}

export function sha256(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

export function assertSafeRelativePath(path: string): void {
  if (isAbsolute(path) || path === "" || path.split(/[\\/]+/u).includes("..")) {
    throw new Error(`Unsafe relative path: ${path}`);
  }
}

export function resolveWithin(root: string, path: string): string {
  assertSafeRelativePath(path);
  const absoluteRoot = resolve(root);
  const target = resolve(absoluteRoot, path);
  const rel = relative(absoluteRoot, target);
  if (rel.startsWith("..") || isAbsolute(rel)) {
    throw new Error(`Path escapes project root: ${path}`);
  }
  return target;
}

export async function atomicWriteText(path: string, content: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.tmp-${process.pid}-${Date.now()}`;
  await writeFile(temporary, content, "utf8");
  await rename(temporary, path);
}

export async function writeNewOrSame(path: string, content: string): Promise<void> {
  if (await pathExists(path)) {
    const current = await readText(path);
    if (current !== content) {
      throw new Error(`Refusing to overwrite existing file: ${path}`);
    }
    return;
  }
  await atomicWriteText(path, content);
}

export function slugify(input: string): string {
  const value = input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-+|-+$/gu, "");
  return value || "processor-project";
}

export function toWslPath(windowsPath: string): string {
  const normalized = resolve(windowsPath);
  const match = /^([A-Za-z]):\\(.*)$/u.exec(normalized);
  if (!match) {
    throw new Error(`Only drive-letter Windows paths are supported by the WSL runner: ${windowsPath}`);
  }
  const drive = match[1]?.toLowerCase();
  const rest = match[2]?.replace(/\\/gu, "/");
  return `/mnt/${drive}/${rest}`;
}

export function shellQuote(value: string): string {
  return `'${value.replace(/'/gu, `'"'"'`)}'`;
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
