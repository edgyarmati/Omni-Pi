import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import providerCatalog from "./provider-catalog.json" with { type: "json" };

type ModelApi =
  | "anthropic-messages"
  | "openai-completions"
  | "openai-responses";

export interface OmniProviderModel {
  id: string;
  name: string;
  api: ModelApi;
  baseUrl?: string;
  reasoning: boolean;
  input: Array<"text" | "image">;
  cost: {
    input: number;
    output: number;
    cacheRead: number;
    cacheWrite: number;
  };
  contextWindow: number;
  maxTokens: number;
}

interface StaticProviderDefinition {
  name: string;
  apiKey: string | (() => string);
  baseUrlEnv?: string;
  defaultBaseUrl?: string;
  models: OmniProviderModel[];
}

interface LocalDiscoveryDefinition {
  name: string;
  api: ModelApi;
  baseUrl: string;
  apiKeyEnv?: string;
  discover: () => Promise<OmniProviderModel[]>;
}

interface OpenAICompatibleModelRecord {
  id?: unknown;
  name?: unknown;
  context_length?: unknown;
  max_completion_tokens?: unknown;
  modalities?: {
    input?: unknown;
  };
  [key: string]: unknown;
}

interface StaticProviderCatalogEntry {
  id: string;
  name: string;
  api: ModelApi;
  provider?: string;
  baseUrl?: string;
  reasoning: boolean;
  input: Array<"text" | "image">;
  cost: {
    input: number;
    output: number;
    cacheRead: number;
    cacheWrite: number;
  };
  contextWindow: number;
  maxTokens: number;
}

type StaticProviderCatalog = Record<
  string,
  Record<string, StaticProviderCatalogEntry>
>;

const ZERO_COST = {
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
} as const;

function model(
  id: string,
  name: string,
  api: ModelApi,
  reasoning: boolean,
  input: Array<"text" | "image">,
  contextWindow: number,
  maxTokens: number,
  baseUrl?: string,
): OmniProviderModel {
  return {
    id,
    name,
    api,
    ...(baseUrl ? { baseUrl } : {}),
    reasoning,
    input,
    cost: ZERO_COST,
    contextWindow,
    maxTokens,
  };
}

const STATIC_PROVIDER_CATALOG = providerCatalog as StaticProviderCatalog;

function getStaticProviderCatalogModels(provider: string): OmniProviderModel[] {
  return Object.values(STATIC_PROVIDER_CATALOG[provider] ?? {}).map(
    (entry) => ({
      id: entry.id,
      name: entry.name,
      api: entry.api,
      ...(entry.baseUrl ? { baseUrl: entry.baseUrl } : {}),
      reasoning: entry.reasoning,
      input: entry.input,
      cost: entry.cost,
      contextWindow: entry.contextWindow,
      maxTokens: entry.maxTokens,
    }),
  );
}

function getStaticProviderCatalogBaseUrl(provider: string): string | undefined {
  return Object.values(STATIC_PROVIDER_CATALOG[provider] ?? {})[0]?.baseUrl;
}

