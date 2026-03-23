import type { ConversationBrief } from "./contracts.js";
import { readFile } from "node:fs/promises";
import path from "node:path";

import { renderPlainStatus } from "./status.js";
import type { AppCommandDefinition } from "./pi.js";
import type { WorkEngine } from "./work.js";
import { prepareNextTaskDispatch } from "./work.js";
import { appendSkillUsageNote, readSkillRegistry, renderSkillRegistry } from "./skills.js";
import { createSubagentWorkEngine } from "./subagents.js";
import { initializeOmniProject, planOmniProject, readOmniStatus, syncOmniProject, workOnOmniProject } from "./workflow.js";

let runtimeWorkEngineFactory: typeof createSubagentWorkEngine = createSubagentWorkEngine;

export function setRuntimeWorkEngineFactoryForTests(factory: typeof createSubagentWorkEngine): void {
  runtimeWorkEngineFactory = factory;
}

export function resetRuntimeWorkEngineFactoryForTests(): void {
  runtimeWorkEngineFactory = createSubagentWorkEngine;
}

const placeholderEngine: WorkEngine = {
  async runWorkerTask(task, attempt) {
    return {
      summary: `Prepared ${task.id} for worker execution (attempt ${attempt}).`,
      verification: {
        taskId: task.id,
        passed: false,
        checksRun: ["dispatch-pending"],
        failureSummary: ["Direct worker execution is not wired into Pi runtime yet."],
        retryRecommended: true
      }
    };
  },
  async runExpertTask(task) {
    return {
      summary: `Prepared ${task.id} for expert execution.`,
      verification: {
        taskId: task.id,
        passed: false,
        checksRun: ["dispatch-pending"],
        failureSummary: ["Expert execution is not wired into Pi runtime yet."],
        retryRecommended: false
      }
    };
  }
};

function briefFromArgs(args: string[] | undefined): ConversationBrief {
  const summary = args?.join(" ").trim() || "Create an initial implementation plan from the current project context.";
  return {
    summary,
    desiredOutcome: summary,
    constraints: [],
    userSignals: []
  };
}

export function createOmniCommands(): AppCommandDefinition[] {
  return [
    {
      name: "omni-init",
      description: "Initialize Omni-Pi for the current project.",
      execute: async ({ cwd, runtime }) => {
        const result = await initializeOmniProject(cwd);
        const installNotes: string[] = [];

        if (runtime && result.installSteps.length > 0) {
          for (const step of result.installSteps) {
            const execResult = await runtime.pi.exec(step.command, step.args, { cwd });
            if (execResult.code === 0) {
              installNotes.push(`${step.summary}: installed`);
            } else {
              installNotes.push(`${step.summary}: failed (${execResult.stderr.trim() || execResult.stdout.trim() || `exit ${execResult.code}`})`);
            }
          }

          for (const note of installNotes) {
            await appendSkillUsageNote(cwd, note);
          }
        }

        const installSummary = installNotes.length > 0 ? ` ${installNotes.join("; ")}.` : result.installCommands.length > 0 ? ` Planned install commands: ${result.installCommands.join("; ")}.` : "";
        return `Initialized Omni-Pi in ${cwd}. Created ${result.created.length} files, reused ${result.reused.length}, and identified ${result.skillCandidates.length} skill candidates.${installSummary}`;
      }
    },
    {
      name: "omni-plan",
      description: "Create or refresh the current spec, tasks, and tests.",
      execute: async ({ cwd, args }) => {
        const brief = briefFromArgs(args);
        const result = await planOmniProject(cwd, brief);
        return `Updated planning artifacts: ${result.specPath}, ${result.tasksPath}, ${result.testsPath}.`;
      }
    },
    {
      name: "omni-work",
      description: "Run the next task through worker, verifier, and expert fallback.",
      execute: async ({ cwd, runtime }) => {
        if (runtime) {
          try {
            const engine = await runtimeWorkEngineFactory(cwd, runtime.ctx);
            const result = await workOnOmniProject(cwd, engine);
            runtime.ctx.ui.setStatus("omni", undefined);
            return `${result.message} Current phase: ${result.state.currentPhase}.`;
          } catch (error) {
            runtime.ctx.ui.notify(
              `pi-subagents integration unavailable, falling back to guided handoff: ${error instanceof Error ? error.message : String(error)}`,
              "warning"
            );
          }

          const dispatch = await prepareNextTaskDispatch(cwd);
          if (dispatch.kind === "idle") {
            return dispatch.message;
          }
          const currentSessionFile = runtime.ctx.sessionManager.getSessionFile();
          const newSessionResult = await runtime.ctx.newSession({
            parentSession: currentSessionFile
          });

          if (newSessionResult.cancelled) {
            return "Omni-Pi task dispatch was cancelled before the focused session was created.";
          }

          runtime.ctx.ui.setEditorText(dispatch.prompt);
          runtime.ctx.ui.setStatus("omni", `Prepared ${dispatch.taskId} in a fresh session`);
          return `Prepared ${dispatch.taskId} in a fresh focused session. Review the drafted prompt and submit when ready.`;
        }

        const result = await workOnOmniProject(cwd, placeholderEngine);
        return `${result.message} Current phase: ${result.state.currentPhase}.`;
      }
    },
    {
      name: "omni-status",
      description: "Show the current phase, task, blockers, and next step.",
      execute: async ({ cwd }) => renderPlainStatus(await readOmniStatus(cwd))
    },
    {
      name: "omni-sync",
      description: "Update durable Omni-Pi project memory from recent progress.",
      execute: async ({ cwd, args }) => {
        const summary = args?.join(" ").trim() || "Captured recent progress without additional details.";
        const result = await syncOmniProject(cwd, { summary, nextHandoffNotes: [summary] });
        return `Synced Omni-Pi memory. Current phase: ${result.state.currentPhase}.`;
      }
    },
    {
      name: "omni-skills",
      description: "Show installed, recommended, deferred, and rejected skills.",
      execute: async ({ cwd }) => {
        const registry = await readSkillRegistry(cwd);
        const skillsPath = path.join(cwd, ".omni", "SKILLS.md");
        await readFile(skillsPath, "utf8");
        return renderSkillRegistry(registry);
      }
    },
    {
      name: "omni-explain",
      description: "Explain what Omni-Pi is doing and why.",
      execute: async () => "Omni-Pi works in guided steps: understand the goal, plan the next slice, build it, check it, and escalate only when needed."
    }
  ];
}
