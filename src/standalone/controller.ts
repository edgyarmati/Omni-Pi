import { readFile } from "node:fs/promises";
import path from "node:path";

import type { RepoMapSessionState } from "../repo-map-contracts.js";
import { rankRepoMapEntries, renderRepoMapBlock } from "../repo-map-rank.js";
import { readRepoMapState } from "../repo-map-store.js";
import { createStandaloneShellState } from "./app-shell.js";
import type {
  OmniStandaloneAppState,
  OmniStandaloneConversationItem,
  OmniStandaloneToolCall,
} from "./contracts.js";
import type { OmniRpcClient } from "./rpc/client.js";
import type {
  OmniRpcEvent,
  OmniRpcExtensionUiRequest,
} from "./rpc/contracts.js";

export interface OmniStandaloneController {
  readonly state: OmniStandaloneAppState;
  start(): Promise<void>;
  stop(): Promise<void>;
  submitPrompt(message: string): Promise<void>;
  abort(): Promise<void>;
  onChange(listener: (state: OmniStandaloneAppState) => void): () => void;
}

export interface OmniStandaloneControllerOptions {
  rpcClient: OmniRpcClient;
  cwd?: string;
}

export function createStandaloneController(
  options: OmniStandaloneControllerOptions,
): OmniStandaloneController {
  const state = createStandaloneShellState();
  const listeners = new Set<(state: OmniStandaloneAppState) => void>();
  const rpcClient = options.rpcClient;
  const cwd = options.cwd ?? process.cwd();

  let unsubscribeEvent: (() => void) | undefined;
  let unsubscribeUi: (() => void) | undefined;
  let streamingAssistantId: string | undefined;
  let itemCounter = 0;

  const emptyRepoSession: RepoMapSessionState = {
    signals: [],
    dirtyPaths: new Set<string>(),
  };

  const emitChange = () => {
    for (const listener of listeners) {
      listener(state);
    }
  };

  const nextId = (prefix: string) => `${prefix}-${++itemCounter}`;

  const pushConversation = (
    item: Omit<OmniStandaloneConversationItem, "id">,
  ) => {
    state.conversation.push({ ...item, id: nextId(item.role) });
    emitChange();
  };

  const findConversationItem = (id: string | undefined) =>
    id ? state.conversation.find((item) => item.id === id) : undefined;

  const ensureAssistantItem = () => {
    const existing = findConversationItem(streamingAssistantId);
    if (existing?.role === "assistant") {
      return existing;
    }

    const id = nextId("assistant");
    const assistant: OmniStandaloneConversationItem = {
      id,
      role: "assistant",
      text: "",
      streaming: true,
      statusText: "thinking…",
      toolCalls: [],
    };
    streamingAssistantId = id;
    state.conversation.push(assistant);
    return assistant;
  };

  const findToolCall = (
    item: OmniStandaloneConversationItem,
    toolName: string,
  ): OmniStandaloneToolCall | undefined =>
    item.toolCalls
      ?.slice()
      .reverse()
      .find(
        (toolCall) =>
          toolCall.name === toolName &&
          (toolCall.status === "pending" || toolCall.status === "running"),
      );

  const ensureToolCall = (
    item: OmniStandaloneConversationItem,
    toolName: string,
  ): OmniStandaloneToolCall => {
    const existing = findToolCall(item, toolName);
    if (existing) {
      return existing;
    }

    const toolCall: OmniStandaloneToolCall = {
      id: nextId("tool"),
      name: toolName,
      status: "pending",
    };
    item.toolCalls = [...(item.toolCalls ?? []), toolCall];
    return toolCall;
  };

  const refreshAssistantStatus = (item: OmniStandaloneConversationItem) => {
    if (item.role !== "assistant") {
      return;
    }

    const runningTool = item.toolCalls?.find(
      (toolCall) => toolCall.status === "running",
    );
    if (runningTool) {
      item.statusText = `using ${runningTool.name}`;
      return;
    }

    if (item.streaming && !item.text.trim()) {
      item.statusText = "thinking…";
      return;
    }

    item.statusText = undefined;
  };

  const parseStateFields = (raw: string) => {
    const fields = new Map<string, string>();
    for (const line of raw.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const colonIndex = trimmed.indexOf(":");
      if (colonIndex <= 0) continue;
      fields.set(
        trimmed.slice(0, colonIndex).trim().toLowerCase(),
        trimmed.slice(colonIndex + 1).trim(),
      );
    }
    return fields;
  };

  const refreshWorkflowContext = async () => {
    const statePath = path.join(cwd, ".omni", "STATE.md");
    const tasksPath = path.join(cwd, ".omni", "TASKS.md");

    try {
      const [stateContent, tasksContent, repoState] = await Promise.all([
        readFile(statePath, "utf8").catch(() => ""),
        readFile(tasksPath, "utf8").catch(() => ""),
        readRepoMapState(cwd),
      ]);

      const fields = parseStateFields(stateContent);
      state.workflow.phase = fields.get("current phase");
      state.workflow.activeTask = fields.get("active task");
      state.workflow.statusSummary = fields.get("status summary");
      state.workflow.blockers = fields.get("blockers");
      state.workflow.nextStep = fields.get("next step");
      state.workflow.tasksPreview = tasksContent
        .split("\n")
        .filter((line) => line.trim().length > 0)
        .slice(0, 10)
        .join("\n");

      state.repoMapPreview = renderRepoMapBlock(
        rankRepoMapEntries(repoState, emptyRepoSession, ""),
        120,
      );
      emitChange();
    } catch {
      // Ignore workflow/sidebar refresh failures for now.
    }
  };

  const handleUiRequest = (request: OmniRpcExtensionUiRequest) => {
    switch (request.method) {
      case "notify": {
        const message =
          typeof request.message === "string" ? request.message : "";
        if (message) {
          pushConversation({ role: "system", text: message });
        }
        break;
      }
      case "setStatus": {
        const key =
          typeof request.statusKey === "string" ? request.statusKey : "rpc";
        const text =
          typeof request.statusText === "string" ? request.statusText : "";
        state.statuses = state.statuses.filter((item) => item.key !== key);
        if (text) {
          state.statuses.push({ key, text });
        }
        emitChange();
        break;
      }
      case "setTitle":
      case "setWidget":
      case "set_editor_text":
        break;
      default:
        break;
    }
  };

  const handleEvent = (event: OmniRpcEvent) => {
    switch (event.type) {
      case "agent_start": {
        state.session.isStreaming = true;
        const assistant = ensureAssistantItem();
        assistant.streaming = true;
        refreshAssistantStatus(assistant);
        emitChange();
        return;
      }
      case "agent_end": {
        state.session.isStreaming = false;
        const assistant = findConversationItem(streamingAssistantId);
        if (assistant?.role === "assistant") {
          assistant.streaming = false;
          refreshAssistantStatus(assistant);
        }
        streamingAssistantId = undefined;
        void refreshWorkflowContext();
        emitChange();
        return;
      }
      case "queue_update": {
        const steering = Array.isArray(event.steering)
          ? event.steering.filter(
              (value): value is string => typeof value === "string",
            )
          : [];
        const followUp = Array.isArray(event.followUp)
          ? event.followUp.filter(
              (value): value is string => typeof value === "string",
            )
          : [];
        state.session.steeringQueue = steering;
        state.session.followUpQueue = followUp;
        emitChange();
        return;
      }
      case "message_update": {
        const update = event.assistantMessageEvent as
          | { type?: unknown; delta?: unknown; toolCall?: { name?: unknown } }
          | undefined;
        if (update?.type === "text_delta") {
          const assistant = ensureAssistantItem();
          assistant.text +=
            typeof update.delta === "string" ? update.delta : "";
          assistant.streaming = true;
          refreshAssistantStatus(assistant);
          emitChange();
          return;
        }
        if (update?.type === "toolcall_end") {
          const toolName =
            typeof update.toolCall?.name === "string"
              ? update.toolCall.name
              : "tool";
          const assistant = ensureAssistantItem();
          ensureToolCall(assistant, toolName);
          refreshAssistantStatus(assistant);
          emitChange();
          return;
        }
        return;
      }
      case "message_end": {
        const assistant = findConversationItem(streamingAssistantId);
        if (assistant?.role === "assistant") {
          assistant.streaming = false;
          refreshAssistantStatus(assistant);
          emitChange();
        }
        return;
      }
      case "tool_execution_start": {
        const toolName =
          typeof event.toolName === "string" ? event.toolName : "tool";
        const assistant = ensureAssistantItem();
        const toolCall = ensureToolCall(assistant, toolName);
        toolCall.status = "running";
        assistant.streaming = true;
        refreshAssistantStatus(assistant);
        emitChange();
        return;
      }
      case "tool_execution_end": {
        const toolName =
          typeof event.toolName === "string" ? event.toolName : "tool";
        const assistant = ensureAssistantItem();
        const toolCall = ensureToolCall(assistant, toolName);
        toolCall.status = event.isError === true ? "failed" : "done";
        refreshAssistantStatus(assistant);
        emitChange();
        return;
      }
      case "turn_end":
        void refreshWorkflowContext();
        return;
      default:
        return;
    }
  };

  const start = async () => {
    await rpcClient.start();
    unsubscribeEvent = rpcClient.onEvent(handleEvent);
    unsubscribeUi = rpcClient.onExtensionUiRequest(handleUiRequest);

    const stateResponse = await rpcClient.send<{
      type: "response";
      success: true;
      command: "get_state";
      data?: {
        sessionId?: string;
        sessionFile?: string;
        sessionName?: string;
        thinkingLevel?: string;
        isStreaming?: boolean;
        model?: { provider?: string; id?: string } | null;
      };
    }>({ type: "get_state" });

    if (stateResponse.success) {
      const data = stateResponse.data;
      state.session.sessionId = data?.sessionId;
      state.session.sessionFile = data?.sessionFile;
      state.session.sessionName = data?.sessionName;
      state.session.thinkingLevel = data?.thinkingLevel;
      state.session.isStreaming = data?.isStreaming ?? false;
      if (data?.model?.provider && data.model.id) {
        state.session.modelLabel = `${data.model.provider}/${data.model.id}`;
      }
      emitChange();
    }

    await refreshWorkflowContext();
  };

  const stop = async () => {
    unsubscribeEvent?.();
    unsubscribeUi?.();
    unsubscribeEvent = undefined;
    unsubscribeUi = undefined;
    await rpcClient.stop();
  };

  const submitPrompt = async (message: string) => {
    const trimmed = message.trim();
    if (!trimmed) {
      return;
    }

    const commandMatch = trimmed.match(/^\/(\S+)(?:\s+([\s\S]+))?$/);
    if (commandMatch) {
      const [, commandName, rest = ""] = commandMatch;
      switch (commandName) {
        case "help":
          pushConversation({
            role: "system",
            text: "Commands: /help, /new, /steer <msg>, /followup <msg>, /model <provider>/<id>, /thinking <level>, /switch <session-path>, /fork <entry-id>",
          });
          return;
        case "new":
          await rpcClient.newSession();
          streamingAssistantId = undefined;
          state.conversation = [];
          pushConversation({ role: "system", text: "Started a new session." });
          await refreshWorkflowContext();
          return;
        case "steer":
          await rpcClient.steer(rest);
          pushConversation({
            role: "system",
            text: `Queued steering message: ${rest}`,
          });
          return;
        case "followup":
          await rpcClient.followUp(rest);
          pushConversation({
            role: "system",
            text: `Queued follow-up message: ${rest}`,
          });
          return;
        case "model": {
          const [provider, modelId] = rest.split("/");
          if (!provider || !modelId) {
            pushConversation({
              role: "system",
              text: "Usage: /model <provider>/<model-id>",
            });
            return;
          }
          await rpcClient.setModel(provider, modelId);
          state.session.modelLabel = `${provider}/${modelId}`;
          pushConversation({
            role: "system",
            text: `Model set to ${provider}/${modelId}.`,
          });
          emitChange();
          return;
        }
        case "thinking":
          await rpcClient.setThinkingLevel(rest);
          state.session.thinkingLevel = rest;
          pushConversation({
            role: "system",
            text: `Thinking level set to ${rest}.`,
          });
          emitChange();
          return;
        case "switch":
          await rpcClient.switchSession(rest);
          streamingAssistantId = undefined;
          state.conversation = [];
          pushConversation({
            role: "system",
            text: `Switched session to ${rest}.`,
          });
          await refreshWorkflowContext();
          return;
        case "fork":
          await rpcClient.fork(rest);
          pushConversation({
            role: "system",
            text: `Forked from entry ${rest}.`,
          });
          return;
        default:
          pushConversation({
            role: "system",
            text: `Unknown command: /${commandName}`,
          });
          return;
      }
    }

    pushConversation({ role: "user", text: trimmed });
    await rpcClient.prompt(
      trimmed,
      state.session.isStreaming ? { streamingBehavior: "steer" } : undefined,
    );
  };

  const abort = async () => {
    await rpcClient.abort();
  };

  return {
    state,
    start,
    stop,
    submitPrompt,
    abort,
    onChange(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