const STATIC_PROVIDERS: StaticProviderDefinition[] = [
  {
    name: "nvidia",
    apiKey: "NVIDIA_API_KEY",
    baseUrlEnv: "NVIDIA_BASE_URL",
    defaultBaseUrl: getStaticProviderCatalogBaseUrl("nvidia"),
    models: getStaticProviderCatalogModels("nvidia"),
  },
  {
    name: "together",
    apiKey: "TOGETHER_API_KEY",
    baseUrlEnv: "TOGETHER_BASE_URL",
    defaultBaseUrl: getStaticProviderCatalogBaseUrl("together"),
    models: getStaticProviderCatalogModels("together"),
  },
  {
    name: "synthetic",
    apiKey: "SYNTHETIC_API_KEY",
    baseUrlEnv: "SYNTHETIC_BASE_URL",
    defaultBaseUrl: getStaticProviderCatalogBaseUrl("synthetic"),
    models: getStaticProviderCatalogModels("synthetic"),
  },
  {
    name: "nanogpt",
    apiKey: "NANO_GPT_API_KEY",
    baseUrlEnv: "NANO_GPT_BASE_URL",
    defaultBaseUrl: getStaticProviderCatalogBaseUrl("nanogpt"),
    models: getStaticProviderCatalogModels("nanogpt"),
  },
  {
    name: "xiaomi",
    apiKey: "XIAOMI_API_KEY",
    baseUrlEnv: "XIAOMI_BASE_URL",
    defaultBaseUrl: getStaticProviderCatalogBaseUrl("xiaomi"),
    models: getStaticProviderCatalogModels("xiaomi"),
  },
  {
    name: "moonshot",
    apiKey: "MOONSHOT_API_KEY",
    baseUrlEnv: "MOONSHOT_BASE_URL",
    defaultBaseUrl: getStaticProviderCatalogBaseUrl("moonshot"),
    models: getStaticProviderCatalogModels("moonshot"),
  },
  {
    name: "venice",
    apiKey: "VENICE_API_KEY",
    baseUrlEnv: "VENICE_BASE_URL",
    defaultBaseUrl: getStaticProviderCatalogBaseUrl("venice"),
    models: getStaticProviderCatalogModels("venice"),
  },
  {
    name: "kilo",
    apiKey: "KILO_API_KEY",
    baseUrlEnv: "KILO_BASE_URL",
    defaultBaseUrl: getStaticProviderCatalogBaseUrl("kilo"),
    models: getStaticProviderCatalogModels("kilo"),
  },
  {
    name: "gitlab-duo",
    apiKey: "GITLAB_TOKEN",
    baseUrlEnv: "GITLAB_DUO_BASE_URL",
    defaultBaseUrl: getStaticProviderCatalogBaseUrl("gitlab-duo"),
    models: getStaticProviderCatalogModels("gitlab-duo"),
  },
  {
    name: "qwen-portal",
    apiKey: () =>
      process.env.QWEN_OAUTH_TOKEN ? "QWEN_OAUTH_TOKEN" : "QWEN_PORTAL_API_KEY",
    baseUrlEnv: "QWEN_PORTAL_BASE_URL",
    defaultBaseUrl: getStaticProviderCatalogBaseUrl("qwen-portal"),
    models: getStaticProviderCatalogModels("qwen-portal"),
  },
  {
    name: "qianfan",
    apiKey: "QIANFAN_API_KEY",
    baseUrlEnv: "QIANFAN_BASE_URL",
    defaultBaseUrl: getStaticProviderCatalogBaseUrl("qianfan"),
    models: getStaticProviderCatalogModels("qianfan"),
  },
  {
    name: "cloudflare-ai-gateway",
    apiKey: "CLOUDFLARE_AI_GATEWAY_API_KEY",
    baseUrlEnv: "CLOUDFLARE_AI_GATEWAY_BASE_URL",
    defaultBaseUrl: getStaticProviderCatalogBaseUrl("cloudflare-ai-gateway"),
    models: getStaticProviderCatalogModels("cloudflare-ai-gateway"),
  },
];

const LOCAL_PROVIDERS: LocalDiscoveryDefinition[] = [
  {
    name: "ollama",
    api: "openai-completions",
    baseUrl: withV1(process.env.OLLAMA_BASE_URL ?? "http://127.0.0.1:11434"),
    apiKeyEnv: "OLLAMA_API_KEY",
    discover: async () => discoverOllamaModels(),
  },
  {
    name: "lm-studio",
    api: "openai-completions",
    baseUrl: process.env.LM_STUDIO_BASE_URL ?? "http://127.0.0.1:1234/v1",
    apiKeyEnv: "LM_STUDIO_API_KEY",
    discover: async () =>
      discoverOpenAICompatibleModels(
        process.env.LM_STUDIO_BASE_URL ?? "http://127.0.0.1:1234/v1",
        "openai-completions",
        process.env.LM_STUDIO_API_KEY,
      ),
  },
  {
    name: "llama.cpp",
    api: "openai-responses",
    baseUrl: process.env.LLAMA_CPP_BASE_URL ?? "http://127.0.0.1:8080",
    apiKeyEnv: "LLAMA_CPP_API_KEY",
    discover: async () =>
      discoverOpenAICompatibleModels(
        process.env.LLAMA_CPP_BASE_URL ?? "http://127.0.0.1:8080",
        "openai-responses",
        process.env.LLAMA_CPP_API_KEY,
      ),
  },
  {
    name: "litellm",
    api: "openai-completions",
    baseUrl: process.env.LITELLM_BASE_URL ?? "http://localhost:4000/v1",
    apiKeyEnv: "LITELLM_API_KEY",
    discover: async () =>
      discoverOpenAICompatibleModels(
        process.env.LITELLM_BASE_URL ?? "http://localhost:4000/v1",
        "openai-completions",
        process.env.LITELLM_API_KEY,
      ),
  },
  {
    name: "vllm",
    api: "openai-completions",
    baseUrl: process.env.VLLM_BASE_URL ?? "http://127.0.0.1:8000/v1",
    apiKeyEnv: "VLLM_API_KEY",
    discover: async () =>
      discoverOpenAICompatibleModels(
        process.env.VLLM_BASE_URL ?? "http://127.0.0.1:8000/v1",
        "openai-completions",
        process.env.VLLM_API_KEY,
      ),
  },
];

