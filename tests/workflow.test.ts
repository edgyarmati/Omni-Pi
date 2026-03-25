import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, test } from "vitest";

import type { WorkEngine } from "../src/work.js";
import { renderCompactStatus, renderMetrics, renderPlainStatus } from "../src/status.js";
import { applyInstallResults, loadSkillTriggers, matchSkillsForTask, readSkillRegistry } from "../src/skills.js";
import { gatherPlanningContext } from "../src/planning.js";
import { buildBranchName, buildCommitMessage, generatePrBody, prepareCommitPlan } from "../src/git.js";
import { initializeOmniProject, planOmniProject, readOmniStatus, syncOmniProject, workOnOmniProject } from "../src/workflow.js";

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
    expect(result.message).toContain("Verification passed: npm test");
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
    expect(result.message).toContain("Verification failed: npm test");
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
    expect(secondResult.message).toContain("Verification passed: npm test");
    expect(tasks).toContain("| T01 | Confirm the initial project direction | worker | - | done |");
    expect(escalation).toContain("Worker failure 1");
  });

  test("workOnOmniProject surfaces recovery options when expert also fails", async () => {
    const rootDir = await createTempProject("omni-work-recovery-");
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
      async runExpertTask(task) {
        return {
          summary: `Expert also failed ${task.id}`,
          verification: {
            taskId: task.id,
            passed: false,
            checksRun: ["npm test"],
            failureSummary: ["Expert could not resolve"],
            retryRecommended: false
          }
        };
      }
    };

    await workOnOmniProject(rootDir, engine);
    const result = await workOnOmniProject(rootDir, engine);
    const state = await readOmniStatus(rootDir);

    expect(result.kind).toBe("blocked");
    expect(result.message).toContain("expert escalation");
    expect(result.recoveryOptions).toBeDefined();
    expect(result.recoveryOptions!.length).toBeGreaterThan(0);
    expect(state.currentPhase).toBe("escalate");
    expect(state.recoveryOptions).toBeDefined();
    expect(state.recoveryOptions!.length).toBeGreaterThan(0);

    const rendered = renderPlainStatus(state);
    expect(rendered).toContain("Recovery options:");
  });

  test("gatherPlanningContext collects decisions, session notes, and completed tasks", async () => {
    const rootDir = await createTempProject("omni-plan-ctx-");
    await initializeOmniProject(rootDir);
    await planOmniProject(rootDir, {
      summary: "Build the first slice.",
      desiredOutcome: "Build the first slice.",
      constraints: [],
      userSignals: []
    });

    await syncOmniProject(rootDir, {
      summary: "Completed initial setup",
      decisions: ["Use React for the frontend"],
      nextHandoffNotes: ["Ready for implementation"]
    });

    const ctx = await gatherPlanningContext(rootDir);
    expect(ctx.existingDecisions).toContain("Use React for the frontend");
    expect(ctx.sessionNotes).toContain("Completed initial setup");
    expect(ctx.priorScope.length).toBeGreaterThan(0);
  });

  test("planOmniProject incorporates prior decisions into the spec", async () => {
    const rootDir = await createTempProject("omni-plan-enrich-");
    await initializeOmniProject(rootDir);
    await syncOmniProject(rootDir, {
      summary: "Decided on the architecture",
      decisions: ["Use server components"]
    });

    await planOmniProject(rootDir, {
      summary: "Build a feature.",
      desiredOutcome: "Working feature",
      constraints: [],
      userSignals: []
    });

    const spec = await readFile(path.join(rootDir, ".omni", "SPEC.md"), "utf8");
    expect(spec).toContain("Use server components");
  });

  test("applyInstallResults moves failed skills to deferred", async () => {
    const rootDir = await createTempProject("omni-skill-recovery-");
    await initializeOmniProject(rootDir);

    const recovery = await applyInstallResults(rootDir, [
      { name: "find-skills", success: false, error: "network timeout" }
    ]);

    expect(recovery.deferred).toContain("find-skills");
    const registry = await readSkillRegistry(rootDir);
    expect(registry.deferred.some((s) => s.name === "find-skills")).toBe(true);
    expect(registry.deferred[0].reason).toContain("network timeout");
    expect(registry.installed.some((s) => s.name === "find-skills")).toBe(false);
  });

  test("worker modified files are tracked through escalation", async () => {
    const rootDir = await createTempProject("omni-work-modfiles-");
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
          },
          modifiedFiles: ["src/feature.ts"]
        };
      },
      async runExpertTask(task, escalation) {
        expect(escalation.modifiedFiles).toContain("src/feature.ts");
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

    await workOnOmniProject(rootDir, engine);
    const result = await workOnOmniProject(rootDir, engine);
    expect(result.kind).toBe("expert_completed");
  });

  test("renderCompactStatus produces a widget-friendly status array", async () => {
    const rootDir = await createTempProject("omni-compact-");
    await initializeOmniProject(rootDir);
    const state = await readOmniStatus(rootDir);
    const lines = renderCompactStatus(state);

    expect(lines[0]).toContain("Omni-Pi");
    expect(lines[0]).toContain("[Understand]");
    expect(lines.some((l) => l.includes("Task:"))).toBe(true);
    expect(lines.some((l) => l.includes("Next:"))).toBe(true);
  });

  test("renderMetrics formats agent run history", () => {
    const metrics = renderMetrics(
      [
        { agent: "omni-worker", task: "T01", ts: 1000, status: "ok", duration: 5000 },
        { agent: "omni-worker", task: "T01", ts: 1001, status: "error", duration: 3000, exit: 1 }
      ],
      [{ agent: "omni-expert", task: "T01", ts: 1002, status: "ok", duration: 8000 }]
    );
    expect(metrics).toContain("Worker: 2 runs");
    expect(metrics).toContain("50%");
    expect(metrics).toContain("Expert: 1 runs");
    expect(metrics).toContain("Total: 3 runs");
  });

  test("renderMetrics handles empty history", () => {
    const metrics = renderMetrics([], []);
    expect(metrics).toContain("No agent run history");
  });

  test("loadSkillTriggers and matchSkillsForTask match execution triggers", async () => {
    const skillsDir = path.join(path.dirname(new URL(import.meta.url).pathname), "..", "skills");
    const triggers = await loadSkillTriggers(skillsDir);
    expect(triggers.length).toBeGreaterThan(0);

    const matched = matchSkillsForTask(
      {
        id: "T01",
        title: "Implement the feature",
        objective: "Execute the implementation",
        contextFiles: [],
        skills: [],
        doneCriteria: [],
        role: "worker",
        status: "todo",
        dependsOn: []
      },
      triggers
    );
    expect(matched.some((s) => s.name === "omni-execution")).toBe(true);
  });

  test("buildBranchName and buildCommitMessage format git artifacts", () => {
    const branch = buildBranchName("T01");
    expect(branch).toBe("omni/t01");

    const message = buildCommitMessage({
      id: "T01",
      title: "Add auth flow",
      objective: "Implement authentication",
      contextFiles: [],
      skills: [],
      doneCriteria: ["Auth works"],
      role: "worker",
      status: "done",
      dependsOn: []
    });
    expect(message).toContain("feat(T01): Add auth flow");
    expect(message).toContain("Auth works");
  });

  test("generatePrBody creates a structured PR description", () => {
    const body = generatePrBody(
      {
        id: "T01",
        title: "Add auth",
        objective: "Implement auth",
        contextFiles: [],
        skills: [],
        doneCriteria: ["Works", "Tests pass"],
        role: "worker",
        status: "done",
        dependsOn: []
      },
      "All checks passed"
    );
    expect(body).toContain("Implements T01");
    expect(body).toContain("- [x] Works");
    expect(body).toContain("All checks passed");
  });

  test("prepareCommitPlan reads the last completed task", async () => {
    const rootDir = await createTempProject("omni-commit-plan-");
    await initializeOmniProject(rootDir);
    await planOmniProject(rootDir, {
      summary: "Build a feature.",
      desiredOutcome: "Working feature",
      constraints: [],
      userSignals: []
    });

    const engine: WorkEngine = {
      async runWorkerTask(task) {
        return {
          summary: `Completed ${task.id}`,
          verification: { taskId: task.id, passed: true, checksRun: ["npm test"], failureSummary: [], retryRecommended: false }
        };
      },
      async runExpertTask() { throw new Error("should not run"); }
    };

    await workOnOmniProject(rootDir, engine);
    const plan = await prepareCommitPlan(rootDir);

    expect(plan).not.toBeNull();
    expect(plan!.taskId).toBe("T01");
    expect(plan!.branch).toBe("omni/t01");
    expect(plan!.message).toContain("T01");
  });

  test("userSignals are incorporated into spec scope", async () => {
    const rootDir = await createTempProject("omni-plan-signals-");
    await initializeOmniProject(rootDir);
    await planOmniProject(rootDir, {
      summary: "Build auth.",
      desiredOutcome: "Auth system",
      constraints: [],
      userSignals: ["Primary users: developers"]
    });

    const spec = await readFile(path.join(rootDir, ".omni", "SPEC.md"), "utf8");
    expect(spec).toContain("Primary users: developers");
  });
});
