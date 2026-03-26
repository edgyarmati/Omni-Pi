import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { readConfig } from "./config.js";
import type {
  ConversationBrief,
  OmniState,
  SkillCandidate,
} from "./contracts.js";
import { buildStarterFileMap, listStarterFiles } from "./memory.js";
import {
  createInitialSpec,
  gatherPlanningContext,
  renderSpecMarkdown,
  renderTasksMarkdown,
  renderTestsMarkdown,
} from "./planning.js";
import { appendProgress, cleanupCompletedPlans, createPlan } from "./plans.js";
import { detectRepoSignals } from "./repo.js";
import {
  appendSkillUsageNote,
  buildSkillInstallPlan,
  defaultSkillSignals,
  renderSkillDecision,
  toSkillCandidate,
} from "./skills.js";
import { type SyncRequest, syncOmniMemory } from "./sync.js";
import { executeNextTask, type WorkEngine, type WorkResult } from "./work.js";

export interface InitResult {
  created: string[];
  reused: string[];
  repoSignals: Awaited<ReturnType<typeof detectRepoSignals>>;
  skillCandidates: SkillCandidate[];
  installedSkills: SkillCandidate[];
  installCommands: string[];
  installSteps: Array<{
    command: string;
    args: string[];
    summary: string;
  }>;
}

export interface PlanResult {
  specPath: string;
  tasksPath: string;
  testsPath: string;
}

export interface WorkExecutionResult extends WorkResult {
  state: OmniState;
}

export interface SyncResult {
  state: OmniState;
}

const starterFileMap = buildStarterFileMap();

async function writeIfMissing(
  filePath: string,
  content: string,
): Promise<boolean> {
  try {
    await readFile(filePath, "utf8");
    return false;
  } catch {
    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(filePath, content, "utf8");
    return true;
  }
}

async function replaceSection(
  filePath: string,
  heading: string,
  lines: string[],
): Promise<void> {
  const current = await readFile(filePath, "utf8");
  const escapedHeading = heading.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  const sectionRegex = new RegExp(
    `(${escapedHeading}\\n\\n)([\\s\\S]*?)(?=\\n## |$)`,
    "u",
  );
  const replacement = `$1${lines.join("\n")}\n`;
  const next = current.match(sectionRegex)
    ? current.replace(sectionRegex, replacement)
    : `${current.trimEnd()}\n\n${heading}\n\n${lines.join("\n")}\n`;
  await writeFile(filePath, next, "utf8");
}

async function writeState(rootDir: string, state: OmniState): Promise<void> {
  const statePath = path.join(rootDir, ".omni", "STATE.md");
  const recoverySection =
    state.recoveryOptions && state.recoveryOptions.length > 0
      ? `\nRecovery Options:\n${state.recoveryOptions.map((option) => `- ${option}`).join("\n")}\n`
      : "";
  const content = `# State

Current Phase: ${state.currentPhase[0].toUpperCase()}${state.currentPhase.slice(1)}
Active Task: ${state.activeTask}
Status Summary: ${state.statusSummary}
Blockers: ${state.blockers.length > 0 ? state.blockers.join("; ") : "None"}
Next Step: ${state.nextStep}
${recoverySection}`;
  await writeFile(statePath, content, "utf8");
}

function buildSkillCandidates(
  repoSignals: Awaited<ReturnType<typeof detectRepoSignals>>,
): SkillCandidate[] {
  const candidates = defaultSkillSignals.map(toSkillCandidate);

  if (
    repoSignals.tools.includes("playwright") ||
    repoSignals.tools.includes("cypress")
  ) {
    candidates.push({
      name: "browser-test-helpers",
      reason:
        "The repository already has browser testing signals, so browser-oriented workflow helpers are useful.",
      confidence: "medium",
      policy: "recommend-only",
    });
  }

  return candidates;
}

