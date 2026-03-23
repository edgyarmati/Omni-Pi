import { randomUUID } from "node:crypto";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import type { ExtensionCommandContext } from "@mariozechner/pi-coding-agent";

import type { EscalationBrief, TaskAttemptResult, TaskBrief } from "./contracts.js";
import type { WorkEngine } from "./work.js";

interface SubagentConfig {
  name: string;
  systemPrompt: string;
}

interface SubagentSingleResult {
  agent: string;
  exitCode: number;
  messages: unknown[];
  error?: string;
}

interface SubagentDeps {
  discoverAgents: (cwd: string, scope: "user" | "project" | "both") => { agents: SubagentConfig[] };
  runSync: (
    runtimeCwd: string,
    agents: SubagentConfig[],
    agentName: string,
    task: string,
    options: {
      cwd?: string;
      runId: string;
      sessionDir?: string;
      maxOutput?: { bytes?: number; lines?: number };
      onUpdate?: (result: { details?: { progress?: Array<{ agent: string; currentTool?: string; toolCount?: number }> } }) => void;
    }
  ) => Promise<SubagentSingleResult>;
  getFinalOutput: (messages: unknown[]) => string;
}

function omniPackageDir(): string {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
}

export async function loadSubagentDeps(packageDir = omniPackageDir()): Promise<SubagentDeps> {
  const agentsModule = await import(pathToFileURL(path.join(packageDir, "node_modules", "pi-subagents", "agents.ts")).href);
  const executionModule = await import(pathToFileURL(path.join(packageDir, "node_modules", "pi-subagents", "execution.ts")).href);
  const utilsModule = await import(pathToFileURL(path.join(packageDir, "node_modules", "pi-subagents", "utils.ts")).href);

  return {
    discoverAgents: agentsModule.discoverAgents,
    runSync: executionModule.runSync,
    getFinalOutput: utilsModule.getFinalOutput
  } as SubagentDeps;
}

function buildWorkerPrompt(task: TaskBrief): string {
  return [
    "You are Omni-Pi's worker executor.",
    "Complete the task using the repository and relevant project files.",
    "Run the necessary verification steps yourself when possible.",
    "Return your final answer as JSON only with this shape:",
    '{"summary":"...","verification":{"passed":true,"checksRun":["..."],"failureSummary":[],"retryRecommended":false}}',
    "",
    `Task ID: ${task.id}`,
    `Title: ${task.title}`,
    `Objective: ${task.objective}`,
    `Done criteria: ${task.doneCriteria.join("; ") || "None provided"}`,
    `Relevant skills: ${task.skills.join(", ") || "none"}`,
    "Required files to read before working:",
    "- .omni/PROJECT.md",
    "- .omni/SPEC.md",
    "- .omni/TESTS.md",
    `- .omni/tasks/${task.id}-BRIEF.md`,
    ...task.contextFiles.map((file) => `- ${file}`)
  ].join("\n");
}

function buildExpertPrompt(task: TaskBrief, escalation: EscalationBrief): string {
  return [
    "You are Omni-Pi's expert executor taking over after repeated failures.",
    "Fix the task directly and do not repeat the previous failed path blindly.",
    "Run the necessary verification steps yourself when possible.",
    "Return your final answer as JSON only with this shape:",
    '{"summary":"...","verification":{"passed":true,"checksRun":["..."],"failureSummary":[],"retryRecommended":false}}',
    "",
    `Task ID: ${task.id}`,
    `Title: ${task.title}`,
    `Objective: ${task.objective}`,
    `Prior attempts: ${escalation.priorAttempts}`,
    `Failure logs: ${escalation.failureLogs.join(" | ") || "none recorded"}`,
    `Expert objective: ${escalation.expertObjective}`,
    "Required files to read before working:",
    "- .omni/PROJECT.md",
    "- .omni/SPEC.md",
    "- .omni/TESTS.md",
    `- .omni/tasks/${task.id}-BRIEF.md`,
    `- .omni/tasks/${task.id}-ESCALATION.md`,
    ...task.contextFiles.map((file) => `- ${file}`)
  ].join("\n");
}

