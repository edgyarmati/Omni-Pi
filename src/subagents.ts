import { randomUUID } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import type { ExtensionCommandContext } from "@mariozechner/pi-coding-agent";

import type { EscalationBrief, OmniConfig, TaskAttemptResult, TaskBrief } from "./contracts.js";
import type { WorkEngine } from "./work.js";
import { readConfig } from "./config.js";
import { loadSkillTriggers, matchSkillsForTask } from "./skills.js";

interface SubagentConfig {
  name: string;
  systemPrompt: string;
  model?: string;
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
  recordRun?: (agent: string, task: string, exitCode: number, durationMs: number) => void;
  loadRunsForAgent?: (agent: string) => RunHistoryEntry[];
}

export interface RunHistoryEntry {
  agent: string;
  task: string;
  ts: number;
  status: "ok" | "error";
  duration: number;
  exit?: number;
}

interface VerificationExec {
  command: string;
  args: string[];
  cwd?: string;
}

interface VerificationPlan {
  commands: VerificationExec[];
  expectations: string[];
}

interface ParsedVerificationLine {
  value: string;
  command: VerificationExec | null;
}

interface VerificationCommandResult {
  command: string;
  passed: boolean;
  stdout: string;
  stderr: string;
  code: number;
}

interface VerificationExecutor {
  exec: (command: string, args: string[], options?: { cwd?: string }) => Promise<{ stdout: string; stderr: string; code: number; killed: boolean }>;
}

interface SubagentRunRecord {
  agent: string;
  taskId: string;
  attemptLabel: string;
  exitCode: number;
  rawOutputPath: string;
  passed: boolean;
  checksRun: string[];
  failureSummary: string[];
  verificationCommands?: VerificationCommandResult[];
  modifiedFiles?: string[];
}

