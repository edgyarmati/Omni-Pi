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

export interface OmniStandaloneProviderStatus {
  id: string;
  label: string;
  auth: "api-key" | "oauth";
  connected: boolean;
  configured: boolean;
  availableModelCount: number;
}

export interface OmniStandaloneProviderOverview {
  items: OmniStandaloneProviderStatus[];
  connectedProviderCount: number;
  configuredProviderCount: number;
  availableModelCount: number;
  enabledModelCount: number;
  hasAnyOAuthProvider: boolean;
  recommendedAction?: string;
  summary?: string;
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
  inputText?: string;
  outputText?: string;
}

export interface OmniStandaloneConversationItem {
  id: string;
  role: "user" | "assistant" | "system" | "tool";
  text: string;
  streaming?: boolean;
  statusText?: string;
  thinkingSinceMs?: number;
  toolName?: string;
  toolCalls?: OmniStandaloneToolCall[];
}

export interface OmniStandaloneDialogOption {
  label: string;
  value: string;
  searchText?: string;
  detail?: string;
}

export interface OmniStandaloneThemeSnapshot {
  presetName: string;
  brand: string;
  welcome: string;
}

export interface OmniStandaloneDialogState {
  id: string;
  kind: "select" | "confirm" | "input" | "editor" | "scoped-models" | "theme";
  title: string;
  message?: string;
  placeholder?: string;
  options?: OmniStandaloneDialogOption[];
  query?: string;
  value?: string;
  selectedIndex?: number;
  selectedValues?: string[];
  pickerMode?: "provider" | "model";
  pickerProvider?: string;
}

export interface OmniStandaloneAppState {
  layout: OmniStandaloneLayoutSpec;
  statuses: OmniStandaloneStatusItem[];
  workflow: OmniStandaloneWorkflowSnapshot;
  repoMapPreview: string;
  session: OmniStandaloneSessionSnapshot;
  theme: OmniStandaloneThemeSnapshot;
  providers: OmniStandaloneProviderOverview;
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
