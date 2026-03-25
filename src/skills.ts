import type { SkillCandidate, SkillPolicy, TaskBrief } from "./contracts.js";
import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

export interface SkillSignal {
  label: string;
  packages?: string[];
  files?: string[];
  reason: string;
  policy?: SkillPolicy;
}

export const defaultSkillSignals: SkillSignal[] = [
  {
    label: "find-skills",
    reason: "Discover project-relevant skills during init and planning.",
    policy: "auto-install"
  },
  {
    label: "agent-browser",
    files: ["playwright.config.ts", "cypress.config.ts"],
    reason: "Useful when the project needs browser automation or UI testing.",
    policy: "recommend-only"
  },
  {
    label: "rust-debugging",
    files: ["Cargo.toml"],
    reason: "Useful when a Rust project needs debugging or panic investigation.",
    policy: "recommend-only"
  },
  {
    label: "rust-ui-architecture",
    files: ["Cargo.toml"],
    reason: "Useful when a Rust UI project needs architectural guidance.",
    policy: "recommend-only"
  }
];

export function toSkillCandidate(signal: SkillSignal): SkillCandidate {
  return {
    name: signal.label,
    reason: signal.reason,
    confidence: signal.policy === "auto-install" ? "high" : "medium",
    policy: signal.policy ?? "recommend-only"
  };
}

export function renderSkillDecision(candidate: SkillCandidate): string {
  return `- ${candidate.name} [${candidate.policy}] - ${candidate.reason}`;
}

export interface SkillRegistry {
  installed: SkillCandidate[];
  recommended: SkillCandidate[];
  deferred: SkillCandidate[];
  rejected: SkillCandidate[];
}

function parseSection(content: string, heading: string): string[] {
  const escapedHeading = heading.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  const sectionRegex = new RegExp(`${escapedHeading}\\n\\n([\\s\\S]*?)(?=\\n## |$)`, "u");
  const match = content.match(sectionRegex)?.[1] ?? "";
  return match
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.startsWith("- ") && line !== "- None yet");
}

function parseSkillLine(line: string): SkillCandidate {
  const value = line.slice(2);
  const match = value.match(/^(.*?)\s+\[(.*?)\]\s+-\s+(.*)$/u);
  if (match) {
    return {
      name: match[1].trim(),
      policy: match[2].trim() as SkillPolicy,
      reason: match[3].trim(),
      confidence: match[2].trim() === "auto-install" ? "high" : "medium"
    };
  }

  return {
    name: value.trim(),
    policy: "recommend-only",
    reason: "No reason recorded.",
    confidence: "low"
  };
}

export function parseSkillRegistry(content: string): SkillRegistry {
  return {
    installed: parseSection(content, "## Installed").map(parseSkillLine),
    recommended: parseSection(content, "## Recommended").map(parseSkillLine),
    deferred: parseSection(content, "## Deferred").map(parseSkillLine),
    rejected: parseSection(content, "## Rejected").map(parseSkillLine)
  };
}

export function renderSkillRegistry(registry: SkillRegistry): string {
  const sections: Array<[string, SkillCandidate[]]> = [
    ["Installed", registry.installed],
    ["Recommended", registry.recommended],
    ["Deferred", registry.deferred],
    ["Rejected", registry.rejected]
  ];

  return sections
    .map(([title, skills]) => {
      const items = skills.length > 0 ? skills.map(renderSkillDecision) : ["- None yet"];
      return `${title}:\n${items.join("\n")}`;
    })
    .join("\n\n");
}

export async function readSkillRegistry(rootDir: string): Promise<SkillRegistry> {
  const skillPath = path.join(rootDir, ".omni", "SKILLS.md");
  return parseSkillRegistry(await readFile(skillPath, "utf8"));
}

export interface SkillInstallPlan {
  commands: string[];
  installed: SkillCandidate[];
  steps: Array<{
    command: string;
    args: string[];
    summary: string;
  }>;
}

export function buildSkillInstallPlan(candidates: SkillCandidate[]): SkillInstallPlan {
  const installed = candidates.filter((candidate) => candidate.policy === "auto-install");
  const steps = installed.map((candidate) => ({
    command: "npx",
    args: ["skills", "add", "https://github.com/vercel-labs/skills", "--skill", candidate.name],
    summary: `Install ${candidate.name}`
  }));
  const commands = steps.map((step) => [step.command, ...step.args].join(" "));
  return { commands, installed, steps };
}

