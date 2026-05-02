import type { Theme } from "@mariozechner/pi-coding-agent";
import { Text } from "@mariozechner/pi-tui";
import type { OmniPhase, OmniState } from "./contracts.js";
import type { HealthLevel } from "./doctor.js";

const phaseLabels: Record<OmniPhase, string> = {
  understand: "Understanding",
  plan: "Planning",
  build: "Implementing",
  check: "Verifying",
  escalate: "Recovering",
};

function normalizePhase(phase: string): OmniPhase | null {
  return phase in phaseLabels ? (phase as OmniPhase) : null;
}

function healthColor(health?: HealthLevel): "success" | "warning" | "error" {
  if (health === "red") return "error";
  if (health === "yellow") return "warning";
  return "success";
}

function isAwaitingUserInput(state: OmniState): boolean {
  const combined =
    `${state.statusSummary} ${state.nextStep} ${state.activeTask}`.toLowerCase();
  return (
    /await user feedback/u.test(combined) ||
    /describe the requested behavior/u.test(combined) ||
    /answer the open questions/u.test(combined) ||
    /waiting for clarification/u.test(combined) ||
    /capture exact requirements/u.test(combined)
  );
}

function compactBadge(
  state: OmniState,
  health?: HealthLevel,
): { label: string; color: "success" | "warning" | "error" } | null {
  if (state.blockers.length > 0 || health === "red") {
    return { label: "Blocked", color: "error" };
  }
  if (isAwaitingUserInput(state)) {
    return null;
  }
  return { label: "Working", color: healthColor(health) };
}

export function formatPhase(phase: string): string {
  const normalized = normalizePhase(phase);
  return normalized ? phaseLabels[normalized] : "Working";
}

export function renderCompactStatus(
  state: OmniState,
  health?: HealthLevel,
): string[] {
  const badge = compactBadge(state, health);
  const header = badge ? `Omni-Pi Brain [${badge.label}]` : "Omni-Pi Brain";
  const lines = [header];
  if (state.activeTask && state.activeTask !== "None") {
    lines.push(`  Focus: ${state.activeTask}`);
  }
  if (state.blockers.length > 0) {
    lines.push(`  Blocked: ${state.blockers.join("; ")}`);
  }
  lines.push(`  Next: ${state.nextStep.replace(/[.]+$/u, "")}`);
  return lines;
}

export function renderCompactStatusWidget(
  state: OmniState,
  theme: Theme,
  health?: HealthLevel,
): Text {
  const badge = compactBadge(state, health);
  const nextStep = state.nextStep.replace(/[.]+$/u, "");
  const blockers =
    state.blockers.length > 0 ? state.blockers.join("; ") : undefined;
  const focus =
    state.activeTask && state.activeTask !== "None"
      ? state.activeTask
      : undefined;

  const header = badge
    ? `${theme.fg("accent", theme.bold("Omni-Pi Brain"))} ${theme.fg(badge.color, `[${badge.label}]`)}`
    : theme.fg("accent", theme.bold("Omni-Pi Brain"));
  const lines = [header];
  if (focus) {
    lines.push(`${theme.fg("muted", "Focus")} ${focus}`);
  }
  if (blockers) {
    lines.push(
      `${theme.fg("muted", "Blocked")} ${theme.fg("warning", blockers)}`,
    );
    lines.push(`${theme.fg("muted", "Next")}  ${nextStep}`);
  } else {
    lines.push(`${theme.fg("muted", "Next")}  ${theme.fg("accent", nextStep)}`);
  }
  return new Text(lines.join("\n"), 0, 0);
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
