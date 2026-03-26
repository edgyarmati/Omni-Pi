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
  apiKey: string;
  models: OmniProviderModel[];
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
    apiKey: process.env.QWEN_OAUTH_TOKEN
      ? "QWEN_OAUTH_TOKEN"
      : "QWEN_PORTAL_API_KEY",
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
    ].map((entry) => ({
      ...entry,
      // Cloudflare requires the Anthropic/OpenAI provider path in the base URL.
      // The canonical endpoint must be supplied by environment in real usage.
    })),
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
        "lm-studio",
        process.env.LM_STUDIO_BASE_URL ?? "http://127.0.0.1:1234/v1",
        "openai-completions",
      ),
  },
  {
    name: "llama.cpp",
    api: "openai-responses",
    baseUrl: process.env.LLAMA_CPP_BASE_URL ?? "http://127.0.0.1:8080",
    apiKeyEnv: "LLAMA_CPP_API_KEY",
    discover: async () =>
      discoverOpenAICompatibleModels(
        "llama.cpp",
        process.env.LLAMA_CPP_BASE_URL ?? "http://127.0.0.1:8080",
        "openai-responses",
      ),
  },
  {
    name: "litellm",
    api: "openai-completions",
    baseUrl: process.env.LITELLM_BASE_URL ?? "http://localhost:4000/v1",
    apiKeyEnv: "LITELLM_API_KEY",
    discover: async () =>
      discoverOpenAICompatibleModels(
        "litellm",
        process.env.LITELLM_BASE_URL ?? "http://localhost:4000/v1",
        "openai-completions",
      ),
  },
  {
    name: "vllm",
    api: "openai-completions",
    baseUrl: process.env.VLLM_BASE_URL ?? "http://127.0.0.1:8000/v1",
    apiKeyEnv: "VLLM_API_KEY",
    discover: async () =>
      discoverOpenAICompatibleModels(
        "vllm",
        process.env.VLLM_BASE_URL ?? "http://127.0.0.1:8000/v1",
        "openai-completions",
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
  for (const provider of STATIC_PROVIDERS) {
    const baseUrl =
      provider.name === "cloudflare-ai-gateway"
        ? (process.env.CLOUDFLARE_AI_GATEWAY_BASE_URL ??
          "https://gateway.ai.cloudflare.com/v1/<account>/<gateway>/anthropic")
        : undefined;

    api.registerProvider(provider.name, {
      ...(baseUrl ? { baseUrl } : {}),
      apiKey: provider.apiKey,
      models: provider.models.map((entry) => ({
        ...entry,
        ...(baseUrl ? { baseUrl } : {}),
      })),
    });
  }

  const discovered = await Promise.all(
    LOCAL_PROVIDERS.map(async (provider) => {
      const models = await provider.discover();
      return { provider, models };
    }),
  );

  for (const { provider, models } of discovered) {
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
  const timeout = setTimeout(() => controller.abort(), 750);

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
  provider: string,
  baseUrl: string,
  api: ModelApi,
): Promise<OmniProviderModel[]> {
  const normalizedBaseUrl = baseUrl.endsWith("/")
    ? baseUrl.slice(0, -1)
    : baseUrl;
  const headerKey = apiKeyEnvForProvider(provider);
  const headerValue = headerKey ? process.env[headerKey] : undefined;
  const payload = (await fetchJson(`${normalizedBaseUrl}/models`, {
    headers: headerValue
      ? {
          Authorization: `Bearer ${headerValue}`,
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

function apiKeyEnvForProvider(provider: string): string | undefined {
  switch (provider) {
    case "lm-studio":
      return "LM_STUDIO_API_KEY";
    case "llama.cpp":
      return "LLAMA_CPP_API_KEY";
    case "litellm":
      return "LITELLM_API_KEY";
    case "vllm":
      return "VLLM_API_KEY";
    default:
      return undefined;
  }
}
