import type { SkillCandidate, SkillPolicy } from "./contracts.js";
import { readFile, writeFile } from "node:fs/promises";
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
