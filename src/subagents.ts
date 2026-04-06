import { randomUUID } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import type { ExtensionCommandContext } from "@mariozechner/pi-coding-agent";
import { readConfig } from "./config.js";
import {
  type ContextBlock,
  gatherTaskContext,
  renderContextBlocks,
} from "./context.js";
import type {
  EscalationBrief,
  OmniConfig,
  TaskAttemptResult,
  TaskBrief,
} from "./contracts.js";
import { detectRepoSignals } from "./repo.js";
import { loadAvailableSkills, matchSkillsForTask } from "./skills.js";
import type { WorkEngine } from "./work.js";

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
  discoverAgents: (
    cwd: string,
    scope: "user" | "project" | "both",
  ) => { agents: SubagentConfig[] };
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
      onUpdate?: (result: {
        details?: {
          progress?: Array<{
            agent: string;
            currentTool?: string;
            toolCount?: number;
          }>;
        };
      }) => void;
    },
  ) => Promise<SubagentSingleResult>;
  getFinalOutput: (messages: unknown[]) => string;
  recordRun?: (
    agent: string,
    task: string,
    exitCode: number,
    durationMs: number,
  ) => void;
  loadRunsForAgent?: (agent: string) => RunHistoryEntry[];
}

interface ClaudeAgentTextBlock {
  type: string;
  text?: string;
}

interface ClaudeAgentAssistantMessage {
  type: "assistant";
  message?: {
    content?: ClaudeAgentTextBlock[];
  };
}

interface ClaudeAgentResultMessage {
  type: "result";
  result?: string;
  subtype?: string;
  errors?: string[];
}

interface ClaudeAgentProgressMessage {
  type: "tool_progress" | "session_state_changed";
  title?: string;
  data?: {
    toolName?: string;
    status?: string;
  };
}

type ClaudeAgentMessage =
  | ClaudeAgentAssistantMessage
  | ClaudeAgentResultMessage
  | ClaudeAgentProgressMessage
  | { type: string };

interface ClaudeAgentDeps {
  query: (input: {
    prompt: string;
    options: {
      cwd: string;
      model: string;
      permissionMode: "bypassPermissions";
      allowDangerouslySkipPermissions: boolean;
      canUseTool: () => Promise<{ behavior: "allow" }>;
      env: Record<string, string | undefined>;
    };
  }) => AsyncIterable<ClaudeAgentMessage>;
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
  exec: (
    command: string,
    args: string[],
    options?: { cwd?: string },
  ) => Promise<{
    stdout: string;
    stderr: string;
    code: number;
    killed: boolean;
  }>;
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
    /(?:Write|Edit|Create)\s+(?:to\s+)?[`"']?([^\s`"',]+\.\w+)[`"']?/gu,
  ];
  for (const pattern of patterns) {
    for (const match of raw.matchAll(pattern)) {
      const file = match[1].replace(/^\/+/u, "");
      if (
        file.length > 0 &&
        !file.startsWith("node_modules") &&
        !files.includes(file)
      ) {
        files.push(file);
      }
    }
  }
  return files;
}

function omniPackageDir(): string {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
}

export async function loadSubagentDeps(
  packageDir = omniPackageDir(),
): Promise<SubagentDeps> {
  const agentsModule = await import(
    pathToFileURL(
      path.join(packageDir, "node_modules", "pi-subagents", "agents.ts"),
    ).href
  );
  const executionModule = await import(
    pathToFileURL(
      path.join(packageDir, "node_modules", "pi-subagents", "execution.ts"),
    ).href
  );
  const utilsModule = await import(
    pathToFileURL(
      path.join(packageDir, "node_modules", "pi-subagents", "utils.ts"),
    ).href
  );

  let recordRun: SubagentDeps["recordRun"];
  let loadRunsForAgent: SubagentDeps["loadRunsForAgent"];
  try {
    const historyModule = await import(
      pathToFileURL(
        path.join(packageDir, "node_modules", "pi-subagents", "run-history.ts"),
      ).href
    );
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
    loadRunsForAgent,
  } as SubagentDeps;
}

