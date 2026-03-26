import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  AVAILABLE_MODELS,
  readConfig,
  updateModelConfig,
  writeConfig,
} from "./config.js";
import {
  type ConversationBrief,
  detectPreset,
  WORKFLOW_PRESETS,
  type WorkflowPreset,
} from "./contracts.js";
import { renderDoctorReport, runDoctor } from "./doctor.js";
import {
  commitChanges,
  createBranch,
  prepareCommitPlan,
  stageFiles,
} from "./git.js";
import type { AppCommandDefinition, CommandResult } from "./pi.js";
import type { SkillInstallResult } from "./skills.js";
import {
  appendSkillUsageNote,
  applyInstallResults,
  readSkillRegistry,
  renderSkillRegistry,
} from "./skills.js";
import { renderMetrics, renderPlainStatus } from "./status.js";
import {
  createChainWorkEngine,
  createSubagentWorkEngine,
  loadRunHistory,
} from "./subagents.js";
import type { WorkEngine } from "./work.js";
import { prepareNextTaskDispatch } from "./work.js";
import {
  initializeOmniProject,
  planOmniProject,
  readOmniStatus,
  syncOmniProject,
  workOnOmniProject,
} from "./workflow.js";

let runtimeWorkEngineFactory: typeof createSubagentWorkEngine =
  createSubagentWorkEngine;

export function setRuntimeWorkEngineFactoryForTests(
  factory: typeof createSubagentWorkEngine,
): void {
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
        failureSummary: [
          "Direct worker execution is not wired into Pi runtime yet.",
        ],
        retryRecommended: true,
      },
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
        retryRecommended: false,
      },
    };
  },
};

function briefFromArgs(args: string[] | undefined): ConversationBrief {
  const joined = args?.join(" ").trim() ?? "";
  const presetMatch = joined.match(/^--preset\s+(\S+)\s*(.*)/u);
  let preset: WorkflowPreset | undefined;
  let summary: string;

  if (presetMatch && presetMatch[1] in WORKFLOW_PRESETS) {
    preset = presetMatch[1] as WorkflowPreset;
    summary = presetMatch[2].trim() || `${preset} workflow`;
  } else {
    summary =
      joined ||
      "Create an initial implementation plan from the current project context.";
    const detected = detectPreset("", summary);
    if (detected) {
      preset = detected;
    }
  }

  return {
    summary,
    desiredOutcome: summary,
    constraints: [],
    userSignals: [],
    preset,
  };
}

