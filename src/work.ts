import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import type { EscalationBrief, TaskAttemptResult, TaskBrief } from "./contracts.js";
import { findNextExecutableTask, readTasks, updateTaskStatus, writeTasks } from "./tasks.js";

export interface WorkEngine {
  runWorkerTask: (task: TaskBrief, attempt: number) => Promise<TaskAttemptResult>;
  runExpertTask: (task: TaskBrief, escalation: EscalationBrief) => Promise<TaskAttemptResult>;
}

export interface WorkResult {
  kind: "completed" | "expert_completed" | "blocked" | "idle";
  taskId: string | null;
  message: string;
}

const DEFAULT_RETRY_LIMIT = 2;

async function readRetryLimit(testsPath: string): Promise<number> {
  try {
    const content = await readFile(testsPath, "utf8");
    const match = content.match(/Worker retries before expert takeover:\s*(\d+)/u);
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

async function readTaskHistory(taskDir: string, taskId: string): Promise<TaskAttemptResult[]> {
  try {
    return JSON.parse(await readFile(historyPath(taskDir, taskId), "utf8")) as TaskAttemptResult[];
  } catch {
    return [];
  }
}

async function writeTaskHistory(taskDir: string, taskId: string, history: TaskAttemptResult[]): Promise<void> {
  await writeFile(historyPath(taskDir, taskId), JSON.stringify(history, null, 2), "utf8");
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

async function writeEscalationBrief(taskDir: string, escalation: EscalationBrief): Promise<void> {
  const content = `# Escalation for ${escalation.taskId}

## Prior Attempts

${escalation.priorAttempts}

## Failure Logs

${escalation.failureLogs.map((item) => `- ${item}`).join("\n") || "- None"}

## Expert Objective

${escalation.expertObjective}
`;
  await writeFile(path.join(taskDir, `${escalation.taskId}-ESCALATION.md`), content, "utf8");
}

function createEscalationBrief(task: TaskBrief, history: TaskAttemptResult[]): EscalationBrief {
  return {
    taskId: task.id,
    priorAttempts: history.length,
    failureLogs: history.flatMap((attempt) => attempt.verification.failureSummary),
    expertObjective: `Complete ${task.title} by resolving the repeated verification failures.`
  };
}

export async function executeNextTask(rootDir: string, engine: WorkEngine): Promise<WorkResult> {
  const tasksPath = path.join(rootDir, ".omni", "TASKS.md");
  const testsPath = path.join(rootDir, ".omni", "TESTS.md");
  const tasks = await readTasks(tasksPath);
  const nextTask = findNextExecutableTask(tasks);

  if (!nextTask) {
    return {
      kind: "idle",
      taskId: null,
      message: "No executable tasks are available. Complete dependencies or refresh the plan first."
    };
  }

  const taskDir = await ensureTaskDir(rootDir);
  await writeTaskBrief(taskDir, nextTask);

  const history = await readTaskHistory(taskDir, nextTask.id);
  const retryLimit = await readRetryLimit(testsPath);
  const attempt = history.length + 1;
  const workerResult = await engine.runWorkerTask(nextTask, attempt);
  const workerHistory = [...history, workerResult];
  await writeTaskHistory(taskDir, nextTask.id, workerHistory);

  if (workerResult.verification.passed) {
    await writeTasks(tasksPath, updateTaskStatus(tasks, nextTask.id, "done"));
    return {
      kind: "completed",
      taskId: nextTask.id,
      message: `Completed ${nextTask.id} with the worker path.`
    };
  }

  if (attempt < retryLimit) {
    await writeTasks(tasksPath, updateTaskStatus(tasks, nextTask.id, "todo"));
    return {
      kind: "blocked",
      taskId: nextTask.id,
      message: `Worker attempt ${attempt} for ${nextTask.id} failed verification and is queued for retry.`
    };
  }

  const escalation = createEscalationBrief(nextTask, workerHistory);
  await writeEscalationBrief(taskDir, escalation);
  const expertResult = await engine.runExpertTask(nextTask, escalation);
  await writeTaskHistory(taskDir, nextTask.id, [...workerHistory, expertResult]);

  if (expertResult.verification.passed) {
    await writeTasks(tasksPath, updateTaskStatus(tasks, nextTask.id, "done"));
    return {
      kind: "expert_completed",
      taskId: nextTask.id,
      message: `Completed ${nextTask.id} after expert escalation.`
    };
  }

  await writeTasks(tasksPath, updateTaskStatus(tasks, nextTask.id, "blocked"));
  return {
    kind: "blocked",
    taskId: nextTask.id,
    message: `Task ${nextTask.id} remains blocked after worker retries and expert escalation.`
  };
}
