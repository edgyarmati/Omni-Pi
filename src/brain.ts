import { access, readFile } from "node:fs/promises";
import path from "node:path";

import type { OmniState } from "./contracts.js";
import { initializeOmniProject, readOmniStatus } from "./workflow.js";

const BRAIN_SYSTEM_APPEND = `## Omni-Pi Single-Brain Mode

You are Omni-Pi's only user-facing brain.

Your workflow is mandatory:
1. Interview the user until the requested behavior, constraints, and success criteria are concrete enough to implement safely.
2. Before editing code, make sure the durable project notes in .omni/ reflect the current understanding.
3. Break the requested work into bounded, verifiable slices in .omni/TASKS.md before implementation.
4. Implement one slice at a time.
5. Run the planned checks, record progress in .omni/STATE.md and .omni/SESSION-SUMMARY.md, and tighten the plan if a slice fails.

Behavior rules:
- Stay friendly, plain-spoken, and direct.
- Do not expose planner/worker/expert role handoffs. Everything happens behind the scenes.
- Ask targeted follow-up questions when the request is underspecified.
- Do not start editing code until the spec is explicit enough to avoid guessing.
- Keep documentation current in .omni/PROJECT.md, .omni/SPEC.md, .omni/TASKS.md, .omni/TESTS.md, .omni/STATE.md, and .omni/DECISIONS.md when relevant.
- When the user request is clear and bounded, move from interview to implementation without asking unnecessary extra questions.
`;

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function readOptional(filePath: string): Promise<string | null> {
  try {
    return await readFile(filePath, "utf8");
  } catch {
    return null;
  }
}

function renderStateSummary(state: OmniState | null): string {
  if (!state) {
    return "No durable Omni-Pi state exists yet.";
  }

  return [
    `Current phase: ${state.currentPhase}`,
    `Active task: ${state.activeTask}`,
    `Status summary: ${state.statusSummary}`,
    `Blockers: ${state.blockers.length > 0 ? state.blockers.join("; ") : "None"}`,
    `Next step: ${state.nextStep}`,
  ].join("\n");
}

function clipSection(value: string | null, maxChars: number): string {
  if (!value) {
    return "- Missing";
  }
  const trimmed = value.trim();
  if (trimmed.length <= maxChars) {
    return trimmed;
  }
  return `${trimmed.slice(0, maxChars)}…`;
}

export async function ensureOmniInitialized(
  cwd: string,
): Promise<"initialized" | "existing"> {
  const statePath = path.join(cwd, ".omni", "STATE.md");
  if (await fileExists(statePath)) {
    return "existing";
  }

  await initializeOmniProject(cwd);
  return "initialized";
}

export async function buildBrainSystemPromptSuffix(
  cwd: string,
): Promise<string> {
  const projectPath = path.join(cwd, ".omni", "PROJECT.md");
  const specPath = path.join(cwd, ".omni", "SPEC.md");
  const tasksPath = path.join(cwd, ".omni", "TASKS.md");
  const testsPath = path.join(cwd, ".omni", "TESTS.md");

  const state = await readOmniStatus(cwd).catch(() => null);
  const [project, spec, tasks, tests] = await Promise.all([
    readOptional(projectPath),
    readOptional(specPath),
    readOptional(tasksPath),
    readOptional(testsPath),
  ]);

  return `${BRAIN_SYSTEM_APPEND}

## Current Durable State

${renderStateSummary(state)}

## Current Omni Files

### .omni/PROJECT.md
${clipSection(project, 1600)}

### .omni/SPEC.md
${clipSection(spec, 1600)}

### .omni/TASKS.md
${clipSection(tasks, 1600)}

### .omni/TESTS.md
${clipSection(tests, 1200)}
`;
}