function extractModifiedFiles(raw: string): string[] {
  const files: string[] = [];
  const patterns = [
    /(?:created|modified|edited|wrote|updated|changed)\s+(?:file\s+)?[`"']?([^\s`"',]+\.\w+)[`"']?/giu,
    /(?:Write|Edit|Create)\s+(?:to\s+)?[`"']?([^\s`"',]+\.\w+)[`"']?/gu
  ];
  for (const pattern of patterns) {
    for (const match of raw.matchAll(pattern)) {
      const file = match[1].replace(/^\/+/u, "");
      if (file.length > 0 && !file.startsWith("node_modules") && !files.includes(file)) {
        files.push(file);
      }
    }
  }
  return files;
}

function omniPackageDir(): string {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
}

export async function loadSubagentDeps(packageDir = omniPackageDir()): Promise<SubagentDeps> {
  const agentsModule = await import(pathToFileURL(path.join(packageDir, "node_modules", "pi-subagents", "agents.ts")).href);
  const executionModule = await import(pathToFileURL(path.join(packageDir, "node_modules", "pi-subagents", "execution.ts")).href);
  const utilsModule = await import(pathToFileURL(path.join(packageDir, "node_modules", "pi-subagents", "utils.ts")).href);

  let recordRun: SubagentDeps["recordRun"];
  let loadRunsForAgent: SubagentDeps["loadRunsForAgent"];
  try {
    const historyModule = await import(pathToFileURL(path.join(packageDir, "node_modules", "pi-subagents", "run-history.ts")).href);
    recordRun = historyModule.recordRun;
    loadRunsForAgent = historyModule.loadRunsForAgent;
  } catch {
    // run-history not available in this version of pi-subagents
  }

  return {
    discoverAgents: agentsModule.discoverAgents,
    runSync: executionModule.runSync,
    getFinalOutput: utilsModule.getFinalOutput,
    recordRun,
    loadRunsForAgent
  } as SubagentDeps;
}

export async function loadRunHistory(packageDir = omniPackageDir()): Promise<{ loadRunsForAgent: (agent: string) => RunHistoryEntry[] } | null> {
  try {
    const historyModule = await import(pathToFileURL(path.join(packageDir, "node_modules", "pi-subagents", "run-history.ts")).href);
    return { loadRunsForAgent: historyModule.loadRunsForAgent };
  } catch {
    return null;
  }
}

function buildWorkerPrompt(task: TaskBrief, verificationPlan: VerificationPlan, skillContext?: string): string {
  const verificationChecks = verificationPlan.expectations.length > 0 ? verificationPlan.expectations : task.doneCriteria.length > 0 ? task.doneCriteria : ["Use the checks listed in .omni/TESTS.md"];
  const lines = [
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
    `Verification expectations: ${verificationChecks.join("; ")}`,
    `Runtime verification commands: ${verificationPlan.commands.map((item) => [item.command, ...item.args].join(" ")).join("; ") || "none listed"}`,
    `Relevant skills: ${task.skills.join(", ") || "none"}`,
    "Required files to read before working:",
    "- .omni/PROJECT.md",
    "- .omni/SPEC.md",
    "- .omni/TESTS.md",
    `- .omni/tasks/${task.id}-BRIEF.md`,
    ...task.contextFiles.map((file) => `- ${file}`)
  ];
  if (skillContext) {
    lines.push("", "Matched skill guidance:", skillContext);
  }
  return lines.join("\n");
}

function buildExpertPrompt(task: TaskBrief, escalation: EscalationBrief, verificationPlan: VerificationPlan, skillContext?: string): string {
  const verificationChecks = verificationPlan.expectations.length > 0 ? verificationPlan.expectations : task.doneCriteria.length > 0 ? task.doneCriteria : ["Use the checks listed in .omni/TESTS.md"];
  const failedCommands = escalation.verificationResults?.filter((r) => !r.passed).map((r) => r.command).join(", ") || "none";
  const modifiedFilesList = escalation.modifiedFiles?.map((f) => `- ${f}`).join("\n") || "none recorded";
  const lines = [
    "You are Omni-Pi's expert executor taking over after repeated failures.",
    "Fix the task directly and do not repeat the previous failed path blindly.",
    "Run the necessary verification steps yourself when possible.",
    "Return your final answer as JSON only with this shape:",
    '{"summary":"...","verification":{"passed":true,"checksRun":["..."],"failureSummary":[],"retryRecommended":false}}',
    "",
    `Task ID: ${task.id}`,
    `Title: ${task.title}`,
    `Objective: ${task.objective}`,
    `Verification expectations: ${verificationChecks.join("; ")}`,
    `Runtime verification commands: ${verificationPlan.commands.map((item) => [item.command, ...item.args].join(" ")).join("; ") || "none listed"}`,
    `Prior attempts: ${escalation.priorAttempts}`,
    `Failed verification commands: ${failedCommands}`,
    `Modified files in previous attempts:`,
    modifiedFilesList,
    `Failure logs: ${escalation.failureLogs.join(" | ") || "none recorded"}`,
    `Expert objective: ${escalation.expertObjective}`,
    "Required files to read before working:",
    "- .omni/PROJECT.md",
    "- .omni/SPEC.md",
    "- .omni/TESTS.md",
    `- .omni/tasks/${task.id}-BRIEF.md`,
    `- .omni/tasks/${task.id}-ESCALATION.md`,
    ...task.contextFiles.map((file) => `- ${file}`)
  ];
  if (skillContext) {
    lines.push("", "Matched skill guidance:", skillContext);
  }
  return lines.join("\n");
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

async function persistRunRecord(rootDir: string, record: SubagentRunRecord): Promise<void> {
  const target = path.join(rootDir, ".omni", "tasks", `${record.taskId}-${record.attemptLabel}.json`);
  await writeFile(target, JSON.stringify(record, null, 2), "utf8");
}

function parseCommandLine(line: string): VerificationExec | null {
  const tokens = line.match(/(?:"[^"]*"|'[^']*'|\S+)/gu) ?? [];
  const cleaned = tokens.map((token) => token.replace(/^['"]|['"]$/gu, ""));
  if (cleaned.length === 0) {
    return null;
  }
  return {
    command: cleaned[0],
    args: cleaned.slice(1)
  };
}

function isRunnableCommand(command: VerificationExec | null): command is VerificationExec {
  return Boolean(
    command &&
      (command.command === "npm" ||
        command.command === "pnpm" ||
        command.command === "yarn" ||
        command.command === "bun" ||
        command.command === "npx" ||
        command.command.startsWith("./") ||
        command.command.includes("/"))
  );
}

function collectSignificantTerms(task: TaskBrief): Set<string> {
  const stopWords = new Set([
    "the",
    "and",
    "for",
    "with",
    "task",
    "verify",
    "check",
    "run",
    "from",
    "that",
    "this",
    "into",
    "make",
    "sure",
    "using",
    "use",
    "your",
    "goal"
  ]);
  const values = [task.id, task.title, task.objective, ...task.contextFiles, ...task.doneCriteria]
    .join(" ")
    .toLowerCase()
    .split(/[^a-z0-9_.\-/]+/u)
    .map((value) => value.trim())
    .filter((value) => value.length >= 3 && !stopWords.has(value));

  const expanded = new Set<string>();
  for (const value of values) {
    expanded.add(value);
    for (const fragment of value.split(/[_.\-/]+/u)) {
      if (fragment.length >= 3 && !stopWords.has(fragment)) {
        expanded.add(fragment);
      }
    }
  }
  return expanded;
}

function matchesTask(line: string, task: TaskBrief): boolean {
  const lower = line.toLowerCase();
  if (lower.includes(task.id.toLowerCase())) {
    return true;
  }
  const terms = collectSignificantTerms(task);
  return [...terms].some((term) => lower.includes(term));
}

function splitVerificationSection(content: string, heading: string): ParsedVerificationLine[] {
  const match = content.match(new RegExp(`${heading}\\n\\n([\\s\\S]*?)(?=\\n## |$)`, "u"));
  const lines = (match?.[1] ?? "")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.startsWith("- "))
    .map((line) => line.slice(2).trim())
    .filter((line) => line.length > 0 && line !== "-");

  return lines.map((value) => ({
    value,
    command: parseCommandLine(value)
  }));
}

function inferTestCommandsFromContext(task: TaskBrief): VerificationExec[] {
  const inferred: VerificationExec[] = [];
  const testPatterns = [
    { pattern: /\.test\.[tj]sx?$/u, runner: "npm" },
    { pattern: /\.spec\.[tj]sx?$/u, runner: "npm" }
  ];

  for (const file of task.contextFiles) {
    for (const { pattern } of testPatterns) {
      if (pattern.test(file)) {
        inferred.push({ command: "npx", args: ["vitest", "run", file] });
        break;
      }
    }

    const testFile = file
      .replace(/\.([tj]sx?)$/u, ".test.$1")
      .replace(/^src\//u, "tests/");
    if (testFile !== file && !inferred.some((cmd) => cmd.args.includes(testFile))) {
      inferred.push({ command: "npx", args: ["vitest", "run", testFile] });
    }
  }

  return inferred;
}

export async function readVerificationPlan(rootDir: string, task?: TaskBrief): Promise<VerificationPlan> {
  try {
    const content = await readFile(path.join(rootDir, ".omni", "TESTS.md"), "utf8");
    const projectLines = splitVerificationSection(content, "## Project-wide checks");
    const taskLines = splitVerificationSection(content, "## Task-specific checks");
    const selectedTaskLines = task ? taskLines.filter((line) => matchesTask(line.value, task)) : taskLines;

    const commands: VerificationExec[] = [];
    const expectations: string[] = [];
    for (const line of [...projectLines, ...selectedTaskLines]) {
      if (isRunnableCommand(line.command)) {
        commands.push(line.command);
      } else {
        expectations.push(line.value);
      }
    }

    if (task) {
      const contextCommands = inferTestCommandsFromContext(task);
      for (const cmd of contextCommands) {
        const key = [cmd.command, ...cmd.args].join(" ");
        if (!commands.some((existing) => [existing.command, ...existing.args].join(" ") === key)) {
          commands.push(cmd);
        }
      }

      for (const criterion of task.doneCriteria) {
        if (!expectations.includes(criterion)) {
          expectations.push(criterion);
        }
      }
    }

    return {
      commands,
      expectations: [...new Set(expectations)]
    };
  } catch {
    return {
      commands: [],
      expectations: []
    };
  }
}

async function runVerificationCommands(
  executor: VerificationExecutor | undefined,
  plan: VerificationPlan,
  rootDir: string
): Promise<VerificationCommandResult[]> {
  if (!executor || plan.commands.length === 0) {
    return [];
  }

  const results: VerificationCommandResult[] = [];
  for (const item of plan.commands) {
    const execResult = await executor.exec(item.command, item.args, { cwd: item.cwd ?? rootDir });
    results.push({
      command: [item.command, ...item.args].join(" "),
      passed: execResult.code === 0 && !execResult.killed,
      stdout: execResult.stdout,
      stderr: execResult.stderr,
      code: execResult.code
    });
  }
  return results;
}

function findAgent(agents: SubagentConfig[], preferred: string, fallback: string): string {
  if (agents.some((agent) => agent.name === preferred)) {
    return preferred;
  }
  return fallback;
}

function applyModelOverrides(agents: SubagentConfig[], config: OmniConfig | undefined): SubagentConfig[] {
  if (!config) {
    return agents;
  }
  return agents.map((agent) => {
    const agentName = agent.name;
    const modelOverride =
      agentName === "omni-worker"
        ? config.models.worker
        : agentName === "omni-expert"
          ? config.models.expert
          : undefined;
    if (modelOverride) {
      return { ...agent, model: modelOverride };
    }
    return agent;
  });
}

export async function createSubagentWorkEngine(
  rootDir: string,
  ctx: ExtensionCommandContext,
  deps?: SubagentDeps,
  verificationExecutor?: VerificationExecutor
): Promise<WorkEngine> {
  const subagentDeps = deps ?? (await loadSubagentDeps());
  const config = await readConfig(rootDir);
  const discovery = subagentDeps.discoverAgents(rootDir, "both");
  const agentsWithOverrides = applyModelOverrides(discovery.agents, config);
  const workerAgent = findAgent(agentsWithOverrides, "omni-worker", "worker");
  const expertAgent = findAgent(agentsWithOverrides, "omni-expert", "reviewer");
  const sessionDir = path.join(rootDir, ".omni", "subagent-sessions");
  const packageDir = omniPackageDir();
  const skillTriggers = await loadSkillTriggers(path.join(packageDir, "skills"));

  function getSkillContext(task: TaskBrief): string | undefined {
    const matched = matchSkillsForTask(task, skillTriggers);
    if (matched.length === 0) return undefined;
    return matched.map((s) => `[${s.name}]\n${s.content.replace(/^---[\s\S]*?---\n*/u, "").trim()}`).join("\n\n");
  }

  return {
    runWorkerTask: async (task, attempt) => {
      const verificationPlan = await readVerificationPlan(rootDir, task);
      ctx.ui.setStatus("omni", `Worker ${workerAgent} is handling ${task.id} (attempt ${attempt})`);
      const startTime = Date.now();
      const result = await subagentDeps.runSync(rootDir, agentsWithOverrides, workerAgent, buildWorkerPrompt(task, verificationPlan, getSkillContext(task)), {
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
      const rawOutputPath = path.join(rootDir, ".omni", "tasks", `${task.id}-worker-attempt-${attempt}.md`);
      await persistRawOutput(rootDir, task.id, `worker-attempt-${attempt}`, raw);
      const parsed = parseAttemptResult(raw, `Worker ${workerAgent} completed without a structured verdict.`);
      parsed.verification.taskId = task.id;
      if (result.exitCode !== 0 || result.error) {
        parsed.verification.passed = false;
        parsed.verification.failureSummary = [result.error ?? `Worker exited with code ${result.exitCode}`];
      }
      const verificationResults = await runVerificationCommands(verificationExecutor, verificationPlan, rootDir);
      if (verificationResults.length > 0) {
        parsed.verification.checksRun = verificationResults.map((item) => item.command);
        const failed = verificationResults.filter((item) => !item.passed);
        parsed.verification.passed = failed.length === 0;
        parsed.verification.failureSummary = failed.map((item) => `${item.command} failed with exit code ${item.code}`);
        parsed.verification.retryRecommended = failed.length > 0;
      }
      const modifiedFiles = extractModifiedFiles(raw);
      await persistRunRecord(rootDir, {
        agent: workerAgent,
        taskId: task.id,
        attemptLabel: `worker-attempt-${attempt}`,
        exitCode: result.exitCode,
        rawOutputPath,
        passed: parsed.verification.passed,
        checksRun: parsed.verification.checksRun,
        failureSummary: parsed.verification.failureSummary,
        verificationCommands: verificationResults,
        modifiedFiles
      });
      subagentDeps.recordRun?.(workerAgent, `${task.id} attempt ${attempt}`, result.exitCode, Date.now() - startTime);
      return { ...parsed, modifiedFiles };
    },
    runExpertTask: async (task, escalation) => {
      const verificationPlan = await readVerificationPlan(rootDir, task);
      const failedChecksSummary =
        escalation.verificationResults?.filter((r) => !r.passed).map((r) => r.command).join(", ") || "none";
      ctx.ui.setStatus(
        "omni",
        `Escalating ${task.id} to expert after ${escalation.priorAttempts} failed attempts. Failed checks: ${failedChecksSummary}`
      );
      const expertStartTime = Date.now();
      const result = await subagentDeps.runSync(
        rootDir,
        agentsWithOverrides,
        expertAgent,
        buildExpertPrompt(task, escalation, verificationPlan, getSkillContext(task)),
        {
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
        }
      );
      const raw = subagentDeps.getFinalOutput(result.messages);
      const rawOutputPath = path.join(rootDir, ".omni", "tasks", `${task.id}-expert-output.md`);
      await persistRawOutput(rootDir, task.id, "expert-output", raw);
      const parsed = parseAttemptResult(raw, `Expert ${expertAgent} completed without a structured verdict.`);
      parsed.verification.taskId = task.id;
      if (result.exitCode !== 0 || result.error) {
        parsed.verification.passed = false;
        parsed.verification.failureSummary = [result.error ?? `Expert exited with code ${result.exitCode}`];
      }
      const verificationResults = await runVerificationCommands(verificationExecutor, verificationPlan, rootDir);
      if (verificationResults.length > 0) {
        parsed.verification.checksRun = verificationResults.map((item) => item.command);
        const failed = verificationResults.filter((item) => !item.passed);
        parsed.verification.passed = failed.length === 0;
        parsed.verification.failureSummary = failed.map((item) => `${item.command} failed with exit code ${item.code}`);
        parsed.verification.retryRecommended = failed.length > 0;
      }
      const modifiedFiles = extractModifiedFiles(raw);
      await persistRunRecord(rootDir, {
        agent: expertAgent,
        taskId: task.id,
        attemptLabel: "expert-output",
        exitCode: result.exitCode,
        rawOutputPath,
        passed: parsed.verification.passed,
        checksRun: parsed.verification.checksRun,
        failureSummary: parsed.verification.failureSummary,
        verificationCommands: verificationResults,
        modifiedFiles
      });
      subagentDeps.recordRun?.(expertAgent, `${task.id} expert`, result.exitCode, Date.now() - expertStartTime);
      return { ...parsed, modifiedFiles };
    }
  };
}

function buildScoutPrompt(task: TaskBrief): string {
  return [
    "You are Omni-Pi's scout agent.",
    "Analyze the codebase to gather context for the upcoming implementation task.",
    "Return a concise summary of: relevant files, existing patterns to follow, potential pitfalls, and suggested approach.",
    "Do NOT make any code changes. Only read and analyze.",
    "",
    `Task ID: ${task.id}`,
    `Title: ${task.title}`,
    `Objective: ${task.objective}`,
    `Context files: ${task.contextFiles.join(", ") || "none specified"}`,
    "Required files to read:",
    "- .omni/PROJECT.md",
    "- .omni/SPEC.md",
    ...task.contextFiles.map((file) => `- ${file}`)
  ].join("\n");
}

export async function createChainWorkEngine(
  rootDir: string,
  ctx: ExtensionCommandContext,
  deps?: SubagentDeps,
  verificationExecutor?: VerificationExecutor
): Promise<WorkEngine> {
  const baseEngine = await createSubagentWorkEngine(rootDir, ctx, deps, verificationExecutor);
  const subagentDeps = deps ?? (await loadSubagentDeps());
  const config = await readConfig(rootDir);
  const discovery = subagentDeps.discoverAgents(rootDir, "both");
  const agentsWithOverrides = applyModelOverrides(discovery.agents, config);
  const scoutAgent = findAgent(agentsWithOverrides, "omni-worker", "worker");
  const sessionDir = path.join(rootDir, ".omni", "subagent-sessions");

  return {
    runWorkerTask: async (task, attempt) => {
      ctx.ui.setStatus("omni", `Scout analyzing ${task.id} before worker execution`);
      const scoutResult = await subagentDeps.runSync(rootDir, agentsWithOverrides, scoutAgent, buildScoutPrompt(task), {
        cwd: rootDir,
        runId: randomUUID(),
        sessionDir
      });
      const scoutOutput = subagentDeps.getFinalOutput(scoutResult.messages);
      await persistRawOutput(rootDir, task.id, `scout-attempt-${attempt}`, scoutOutput);

      const enrichedTask: TaskBrief = {
        ...task,
        objective: `${task.objective}\n\nScout analysis:\n${scoutOutput.slice(0, 2000)}`
      };

      return baseEngine.runWorkerTask(enrichedTask, attempt);
    },
    runExpertTask: baseEngine.runExpertTask
  };
}
