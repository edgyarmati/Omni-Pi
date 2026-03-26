import { readFile, writeFile } from "node:fs/promises";

import type { TaskBrief, TaskStatus } from "./contracts.js";

function parseRow(row: string): TaskBrief | null {
  const columns = row
    .split("|")
    .slice(1, -1)
    .map((column) => column.trim());

  if (columns.length !== 6) {
    return null;
  }

  const [id, title, role, dependsOn, status, doneCriteria] = columns;
  return {
    id,
    title,
    objective: title,
    contextFiles: [],
    skills: [],
    doneCriteria:
      doneCriteria === "-"
        ? []
        : doneCriteria
            .split(";")
            .map((item) => item.trim())
            .filter(Boolean),
    role: role === "expert" ? "expert" : "worker",
    status: (status as TaskStatus) || "todo",
    dependsOn:
      dependsOn === "-"
        ? []
        : dependsOn
            .split(",")
            .map((item) => item.trim())
            .filter(Boolean),
  };
}

export async function readTasks(taskPath: string): Promise<TaskBrief[]> {
  const content = await readFile(taskPath, "utf8");
  return content
    .split("\n")
    .filter((line) => line.startsWith("| T"))
    .map(parseRow)
    .filter((task): task is TaskBrief => task !== null);
}

export function renderTaskTable(tasks: TaskBrief[]): string {
  const rows = tasks.map((task) => {
    const dependsOn =
      task.dependsOn.length > 0 ? task.dependsOn.join(", ") : "-";
    const doneCriteria =
      task.doneCriteria.length > 0 ? task.doneCriteria.join("; ") : "-";
    return `| ${task.id} | ${task.title} | ${task.role} | ${dependsOn} | ${task.status} | ${doneCriteria} |`;
  });

  return `# Tasks

## Task slices

| ID | Title | Role | Depends On | Status | Done Criteria |
| --- | --- | --- | --- | --- | --- |
${rows.join("\n")}
`;
}

export async function writeTasks(
  taskPath: string,
  tasks: TaskBrief[],
): Promise<void> {
  await writeFile(taskPath, renderTaskTable(tasks), "utf8");
}

export function findNextExecutableTask(tasks: TaskBrief[]): TaskBrief | null {
  const doneIds = new Set(
    tasks.filter((task) => task.status === "done").map((task) => task.id),
  );

  for (const task of tasks) {
    if (task.status !== "todo") {
      continue;
    }

    if (task.dependsOn.every((dependency) => doneIds.has(dependency))) {
      return task;
    }
  }

  return null;
}

export function updateTaskStatus(
  tasks: TaskBrief[],
  taskId: string,
  status: TaskStatus,
): TaskBrief[] {
  return tasks.map((task) => (task.id === taskId ? { ...task, status } : task));
}
