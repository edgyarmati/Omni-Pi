import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, test } from "vitest";
import { readConfig, writeConfig } from "../src/config.js";
import {
  consumeBudget,
  createBudget,
  estimateTokens,
  fitsInBudget,
  gatherPhaseContext,
  gatherTaskContext,
  getPhaseFiles,
  renderContextSummary,
} from "../src/context.js";
import { detectPreset } from "../src/contracts.js";
import { detectStuck, renderDoctorReport, runDoctor } from "../src/doctor.js";
import {
  buildBranchName,
  buildCommitMessage,
  generatePrBody,
  prepareCommitPlan,
} from "../src/git.js";
import { gatherPlanningContext, renderTasksMarkdown } from "../src/planning.js";
import {
  appendProgress,
  cleanupCompletedPlans,
  createPlan,
  readPlanIndex,
  readProgress,
  renderPlanIndex,
  updatePlanStatus,
} from "../src/plans.js";
import {
  applyInstallResults,
  loadSkillTriggers,
  matchSkillsForTask,
  readSkillRegistry,
} from "../src/skills.js";
import {
  renderCompactStatus,
  renderMetrics,
  renderPlainStatus,
} from "../src/status.js";
import {
  findNextExecutableTask,
  readTasks,
  renderTaskTable,
  updateTaskStatus,
} from "../src/tasks.js";
import type { WorkEngine } from "../src/work.js";
import {
  initializeOmniProject,
  planOmniProject,
  readOmniStatus,
  syncOmniProject,
  workOnOmniProject,
} from "../src/workflow.js";

async function createTempProject(prefix: string): Promise<string> {
  return mkdtemp(path.join(os.tmpdir(), prefix));
}

