import { spawnSync } from "node:child_process";
import { shellQuote, toWslPath } from "./io.js";
import type { CommandResult, CommandSpec } from "./types.js";

export function runCommands(
  specs: CommandSpec[],
  projectRoot: string,
  now: () => Date = () => new Date(),
): CommandResult[] {
  return specs.map((spec) => runCommand(spec, projectRoot, now));
}

export function runCommand(
  spec: CommandSpec,
  projectRoot: string,
  now: () => Date = () => new Date(),
): CommandResult {
  if (spec.runner === "host") {
    const command = requireValue(spec.command, `${spec.id}.command`);
    const args = spec.args ?? [];
    const result = spawnSync(command, args, {
      cwd: projectRoot,
      encoding: "utf8",
      windowsHide: true,
      timeout: 300_000,
      maxBuffer: 4 * 1024 * 1024,
    });
    return commandResult(
      spec,
      [command, ...args].join(" "),
      result.status,
      result.stdout,
      result.stderr,
      result.error,
      now,
    );
  }

  const projectWslPath = shellQuote(toWslPath(projectRoot));
  const script = requireValue(spec.script, `${spec.id}.script`).replace(
    /\{\{projectWslPath\}\}/gu,
    projectWslPath,
  );
  const result = spawnSync("wsl.exe", ["-e", "bash", "-lc", script], {
    cwd: projectRoot,
    encoding: "utf8",
    windowsHide: true,
    timeout: 900_000,
    maxBuffer: 16 * 1024 * 1024,
  });
  return commandResult(
    spec,
    `wsl.exe -e bash -lc ${JSON.stringify(script)}`,
    result.status,
    result.stdout,
    result.stderr,
    result.error,
    now,
  );
}

function commandResult(
  spec: CommandSpec,
  command: string,
  status: number | null,
  stdout: string | Buffer | null,
  stderr: string | Buffer | null,
  error: Error | undefined,
  now: () => Date,
): CommandResult {
  const output = [stdout?.toString(), stderr?.toString(), error?.message]
    .filter((item): item is string => item !== undefined && item !== "")
    .join("\n")
    .trim();
  return {
    id: spec.id,
    description: spec.description,
    runner: spec.runner,
    command,
    required: spec.required,
    ok: status === 0 && error === undefined,
    exitCode: status,
    output,
    checkedAt: now().toISOString(),
  };
}

function requireValue(value: string | undefined, label: string): string {
  if (value === undefined || value === "") {
    throw new Error(`${label} is required`);
  }
  return value;
}
