import { readFile } from "node:fs/promises";
import path from "node:path";

import type {
  ConversationBrief,
  ImplementationSpec,
  PresetConfig,
  TaskBrief,
} from "./contracts.js";
import { WORKFLOW_PRESETS } from "./contracts.js";
import type { RepoSignals } from "./repo.js";
import { escapeTaskTableCell } from "./tasks.js";

export interface PlanningContext {
  existingDecisions: string[];
  sessionNotes: string[];
  priorScope: string[];
  completedTaskIds: string[];
}

export async function gatherPlanningContext(
  rootDir: string,
): Promise<PlanningContext> {
  const ctx: PlanningContext = {
    existingDecisions: [],
    sessionNotes: [],
    priorScope: [],
    completedTaskIds: [],
  };

  try {
    const decisions = await readFile(
      path.join(rootDir, ".omni", "DECISIONS.md"),
      "utf8",
    );
    ctx.existingDecisions = decisions
      .split("\n")
      .filter((line) => line.trim().startsWith("- Decision:"))
      .map((line) => line.replace(/^.*- Decision:\s*/u, "").trim())
      .filter(Boolean);
  } catch {
    /* no decisions file yet */
  }

  try {
    const session = await readFile(
      path.join(rootDir, ".omni", "SESSION-SUMMARY.md"),
      "utf8",
    );
    const progressMatch = session.match(
      /## Recent progress\n\n([\s\S]*?)(?=\n## |$)/u,
    );
    if (progressMatch) {
      ctx.sessionNotes = progressMatch[1]
        .split("\n")
        .map((line) => line.replace(/^- /u, "").trim())
        .filter((line) => line.length > 0 && line !== "-");
    }
  } catch {
    /* no session summary yet */
  }

  try {
    const spec = await readFile(path.join(rootDir, ".omni", "SPEC.md"), "utf8");
    const scopeMatch = spec.match(/## Scope\n\n([\s\S]*?)(?=\n## |$)/u);
    if (scopeMatch) {
      ctx.priorScope = scopeMatch[1]
        .split("\n")
        .map((line) => line.replace(/^- /u, "").trim())
        .filter((line) => line.length > 0);
    }
  } catch {
    /* no spec yet */
  }

  try {
    const tasks = await readFile(
      path.join(rootDir, ".omni", "TASKS.md"),
      "utf8",
    );
    ctx.completedTaskIds = tasks
      .split("\n")
      .filter((line) => line.startsWith("| T") && line.includes("| done |"))
      .map((line) => line.split("|")[1]?.trim())
      .filter((id): id is string => Boolean(id));
  } catch {
    /* no tasks yet */
  }

  return ctx;
}

function buildBootstrapTasks(repoSignals: RepoSignals): TaskBrief[] {
  const tasks: TaskBrief[] = [
    {
      id: "T01",
      title: "Lock the exact user requirements",
      objective:
        "Refine the requested behavior, constraints, and success criteria into an implementation-ready spec.",
      contextFiles: [".omni/PROJECT.md", ".omni/IDEAS.md", ".omni/SPEC.md"],
      skills: ["omni-planning"],
      doneCriteria: [
        "The requested behavior is explicit.",
        "Constraints are captured.",
        "Success criteria are explicit.",
      ],
      role: "worker",
      status: "todo",
      dependsOn: [],
    },
    {
      id: "T02",
      title: "Break the work into the first bounded slice",
      objective:
        "Break the first meaningful delivery slice into bounded tasks with clear verification steps.",
      contextFiles: [".omni/SPEC.md", ".omni/TASKS.md", ".omni/TESTS.md"],
      skills: ["omni-planning"],
      doneCriteria: [
        "The first slice is broken into bounded tasks.",
        "Each task has explicit done criteria.",
        "Verification requirements are listed.",
      ],
      role: "worker",
      status: "todo",
      dependsOn: ["T01"],
    },
  ];

  if (
    repoSignals.tools.includes("playwright") ||
    repoSignals.tools.includes("cypress")
  ) {
    tasks.push({
      id: "T03",
      title: "Document browser verification expectations",
      objective:
        "Document how browser-based checks should be used during future work.",
      contextFiles: [".omni/TESTS.md", ".omni/SPEC.md"],
      skills: ["agent-browser", "omni-verification"],
      doneCriteria: [
        "Browser testing expectations are documented.",
        "The verification plan names the browser toolchain.",
      ],
      role: "worker",
      status: "todo",
      dependsOn: ["T02"],
    });
  }

  return tasks;
}

export function createInitialSpec(
  brief: ConversationBrief,
  repoSignals: RepoSignals,
  planningCtx?: PlanningContext,
): ImplementationSpec {
  const presetConfig: PresetConfig | undefined = brief.preset
    ? WORKFLOW_PRESETS[brief.preset]
    : undefined;
  const scopeItems = [
    brief.summary,
    ...brief.constraints,
    ...brief.userSignals,
    ...(presetConfig
      ? [`Workflow preset: ${presetConfig.name} — ${presetConfig.description}`]
      : []),
  ].filter(Boolean);

  if (planningCtx?.priorScope.length) {
    for (const item of planningCtx.priorScope) {
      if (!scopeItems.includes(item)) {
        scopeItems.push(item);
      }
    }
  }

  const architecture = [
    "Use `.omni/` as the durable project memory layer.",
    "Keep one friendly user-facing brain that interviews first, plans privately, and only then edits code.",
    `Detected repo signals: languages=${repoSignals.languages.join(", ") || "unknown"}; frameworks=${repoSignals.frameworks.join(", ") || "unknown"}; tools=${repoSignals.tools.join(", ") || "unknown"}.`,
  ];

  if (presetConfig) {
    architecture.push(`Implementation hint: ${presetConfig.workerHint}`);
  }

  if (planningCtx?.existingDecisions.length) {
    architecture.push(
      `Prior decisions to honor: ${planningCtx.existingDecisions.join("; ")}`,
    );
  }

  const acceptanceCriteria = [
    "The project direction is captured in `.omni/PROJECT.md` and `.omni/SPEC.md`.",
    "The next tasks are small, verifiable, and ready for implementation.",
    "The verification plan names the checks needed for the first slice.",
  ];

  if (planningCtx?.sessionNotes.length) {
    acceptanceCriteria.push(
      `Build on recent progress: ${planningCtx.sessionNotes.slice(0, 3).join("; ")}`,
    );
  }

  let tasks = buildBootstrapTasks(repoSignals);
  if (presetConfig && tasks.length > presetConfig.maxTasks) {
    tasks = tasks.slice(0, presetConfig.maxTasks);
  }
  if (planningCtx?.completedTaskIds.length) {
    for (const task of tasks) {
      if (planningCtx.completedTaskIds.includes(task.id)) {
        task.status = "done";
      }
    }
  }

  return {
    title: brief.desiredOutcome || "Initial Omni-Pi plan",
    scope: scopeItems,
    architecture,
    taskSlices: tasks,
    acceptanceCriteria,
  };
}

export function renderSpecMarkdown(spec: ImplementationSpec): string {
  return `# Spec

## Title

${spec.title}

## Scope

${spec.scope.map((item) => `- ${item}`).join("\n")}

## Architecture

${spec.architecture.map((item) => `- ${item}`).join("\n")}

## Acceptance Criteria

${spec.acceptanceCriteria.map((item) => `- ${item}`).join("\n")}

## Risks

- To be identified during planning.

## Open Questions

- To be captured during the understand phase.
`;
}

export function renderTasksMarkdown(tasks: TaskBrief[]): string {
  const rows = tasks.map((task) => {
    const dependsOn =
      task.dependsOn.length > 0 ? task.dependsOn.join(", ") : "-";
    const doneCriteria = task.doneCriteria.join("; ");
    return `| ${escapeTaskTableCell(task.id)} | ${escapeTaskTableCell(task.title)} | ${escapeTaskTableCell(dependsOn)} | ${escapeTaskTableCell(task.status)} | ${escapeTaskTableCell(doneCriteria)} |`;
  });

  return `# Tasks

## Task slices

| ID | Title | Depends On | Status | Done Criteria |
| --- | --- | --- | --- | --- |
${rows.join("\n")}
`;
}

export function renderTestsMarkdown(repoSignals: RepoSignals): string {
  const projectChecks = ["npm test"];

  if (repoSignals.tools.includes("vitest")) {
    projectChecks.push("npm run test");
  }

  if (repoSignals.tools.includes("playwright")) {
    projectChecks.push("npx playwright test");
  }

  return `# Tests

## Project-wide checks

${projectChecks.map((check) => `- ${check}`).join("\n")}

## Task-specific checks

- Add task-level checks as each slice is planned.

## Retry policy

- Implementation retries before the plan must be tightened: 2

## Recovery rule

- If the same slice fails repeatedly, tighten the plan, clarify the spec, and retry with a narrower implementation slice.
`;
}
