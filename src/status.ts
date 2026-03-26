import type { OmniPhase, OmniState } from "./contracts.js";
import type { HealthLevel } from "./doctor.js";
import type { RunHistoryEntry } from "./subagents.js";

const HEALTH_TAGS: Record<HealthLevel, string> = {
  green: "OK",
  yellow: "WARN",
  red: "FAIL",
};

const phaseLabels: Record<OmniPhase, string> = {
  understand: "Understand",
  plan: "Plan",
  build: "Build",
  check: "Check",
  escalate: "Escalate",
};

export function formatPhase(phase: OmniPhase): string {
  return phaseLabels[phase];
}

export function renderCompactStatus(
  state: OmniState,
  health?: HealthLevel,
): string[] {
  const phaseBar = Object.keys(phaseLabels)
    .map((key) =>
      key === state.currentPhase
        ? `[${phaseLabels[key as OmniPhase]}]`
        : ` ${phaseLabels[key as OmniPhase]} `,
    )
    .join(" > ");
  const healthTag = health ? `  [${HEALTH_TAGS[health]}]` : "";
  const lines = [`Omni-Pi  ${phaseBar}${healthTag}`];
  if (state.activeTask && state.activeTask !== "None") {
    lines.push(`  Task: ${state.activeTask}`);
  }
  if (state.blockers.length > 0) {
    lines.push(`  Blocked: ${state.blockers.join("; ")}`);
  }
  lines.push(`  Next: ${state.nextStep}`);
  return lines;
}

export function renderPlainStatus(state: OmniState): string {
  const blockers =
    state.blockers.length > 0 ? state.blockers.join("; ") : "None";
  const lines = [
    `Phase: ${formatPhase(state.currentPhase)}`,
    `Active task: ${state.activeTask}`,
    `What is happening: ${state.statusSummary}`,
    `Blockers: ${blockers}`,
    `Next step: ${state.nextStep}`,
  ];
  if (state.recoveryOptions && state.recoveryOptions.length > 0) {
    lines.push(
      `Recovery options:\n${state.recoveryOptions.map((option) => `  - ${option}`).join("\n")}`,
    );
  }
  return lines.join("\n");
}

export function renderMetrics(
  workerRuns: RunHistoryEntry[],
  expertRuns: RunHistoryEntry[],
): string {
  const allRuns = [...workerRuns, ...expertRuns];
  if (allRuns.length === 0) {
    return "No agent run history available yet.";
  }

  function stats(runs: RunHistoryEntry[]): {
    total: number;
    successRate: string;
    avgDuration: string;
  } {
    if (runs.length === 0)
      return { total: 0, successRate: "n/a", avgDuration: "n/a" };
    const successes = runs.filter((r) => r.status === "ok").length;
    const avgMs = runs.reduce((sum, r) => sum + r.duration, 0) / runs.length;
    return {
      total: runs.length,
      successRate: `${Math.round((successes / runs.length) * 100)}%`,
      avgDuration: `${(avgMs / 1000).toFixed(1)}s`,
    };
  }

  const workerStats = stats(workerRuns);
  const expertStats = stats(expertRuns);

  const lines = ["Agent Metrics:"];
  if (workerStats.total > 0) {
    lines.push(
      `  Worker: ${workerStats.total} runs, ${workerStats.successRate} success, avg ${workerStats.avgDuration}`,
    );
  }
  if (expertStats.total > 0) {
    lines.push(
      `  Expert: ${expertStats.total} runs, ${expertStats.successRate} success, avg ${expertStats.avgDuration}`,
    );
  }
  lines.push(`  Total: ${allRuns.length} runs`);
  return lines.join("\n");
}
