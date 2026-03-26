import { spawn } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
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

  const platform = process.platform;
  const command =
    platform === "darwin"
      ? { cmd: "open", args: [url] }
      : platform === "win32"
        ? { cmd: "cmd", args: ["/c", "start", "", url] }
        : { cmd: "xdg-open", args: [url] };

  try {
    const child = spawn(command.cmd, command.args, {
      detached: true,
      stdio: "ignore",
    });
    child.unref();
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

async function setupCustomProviderModel(
  runtime: RuntimeLike,
): Promise<{ selectedModel?: string; summary: string }> {
  const { ui, modelRegistry } = runtime.ctx;

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

  await upsertProviderConfig(provider, (current) => {
    const existingModels = current.models ?? [];
    const filtered = existingModels.filter(
      (entry) => entry.id !== modelId.trim(),
    );

    return {
      ...current,
      baseUrl: normalizeBaseUrl(baseUrl),
      api: apiChoice as SupportedApi,
      apiKey: apiKey.trim() || current.apiKey || `${provider}-local-key`,
      authHeader:
        apiChoice === "openai-completions" || apiChoice === "openai-responses",
      models: [
        ...filtered,
        {
          id: modelId.trim(),
          reasoning,
          input: imageInput ? ["text", "image"] : ["text"],
        },
      ],
    };
  });

  if (apiKey.trim()) {
    modelRegistry.authStorage.set(provider, {
      type: "api_key",
      key: apiKey.trim(),
    });
  }

  modelRegistry.refresh();

  return {
    selectedModel: `${provider}/${modelId.trim()}`,
    summary: `Saved custom provider ${provider} and model ${provider}/${modelId.trim()} to ${getModelsPath().replace(os.homedir(), "~")}.`,
  };
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
