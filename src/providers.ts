import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

type ModelApi =
  | "anthropic-messages"
  | "openai-completions"
  | "openai-responses";

type AuthScheme = "bearer" | "anthropic";

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

interface RemoteDiscoveryDefinition {
  name: string;
  api: ModelApi;
  authScheme: AuthScheme;
  apiKeyEnv: string | (() => string);
  baseUrlEnv?: string;
  defaultBaseUrl?: string;
}

interface LocalDiscoveryDefinition {
  name: string;
  api: ModelApi;
  baseUrl: string;
  apiKeyEnv?: string;
  discover: () => Promise<OmniProviderModel[]>;
}

const ZERO_COST = {
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
} as const;

const REMOTE_PROVIDERS: RemoteDiscoveryDefinition[] = [
  {
    name: "nvidia",
    api: "openai-completions",
    authScheme: "bearer",
    apiKeyEnv: "NVIDIA_API_KEY",
    baseUrlEnv: "NVIDIA_BASE_URL",
    defaultBaseUrl: "https://integrate.api.nvidia.com/v1",
  },
  {
    name: "together",
    api: "openai-completions",
    authScheme: "bearer",
    apiKeyEnv: "TOGETHER_API_KEY",
    baseUrlEnv: "TOGETHER_BASE_URL",
    defaultBaseUrl: "https://api.together.xyz/v1",
  },
  {
    name: "synthetic",
    api: "openai-completions",
    authScheme: "bearer",
    apiKeyEnv: "SYNTHETIC_API_KEY",
    baseUrlEnv: "SYNTHETIC_BASE_URL",
    defaultBaseUrl: "https://api.synthetic.new/openai/v1",
  },
  {
    name: "nanogpt",
    api: "openai-completions",
    authScheme: "bearer",
    apiKeyEnv: "NANO_GPT_API_KEY",
    baseUrlEnv: "NANO_GPT_BASE_URL",
    defaultBaseUrl: "https://nano-gpt.com/api/v1",
  },
  {
    name: "xiaomi",
    api: "anthropic-messages",
    authScheme: "anthropic",
    apiKeyEnv: "XIAOMI_API_KEY",
    baseUrlEnv: "XIAOMI_BASE_URL",
  },
  {
    name: "moonshot",
    api: "openai-completions",
    authScheme: "bearer",
    apiKeyEnv: "MOONSHOT_API_KEY",
    baseUrlEnv: "MOONSHOT_BASE_URL",
    defaultBaseUrl: "https://api.moonshot.cn/v1",
  },
  {
    name: "venice",
    api: "openai-completions",
    authScheme: "bearer",
    apiKeyEnv: "VENICE_API_KEY",
    baseUrlEnv: "VENICE_BASE_URL",
    defaultBaseUrl: "https://api.venice.ai/api/v1",
  },
  {
    name: "kilo",
    api: "openai-completions",
    authScheme: "bearer",
    apiKeyEnv: "KILO_API_KEY",
    baseUrlEnv: "KILO_BASE_URL",
    defaultBaseUrl: "https://api.kilo.ai/api/gateway",
  },
  {
    name: "qwen-portal",
    api: "openai-completions",
    authScheme: "bearer",
    apiKeyEnv: () =>
      process.env.QWEN_OAUTH_TOKEN ? "QWEN_OAUTH_TOKEN" : "QWEN_PORTAL_API_KEY",
    baseUrlEnv: "QWEN_PORTAL_BASE_URL",
    defaultBaseUrl: "https://dashscope-intl.aliyuncs.com/compatible-mode/v1",
  },
  {
    name: "qianfan",
    api: "openai-completions",
    authScheme: "bearer",
    apiKeyEnv: "QIANFAN_API_KEY",
    baseUrlEnv: "QIANFAN_BASE_URL",
    defaultBaseUrl: "https://qianfan.baidubce.com/v2",
  },
  {
    name: "cloudflare-ai-gateway",
    api: "anthropic-messages",
    authScheme: "anthropic",
    apiKeyEnv: "CLOUDFLARE_AI_GATEWAY_API_KEY",
    baseUrlEnv: "CLOUDFLARE_AI_GATEWAY_BASE_URL",
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

export const AVAILABLE_MODELS: string[] = [];

export async function registerOmniProviders(api: ExtensionAPI): Promise<void> {
  const remoteDiscovered = await Promise.all(
    REMOTE_PROVIDERS.map(async (provider) => {
      const baseUrl = resolveRemoteProviderBaseUrl(provider);
      if (!baseUrl) {
        return null;
      }

      const apiKeyEnv = resolveApiKeyEnv(provider.apiKeyEnv);
      const apiKey = process.env[apiKeyEnv];
      const models = await discoverRemoteProviderModels(
        baseUrl,
        provider.api,
        provider.authScheme,
        apiKey,
      );

      if (models.length === 0) {
        return null;
      }

      return { provider, baseUrl, apiKeyEnv, models };
    }),
  );

  for (const discovered of remoteDiscovered) {
    if (!discovered) {
      continue;
    }

    api.registerProvider(discovered.provider.name, {
      baseUrl: discovered.baseUrl,
      apiKey: discovered.apiKeyEnv,
      models: discovered.models,
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

function resolveApiKeyEnv(apiKeyEnv: string | (() => string)): string {
  return typeof apiKeyEnv === "function" ? apiKeyEnv() : apiKeyEnv;
}

function resolveRemoteProviderBaseUrl(
  provider: RemoteDiscoveryDefinition,
): string | undefined {
  if (provider.baseUrlEnv) {
    const configuredBaseUrl = process.env[provider.baseUrlEnv];
    if (configuredBaseUrl) {
      return configuredBaseUrl;
    }
  }

  return provider.defaultBaseUrl;
}

async function discoverRemoteProviderModels(
  baseUrl: string,
  api: ModelApi,
  _authScheme: AuthScheme,
  apiKey?: string,
): Promise<OmniProviderModel[]> {
  if (api === "anthropic-messages") {
    return discoverAnthropicCompatibleModels(baseUrl, apiKey);
  }

  return discoverOpenAICompatibleModels(baseUrl, api, apiKey);
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
  const normalizedBaseUrl = baseUrl.endsWith("/")
    ? baseUrl.slice(0, -1)
    : baseUrl;
  const payload = (await fetchJson(`${normalizedBaseUrl}/models`, {
    headers: apiKey
      ? {
          Authorization: `Bearer ${apiKey}`,
        }
      : undefined,
  })) as { data?: Array<{ id?: string }> } | Array<{ id?: string }> | null;

  const entries = Array.isArray(payload) ? payload : (payload?.data ?? []);

  return entries
    .map((entry) => entry.id?.trim())
    .filter((id): id is string => Boolean(id))
    .map((id) =>
      model(id, id, api, inferReasoning(id), inferInput(id), 128000, 8192),
    )
    .sort((left, right) => left.id.localeCompare(right.id));
}

async function discoverAnthropicCompatibleModels(
  baseUrl: string,
  apiKey?: string,
): Promise<OmniProviderModel[]> {
  const normalizedBaseUrl = baseUrl.endsWith("/")
    ? baseUrl.slice(0, -1)
    : baseUrl;
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
        200000,
        64000,
      );
    })
    .filter((entry): entry is OmniProviderModel => entry !== null)
    .sort((left, right) => left.id.localeCompare(right.id));
}

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
