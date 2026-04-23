import { readFile, writeFile, copyFile } from "node:fs/promises";
import { existsSync, mkdirSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { AuthStorage } from "../../node_modules/@mariozechner/pi-coding-agent/dist/core/auth-storage.js";
import { applyPreset, getActivePresetName, PRESETS, saveThemeChoice, loadSavedTheme } from "../theme.js";

import type { RepoMapSessionState } from "../repo-map-contracts.js";
import { rankRepoMapEntries, renderRepoMapBlock } from "../repo-map-rank.js";
import { readRepoMapState } from "../repo-map-store.js";
import { createStandaloneShellState } from "./app-shell.js";
import {
  findStandaloneSlashCommand,
  renderStandaloneHelp,
} from "./commands.js";
import {
  appendDurablePromptHistory,
  readDurablePromptHistory,
} from "./composer.js";
import {
  movePromptHistory,
  type PromptHistoryCursor,
} from "./opencode-adapter/prompt-behavior.js";
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

const ANY_PROVIDER_VALUE = "__any_provider__";
const MODEL_PICKER_BACK_VALUE = "__model_picker_back__";

function formatProviderDisplayName(provider: string): string {
  const known: Record<string, string> = {
    anthropic: "Anthropic",
    openai: "OpenAI",
    openrouter: "OpenRouter",
    google: "Google Gemini",
    "github-copilot": "GitHub Copilot",
    "openai-codex": "OpenAI Codex",
    xai: "xAI",
    zai: "Z.ai",
    "azure-openai-responses": "Azure OpenAI",
    nvidia: "NVIDIA NIM",
    together: "Together AI",
  };
  if (known[provider]) return known[provider];
  return provider
    .split(/[-_\s]+/u)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
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
  submitPrompt(message: string, displayMessage?: string): Promise<void>;
  abort(): Promise<void>;
  openModelPicker(): Promise<void>;
  getPreviousPromptHistory(currentDraft: string): string | undefined;
  getNextPromptHistory(currentDraft: string): string | undefined;
  resetPromptHistoryNavigation(): void;
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
  loadSavedTheme(cwd);

  let unsubscribeEvent: (() => void) | undefined;
  let unsubscribeUi: (() => void) | undefined;
  let activeAssistantId: string | undefined;
  const activeToolItemIds = new Map<string, string>();
  let itemCounter = 0;
  let pendingDialogResolve:
    | ((result: string | boolean | string[] | undefined) => void)
    | undefined;
  let promptHistory: string[] = [];
  let promptHistoryCursor: PromptHistoryCursor = { index: 0, draft: "" };
  let durablePromptHistory: string[] = [];
  const durablePromptHistoryPath = path.join(cwd, ".pi", "prompt-history.jsonl");

  const emptyRepoSession: RepoMapSessionState = {
    signals: [],
    dirtyPaths: new Set<string>(),
  };

  const setThemeState = (presetName: string) => {
    const preset = PRESETS[presetName] ?? PRESETS.lavender;
    applyPreset(presetName in PRESETS ? presetName : "lavender");
    state.theme = {
      presetName: presetName in PRESETS ? presetName : "lavender",
      brand: preset?.brand ?? PRESETS.lavender.brand,
      welcome: preset?.welcome ?? PRESETS.lavender.welcome,
    };
  };

  setThemeState(getActivePresetName() ?? "lavender");

  const emitChange = () => {
    for (const listener of listeners) {
      listener(state);
    }
  };

  const normalizePromptHistory = (items: string[]): string[] => {
    const normalized: string[] = [];
    for (const item of items) {
      const trimmed = item.trim();
      if (!trimmed) continue;
      if (normalized.at(-1) === trimmed) continue;
      normalized.push(trimmed);
    }
    return normalized;
  };

  const refreshDurablePromptHistory = async () => {
    durablePromptHistory = await readDurablePromptHistory(durablePromptHistoryPath);
  };

  const extractMessageText = (message: unknown): string | undefined => {
    if (!message || typeof message !== "object") return undefined;
    const record = message as Record<string, unknown>;
    const content = record.content;
    if (typeof content === "string") {
      const trimmed = content.trim();
      return trimmed || undefined;
    }
    if (!Array.isArray(content)) return undefined;
    const text = content
      .filter(
        (block): block is { type?: unknown; text?: unknown } =>
          !!block && typeof block === "object",
      )
      .flatMap((block) =>
        block.type === "text" && typeof block.text === "string"
          ? [block.text.trim()]
          : [],
      )
      .filter(Boolean)
      .join(" ");
    return text || undefined;
  };

  const loadPromptHistoryFromSessionFile = async (
    sessionFile: string | undefined,
  ) => {
    promptHistoryCursor = { index: 0, draft: "" };

    if (!sessionFile || !existsSync(sessionFile)) {
      promptHistory = normalizePromptHistory(durablePromptHistory);
      return;
    }

    try {
      const content = await readFile(sessionFile, "utf8");
      const lines = content.split("\n");
      const prompts: string[] = [];
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
          const entry = JSON.parse(trimmed) as Record<string, unknown>;
          if (entry.type !== "message") continue;
          const message = entry.message as Record<string, unknown> | undefined;
          if (message?.role !== "user") continue;
          const text = extractMessageText(message);
          if (text) prompts.push(text);
        } catch {
          // Ignore malformed session lines.
        }
      }
      promptHistory = normalizePromptHistory([...durablePromptHistory, ...prompts]);
    } catch {
      promptHistory = normalizePromptHistory(durablePromptHistory);
    }
  };

  const rememberPrompt = (message: string) => {
    promptHistory = normalizePromptHistory([...promptHistory, message]);
    void appendDurablePromptHistory(durablePromptHistoryPath, message)
      .then(() => refreshDurablePromptHistory())
      .catch(() => undefined);
    promptHistoryCursor = { index: 0, draft: "" };
  };

  const getPreviousPromptHistory = (currentDraft: string): string | undefined => {
    const moved = movePromptHistory(
      promptHistory,
      promptHistoryCursor,
      -1,
      currentDraft,
    );
    promptHistoryCursor = moved.cursor;
    return moved.value;
  };

  const getNextPromptHistory = (currentDraft: string): string | undefined => {
    const moved = movePromptHistory(
      promptHistory,
      promptHistoryCursor,
      1,
      currentDraft,
    );
    promptHistoryCursor = moved.cursor;
    return moved.value;
  };

  const resetPromptHistoryNavigation = () => {
    promptHistoryCursor = { index: 0, draft: "" };
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

  const buildModelPickerProviderOptions = (
    availableModels: AvailableRpcModel[],
    currentLabel: string | undefined,
  ): StandaloneDialogOption[] => {
    const activeProvider = currentLabel?.split("/")[0];
    const providerMap = new Map<string, number>();
    for (const model of availableModels) {
      if (!model.provider || !model.id) continue;
      providerMap.set(model.provider, (providerMap.get(model.provider) ?? 0) + 1);
    }
    const providerOptions = [...providerMap.entries()]
      .sort((a, b) => formatProviderDisplayName(a[0]).localeCompare(formatProviderDisplayName(b[0])))
      .map(([provider, count]) => ({
        label: formatProviderDisplayName(provider),
        value: provider,
        searchText: `${provider} ${formatProviderDisplayName(provider)}`,
        detail: `${count} model${count === 1 ? "" : "s"}${activeProvider === provider ? "  ·  active" : ""}`,
      }));

    return [
      {
        label: "Any provider",
        value: ANY_PROVIDER_VALUE,
        searchText: "any provider all models",
        detail: `${availableModels.length} total model${availableModels.length === 1 ? "" : "s"}`,
      },
      ...providerOptions,
    ];
  };

  const buildModelPickerModelOptions = (
    availableModels: AvailableRpcModel[],
    currentLabel: string | undefined,
    provider: string | undefined,
  ): StandaloneDialogOption[] => {
    const filtered = availableModels.filter((model) => {
      if (!model.provider || !model.id) return false;
      if (!provider) return true;
      return model.provider === provider;
    });

    const sorted = filtered.sort((left, right) => {
      const byProvider = formatProviderDisplayName(left.provider ?? "").localeCompare(formatProviderDisplayName(right.provider ?? ""));
      if (byProvider !== 0) return byProvider;
      return (left.name ?? left.id ?? "").localeCompare(right.name ?? right.id ?? "");
    });

    const options = sorted.map((model) => {
      const value = `${model.provider}/${model.id}`;
      const providerLabel = formatProviderDisplayName(model.provider!);
      const modelLine = model.name && model.name !== model.id
        ? `${model.name}  ·  ${model.id}`
        : (model.name ?? model.id ?? "");
      return {
        label: modelLine,
        value,
        searchText: `${providerLabel} ${model.provider} ${model.id} ${model.name ?? ""}`,
        detail: `${provider ? providerLabel : `${providerLabel}  ·  ${model.provider}`}${currentLabel === value ? "  ·  active" : ""}`,
      };
    });

    return [
      {
        label: "← Back",
        value: MODEL_PICKER_BACK_VALUE,
        searchText: "back providers",
        detail: provider ? `Return to ${formatProviderDisplayName(provider)} and other providers` : "Return to provider list",
      },
      ...options,
    ];
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
    const existing = findConversationItem(activeAssistantId);
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
    activeAssistantId = id;
    state.conversation.push(assistant);
    return assistant;
  };

  const finishAssistantItem = () => {
    const assistant = findConversationItem(activeAssistantId);
    if (assistant?.role === "assistant") {
      assistant.streaming = false;
      refreshAssistantStatus(assistant);
    }
    activeAssistantId = undefined;
  };

  const findActiveToolItem = (toolName: string) => {
    const item = findConversationItem(activeToolItemIds.get(toolName));
    return item?.role === "tool" ? item : undefined;
  };

  const ensureToolTimelineItem = (toolName: string) => {
    const existing = findActiveToolItem(toolName);
    if (existing) {
      return existing;
    }

    finishAssistantItem();
    const id = nextId("tool");
    const item: OmniStandaloneConversationItem = {
      id,
      role: "tool",
      toolName,
      text: "",
      streaming: true,
      statusText: "queued",
    };
    activeToolItemIds.set(toolName, id);
    state.conversation.push(item);
    return item;
  };

  const closeToolTimelineItem = (toolName: string) => {
    const item = findActiveToolItem(toolName);
    if (item) {
      item.streaming = false;
    }
    activeToolItemIds.delete(toolName);
    return item;
  };

  const resetTimelineState = () => {
    finishAssistantItem();
    activeToolItemIds.clear();
  };

  const stripTerminalControlSequences = (value: string): string => {
    return value
      .replace(/\u001B\][^\u0007]*(?:\u0007|\u001B\\)/gu, "")
      .replace(/\u001B\[[0-?]*[ -/]*[@-~]/gu, "")
      .replace(/[\u0000-\u0008\u000B-\u001F\u007F]/gu, "");
  };

  const sanitizeAssistantDelta = (value: string): string => {
    const cleaned = stripTerminalControlSequences(value).replace(/\r/gu, "");
    const filtered = cleaned
      .split("\n")
      .filter((line) => {
        const trimmed = line.trimStart();
        if (/^[✓✗○]\s+\S+\s+(queued|running|done|failed)$/u.test(trimmed)) {
          return false;
        }
        if (/^(input|output)\s+/u.test(trimmed)) {
          return false;
        }
        return true;
      })
      .join("\n");
    return filtered;
  };

  const truncateUiText = (value: string, max = 180): string => {
    const normalized = stripTerminalControlSequences(value)
      .replace(/\s+/gu, " ")
      .trim();
    if (normalized.length <= max) {
      return normalized;
    }
    return `${normalized.slice(0, Math.max(0, max - 1)).trimEnd()}…`;
  };

  const formatByteSize = (value: number): string => {
    if (!Number.isFinite(value) || value <= 0) {
      return "0 B";
    }
    if (value < 1024) {
      return `${value} B`;
    }
    if (value < 1024 * 1024) {
      return `${(value / 1024).toFixed(1)} KB`;
    }
    return `${(value / (1024 * 1024)).toFixed(1)} MB`;
  };

  const countTextLines = (value: string): number => {
    if (!value) {
      return 0;
    }
    return value.split(/\r?\n/gu).length;
  };

  const asRecord = (value: unknown): Record<string, unknown> | undefined => {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return undefined;
    }
    return value as Record<string, unknown>;
  };

  const maybeParseJson = (value: unknown): unknown => {
    if (typeof value !== "string") {
      return value;
    }
    const trimmed = value.trim();
    if (!trimmed) {
      return value;
    }
    if (!(trimmed.startsWith("{") || trimmed.startsWith("["))) {
      return value;
    }
    try {
      return JSON.parse(trimmed) as unknown;
    } catch {
      return value;
    }
  };

  const pickPathField = (record: Record<string, unknown>): string | undefined => {
    const fields = ["path", "filePath", "file", "target", "destination"];
    for (const field of fields) {
      const value = record[field];
      if (typeof value === "string" && value.trim()) {
        return value.trim();
      }
    }
    return undefined;
  };

  const pathHintFromInputSummary = (toolName: string, inputSummary?: string): string | undefined => {
    if (!inputSummary) return undefined;
    const prefix = `${toolName} `;
    if (!inputSummary.startsWith(prefix)) return undefined;
    const remainder = inputSummary.slice(prefix.length);
    const [pathPart] = remainder.split(" · ");
    const trimmed = pathPart?.trim();
    return trimmed ? trimmed : undefined;
  };

  const summarizeUnknown = (value: unknown): string | undefined => {
    if (typeof value === "string") {
      const trimmed = value.trim();
      return trimmed.length > 0 ? truncateUiText(trimmed) : undefined;
    }
    if (typeof value === "number" || typeof value === "boolean") {
      return String(value);
    }
    if (Array.isArray(value)) {
      const rendered = value
        .map((entry) => summarizeUnknown(entry))
        .filter((entry): entry is string => Boolean(entry))
        .join(" | ");
      return rendered.length > 0 ? truncateUiText(rendered) : undefined;
    }
    if (value && typeof value === "object") {
      const record = value as Record<string, unknown>;
      if (typeof record.command === "string") return truncateUiText(record.command);
      if (typeof record.text === "string") return truncateUiText(record.text);
      if (typeof record.stdout === "string" && record.stdout.trim()) {
        return truncateUiText(record.stdout.trim());
      }
      if (typeof record.stderr === "string" && record.stderr.trim()) {
        return truncateUiText(record.stderr.trim());
      }
      if (Array.isArray(record.content)) {
        const contentSummary = summarizeUnknown(record.content);
        if (contentSummary) return contentSummary;
      }
      try {
        const json = JSON.stringify(record);
        return json === "{}" ? undefined : truncateUiText(json);
      } catch {
        return undefined;
      }
    }
    return undefined;
  };

  const summarizeReadInput = (value: unknown): string | undefined => {
    const payload = maybeParseJson(value);
    const record = asRecord(payload);
    if (record) {
      const path = pickPathField(record) ?? "(unknown path)";
      const details: string[] = [];
      const offset = record.offset;
      const limit = record.limit;
      if (typeof offset === "number" || typeof offset === "string") {
        details.push(`offset ${String(offset).trim()}`);
      }
      if (typeof limit === "number" || typeof limit === "string") {
        details.push(`limit ${String(limit).trim()}`);
      }
      return truncateUiText(
        details.length > 0
          ? `read ${path} · ${details.join(" · ")}`
          : `read ${path}`,
      );
    }
    const fallback = summarizeUnknown(payload);
    return fallback ? `read ${fallback}` : undefined;
  };

  const summarizeWriteInput = (value: unknown): string | undefined => {
    const payload = maybeParseJson(value);
    const record = asRecord(payload);
    if (record) {
      const path = pickPathField(record) ?? "(unknown path)";
      const details: string[] = [];
      if (typeof record.content === "string") {
        details.push(formatByteSize(Buffer.byteLength(record.content, "utf8")));
        details.push(`${countTextLines(record.content)} lines`);
      }
      return truncateUiText(
        details.length > 0
          ? `write ${path} · ${details.join(" · ")}`
          : `write ${path}`,
      );
    }
    const fallback = summarizeUnknown(payload);
    return fallback ? `write ${fallback}` : undefined;
  };

  const summarizeReadOutput = (
    value: unknown,
    inputSummary?: string,
  ): string | undefined => {
    const payload = maybeParseJson(value);
    const record = asRecord(payload);
    const path = record ? pickPathField(record) : undefined;
    const hintPath = path ?? pathHintFromInputSummary("read", inputSummary);
    const content =
      record && typeof record.content === "string"
        ? record.content
        : typeof payload === "string"
          ? payload
          : undefined;

    if (content !== undefined) {
      const parts = [
        hintPath ? `read ${hintPath}` : "read file",
        `${countTextLines(content)} lines`,
        formatByteSize(Buffer.byteLength(content, "utf8")),
      ];
      if (content.length > 1200) {
        parts.push("preview hidden");
      }
      return truncateUiText(parts.join(" · "));
    }

    if (record?.ok === true) {
      return truncateUiText(hintPath ? `read ${hintPath} · done` : "read done");
    }

    return summarizeUnknown(payload);
  };

  const summarizeWriteOutput = (
    value: unknown,
    inputSummary?: string,
  ): string | undefined => {
    const payload = maybeParseJson(value);
    const record = asRecord(payload);
    const path =
      (record ? pickPathField(record) : undefined) ??
      pathHintFromInputSummary("write", inputSummary);

    if (record?.ok === true || record?.success === true) {
      return truncateUiText(path ? `write ${path} · saved` : "write saved");
    }

    if (typeof payload === "string") {
      const bytes = Buffer.byteLength(payload, "utf8");
      if (bytes > 600) {
        return truncateUiText(
          path
            ? `write ${path} · ${formatByteSize(bytes)} response · preview hidden`
            : `write response · ${formatByteSize(bytes)} · preview hidden`,
        );
      }
    }

    return summarizeUnknown(payload) ?? (path ? `write ${path} · done` : undefined);
  };

  const summarizeToolInput = (toolName: string, value: unknown): string | undefined => {
    switch (toolName) {
      case "read":
        return summarizeReadInput(value);
      case "write":
        return summarizeWriteInput(value);
      default:
        return summarizeUnknown(maybeParseJson(value));
    }
  };

  const summarizeToolOutput = (
    toolName: string,
    value: unknown,
    inputSummary?: string,
  ): string | undefined => {
    switch (toolName) {
      case "read":
        return summarizeReadOutput(value, inputSummary);
      case "write":
        return summarizeWriteOutput(value, inputSummary);
      default:
        return summarizeUnknown(maybeParseJson(value));
    }
  };

  const extractToolInputText = (
    toolName: string,
    event: OmniRpcEvent,
  ): string | undefined => {
    const record = event as Record<string, unknown>;
    const rawInput =
      record.input ??
      record.arguments ??
      record.args ??
      record.toolInput ??
      record.command;
    return summarizeToolInput(toolName, rawInput);
  };

  const extractToolOutputText = (
    toolName: string,
    event: OmniRpcEvent,
    inputSummary?: string,
  ): string | undefined => {
    const record = event as Record<string, unknown>;
    const rawOutput =
      record.output ??
      record.result ??
      record.details ??
      record.stdout ??
      record.stderr ??
      record.message;
    return summarizeToolOutput(toolName, rawOutput, inputSummary);
  };

  const refreshAssistantStatus = (item: OmniStandaloneConversationItem) => {
    if (item.role !== "assistant") {
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
    await loadPromptHistoryFromSessionFile(data?.sessionFile);
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
        emitChange();
        return;
      }
      case "agent_end": {
        state.session.isStreaming = false;
        finishAssistantItem();
        for (const [toolName] of activeToolItemIds) {
          closeToolTimelineItem(toolName);
        }
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
          | {
              type?: unknown;
              delta?: unknown;
              toolCall?: {
                name?: unknown;
                arguments?: unknown;
                input?: unknown;
                command?: unknown;
              };
            }
          | undefined;
        if (update?.type === "text_delta") {
          const assistant = ensureAssistantItem();
          const delta =
            typeof update.delta === "string"
              ? sanitizeAssistantDelta(update.delta)
              : "";
          if (delta) {
            assistant.text += delta;
          }
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
          const toolItem = ensureToolTimelineItem(toolName);
          const rawInput =
            update.toolCall?.input ??
            update.toolCall?.arguments ??
            update.toolCall?.command;
          toolItem.statusText = "queued";
          toolItem.text = summarizeToolInput(toolName, rawInput) ?? toolItem.text;
          emitChange();
          return;
        }
        return;
      }
      case "message_end": {
        finishAssistantItem();
        emitChange();
        return;
      }
      case "tool_execution_start": {
        const toolName =
          typeof event.toolName === "string" ? event.toolName : "tool";
        const toolItem = ensureToolTimelineItem(toolName);
        const inputText = extractToolInputText(toolName, event);
        toolItem.streaming = true;
        toolItem.statusText = "running";
        if (inputText) {
          toolItem.text = inputText;
        }
        emitChange();
        return;
      }
      case "tool_execution_end": {
        const toolName =
          typeof event.toolName === "string" ? event.toolName : "tool";
        const toolItem = closeToolTimelineItem(toolName) ?? ensureToolTimelineItem(toolName);
        const outputText = extractToolOutputText(toolName, event, toolItem.text);
        toolItem.streaming = false;
        toolItem.statusText = event.isError === true ? "failed" : "done";
        if (outputText) {
          toolItem.text = toolItem.text ? `${toolItem.text}\n${outputText}` : outputText;
        }
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
    await refreshDurablePromptHistory();
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
    resetTimelineState();
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

  const handleThemeCommand = async () => {
    const currentKey = state.theme.presetName || getActivePresetName() || "lavender";
    const options: StandaloneDialogOption[] = Object.entries(PRESETS).map(
      ([key, preset]) => ({
        label: `${preset.label}${key === currentKey ? "  ·  active" : ""}`,
        value: key,
        searchText: `${key} ${preset.label}`,
        detail: `${preset.brand}  ·  ${preset.welcome}`,
      }),
    );

    const result = await openDialog({
      id: nextId("dialog"),
      kind: "theme",
      title: "Theme",
      message: "Preview updates live as you move. Enter saves, Esc cancels.",
      placeholder: "Type to search themes…",
      options,
      query: "",
      selectedIndex: Math.max(0, options.findIndex((option) => option.value === currentKey)),
      value: currentKey,
    });

    if (typeof result !== "string" || !(result in PRESETS)) {
      setThemeState(currentKey);
      emitChange();
      return;
    }

    setThemeState(result);
    saveThemeChoice(cwd, result);
    emitChange();
    pushConversation({
      role: "system",
      text: `Theme set to ${PRESETS[result]?.label ?? result}.`,
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
        "• Ctrl+P — open model picker",
        "• Ctrl+K — open slash command palette",
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
      resetTimelineState();
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
    const availableModels = ((await rpcClient.getAvailableModels()) ?? []).filter(
      (model) => model.provider && model.id,
    );
    if (availableModels.length === 0) {
      pushConversation({ role: "system", text: "No available models were reported by the RPC engine. Open /providers to connect or refresh providers first." });
      return;
    }

    const currentLabel = state.session.modelLabel;
    const providerOptions = buildModelPickerProviderOptions(availableModels, currentLabel);
    const activeProvider = currentLabel?.split("/")[0];

    const result = await openDialog({
      id: nextId("dialog"),
      kind: "select",
      title: "Switch model",
      message: "Choose a provider first.",
      placeholder: "Type to filter providers…",
      options: providerOptions,
      query: "",
      selectedIndex: Math.max(
        0,
        providerOptions.findIndex((option) => option.value === activeProvider),
      ),
      pickerMode: "provider",
    });

    if (typeof result !== "string") return;

    const [provider, modelId] = result.split("/");
    if (!provider || !modelId) return;

    await rpcClient.setModel(provider, modelId);
    state.session.modelLabel = result;
    emitChange();
    pushConversation({ role: "system", text: `Model set to ${result}.` });
  };

  const submitPrompt = async (message: string, displayMessage?: string) => {
    const trimmed = message.trim();
    const visibleText = displayMessage?.trim() || trimmed;
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
          resetTimelineState();
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
          resetTimelineState();
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
          resetTimelineState();
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
        case "theme":
          await handleThemeCommand();
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

    pushConversation({ role: "user", text: visibleText });
    rememberPrompt(visibleText);
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
    if (state.dialog.kind === "select" || state.dialog.kind === "scoped-models" || state.dialog.kind === "theme") {
      state.dialog.query = value;
      state.dialog.selectedIndex = 0;
      if (state.dialog.kind === "theme") {
        const filtered = getFilteredDialogOptions(state.dialog);
        const selected = filtered[0]?.value;
        if (selected && selected in PRESETS) {
          setThemeState(selected);
        }
      }
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
    if (state.dialog.kind === "theme") {
      const selected = options[state.dialog.selectedIndex]?.value;
      if (selected && selected in PRESETS) {
        setThemeState(selected);
      }
    }
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
      if (dialog.title === "Switch model" && dialog.pickerMode === "provider") {
        const provider = selected?.value;
        if (!provider) {
          closeDialog(undefined);
          return;
        }
        const availableModels = ((await rpcClient.getAvailableModels()) ?? []).filter(
          (model) => model.provider && model.id,
        );
        const nextProvider = provider === ANY_PROVIDER_VALUE ? undefined : provider;
        const options = buildModelPickerModelOptions(
          availableModels,
          state.session.modelLabel,
          nextProvider,
        );
        const activeModel = state.session.modelLabel;
        state.dialog = {
          ...dialog,
          message: nextProvider
            ? `Models from ${formatProviderDisplayName(nextProvider)}.`
            : "All available models.",
          placeholder: "Type to filter models…",
          options,
          query: "",
          selectedIndex: Math.max(0, options.findIndex((option) => option.value === activeModel)),
          pickerMode: "model",
          pickerProvider: nextProvider,
        };
        emitChange();
        return;
      }
      if (dialog.title === "Switch model" && dialog.pickerMode === "model") {
        if (selected?.value === MODEL_PICKER_BACK_VALUE) {
          const availableModels = ((await rpcClient.getAvailableModels()) ?? []).filter(
            (model) => model.provider && model.id,
          );
          const options = buildModelPickerProviderOptions(availableModels, state.session.modelLabel);
          const activeProvider = state.session.modelLabel?.split("/")[0];
          state.dialog = {
            ...dialog,
            message: "Choose a provider first.",
            placeholder: "Type to filter providers…",
            options,
            query: "",
            selectedIndex: Math.max(0, options.findIndex((option) => option.value === activeProvider)),
            pickerMode: "provider",
            pickerProvider: undefined,
          };
          emitChange();
          return;
        }
        closeDialog(selected?.value);
        return;
      }
      closeDialog(selected?.value);
      return;
    }
    if (dialog.kind === "theme") {
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
    if (state.dialog.kind === "theme") {
      const original = state.dialog.value;
      if (typeof original === "string" && original in PRESETS) {
        setThemeState(original);
      }
    }
    closeDialog(undefined);
  };

  return {
    state,
    start,
    stop,
    submitPrompt,
    abort,
    openModelPicker,
    getPreviousPromptHistory,
    getNextPromptHistory,
    resetPromptHistoryNavigation,
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