export async function loadClaudeAgentDeps(): Promise<ClaudeAgentDeps> {
  const sdkModule = await import("@anthropic-ai/claude-agent-sdk");
  return {
    query: sdkModule.query,
  };
}

export async function loadRunHistory(
  packageDir = omniPackageDir(),
): Promise<{ loadRunsForAgent: (agent: string) => RunHistoryEntry[] } | null> {
  try {
    const historyModule = await import(
      pathToFileURL(
        path.join(packageDir, "node_modules", "pi-subagents", "run-history.ts"),
      ).href
    );
    return { loadRunsForAgent: historyModule.loadRunsForAgent };
  } catch {
    return null;
  }
}

function buildWorkerPrompt(
  task: TaskBrief,
  verificationPlan: VerificationPlan,
  skillContext?: string,
  preReadContext?: ContextBlock[],
): string {
  const verificationChecks =
    verificationPlan.expectations.length > 0
      ? verificationPlan.expectations
      : task.doneCriteria.length > 0
        ? task.doneCriteria
        : ["Use the checks listed in .omni/TESTS.md"];
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
    ...task.contextFiles.map((file) => `- ${file}`),
  ];
  if (skillContext) {
    lines.push("", "Matched skill guidance:", skillContext);
  }
  if (preReadContext && preReadContext.length > 0) {
    lines.push(
      "",
      "Pre-loaded context (already read for you):",
      renderContextBlocks(preReadContext),
    );
  }
  return lines.join("\n");
}

function buildExpertPrompt(
  task: TaskBrief,
  escalation: EscalationBrief,
  verificationPlan: VerificationPlan,
  skillContext?: string,
  preReadContext?: ContextBlock[],
): string {
  const verificationChecks =
    verificationPlan.expectations.length > 0
      ? verificationPlan.expectations
      : task.doneCriteria.length > 0
        ? task.doneCriteria
        : ["Use the checks listed in .omni/TESTS.md"];
  const failedCommands =
    escalation.verificationResults
      ?.filter((r) => !r.passed)
      .map((r) => r.command)
      .join(", ") || "none";
  const modifiedFilesList =
    escalation.modifiedFiles?.map((f) => `- ${f}`).join("\n") ||
    "none recorded";
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
    ...task.contextFiles.map((file) => `- ${file}`),
  ];
  if (skillContext) {
    lines.push("", "Matched skill guidance:", skillContext);
  }
  if (preReadContext && preReadContext.length > 0) {
    lines.push(
      "",
      "Pre-loaded context (already read for you):",
      renderContextBlocks(preReadContext),
    );
  }
  return lines.join("\n");
}

function parseAttemptResult(
  raw: string,
  fallbackSummary: string,
): TaskAttemptResult {
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
      retryRecommended: true,
    },
  };
}

async function persistRawOutput(
  rootDir: string,
  taskId: string,
  suffix: string,
  content: string,
): Promise<void> {
  const target = path.join(rootDir, ".omni", "tasks", `${taskId}-${suffix}.md`);
  await writeFile(target, content, "utf8");
}

async function persistRunRecord(
  rootDir: string,
  record: SubagentRunRecord,
): Promise<void> {
  const target = path.join(
    rootDir,
    ".omni",
    "tasks",
    `${record.taskId}-${record.attemptLabel}.json`,
  );
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
    args: cleaned.slice(1),
  };
}

const ALLOWED_COMMANDS = new Set([
  "npm",
  "pnpm",
  "yarn",
  "bun",
  "npx",
  "make",
  "cargo",
  "go",
  "python",
  "python3",
  "pytest",
  "php",
  "composer",
  "bundle",
  "rake",
  "rspec",
  "dotnet",
  "swift",
  "mix",
  "gradle",
  "mvn",
  "cmake",
  "elixir",
]);

