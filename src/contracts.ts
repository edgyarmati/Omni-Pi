export const OMNI_DIR = ".omni";

export type OmniPhase = "understand" | "plan" | "build" | "check" | "escalate";

export type TaskStatus = "todo" | "in_progress" | "blocked" | "done";

export type SkillPolicy = "auto-install" | "recommend-only" | "never-auto-install";

export interface ConversationBrief {
  summary: string;
  desiredOutcome: string;
  constraints: string[];
  userSignals: string[];
}

export interface ImplementationSpec {
  title: string;
  scope: string[];
  architecture: string[];
  taskSlices: TaskBrief[];
  acceptanceCriteria: string[];
}

export interface TaskBrief {
  id: string;
  title: string;
  objective: string;
  contextFiles: string[];
  skills: string[];
  doneCriteria: string[];
  role: "worker" | "expert";
  status: TaskStatus;
  dependsOn: string[];
}

export interface VerificationResult {
  taskId: string;
  passed: boolean;
  checksRun: string[];
  failureSummary: string[];
  retryRecommended: boolean;
}

export interface TaskAttemptResult {
  summary: string;
  verification: VerificationResult;
  modifiedFiles?: string[];
}

export interface EscalationBrief {
  taskId: string;
  priorAttempts: number;
  failureLogs: string[];
  expertObjective: string;
  verificationResults?: Array<{
    command: string;
    passed: boolean;
    stdout: string;
    stderr: string;
  }>;
  modifiedFiles?: string[];
}

export interface SkillCandidate {
  name: string;
  reason: string;
  confidence: "high" | "medium" | "low";
  policy: SkillPolicy;
}

export interface OmniState {
  currentPhase: OmniPhase;
  activeTask: string;
  statusSummary: string;
  blockers: string[];
  nextStep: string;
  recoveryOptions?: string[];
}

export interface OmniConfig {
  models: {
    worker: string;
    expert: string;
    planner: string;
    brain: string;
  };
  retryLimit: number;
  chainEnabled: boolean;
}

export const DEFAULT_CONFIG: OmniConfig = {
  models: {
    worker: "anthropic/claude-sonnet-4-6",
    expert: "openai/gpt-5.4",
    planner: "openai/gpt-5.4",
    brain: "anthropic/claude-opus-4-6"
  },
  retryLimit: 2,
  chainEnabled: false
};
