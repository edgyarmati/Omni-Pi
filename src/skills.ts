import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import type { SkillCandidate, SkillPolicy, TaskBrief } from "./contracts.js";

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
    policy: "auto-install",
  },
  {
    label: "skill-creator",
    reason:
      "Create project-specific skills when Omni cannot find one that fits.",
    policy: "auto-install",
  },
  {
    label: "brainstorming",
    reason:
      "Useful when Omni is designing or decomposing task slices before implementation.",
    policy: "recommend-only",
  },
  {
    label: "agent-browser",
    files: ["playwright.config.ts", "cypress.config.ts"],
    reason: "Useful when the project needs browser automation or UI testing.",
    policy: "recommend-only",
  },
  {
    label: "rust-debugging",
    files: ["Cargo.toml"],
    reason:
      "Useful when a Rust project needs debugging or panic investigation.",
    policy: "recommend-only",
  },
  {
    label: "rust-ui-architecture",
    files: ["Cargo.toml"],
    reason: "Useful when a Rust UI project needs architectural guidance.",
    policy: "recommend-only",
  },
];

export const BUNDLED_FOUNDATION_SKILLS = new Set([
  "find-skills",
  "skill-creator",
]);
export const BUNDLED_OMNI_SKILLS = new Set([
  ...BUNDLED_FOUNDATION_SKILLS,
  "brainstorming",
]);

export interface SkillRegistry {
  installed: SkillCandidate[];
  recommended: SkillCandidate[];
  deferred: SkillCandidate[];
  rejected: SkillCandidate[];
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

export interface SkillInstallResult {
  name: string;
  success: boolean;
  error?: string;
}

export interface SkillTrigger {
  name: string;
  triggers: string[];
  content: string;
}

export interface AvailableSkill extends SkillTrigger {
  source: "bundled" | "user" | "project";
  directory: string;
}

interface ProjectSkillRecord {
  name: string;
  source: "bundled" | "user" | "created";
  sourcePath?: string;
  taskRefs: string[];
  installedAt: string;
}

interface ProjectSkillState {
  managed: ProjectSkillRecord[];
}

const PROJECT_SKILLS_DIRNAME = "project-skills";
const PROJECT_SKILLS_STATE = "SKILLS-STATE.json";

export function toSkillCandidate(signal: SkillSignal): SkillCandidate {
  return {
    name: signal.label,
    reason: signal.reason,
    confidence: signal.policy === "auto-install" ? "high" : "medium",
    policy: signal.policy ?? "recommend-only",
  };
}

export function renderSkillDecision(candidate: SkillCandidate): string {
  return `- ${candidate.name} [${candidate.policy}] - ${candidate.reason}`;
}

function parseSection(content: string, heading: string): string[] {
  const escapedHeading = heading.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  const sectionRegex = new RegExp(
    `${escapedHeading}\\n\\n([\\s\\S]*?)(?=\\n## |$)`,
    "u",
  );
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
      confidence: match[2].trim() === "auto-install" ? "high" : "medium",
    };
  }

  return {
    name: value.trim(),
    policy: "recommend-only",
    reason: "No reason recorded.",
    confidence: "low",
  };
}

export function parseSkillRegistry(content: string): SkillRegistry {
  return {
    installed: parseSection(content, "## Installed").map(parseSkillLine),
    recommended: parseSection(content, "## Recommended").map(parseSkillLine),
    deferred: parseSection(content, "## Deferred").map(parseSkillLine),
    rejected: parseSection(content, "## Rejected").map(parseSkillLine),
  };
}

export function renderSkillRegistry(registry: SkillRegistry): string {
  const sections: Array<[string, SkillCandidate[]]> = [
    ["Installed", registry.installed],
    ["Recommended", registry.recommended],
    ["Deferred", registry.deferred],
    ["Rejected", registry.rejected],
  ];

  return sections
    .map(([title, skills]) => {
      const items =
        skills.length > 0 ? skills.map(renderSkillDecision) : ["- None yet"];
      return `${title}:\n${items.join("\n")}`;
    })
    .join("\n\n");
}

export async function readSkillRegistry(
  rootDir: string,
): Promise<SkillRegistry> {
  const skillPath = path.join(rootDir, ".omni", "SKILLS.md");
  return parseSkillRegistry(await readFile(skillPath, "utf8"));
}

export function buildSkillInstallPlan(
  candidates: SkillCandidate[],
): SkillInstallPlan {
  const installed = candidates.filter(
    (candidate) => candidate.policy === "auto-install",
  );
  const steps = installed
    .filter((candidate) => !BUNDLED_OMNI_SKILLS.has(candidate.name))
    .map((candidate) => ({
      command: "npx",
      args: [
        "skills",
        "add",
        "https://github.com/vercel-labs/skills",
        "--skill",
        candidate.name,
      ],
      summary: `Install ${candidate.name}`,
    }));
  const commands = steps.map((step) => [step.command, ...step.args].join(" "));
  return { commands, installed, steps };
}

