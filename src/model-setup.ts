import { spawn } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import os from "node:os";
import path from "node:path";

import type { ExtensionCommandContext } from "@mariozechner/pi-coding-agent";
import { getAgentDir } from "@mariozechner/pi-coding-agent";

import {
  getLocalDateStamp,
  readModelRefreshState,
  writeModelRefreshState,
} from "./model-refresh-state.js";
export {
  getLocalDateStamp,
  readModelRefreshState,
  writeModelRefreshState,
} from "./model-refresh-state.js";

import type { OmniConfig } from "./contracts.js";
import { discoverProviderModels, type OmniProviderModel } from "./providers.js";
import { searchableSelect } from "./searchable-select.js";

type SupportedApi =
  | "openai-completions"
  | "openai-responses"
  | "anthropic-messages"
  | "google-generative-ai";

interface AuthStorageLike {
  get?(
    provider: string,
  ): { type: "api_key"; key: string } | { type: "oauth" } | undefined;
  getApiKey?(
    provider: string,
    options?: { includeFallback?: boolean },
  ): Promise<string | undefined>;
  hasAuth?(provider: string): boolean;
  set(
    provider: string,
    credential: {
      type: "api_key";
      key: string;
    },
  ): void;
  getOAuthProviders?(): Array<{ id: string }>;
}

interface ModelRegistryLike {
  refresh(): void;
  authStorage: AuthStorageLike;
}

interface RuntimeLike {
  ctx: ExtensionCommandContext;
}

export interface BrowserModelSelectionResult {
  selectedModels?: OmniConfig["models"];
  summary: string;
}

export interface BrowserCustomModelSubmission {
  providerId: string;
  modelId: string;
  api: SupportedApi;
  baseUrl: string;
  apiKey?: string;
  reasoning: boolean;
  imageInput: boolean;
}

interface ProviderConnectionSubmission {
  providerId: string;
  api: SupportedApi;
  baseUrl: string;
  apiKey?: string;
}

export interface KnownProviderSetup {
  id: string;
  label: string;
  auth: "api-key" | "oauth";
  baseUrlRequired?: boolean;
  baseUrlPlaceholder?: string;
  apiKeyPlaceholder?: string;
}

interface ModelsJsonConfig {
  providers?: Record<string, ModelsJsonProviderConfig>;
}

export interface ModelsJsonProviderConfig {
  baseUrl?: string;
  api?: SupportedApi;
  apiKey?: string;
  headers?: Record<string, string>;
  authHeader?: boolean;
  models?: ModelsJsonModelConfig[];
}

interface ModelsJsonModelConfig {
  id: string;
  name?: string;
  reasoning?: boolean;
  input?: Array<"text" | "image">;
  contextWindow?: number;
  maxTokens?: number;
  cost?: {
    input: number;
    output: number;
    cacheRead: number;
    cacheWrite: number;
  };
  headers?: Record<string, string>;
  compat?: unknown;
}