function parseAttemptResult(raw: string, fallbackSummary: string): TaskAttemptResult {
  const trimmed = raw.trim();
  const fencedMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/u);
  const candidate = fencedMatch?.[1]?.trim() ?? trimmed;

  try {
    const parsed = JSON.parse(candidate) as TaskAttemptResult;
    if (parsed?.verification && typeof parsed.summary === "string") {
      return parsed;
    }
  } catch {
    // Fall through to normalized failure.
  }

  return {
    summary: fallbackSummary,
    verification: {
      taskId: "unknown",
      passed: false,
      checksRun: ["subagent-output-parse"],
      failureSummary: ["Subagent did not return the expected JSON result."],
      retryRecommended: true
    }
  };
}

async function persistRawOutput(rootDir: string, taskId: string, suffix: string, content: string): Promise<void> {
  const target = path.join(rootDir, ".omni", "tasks", `${taskId}-${suffix}.md`);
  await writeFile(target, content, "utf8");
}

function findAgent(agents: SubagentConfig[], preferred: string, fallback: string): string {
  if (agents.some((agent) => agent.name === preferred)) {
    return preferred;
  }
  return fallback;
}

export async function createSubagentWorkEngine(
  rootDir: string,
  ctx: ExtensionCommandContext,
  deps?: SubagentDeps
): Promise<WorkEngine> {
  const subagentDeps = deps ?? (await loadSubagentDeps());
  const discovery = subagentDeps.discoverAgents(rootDir, "both");
  const workerAgent = findAgent(discovery.agents, "omni-worker", "worker");
  const expertAgent = findAgent(discovery.agents, "omni-expert", "reviewer");
  const sessionDir = path.join(rootDir, ".omni", "subagent-sessions");

  return {
    runWorkerTask: async (task, attempt) => {
      ctx.ui.setStatus("omni", `Worker ${workerAgent} is handling ${task.id} (attempt ${attempt})`);
      const result = await subagentDeps.runSync(rootDir, discovery.agents, workerAgent, buildWorkerPrompt(task), {
        cwd: rootDir,
        runId: randomUUID(),
        sessionDir,
        onUpdate: (update) => {
          const progress = update.details?.progress?.[0];
          if (progress) {
            ctx.ui.setStatus(
              "omni",
              `${progress.agent}: ${progress.currentTool ?? "working"}${progress.toolCount ? ` (${progress.toolCount} tools)` : ""}`
            );
          }
        }
      });
      const raw = subagentDeps.getFinalOutput(result.messages);
      await persistRawOutput(rootDir, task.id, `worker-attempt-${attempt}`, raw);
      const parsed = parseAttemptResult(raw, `Worker ${workerAgent} completed without a structured verdict.`);
      parsed.verification.taskId = task.id;
      if (result.exitCode !== 0 || result.error) {
        parsed.verification.passed = false;
        parsed.verification.failureSummary = [result.error ?? `Worker exited with code ${result.exitCode}`];
      }
      return parsed;
    },
    runExpertTask: async (task, escalation) => {
      ctx.ui.setStatus("omni", `Expert ${expertAgent} is taking over ${task.id}`);
      const result = await subagentDeps.runSync(rootDir, discovery.agents, expertAgent, buildExpertPrompt(task, escalation), {
        cwd: rootDir,
        runId: randomUUID(),
        sessionDir,
        onUpdate: (update) => {
          const progress = update.details?.progress?.[0];
          if (progress) {
            ctx.ui.setStatus(
              "omni",
              `${progress.agent}: ${progress.currentTool ?? "resolving"}${progress.toolCount ? ` (${progress.toolCount} tools)` : ""}`
            );
          }
        }
      });
      const raw = subagentDeps.getFinalOutput(result.messages);
      await persistRawOutput(rootDir, task.id, "expert-output", raw);
      const parsed = parseAttemptResult(raw, `Expert ${expertAgent} completed without a structured verdict.`);
      parsed.verification.taskId = task.id;
      if (result.exitCode !== 0 || result.error) {
        parsed.verification.passed = false;
        parsed.verification.failureSummary = [result.error ?? `Expert exited with code ${result.exitCode}`];
      }
      return parsed;
    }
  };
}