export function createOmniCommands(): AppCommandDefinition[] {
  return [
    {
      name: "omni-init",
      description: "Initialize Omni-Pi for the current project.",
      execute: async ({ cwd, args, runtime }) => {
        const result = await initializeOmniProject(cwd);

        const skipWizard = args?.includes("--quick") ?? false;
        if (runtime && !skipWizard) {
          const ui = runtime.ctx.ui;

          const cleanup = await ui.confirm(
            "Plan cleanup",
            "Auto-delete completed plan files? (You can change this later in CONFIG.md)",
          );
          const config = await readConfig(cwd);
          const updatedConfig = { ...config, cleanupCompletedPlans: cleanup };

          const goal = await ui.input(
            "What are you building?",
            "e.g., a CLI tool for managing tasks",
          );
          if (goal) {
            const projectPath = path.join(cwd, ".omni", "PROJECT.md");
            const project = await readFile(projectPath, "utf8");
            const updated = project.replace(
              "Describe what this project should achieve.",
              goal,
            );
            await writeFile(projectPath, updated, "utf8");
          }

          const presetOptions = Object.values(WORKFLOW_PRESETS).map(
            (p) => `${p.name} — ${p.description}`,
          );
          const presetChoice = await ui.select(
            "Preferred workflow for the first plan?",
            ["(none — decide later)", ...presetOptions],
          );
          let suggestedPreset: string | undefined;
          if (presetChoice && !presetChoice.startsWith("(none")) {
            suggestedPreset = presetChoice.split(" — ")[0];
          }

          await writeConfig(cwd, updatedConfig);

          if (suggestedPreset) {
            await ui.notify(
              `Tip: run /omni-plan --preset ${suggestedPreset} to start planning with the ${suggestedPreset} workflow.`,
              "info",
            );
          }
        }

        const installNotes: string[] = [];
        const installResults: SkillInstallResult[] = [];

        if (runtime && result.installSteps.length > 0) {
          for (const step of result.installSteps) {
            const skillName =
              result.installedSkills.find((s) => step.summary.includes(s.name))
                ?.name ?? step.summary;
            const execResult = await runtime.pi.exec(step.command, step.args, {
              cwd,
            });
            if (execResult.code === 0) {
              installNotes.push(`${step.summary}: installed`);
              installResults.push({ name: skillName, success: true });
            } else {
              const errorMsg =
                execResult.stderr.trim() ||
                execResult.stdout.trim() ||
                `exit ${execResult.code}`;
              installNotes.push(`${step.summary}: failed (${errorMsg})`);
              installResults.push({
                name: skillName,
                success: false,
                error: errorMsg,
              });
            }
          }

          for (const note of installNotes) {
            await appendSkillUsageNote(cwd, note);
          }

          if (installResults.some((r) => !r.success)) {
            const recovery = await applyInstallResults(cwd, installResults);
            if (recovery.deferred.length > 0) {
              installNotes.push(
                `Deferred ${recovery.deferred.join(", ")} to retry later`,
              );
            }
          }
        }

        const installSummary =
          installNotes.length > 0
            ? ` ${installNotes.join("; ")}.`
            : result.installCommands.length > 0
              ? ` Planned install commands: ${result.installCommands.join("; ")}.`
              : "";
        const healthNote =
          result.diagnostics.overall === "red"
            ? " Health: FAIL — run /omni-doctor for details."
            : result.diagnostics.overall === "yellow"
              ? " Health: WARN — run /omni-doctor to review."
              : " Health: OK.";
        return `Initialized Omni-Pi in ${cwd}. Created ${result.created.length} files, reused ${result.reused.length}, and identified ${result.skillCandidates.length} skill candidates.${installSummary}${healthNote}`;
      },
    },
    {
      name: "omni-plan",
      description: "Create or refresh the current spec, tasks, and tests.",
      execute: async ({ cwd, args, runtime }) => {
        const brief = briefFromArgs(args);

        if (runtime) {
          const ui = runtime.ctx.ui;
          const presetConfig = brief.preset
            ? WORKFLOW_PRESETS[brief.preset]
            : undefined;

          if (!presetConfig?.skipInterview) {
            const constraints = await ui.input(
              "Any constraints or requirements to add?",
              "e.g., must use existing auth system",
            );
            if (constraints) {
              brief.constraints.push(constraints);
            }

            const userContext = await ui.input(
              "Who are the primary users?",
              "e.g., developers, end users",
            );
            if (userContext) {
              brief.userSignals.push(`Primary users: ${userContext}`);
            }
          }

          const result = await planOmniProject(cwd, brief);

          const approved = await ui.confirm(
            "Plan generated",
            `Created spec, ${result.tasksPath}, and ${result.testsPath}. Review .omni/SPEC.md and .omni/TASKS.md. Accept this plan?`,
          );

          if (!approved) {
            return "Plan generated but not accepted. Run /omni-plan again to refine.";
          }

          return `Accepted planning artifacts: ${result.specPath}, ${result.tasksPath}, ${result.testsPath}.`;
        }

        const result = await planOmniProject(cwd, brief);
        return `Updated planning artifacts: ${result.specPath}, ${result.tasksPath}, ${result.testsPath}.`;
      },
    },
    {
      name: "omni-work",
      description:
        "Run the next task through worker, verifier, and expert fallback.",
      execute: async ({ cwd, runtime }) => {
        if (runtime) {
          try {
            const currentSession = runtime.ctx.sessionManager.getSessionFile();
            const sessionResult = await runtime.ctx.newSession({
              parentSession: currentSession,
            });
            if (sessionResult.cancelled) {
              return "Omni-Pi task session was cancelled.";
            }
            const omniConfig = await readConfig(cwd);
            const engineFactory = omniConfig.chainEnabled
              ? createChainWorkEngine
              : runtimeWorkEngineFactory;
            const engine = await engineFactory(cwd, runtime.ctx, undefined, {
              exec: runtime.pi.exec.bind(runtime.pi),
            });
            const result = await workOnOmniProject(cwd, engine);
            runtime.ctx.ui.setStatus("omni", undefined);
            const text = `${result.message} Current phase: ${result.state.currentPhase}.`;
            if (
              result.kind === "blocked" &&
              result.state.currentPhase === "escalate"
            ) {
              return {
                text,
                messageType: "omni-escalation",
                details: {
                  taskId: result.taskId,
                  failedChecks: result.state.blockers,
                  recoveryOptions: result.state.recoveryOptions,
                },
              };
            }
            if (
              result.kind === "completed" ||
              result.kind === "expert_completed"
            ) {
              return {
                text,
                messageType: "omni-verification",
                details: {
                  passed: true,
                  checksRun: [],
                  failureSummary: [],
                },
              };
            }
            return text;
          } catch (error) {
            runtime.ctx.ui.notify(
              `pi-subagents integration unavailable, falling back to guided handoff: ${error instanceof Error ? error.message : String(error)}`,
              "warning",
            );
          }

          const dispatch = await prepareNextTaskDispatch(cwd);
          if (dispatch.kind === "idle") {
            return dispatch.message;
          }
          const currentSessionFile =
            runtime.ctx.sessionManager.getSessionFile();
          const newSessionResult = await runtime.ctx.newSession({
            parentSession: currentSessionFile,
          });

          if (newSessionResult.cancelled) {
            return "Omni-Pi task dispatch was cancelled before the focused session was created.";
          }

          runtime.ctx.ui.setEditorText(dispatch.prompt);
          runtime.ctx.ui.setStatus(
            "omni",
            `Prepared ${dispatch.taskId} in a fresh session`,
          );
          return `Prepared ${dispatch.taskId} in a fresh focused session. Review the drafted prompt and submit when ready.`;
        }

        const result = await workOnOmniProject(cwd, placeholderEngine);
        return `${result.message} Current phase: ${result.state.currentPhase}.`;
      },
    },
    {
      name: "omni-status",
      description: "Show the current phase, task, blockers, and next step.",
      execute: async ({ cwd, args, runtime }): Promise<CommandResult> => {
        if (args?.includes("metrics")) {
          const history = await loadRunHistory();
          if (!history) {
            return "Run history is not available (pi-subagents run-history module not found).";
          }
          const workerRuns = history.loadRunsForAgent("omni-worker");
          const expertRuns = history.loadRunsForAgent("omni-expert");
          return renderMetrics(workerRuns, expertRuns);
        }

        const state = await readOmniStatus(cwd);
        if (runtime) {
          return {
            text: renderPlainStatus(state),
            messageType: "omni-status",
            details: {
              phase: state.currentPhase,
              activeTask: state.activeTask,
              blockers: state.blockers,
              nextStep: state.nextStep,
              recoveryOptions: state.recoveryOptions,
            },
          };
        }
        return renderPlainStatus(state);
      },
    },
    {
      name: "omni-sync",
      description:
        "Update durable Omni-Pi project memory from recent progress.",
      execute: async ({ cwd, args }) => {
        const summary =
          args?.join(" ").trim() ||
          "Captured recent progress without additional details.";
        const result = await syncOmniProject(cwd, {
          summary,
          nextHandoffNotes: [summary],
        });
        return `Synced Omni-Pi memory. Current phase: ${result.state.currentPhase}.`;
      },
    },
    {
      name: "omni-skills",
      description:
        "Show installed, recommended, deferred, and rejected skills.",
      execute: async ({ cwd }) => {
        const registry = await readSkillRegistry(cwd);
        const skillsPath = path.join(cwd, ".omni", "SKILLS.md");
        await readFile(skillsPath, "utf8");
        return renderSkillRegistry(registry);
      },
    },
    {
      name: "omni-explain",
      description: "Explain what Omni-Pi is doing and why.",
      execute: async () =>
        "Omni-Pi works in guided steps: understand the goal, plan the next slice, build it, check it, and escalate only when needed.",
    },
    {
      name: "omni-model",
      description: "Interactively select the model for a specific agent role.",
      execute: async ({ cwd, runtime }) => {
        if (!runtime) {
          return "omni-model requires the Pi runtime with an interactive UI.";
        }

        const ui = runtime.ctx.ui;
        const agentOptions = ["worker", "expert", "planner", "brain"];
        const selectedAgent = await ui.select(
          "Select agent role to configure:",
          agentOptions,
        );

        if (!selectedAgent) {
          return "Model selection cancelled.";
        }

        const currentConfig = await readConfig(cwd);
        const currentModel =
          currentConfig.models[
            selectedAgent as keyof typeof currentConfig.models
          ];
        const modelOptions = Array.from(
          new Set(
            AVAILABLE_MODELS.length > 0 && currentModel
              ? [currentModel, ...AVAILABLE_MODELS]
              : currentModel
                ? [currentModel]
                : AVAILABLE_MODELS,
          ),
        ).map((model) =>
          model === currentModel ? `${model} (current)` : model,
        );
        modelOptions.push("Enter custom provider/model");

        const selectedModelDisplay = await ui.select(
          `Select model for ${selectedAgent}:`,
          modelOptions,
        );
        if (!selectedModelDisplay) {
          return "Model selection cancelled.";
        }

        let selectedModel = selectedModelDisplay.replace(" (current)", "");
        if (selectedModel === "Enter custom provider/model") {
          const customModel = await ui.input(
            "Enter model as provider/model",
            "e.g., openrouter/anthropic/claude-sonnet-4",
          );
          if (!customModel?.includes("/")) {
            return "Custom model cancelled. Use the canonical provider/model format.";
          }
          selectedModel = customModel.trim();
        }

        await updateModelConfig(cwd, selectedAgent, selectedModel);

        return `Updated ${selectedAgent} model to ${selectedModel}. Configuration saved to .omni/CONFIG.md`;
      },
    },
    {
      name: "omni-commit",
      description: "Create a branch and commit for the last completed task.",
      execute: async ({ cwd, runtime }) => {
        const plan = await prepareCommitPlan(cwd);
        if (!plan) {
          return "No completed tasks found. Run /omni-work first.";
        }

        if (!runtime) {
          return `Commit plan for ${plan.taskId}: branch=${plan.branch}, files=${plan.files.join(", ") || "none tracked"}, message=${plan.message.split("\n")[0]}`;
        }

        const exec = runtime.pi.exec.bind(runtime.pi);

        if (plan.files.length === 0) {
          return `No modified files tracked for ${plan.taskId}. Stage and commit manually, or ensure /omni-work tracked file changes.`;
        }

        const branchOk = await createBranch(exec, cwd, plan.branch);
        if (!branchOk) {
          return `Failed to create branch ${plan.branch}. It may already exist.`;
        }

        const stageOk = await stageFiles(exec, cwd, plan.files);
        if (!stageOk) {
          return `Failed to stage files for ${plan.taskId}: ${plan.files.join(", ")}`;
        }

        const commitOk = await commitChanges(exec, cwd, plan.message);
        if (!commitOk) {
          return `Failed to commit for ${plan.taskId}. Check git status.`;
        }

        return `Committed ${plan.taskId} on branch ${plan.branch}. ${plan.files.length} files staged.`;
      },
    },
    {
      name: "omni-doctor",
      description:
        "Run diagnostic health checks on the project and detect stuck tasks.",
      execute: async ({ cwd }): Promise<CommandResult> => {
        const report = await runDoctor(cwd);
        return {
          text: renderDoctorReport(report),
          messageType: "omni-status",
          details: {
            title: "Omni-Pi Doctor",
            phase: report.overall,
          },
        };
      },
    },
  ];
}