export async function initializeOmniProject(
  rootDir: string,
): Promise<InitResult> {
  const created: string[] = [];
  const reused: string[] = [];

  for (const file of listStarterFiles()) {
    const absolutePath = path.join(rootDir, file.path);
    if (await writeIfMissing(absolutePath, file.content)) {
      created.push(file.path);
    } else {
      reused.push(file.path);
    }
  }

  const repoSignals = await detectRepoSignals(rootDir);
  const skillCandidates = buildSkillCandidates(repoSignals);
  const {
    installed: installedSkills,
    commands: installCommands,
    steps: installSteps,
  } = buildSkillInstallPlan(skillCandidates);

  const skillsPath = path.join(rootDir, ".omni", "SKILLS.md");
  await replaceSection(
    skillsPath,
    "## Installed",
    installedSkills.length > 0
      ? installedSkills.map(renderSkillDecision)
      : ["- None yet"],
  );
  await replaceSection(
    skillsPath,
    "## Recommended",
    skillCandidates
      .filter((candidate) => candidate.policy !== "auto-install")
      .map(renderSkillDecision)
      .concat(
        skillCandidates.every(
          (candidate) => candidate.policy === "auto-install",
        )
          ? ["- None yet"]
          : [],
      ),
  );

  const projectPath = path.join(rootDir, ".omni", "PROJECT.md");
  const project = await readFile(projectPath, "utf8");
  const signalSummary = [
    `- Detected languages: ${repoSignals.languages.join(", ") || "unknown"}`,
    `- Detected frameworks: ${repoSignals.frameworks.join(", ") || "unknown"}`,
    `- Detected tools: ${repoSignals.tools.join(", ") || "unknown"}`,
  ].join("\n");
  if (!project.includes("## Repo Signals")) {
    await writeFile(
      projectPath,
      `${project.trimEnd()}\n\n## Repo Signals\n\n${signalSummary}\n`,
      "utf8",
    );
  }

  if (installCommands.length > 0) {
    await appendSkillUsageNote(
      rootDir,
      `Planned install commands: ${installCommands.join(" ; ")}`,
    );
  }

  await writeState(rootDir, {
    currentPhase: "understand",
    activeTask: "Initialize Omni-Pi",
    statusSummary:
      "Omni-Pi has created its project memory files and scanned the repository for useful signals.",
    blockers: [],
    nextStep:
      "Run /omni-plan to turn the current project context into a spec and first task slices.",
  });

  return {
    created,
    reused,
    repoSignals,
    skillCandidates,
    installedSkills,
    installCommands,
    installSteps,
  };
}

export async function planOmniProject(
  rootDir: string,
  brief: ConversationBrief,
): Promise<PlanResult> {
  const specPath = path.join(rootDir, ".omni", "SPEC.md");
  const tasksPath = path.join(rootDir, ".omni", "TASKS.md");
  const testsPath = path.join(rootDir, ".omni", "TESTS.md");

  for (const required of [specPath, tasksPath, testsPath]) {
    const relative = path.relative(rootDir, required);
    if (!starterFileMap[relative]) {
      continue;
    }
    await writeIfMissing(required, starterFileMap[relative]);
  }

  const repoSignals = await detectRepoSignals(rootDir);
  const planningCtx = await gatherPlanningContext(rootDir);
  const spec = createInitialSpec(brief, repoSignals, planningCtx);
  await writeFile(specPath, renderSpecMarkdown(spec), "utf8");
  await writeFile(tasksPath, renderTasksMarkdown(spec.taskSlices), "utf8");
  await writeFile(testsPath, renderTestsMarkdown(repoSignals), "utf8");

  const planEntry = await createPlan(
    rootDir,
    spec.title,
    brief.summary,
    spec.taskSlices.map((t) => `${t.id}: ${t.title}`),
  );
  await appendProgress(rootDir, `Created plan ${planEntry.id}: ${spec.title}`);

  await writeState(rootDir, {
    currentPhase: "plan",
    activeTask: "Prepare the first implementation slice",
    statusSummary:
      "Omni-Pi refreshed the spec, task slices, and verification plan.",
    blockers: [],
    nextStep:
      "Review the proposed tasks, then run /omni-work when you are ready to execute the next slice.",
  });

  return { specPath, tasksPath, testsPath };
}