const KNOWN_PROVIDER_SETUPS: KnownProviderSetup[] = [
  {
    id: "anthropic",
    label: "Anthropic",
    auth: "api-key",
    apiKeyPlaceholder: "sk-ant-...",
  },
  {
    id: "openai",
    label: "OpenAI",
    auth: "api-key",
    apiKeyPlaceholder: "sk-...",
  },
  {
    id: "openrouter",
    label: "OpenRouter",
    auth: "api-key",
    apiKeyPlaceholder: "sk-or-...",
  },
  {
    id: "google",
    label: "Google Gemini",
    auth: "api-key",
  },
  {
    id: "github-copilot",
    label: "GitHub Copilot",
    auth: "oauth",
  },
  {
    id: "openai-codex",
    label: "OpenAI Codex",
    auth: "oauth",
  },
  {
    id: "xai",
    label: "xAI",
    auth: "api-key",
  },
  {
    id: "zai",
    label: "Z.ai",
    auth: "api-key",
    apiKeyPlaceholder: "API key from z.ai/manage-apikey/apikey-list",
  },
  {
    id: "azure-openai-responses",
    label: "Azure OpenAI Responses",
    auth: "api-key",
  },
  {
    id: "nvidia",
    label: "NVIDIA NIM",
    auth: "api-key",
  },
  {
    id: "together",
    label: "Together AI",
    auth: "api-key",
  },
  {
    id: "synthetic",
    label: "Synthetic",
    auth: "api-key",
  },
  {
    id: "nanogpt",
    label: "NanoGPT",
    auth: "api-key",
  },
  {
    id: "xiaomi",
    label: "Xiaomi",
    auth: "api-key",
    baseUrlRequired: true,
    baseUrlPlaceholder: "https://api.xiaomi.example/anthropic",
  },
  {
    id: "moonshot",
    label: "Moonshot",
    auth: "api-key",
  },
  {
    id: "venice",
    label: "Venice",
    auth: "api-key",
  },
  {
    id: "kilo",
    label: "Kilo Code",
    auth: "api-key",
  },
  {
    id: "gitlab-duo",
    label: "GitLab Duo",
    auth: "api-key",
    baseUrlRequired: true,
    baseUrlPlaceholder: "https://gitlab.example/api/v4/chat",
  },
  {
    id: "qwen-portal",
    label: "Qwen Portal",
    auth: "api-key",
  },
  {
    id: "qianfan",
    label: "Qianfan",
    auth: "api-key",
  },
  {
    id: "cloudflare-ai-gateway",
    label: "Cloudflare AI Gateway",
    auth: "api-key",
    baseUrlRequired: true,
    baseUrlPlaceholder:
      "https://gateway.ai.cloudflare.com/v1/<account>/<gateway>",
  },
];

export function getKnownProviderSetups(): KnownProviderSetup[] {
  return [...KNOWN_PROVIDER_SETUPS];
}