export async function appendSkillUsageNote(
  rootDir: string,
  note: string,
): Promise<void> {
  const skillPath = path.join(rootDir, ".omni", "SKILLS.md");
  const content = await readFile(skillPath, "utf8");
  const next = content.replace(
    /## Usage Notes\n\n([\s\S]*)$/u,
    (_match, section) => `## Usage Notes\n\n${section.trimEnd()}\n- ${note}\n`,
  );
  await writeFile(skillPath, next, "utf8");
}

function replaceSection(
  content: string,
  heading: string,
  lines: string[],
): string {
  const escapedHeading = heading.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  const sectionRegex = new RegExp(
    `(${escapedHeading}\\n\\n)([\\s\\S]*?)(?=\\n## |$)`,
    "u",
  );
  const replacement = `$1${lines.join("\n")}\n`;
  return content.match(sectionRegex)
    ? content.replace(sectionRegex, replacement)
    : `${content.trimEnd()}\n\n${heading}\n\n${lines.join("\n")}\n`;
}

export async function applyInstallResults(
  rootDir: string,
  results: SkillInstallResult[],
): Promise<{ deferred: string[]; installed: string[] }> {
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
      registry.installed = registry.installed.filter(
        (s) => s.name !== result.name,
      );
      registry.deferred.push({
        ...existing,
        policy: "recommend-only",
        reason: `${existing.reason} (install failed: ${result.error ?? "unknown error"})`,
      });
    } else {
      registry.deferred.push({
        name: result.name,
        reason: `Install failed: ${result.error ?? "unknown error"}`,
        confidence: "low",
        policy: "recommend-only",
      });
    }
  }

  const installedLines =
    registry.installed.length > 0
      ? registry.installed.map(renderSkillDecision)
      : ["- None yet"];
  const deferredLines =
    registry.deferred.length > 0
      ? registry.deferred.map(renderSkillDecision)
      : ["- None yet"];
  content = replaceSection(content, "## Installed", installedLines);
  content = replaceSection(content, "## Deferred", deferredLines);
  await writeFile(skillPath, content, "utf8");

  return { deferred, installed };
}

function parseTriggers(description: string): string[] {
  const listMatch = description.match(/Triggers include\s+(.*)/iu);
  if (!listMatch) return [];
  const triggers: string[] = [];
  for (const match of listMatch[1].matchAll(/"([^"]+)"/gu)) {
    triggers.push(match[1]);
  }
  return triggers;
}

function packageSkillsDir(): string {
  return path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "..",
    "skills",
  );
}

function maybeUserSkillDirs(): string[] {
  const home = process.env.HOME;
  if (!home) {
    return [];
  }
  return [
    path.join(home, ".codex", "skills"),
    path.join(home, ".agents", "skills"),
  ];
}

export function projectSkillsDir(rootDir: string): string {
  return path.join(rootDir, ".omni", PROJECT_SKILLS_DIRNAME);
}

function projectSkillStatePath(rootDir: string): string {
  return path.join(rootDir, ".omni", PROJECT_SKILLS_STATE);
}

async function readProjectSkillState(
  rootDir: string,
): Promise<ProjectSkillState> {
  try {
    return JSON.parse(
      await readFile(projectSkillStatePath(rootDir), "utf8"),
    ) as ProjectSkillState;
  } catch {
    return { managed: [] };
  }
}

async function writeProjectSkillState(
  rootDir: string,
  state: ProjectSkillState,
): Promise<void> {
  await mkdir(path.join(rootDir, ".omni"), { recursive: true });
  await writeFile(
    projectSkillStatePath(rootDir),
    `${JSON.stringify(state, null, 2)}\n`,
    "utf8",
  );
}

async function updateInstalledRegistry(
  rootDir: string,
  names: string[],
): Promise<void> {
  if (names.length === 0) {
    return;
  }
  const skillPath = path.join(rootDir, ".omni", "SKILLS.md");
  let content = await readFile(skillPath, "utf8");
  const registry = parseSkillRegistry(content);
  const known = new Set(registry.installed.map((item) => item.name));
  for (const name of names) {
    if (!known.has(name)) {
      registry.installed.push({
        name,
        reason: "Auto-managed project skill dependency.",
        confidence: "medium",
        policy: "auto-install",
      });
    }
  }
  content = replaceSection(
    content,
    "## Installed",
    registry.installed.length > 0
      ? registry.installed.map(renderSkillDecision)
      : ["- None yet"],
  );
  await writeFile(skillPath, content, "utf8");
}

