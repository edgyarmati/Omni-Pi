import type {
  OmniStandaloneDialogState,
  OmniStandaloneProviderOverview,
  OmniStandaloneSessionSnapshot,
  OmniStandaloneStatusItem,
  OmniStandaloneTodoItem,
  OmniStandaloneWorkflowSnapshot,
} from "../contracts.js";

export type OmniUiRole = "user" | "assistant" | "system";

export interface OmniUiToolCall {
  id: string;
  name: string;
  status: "pending" | "running" | "done" | "failed";
  input?: string;
  output?: string;
}

export interface OmniUiMessage {
  id: string;
  role: OmniUiRole;
  text: string;
  streaming: boolean;
  statusText?: string;
  toolCalls: OmniUiToolCall[];
}

export interface OmniUiSessionMeta {
  id?: string;
  file?: string;
  name?: string;
  model?: string;
  thinking?: string;
  streaming: boolean;
}

export interface OmniUiWorkflowMeta {
  phase?: string;
  activeTask?: string;
  statusSummary?: string;
  blockers?: string;
  nextStep?: string;
  todos: OmniStandaloneTodoItem[];
}

export interface OmniUiSnapshot {
  statuses: OmniStandaloneStatusItem[];
  session: OmniUiSessionMeta;
  workflow: OmniUiWorkflowMeta;
  providers: OmniStandaloneProviderOverview;
  dialog?: OmniStandaloneDialogState;
  repoMapPreview: string;
  conversation: OmniUiMessage[];
}

export interface OmniUiAdapterInput {
  statuses: OmniStandaloneStatusItem[];
  session: OmniStandaloneSessionSnapshot;
  workflow: OmniStandaloneWorkflowSnapshot;
  providers: OmniStandaloneProviderOverview;
  todos: OmniStandaloneTodoItem[];
  dialog?: OmniStandaloneDialogState;
  repoMapPreview: string;
  conversation: Array<{
    id: string;
    role: OmniUiRole;
    text: string;
    streaming?: boolean;
    statusText?: string;
    toolCalls?: OmniUiToolCall[];
  }>;
}