function getModelsPath(): string {
  return path.join(getAgentDir(), "models.json");
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function openExternalUrl(url: string): void {
  const platform = process.platform;
  const command =
    platform === "darwin"
      ? { cmd: "open", args: [url] }
      : platform === "win32"
        ? { cmd: "cmd", args: ["/c", "start", "", url] }
        : { cmd: "xdg-open", args: [url] };

  const child = spawn(command.cmd, command.args, {
    detached: true,
    stdio: "ignore",
  });
  child.unref();
}

async function readModelsJson(): Promise<ModelsJsonConfig> {
  const modelsPath = getModelsPath();

  try {
    const content = await readFile(modelsPath, "utf8");
    const parsed = JSON.parse(content) as ModelsJsonConfig;
    return typeof parsed === "object" && parsed !== null ? parsed : {};
  } catch {
    return {};
  }
}

async function writeModelsJson(config: ModelsJsonConfig): Promise<void> {
  const modelsPath = getModelsPath();
  await mkdir(path.dirname(modelsPath), { recursive: true });
  await writeFile(modelsPath, `${JSON.stringify(config, null, 2)}\n`, "utf8");
}

async function upsertProviderConfig(
  provider: string,
  update: (current: ModelsJsonProviderConfig) => ModelsJsonProviderConfig,
): Promise<void> {
  const config = await readModelsJson();
  const providers = config.providers ?? {};
  providers[provider] = update(providers[provider] ?? {});
  config.providers = providers;
  await writeModelsJson(config);
}

async function resolveProviderApiKey(
  provider: string,
  current: ModelsJsonProviderConfig,
  authStorage: AuthStorageLike,
): Promise<string | undefined> {
  const resolvedFromStorage = await authStorage.getApiKey?.(provider);
  if (resolvedFromStorage?.trim()) {
    return resolvedFromStorage.trim();
  }

  const storedCredential = authStorage.get?.(provider);
  if (storedCredential?.type === "api_key" && storedCredential.key.trim()) {
    return storedCredential.key.trim();
  }

  return current.apiKey?.trim() || undefined;
}

export async function refreshConfiguredProviderModels(
  config: ModelsJsonConfig,
  authStorage: AuthStorageLike,
  discover: typeof discoverProviderModels = discoverProviderModels,
): Promise<{
  config: ModelsJsonConfig;
  refreshedProviders: string[];
}> {
  const providers = config.providers ?? {};
  const refreshableProviders = Object.entries(providers).filter(
    ([provider, current]) =>
      Boolean(current.api && current.baseUrl) &&
      (authStorage.hasAuth?.(provider) ||
        Boolean(current.apiKey?.trim()) ||
        Boolean(authStorage.get?.(provider))),
  );

  const refreshed = await Promise.all(
    refreshableProviders.map(async ([provider, current]) => {
      try {
        if (!current.api || !current.baseUrl) {
          return null;
        }

        const apiKey = await resolveProviderApiKey(
          provider,
          current,
          authStorage,
        );
        if (!apiKey) {
          return null;
        }

        const discovered = await discover(current.api, current.baseUrl, apiKey);
        if (discovered.length === 0) {
          return null;
        }

        return {
          provider,
          updated: (() => {
            const updated = buildDiscoveredProviderConfigUpdate(
              current,
              provider,
              {
                providerId: provider,
                api: current.api,
                baseUrl: current.baseUrl,
                apiKey: current.apiKey,
              },
              discovered,
            );

            if (!current.apiKey?.trim()) {
              delete updated.apiKey;
            }
            if (current.authHeader === undefined) {
              delete updated.authHeader;
            }

            return updated;
          })(),
        };
      } catch {
        return null;
      }
    }),
  );

  const refreshedProviders: string[] = [];
  for (const result of refreshed) {
    if (!result) {
      continue;
    }

    providers[result.provider] = result.updated;
    refreshedProviders.push(result.provider);
  }

  return {
    config: {
      ...config,
      providers,
    },
    refreshedProviders,
  };
}

export async function refreshAuthenticatedProviderModels(
  modelRegistry: ModelRegistryLike,
): Promise<string[]> {
  const config = await readModelsJson();
  const refreshed = await refreshConfiguredProviderModels(
    config,
    modelRegistry.authStorage,
  );

  if (refreshed.refreshedProviders.length === 0) {
    return [];
  }

  await writeModelsJson(refreshed.config);
  modelRegistry.refresh();
  return refreshed.refreshedProviders;
}

export async function refreshAuthenticatedProviderModelsWithDailyGuard(
  modelRegistry: ModelRegistryLike,
  options?: {
    force?: boolean;
    now?: Date;
    statePath?: string;
  },
): Promise<{ refreshedProviders: string[]; skipped: boolean }> {
  const today = getLocalDateStamp(options?.now);
  if (!options?.force) {
    const state = await readModelRefreshState(options?.statePath);
    if (state.lastSuccessfulRefreshDate === today) {
      return { refreshedProviders: [], skipped: true };
    }
  }

  const refreshedProviders = await refreshAuthenticatedProviderModels(
    modelRegistry,
  );

  if (refreshedProviders.length > 0) {
    try {
      await writeModelRefreshState(
        { lastSuccessfulRefreshDate: today },
        options?.statePath,
      );
    } catch {
      // Keep the refreshed models even if the durable refresh stamp cannot be written.
    }
  }

  return { refreshedProviders, skipped: false };
}

function sanitizeProviderId(input: string): string {
  return input.trim().toLowerCase().replace(/\s+/gu, "-");
}

function normalizeBaseUrl(input: string): string {
  const trimmed = input.trim();
  return trimmed.endsWith("/") ? trimmed.slice(0, -1) : trimmed;
}

export async function setupCustomProviderModel(
  runtime: RuntimeLike,
): Promise<{ selectedModel?: string; summary: string }> {
  const { ui } = runtime.ctx;

  const providerInput = await ui.input("Custom provider id:", "e.g., my-proxy");
  if (!providerInput?.trim()) {
    return { summary: "Custom provider setup cancelled." };
  }
  const provider = sanitizeProviderId(providerInput);

  const apiChoice = await searchableSelect(ui, "Select provider API:", [
    {
      label: "openai-completions",
      value: "openai-completions",
    },
    {
      label: "openai-responses",
      value: "openai-responses",
    },
    {
      label: "anthropic-messages",
      value: "anthropic-messages",
    },
    {
      label: "google-generative-ai",
      value: "google-generative-ai",
    },
  ]);
  if (!apiChoice) {
    return { summary: "Custom provider setup cancelled." };
  }

  const baseUrl = await ui.input(
    `Base URL for ${provider}:`,
    "https://api.example.com/v1",
  );
  if (!baseUrl?.trim()) {
    return { summary: "Custom provider setup cancelled." };
  }

  const apiKey =
    (await ui.input(
      `API key for ${provider} (leave empty for local/no-auth servers):`,
      "optional",
    )) ?? "";

  const connection: ProviderConnectionSubmission = {
    providerId: provider,
    api: apiChoice as SupportedApi,
    baseUrl,
    apiKey,
  };

  const setupOptions =
    apiChoice === "google-generative-ai"
      ? [
          {
            label: "Add a single model manually",
            value: "manual",
            searchText: "manual single model",
          },
        ]
      : [
          {
            label: "Discover models automatically",
            value: "discover",
            searchText: "discover automatic provider models",
          },
          {
            label: "Add a single model manually",
            value: "manual",
            searchText: "manual single model",
          },
        ];

  const setupMode = await searchableSelect(
    ui,
    `How should Omni-Pi configure ${provider}?`,
    setupOptions,
  );
  if (!setupMode) {
    return { summary: "Custom provider setup cancelled." };
  }

  if (setupMode === "discover") {
    return setupDiscoveredProvider(runtime, connection);
  }

  return setupManualProviderAfterConnection(runtime, connection);
}

async function setupManualProviderAfterConnection(
  runtime: RuntimeLike,
  connection: ProviderConnectionSubmission,
): Promise<{ selectedModel?: string; summary: string }> {
  const { ui } = runtime.ctx;
  const provider = sanitizeProviderId(connection.providerId);

  const modelId = await ui.input(
    `Model id for ${provider}:`,
    "e.g., gpt-oss-120b",
  );
  if (!modelId?.trim()) {
    return { summary: "Custom provider setup cancelled." };
  }

  const reasoning = await ui.confirm(
    "Reasoning model?",
    `Should ${provider}/${modelId.trim()} be marked as a reasoning-capable model?`,
  );
  const imageInput = await ui.confirm(
    "Image input?",
    `Should ${provider}/${modelId.trim()} accept image input?`,
  );

  const selectedModel = await persistCustomProviderModel(runtime, {
    ...connection,
    modelId: modelId.trim(),
    reasoning,
    imageInput,
  });

  return {
    selectedModel,
    summary: `Saved custom provider ${provider} and model ${selectedModel} to ${getModelsPath().replace(os.homedir(), "~")}.`,
  };
}

async function persistCustomProviderModel(
  runtime: RuntimeLike,
  submission: BrowserCustomModelSubmission,
): Promise<string> {
  const { modelRegistry } = runtime.ctx;
  const provider = sanitizeProviderId(submission.providerId);
  const modelId = submission.modelId.trim();

  await upsertProviderConfig(provider, (current) =>
    buildCustomProviderConfigUpdate(current, provider, submission),
  );

  if (submission.apiKey?.trim()) {
    modelRegistry.authStorage.set(provider, {
      type: "api_key",
      key: submission.apiKey.trim(),
    });
  }

  modelRegistry.refresh();
  return `${provider}/${modelId}`;
}

async function setupDiscoveredProvider(
  runtime: RuntimeLike,
  submission: ProviderConnectionSubmission,
): Promise<{ selectedModel?: string; summary: string }> {
  const { modelRegistry, ui } = runtime.ctx;
  const provider = sanitizeProviderId(submission.providerId);
  const discovered = await discoverProviderModels(
    submission.api,
    submission.baseUrl,
    submission.apiKey?.trim() || undefined,
  );

  if (discovered.length === 0) {
    const shouldFallback = await ui.confirm(
      "No models found",
      `Could not discover models for ${provider}. Do you want to add one manually instead?`,
    );
    if (!shouldFallback) {
      return {
        summary: `Could not discover models for ${provider}. No changes were saved.`,
      };
    }

    return setupManualProviderAfterConnection(runtime, submission);
  }

  await upsertProviderConfig(provider, (current) =>
    buildDiscoveredProviderConfigUpdate(
      current,
      provider,
      submission,
      discovered,
    ),
  );

  if (submission.apiKey?.trim()) {
    modelRegistry.authStorage.set(provider, {
      type: "api_key",
      key: submission.apiKey.trim(),
    });
  }

  modelRegistry.refresh();

  return {
    selectedModel: `${provider}/${discovered[0].id}`,
    summary: `Saved provider ${provider} with ${discovered.length} discovered model${discovered.length === 1 ? "" : "s"} to ${getModelsPath().replace(os.homedir(), "~")}.`,
  };
}

export function buildCustomProviderConfigUpdate(
  current: ModelsJsonProviderConfig,
  _provider: string,
  submission: BrowserCustomModelSubmission,
): ModelsJsonProviderConfig {
  const modelId = submission.modelId.trim();
  const existingModels = current.models ?? [];
  const existingModel = existingModels.find((entry) => entry.id === modelId);
  const filtered = existingModels.filter((entry) => entry.id !== modelId);

  return {
    ...current,
    baseUrl: normalizeBaseUrl(submission.baseUrl),
    api: submission.api,
    ...(submission.apiKey?.trim()
      ? { apiKey: submission.apiKey.trim() }
      : current.apiKey?.trim()
        ? { apiKey: current.apiKey.trim() }
        : {}),
    authHeader:
      submission.api === "openai-completions" ||
      submission.api === "openai-responses",
    models: [
      ...filtered,
      {
        ...existingModel,
        id: modelId,
        reasoning: submission.reasoning,
        input: submission.imageInput ? ["text", "image"] : ["text"],
      },
    ],
  };
}

export function buildDiscoveredProviderConfigUpdate(
  current: ModelsJsonProviderConfig,
  _provider: string,
  submission: ProviderConnectionSubmission,
  discovered: OmniProviderModel[],
): ModelsJsonProviderConfig {
  const existingModels = current.models ?? [];
  const existingModelsById = new Map(
    existingModels.map((entry) => [entry.id, entry] as const),
  );

  return {
    ...current,
    baseUrl: normalizeBaseUrl(submission.baseUrl),
    api: submission.api,
    ...(submission.apiKey?.trim()
      ? { apiKey: submission.apiKey.trim() }
      : current.apiKey?.trim()
        ? { apiKey: current.apiKey.trim() }
        : {}),
    authHeader:
      submission.api === "openai-completions" ||
      submission.api === "openai-responses",
    models: discovered.map((model) => {
      const existing = existingModelsById.get(model.id);
      const updated: ModelsJsonModelConfig = {
        ...existing,
        id: model.id,
        name: existing?.name ?? model.name,
        reasoning: model.reasoning,
        input: model.input,
        cost: model.cost,
        ...(model.contextWindow > 0
          ? { contextWindow: model.contextWindow }
          : existing?.contextWindow !== undefined
            ? { contextWindow: existing.contextWindow }
            : {}),
        ...(model.maxTokens > 0
          ? { maxTokens: model.maxTokens }
          : existing?.maxTokens !== undefined
            ? { maxTokens: existing.maxTokens }
            : {}),
      };

      return updated;
    }),
  };
}

export async function runModelSetupWizard(
  runtime: RuntimeLike,
): Promise<{ selectedModel?: string; summary: string }> {
  return setupCustomProviderModel(runtime);
}

function searchModels(models: string[], query: string): string[] {
  const normalized = query.trim().toLowerCase();
  if (!normalized) {
    return models.slice(0, 50);
  }

  return models
    .filter((model) => model.toLowerCase().includes(normalized))
    .slice(0, 50);
}

export async function runTerminalModelSearch(
  runtime: RuntimeLike,
  role: string,
  models: string[],
  currentModel?: string,
): Promise<
  | { kind: "selected"; model: string }
  | { kind: "browser" }
  | { kind: "cancelled" }
> {
  const { ui } = runtime.ctx;

  while (true) {
    const query = await ui.input(
      `Search available models for ${role}:`,
      currentModel ?? "provider or model id",
    );
    if (query === undefined) {
      return { kind: "cancelled" };
    }

    const exact = models.find((model) => model === query.trim());
    if (exact) {
      return { kind: "selected", model: exact };
    }

    const filtered = searchModels(models, query);
    const options = filtered.map((model) =>
      model === currentModel ? `${model} (current)` : model,
    );
    options.push("Search again");
    options.push("Open browser view");

    const selected = await searchableSelect(
      ui,
      `Matching models for ${role}:`,
      options.map((option) => ({
        label: option,
        value: option,
      })),
    );

    if (!selected || selected === "Search again") {
      continue;
    }
    if (selected === "Open browser view") {
      return { kind: "browser" };
    }

    return { kind: "selected", model: selected.replace(" (current)", "") };
  }
}

function renderBrowserModelSelectionPage(
  currentModels: OmniConfig["models"],
  models: string[],
): string {
  const modelsJson = JSON.stringify(models);
  const currentModelsJson = JSON.stringify(currentModels);

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Omni Model Picker</title>
    <style>
      :root {
        color-scheme: light;
        --bg: #f4efe6;
        --panel: rgba(255, 252, 247, 0.96);
        --ink: #1f1b16;
        --muted: #6f6358;
        --line: #d9ccbd;
        --accent: #a3482f;
      }
      * { box-sizing: border-box; }
      body { margin: 0; font-family: ui-sans-serif, system-ui, sans-serif; color: var(--ink); background: linear-gradient(180deg, #efe4d5, var(--bg)); }
      main { max-width: 1080px; margin: 48px auto; padding: 0 20px 40px; }
      .panel { background: var(--panel); border: 1px solid var(--line); border-radius: 24px; box-shadow: 0 24px 64px rgba(31, 27, 22, 0.08); padding: 24px; }
      h1 { margin: 0 0 8px; font-size: 2rem; }
      p { color: var(--muted); line-height: 1.5; }
      input, button { width: 100%; border-radius: 14px; padding: 12px 14px; font: inherit; }
      input { border: 1px solid var(--line); margin-top: 8px; }
      button { border: none; background: var(--accent); color: white; font-weight: 700; margin-top: 20px; cursor: pointer; }
      .list { margin-top: 20px; border: 1px solid var(--line); border-radius: 18px; background: white; max-height: 420px; overflow: auto; }
      .item { padding: 12px 14px; border-bottom: 1px solid #eee3d5; cursor: pointer; }
      .item:last-child { border-bottom: none; }
      .item.active { background: #f7ede2; }
      .meta { color: var(--muted); font-size: 0.92rem; }
      .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 18px; margin-top: 24px; }
      .role { border: 1px solid var(--line); border-radius: 18px; background: rgba(255,255,255,0.72); padding: 16px; }
      h2 { margin: 0 0 10px; font-size: 1.1rem; text-transform: capitalize; }
    </style>
  </head>
  <body>
    <main>
      <section class="panel">
        <h1>Configure Omni-Pi models</h1>
        <p>Search Pi's available models, then save the single brain assignment.</p>
        <div class="grid">
          <section class="role" data-role="brain">
            <h2>brain</h2>
            <label>Search<input id="search-brain" placeholder="Filter models" /></label>
            <label>Selected model<input id="selected-brain" value="${escapeHtml(currentModels.brain)}" /></label>
            <div id="results-brain" class="list"></div>
          </section>
        </div>
        <button id="save">Save Brain Model</button>
      </section>
    </main>
    <script>
      const models = ${modelsJson};
      const currentModels = ${currentModelsJson};
      const roles = ['brain'];

      const renderRole = (role) => {
        const searchEl = document.getElementById('search-' + role);
        const selectedEl = document.getElementById('selected-' + role);
        const resultsEl = document.getElementById('results-' + role);
        const query = searchEl.value.trim().toLowerCase();
        const filtered = models
          .filter((model) => !query || model.toLowerCase().includes(query))
          .slice(0, 100);
        resultsEl.innerHTML = filtered.map((model) => {
          const active = selectedEl.value === model;
          const currentBadge = model === currentModels[role] ? '<div class="meta">Current selection</div>' : '';
          return '<div class="item' + (active ? ' active' : '') + '" data-model="' + model.replaceAll('"', '&quot;') + '"><div>' + model + '</div>' + currentBadge + '</div>';
        }).join('');
        for (const item of resultsEl.querySelectorAll('.item')) {
          item.addEventListener('click', () => {
            selectedEl.value = item.dataset.model || '';
            renderRole(role);
          });
        }
      };

      for (const role of roles) {
        document.getElementById('search-' + role).addEventListener('input', () => renderRole(role));
        document.getElementById('selected-' + role).addEventListener('input', () => renderRole(role));
        renderRole(role);
      }

      document.getElementById('save').addEventListener('click', async () => {
        const response = await fetch('/submit', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            selectedModels: {
              brain: document.getElementById('selected-brain').value
            }
          })
        });
        if (response.ok) {
          document.body.innerHTML = '<main style="max-width:760px;margin:72px auto;font-family:ui-sans-serif,system-ui,sans-serif;padding:0 20px;"><h1>Omni-Pi models saved</h1><p>Return to Omni-Pi.</p></main>';
        }
      });
    </script>
  </body>
</html>`;
}

export async function runBrowserModelSelection(
  _runtime: RuntimeLike,
  currentModels: OmniConfig["models"],
  models: string[],
): Promise<BrowserModelSelectionResult> {
  return new Promise((resolve) => {
    const server = createServer((req, res) => {
      if (req.method === "GET" && req.url === "/") {
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end(renderBrowserModelSelectionPage(currentModels, models));
        return;
      }

      if (req.method === "POST" && req.url === "/submit") {
        const chunks: Buffer[] = [];
        req.on("data", (chunk) => {
          chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
        });
        req.on("end", () => {
          try {
            const parsed = JSON.parse(
              Buffer.concat(chunks).toString("utf8"),
            ) as { selectedModels?: OmniConfig["models"] };
            res.writeHead(204).end();
            clearTimeout(timeout);
            server.close(() =>
              resolve({
                selectedModels: parsed.selectedModels,
                summary: parsed.selectedModels
                  ? "Updated model assignments from browser view."
                  : "Model selection cancelled.",
              }),
            );
          } catch {
            res.writeHead(400).end();
          }
        });
        return;
      }

      res.writeHead(404).end();
    });

    const timeout = setTimeout(
      () => {
        server.close(() =>
          resolve({ summary: "Browser model selection timed out." }),
        );
      },
      15 * 60 * 1000,
    );

    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        clearTimeout(timeout);
        server.close(() =>
          resolve({ summary: "Could not start browser model selection." }),
        );
        return;
      }

      try {
        openExternalUrl(`http://127.0.0.1:${address.port}/`);
      } catch {
        clearTimeout(timeout);
        server.close(() =>
          resolve({ summary: "Could not open browser model selection." }),
        );
      }
    });
  });
}

