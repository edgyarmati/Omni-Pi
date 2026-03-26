import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  gatherTaskContext,
  renderContextBlocks,
  renderContextSummary,
} from "./context.js";
import type {
  EscalationBrief,
  TaskAttemptResult,
  TaskBrief,
} from "./contracts.js";
import {
  findNextExecutableTask,
  readTasks,
  updateTaskStatus,
  writeTasks,
} from "./tasks.js";

export interface WorkEngine {
  runWorkerTask: (
    task: TaskBrief,
    attempt: number,
  ) => Promise<TaskAttemptResult>;
  runExpertTask: (
    task: TaskBrief,
    escalation: EscalationBrief,
  ) => Promise<TaskAttemptResult>;
}

export interface WorkResult {
  kind: "completed" | "expert_completed" | "blocked" | "idle";
  taskId: string | null;
  message: string;
  recoveryOptions?: string[];
}

export interface WorkDispatchResult {
  kind: "ready" | "idle";
  taskId: string | null;
  prompt: string;
  briefPath?: string;
  message: string;
}

const DEFAULT_RETRY_LIMIT = 2;

async function readRetryLimit(testsPath: string): Promise<number> {
  try {
    const content = await readFile(testsPath, "utf8");
    const match = content.match(
      /(?:Implementation retries before the plan must be tightened|Worker retries before expert takeover):\s*(\d+)/u,
    );
    return match ? Number.parseInt(match[1], 10) : DEFAULT_RETRY_LIMIT;
  } catch {
    return DEFAULT_RETRY_LIMIT;
  }
}

async function ensureTaskDir(rootDir: string): Promise<string> {
  const taskDir = path.join(rootDir, ".omni", "tasks");
  await mkdir(taskDir, { recursive: true });
  return taskDir;
}

function historyPath(taskDir: string, taskId: string): string {
  return path.join(taskDir, `${taskId}.history.json`);
}

async function readTaskHistory(
  taskDir: string,
  taskId: string,
): Promise<TaskAttemptResult[]> {
  try {
    return JSON.parse(
      await readFile(historyPath(taskDir, taskId), "utf8"),
    ) as TaskAttemptResult[];
  } catch {
    return [];
  }
}

async function writeTaskHistory(
  taskDir: string,
  taskId: string,
  history: TaskAttemptResult[],
): Promise<void> {
  await writeFile(
    historyPath(taskDir, taskId),
    JSON.stringify(history, null, 2),
    "utf8",
  );
}

async function writeTaskBrief(taskDir: string, task: TaskBrief): Promise<void> {
  const content = `# ${task.id}: ${task.title}

## Objective

${task.objective}

## Done Criteria

${task.doneCriteria.map((item) => `- ${item}`).join("\n") || "- None yet"}

## Skills

${task.skills.map((item) => `- ${item}`).join("\n") || "- None"}

## Context Files

${task.contextFiles.map((item) => `- ${item}`).join("\n") || "- None"}
`;
  await writeFile(path.join(taskDir, `${task.id}-BRIEF.md`), content, "utf8");
}

export async function prepareNextTaskDispatch(
  rootDir: string,
): Promise<WorkDispatchResult> {
  const tasksPath = path.join(rootDir, ".omni", "TASKS.md");
  const tasks = await readTasks(tasksPath);
  const nextTask = findNextExecutableTask(tasks);

  if (!nextTask) {
    return {
      kind: "idle",
      taskId: null,
      prompt: "",
      message:
        "No executable tasks are available. Refresh the plan or complete dependencies first.",
    };
  }

  const taskDir = await ensureTaskDir(rootDir);
  await writeTaskBrief(taskDir, nextTask);
  await writeTasks(
    tasksPath,
    updateTaskStatus(tasks, nextTask.id, "in_progress"),
  );

  const briefPath = path.join(taskDir, `${nextTask.id}-BRIEF.md`);
  const preReadContext = await gatherTaskContext(rootDir, nextTask, 4000);
  const prompt = [
    "You are working inside an Omni-Pi implementation session.",
    "",
    `Task: ${nextTask.id} - ${nextTask.title}`,
    `Objective: ${nextTask.objective}`,
    "",
    "Read these files first:",
    "- .omni/PROJECT.md",
    "- .omni/SPEC.md",
    "- .omni/TESTS.md",
    `- ${path.relative(rootDir, briefPath)}`,
    ...nextTask.contextFiles.map((file) => `- ${file}`),
    "",
    "Then implement the task, explain the change briefly, and run the planned verification steps before finishing.",
    nextTask.skills.length > 0
      ? `Relevant skills: ${nextTask.skills.join(", ")}`
      : "Relevant skills: none explicitly listed",
    ...(preReadContext.length > 0
      ? [
          "",
          renderContextSummary(preReadContext),
          "",
          "Pre-loaded context (already read for you):",
          renderContextBlocks(preReadContext),
        ]
      : []),
  ].join("\n");

  return {
    kind: "ready",
    taskId: nextTask.id,
    prompt,
    briefPath,
    message: `Prepared ${nextTask.id} for a focused implementation session.`,
  };
}

