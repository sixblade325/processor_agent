import { open, mkdir, readFile, unlink, type FileHandle } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";

const LOCK_WAIT_MS = 30_000;
const STALE_LOCK_MS = 30 * 60_000;

export async function withStage2WorkspaceLock<T>(
  projectRoot: string,
  operation: () => Promise<T>,
): Promise<T> {
  const lockPath = resolve(
    dirname(projectRoot),
    ".runtime",
    "processor_agent",
    basename(projectRoot),
    "stage2",
    "state.lock",
  );
  await mkdir(dirname(lockPath), { recursive: true });
  const handle = await acquireLock(lockPath);
  try {
    return await operation();
  } finally {
    await releaseLock(lockPath, handle);
  }
}

async function acquireLock(path: string): Promise<FileHandle> {
  const deadline = Date.now() + LOCK_WAIT_MS;
  while (true) {
    try {
      const handle = await open(path, "wx");
      await handle.writeFile(`${JSON.stringify({ pid: process.pid, createdAt: new Date().toISOString() })}\n`);
      return handle;
    } catch (error) {
      if (!isAlreadyExists(error)) {
        throw error;
      }
      await removeStaleLock(path);
      if (Date.now() >= deadline) {
        throw new Error(`Timed out waiting for Stage2 workspace lock: ${path}`);
      }
      await delay(100);
    }
  }
}

async function removeStaleLock(path: string): Promise<void> {
  try {
    const value = JSON.parse(await readFile(path, "utf8")) as {
      pid?: unknown;
      createdAt?: unknown;
    };
    const createdAt = typeof value.createdAt === "string" ? Date.parse(value.createdAt) : 0;
    const pid = typeof value.pid === "number" ? value.pid : undefined;
    if (pid !== undefined && processExists(pid)) {
      return;
    }
    if (pid === undefined && Date.now() - createdAt < STALE_LOCK_MS) {
      return;
    }
    await unlink(path);
  } catch (error) {
    if (!isMissing(error)) {
      return;
    }
  }
}

async function releaseLock(path: string, handle: FileHandle): Promise<void> {
  await handle.close();
  try {
    await unlink(path);
  } catch (error) {
    if (!isMissing(error)) {
      throw error;
    }
  }
}

function processExists(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function isAlreadyExists(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error
    && (error as { code?: unknown }).code === "EEXIST";
}

function isMissing(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error
    && (error as { code?: unknown }).code === "ENOENT";
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, milliseconds));
}