export async function appendSkillUsageNote(rootDir: string, note: string): Promise<void> {
  const skillPath = path.join(rootDir, ".omni", "SKILLS.md");
  const content = await readFile(skillPath, "utf8");
  const next = content.replace(
    /## Usage Notes\n\n([\s\S]*)$/u,
    (_match, section) => `## Usage Notes\n\n${section.trimEnd()}\n- ${note}\n`
  );
  await writeFile(skillPath, next, "utf8");
}

export interface SkillInstallResult {
  name: string;
  success: boolean;
  error?: string;
}

function replaceSection(content: string, heading: string, lines: string[]): string {
  const escapedHeading = heading.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  const sectionRegex = new RegExp(`(${escapedHeading}\\n\\n)([\\s\\S]*?)(?=\\n## |$)`, "u");
  const replacement = `$1${lines.join("\n")}\n`;
  return content.match(sectionRegex)
    ? content.replace(sectionRegex, replacement)
    : `${content.trimEnd()}\n\n${heading}\n\n${lines.join("\n")}\n`;
}

export async function applyInstallResults(rootDir: string, results: SkillInstallResult[]): Promise<{ deferred: string[]; installed: string[] }> {
  const skillPath = path.join(rootDir, ".omni", "SKILLS.md");
  let content = await readFile(skillPath, "utf8");
  const registry = parseSkillRegistry(content);

  const installed: string[] = [];
  const deferred: string[] = [];

  for (const result of results) {
    if (result.success) {
      installed.push(result.name);
      continue;
    }

    deferred.push(result.name);
    const existing = registry.installed.find((s) => s.name === result.name);
    if (existing) {
      registry.installed = registry.installed.filter((s) => s.name !== result.name);
      registry.deferred.push({
        ...existing,
        policy: "recommend-only",
        reason: `${existing.reason} (install failed: ${result.error ?? "unknown error"})`
      });
    } else {
      registry.deferred.push({
        name: result.name,
        reason: `Install failed: ${result.error ?? "unknown error"}`,
        confidence: "low",
        policy: "recommend-only"
      });
    }
  }

  const installedLines = registry.installed.length > 0 ? registry.installed.map(renderSkillDecision) : ["- None yet"];
  const deferredLines = registry.deferred.length > 0 ? registry.deferred.map(renderSkillDecision) : ["- None yet"];
  content = replaceSection(content, "## Installed", installedLines);
  content = replaceSection(content, "## Deferred", deferredLines);
  await writeFile(skillPath, content, "utf8");

  return { deferred, installed };
}

export interface SkillTrigger {
  name: string;
  triggers: string[];
  content: string;
}

function parseTriggers(description: string): string[] {
  const match = description.match(/Triggers include\s+"([^"]+)"(?:,\s+"([^"]+)")*(?:,?\s+or\s+"([^"]+)")?/iu);
  if (!match) return [];
  return [match[1], match[2], match[3]].filter((value): value is string => Boolean(value?.trim()));
}

export async function loadSkillTriggers(skillsDir: string): Promise<SkillTrigger[]> {
  const triggers: SkillTrigger[] = [];
  try {
    const entries = await readdir(skillsDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      try {
        const content = await readFile(path.join(skillsDir, entry.name, "SKILL.md"), "utf8");
        const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/u);
        if (!frontmatterMatch) continue;
        const descMatch = frontmatterMatch[1].match(/description:\s*(.*)/u);
        if (!descMatch) continue;
        const parsed = parseTriggers(descMatch[1]);
        if (parsed.length > 0) {
          triggers.push({ name: entry.name, triggers: parsed, content });
        }
      } catch { /* skip unreadable skills */ }
    }
  } catch { /* skills dir doesn't exist */ }
  return triggers;
}

export function matchSkillsForTask(task: TaskBrief, skills: SkillTrigger[]): SkillTrigger[] {
  const taskText = [task.id, task.title, task.objective, ...task.doneCriteria, ...task.skills].join(" ").toLowerCase();
  return skills.filter((skill) =>
    skill.triggers.some((trigger) => taskText.includes(trigger.toLowerCase()))
  );
}
