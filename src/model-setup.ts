import { spawn } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import os from "node:os";
import path from "node:path";

import type {
  ExtensionCommandContext,
  ExtensionUIContext,
} from "@mariozechner/pi-coding-agent";
import { getAgentDir } from "@mariozechner/pi-coding-agent";

import { AVAILABLE_MODELS } from "./providers.js";

type SupportedApi =
  | "openai-completions"
  | "openai-responses"
  | "anthropic-messages"
  | "google-generative-ai";

interface ModelLike {
  provider: string;
  id: string;
}

interface AuthStorageLike {
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
  getAll(): ModelLike[];
  getAvailable(): ModelLike[];
  refresh(): void;
  authStorage: AuthStorageLike;
}

interface RuntimeLike {
  ctx: ExtensionCommandContext;
}

export interface BrowserModelSelectionResult {
  selectedModel?: string;
  summary: string;
}

interface BrowserCustomModelSubmission {
  providerId: string;
  modelId: string;
  api: SupportedApi;
  baseUrl: string;
  apiKey?: string;
  reasoning: boolean;
  imageInput: boolean;
}

interface KnownProviderSetup {
  id: string;
  label: string;
  auth: "api-key" | "oauth" | "manual";
  browserUrl?: string;
  baseUrlRequired?: boolean;
  baseUrlPlaceholder?: string;
  apiKeyPlaceholder?: string;
}

interface ModelsJsonConfig {
  providers?: Record<string, ModelsJsonProviderConfig>;
}

interface ModelsJsonProviderConfig {
  baseUrl?: string;
  api?: SupportedApi;
  apiKey?: string;
  authHeader?: boolean;
  models?: Array<{
    id: string;
    name?: string;
    reasoning?: boolean;
    input?: Array<"text" | "image">;
    contextWindow?: number;
    maxTokens?: number;
  }>;
}

const KNOWN_PROVIDER_SETUPS: KnownProviderSetup[] = [
  {
    id: "anthropic",
    label: "Anthropic",
    auth: "api-key",
    browserUrl: "https://console.anthropic.com/",
    apiKeyPlaceholder: "sk-ant-...",
  },
  {
    id: "openai",
    label: "OpenAI",
    auth: "api-key",
    browserUrl: "https://platform.openai.com/api-keys",
    apiKeyPlaceholder: "sk-...",
  },
  {
    id: "openrouter",
    label: "OpenRouter",
    auth: "api-key",
    browserUrl: "https://openrouter.ai/keys",
    apiKeyPlaceholder: "sk-or-...",
  },
  {
    id: "google",
    label: "Google Gemini",
    auth: "api-key",
    browserUrl: "https://aistudio.google.com/app/apikey",
  },
  {
    id: "google-vertex",
    label: "Google Vertex AI",
    auth: "manual",
    browserUrl: "https://cloud.google.com/vertex-ai",
  },
  {
    id: "github-copilot",
    label: "GitHub Copilot",
    auth: "oauth",
    browserUrl: "https://github.com/features/copilot",
  },
  {
    id: "openai-codex",
    label: "OpenAI Codex",
    auth: "oauth",
    browserUrl: "https://chatgpt.com/",
  },
  {
    id: "claude-agent",
    label: "Claude Agent SDK",
    auth: "manual",
    browserUrl: "https://docs.anthropic.com/en/docs/claude-code/overview",
  },
  {
    id: "xai",
    label: "xAI",
    auth: "api-key",
    browserUrl: "https://console.x.ai/",
  },
  {
    id: "zai",
    label: "Z.ai",
    auth: "api-key",
    browserUrl: "https://platform.z.ai/",
  },
  {
    id: "amazon-bedrock",
    label: "Amazon Bedrock",
    auth: "manual",
    browserUrl: "https://console.aws.amazon.com/bedrock/",
  },
  {
    id: "azure-openai-responses",
    label: "Azure OpenAI Responses",
    auth: "api-key",
    browserUrl: "https://portal.azure.com/",
  },
  {
    id: "nvidia",
    label: "NVIDIA NIM",
    auth: "api-key",
    browserUrl: "https://build.nvidia.com/",
  },
  {
    id: "together",
    label: "Together AI",
    auth: "api-key",
    browserUrl: "https://api.together.xyz/settings/api-keys",
  },
  {
    id: "synthetic",
    label: "Synthetic",
    auth: "api-key",
    browserUrl: "https://app.synthetic.new/",
  },
  {
    id: "nanogpt",
    label: "NanoGPT",
    auth: "api-key",
    browserUrl: "https://nano-gpt.com/",
  },
  {
    id: "xiaomi",
    label: "Xiaomi",
    auth: "api-key",
    browserUrl: "https://platform.xiaomi.com/",
    baseUrlRequired: true,
    baseUrlPlaceholder: "https://api.xiaomi.example/anthropic",
  },
  {
    id: "moonshot",
    label: "Moonshot",
    auth: "api-key",
    browserUrl: "https://platform.moonshot.ai/",
  },
  {
    id: "venice",
    label: "Venice",
    auth: "api-key",
    browserUrl: "https://venice.ai/",
  },
  {
    id: "kilo",
    label: "Kilo Code",
    auth: "api-key",
    browserUrl: "https://kilocode.ai/",
  },
  {
    id: "gitlab-duo",
    label: "GitLab Duo",
    auth: "api-key",
    browserUrl: "https://about.gitlab.com/gitlab-duo/",
    baseUrlRequired: true,
    baseUrlPlaceholder: "https://gitlab.example/api/v4/chat",
  },
  {
    id: "qwen-portal",
    label: "Qwen Portal",
    auth: "api-key",
    browserUrl: "https://portal.qwen.ai/",
  },
  {
    id: "qianfan",
    label: "Qianfan",
    auth: "api-key",
    browserUrl: "https://cloud.baidu.com/product/wenxinworkshop",
  },
  {
    id: "cloudflare-ai-gateway",
    label: "Cloudflare AI Gateway",
    auth: "api-key",
    browserUrl: "https://dash.cloudflare.com/",
    baseUrlRequired: true,
    baseUrlPlaceholder:
      "https://gateway.ai.cloudflare.com/v1/<account>/<gateway>",
  },
];