export const AVAILABLE_MODELS = [
  "claude-agent/claude-sonnet-4-6",
  "claude-agent/claude-opus-4-6",
  "anthropic/claude-sonnet-4-6",
  "anthropic/claude-opus-4-6",
  "anthropic/claude-sonnet-4-5",
  "anthropic/claude-opus-4-1",
  "openai/gpt-5.4",
  "openai/gpt-5",
  "openai/gpt-4.1",
  "openai/gpt-4o",
  "openai/o3-mini",
  "openai/o1",
  "google/gemini-2.5-pro",
  "google/gemini-2.5-flash",
  "amazon-bedrock/us.anthropic.claude-sonnet-4-20250514-v1:0",
  "azure-openai-responses/gpt-5.2",
  "openrouter/anthropic/claude-sonnet-4",
  "xai/grok-code-fast-1",
  "zai/glm-5",
  "zai/glm-5-turbo",
  "openai-codex/gpt-5-codex",
  "github-copilot/claude-sonnet-4",
  "google-vertex/gemini-2.5-pro",
  "together/moonshotai/Kimi-K2.5",
  "moonshot/kimi-k2.5",
  "nvidia/deepseek-ai/deepseek-v3.2",
  "venice/claude-sonnet-4-6",
  "qianfan/deepseek-v3.2",
  "qwen-portal/coder-model",
  "cloudflare-ai-gateway/anthropic/claude-sonnet-4-6",
  "gitlab-duo/duo-chat-gpt-5-2-codex",
  "xiaomi/mimo-v2-pro",
  "synthetic/hf:deepseek-ai/DeepSeek-V3.2",
  "nanogpt/anthropic/claude-sonnet-4.6",
  "kilo/anthropic/claude-sonnet-4.6",
];

export async function registerOmniProviders(api: ExtensionAPI): Promise<void> {
  const staticRegistrations = await Promise.all(
    STATIC_PROVIDERS.map(async (provider) => {
      const baseUrl = resolveStaticProviderBaseUrl(provider);
      if (!baseUrl) {
        return null;
      }

      const apiKeyEnv = resolveApiKeyEnv(provider.apiKey);
      const apiKey = process.env[apiKeyEnv];
      const discovered = await discoverStaticProviderModels(
        provider,
        baseUrl,
        apiKey,
      );
      const models = mergeProviderModels(provider.models, discovered).map(
        (entry) => ({
          ...entry,
          baseUrl: entry.baseUrl ?? baseUrl,
        }),
      );

      return {
        provider,
        baseUrl,
        apiKeyEnv,
        models,
      };
    }),
  );

  for (const registration of staticRegistrations) {
    if (!registration) {
      continue;
    }

    api.registerProvider(registration.provider.name, {
      baseUrl: registration.baseUrl,
      apiKey: registration.apiKeyEnv,
      models: registration.models,
    });
  }

  const localDiscovered = await Promise.all(
    LOCAL_PROVIDERS.map(async (provider) => {
      const models = await provider.discover();
      return { provider, models };
    }),
  );

  for (const { provider, models } of localDiscovered) {
    if (models.length === 0) {
      continue;
    }

    api.registerProvider(provider.name, {
      baseUrl: provider.baseUrl,
      apiKey: provider.apiKeyEnv ?? "omni-local",
      api: provider.api,
      models,
    });
  }
}

function resolveApiKeyEnv(apiKey: string | (() => string)): string {
  return typeof apiKey === "function" ? apiKey() : apiKey;
}

function resolveStaticProviderBaseUrl(
  provider: StaticProviderDefinition,
): string | undefined {
  if (provider.baseUrlEnv) {
    const configuredBaseUrl = process.env[provider.baseUrlEnv];
    if (configuredBaseUrl) {
      return configuredBaseUrl;
    }
  }

  return provider.defaultBaseUrl;
}

