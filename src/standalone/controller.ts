import { readFile, writeFile, copyFile } from "node:fs/promises";
import { existsSync, mkdirSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { AuthStorage } from "../../node_modules/@mariozechner/pi-coding-agent/dist/core/auth-storage.js";

import type { RepoMapSessionState } from "../repo-map-contracts.js";
import { rankRepoMapEntries, renderRepoMapBlock } from "../repo-map-rank.js";
import { readRepoMapState } from "../repo-map-store.js";
import { createStandaloneShellState } from "./app-shell.js";
import {
  findStandaloneSlashCommand,
  renderStandaloneHelp,
} from "./commands.js";
import { readTasks } from "../tasks.js";
import {
  copyTextToClipboard,
  createSecretGist,
  getGhAuthStatus,
  getProviderOverview,
  getShareViewerUrl,
  listSessionOptions,
  openExternalUrl,
  readEnabledModels,
  readOmniChangelog,
  writeEnabledModels,
  type StandaloneDialogOption,
  type StandaloneScopedModelOption,
} from "./bridges.js";
import type {
  OmniStandaloneAppState,
  OmniStandaloneConversationItem,
  OmniStandaloneDialogState,
  OmniStandaloneToolCall,
} from "./contracts.js";

interface OAuthProviderLike {
  id: string;
  name: string;
}

interface OAuthAuthPrompt {
  message: string;
  placeholder?: string;
}

interface OAuthAuthInfo {
  url: string;
  instructions?: string;
}

interface AvailableRpcModel {
  provider?: string;
  id?: string;
  name?: string;
}

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
  openModelPicker(): Promise<void>;
  updateDialogInput(value: string): void;
  moveDialogSelection(delta: number): void;
  toggleDialogSelection(): void;
  submitDialog(): Promise<void>;
  cancelDialog(): Promise<void>;
  onChange(listener: (state: OmniStandaloneAppState) => void): () => void;
  onQuit(listener: () => void): () => void;
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
  const quitListeners = new Set<() => void>();
  const rpcClient = options.rpcClient;
  const cwd = options.cwd ?? process.cwd();

  let unsubscribeEvent: (() => void) | undefined;
  let unsubscribeUi: (() => void) | undefined;
  let streamingAssistantId: string | undefined;
  let itemCounter = 0;
  let pendingDialogResolve:
    | ((result: string | boolean | string[] | undefined) => void)
    | undefined;

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

  const getFilteredDialogOptions = (
    dialog: OmniStandaloneDialogState,
  ): StandaloneDialogOption[] => {
    const options = dialog.options ?? [];
    const query = (dialog.query ?? "").trim().toLowerCase();
    if (!query) return options;
    return options.filter((option) => {
      const haystack = `${option.label} ${option.searchText ?? ""} ${option.detail ?? ""}`.toLowerCase();
      return haystack.includes(query);
    });
  };

  const toScopedModelOption = (
    model: AvailableRpcModel,
    isSelected: boolean,
  ): StandaloneScopedModelOption | undefined => {
    if (!model.provider || !model.id) return undefined;
    const label = `${isSelected ? "☑" : "☐"} ${model.provider}/${model.id}`;
    return {
      provider: model.provider,
      modelId: model.id,
      label,
      value: `${model.provider}/${model.id}`,
      searchText: `${model.provider} ${model.id} ${model.name ?? ""}`,
      detail: model.name ? `${model.name}${isSelected ? "  ·  selected" : ""}` : isSelected ? "selected" : undefined,
    };
  };

  const openDialog = async (
    dialog: OmniStandaloneDialogState,
  ): Promise<string | boolean | string[] | undefined> => {
    state.dialog = dialog;
    emitChange();
    return await new Promise<string | boolean | string[] | undefined>((resolve) => {
      pendingDialogResolve = resolve as (
        result: string | boolean | string[] | undefined,
      ) => void;
    });
  };

  const closeDialog = (result: string | boolean | string[] | undefined) => {
    state.dialog = undefined;
    const resolve = pendingDialogResolve;
    pendingDialogResolve = undefined;
    resolve?.(result);
    emitChange();
  };

  const requestSelect = async (
    title: string,
    options: StandaloneDialogOption[],
    message?: string,
  ): Promise<string | undefined> => {
    const result = await openDialog({
      id: nextId("dialog"),
      kind: "select",
      title,
      message,
      placeholder: "Type to search…",
      options,
      query: "",
      selectedIndex: 0,
    });
    return typeof result === "string" ? result : undefined;
  };

  const requestConfirm = async (
    title: string,
    message?: string,
  ): Promise<boolean> => {
    const result = await openDialog({
      id: nextId("dialog"),
      kind: "confirm",
      title,
      message,
      options: [
        { label: "Yes", value: "yes" },
        { label: "No", value: "no" },
      ],
      selectedIndex: 0,
    });
    return result === true;
  };

  const requestInput = async (
    title: string,
    placeholder?: string,
    value = "",
    multiline = false,
  ): Promise<string | undefined> => {
    const result = await openDialog({
      id: nextId("dialog"),
      kind: multiline ? "editor" : "input",
      title,
      placeholder,
      value,
    });
    return typeof result === "string" ? result : undefined;
  };

  const emitQuit = () => {
    for (const listener of quitListeners) {
      listener();
    }
  };

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

  const refreshSessionState = async () => {
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

    if (!stateResponse.success) {
      return;
    }

    const data = stateResponse.data;
    state.session.sessionId = data?.sessionId;
    state.session.sessionFile = data?.sessionFile;
    state.session.sessionName = data?.sessionName;
    state.session.thinkingLevel = data?.thinkingLevel;
    state.session.isStreaming = data?.isStreaming ?? false;
    state.session.modelLabel =
      data?.model?.provider && data.model.id
        ? `${data.model.provider}/${data.model.id}`
        : undefined;
    emitChange();
  };

  const refreshProviderOverview = async () => {
    try {
      const [availableModels, enabledModels] = await Promise.all([
        rpcClient.getAvailableModels().catch(() => []),
        readEnabledModels(cwd).catch(() => []),
      ]);
      state.providers = await getProviderOverview({
        availableModels,
        enabledModels,
      });
      emitChange();
    } catch {
      // Ignore provider refresh failures for now.
    }
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

      const tasks = tasksContent ? await readTasks(tasksPath).catch(() => []) : [];
      state.todos = tasks
        .filter((task) => task.status !== "done")
        .map((task) => ({
          id: task.id,
          title: task.title,
          status: task.status,
        }));

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
      case "select": {
        const title =
          typeof request.title === "string" ? request.title : "Select an option";
        const options = Array.isArray(request.options)
          ? request.options
              .filter((value): value is string => typeof value === "string")
              .map((value) => ({ label: value, value, searchText: value }))
          : [];
        void requestSelect(title, options).then((value) =>
          rpcClient.sendExtensionUiResponse({
            type: "extension_ui_response",
            id: request.id,
            ...(value !== undefined ? { value } : { cancelled: true }),
          }),
        );
        break;
      }
      case "confirm": {
        const title =
          typeof request.title === "string" ? request.title : "Confirm";
        const message =
          typeof request.message === "string" ? request.message : undefined;
        void requestConfirm(title, message).then((confirmed) =>
          rpcClient.sendExtensionUiResponse({
            type: "extension_ui_response",
            id: request.id,
            confirmed,
          }),
        );
        break;
      }
      case "input": {
        const title =
          typeof request.title === "string" ? request.title : "Enter a value";
        const placeholder =
          typeof request.placeholder === "string"
            ? request.placeholder
            : undefined;
        void requestInput(title, placeholder).then((value) =>
          rpcClient.sendExtensionUiResponse({
            type: "extension_ui_response",
            id: request.id,
            ...(value !== undefined ? { value } : { cancelled: true }),
          }),
        );
        break;
      }
      case "editor": {
        const title =
          typeof request.title === "string" ? request.title : "Edit text";
        const prefill =
          typeof request.prefill === "string" ? request.prefill : "";
        void requestInput(title, undefined, prefill, true).then((value) =>
          rpcClient.sendExtensionUiResponse({
            type: "extension_ui_response",
            id: request.id,
            ...(value !== undefined ? { value } : { cancelled: true }),
          }),
        );
        break;
      }
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
    await refreshSessionState();
    await refreshProviderOverview();
    await refreshWorkflowContext();
  };

  const stop = async () => {
    unsubscribeEvent?.();
    unsubscribeUi?.();
    unsubscribeEvent = undefined;
    unsubscribeUi = undefined;
    await rpcClient.stop();
  };

  const restartRuntime = async () => {
    const previousSession = state.session.sessionFile;
    await rpcClient.restart();
    unsubscribeEvent?.();
    unsubscribeUi?.();
    unsubscribeEvent = rpcClient.onEvent(handleEvent);
    unsubscribeUi = rpcClient.onExtensionUiRequest(handleUiRequest);
    if (previousSession) {
      await rpcClient.switchSession(previousSession);
    }
    await refreshSessionState();
    await refreshProviderOverview();
    await refreshWorkflowContext();
  };

  const handleSessionsCommand = async () => {
    const options = await listSessionOptions(cwd);
    if (options.length === 0) {
      pushConversation({ role: "system", text: "No saved sessions found." });
      return;
    }

    const selected = await requestSelect("Sessions", options, "Search and switch to another session.");
    if (!selected) {
      return;
    }

    await rpcClient.switchSession(selected);
    streamingAssistantId = undefined;
    state.conversation = [];
    await refreshSessionState();
    await refreshProviderOverview();
    await refreshWorkflowContext();
    pushConversation({ role: "system", text: `Switched session to ${selected}.` });
  };

  const handleLoginCommand = async (providerOverride?: string) => {
    const authStorage = AuthStorage.create();
    const providers = authStorage.getOAuthProviders() as OAuthProviderLike[];
    if (providers.length === 0) {
      pushConversation({ role: "system", text: "No OAuth providers are available." });
      return;
    }

    const selectedProvider = providerOverride?.trim()
      ? providerOverride.trim()
      : await requestSelect(
          "Login",
          providers.map((provider: OAuthProviderLike) => ({
            label: provider.name,
            value: provider.id,
            searchText: `${provider.id} ${provider.name}`,
          })),
          "Choose a provider to authenticate.",
        );
    if (!selectedProvider) {
      return;
    }

    const providerInfo = providers.find(
      (provider: OAuthProviderLike) => provider.id === selectedProvider,
    );
    pushConversation({
      role: "system",
      text: `Starting login for ${providerInfo?.name ?? selectedProvider}…`,
    });

    try {
      try {
        await authStorage.login(selectedProvider as never, {
          onAuth: async (info: OAuthAuthInfo) => {
            pushConversation({
              role: "system",
              text: `${providerInfo?.name ?? selectedProvider}: ${info.instructions ?? "Open the browser to continue."}\n${info.url}`,
            });
            await openExternalUrl(info.url).catch(() => undefined);
          },
          onPrompt: async (prompt: OAuthAuthPrompt) => {
            const value = await requestInput(
              prompt.message,
              prompt.placeholder,
            );
            if (value === undefined) {
              throw new Error("Login cancelled");
            }
            return value;
          },
          onProgress: (progress: string) => {
            state.statuses = state.statuses.filter((item) => item.key !== "login");
            state.statuses.push({ key: "login", text: progress });
            emitChange();
          },
          onManualCodeInput: async () => {
            const value = await requestInput(
              `Complete ${providerInfo?.name ?? selectedProvider} login`,
              "Paste the redirect URL or code here",
            );
            if (value === undefined) {
              throw new Error("Login cancelled");
            }
            return value;
          },
          signal: new AbortController().signal,
        });
      } finally {
        state.statuses = state.statuses.filter((item) => item.key !== "login");
        emitChange();
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      if (errorMessage === "Login cancelled") {
        pushConversation({ role: "system", text: "Login cancelled." });
        return;
      }
      throw error;
    }

    await restartRuntime();
    pushConversation({
      role: "system",
      text: `Logged in to ${providerInfo?.name ?? selectedProvider}.`,
    });
  };

  const handleLogoutCommand = async (providerOverride?: string) => {
    const authStorage = AuthStorage.create();
    const providers = (authStorage.getOAuthProviders() as OAuthProviderLike[])
      .filter(
        (provider: OAuthProviderLike) =>
          authStorage.get(provider.id)?.type === "oauth",
      );
    if (providers.length === 0) {
      pushConversation({ role: "system", text: "No OAuth providers are currently logged in." });
      return;
    }

    const selectedProvider = providerOverride?.trim()
      ? providerOverride.trim()
      : await requestSelect(
          "Logout",
          providers.map((provider: OAuthProviderLike) => ({
            label: provider.name,
            value: provider.id,
            searchText: `${provider.id} ${provider.name}`,
          })),
          "Choose a provider to log out from.",
        );
    if (!selectedProvider) {
      return;
    }

    const providerInfo = providers.find(
      (provider: OAuthProviderLike) => provider.id === selectedProvider,
    );
    const confirmed = await requestConfirm(
      "Log out?",
      `Remove stored OAuth credentials for ${providerInfo?.name ?? selectedProvider}?`,
    );
    if (!confirmed) {
      return;
    }

    authStorage.logout(selectedProvider);
    await restartRuntime();
    pushConversation({
      role: "system",
      text: `Logged out of ${providerInfo?.name ?? selectedProvider}.`,
    });
  };

  const handleHotkeysCommand = () => {
    pushConversation({
      role: "system",
      text: [
        "Standalone hotkeys",
        "",
        "• Enter — send message / confirm dialog",
        "• Esc — abort streaming or cancel active dialog",
        "• Ctrl+P / Ctrl+K — open model picker",
        "• /providers — open provider setup and recovery hub",
        "• / — open slash command autocomplete",
        "• ↑ / ↓ — move through slash suggestions or dialog selections",
        "• Tab — complete the highlighted slash command",
      ].join("\n"),
    });
  };

  const handleProvidersCommand = async () => {
    await refreshProviderOverview();
    const overview = state.providers;
    const message = [
      overview.summary ?? "Provider setup status",
      overview.recommendedAction
        ? `Recommended next step: ${overview.recommendedAction}`
        : "You already have usable models. Open the model picker or tune scoped models.",
    ].join("\n\n");

    const choice = await requestSelect(
      "Providers",
      [
        {
          label: "Connect provider",
          value: "/login",
          searchText: "providers connect login oauth auth",
          detail: overview.hasAnyOAuthProvider
            ? "Sign in to an OAuth-backed provider."
            : "No bundled OAuth providers detected; use custom provider setup instead.",
        },
        {
          label: "Add custom/API-key provider",
          value: "/model-setup add",
          searchText: "providers add custom api key model setup",
          detail: "Configure a provider or model in models.json.",
        },
        {
          label: "Refresh configured provider models",
          value: "/model-setup refresh",
          searchText: "providers refresh rediscover models",
          detail: "Re-discover models for already configured providers.",
        },
        {
          label: "Manage stored provider auth",
          value: "/manage-providers",
          searchText: "providers manage remove auth",
          detail: "Remove stored API-key or OAuth credentials.",
        },
        {
          label: "Log out OAuth provider",
          value: "/logout",
          searchText: "providers logout oauth",
          detail: "Disconnect an OAuth-backed provider.",
        },
        {
          label: "Open model picker",
          value: "/model",
          searchText: "providers model picker switch model",
          detail: "Choose the active model for this session.",
        },
        {
          label: "Scoped models",
          value: "/scoped-models",
          searchText: "providers scoped models cycling ctrl+p",
          detail: "Control which models appear in cycling shortcuts.",
        },
      ],
      message,
    );

    if (!choice) return;
    await submitPrompt(choice);
  };

  const handleSettingsCommand = async () => {
    const choice = await requestSelect("Settings", [
      {
        label: "Providers & models",
        value: "/providers",
        searchText: "providers models connect onboarding",
        detail: state.providers.summary ?? "Connect providers, refresh models, or manage auth.",
      },
      {
        label: "Model picker",
        value: "/model",
        searchText: "model picker switch active model",
        detail: "Search and switch the active model.",
      },
      {
        label: "Scoped models",
        value: "/scoped-models",
        searchText: "scoped models model scope ctrl+p",
        detail: "Choose which models are available for cycling.",
      },
      {
        label: "Theme",
        value: "/theme",
        searchText: "theme colors preset",
        detail: "Open the Omni theme picker.",
      },
      {
        label: "Update",
        value: "/update",
        searchText: "update omni-pi version",
        detail: "Check for a newer Omni-Pi release.",
      },
      {
        label: "Omni mode",
        value: "/omni-mode",
        searchText: "omni mode toggle workflow",
        detail: "Toggle Omni mode for this project.",
      },
    ], "Choose a settings action.");

    if (!choice) return;
    await submitPrompt(choice);
  };

  const handleScopedModelsCommand = async () => {
    const availableModels = (await rpcClient.getAvailableModels()) ?? [];
    if (availableModels.length === 0) {
      pushConversation({ role: "system", text: "No available models were reported by the RPC engine. Open /providers to connect or refresh providers first." });
      return;
    }

    const currentEnabled = new Set(await readEnabledModels(cwd));
    const options = availableModels
      .map((model) =>
        toScopedModelOption(model, currentEnabled.has(`${model.provider}/${model.id}`)),
      )
      .filter((option): option is StandaloneScopedModelOption => option !== undefined);

    const result = await openDialog({
      id: nextId("dialog"),
      kind: "scoped-models",
      title: "Scoped models",
      message: "Space toggles a model, Enter saves, Esc cancels.",
      placeholder: "Type to filter models…",
      options,
      query: "",
      selectedIndex: 0,
      selectedValues: [...currentEnabled],
    });

    if (!Array.isArray(result)) {
      return;
    }

    const nextEnabled = result.filter((value): value is string => typeof value === "string");
    await writeEnabledModels(cwd, nextEnabled.length > 0 ? nextEnabled : undefined);
    await restartRuntime();
    pushConversation({
      role: "system",
      text: nextEnabled.length > 0
        ? `Scoped models updated (${nextEnabled.length} selected).`
        : "Scoped models cleared.",
    });
  };

  const handleExportCommand = async (args: string) => {
    const outputPath = args.trim() || undefined;

    try {
      if (outputPath?.endsWith(".jsonl")) {
        // JSONL export: read the session data through RPC messages and write locally
        const sessionFile = state.session.sessionFile;
        if (!sessionFile) {
          pushConversation({ role: "system", text: "No active session to export." });
          return;
        }
        const resolved = path.resolve(outputPath);
        const dir = path.dirname(resolved);
        if (!existsSync(dir)) {
          mkdirSync(dir, { recursive: true });
        }
        await copyFile(sessionFile, resolved);
        pushConversation({ role: "system", text: `Session exported to: ${resolved}` });
        return;
      }

      const filePath = await rpcClient.exportHtml(outputPath);
      pushConversation({ role: "system", text: `Session exported to: ${filePath ?? "(unknown path)"}` });
    } catch (error) {
      pushConversation({
        role: "system",
        text: `Failed to export session: ${error instanceof Error ? error.message : "Unknown error"}`,
      });
    }
  };

  const handleImportCommand = async (args: string) => {
    const inputPath = args.trim();
    if (!inputPath) {
      pushConversation({ role: "system", text: "Usage: /import <path.jsonl>" });
      return;
    }

    const resolvedPath = path.resolve(inputPath);
    if (!existsSync(resolvedPath)) {
      pushConversation({ role: "system", text: `File not found: ${resolvedPath}` });
      return;
    }

    const confirmed = await requestConfirm(
      "Import session",
      `Replace current session with ${resolvedPath}?`,
    );
    if (!confirmed) {
      pushConversation({ role: "system", text: "Import cancelled." });
      return;
    }

    try {
      // Copy the JSONL file into the sessions directory and switch to it
      const sessionDir = path.join(cwd, ".pi", "sessions");
      if (!existsSync(sessionDir)) {
        mkdirSync(sessionDir, { recursive: true });
      }
      const destinationPath = path.join(sessionDir, path.basename(resolvedPath));
      if (path.resolve(destinationPath) !== resolvedPath) {
        await copyFile(resolvedPath, destinationPath);
      }

      await rpcClient.switchSession(destinationPath);
      streamingAssistantId = undefined;
      state.conversation = [];
      await refreshSessionState();
      await refreshProviderOverview();
      await refreshWorkflowContext();
      pushConversation({ role: "system", text: `Session imported from: ${resolvedPath}` });
    } catch (error) {
      pushConversation({
        role: "system",
        text: `Failed to import session: ${error instanceof Error ? error.message : "Unknown error"}`,
      });
    }
  };

  const handleShareCommand = async () => {
    // Check if gh is available
    const hasGh = await getGhAuthStatus();
    if (!hasGh) {
      pushConversation({
        role: "system",
        text: "GitHub CLI is not installed or not logged in. Install from https://cli.github.com/ and run 'gh auth login'.",
      });
      return;
    }

    // Export to a temp HTML file
    const tmpFile = path.join(os.tmpdir(), `omni-share-${Date.now()}.html`);
    try {
      state.statuses = state.statuses.filter((item) => item.key !== "share");
      state.statuses.push({ key: "share", text: "Creating gist…" });
      emitChange();

      await rpcClient.exportHtml(tmpFile);

      const { gistUrl, gistId } = await createSecretGist(tmpFile);
      const viewerUrl = getShareViewerUrl(gistId);

      state.statuses = state.statuses.filter((item) => item.key !== "share");
      emitChange();

      pushConversation({
        role: "system",
        text: `Shared session:\n\n  Viewer: ${viewerUrl}\n  Gist: ${gistUrl}`,
      });
    } catch (error) {
      state.statuses = state.statuses.filter((item) => item.key !== "share");
      emitChange();
      pushConversation({
        role: "system",
        text: `Failed to share session: ${error instanceof Error ? error.message : "Unknown error"}`,
      });
    } finally {
      try {
        const { unlink } = await import("node:fs/promises");
        await unlink(tmpFile);
      } catch {
        // Ignore cleanup errors
      }
    }
  };

  const openModelPicker = async () => {
    const availableModels = (await rpcClient.getAvailableModels()) ?? [];
    if (availableModels.length === 0) {
      pushConversation({ role: "system", text: "No available models were reported by the RPC engine. Open /providers to connect or refresh providers first." });
      return;
    }

    const currentLabel = state.session.modelLabel;
    const options: StandaloneDialogOption[] = availableModels
      .filter((model) => model.provider && model.id)
      .map((model) => {
        const value = `${model.provider}/${model.id}`;
        return {
          label: `${value}${currentLabel === value ? "  ·  active" : ""}`,
          value,
          searchText: `${model.provider} ${model.id} ${model.name ?? ""}`,
          detail: model.name ?? undefined,
        };
      });

    if (options.length === 0) {
      pushConversation({ role: "system", text: "No models available." });
      return;
    }

    const selected = await requestSelect("Switch model", options, "Search models. Enter to switch.");
    if (!selected) return;

    const [provider, modelId] = selected.split("/");
    if (!provider || !modelId) return;

    await rpcClient.setModel(provider, modelId);
    state.session.modelLabel = selected;
    emitChange();
    pushConversation({ role: "system", text: `Model set to ${selected}.` });
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
            text: renderStandaloneHelp(),
          });
          return;
        case "new":
          await rpcClient.newSession();
          streamingAssistantId = undefined;
          state.conversation = [];
          await refreshSessionState();
          await refreshProviderOverview();
          await refreshWorkflowContext();
          pushConversation({ role: "system", text: "Started a new session." });
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
            await openModelPicker();
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
        case "compact": {
          const result = await rpcClient.compact(rest || undefined);
          pushConversation({
            role: "system",
            text: result?.summary
              ? `Compacted context (${result.tokensBefore ?? "?"} tokens before).\n\n${result.summary}`
              : "Compacted context.",
          });
          return;
        }
        case "session": {
          const stats = await rpcClient.getSessionStats();
          const lines = Object.entries(stats ?? {}).map(([key, value]) => {
            const rendered =
              typeof value === "string"
                ? value
                : typeof value === "number" || typeof value === "boolean"
                  ? String(value)
                  : JSON.stringify(value);
            return `${key}: ${rendered}`;
          });
          pushConversation({
            role: "system",
            text: lines.length > 0 ? lines.join("\n") : "No session stats available.",
          });
          return;
        }
        case "name":
          if (!rest.trim()) {
            pushConversation({
              role: "system",
              text: "Usage: /name <display-name>",
            });
            return;
          }
          await rpcClient.setSessionName(rest.trim());
          state.session.sessionName = rest.trim();
          pushConversation({
            role: "system",
            text: `Session name set to ${rest.trim()}.`,
          });
          emitChange();
          return;
        case "switch":
          await rpcClient.switchSession(rest);
          streamingAssistantId = undefined;
          state.conversation = [];
          await refreshSessionState();
          await refreshProviderOverview();
          await refreshWorkflowContext();
          pushConversation({
            role: "system",
            text: `Switched session to ${rest}.`,
          });
          return;
        case "resume":
          if (!rest.trim()) {
            await handleSessionsCommand();
            return;
          }
          await rpcClient.switchSession(rest);
          streamingAssistantId = undefined;
          state.conversation = [];
          await refreshSessionState();
          await refreshProviderOverview();
          await refreshWorkflowContext();
          pushConversation({
            role: "system",
            text: `Switched session to ${rest}.`,
          });
          return;
        case "fork":
          await rpcClient.fork(rest);
          await refreshSessionState();
          await refreshProviderOverview();
          pushConversation({
            role: "system",
            text: `Forked from entry ${rest}.`,
          });
          return;
        case "sessions":
          await handleSessionsCommand();
          return;
        case "providers":
          await handleProvidersCommand();
          return;
        case "changelog": {
          const changelog = await readOmniChangelog();
          pushConversation({ role: "system", text: changelog });
          return;
        }
        case "login":
          await handleLoginCommand(rest);
          return;
        case "logout":
          await handleLogoutCommand(rest);
          return;
        case "hotkeys":
          handleHotkeysCommand();
          return;
        case "settings":
          await handleSettingsCommand();
          return;
        case "scoped-models":
          await handleScopedModelsCommand();
          return;
        case "export":
          await handleExportCommand(rest);
          return;
        case "import":
          await handleImportCommand(rest);
          return;
        case "share":
          await handleShareCommand();
          return;
        case "reload":
          await restartRuntime();
          pushConversation({ role: "system", text: "Reloaded keybindings, extensions, skills, prompts, and themes." });
          return;
        case "copy": {
          const lastAssistant = [...state.conversation]
            .reverse()
            .find((item) => item.role === "assistant" && item.text.trim());
          if (!lastAssistant) {
            pushConversation({ role: "system", text: "No assistant message is available to copy." });
            return;
          }
          await copyTextToClipboard(lastAssistant.text);
          pushConversation({ role: "system", text: "Copied the last assistant message to the clipboard." });
          return;
        }
        case "quit":
          emitQuit();
          return;
        default: {
          const knownCommand = findStandaloneSlashCommand(commandName);
          if (knownCommand?.kind === "omni-extension") {
            await rpcClient.prompt(trimmed);
            await refreshSessionState();
            await refreshProviderOverview();
            return;
          }
          if (knownCommand && !knownCommand.supported) {
            pushConversation({
              role: "system",
              text: `/${commandName} is a known ${knownCommand.kind === "pi-builtin" ? "Pi" : "Omni"} user command, but its standalone UI bridge is not wired yet.`,
            });
            return;
          }
          pushConversation({
            role: "system",
            text: `Unknown command: /${commandName}`,
          });
          return;
        }
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

  const updateDialogInput = (value: string) => {
    if (!state.dialog) return;
    if (state.dialog.kind === "select" || state.dialog.kind === "scoped-models") {
      state.dialog.query = value;
      state.dialog.selectedIndex = 0;
    } else {
      state.dialog.value = value;
    }
    emitChange();
  };

  const moveDialogSelection = (delta: number) => {
    if (!state.dialog) return;
    const options =
      state.dialog.kind === "confirm"
        ? state.dialog.options ?? []
        : getFilteredDialogOptions(state.dialog);
    if (options.length === 0) return;
    const current = state.dialog.selectedIndex ?? 0;
    state.dialog.selectedIndex = (current + delta + options.length) % options.length;
    emitChange();
  };

  const toggleDialogSelection = () => {
    if (!state.dialog || state.dialog.kind !== "scoped-models") return;
    const options = getFilteredDialogOptions(state.dialog);
    const current = options[state.dialog.selectedIndex ?? 0];
    if (!current) return;
    const selected = new Set(state.dialog.selectedValues ?? []);
    if (selected.has(current.value)) {
      selected.delete(current.value);
    } else {
      selected.add(current.value);
    }
    state.dialog.selectedValues = [...selected];
    emitChange();
  };

  const submitDialog = async () => {
    if (!state.dialog) return;
    const dialog = state.dialog;
    if (dialog.kind === "select") {
      const selected = getFilteredDialogOptions(dialog)[dialog.selectedIndex ?? 0];
      closeDialog(selected?.value);
      return;
    }
    if (dialog.kind === "scoped-models") {
      closeDialog(dialog.selectedValues ?? []);
      return;
    }
    if (dialog.kind === "confirm") {
      closeDialog((dialog.selectedIndex ?? 0) === 0);
      return;
    }
    closeDialog(dialog.value ?? "");
  };

  const cancelDialog = async () => {
    if (!state.dialog) return;
    closeDialog(undefined);
  };

  return {
    state,
    start,
    stop,
    submitPrompt,
    abort,
    openModelPicker,
    updateDialogInput,
    moveDialogSelection,
    toggleDialogSelection,
    submitDialog,
    cancelDialog,
    onChange(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    onQuit(listener) {
      quitListeners.add(listener);
      return () => {
        quitListeners.delete(listener);
      };
    },
  };
}