async function writeRecoveryBrief(
  taskDir: string,
  escalation: EscalationBrief,
): Promise<void> {
  const verificationResultsSection = escalation.verificationResults
    ? escalation.verificationResults
        .map((r) => `- ${r.command}: ${r.passed ? "passed" : "failed"}`)
        .join("\n")
    : "- None recorded";
  const modifiedFilesSection =
    escalation.modifiedFiles?.map((f) => `- ${f}`).join("\n") ||
    "- None recorded";

  const content = `# Recovery for ${escalation.taskId}

## Prior Attempts

${escalation.priorAttempts}

## Failure Logs

${escalation.failureLogs.map((item) => `- ${item}`).join("\n") || "- None"}

## Verification Results

${verificationResultsSection}

## Modified Files

${modifiedFilesSection}

## Recovery Objective

${escalation.expertObjective}
`;
  await writeFile(
    path.join(taskDir, `${escalation.taskId}-RECOVERY.md`),
    content,
    "utf8",
  );
}

function createEscalationBrief(
  task: TaskBrief,
  history: TaskAttemptResult[],
): EscalationBrief {
  const failureLogs = history
    .filter((attempt) => !attempt.verification.passed)
    .map((attempt) => attempt.verification.failureSummary.join("; "))
    .filter((log) => log.length > 0);

  const verificationResults = history.flatMap((attempt) =>
    attempt.verification.checksRun.map((command) => ({
      command,
      passed: attempt.verification.passed,
      stdout: "",
      stderr: attempt.verification.failureSummary.join("\n"),
    })),
  );

  const modifiedFiles = [
    ...new Set(history.flatMap((attempt) => attempt.modifiedFiles ?? [])),
  ];

  return {
    taskId: task.id,
    priorAttempts: history.length,
    failureLogs,
    expertObjective: `Resolve the root cause preventing ${task.id} from passing verification and complete the task.`,
    verificationResults,
    modifiedFiles,
  };
}

function formatVerificationSummary(result: TaskAttemptResult): string {
  const checks =
    result.verification.checksRun.length > 0
      ? result.verification.checksRun.join(", ")
      : "no recorded checks";
  if (result.verification.passed) {
    return `Verification passed: ${checks}.`;
  }
  const failures =
    result.verification.failureSummary.length > 0
      ? result.verification.failureSummary.join("; ")
      : "unknown verification failure";
  return `Verification failed: ${checks}. Reason: ${failures}.`;
}

export async function executeNextTask(
  rootDir: string,
  engine: WorkEngine,
): Promise<WorkResult> {
  const tasksPath = path.join(rootDir, ".omni", "TASKS.md");
  const testsPath = path.join(rootDir, ".omni", "TESTS.md");
  const tasks = await readTasks(tasksPath);
  const nextTask = findNextExecutableTask(tasks);

  if (!nextTask) {
    return {
      kind: "idle",
      taskId: null,
      message:
        "No executable tasks are available. Complete dependencies or refresh the plan first.",
    };
  }

  const taskDir = await ensureTaskDir(rootDir);
  await writeTaskBrief(taskDir, nextTask);

  const history = await readTaskHistory(taskDir, nextTask.id);
  const retryLimit = await readRetryLimit(testsPath);
  const attempt = history.length + 1;
  const implementationResult = await engine.runWorkerTask(nextTask, attempt);
  const implementationHistory = [...history, implementationResult];
  await writeTaskHistory(taskDir, nextTask.id, implementationHistory);

  if (implementationResult.verification.passed) {
    await writeTasks(tasksPath, updateTaskStatus(tasks, nextTask.id, "done"));
    return {
      kind: "completed",
      taskId: nextTask.id,
      message: `Completed ${nextTask.id} in the implementation pass. ${formatVerificationSummary(implementationResult)}`,
    };
  }

  if (attempt < retryLimit) {
    await writeTasks(tasksPath, updateTaskStatus(tasks, nextTask.id, "todo"));
    return {
      kind: "blocked",
      taskId: nextTask.id,
      message: `Implementation attempt ${attempt} for ${nextTask.id} failed verification and is queued for retry. ${formatVerificationSummary(implementationResult)}`,
    };
  }

  const escalation = createEscalationBrief(nextTask, implementationHistory);
  await writeRecoveryBrief(taskDir, escalation);
  const expertResult = await engine.runExpertTask(nextTask, escalation);
  await writeTaskHistory(taskDir, nextTask.id, [
    ...implementationHistory,
    expertResult,
  ]);

  if (expertResult.verification.passed) {
    await writeTasks(tasksPath, updateTaskStatus(tasks, nextTask.id, "done"));
    return {
      kind: "expert_completed",
      taskId: nextTask.id,
      message: `Completed ${nextTask.id} after a recovery pass. ${formatVerificationSummary(expertResult)}`,
    };
  }

  await writeTasks(tasksPath, updateTaskStatus(tasks, nextTask.id, "blocked"));
  return {
    kind: "blocked",
    taskId: nextTask.id,
    message: `Task ${nextTask.id} remains blocked after repeated implementation attempts and a recovery pass. ${formatVerificationSummary(expertResult)}`,
    recoveryOptions: [
      "Review the recovery notes in `.omni/tasks/` and refine the task inputs.",
      "Restructure the task into smaller slices.",
      "Sync the latest learnings into `.omni/` before attempting a different approach.",
      "Manually inspect and fix the failing checks listed in `.omni/TESTS.md`.",
    ],
  };
}