async function discoverStaticProviderModels(
  provider: StaticProviderDefinition,
  baseUrl: string,
  apiKey?: string,
): Promise<OmniProviderModel[]> {
  if (provider.models.every((entry) => entry.api === "anthropic-messages")) {
    return discoverAnthropicCompatibleModels(baseUrl, apiKey);
  }

  const api =
    provider.models.find((entry) => entry.api === "openai-responses")?.api ??
    "openai-completions";
  return discoverOpenAICompatibleModels(baseUrl, api, apiKey);
}

function mergeProviderModels(
  fallbackModels: OmniProviderModel[],
  discoveredModels: OmniProviderModel[],
): OmniProviderModel[] {
  const merged = new Map<string, OmniProviderModel>(
    fallbackModels.map((entry) => [entry.id, entry]),
  );

  for (const discoveredModel of discoveredModels) {
    const existing = merged.get(discoveredModel.id);
    if (!existing) {
      merged.set(discoveredModel.id, discoveredModel);
      continue;
    }

    merged.set(discoveredModel.id, {
      ...existing,
      ...discoveredModel,
      baseUrl: discoveredModel.baseUrl ?? existing.baseUrl,
      name: discoveredModel.name || existing.name,
      reasoning: existing.reasoning || discoveredModel.reasoning,
      input:
        existing.input.includes("image") ||
        discoveredModel.input.includes("image")
          ? ["text", "image"]
          : ["text"],
      cost: {
        input: discoveredModel.cost.input || existing.cost.input,
        output: discoveredModel.cost.output || existing.cost.output,
        cacheRead: discoveredModel.cost.cacheRead || existing.cost.cacheRead,
        cacheWrite: discoveredModel.cost.cacheWrite || existing.cost.cacheWrite,
      },
      contextWindow:
        discoveredModel.contextWindow > 0
          ? discoveredModel.contextWindow
          : existing.contextWindow,
      maxTokens:
        discoveredModel.maxTokens > 0
          ? discoveredModel.maxTokens
          : existing.maxTokens,
    });
  }

  return Array.from(merged.values()).sort((left, right) =>
    left.id.localeCompare(right.id),
  );
}

function withV1(baseUrl: string): string {
  const trimmed = baseUrl.endsWith("/") ? baseUrl.slice(0, -1) : baseUrl;
  return trimmed.endsWith("/v1") ? trimmed : `${trimmed}/v1`;
}

function withoutV1(baseUrl: string): string {
  return baseUrl.endsWith("/v1") ? baseUrl.slice(0, -3) : baseUrl;
}

