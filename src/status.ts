import type { OmniPhase, OmniState } from "./contracts.js";

const phaseLabels: Record<OmniPhase, string> = {
  understand: "Understand",
  plan: "Plan",
  build: "Build",
  check: "Check",
  escalate: "Escalate"
};

export function formatPhase(phase: OmniPhase): string {
  return phaseLabels[phase];
}

export function renderPlainStatus(state: OmniState): string {
  const blockers = state.blockers.length > 0 ? state.blockers.join("; ") : "None";
  return [
    `Phase: ${formatPhase(state.currentPhase)}`,
    `Active task: ${state.activeTask}`,
    `What is happening: ${state.statusSummary}`,
    `Blockers: ${blockers}`,
    `Next step: ${state.nextStep}`
  ].join("\n");
}
