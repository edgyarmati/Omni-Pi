import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

type ModelApi =
  | "anthropic-messages"
  | "openai-completions"
  | "openai-responses";

interface OmniProviderModel {
  id: string;
  name: string;
  api: ModelApi;
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
): OmniProviderModel {
  return {
    id,
    name,
    api,
    reasoning,
    input,
    cost: ZERO_COST,
    contextWindow,
    maxTokens,
  };
}

const STATIC_PROVIDERS: StaticProviderDefinition[] = [
  {
    name: "nvidia",
    apiKey: "NVIDIA_API_KEY",
    baseUrlEnv: "NVIDIA_BASE_URL",
    defaultBaseUrl: "https://integrate.api.nvidia.com/v1",
    models: [
      model(
        "deepseek-ai/deepseek-v3.2",
        "DeepSeek V3.2",
        "openai-completions",
        true,
        ["text"],
        163840,
        65536,
      ),
      model(
        "deepseek-ai/deepseek-r1-0528",
        "DeepSeek R1 0528",
        "openai-completions",
        true,
        ["text"],
        128000,
        4096,
      ),
      model(
        "meta/llama-3.3-70b-instruct",
        "Llama 3.3 70B Instruct",
        "openai-completions",
        false,
        ["text"],
        128000,
        4096,
      ),
    ],
  },
  {
    name: "together",
    apiKey: "TOGETHER_API_KEY",
    baseUrlEnv: "TOGETHER_BASE_URL",
    defaultBaseUrl: "https://api.together.xyz/v1",
    models: [
      model(
        "deepseek-ai/DeepSeek-R1",
        "DeepSeek R1",
        "openai-completions",
        true,
        ["text"],
        131072,
        8192,
      ),
      model(
        "moonshotai/Kimi-K2.5",
        "Kimi K2.5",
        "openai-completions",
        true,
        ["text", "image"],
        262144,
        32768,
      ),
      model(
        "meta-llama/Llama-3.3-70B-Instruct-Turbo",
        "Llama 3.3 70B Instruct Turbo",
        "openai-completions",
        false,
        ["text"],
        131072,
        8192,
      ),
    ],
  },
  {
    name: "synthetic",
    apiKey: "SYNTHETIC_API_KEY",
    baseUrlEnv: "SYNTHETIC_BASE_URL",
    defaultBaseUrl: "https://api.synthetic.new/openai/v1",
    models: [
      model(
        "hf:deepseek-ai/DeepSeek-V3.2",
        "DeepSeek V3.2",
        "openai-completions",
        false,
        ["text"],
        162816,
        8192,
      ),
      model(
        "hf:moonshotai/Kimi-K2-Instruct-0905",
        "Kimi K2 Instruct 0905",
        "openai-completions",
        false,
        ["text"],
        262144,
        8192,
      ),
      model(
        "hf:meta-llama/Llama-3.3-70B-Instruct",
        "Llama 3.3 70B Instruct",
        "openai-completions",
        false,
        ["text"],
        131072,
        8192,
      ),
    ],
  },
  {
    name: "nanogpt",
    apiKey: "NANO_GPT_API_KEY",
    baseUrlEnv: "NANO_GPT_BASE_URL",
    defaultBaseUrl: "https://nano-gpt.com/api/v1",
    models: [
      model(
        "anthropic/claude-sonnet-4.6",
        "Claude Sonnet 4.6",
        "openai-completions",
        true,
        ["text"],
        222222,
        8888,
      ),
      model(
        "anthropic/claude-opus-4.6",
        "Claude Opus 4.6",
        "openai-completions",
        true,
        ["text"],
        222222,
        8888,
      ),
      model(
        "baseten/Kimi-K2-Instruct-FP4",
        "Kimi K2 Instruct FP4",
        "openai-completions",
        false,
        ["text"],
        222222,
        8888,
      ),
    ],
  },
  {
    name: "xiaomi",
    apiKey: "XIAOMI_API_KEY",
    baseUrlEnv: "XIAOMI_BASE_URL",
    models: [
      model(
        "mimo-v2-flash",
        "MiMo-V2-Flash",
        "anthropic-messages",
        true,
        ["text"],
        256000,
        64000,
      ),
      model(
        "mimo-v2-omni",
        "MiMo-V2-Omni",
        "anthropic-messages",
        true,
        ["text", "image"],
        256000,
        128000,
      ),
      model(
        "mimo-v2-pro",
        "MiMo-V2-Pro",
        "anthropic-messages",
        true,
        ["text"],
        1000000,
        128000,
      ),
    ],
  },
  {
    name: "moonshot",
    apiKey: "MOONSHOT_API_KEY",
    baseUrlEnv: "MOONSHOT_BASE_URL",
    defaultBaseUrl: "https://api.moonshot.cn/v1",
    models: [
      model(
        "kimi-k2.5",
        "Kimi K2.5",
        "openai-completions",
        true,
        ["text", "image"],
        262144,
        65536,
      ),
    ],
  },
  {
    name: "venice",
    apiKey: "VENICE_API_KEY",
    baseUrlEnv: "VENICE_BASE_URL",
    defaultBaseUrl: "https://api.venice.ai/api/v1",
    models: [
      model(
        "claude-sonnet-4-6",
        "Claude Sonnet 4.6",
        "openai-completions",
        true,
        ["text", "image"],
        1000000,
        64000,
      ),
      model(
        "claude-opus-4-6",
        "Claude Opus 4.6",
        "openai-completions",
        true,
        ["text", "image"],
        1000000,
        128000,
      ),
      model(
        "deepseek-v3.2",
        "DeepSeek V3.2",
        "openai-completions",
        true,
        ["text"],
        160000,
        8192,
      ),
    ],
  },
  {
    name: "kilo",
    apiKey: "KILO_API_KEY",
    baseUrlEnv: "KILO_BASE_URL",
    defaultBaseUrl: "https://api.kilo.ai/api/gateway",
    models: [
      model(
        "anthropic/claude-sonnet-4.6",
        "Claude Sonnet 4.6",
        "openai-completions",
        true,
        ["text"],
        222222,
        8888,
      ),
      model(
        "deepseek/deepseek-r1",
        "DeepSeek R1",
        "openai-completions",
        false,
        ["text"],
        222222,
        8888,
      ),
      model(
        "arcee-ai/coder-large",
        "Arcee Coder Large",
        "openai-completions",
        false,
        ["text"],
        222222,
        8888,
      ),
    ],
  },
  {
    name: "gitlab-duo",
    apiKey: "GITLAB_TOKEN",
    baseUrlEnv: "GITLAB_DUO_BASE_URL",
    models: [
      model(
        "duo-chat-sonnet-4-6",
        "Duo Chat Sonnet 4.6",
        "anthropic-messages",
        true,
        ["text", "image"],
        200000,
        64000,
      ),
      model(
        "duo-chat-opus-4-6",
        "Duo Chat Opus 4.6",
        "anthropic-messages",
        true,
        ["text", "image"],
        200000,
        64000,
      ),
      model(
        "duo-chat-gpt-5-2-codex",
        "Duo Chat GPT-5.2 Codex",
        "openai-responses",
        true,
        ["text", "image"],
        272000,
        128000,
      ),
    ],
  },
  {
    name: "qwen-portal",
    apiKey: () =>
      process.env.QWEN_OAUTH_TOKEN ? "QWEN_OAUTH_TOKEN" : "QWEN_PORTAL_API_KEY",
    baseUrlEnv: "QWEN_PORTAL_BASE_URL",
    defaultBaseUrl: "https://dashscope-intl.aliyuncs.com/compatible-mode/v1",
    models: [
      model(
        "coder-model",
        "Qwen Coder",
        "openai-completions",
        false,
        ["text"],
        128000,
        8192,
      ),
      model(
        "vision-model",
        "Qwen Vision",
        "openai-completions",
        false,
        ["text", "image"],
        128000,
        8192,
      ),
    ],
  },
  {
    name: "qianfan",
    apiKey: "QIANFAN_API_KEY",
    baseUrlEnv: "QIANFAN_BASE_URL",
    defaultBaseUrl: "https://qianfan.baidubce.com/v2",
    models: [
      model(
        "deepseek-v3.2",
        "DeepSeek V3.2",
        "openai-completions",
        false,
        ["text"],
        98304,
        32768,
      ),
    ],
  },
  {
    name: "cloudflare-ai-gateway",
    apiKey: "CLOUDFLARE_AI_GATEWAY_API_KEY",
    baseUrlEnv: "CLOUDFLARE_AI_GATEWAY_BASE_URL",
    defaultBaseUrl:
      "https://gateway.ai.cloudflare.com/v1/<account>/<gateway>/anthropic",
    models: [
      model(
        "anthropic/claude-sonnet-4-6",
        "Claude Sonnet 4.6",
        "anthropic-messages",
        true,
        ["text", "image"],
        200000,
        64000,
      ),
      model(
        "anthropic/claude-opus-4-6",
        "Claude Opus 4.6",
        "anthropic-messages",
        true,
        ["text", "image"],
        200000,
        32000,
      ),
      model(
        "openai/gpt-5.1",
        "GPT-5.1",
        "openai-completions",
        true,
        ["text", "image"],
        400000,
        128000,
      ),
    ],
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
  "zai/glm-4.6",
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
          baseUrl,
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