describe("Omni workflow", () => {
  test("initializeOmniProject creates starter files and recommends skills", async () => {
    const rootDir = await createTempProject("omni-init-");

    const result = await initializeOmniProject(rootDir);

    expect(result.created).toContain(".omni/PROJECT.md");
    expect(result.created).toContain(".omni/STATE.md");
    expect(result.created).toContain(".pi/agents/omni-brain.md");
    expect(
      result.skillCandidates.some(
        (candidate) => candidate.name === "find-skills",
      ),
    ).toBe(true);

    const skillsContent = await readFile(
      path.join(rootDir, ".omni", "SKILLS.md"),
      "utf8",
    );
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
          devDependencies: { vitest: "1.0.0", typescript: "1.0.0" },
        },
        null,
        2,
      ),
      "utf8",
    );

    await writeFile(
      path.join(rootDir, "playwright.config.ts"),
      "export default {};",
      "utf8",
    );
    await writeFile(path.join(rootDir, "tsconfig.json"), "{}", "utf8");

    const result = await initializeOmniProject(rootDir);

    expect(result.repoSignals.languages).toContain("typescript");
    expect(result.repoSignals.frameworks).toContain("react");
    expect(result.repoSignals.frameworks).toContain("nextjs");
    expect(result.repoSignals.tools).toContain("playwright");
    expect(
      result.skillCandidates.some(
        (candidate) => candidate.name === "browser-test-helpers",
      ),
    ).toBe(true);
  });

  test("initializeOmniProject detects Python, Go, and Rust projects", async () => {
    const rootDir = await createTempProject("omni-signals-multi-");
    await writeFile(path.join(rootDir, "requirements.txt"), "flask\n", "utf8");
    await writeFile(path.join(rootDir, "go.mod"), "module example\n", "utf8");
    await writeFile(path.join(rootDir, "Cargo.toml"), "[package]\n", "utf8");
    await writeFile(path.join(rootDir, "Makefile"), "all:\n", "utf8");

    const result = await initializeOmniProject(rootDir);

    expect(result.repoSignals.languages).toContain("python");
    expect(result.repoSignals.languages).toContain("go");
    expect(result.repoSignals.languages).toContain("rust");
    expect(result.repoSignals.tools).toContain("make");
  });

  test("initializeOmniProject marks sparse repos as needing onboarding interview", async () => {
    const rootDir = await createTempProject("omni-init-onboarding-");

    const result = await initializeOmniProject(rootDir);
    const state = await readOmniStatus(rootDir);

    expect(result.onboardingInterviewNeeded).toBe(true);
    expect(result.onboardingReason).toContain("First-run onboarding needed");
    expect(state.activeTask).toBe("Run onboarding interview");
    expect(state.nextStep).toContain("Run a short onboarding interview");
  });

  test("initializeOmniProject skips onboarding interview for well-documented repos", async () => {
    const rootDir = await createTempProject("omni-init-docs-clear-");
    await writeFile(
      path.join(rootDir, "package.json"),
      JSON.stringify({
        name: "clear-repo",
        description: "A documented product for operations teams to manage deployment workflows safely.",
      }),
      "utf8",
    );
    await writeFile(
      path.join(rootDir, "README.md"),
      `# Clear Repo

This product helps operations teams manage deployment workflows safely across multiple environments. It exists to reduce release errors and make approvals auditable. Success means teams can ship with fewer incidents and a clear record of why each deployment happened.

## Users

Platform engineers, release managers, and operators use the system every day.

## Constraints

The product must preserve audit history, avoid surprise downtime, and keep rollback steps explicit. Non-goals include replacing the underlying CI provider or storing long-term secrets.
`,
      "utf8",
    );
    await mkdir(path.join(rootDir, "docs"), { recursive: true });
    await writeFile(
      path.join(rootDir, "docs", "architecture.md"),
      "# Architecture\n\nSystem overview.",
      "utf8",
    );
    await writeFile(
      path.join(rootDir, "docs", "constraints.md"),
      "# Constraints\n\nOperational limits and non-goals.",
      "utf8",
    );

    const result = await initializeOmniProject(rootDir);
    const state = await readOmniStatus(rootDir);

    expect(result.onboardingInterviewNeeded).toBe(false);
    expect(state.activeTask).toBe("Capture exact requirements");
  });

  test("planOmniProject writes spec, tasks, tests, and updates status", async () => {
    const rootDir = await createTempProject("omni-plan-");
    await initializeOmniProject(rootDir);

    const result = await planOmniProject(rootDir, {
      summary: "Build a guided planning workflow for Omni-Pi.",
      desiredOutcome: "Guided planning workflow",
      constraints: ["Keep tasks small", "Stay beginner-friendly"],
      userSignals: [],
    });

    const spec = await readFile(result.specPath, "utf8");
    const tasks = await readFile(result.tasksPath, "utf8");
    const tests = await readFile(result.testsPath, "utf8");

    expect(spec).toContain("Guided planning workflow");
    expect(tasks).toContain("T01");
    expect(tests).toContain(
      "Implementation retries before the plan must be tightened: 2",
    );

    const state = await readOmniStatus(rootDir);
    expect(state.currentPhase).toBe("plan");
    expect(state.nextStep).toContain("Implement the next bounded slice");
  });

  test("readOmniStatus returns a plain-English status summary", async () => {
    const rootDir = await createTempProject("omni-status-");
    await initializeOmniProject(rootDir);

    const status = await readOmniStatus(rootDir);
    const rendered = renderPlainStatus(status);

    expect(rendered).toContain("Phase: Understand");
    expect(rendered).toContain("Active task: Run onboarding interview");
    expect(rendered).toContain("Next step:");
  });

  test("workOnOmniProject completes the next task when worker verification passes", async () => {
    const rootDir = await createTempProject("omni-work-pass-");
    await initializeOmniProject(rootDir);
    await planOmniProject(rootDir, {
      summary: "Build the first slice.",
      desiredOutcome: "Build the first slice.",
      constraints: [],
      userSignals: [],
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
            retryRecommended: false,
          },
        };
      },
      async runExpertTask() {
        throw new Error("Expert path should not run");
      },
    };

    const result = await workOnOmniProject(rootDir, engine);
    const tasks = await readFile(
      path.join(rootDir, ".omni", "TASKS.md"),
      "utf8",
    );

    expect(result.kind).toBe("completed");
    expect(result.message).toContain("Verification passed: npm test");
    expect(tasks).toContain(
      "| T01 | Lock the exact user requirements | - | done |",
    );
  });

  test("workOnOmniProject records retryable failures before recovery", async () => {
    const rootDir = await createTempProject("omni-work-retry-");
    await initializeOmniProject(rootDir);
    await planOmniProject(rootDir, {
      summary: "Build the first slice.",
      desiredOutcome: "Build the first slice.",
      constraints: [],
      userSignals: [],
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
            retryRecommended: true,
          },
        };
      },
      async runExpertTask() {
        throw new Error("Expert path should not run on first failure");
      },
    };

    const result = await workOnOmniProject(rootDir, engine);
    const history = await readFile(
      path.join(rootDir, ".omni", "tasks", "T01.history.json"),
      "utf8",
    );

    expect(result.kind).toBe("blocked");
    expect(result.message).toContain("queued for retry");
    expect(result.message).toContain("Verification failed: npm test");
    expect(history).toContain("Unit test failed");
  });

  test("workOnOmniProject uses a recovery pass after the retry limit", async () => {
    const rootDir = await createTempProject("omni-work-escalate-");
    await initializeOmniProject(rootDir);
    await planOmniProject(rootDir, {
      summary: "Build the first slice.",
      desiredOutcome: "Build the first slice.",
      constraints: [],
      userSignals: [],
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
            retryRecommended: true,
          },
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
            retryRecommended: false,
          },
        };
      },
    };

    const firstResult = await workOnOmniProject(rootDir, engine);
    const secondResult = await workOnOmniProject(rootDir, engine);
    const tasks = await readFile(
      path.join(rootDir, ".omni", "TASKS.md"),
      "utf8",
    );
    const recovery = await readFile(
      path.join(rootDir, ".omni", "tasks", "T01-RECOVERY.md"),
      "utf8",
    );

    expect(firstResult.kind).toBe("blocked");
    expect(secondResult.kind).toBe("expert_completed");
    expect(secondResult.message).toContain("Verification passed: npm test");
    expect(tasks).toContain(
      "| T01 | Lock the exact user requirements | - | done |",
    );
    expect(recovery).toContain("Worker failure 1");
  });

  test("workOnOmniProject surfaces recovery options when the recovery pass also fails", async () => {
    const rootDir = await createTempProject("omni-work-recovery-");
    await initializeOmniProject(rootDir);
    await planOmniProject(rootDir, {
      summary: "Build the first slice.",
      desiredOutcome: "Build the first slice.",
      constraints: [],
      userSignals: [],
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
            retryRecommended: true,
          },
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
            retryRecommended: false,
          },
        };
      },
    };

    await workOnOmniProject(rootDir, engine);
    const result = await workOnOmniProject(rootDir, engine);
    const state = await readOmniStatus(rootDir);

    expect(result.kind).toBe("blocked");
    expect(result.message).toContain("recovery pass");
    expect(result.recoveryOptions).toBeDefined();
    expect(result.recoveryOptions?.length).toBeGreaterThan(0);
    expect(state.currentPhase).toBe("escalate");
    expect(state.recoveryOptions).toBeDefined();
    expect(state.recoveryOptions?.length).toBeGreaterThan(0);

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
      userSignals: [],
    });

    await syncOmniProject(rootDir, {
      summary: "Completed initial setup",
      decisions: ["Use React for the frontend"],
      nextHandoffNotes: ["Ready for implementation"],
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
      decisions: ["Use server components"],
    });

    await planOmniProject(rootDir, {
      summary: "Build a feature.",
      desiredOutcome: "Working feature",
      constraints: [],
      userSignals: [],
    });

    const spec = await readFile(path.join(rootDir, ".omni", "SPEC.md"), "utf8");
    expect(spec).toContain("Use server components");
  });

  test("planOmniProject archives unrelated prior tasks and resets carried task state", async () => {
    const rootDir = await createTempProject("omni-plan-unrelated-");
    await initializeOmniProject(rootDir);
    await planOmniProject(rootDir, {
      summary: "Build auth flow",
      desiredOutcome: "Auth flow",
      constraints: [],
      userSignals: [],
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
            retryRecommended: false,
          },
        };
      },
      async runExpertTask() {
        throw new Error("should not run");
      },
    };

    await workOnOmniProject(rootDir, engine);
    await planOmniProject(rootDir, {
      summary: "Fix payment webhook retries",
      desiredOutcome: "Webhook reliability",
      constraints: [],
      userSignals: [],
    });

    const spec = await readFile(path.join(rootDir, ".omni", "SPEC.md"), "utf8");
    const tasks = await readFile(path.join(rootDir, ".omni", "TASKS.md"), "utf8");
    const sessionSummary = await readFile(
      path.join(rootDir, ".omni", "SESSION-SUMMARY.md"),
      "utf8",
    );
    const plans = await readPlanIndex(rootDir);

    expect(spec).toContain("Webhook reliability");
    expect(spec).not.toContain("Build auth flow");
    expect(tasks).toContain(
      "| T01 | Lock the exact user requirements | - | todo |",
    );
    expect(sessionSummary).toContain("## Archived task summaries");
    expect(sessionSummary).toContain("Auth flow");
    expect(sessionSummary).toContain("T01 (done): Lock the exact user requirements");
    expect(plans.some((plan) => plan.status === "discarded")).toBe(true);
  });

  test("planOmniProject keeps carried task state for related follow-up requests", async () => {
    const rootDir = await createTempProject("omni-plan-related-");
    await initializeOmniProject(rootDir);
    await planOmniProject(rootDir, {
      summary: "Build auth flow",
      desiredOutcome: "Auth flow",
      constraints: [],
      userSignals: [],
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
            retryRecommended: false,
          },
        };
      },
      async runExpertTask() {
        throw new Error("should not run");
      },
    };

    await workOnOmniProject(rootDir, engine);
    await planOmniProject(rootDir, {
      summary: "Improve auth error handling",
      desiredOutcome: "Auth error handling",
      constraints: [],
      userSignals: [],
    });

    const tasks = await readFile(path.join(rootDir, ".omni", "TASKS.md"), "utf8");
    const sessionSummary = await readFile(
      path.join(rootDir, ".omni", "SESSION-SUMMARY.md"),
      "utf8",
    );

    expect(tasks).toContain(
      "| T01 | Lock the exact user requirements | - | done |",
    );
    expect(sessionSummary).not.toContain("## Archived task summaries");
  });

  test("applyInstallResults moves failed skills to deferred", async () => {
    const rootDir = await createTempProject("omni-skill-recovery-");
    await initializeOmniProject(rootDir);

    const recovery = await applyInstallResults(rootDir, [
      { name: "find-skills", success: false, error: "network timeout" },
    ]);

    expect(recovery.deferred).toContain("find-skills");
    const registry = await readSkillRegistry(rootDir);
    expect(registry.deferred.some((s) => s.name === "find-skills")).toBe(true);
    expect(registry.deferred[0].reason).toContain("network timeout");
    expect(registry.installed.some((s) => s.name === "find-skills")).toBe(
      false,
    );
  });

  test("worker modified files are tracked through escalation", async () => {
    const rootDir = await createTempProject("omni-work-modfiles-");
    await initializeOmniProject(rootDir);
    await planOmniProject(rootDir, {
      summary: "Build the first slice.",
      desiredOutcome: "Build the first slice.",
      constraints: [],
      userSignals: [],
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
            retryRecommended: true,
          },
          modifiedFiles: ["src/feature.ts"],
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
            retryRecommended: false,
          },
        };
      },
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

    expect(lines[0]).toContain("Omni-Pi Brain");
    expect(lines.some((l) => l.includes("Focus:"))).toBe(true);
    expect(lines.some((l) => l.includes("Next:"))).toBe(true);
  });

  test("renderCompactStatus falls back gracefully for unknown phases", () => {
    const lines = renderCompactStatus({
      currentPhase: "weird-phase" as never,
      activeTask: "Await user feedback",
      statusSummary: "Waiting for clarification.",
      blockers: [],
      nextStep: "Answer the open questions.",
    });

    expect(lines[0]).toBe("Omni-Pi Brain");
  });

  test("renderCompactStatus shows working only when not awaiting user input", () => {
    const lines = renderCompactStatus({
      currentPhase: "build",
      activeTask: "Implement the next slice",
      statusSummary: "Implementing the requested change.",
      blockers: [],
      nextStep: "Run the planned verification checks.",
    });

    expect(lines[0]).toContain("[Working]");
  });

  test("renderMetrics formats agent run history", () => {
    const metrics = renderMetrics(
      [
        {
          agent: "omni-worker",
          task: "T01",
          ts: 1000,
          status: "ok",
          duration: 5000,
        },
        {
          agent: "omni-worker",
          task: "T01",
          ts: 1001,
          status: "error",
          duration: 3000,
          exit: 1,
        },
      ],
      [
        {
          agent: "omni-expert",
          task: "T01",
          ts: 1002,
          status: "ok",
          duration: 8000,
        },
      ],
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
    const skillsDir = path.join(
      path.dirname(new URL(import.meta.url).pathname),
      "..",
      "skills",
    );
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
        dependsOn: [],
      },
      triggers,
    );
    expect(matched.some((s) => s.name === "omni-execution")).toBe(true);
  });

  test("loadSkillTriggers captures all trigger keywords from skill descriptions", async () => {
    const skillsDir = path.join(
      path.dirname(new URL(import.meta.url).pathname),
      "..",
      "skills",
    );
    const triggers = await loadSkillTriggers(skillsDir);
    const verification = triggers.find((t) => t.name === "omni-verification");
    expect(verification).toBeDefined();
    expect(verification?.triggers).toContain("verify");
    expect(verification?.triggers).toContain("test");
    expect(verification?.triggers).toContain("check");
    expect(verification?.triggers).toContain("did it work");
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
      dependsOn: [],
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
        dependsOn: [],
      },
      "All checks passed",
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
      userSignals: [],
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
            retryRecommended: false,
          },
        };
      },
      async runExpertTask() {
        throw new Error("should not run");
      },
    };

    await workOnOmniProject(rootDir, engine);
    const plan = await prepareCommitPlan(rootDir);

    expect(plan).not.toBeNull();
    expect(plan?.taskId).toBe("T01");
    expect(plan?.branch).toBe("omni/t01");
    expect(plan?.message).toContain("T01");
  });

  test("userSignals are incorporated into spec scope", async () => {
    const rootDir = await createTempProject("omni-plan-signals-");
    await initializeOmniProject(rootDir);
    await planOmniProject(rootDir, {
      summary: "Build auth.",
      desiredOutcome: "Auth system",
      constraints: [],
      userSignals: ["Primary users: developers"],
    });

    const spec = await readFile(path.join(rootDir, ".omni", "SPEC.md"), "utf8");
    expect(spec).toContain("Primary users: developers");
  });

  test("detectPreset infers workflow from branch name and brief", () => {
    expect(detectPreset("fix/login-loop", "")).toBe("bugfix");
    expect(detectPreset("", "refactor the auth module")).toBe("refactor");
    expect(detectPreset("feat/oauth", "")).toBe("feature");
    expect(detectPreset("", "spike on new API")).toBe("spike");
    expect(detectPreset("", "security audit of payment module")).toBe(
      "security-audit",
    );
    expect(detectPreset("main", "")).toBeNull();
  });

  test("planOmniProject respects bugfix preset by limiting tasks", async () => {
    const rootDir = await createTempProject("omni-plan-preset-");
    await initializeOmniProject(rootDir);
    await planOmniProject(rootDir, {
      summary: "Fix the login redirect loop",
      desiredOutcome: "Login works",
      constraints: [],
      userSignals: [],
      preset: "bugfix",
    });

    const spec = await readFile(path.join(rootDir, ".omni", "SPEC.md"), "utf8");
    const tasks = await readFile(
      path.join(rootDir, ".omni", "TASKS.md"),
      "utf8",
    );

    expect(spec).toContain("bugfix");
    expect(spec).toContain("root cause");
    const taskRows = tasks.split("\n").filter((line) => line.startsWith("| T"));
    expect(taskRows.length).toBeLessThanOrEqual(2);
  });

  test("readConfig parses a written CONFIG.md correctly", async () => {
    const rootDir = await createTempProject("omni-config-");
    await initializeOmniProject(rootDir);

    await writeConfig(rootDir, {
      models: {
        worker: "google/gemini-2.5-pro",
        expert: "openai/gpt-5.4",
        planner: "anthropic/claude-opus-4-6",
        brain: "anthropic/claude-opus-4-6",
      },
      retryLimit: 5,
      chainEnabled: true,
    });

    const config = await readConfig(rootDir);
    expect(config.models.worker).toBe("google/gemini-2.5-pro");
    expect(config.models.expert).toBe("openai/gpt-5.4");
    expect(config.models.planner).toBe("anthropic/claude-opus-4-6");
    expect(config.retryLimit).toBe(5);
    expect(config.chainEnabled).toBe(true);
  });

  test("runDoctor reports healthy on an initialized project", async () => {
    const rootDir = await createTempProject("omni-doctor-");
    await initializeOmniProject(rootDir);
    await writeFile(
      path.join(rootDir, "package.json"),
      JSON.stringify({ name: "test", devDependencies: { typescript: "1" } }),
      "utf8",
    );
    await writeFile(path.join(rootDir, "tsconfig.json"), "{}", "utf8");

    const report = await runDoctor(rootDir);
    expect(report.overall).toBe("green");
    expect(
      report.checks.some((c) => c.name === "omni-init" && c.level === "green"),
    ).toBe(true);

    const rendered = renderDoctorReport(report);
    expect(rendered).toContain("[OK] green");
  });

  test("runDoctor reports red when .omni/ is missing", async () => {
    const rootDir = await createTempProject("omni-doctor-missing-");
    const report = await runDoctor(rootDir);
    expect(report.overall).toBe("red");
    expect(
      report.checks.some((c) => c.name === "omni-init" && c.level === "red"),
    ).toBe(true);
  });

  test("createPlan writes a plan file and updates the index", async () => {
    const rootDir = await createTempProject("omni-plans-");
    await initializeOmniProject(rootDir);

    const entry = await createPlan(rootDir, "Add auth", "Implement auth flow", [
      "Setup JWT",
      "Add login endpoint",
    ]);

    expect(entry.status).toBe("active");
    expect(entry.title).toBe("Add auth");

    const index = await readPlanIndex(rootDir);
    expect(index).toHaveLength(1);
    expect(index[0].id).toBe(entry.id);

    const planFile = await readFile(
      path.join(rootDir, ".omni", "plans", `${entry.id}.md`),
      "utf8",
    );
    expect(planFile).toContain("# Add auth");
    expect(planFile).toContain("Setup JWT");
    expect(planFile).toContain("Add login endpoint");
  });

  test("updatePlanStatus marks a plan as completed", async () => {
    const rootDir = await createTempProject("omni-plans-status-");
    await initializeOmniProject(rootDir);

    const entry = await createPlan(rootDir, "Fix bug", "Fix the crash", []);
    const updated = await updatePlanStatus(rootDir, entry.id, "completed");

    expect(updated?.status).toBe("completed");
    expect(updated?.completedAt).toBeDefined();

    const index = await readPlanIndex(rootDir);
    expect(index[0].status).toBe("completed");
  });

  test("cleanupCompletedPlans removes completed plan files", async () => {
    const rootDir = await createTempProject("omni-plans-cleanup-");
    await initializeOmniProject(rootDir);

    const entry = await createPlan(rootDir, "Old plan", "Done", []);
    await updatePlanStatus(rootDir, entry.id, "completed");

    const removed = await cleanupCompletedPlans(rootDir);
    expect(removed).toContain(entry.id);

    // Index still has the entry, but the file is gone
    const index = await readPlanIndex(rootDir);
    expect(index).toHaveLength(1);
    expect(index[0].status).toBe("completed");

    await expect(
      readFile(path.join(rootDir, ".omni", "plans", `${entry.id}.md`), "utf8"),
    ).rejects.toThrow();
  });

  test("appendProgress and readProgress track progress entries", async () => {
    const rootDir = await createTempProject("omni-progress-");
    await initializeOmniProject(rootDir);

    await appendProgress(rootDir, "Started work on auth");
    await appendProgress(rootDir, "Completed login endpoint");

    const progress = await readProgress(rootDir);
    expect(progress).toContain("Started work on auth");
    expect(progress).toContain("Completed login endpoint");
  });

  test("renderPlanIndex groups by status", async () => {
    const rendered = renderPlanIndex([
      {
        id: "plan-1",
        title: "Active plan",
        status: "active",
        createdAt: "2026-01-01",
      },
      {
        id: "plan-2",
        title: "Done plan",
        status: "completed",
        createdAt: "2026-01-01",
        completedAt: "2026-01-02",
      },
    ]);

    expect(rendered).toContain("Active:");
    expect(rendered).toContain("Active plan");
    expect(rendered).toContain("Completed:");
    expect(rendered).toContain("Done plan");
  });

  test("planOmniProject creates a plan entry and logs progress", async () => {
    const rootDir = await createTempProject("omni-plan-creates-plan-");
    await initializeOmniProject(rootDir);

    await planOmniProject(rootDir, {
      summary: "Build a widget",
      desiredOutcome: "A working widget",
      constraints: [],
      userSignals: [],
    });

    const index = await readPlanIndex(rootDir);
    expect(index.length).toBeGreaterThanOrEqual(1);
    expect(index[0].status).toBe("active");

    const progress = await readProgress(rootDir);
    expect(progress).toContain("Created plan");
  });

  test("config round-trips cleanupCompletedPlans setting", async () => {
    const rootDir = await createTempProject("omni-config-cleanup-");
    await initializeOmniProject(rootDir);

    const config = await readConfig(rootDir);
    expect(config.cleanupCompletedPlans).toBe(false);

    await writeConfig(rootDir, { ...config, cleanupCompletedPlans: true });
    const reloaded = await readConfig(rootDir);
    expect(reloaded.cleanupCompletedPlans).toBe(true);
  });

  test("estimateTokens uses char-based approximation", () => {
    expect(estimateTokens("")).toBe(0);
    expect(estimateTokens("abcd")).toBe(1);
    expect(estimateTokens("a".repeat(100))).toBe(25);
    expect(estimateTokens("hello world!")).toBe(3);
  });

  test("budget tracks consumed and remaining tokens", () => {
    let budget = createBudget(100);
    expect(budget.remainingTokens).toBe(100);

    budget = consumeBudget(budget, "a".repeat(200));
    expect(budget.usedTokens).toBe(50);
    expect(budget.remainingTokens).toBe(50);

    expect(fitsInBudget(budget, "a".repeat(200))).toBe(true);
    expect(fitsInBudget(budget, "a".repeat(204))).toBe(false);
  });

  test("getPhaseFiles returns different files per phase", () => {
    const buildFiles = getPhaseFiles("build");
    const planFiles = getPhaseFiles("plan");

    expect(buildFiles).toContain("TESTS.md");
    expect(planFiles).toContain("DECISIONS.md");
    expect(planFiles).not.toContain("PROGRESS.md");
    expect(buildFiles).toContain("PROGRESS.md");
  });

  test("gatherPhaseContext reads files within token budget", async () => {
    const rootDir = await createTempProject("omni-context-phase-");
    await initializeOmniProject(rootDir);

    const blocks = await gatherPhaseContext(rootDir, "build", 10000);
    expect(blocks.length).toBeGreaterThan(0);
    expect(blocks.some((b) => b.file === "SPEC.md")).toBe(true);

    const totalTokens = blocks.reduce((sum, b) => sum + b.tokens, 0);
    expect(totalTokens).toBeLessThanOrEqual(10000);
  });

  test("gatherPhaseContext respects tight budget", async () => {
    const rootDir = await createTempProject("omni-context-tight-");
    await initializeOmniProject(rootDir);

    // Very tight budget — may not fit all files
    const blocks = await gatherPhaseContext(rootDir, "escalate", 10);
    const totalTokens = blocks.reduce((sum, b) => sum + b.tokens, 0);
    expect(totalTokens).toBeLessThanOrEqual(10);
  });

  test("gatherTaskContext includes task-relevant files", async () => {
    const rootDir = await createTempProject("omni-context-task-");
    await initializeOmniProject(rootDir);

    const task = {
      id: "T01",
      title: "Test task",
      objective: "Do something",
      contextFiles: [".omni/PROJECT.md"],
      skills: [],
      doneCriteria: [],
      role: "worker" as const,
      status: "todo" as const,
      dependsOn: [],
    };

    const blocks = await gatherTaskContext(rootDir, task, 10000);
    expect(blocks.some((b) => b.file === "SPEC.md")).toBe(true);
    expect(blocks.some((b) => b.file === ".omni/PROJECT.md")).toBe(true);
  });

  test("renderContextSummary shows file names and token counts", () => {
    const summary = renderContextSummary([
      { file: "SPEC.md", content: "x".repeat(40), tokens: 10 },
      { file: "TESTS.md", content: "y".repeat(80), tokens: 20 },
    ]);
    expect(summary).toContain("30 tokens");
    expect(summary).toContain("2 files");
    expect(summary).toContain("SPEC.md (10t)");
  });

  // --- detectStuck tests ---

  test("detectStuck returns not detected when no tasks exist", async () => {
    const rootDir = await createTempProject("omni-stuck-none-");
    const result = await detectStuck(rootDir);
    expect(result.detected).toBe(false);
  });

  test("detectStuck returns not detected with fewer than 3 failures", async () => {
    const rootDir = await createTempProject("omni-stuck-few-");
    await initializeOmniProject(rootDir);
    await planOmniProject(rootDir, {
      summary: "test",
      desiredOutcome: "test",
      constraints: [],
      userSignals: [],
    });

    const taskDir = path.join(rootDir, ".omni", "tasks");
    await mkdir(taskDir, { recursive: true });
    const history = [
      { verification: { passed: false, failureSummary: ["err1"] } },
      { verification: { passed: false, failureSummary: ["err2"] } },
    ];
    await writeFile(
      path.join(taskDir, "T01.history.json"),
      JSON.stringify(history),
      "utf8",
    );

    const result = await detectStuck(rootDir);
    expect(result.detected).toBe(false);
  });

  test("detectStuck detects 3+ identical failures", async () => {
    const rootDir = await createTempProject("omni-stuck-same-");
    await initializeOmniProject(rootDir);
    await planOmniProject(rootDir, {
      summary: "test",
      desiredOutcome: "test",
      constraints: [],
      userSignals: [],
    });

    const taskDir = path.join(rootDir, ".omni", "tasks");
    await mkdir(taskDir, { recursive: true });
    const history = [
      { verification: { passed: false, failureSummary: ["type error"] } },
      { verification: { passed: false, failureSummary: ["type error"] } },
      { verification: { passed: false, failureSummary: ["type error"] } },
    ];
    await writeFile(
      path.join(taskDir, "T01.history.json"),
      JSON.stringify(history),
      "utf8",
    );

    const result = await detectStuck(rootDir);
    expect(result.detected).toBe(true);
    expect(result.reason).toContain("same error");
    expect(result.taskId).toBe("T01");
  });

  test("detectStuck detects 3+ different failures", async () => {
    const rootDir = await createTempProject("omni-stuck-diff-");
    await initializeOmniProject(rootDir);
    await planOmniProject(rootDir, {
      summary: "test",
      desiredOutcome: "test",
      constraints: [],
      userSignals: [],
    });

    const taskDir = path.join(rootDir, ".omni", "tasks");
    await mkdir(taskDir, { recursive: true });
    const history = [
      { verification: { passed: false, failureSummary: ["err1"] } },
      { verification: { passed: false, failureSummary: ["err2"] } },
      { verification: { passed: false, failureSummary: ["err3"] } },
    ];
    await writeFile(
      path.join(taskDir, "T01.history.json"),
      JSON.stringify(history),
      "utf8",
    );

    const result = await detectStuck(rootDir);
    expect(result.detected).toBe(true);
    expect(result.reason).toContain("3 failures");
    expect(result.taskId).toBe("T01");
  });

  test("detectStuck returns not detected with no history file", async () => {
    const rootDir = await createTempProject("omni-stuck-nohist-");
    await initializeOmniProject(rootDir);
    await planOmniProject(rootDir, {
      summary: "test",
      desiredOutcome: "test",
      constraints: [],
      userSignals: [],
    });

    const result = await detectStuck(rootDir);
    expect(result.detected).toBe(false);
    expect(result.reason).toBe("No stuck signals.");
  });

  // --- tasks.ts unit tests ---

  test("readTasks parses markdown task table", async () => {
    const rootDir = await createTempProject("omni-tasks-parse-");
    const tasksPath = path.join(rootDir, "tasks.md");
    await writeFile(
      tasksPath,
      `# Tasks

## Task slices

| ID | Title | Depends On | Status | Done Criteria |
| --- | --- | --- | --- | --- |
| T01 | First task | - | todo | Passes tests |
| T02 | Second task | T01 | todo | Compiles |
`,
      "utf8",
    );

    const tasks = await readTasks(tasksPath);
    expect(tasks).toHaveLength(2);
    expect(tasks[0].id).toBe("T01");
    expect(tasks[0].dependsOn).toEqual([]);
    expect(tasks[1].dependsOn).toEqual(["T01"]);
    expect(tasks[1].role).toBe("worker");
  });

  test("readTasks skips malformed rows", async () => {
    const rootDir = await createTempProject("omni-tasks-bad-");
    const tasksPath = path.join(rootDir, "tasks.md");
    await writeFile(
      tasksPath,
      `# Tasks

## Task slices

| ID | Title | Depends On | Status | Done Criteria |
| --- | --- | --- | --- | --- |
| T01 | Good row | - | todo | OK |
| Too few columns |
| T03 | Another good | - | done | Done |
`,
      "utf8",
    );

    const tasks = await readTasks(tasksPath);
    expect(tasks).toHaveLength(2);
    expect(tasks[0].id).toBe("T01");
    expect(tasks[1].id).toBe("T03");
  });

  test("findNextExecutableTask respects dependencies", () => {
    const tasks = [
      {
        id: "T01",
        title: "First",
        objective: "First",
        contextFiles: [],
        skills: [],
        doneCriteria: [],
        role: "worker" as const,
        status: "todo" as const,
        dependsOn: [],
      },
      {
        id: "T02",
        title: "Second",
        objective: "Second",
        contextFiles: [],
        skills: [],
        doneCriteria: [],
        role: "worker" as const,
        status: "todo" as const,
        dependsOn: ["T01"],
      },
    ];

    // T01 is executable, T02 is blocked
    expect(findNextExecutableTask(tasks)?.id).toBe("T01");

    // After T01 is done, T02 becomes executable
    const updated = updateTaskStatus(tasks, "T01", "done");
    expect(findNextExecutableTask(updated)?.id).toBe("T02");
  });

  test("findNextExecutableTask returns null when all done", () => {
    const tasks = [
      {
        id: "T01",
        title: "Done task",
        objective: "Done",
        contextFiles: [],
        skills: [],
        doneCriteria: [],
        role: "worker" as const,
        status: "done" as const,
        dependsOn: [],
      },
    ];

    expect(findNextExecutableTask(tasks)).toBeNull();
  });

  test("findNextExecutableTask skips blocked dependencies", () => {
    const tasks = [
      {
        id: "T01",
        title: "Blocked",
        objective: "Blocked",
        contextFiles: [],
        skills: [],
        doneCriteria: [],
        role: "worker" as const,
        status: "blocked" as const,
        dependsOn: [],
      },
      {
        id: "T02",
        title: "Depends on blocked",
        objective: "Waiting",
        contextFiles: [],
        skills: [],
        doneCriteria: [],
        role: "worker" as const,
        status: "todo" as const,
        dependsOn: ["T01"],
      },
    ];

    // T01 is blocked (not todo), T02 depends on T01 which isn't done
    expect(findNextExecutableTask(tasks)).toBeNull();
  });

  test("updateTaskStatus returns new array without mutating", () => {
    const tasks = [
      {
        id: "T01",
        title: "Task",
        objective: "Task",
        contextFiles: [],
        skills: [],
        doneCriteria: [],
        role: "worker" as const,
        status: "todo" as const,
        dependsOn: [],
      },
    ];

    const updated = updateTaskStatus(tasks, "T01", "done");
    expect(updated[0].status).toBe("done");
    expect(tasks[0].status).toBe("todo"); // original unchanged
  });

  test("renderTaskTable round-trips through readTasks", async () => {
    const tasks = [
      {
        id: "T01",
        title: "Build feature",
        objective: "Build feature",
        contextFiles: [],
        skills: [],
        doneCriteria: ["Passes tests", "Compiles"],
        role: "worker" as const,
        status: "todo" as const,
        dependsOn: [],
      },
    ];

    const rootDir = await createTempProject("omni-tasks-roundtrip-");
    const tasksPath = path.join(rootDir, "tasks.md");
    await writeFile(tasksPath, renderTaskTable(tasks), "utf8");

    const parsed = await readTasks(tasksPath);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].id).toBe("T01");
    expect(parsed[0].doneCriteria).toEqual(["Passes tests", "Compiles"]);
  });

  test("renderTaskTable round-trips titles with pipe characters", async () => {
    const tasks = [
      {
        id: "T01",
        title: "Build auth | login flow",
        objective: "Build auth | login flow",
        contextFiles: [],
        skills: [],
        doneCriteria: ["Passes tests"],
        role: "worker" as const,
        status: "todo" as const,
        dependsOn: [],
      },
    ];

    const rootDir = await createTempProject("omni-tasks-pipe-title-");
    const tasksPath = path.join(rootDir, "tasks.md");
    await writeFile(tasksPath, renderTaskTable(tasks), "utf8");

    const content = await readFile(tasksPath, "utf8");
    expect(content).toContain("Build auth \\| login flow");

    const parsed = await readTasks(tasksPath);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].title).toBe("Build auth | login flow");
  });

  test("renderTaskTable round-trips done criteria with pipe characters", async () => {
    const tasks = [
      {
        id: "T01",
        title: "Build feature",
        objective: "Build feature",
        contextFiles: [],
        skills: [],
        doneCriteria: ["CLI shows a | separator", "Compiles"],
        role: "worker" as const,
        status: "todo" as const,
        dependsOn: [],
      },
    ];

    const rootDir = await createTempProject("omni-tasks-pipe-criteria-");
    const tasksPath = path.join(rootDir, "tasks.md");
    await writeFile(tasksPath, renderTaskTable(tasks), "utf8");

    const parsed = await readTasks(tasksPath);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].doneCriteria).toEqual([
      "CLI shows a | separator",
      "Compiles",
    ]);
  });

  test("renderTasksMarkdown escapes pipe characters in planned tasks", () => {
    const content = renderTasksMarkdown([
      {
        id: "T01",
        title: "Build auth | login flow",
        objective: "Build auth | login flow",
        contextFiles: [],
        skills: [],
        doneCriteria: ["CLI shows a | separator", "Compiles"],
        role: "worker",
        status: "todo",
        dependsOn: [],
      },
    ]);

    expect(content).toContain("Build auth \\| login flow");
    expect(content).toContain("CLI shows a \\| separator; Compiles");
  });

  test("prepareCommitPlan parses escaped pipes from completed task rows", async () => {
    const rootDir = await createTempProject("omni-commit-plan-pipes-");
    await initializeOmniProject(rootDir);
    await writeFile(
      path.join(rootDir, ".omni", "TASKS.md"),
      `# Tasks

## Task slices

| ID | Title | Depends On | Status | Done Criteria |
| --- | --- | --- | --- | --- |
| T01 | Fix auth \\| login flow | - | done | CLI shows a \\| separator; Tests pass |
`,
      "utf8",
    );
    await mkdir(path.join(rootDir, ".omni", "tasks"), { recursive: true });
    await writeFile(
      path.join(rootDir, ".omni", "tasks", "T01.history.json"),
      JSON.stringify([{ modifiedFiles: ["src/auth.ts"] }]),
      "utf8",
    );

    const plan = await prepareCommitPlan(rootDir);

    expect(plan).not.toBeNull();
    expect(plan?.taskId).toBe("T01");
    expect(plan?.message).toContain("Fix auth | login flow");
    expect(plan?.message).toContain("CLI shows a | separator; Tests pass");
    expect(plan?.files).toEqual(["src/auth.ts"]);
  });

  test("initializeOmniProject includes diagnostics in result", async () => {
    const rootDir = await createTempProject("omni-init-diag-");
    const result = await initializeOmniProject(rootDir);

    expect(result.diagnostics).toBeDefined();
    expect(result.diagnostics.overall).toBeDefined();
    expect(result.diagnostics.checks.length).toBeGreaterThan(0);
  });

  // --- config edge case tests ---

  test("readConfig returns defaults for missing CONFIG.md", async () => {
    const rootDir = await createTempProject("omni-config-missing-");
    const config = await readConfig(rootDir);
    expect(config.models.worker).toBe("anthropic/claude-sonnet-4-6");
    expect(config.retryLimit).toBe(2);
    expect(config.chainEnabled).toBe(false);
    expect(config.cleanupCompletedPlans).toBe(false);
  });

  test("readConfig handles CONFIG.md with extra whitespace", async () => {
    const rootDir = await createTempProject("omni-config-ws-");
    await mkdir(path.join(rootDir, ".omni"), { recursive: true });
    await writeFile(
      path.join(rootDir, ".omni", "CONFIG.md"),
      `# Omni-Pi Configuration

## Models

| Agent | Model |
|-------|-------|
|  worker  |  anthropic/claude-sonnet-4-5  |
| expert |openai/gpt-5|
| planner | openai/gpt-5.4 |
| brain | anthropic/claude-opus-4-6 |

## Retry Policy

Implementation retries before the plan must be tightened: 3

## Execution

Chain execution enabled: true
`,
      "utf8",
    );

    const config = await readConfig(rootDir);
    expect(config.models.worker).toBe("anthropic/claude-sonnet-4-5");
    expect(config.models.expert).toBe("openai/gpt-5");
    expect(config.retryLimit).toBe(3);
    expect(config.chainEnabled).toBe(true);
  });

  test("readConfig handles CONFIG.md missing Memory section", async () => {
    const rootDir = await createTempProject("omni-config-nomem-");
    await mkdir(path.join(rootDir, ".omni"), { recursive: true });
    await writeFile(
      path.join(rootDir, ".omni", "CONFIG.md"),
      `# Omni-Pi Configuration

## Models

| Agent | Model |
|-------|-------|
| worker | anthropic/claude-sonnet-4-6 |
| expert | openai/gpt-5.4 |
| planner | openai/gpt-5.4 |
| brain | anthropic/claude-opus-4-6 |

## Retry Policy

Implementation retries before the plan must be tightened: 2

## Execution

Chain execution enabled: false
`,
      "utf8",
    );

    const config = await readConfig(rootDir);
    // Missing Memory section → uses default
    expect(config.cleanupCompletedPlans).toBe(false);
  });

  test("readConfig handles empty model values gracefully", async () => {
    const rootDir = await createTempProject("omni-config-empty-");
    await mkdir(path.join(rootDir, ".omni"), { recursive: true });
    await writeFile(
      path.join(rootDir, ".omni", "CONFIG.md"),
      `# Omni-Pi Configuration

## Models

| Agent | Model |
|-------|-------|
| worker |  |
| expert | openai/gpt-5.4 |
| planner | openai/gpt-5.4 |
| brain | anthropic/claude-opus-4-6 |
`,
      "utf8",
    );

    const config = await readConfig(rootDir);
    // Empty worker value — should fall back to default
    expect(config.models.expert).toBe("openai/gpt-5.4");
  });
});
