export type OmniStandalonePanelId =
  | "conversation"
  | "workflow"
  | "repoMap"
  | "session"
  | "notifications";

export type OmniStandaloneViewMode = "conversation-first" | "split";

export interface OmniStandalonePanelLayout {
  id: OmniStandalonePanelId;
  title: string;
  visible: boolean;
  width?: number;
}

export interface OmniStandaloneLayoutSpec {
  mode: OmniStandaloneViewMode;
  panels: OmniStandalonePanelLayout[];
}

export interface OmniStandaloneStatusItem {
  key: string;
  text: string;
}

export interface OmniStandaloneWorkflowSnapshot {
  phase?: string;
  activeTask?: string;
  statusSummary?: string;
  blockers?: string;
  nextStep?: string;
  tasksPreview?: string;
}

export interface OmniStandaloneTodoItem {
  id: string;
  title: string;
  status: "todo" | "in_progress" | "blocked" | "done";
}

export interface OmniStandaloneSessionSnapshot {
  sessionId?: string;
  sessionFile?: string;
  sessionName?: string;
  modelLabel?: string;
  thinkingLevel?: string;
  isStreaming: boolean;
  steeringQueue: string[];
  followUpQueue: string[];
}

export interface OmniStandaloneToolCall {
  id: string;
  name: string;
  status: "pending" | "running" | "done" | "failed";
}

export interface OmniStandaloneConversationItem {
  id: string;
  role: "user" | "assistant" | "system";
  text: string;
  streaming?: boolean;
  statusText?: string;
  toolCalls?: OmniStandaloneToolCall[];
}

export interface OmniStandaloneDialogOption {
  label: string;
  value: string;
  searchText?: string;
  detail?: string;
}

export interface OmniStandaloneDialogState {
  id: string;
  kind: "select" | "confirm" | "input" | "editor";
  title: string;
  message?: string;
  placeholder?: string;
  options?: OmniStandaloneDialogOption[];
  query?: string;
  value?: string;
  selectedIndex?: number;
}

export interface OmniStandaloneAppState {
  layout: OmniStandaloneLayoutSpec;
  statuses: OmniStandaloneStatusItem[];
  workflow: OmniStandaloneWorkflowSnapshot;
  repoMapPreview: string;
  session: OmniStandaloneSessionSnapshot;
  todos: OmniStandaloneTodoItem[];
  conversation: OmniStandaloneConversationItem[];
  dialog?: OmniStandaloneDialogState;
}

export const DEFAULT_STANDALONE_LAYOUT: OmniStandaloneLayoutSpec = {
  mode: "conversation-first",
  panels: [
    { id: "conversation", title: "Conversation", visible: true },
    { id: "workflow", title: "Workflow", visible: true, width: 30 },
    { id: "repoMap", title: "Repo Map", visible: false, width: 34 },
    { id: "session", title: "Session", visible: false, width: 30 },
    { id: "notifications", title: "Notifications", visible: false },
  ],
};