async function fetchJson(
  input: string,
  init?: RequestInit,
): Promise<unknown | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 1000);

  try {
    const response = await fetch(input, {
      ...init,
      signal: controller.signal,
      headers: {
        Accept: "application/json",
        ...(init?.headers ?? {}),
      },
    });

    if (!response.ok) {
      return null;
    }

    return await response.json();
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

async function discoverOllamaModels(): Promise<OmniProviderModel[]> {
  const baseUrl = withV1(
    process.env.OLLAMA_BASE_URL ?? "http://127.0.0.1:11434",
  );
  const nativeBaseUrl = withoutV1(baseUrl);
  const payload = (await fetchJson(`${nativeBaseUrl}/api/tags`)) as {
    models?: Array<{ model?: string; name?: string }>;
  } | null;

  return (payload?.models ?? [])
    .map((entry) => {
      const id = entry.model ?? entry.name;
      if (!id) {
        return null;
      }

      return model(
        id,
        entry.name ?? id,
        "openai-completions",
        inferReasoning(id),
        inferInput(id),
        128000,
        8192,
      );
    })
    .filter((entry): entry is OmniProviderModel => entry !== null)
    .sort((left, right) => left.id.localeCompare(right.id));
}

async function discoverOpenAICompatibleModels(
  baseUrl: string,
  api: ModelApi,
  apiKey?: string,
): Promise<OmniProviderModel[]> {
  const normalizedBaseUrl = normalizeBaseUrl(baseUrl);
  if (!normalizedBaseUrl) {
    return [];
  }

  const payload = await fetchJson(`${normalizedBaseUrl}/models`, {
    headers: apiKey
      ? {
          Authorization: `Bearer ${apiKey}`,
        }
      : undefined,
  });
  const entries = extractOpenAICompatibleModelEntries(payload);
  if (!entries) {
    return [];
  }

  return entries
    .map((entry) => mapOpenAICompatibleModel(entry, normalizedBaseUrl, api))
    .filter((entry): entry is OmniProviderModel => entry !== null)
    .sort((left, right) => left.id.localeCompare(right.id));
}

async function discoverAnthropicCompatibleModels(
  baseUrl: string,
  apiKey?: string,
): Promise<OmniProviderModel[]> {
  const normalizedBaseUrl = normalizeBaseUrl(baseUrl);
  if (!normalizedBaseUrl) {
    return [];
  }

  const payload = (await fetchJson(`${normalizedBaseUrl}/models`, {
    headers: {
      "anthropic-version": "2023-06-01",
      ...(apiKey ? { "x-api-key": apiKey } : {}),
    },
  })) as
    | { data?: Array<{ id?: string; display_name?: string }> }
    | Array<{ id?: string; display_name?: string }>
    | null;

  const entries = Array.isArray(payload) ? payload : (payload?.data ?? []);

  return entries
    .map((entry) => {
      const id = entry.id?.trim();
      if (!id) {
        return null;
      }

      return model(
        id,
        entry.display_name?.trim() || id,
        "anthropic-messages",
        inferReasoning(id),
        inferInput(id),
        0,
        0,
      );
    })
    .filter((entry): entry is OmniProviderModel => entry !== null)
    .sort((left, right) => left.id.localeCompare(right.id));
}

export async function discoverProviderModels(
  api: ModelApi | "google-generative-ai",
  baseUrl: string,
  apiKey?: string,
): Promise<OmniProviderModel[]> {
  if (api === "anthropic-messages") {
    return discoverAnthropicCompatibleModels(baseUrl, apiKey);
  }

  if (api === "openai-completions" || api === "openai-responses") {
    return discoverOpenAICompatibleModels(baseUrl, api, apiKey);
  }

  return [];
}

function normalizeBaseUrl(baseUrl: string): string {
  const trimmed = baseUrl.trim();
  if (!trimmed) {
    return "";
  }

  return trimmed.endsWith("/") ? trimmed.slice(0, -1) : trimmed;
}

function extractOpenAICompatibleModelEntries(
  payload: unknown,
): OpenAICompatibleModelRecord[] | null {
  if (payload === null || payload === undefined) {
    return null;
  }

  if (Array.isArray(payload)) {
    return payload.filter(
      (entry): entry is OpenAICompatibleModelRecord =>
        typeof entry === "object" && entry !== null,
    );
  }

  if (typeof payload !== "object") {
    return null;
  }

  const record = payload as Record<string, unknown>;
  for (const key of ["data", "models", "result", "items"]) {
    const nested = extractOpenAICompatibleModelEntries(record[key]);
    if (nested !== null) {
      return nested;
    }
  }

  return null;
}

function mapOpenAICompatibleModel(
  entry: OpenAICompatibleModelRecord,
  _baseUrl: string,
  api: ModelApi,
): OmniProviderModel | null {
  const id =
    typeof entry.id === "string" && entry.id.trim().length > 0
      ? entry.id.trim()
      : undefined;
  if (!id) {
    return null;
  }

  const name =
    typeof entry.name === "string" && entry.name.trim().length > 0
      ? entry.name.trim()
      : id;
  const input = toInputCapabilities(entry.modalities?.input, id);

  return model(
    id,
    name,
    api,
    inferReasoning(id),
    input,
    toPositiveNumber(entry.context_length),
    toPositiveNumber(entry.max_completion_tokens),
  );
}

function toInputCapabilities(
  value: unknown,
  fallbackId: string,
): Array<"text" | "image"> {
  if (!Array.isArray(value)) {
    return inferInput(fallbackId);
  }

  return value.some((entry) => entry === "image")
    ? ["text", "image"]
    : ["text"];
}

function toPositiveNumber(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    return value;
  }
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
  }
  return 0;
}

function inferReasoning(id: string): boolean {
  return /(reason|thinking|r1|o1|o3|o4|qwq|gpt-oss|sonnet|opus|kimi-k2\.5)/iu.test(
    id,
  );
}

function inferInput(id: string): Array<"text" | "image"> {
  return /(vision|vl|omni|llava|gemma-3|mimo-v2-omni)/iu.test(id)
    ? ["text", "image"]
    : ["text"];
}