function renderBrowserCustomModelPage(): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Add Custom Model</title>
    <style>
      :root { color-scheme: light; --bg: #f4efe6; --panel: rgba(255,252,247,0.96); --ink: #1f1b16; --line: #d9ccbd; --accent: #a3482f; }
      * { box-sizing: border-box; }
      body { margin: 0; font-family: ui-sans-serif, system-ui, sans-serif; color: var(--ink); background: linear-gradient(180deg, #efe4d5, var(--bg)); }
      main { max-width: 760px; margin: 48px auto; padding: 0 20px 40px; }
      .panel { background: var(--panel); border: 1px solid var(--line); border-radius: 24px; box-shadow: 0 24px 64px rgba(31,27,22,0.08); padding: 24px; }
      .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 16px; }
      label { display: block; font-weight: 600; margin-bottom: 8px; }
      input, select, button { width: 100%; border-radius: 14px; padding: 12px 14px; font: inherit; }
      input, select { border: 1px solid var(--line); margin-top: 6px; }
      button { border: none; background: var(--accent); color: white; font-weight: 700; margin-top: 20px; cursor: pointer; }
      .check { display: flex; align-items: center; gap: 10px; margin-top: 16px; font-weight: 600; }
      .check input { width: auto; margin: 0; }
    </style>
  </head>
  <body>
    <main>
      <section class="panel">
        <h1>Add custom model</h1>
        <div class="grid">
          <label>Provider ID<input id="providerId" placeholder="e.g. my-proxy" /></label>
          <label>Model ID<input id="modelId" placeholder="e.g. gpt-oss-120b" /></label>
          <label>API
            <select id="api">
              <option value="openai-completions">openai-completions</option>
              <option value="openai-responses">openai-responses</option>
              <option value="anthropic-messages">anthropic-messages</option>
              <option value="google-generative-ai">google-generative-ai</option>
            </select>
          </label>
          <label>Base URL<input id="baseUrl" placeholder="https://api.example.com/v1" /></label>
          <label>API Key<input id="apiKey" placeholder="optional for local/no-auth servers" /></label>
        </div>
        <label class="check"><input type="checkbox" id="reasoning" />Reasoning-capable model</label>
        <label class="check"><input type="checkbox" id="imageInput" />Supports image input</label>
        <button id="save">Save custom model</button>
      </section>
    </main>
    <script>
      document.getElementById('save').addEventListener('click', async () => {
        const payload = {
          providerId: document.getElementById('providerId').value,
          modelId: document.getElementById('modelId').value,
          api: document.getElementById('api').value,
          baseUrl: document.getElementById('baseUrl').value,
          apiKey: document.getElementById('apiKey').value,
          reasoning: document.getElementById('reasoning').checked,
          imageInput: document.getElementById('imageInput').checked
        };
        const response = await fetch('/submit', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
        if (response.ok) {
          document.body.innerHTML = '<main style="max-width:760px;margin:72px auto;font-family:ui-sans-serif,system-ui,sans-serif;padding:0 20px;"><h1>Custom model saved</h1><p>Return to Omni-Pi.</p></main>';
        }
      });
    </script>
  </body>
</html>`;
}

export async function runBrowserCustomModelSetup(
  runtime: RuntimeLike,
): Promise<{ selectedModel?: string; summary: string }> {
  return new Promise((resolve) => {
    const server = createServer((req, res) => {
      if (req.method === "GET" && req.url === "/") {
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end(renderBrowserCustomModelPage());
        return;
      }

      if (req.method === "POST" && req.url === "/submit") {
        const chunks: Buffer[] = [];
        req.on("data", (chunk) => {
          chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
        });
        req.on("end", async () => {
          try {
            const parsed = JSON.parse(
              Buffer.concat(chunks).toString("utf8"),
            ) as BrowserCustomModelSubmission;
            const selectedModel = await persistCustomProviderModel(
              runtime,
              parsed,
            );
            res.writeHead(204).end();
            clearTimeout(timeout);
            server.close(() =>
              resolve({
                selectedModel,
                summary: `Saved custom provider model ${selectedModel}.`,
              }),
            );
          } catch (error) {
            res
              .writeHead(400)
              .end(error instanceof Error ? error.message : String(error));
          }
        });
        return;
      }

      res.writeHead(404).end();
    });

    const timeout = setTimeout(
      () => {
        server.close(() =>
          resolve({ summary: "Browser custom model setup timed out." }),
        );
      },
      15 * 60 * 1000,
    );

    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        clearTimeout(timeout);
        server.close(() =>
          resolve({ summary: "Could not start browser custom model setup." }),
        );
        return;
      }

      try {
        openExternalUrl(`http://127.0.0.1:${address.port}/`);
      } catch {
        clearTimeout(timeout);
        server.close(() =>
          resolve({ summary: "Could not open browser custom model setup." }),
        );
      }
    });
  });
}