async function updateDeferredRegistry(
  rootDir: string,
  name: string,
  reason: string,
): Promise<void> {
  const skillPath = path.join(rootDir, ".omni", "SKILLS.md");
  let content = await readFile(skillPath, "utf8");
  const registry = parseSkillRegistry(content);
  if (!registry.deferred.some((item) => item.name === name)) {
    registry.deferred.push({
      name,
      reason,
      confidence: "low",
      policy: "recommend-only",
    });
  }
  content = replaceSection(
    content,
    "## Deferred",
    registry.deferred.length > 0
      ? registry.deferred.map(renderSkillDecision)
      : ["- None yet"],
  );
  await writeFile(skillPath, content, "utf8");
}

export async function loadSkillTriggers(
  skillsDir: string,
): Promise<SkillTrigger[]> {
  const triggers = await loadAvailableSkillsFromDir(skillsDir, "bundled");
  return triggers.map(({ name, triggers: triggerList, content }) => ({
    name,
    triggers: triggerList,
    content,
  }));
}

async function loadAvailableSkillsFromDir(
  skillsDir: string,
  source: AvailableSkill["source"],
): Promise<AvailableSkill[]> {
  const skills: AvailableSkill[] = [];
  try {
    const entries = await readdir(skillsDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      try {
        const directory = path.join(skillsDir, entry.name);
        const content = await readFile(
          path.join(directory, "SKILL.md"),
          "utf8",
        );
        const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/u);
        if (!frontmatterMatch) continue;
        const descMatch = frontmatterMatch[1].match(/description:\s*(.*)/u);
        if (!descMatch) continue;
        const triggerList = parseTriggers(descMatch[1]);
        skills.push({
          name: entry.name,
          triggers: triggerList,
          content,
          source,
          directory,
        });
      } catch {
        // skip unreadable skills
      }
    }
  } catch {
    // skills dir missing is fine
  }
  return skills;
}

export async function loadAvailableSkills(
  rootDir: string,
): Promise<AvailableSkill[]> {
  const sources = await Promise.all([
    loadAvailableSkillsFromDir(projectSkillsDir(rootDir), "project"),
    loadAvailableSkillsFromDir(packageSkillsDir(), "bundled"),
    ...maybeUserSkillDirs().map((dir) =>
      loadAvailableSkillsFromDir(dir, "user"),
    ),
  ]);

  const merged = new Map<string, AvailableSkill>();
  for (const skill of sources.flat()) {
    if (!merged.has(skill.name)) {
      merged.set(skill.name, skill);
    }
  }
  return [...merged.values()];
}

export function matchSkillsForTask(
  task: TaskBrief,
  skills: Pick<AvailableSkill, "name" | "triggers" | "content">[],
): Pick<AvailableSkill, "name" | "triggers" | "content">[] {
  const taskText = [
    task.id,
    task.title,
    task.objective,
    ...task.doneCriteria,
    ...task.skills,
  ]
    .join(" ")
    .toLowerCase();
  return skills.filter((skill) =>
    skill.triggers.some((trigger) => taskText.includes(trigger.toLowerCase())),
  );
}

function normalizeSkillName(value: string): string {
  return (
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/gu, "-")
      .replace(/^-+|-+$/gu, "")
      .slice(0, 48) || "project-skill"
  );
}

function taskKeywords(task: TaskBrief): string[] {
  return Array.from(
    new Set(
      [task.title, task.objective, ...task.doneCriteria]
        .join(" ")
        .toLowerCase()
        .replace(/[^a-z0-9]+/gu, " ")
        .split(/\s+/u)
        .filter((token) => token.length >= 4),
    ),
  ).slice(0, 6);
}

function buildGeneratedSkill(task: TaskBrief, name: string): string {
  const keywords = taskKeywords(task);
  const triggerText =
    keywords.length > 0
      ? keywords.map((item) => `"${item}"`).join(", ")
      : `"${task.id.toLowerCase()}"`;
  return `---
name: ${name}
description: Project-specific skill for ${task.title}. Triggers include ${triggerText}
---

# ${name}

Use this skill for the task "${task.title}".

Focus:
- ${task.objective}

Definition of done:
${task.doneCriteria.map((item) => `- ${item}`).join("\n") || "- Follow the task brief."}

Context:
${task.contextFiles.map((item) => `- ${item}`).join("\n") || "- Refer to the active task brief and .omni files."}
`;
}

async function writeProjectSkill(
  rootDir: string,
  name: string,
  content: string,
): Promise<string> {
  const dir = path.join(projectSkillsDir(rootDir), name);
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, "SKILL.md"), content, "utf8");
  return dir;
}