export async function readOmniStatus(rootDir: string): Promise<OmniState> {
  const statePath = path.join(rootDir, ".omni", "STATE.md");
  const content = await readFile(statePath, "utf8");

  const matchValue = (label: string): string => {
    const regex = new RegExp(`^${label}:\\s*(.*)$`, "mu");
    return content.match(regex)?.[1]?.trim() ?? "";
  };

  const blockersValue = matchValue("Blockers");
  const recoveryMatch = content.match(/Recovery Options:\n((?:- .*\n?)*)/u);
  const recoveryOptions = recoveryMatch
    ? recoveryMatch[1]
        .split("\n")
        .map((line) => line.replace(/^- /u, "").trim())
        .filter(Boolean)
    : undefined;
  return {
    currentPhase: matchValue(
      "Current Phase",
    ).toLowerCase() as OmniState["currentPhase"],
    activeTask: matchValue("Active Task"),
    statusSummary: matchValue("Status Summary"),
    blockers:
      blockersValue && blockersValue !== "None"
        ? blockersValue.split(/;\s*/u)
        : [],
    nextStep: matchValue("Next Step"),
    recoveryOptions,
  };
}

export async function workOnOmniProject(
  rootDir: string,
  engine: WorkEngine,
): Promise<WorkExecutionResult> {
  const result = await executeNextTask(rootDir, engine);

  let state: OmniState;
  if (result.kind === "completed" || result.kind === "expert_completed") {
    state = {
      currentPhase: result.kind === "expert_completed" ? "escalate" : "build",
      activeTask: result.taskId ?? "None",
      statusSummary: result.message,
      blockers: [],
      nextStep:
        "Run /omni-status to review progress or /omni-work to continue with the next task.",
    };
  } else if (result.kind === "blocked") {
    state = {
      currentPhase: result.message.includes("expert escalation")
        ? "escalate"
        : "check",
      activeTask: result.taskId ?? "None",
      statusSummary: result.message,
      blockers: result.taskId
        ? [`Verification failures on ${result.taskId}`]
        : ["A task is blocked."],
      nextStep: result.message.includes("queued for retry")
        ? "Run /omni-work again to retry the task or inspect `.omni/tasks/` for the failure history."
        : "Review the escalation notes in `.omni/tasks/` and refine the plan or task inputs.",
      recoveryOptions: result.recoveryOptions,
    };
  } else {
    state = {
      currentPhase: "plan",
      activeTask: "None",
      statusSummary: result.message,
      blockers: [],
      nextStep:
        "Run /omni-plan to refresh the task list if more work is needed.",
    };
  }

  await writeState(rootDir, state);
  if (result.kind === "completed" || result.kind === "expert_completed") {
    await appendProgress(
      rootDir,
      `Completed ${result.taskId ?? "task"}: ${result.message}`,
    );
  }
  return { ...result, state };
}

export async function syncOmniProject(
  rootDir: string,
  request: SyncRequest,
): Promise<SyncResult> {
  await syncOmniMemory(rootDir, request);
  await appendProgress(rootDir, request.summary);

  const config = await readConfig(rootDir);
  if (config.cleanupCompletedPlans) {
    await cleanupCompletedPlans(rootDir);
  }

  const state: OmniState = {
    currentPhase: "understand",
    activeTask: "Sync project memory",
    statusSummary: "Omni-Pi synced recent progress into durable memory files.",
    blockers: [],
    nextStep:
      "Run /omni-status to inspect the latest state or /omni-plan to refine the next slice.",
  };
  await writeState(rootDir, state);
  return { state };
}
