import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, test } from "vitest";

import type { WorkEngine } from "../src/work.js";
import { renderPlainStatus } from "../src/status.js";
import { readSkillRegistry } from "../src/skills.js";
import { initializeOmniProject, planOmniProject, readOmniStatus, workOnOmniProject } from "../src/workflow.js";

async function createTempProject(prefix: string): Promise<string> {
  return mkdtemp(path.join(os.tmpdir(), prefix));
}

describe("Omni workflow", () => {
  test("initializeOmniProject creates starter files and recommends skills", async () => {
    const rootDir = await createTempProject("omni-init-");

    const result = await initializeOmniProject(rootDir);

    expect(result.created).toContain(".omni/PROJECT.md");
    expect(result.created).toContain(".omni/STATE.md");
    expect(result.created).toContain(".pi/agents/omni-worker.md");
    expect(result.skillCandidates.some((candidate) => candidate.name === "find-skills")).toBe(true);

    const skillsContent = await readFile(path.join(rootDir, ".omni", "SKILLS.md"), "utf8");
    expect(skillsContent).toContain("find-skills");
    expect(skillsContent).toContain("auto-install");
    expect(skillsContent).toContain("Planned install commands:");

    const registry = await readSkillRegistry(rootDir);
    expect(registry.installed[0]?.name).toBe("find-skills");
  });

  test("initializeOmniProject detects repo signals from a TypeScript frontend project", async () => {
    const rootDir = await createTempProject("omni-signals-");

    await writeFile(
      path.join(rootDir, "package.json"),
      JSON.stringify(
        {
          name: "demo",
          dependencies: { react: "1.0.0", next: "1.0.0" },
          devDependencies: { vitest: "1.0.0", typescript: "1.0.0" }
        },
        null,
        2
      ),
      "utf8"
    );

    await writeFile(path.join(rootDir, "playwright.config.ts"), "export default {};", "utf8");
    await writeFile(path.join(rootDir, "tsconfig.json"), "{}", "utf8");

    const result = await initializeOmniProject(rootDir);

    expect(result.repoSignals.languages).toContain("typescript");
    expect(result.repoSignals.frameworks).toContain("react");
    expect(result.repoSignals.frameworks).toContain("nextjs");
    expect(result.repoSignals.tools).toContain("playwright");
    expect(result.skillCandidates.some((candidate) => candidate.name === "browser-test-helpers")).toBe(true);
  });

  test("planOmniProject writes spec, tasks, tests, and updates status", async () => {
    const rootDir = await createTempProject("omni-plan-");
    await initializeOmniProject(rootDir);

    const result = await planOmniProject(rootDir, {
      summary: "Build a guided planning workflow for Omni-Pi.",
      desiredOutcome: "Guided planning workflow",
      constraints: ["Keep tasks small", "Stay beginner-friendly"],
      userSignals: []
    });

    const spec = await readFile(result.specPath, "utf8");
    const tasks = await readFile(result.tasksPath, "utf8");
    const tests = await readFile(result.testsPath, "utf8");

    expect(spec).toContain("Guided planning workflow");
    expect(tasks).toContain("T01");
    expect(tests).toContain("Worker retries before expert takeover: 2");

    const state = await readOmniStatus(rootDir);
    expect(state.currentPhase).toBe("plan");
    expect(state.nextStep).toContain("/omni-work");
  });

  test("readOmniStatus returns a plain-English status summary", async () => {
    const rootDir = await createTempProject("omni-status-");
    await initializeOmniProject(rootDir);

    const status = await readOmniStatus(rootDir);
    const rendered = renderPlainStatus(status);

    expect(rendered).toContain("Phase: Understand");
    expect(rendered).toContain("Active task: Initialize Omni-Pi");
    expect(rendered).toContain("Next step:");
  });

  test("workOnOmniProject completes the next task when worker verification passes", async () => {
    const rootDir = await createTempProject("omni-work-pass-");
    await initializeOmniProject(rootDir);
    await planOmniProject(rootDir, {
      summary: "Build the first slice.",
      desiredOutcome: "Build the first slice.",
      constraints: [],
      userSignals: []
    });

    const engine: WorkEngine = {
      async runWorkerTask(task) {
        return {
          summary: `Completed ${task.id}`,
          verification: {
            taskId: task.id,
            passed: true,
            checksRun: ["npm test"],
            failureSummary: [],
            retryRecommended: false
          }
        };
      },
      async runExpertTask() {
        throw new Error("Expert path should not run");
      }
    };

    const result = await workOnOmniProject(rootDir, engine);
    const tasks = await readFile(path.join(rootDir, ".omni", "TASKS.md"), "utf8");

    expect(result.kind).toBe("completed");
    expect(tasks).toContain("| T01 | Confirm the initial project direction | worker | - | done |");
  });

  test("workOnOmniProject records retryable failures before escalation", async () => {
    const rootDir = await createTempProject("omni-work-retry-");
    await initializeOmniProject(rootDir);
    await planOmniProject(rootDir, {
      summary: "Build the first slice.",
      desiredOutcome: "Build the first slice.",
      constraints: [],
      userSignals: []
    });

    const engine: WorkEngine = {
      async runWorkerTask(task) {
        return {
          summary: `Failed ${task.id}`,
          verification: {
            taskId: task.id,
            passed: false,
            checksRun: ["npm test"],
            failureSummary: ["Unit test failed"],
            retryRecommended: true
          }
        };
      },
      async runExpertTask() {
        throw new Error("Expert path should not run on first failure");
      }
    };

    const result = await workOnOmniProject(rootDir, engine);
    const history = await readFile(path.join(rootDir, ".omni", "tasks", "T01.history.json"), "utf8");

    expect(result.kind).toBe("blocked");
    expect(result.message).toContain("queued for retry");
    expect(history).toContain("Unit test failed");
  });

  test("workOnOmniProject escalates to expert after worker retry limit", async () => {
    const rootDir = await createTempProject("omni-work-escalate-");
    await initializeOmniProject(rootDir);
    await planOmniProject(rootDir, {
      summary: "Build the first slice.",
      desiredOutcome: "Build the first slice.",
      constraints: [],
      userSignals: []
    });

    let workerCalls = 0;
    const engine: WorkEngine = {
      async runWorkerTask(task) {
        workerCalls += 1;
        return {
          summary: `Failed ${task.id}`,
          verification: {
            taskId: task.id,
            passed: false,
            checksRun: ["npm test"],
            failureSummary: [`Worker failure ${workerCalls}`],
            retryRecommended: true
          }
        };
      },
      async runExpertTask(task, escalation) {
        expect(escalation.priorAttempts).toBe(2);
        expect(escalation.failureLogs).toContain("Worker failure 1");
        expect(escalation.failureLogs).toContain("Worker failure 2");
        return {
          summary: `Expert completed ${task.id}`,
          verification: {
            taskId: task.id,
            passed: true,
            checksRun: ["npm test"],
            failureSummary: [],
            retryRecommended: false
          }
        };
      }
    };

    const firstResult = await workOnOmniProject(rootDir, engine);
    const secondResult = await workOnOmniProject(rootDir, engine);
    const tasks = await readFile(path.join(rootDir, ".omni", "TASKS.md"), "utf8");
    const escalation = await readFile(path.join(rootDir, ".omni", "tasks", "T01-ESCALATION.md"), "utf8");

    expect(firstResult.kind).toBe("blocked");
    expect(secondResult.kind).toBe("expert_completed");
    expect(tasks).toContain("| T01 | Confirm the initial project direction | worker | - | done |");
    expect(escalation).toContain("Worker failure 1");
  });
});