async function installSkillToProject(
  rootDir: string,
  skill: AvailableSkill,
): Promise<void> {
  if (skill.source === "project") {
    return;
  }
  await writeProjectSkill(rootDir, skill.name, skill.content);
}

function syncRecordTaskRef(
  record: ProjectSkillRecord,
  taskId: string,
): ProjectSkillRecord {
  return {
    ...record,
    taskRefs: Array.from(new Set([...record.taskRefs, taskId])),
  };
}

export async function ensureTaskSkillDependencies(
  rootDir: string,
  task: TaskBrief,
): Promise<{
  task: TaskBrief;
  installed: string[];
  created: string[];
}> {
  const available = await loadAvailableSkills(rootDir);
  const availableByName = new Map(
    available.map((skill) => [skill.name, skill]),
  );
  const matched = matchSkillsForTask(task, available);

  const desired = new Set<string>([
    ...task.skills,
    ...matched.map((skill) => skill.name),
  ]);
  const installed: string[] = [];
  const created: string[] = [];
  const state = await readProjectSkillState(rootDir);

  if (desired.size === 0) {
    const generatedName = normalizeSkillName(`${task.id}-${task.title}`);
    await writeProjectSkill(
      rootDir,
      generatedName,
      buildGeneratedSkill(task, generatedName),
    );
    desired.add(generatedName);
    created.push(generatedName);
    state.managed = state.managed.filter(
      (entry) => entry.name !== generatedName,
    );
    state.managed.push({
      name: generatedName,
      source: "created",
      taskRefs: [task.id],
      installedAt: new Date().toISOString(),
    });
    await appendSkillUsageNote(
      rootDir,
      `Created project skill ${generatedName} for ${task.id} because no existing skill matched the task.`,
    );
  }

  for (const name of desired) {
    const existingRecord = state.managed.find((entry) => entry.name === name);
    const availableSkill = availableByName.get(name);

    if (availableSkill && availableSkill.source !== "project") {
      await installSkillToProject(rootDir, availableSkill);
      installed.push(name);
      const nextRecord: ProjectSkillRecord = syncRecordTaskRef(
        existingRecord ?? {
          name,
          source: availableSkill.source,
          sourcePath: availableSkill.directory,
          taskRefs: [],
          installedAt: new Date().toISOString(),
        },
        task.id,
      );
      state.managed = state.managed.filter((entry) => entry.name !== name);
      state.managed.push(nextRecord);
      continue;
    }

    if (availableSkill?.source === "project" && existingRecord) {
      state.managed = state.managed.map((entry) =>
        entry.name === name ? syncRecordTaskRef(entry, task.id) : entry,
      );
      continue;
    }

    if (!availableSkill) {
      const generatedName = normalizeSkillName(name);
      await writeProjectSkill(
        rootDir,
        generatedName,
        buildGeneratedSkill(task, generatedName),
      );
      if (generatedName !== name) {
        desired.delete(name);
        desired.add(generatedName);
      }
      created.push(generatedName);
      state.managed = state.managed.filter(
        (entry) => entry.name !== generatedName,
      );
      state.managed.push({
        name: generatedName,
        source: "created",
        taskRefs: [task.id],
        installedAt: new Date().toISOString(),
      });
      await appendSkillUsageNote(
        rootDir,
        `Created project skill ${generatedName} for ${task.id} because ${name} was unavailable.`,
      );
    }
  }

  await writeProjectSkillState(rootDir, state);
  await updateInstalledRegistry(rootDir, [
    ...new Set([...installed, ...created, ...desired]),
  ]);

  return {
    task: {
      ...task,
      skills: [...new Set([...task.skills, ...desired])],
    },
    installed: [...new Set(installed)],
    created: [...new Set(created)],
  };
}

export async function cleanupUnusedProjectSkills(
  rootDir: string,
  activeTasks: TaskBrief[],
): Promise<string[]> {
  const activeNames = new Set(activeTasks.flatMap((task) => task.skills));
  const state = await readProjectSkillState(rootDir);
  const removed: string[] = [];

  const retained: ProjectSkillRecord[] = [];
  for (const record of state.managed) {
    if (activeNames.has(record.name)) {
      retained.push(record);
      continue;
    }
    removed.push(record.name);
    await rm(path.join(projectSkillsDir(rootDir), record.name), {
      recursive: true,
      force: true,
    });
  }

  if (removed.length > 0) {
    await appendSkillUsageNote(
      rootDir,
      `Removed unused project skills: ${removed.join(", ")}.`,
    );
    await updateDeferredRegistry(
      rootDir,
      "project-skill-cleanup",
      `Auto-removed unused skills: ${removed.join(", ")}`,
    );
  }

  state.managed = retained;
  await writeProjectSkillState(rootDir, state);
  return removed;
}