function isRunnableCommand(
  command: VerificationExec | null,
): command is VerificationExec {
  return Boolean(
    command &&
      (ALLOWED_COMMANDS.has(command.command) ||
        command.command.startsWith("./") ||
        command.command.includes("/")),
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
    "goal",
  ]);
  const values = [
    task.id,
    task.title,
    task.objective,
    ...task.contextFiles,
    ...task.doneCriteria,
  ]
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

function splitVerificationSection(
  content: string,
  heading: string,
): ParsedVerificationLine[] {
  const match = content.match(
    new RegExp(`${heading}\\n\\n([\\s\\S]*?)(?=\\n## |$)`, "u"),
  );
  const lines = (match?.[1] ?? "")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.startsWith("- "))
    .map((line) => line.slice(2).trim())
    .filter((line) => line.length > 0 && line !== "-");

  return lines.map((value) => ({
    value,
    command: parseCommandLine(value),
  }));
}

function inferTestCommandsFromContext(
  task: TaskBrief,
  languages?: string[],
): VerificationExec[] {
  const inferred: VerificationExec[] = [];
  const langs = new Set(languages ?? []);

  // TypeScript / JavaScript
  for (const file of task.contextFiles) {
    if (/\.test\.[tj]sx?$/u.test(file) || /\.spec\.[tj]sx?$/u.test(file)) {
      inferred.push({ command: "npx", args: ["vitest", "run", file] });
      continue;
    }
    if (/\.[tj]sx?$/u.test(file)) {
      const testFile = file
        .replace(/\.([tj]sx?)$/u, ".test.$1")
        .replace(/^src\//u, "tests/");
      if (!inferred.some((cmd) => cmd.args.includes(testFile))) {
        inferred.push({ command: "npx", args: ["vitest", "run", testFile] });
      }
    }
  }

  // Python
  if (langs.has("python")) {
    for (const file of task.contextFiles) {
      if (/test_.*\.py$/u.test(file) || /_test\.py$/u.test(file)) {
        inferred.push({ command: "pytest", args: [file] });
      } else if (/\.py$/u.test(file)) {
        const testFile = file.replace(
          /(\w+)\.py$/u,
          (_m, name) => `test_${name}.py`,
        );
        if (!inferred.some((cmd) => cmd.args.includes(testFile))) {
          inferred.push({ command: "pytest", args: [testFile] });
        }
      }
    }
  }

  // Rust
  if (langs.has("rust")) {
    for (const file of task.contextFiles) {
      if (/\.rs$/u.test(file)) {
        if (!inferred.some((cmd) => cmd.command === "cargo")) {
          inferred.push({ command: "cargo", args: ["test"] });
        }
        break;
      }
    }
  }

  // Go
  if (langs.has("go")) {
    for (const file of task.contextFiles) {
      if (/_test\.go$/u.test(file)) {
        inferred.push({
          command: "go",
          args: ["test", `./${path.dirname(file)}/...`],
        });
      } else if (/\.go$/u.test(file)) {
        inferred.push({
          command: "go",
          args: ["test", `./${path.dirname(file)}/...`],
        });
      }
    }
  }

  // Ruby
  if (langs.has("ruby")) {
    for (const file of task.contextFiles) {
      if (/_spec\.rb$/u.test(file)) {
        inferred.push({ command: "bundle", args: ["exec", "rspec", file] });
      } else if (/\.rb$/u.test(file)) {
        const specFile = file
          .replace(/\.rb$/u, "_spec.rb")
          .replace(/^lib\//u, "spec/");
        if (!inferred.some((cmd) => cmd.args.includes(specFile))) {
          inferred.push({
            command: "bundle",
            args: ["exec", "rspec", specFile],
          });
        }
      }
    }
  }

  // PHP
  if (langs.has("php")) {
    for (const file of task.contextFiles) {
      if (/Test\.php$/u.test(file)) {
        inferred.push({ command: "composer", args: ["test", "--", file] });
      } else if (/\.php$/u.test(file)) {
        const testFile = file
          .replace(/\.php$/u, "Test.php")
          .replace(/^src\//u, "tests/");
        if (!inferred.some((cmd) => cmd.args.includes(testFile))) {
          inferred.push({
            command: "composer",
            args: ["test", "--", testFile],
          });
        }
      }
    }
  }

  return inferred;
}

export async function readVerificationPlan(
  rootDir: string,
  task?: TaskBrief,
): Promise<VerificationPlan> {
  try {
    const content = await readFile(
      path.join(rootDir, ".omni", "TESTS.md"),
      "utf8",
    );
    const projectLines = splitVerificationSection(
      content,
      "## Project-wide checks",
    );
    const taskLines = splitVerificationSection(
      content,
      "## Task-specific checks",
    );
    const customLines = splitVerificationSection(content, "## Custom checks");
    const selectedTaskLines = task
      ? taskLines.filter((line) => matchesTask(line.value, task))
      : taskLines;

    const commands: VerificationExec[] = [];
    const expectations: string[] = [];
    for (const line of [
      ...projectLines,
      ...selectedTaskLines,
      ...customLines,
    ]) {
      if (isRunnableCommand(line.command)) {
        commands.push(line.command);
      } else {
        expectations.push(line.value);
      }
    }

    if (task) {
      const repoSignals = await detectRepoSignals(rootDir);
      const contextCommands = inferTestCommandsFromContext(
        task,
        repoSignals.languages,
      );
      for (const cmd of contextCommands) {
        const key = [cmd.command, ...cmd.args].join(" ");
        if (
          !commands.some(
            (existing) =>
              [existing.command, ...existing.args].join(" ") === key,
          )
        ) {
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
      expectations: [...new Set(expectations)],
    };
  } catch {
    return {
      commands: [],
      expectations: [],
    };
  }
}

async function runVerificationCommands(
  executor: VerificationExecutor | undefined,
  plan: VerificationPlan,
  rootDir: string,
): Promise<VerificationCommandResult[]> {
  if (!executor || plan.commands.length === 0) {
    return [];
  }

  const results: VerificationCommandResult[] = [];
  for (const item of plan.commands) {
    const execResult = await executor.exec(item.command, item.args, {
      cwd: item.cwd ?? rootDir,
    });
    results.push({
      command: [item.command, ...item.args].join(" "),
      passed: execResult.code === 0 && !execResult.killed,
      stdout: execResult.stdout,
      stderr: execResult.stderr,
      code: execResult.code,
    });
  }
  return results;
}

function findAgent(
  agents: SubagentConfig[],
  preferred: string,
  fallback: string,
): string {
  if (agents.some((agent) => agent.name === preferred)) {
    return preferred;
  }
  return fallback;
}

function getAgentConfig(
  agents: SubagentConfig[],
  preferred: string,
  fallback: string,
): SubagentConfig | undefined {
  return (
    agents.find((agent) => agent.name === preferred) ??
    agents.find((agent) => agent.name === fallback)
  );
}

function isClaudeAgentModel(model: string | undefined): boolean {
  return model?.startsWith("claude-agent/") ?? false;
}

function stripClaudeAgentPrefix(model: string): string {
  return model.replace(/^claude-agent\//u, "");
}

function isClaudeAgentResultMessage(
  message: ClaudeAgentMessage,
): message is ClaudeAgentResultMessage {
  return message.type === "result";
}

function isClaudeAgentAssistantMessage(
  message: ClaudeAgentMessage,
): message is ClaudeAgentAssistantMessage {
  return message.type === "assistant";
}

function isClaudeAgentProgressMessage(
  message: ClaudeAgentMessage,
): message is ClaudeAgentProgressMessage {
  return (
    message.type === "tool_progress" || message.type === "session_state_changed"
  );
}

function extractClaudeAgentRawOutput(messages: ClaudeAgentMessage[]): string {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (
      isClaudeAgentResultMessage(message) &&
      typeof message.result === "string" &&
      message.result.trim().length > 0
    ) {
      return message.result;
    }
  }

  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (
      isClaudeAgentResultMessage(message) &&
      Array.isArray(message.errors) &&
      message.errors.length > 0
    ) {
      return message.errors.join("\n");
    }
  }

  const assistantText = messages
    .flatMap((message) =>
      isClaudeAgentAssistantMessage(message)
        ? (message.message?.content
            ?.filter(
              (block): block is ClaudeAgentTextBlock & { text: string } =>
                typeof block.text === "string" && block.text.trim().length > 0,
            )
            .map((block) => block.text) ?? [])
        : [],
    )
    .join("\n\n")
    .trim();

  return assistantText;
}

async function runClaudeAgentTask(
  rootDir: string,
  ctx: ExtensionCommandContext,
  claudeDeps: ClaudeAgentDeps,
  agentName: string,
  agentModel: string,
  prompt: string,
): Promise<SubagentSingleResult> {
  const messages: ClaudeAgentMessage[] = [];

  try {
    const query = claudeDeps.query({
      prompt,
      options: {
        cwd: rootDir,
        model: stripClaudeAgentPrefix(agentModel),
        permissionMode: "bypassPermissions",
        allowDangerouslySkipPermissions: true,
        canUseTool: async () => ({ behavior: "allow" }),
        env: {
          ...process.env,
          CLAUDE_AGENT_SDK_CLIENT_APP: "omni-pi",
        },
      },
    });

    for await (const message of query) {
      messages.push(message);
      if (
        isClaudeAgentProgressMessage(message) &&
        message.type === "tool_progress"
      ) {
        const toolName = message.data?.toolName ?? message.title ?? "working";
        ctx.ui.setStatus("omni", `${agentName}: ${toolName}`);
      } else if (
        isClaudeAgentProgressMessage(message) &&
        message.type === "session_state_changed"
      ) {
        const status = message.data?.status;
        if (status) {
          ctx.ui.setStatus("omni", `${agentName}: ${status}`);
        }
      }
    }

    return {
      agent: agentName,
      exitCode: 0,
      messages,
    };
  } catch (error) {
    return {
      agent: agentName,
      exitCode: 1,
      messages,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

const AGENT_ROLE_MAP: Record<string, keyof OmniConfig["models"]> = {
  "omni-worker": "worker",
  "omni-expert": "expert",
  "omni-planner": "planner",
  "omni-brain": "brain",
};

function applyModelOverrides(
  agents: SubagentConfig[],
  config: OmniConfig | undefined,
): SubagentConfig[] {
  if (!config) {
    return agents;
  }
  return agents.map((agent) => {
    const role = AGENT_ROLE_MAP[agent.name];
    const modelOverride = role ? config.models[role] : undefined;
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
  verificationExecutor?: VerificationExecutor,
  claudeDeps?: ClaudeAgentDeps,
): Promise<WorkEngine> {
  const subagentDeps = deps ?? (await loadSubagentDeps());
  const resolvedClaudeDeps = claudeDeps;
  const config = await readConfig(rootDir);
  const discovery = subagentDeps.discoverAgents(rootDir, "both");
  const agentsWithOverrides = applyModelOverrides(discovery.agents, config);
  const workerAgent = findAgent(agentsWithOverrides, "omni-worker", "worker");
  const expertAgent = findAgent(agentsWithOverrides, "omni-expert", "reviewer");
  const workerAgentConfig = getAgentConfig(
    agentsWithOverrides,
    "omni-worker",
    "worker",
  );
  const expertAgentConfig = getAgentConfig(
    agentsWithOverrides,
    "omni-expert",
    "reviewer",
  );
  const sessionDir = path.join(rootDir, ".omni", "subagent-sessions");
  const skillTriggers = await loadAvailableSkills(rootDir);

  function getSkillContext(task: TaskBrief): string | undefined {
    const matched = matchSkillsForTask(task, skillTriggers);
    if (matched.length === 0) return undefined;
    return matched
      .map(
        (s) =>
          `[${s.name}]\n${s.content.replace(/^---[\s\S]*?---\n*/u, "").trim()}`,
      )
      .join("\n\n");
  }

  return {
    runWorkerTask: async (task, attempt) => {
      const verificationPlan = await readVerificationPlan(rootDir, task);
      const preReadContext = await gatherTaskContext(rootDir, task, 4000);
      const workerPrompt = buildWorkerPrompt(
        task,
        verificationPlan,
        getSkillContext(task),
        preReadContext,
      );
      ctx.ui.setStatus(
        "omni",
        `Worker ${workerAgent} is handling ${task.id} (attempt ${attempt})`,
      );
      const startTime = Date.now();
      const result =
        workerAgentConfig?.model && isClaudeAgentModel(workerAgentConfig.model)
          ? await runClaudeAgentTask(
              rootDir,
              ctx,
              resolvedClaudeDeps ?? (await loadClaudeAgentDeps()),
              workerAgent,
              workerAgentConfig.model,
              workerPrompt,
            )
          : await subagentDeps.runSync(
              rootDir,
              agentsWithOverrides,
              workerAgent,
              workerPrompt,
              {
                cwd: rootDir,
                runId: randomUUID(),
                sessionDir,
                onUpdate: (update) => {
                  const progress = update.details?.progress?.[0];
                  if (progress) {
                    ctx.ui.setStatus(
                      "omni",
                      `${progress.agent}: ${progress.currentTool ?? "working"}${progress.toolCount ? ` (${progress.toolCount} tools)` : ""}`,
                    );
                  }
                },
              },
            );
      const raw =
        workerAgentConfig?.model && isClaudeAgentModel(workerAgentConfig.model)
          ? extractClaudeAgentRawOutput(result.messages as ClaudeAgentMessage[])
          : subagentDeps.getFinalOutput(result.messages);
      const rawOutputPath = path.join(
        rootDir,
        ".omni",
        "tasks",
        `${task.id}-worker-attempt-${attempt}.md`,
      );
      await persistRawOutput(
        rootDir,
        task.id,
        `worker-attempt-${attempt}`,
        raw,
      );
      const parsed = parseAttemptResult(
        raw,
        `Worker ${workerAgent} completed without a structured verdict.`,
      );
      parsed.verification.taskId = task.id;
      if (result.exitCode !== 0 || result.error) {
        parsed.verification.passed = false;
        parsed.verification.failureSummary = [
          result.error ?? `Worker exited with code ${result.exitCode}`,
        ];
      }
      const verificationResults = await runVerificationCommands(
        verificationExecutor,
        verificationPlan,
        rootDir,
      );
      if (verificationResults.length > 0) {
        parsed.verification.checksRun = verificationResults.map(
          (item) => item.command,
        );
        const failed = verificationResults.filter((item) => !item.passed);
        parsed.verification.passed = failed.length === 0;
        parsed.verification.failureSummary = failed.map(
          (item) => `${item.command} failed with exit code ${item.code}`,
        );
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
        modifiedFiles,
      });
      subagentDeps.recordRun?.(
        workerAgent,
        `${task.id} attempt ${attempt}`,
        result.exitCode,
        Date.now() - startTime,
      );
      return { ...parsed, modifiedFiles };
    },
    runExpertTask: async (task, escalation) => {
      const verificationPlan = await readVerificationPlan(rootDir, task);
      const failedChecksSummary =
        escalation.verificationResults
          ?.filter((r) => !r.passed)
          .map((r) => r.command)
          .join(", ") || "none";
      ctx.ui.setStatus(
        "omni",
        `Escalating ${task.id} to expert after ${escalation.priorAttempts} failed attempts. Failed checks: ${failedChecksSummary}`,
      );
      const preReadContext = await gatherTaskContext(rootDir, task, 6000);
      const expertPrompt = buildExpertPrompt(
        task,
        escalation,
        verificationPlan,
        getSkillContext(task),
        preReadContext,
      );
      const expertStartTime = Date.now();
      const result =
        expertAgentConfig?.model && isClaudeAgentModel(expertAgentConfig.model)
          ? await runClaudeAgentTask(
              rootDir,
              ctx,
              resolvedClaudeDeps ?? (await loadClaudeAgentDeps()),
              expertAgent,
              expertAgentConfig.model,
              expertPrompt,
            )
          : await subagentDeps.runSync(
              rootDir,
              agentsWithOverrides,
              expertAgent,
              expertPrompt,
              {
                cwd: rootDir,
                runId: randomUUID(),
                sessionDir,
                onUpdate: (update) => {
                  const progress = update.details?.progress?.[0];
                  if (progress) {
                    ctx.ui.setStatus(
                      "omni",
                      `${progress.agent}: ${progress.currentTool ?? "resolving"}${progress.toolCount ? ` (${progress.toolCount} tools)` : ""}`,
                    );
                  }
                },
              },
            );
      const raw =
        expertAgentConfig?.model && isClaudeAgentModel(expertAgentConfig.model)
          ? extractClaudeAgentRawOutput(result.messages as ClaudeAgentMessage[])
          : subagentDeps.getFinalOutput(result.messages);
      const rawOutputPath = path.join(
        rootDir,
        ".omni",
        "tasks",
        `${task.id}-expert-output.md`,
      );
      await persistRawOutput(rootDir, task.id, "expert-output", raw);
      const parsed = parseAttemptResult(
        raw,
        `Expert ${expertAgent} completed without a structured verdict.`,
      );
      parsed.verification.taskId = task.id;
      if (result.exitCode !== 0 || result.error) {
        parsed.verification.passed = false;
        parsed.verification.failureSummary = [
          result.error ?? `Expert exited with code ${result.exitCode}`,
        ];
      }
      const verificationResults = await runVerificationCommands(
        verificationExecutor,
        verificationPlan,
        rootDir,
      );
      if (verificationResults.length > 0) {
        parsed.verification.checksRun = verificationResults.map(
          (item) => item.command,
        );
        const failed = verificationResults.filter((item) => !item.passed);
        parsed.verification.passed = failed.length === 0;
        parsed.verification.failureSummary = failed.map(
          (item) => `${item.command} failed with exit code ${item.code}`,
        );
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
        modifiedFiles,
      });
      subagentDeps.recordRun?.(
        expertAgent,
        `${task.id} expert`,
        result.exitCode,
        Date.now() - expertStartTime,
      );
      return { ...parsed, modifiedFiles };
    },
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
    ...task.contextFiles.map((file) => `- ${file}`),
  ].join("\n");
}

export async function createChainWorkEngine(
  rootDir: string,
  ctx: ExtensionCommandContext,
  deps?: SubagentDeps,
  verificationExecutor?: VerificationExecutor,
): Promise<WorkEngine> {
  const baseEngine = await createSubagentWorkEngine(
    rootDir,
    ctx,
    deps,
    verificationExecutor,
  );
  const subagentDeps = deps ?? (await loadSubagentDeps());
  const config = await readConfig(rootDir);
  const discovery = subagentDeps.discoverAgents(rootDir, "both");
  const agentsWithOverrides = applyModelOverrides(discovery.agents, config);
  const scoutAgent = findAgent(agentsWithOverrides, "omni-worker", "worker");
  const sessionDir = path.join(rootDir, ".omni", "subagent-sessions");

  return {
    runWorkerTask: async (task, attempt) => {
      ctx.ui.setStatus(
        "omni",
        `Scout analyzing ${task.id} before worker execution`,
      );
      const scoutResult = await subagentDeps.runSync(
        rootDir,
        agentsWithOverrides,
        scoutAgent,
        buildScoutPrompt(task),
        {
          cwd: rootDir,
          runId: randomUUID(),
          sessionDir,
        },
      );
      const scoutOutput = subagentDeps.getFinalOutput(scoutResult.messages);
      await persistRawOutput(
        rootDir,
        task.id,
        `scout-attempt-${attempt}`,
        scoutOutput,
      );

      const enrichedTask: TaskBrief = {
        ...task,
        objective: `${task.objective}\n\nScout analysis:\n${scoutOutput.slice(0, 2000)}`,
      };

      return baseEngine.runWorkerTask(enrichedTask, attempt);
    },
    runExpertTask: baseEngine.runExpertTask,
  };
}