function getModelsPath(): string {
  return path.join(getAgentDir(), "models.json");
}

function modelRef(model: ModelLike): string {
  return `${model.provider}/${model.id}`;
}

function providerFromModelRef(model: string): string {
  const [provider] = model.split("/", 1);
  return provider ?? model;
}

function titleCaseProvider(provider: string): string {
  return provider
    .split("-")
    .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
    .join(" ");
}

function getProviderSetup(provider: string): KnownProviderSetup {
  return (
    KNOWN_PROVIDER_SETUPS.find((entry) => entry.id === provider) ?? {
      id: provider,
      label: titleCaseProvider(provider),
      auth: "api-key",
    }
  );
}

function canonicalSort(left: string, right: string): number {
  return left.localeCompare(right);
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

function getKnownProviderModels(
  registry: ModelRegistryLike,
  provider: string,
): string[] {
  const refs = new Set<string>();

  for (const model of registry.getAll()) {
    if (model.provider === provider) {
      refs.add(modelRef(model));
    }
  }

  for (const model of AVAILABLE_MODELS) {
    if (providerFromModelRef(model) === provider) {
      refs.add(model);
    }
  }

  return Array.from(refs).sort(canonicalSort);
}

export function getAuthenticatedModelOptions(
  registry: ModelRegistryLike,
  currentModel?: string,
): string[] {
  const refs = new Set(registry.getAvailable().map((entry) => modelRef(entry)));

  if (currentModel && !refs.has(currentModel)) {
    refs.add(currentModel);
  }

  return Array.from(refs).sort(canonicalSort);
}

async function maybeOpenBrowser(
  ui: ExtensionUIContext,
  url: string,
): Promise<void> {
  const shouldOpen = await ui.confirm(
    "Open browser?",
    `Open ${url} to finish setup?`,
  );
  if (!shouldOpen) {
    return;
  }

  try {
    openExternalUrl(url);
  } catch {
    ui.notify(
      `Could not open the browser automatically. Visit ${url}`,
      "warning",
    );
  }
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

async function setupKnownProvider(
  runtime: RuntimeLike,
  provider: string,
): Promise<{ selectedModel?: string; summary: string }> {
  const setup = getProviderSetup(provider);
  const { ui, modelRegistry } = runtime.ctx;

  if (setup.browserUrl) {
    await maybeOpenBrowser(ui, setup.browserUrl);
  }

  if (setup.auth === "oauth") {
    const supportsOAuth =
      modelRegistry.authStorage
        .getOAuthProviders?.()
        .some((entry) => entry.id === provider) ?? false;

    const summary = supportsOAuth
      ? `Finish authentication with /login ${provider}, then rerun /omni-model.`
      : `Pi does not expose an automated login flow for ${setup.label} here. Finish provider auth outside Omni-Pi, then rerun /omni-model.`;

    return { summary };
  }

  if (setup.auth === "manual") {
    const models = getKnownProviderModels(modelRegistry, provider);
    if (models.length === 0) {
      return {
        summary: `Set up ${setup.label} outside Omni-Pi, then rerun /omni-model.`,
      };
    }

    const choice = await ui.select(
      `Select ${setup.label} model after setup:`,
      models,
    );

    return choice
      ? {
          selectedModel: choice,
          summary: `Selected ${choice}. Make sure ${setup.label} authentication is complete outside Omni-Pi.`,
        }
      : {
          summary: `${setup.label} setup cancelled.`,
        };
  }

  const apiKey = await ui.input(
    `Enter API key for ${setup.label}:`,
    setup.apiKeyPlaceholder ?? "Paste API key",
  );
  if (!apiKey?.trim()) {
    return { summary: `${setup.label} setup cancelled.` };
  }

  modelRegistry.authStorage.set(provider, {
    type: "api_key",
    key: apiKey.trim(),
  });

  if (setup.baseUrlRequired) {
    const baseUrl = await ui.input(
      `Enter base URL for ${setup.label}:`,
      setup.baseUrlPlaceholder ?? "https://api.example.com/v1",
    );
    if (!baseUrl?.trim()) {
      return { summary: `${setup.label} setup cancelled.` };
    }

    await upsertProviderConfig(provider, (current) => ({
      ...current,
      baseUrl: baseUrl.trim(),
    }));
  }

  modelRegistry.refresh();
  const models = getKnownProviderModels(modelRegistry, provider);
  if (models.length === 0) {
    return {
      summary: `${setup.label} credentials were saved, but no models are registered for ${provider} yet.`,
    };
  }

  const selectedModel = await ui.select(`Select ${setup.label} model:`, models);
  if (!selectedModel) {
    return { summary: `${setup.label} credentials saved.` };
  }

  return {
    selectedModel,
    summary: `Saved ${setup.label} credentials and selected ${selectedModel}.`,
  };
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

  const modelId = await ui.input(
    `Model id for ${provider}:`,
    "e.g., gpt-oss-120b",
  );
  if (!modelId?.trim()) {
    return { summary: "Custom provider setup cancelled." };
  }

  const apiChoice = await ui.select("Select provider API:", [
    "openai-completions",
    "openai-responses",
    "anthropic-messages",
    "google-generative-ai",
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

  const reasoning = await ui.confirm(
    "Reasoning model?",
    `Should ${provider}/${modelId.trim()} be marked as a reasoning-capable model?`,
  );
  const imageInput = await ui.confirm(
    "Image input?",
    `Should ${provider}/${modelId.trim()} accept image input?`,
  );

  const selectedModel = await persistCustomProviderModel(runtime, {
    providerId: provider,
    modelId: modelId.trim(),
    api: apiChoice as SupportedApi,
    baseUrl,
    apiKey,
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

  await upsertProviderConfig(provider, (current) => {
    const existingModels = current.models ?? [];
    const filtered = existingModels.filter((entry) => entry.id !== modelId);

    return {
      ...current,
      baseUrl: normalizeBaseUrl(submission.baseUrl),
      api: submission.api,
      apiKey:
        submission.apiKey?.trim() || current.apiKey || `${provider}-local-key`,
      authHeader:
        submission.api === "openai-completions" ||
        submission.api === "openai-responses",
      models: [
        ...filtered,
        {
          id: modelId,
          reasoning: submission.reasoning,
          input: submission.imageInput ? ["text", "image"] : ["text"],
        },
      ],
    };
  });

  if (submission.apiKey?.trim()) {
    modelRegistry.authStorage.set(provider, {
      type: "api_key",
      key: submission.apiKey.trim(),
    });
  }

  modelRegistry.refresh();
  return `${provider}/${modelId}`;
}

export async function runModelSetupWizard(
  runtime: RuntimeLike,
): Promise<{ selectedModel?: string; summary: string }> {
  const { ui, modelRegistry } = runtime.ctx;

  const providerIds = new Set<string>();
  for (const model of modelRegistry.getAll()) {
    providerIds.add(model.provider);
  }
  for (const model of AVAILABLE_MODELS) {
    providerIds.add(providerFromModelRef(model));
  }

  const providerOptions = Array.from(providerIds)
    .sort(canonicalSort)
    .map((provider) => {
      const setup = getProviderSetup(provider);
      const isAuthenticated = modelRegistry
        .getAvailable()
        .some((entry) => entry.provider === provider);
      return `${setup.label} [${provider}]${isAuthenticated ? " (authenticated)" : ""}`;
    });

  const setupChoice = await ui.select("Setup wizard:", [
    "Known provider with bundled models",
    "Custom provider/model",
  ]);
  if (!setupChoice) {
    return { summary: "Model setup cancelled." };
  }

  if (setupChoice === "Custom provider/model") {
    return setupCustomProviderModel(runtime);
  }

  const providerChoice = await ui.select(
    "Select provider to set up:",
    providerOptions,
  );
  if (!providerChoice) {
    return { summary: "Model setup cancelled." };
  }

  const providerMatch = providerChoice.match(/\[(.+?)\]/u);
  const provider = providerMatch?.[1];
  if (!provider) {
    return { summary: "Could not determine provider from selection." };
  }

  return setupKnownProvider(runtime, provider);
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

    const selected = await ui.select(`Matching models for ${role}:`, options);

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
  role: string,
  currentModel: string | undefined,
  models: string[],
): string {
  const modelsJson = JSON.stringify(models);
  const current = currentModel ?? "";

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
      main { max-width: 880px; margin: 48px auto; padding: 0 20px 40px; }
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
    </style>
  </head>
  <body>
    <main>
      <section class="panel">
        <h1>Select ${escapeHtml(role)} model</h1>
        <p>Search the same available models Pi exposes by default, then submit the model you want Omni-Pi to assign to ${escapeHtml(role)}.</p>
        <label>
          Search
          <input id="search" placeholder="Filter by provider or model id" />
        </label>
        <label>
          Selected model
          <input id="selected" value="${escapeHtml(current)}" />
        </label>
        <div id="results" class="list"></div>
        <button id="save">Save Model</button>
      </section>
    </main>
    <script>
      const models = ${modelsJson};
      const searchEl = document.getElementById("search");
      const selectedEl = document.getElementById("selected");
      const resultsEl = document.getElementById("results");
      const current = ${JSON.stringify(current)};

      const render = () => {
        const query = searchEl.value.trim().toLowerCase();
        const filtered = models
          .filter((model) => !query || model.toLowerCase().includes(query))
          .slice(0, 100);
        resultsEl.innerHTML = filtered.map((model) => {
          const active = selectedEl.value === model;
          const currentBadge = model === current ? '<div class="meta">Current selection</div>' : '';
          return '<div class="item' + (active ? ' active' : '') + '" data-model="' + model.replaceAll('"', '&quot;') + '"><div>' + model + '</div>' + currentBadge + '</div>';
        }).join('');
        for (const item of resultsEl.querySelectorAll('.item')) {
          item.addEventListener('click', () => {
            selectedEl.value = item.dataset.model || '';
            render();
          });
        }
      };

      searchEl.addEventListener('input', render);
      render();

      document.getElementById('save').addEventListener('click', async () => {
        const response = await fetch('/submit', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ selectedModel: selectedEl.value })
        });
        if (response.ok) {
          document.body.innerHTML = '<main style="max-width:760px;margin:72px auto;font-family:ui-sans-serif,system-ui,sans-serif;padding:0 20px;"><h1>Omni-Pi model saved</h1><p>Return to Omni-Pi.</p></main>';
        }
      });
    </script>
  </body>
</html>`;
}

export async function runBrowserModelSelection(
  _runtime: RuntimeLike,
  role: string,
  currentModel: string | undefined,
  models: string[],
): Promise<BrowserModelSelectionResult> {
  return new Promise((resolve) => {
    const server = createServer((req, res) => {
      if (req.method === "GET" && req.url === "/") {
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end(renderBrowserModelSelectionPage(role, currentModel, models));
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
            ) as { selectedModel?: string };
            res.writeHead(204).end();
            clearTimeout(timeout);
            server.close(() =>
              resolve({
                selectedModel: parsed.selectedModel?.trim(),
                summary: parsed.selectedModel?.trim()
                  ? `Selected ${parsed.selectedModel.trim()} for ${role}.`
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
