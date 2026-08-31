import { existsSync } from "node:fs";
import { readdir } from "node:fs/promises";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { pathExists, readText, sha256 } from "./io.js";
import type { Stage2AgentTask, Stage2SkillReference } from "./types.js";

export interface LoadedSkill {
  reference: Stage2SkillReference;
  content: string;
}

const TASK_SKILLS: Record<Stage2AgentTask, string[]> = {
  topology_research: ["design-chisel-processor"],
  topology_planning: ["design-chisel-processor"],
  shadow_design: ["design-chisel-processor"],
  active_implementation: ["design-chisel-processor", "implement-chisel-processor"],
  active_static_review: ["implement-chisel-processor"],
  active_verification_review: ["implement-chisel-processor"],
  independent_static_review: ["implement-chisel-processor"],
  independent_verification: ["implement-chisel-processor"],
};

export async function loadStage2TaskSkills(task: Stage2AgentTask): Promise<LoadedSkill[]> {
  return Promise.all(TASK_SKILLS[task].map(loadSkill));
}

export function skillReferences(skills: LoadedSkill[]): Stage2SkillReference[] {
  return skills.map((skill) => ({ ...skill.reference }));
}

export function renderSkillContext(skills: LoadedSkill[]): string {
  return skills
    .map((skill) => [
      `## Skill ${skill.reference.id}`,
      `contentHash: ${skill.reference.contentHash}`,
      "",
      skill.content,
    ].join("\n"))
    .join("\n\n");
}

async function loadSkill(id: string): Promise<LoadedSkill> {
  const directory = resolve(productRoot(), "skills", id);
  const entrypoint = resolve(directory, "SKILL.md");
  if (!(await pathExists(entrypoint))) {
    throw new Error(`Required Processor Agent Skill is missing: ${id}`);
  }
  const files = (await listMarkdownFiles(directory)).sort((left, right) => left.localeCompare(right));
  const parts = await Promise.all(files.map(async (path) => {
    const rel = relative(directory, path).replace(/\\/gu, "/");
    return `### ${rel}\n\n${await readText(path)}`;
  }));
  const entry = await readText(entrypoint);
  const declaredName = /^---\s*\r?\n[\s\S]*?^name:\s*([^\r\n]+)\s*$[\s\S]*?^---\s*$/mu.exec(entry)?.[1]?.trim();
  if (declaredName !== id) {
    throw new Error(`Skill ${id} declares unexpected name ${declaredName ?? "<missing>"}`);
  }
  const content = parts.join("\n\n");
  return {
    reference: { id, contentHash: sha256(content) },
    content,
  };
}

async function listMarkdownFiles(directory: string): Promise<string[]> {
  const result: string[] = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) {
      result.push(...await listMarkdownFiles(path));
    } else if (entry.isFile() && entry.name.toLowerCase().endsWith(".md")) {
      result.push(path);
    }
  }
  return result;
}

function productRoot(): string {
  const configured = process.env.PROCESSOR_AGENT_ROOT?.trim();
  if (configured !== undefined && configured !== "") {
    return resolve(configured);
  }
  const moduleDirectory = dirname(fileURLToPath(import.meta.url));
  const candidates = [resolve(moduleDirectory, ".."), resolve(moduleDirectory, "..", "..")];
  const root = candidates.find((candidate) => existsSync(resolve(candidate, "skills")));
  if (root === undefined) {
    throw new Error("Cannot locate Processor Agent skills directory");
  }
  return root;
}
