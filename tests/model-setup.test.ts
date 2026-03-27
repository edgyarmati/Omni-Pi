import { describe, expect, test } from "vitest";

import {
  type BrowserCustomModelSubmission,
  buildCustomProviderConfigUpdate,
  buildDiscoveredProviderConfigUpdate,
  type ModelsJsonProviderConfig,
  refreshConfiguredProviderModels,
} from "../src/model-setup.js";
import type { OmniProviderModel } from "../src/providers.js";

describe("model setup config updates", () => {
  test("preserves existing model metadata and dynamic headers when updating a custom model", () => {
    const current: ModelsJsonProviderConfig = {
      baseUrl: "https://old.example.com/v1",
      api: "openai-responses",
      apiKey: "EXISTING_API_KEY",
      headers: {
        "x-provider-header": "!security find-generic-password -w -s omni",
      },
      authHeader: true,
      models: [
        {
          id: "custom-model",
          name: "Custom Model",
          reasoning: false,
          input: ["text"],
          contextWindow: 64000,
          maxTokens: 8192,
          headers: {
            "x-model-header": "!printf dynamic-token",
          },
          compat: {
            supportsDeveloperRole: true,
          },
        },
      ],
    };

    const submission: BrowserCustomModelSubmission = {
      providerId: "my-proxy",
      modelId: "custom-model",
      api: "openai-responses",
      baseUrl: "https://new.example.com/v1/",
      apiKey: "",
      reasoning: true,
      imageInput: true,
    };

    const updated = buildCustomProviderConfigUpdate(
      current,
      "my-proxy",
      submission,
    );

    expect(updated.baseUrl).toBe("https://new.example.com/v1");
    expect(updated.api).toBe("openai-responses");
    expect(updated.apiKey).toBe("EXISTING_API_KEY");
    expect(updated.headers).toEqual(current.headers);
    expect(updated.authHeader).toBe(true);
    expect(updated.models).toEqual([
      {
        id: "custom-model",
        name: "Custom Model",
        reasoning: true,
        input: ["text", "image"],
        contextWindow: 64000,
        maxTokens: 8192,
        headers: {
          "x-model-header": "!printf dynamic-token",
        },
        compat: {
          supportsDeveloperRole: true,
        },
      },
    ]);
  });

  test("replaces provider models from discovery while preserving existing per-model metadata", () => {
    const current: ModelsJsonProviderConfig = {
      baseUrl: "https://old.example.com/v1",
      api: "openai-responses",
      apiKey: "EXISTING_API_KEY",
      headers: {
        "x-provider-header": "!security find-generic-password -w -s omni",
      },
      authHeader: true,
      models: [
        {
          id: "gpt-4.1",
          name: "Pinned GPT 4.1",
          reasoning: false,
          input: ["text"],
          contextWindow: 32000,
          maxTokens: 4096,
          headers: {
            "x-model-header": "!printf dynamic-token",
          },
          compat: {
            supportsDeveloperRole: true,
          },
        },
      ],
    };

    const discovered: OmniProviderModel[] = [
      {
        id: "gpt-4.1",
        name: "GPT-4.1",
        api: "openai-responses",
        reasoning: true,
        input: ["text", "image"],
        cost: {
          input: 0,
          output: 0,
          cacheRead: 0,
          cacheWrite: 0,
        },
        contextWindow: 128000,
        maxTokens: 16384,
      },
      {
        id: "gpt-4o-mini",
        name: "GPT-4o mini",
        api: "openai-responses",
        reasoning: false,
        input: ["text"],
        cost: {
          input: 0,
          output: 0,
          cacheRead: 0,
          cacheWrite: 0,
        },
        contextWindow: 128000,
        maxTokens: 16384,
      },
    ];

    const updated = buildDiscoveredProviderConfigUpdate(
      current,
      "my-proxy",
      {
        providerId: "my-proxy",
        api: "openai-responses",
        baseUrl: "https://new.example.com/v1/",
        apiKey: "",
      },
      discovered,
    );

    expect(updated.baseUrl).toBe("https://new.example.com/v1");
    expect(updated.apiKey).toBe("EXISTING_API_KEY");
    expect(updated.headers).toEqual(current.headers);
    expect(updated.models).toEqual([
      {
        id: "gpt-4.1",
        name: "Pinned GPT 4.1",
        reasoning: true,
        input: ["text", "image"],
        cost: {
          input: 0,
          output: 0,
          cacheRead: 0,
          cacheWrite: 0,
        },
        contextWindow: 128000,
        maxTokens: 16384,
        headers: {
          "x-model-header": "!printf dynamic-token",
        },
        compat: {
          supportsDeveloperRole: true,
        },
      },
      {
        id: "gpt-4o-mini",
        name: "GPT-4o mini",
        reasoning: false,
        input: ["text"],
        cost: {
          input: 0,
          output: 0,
          cacheRead: 0,
          cacheWrite: 0,
        },
        contextWindow: 128000,
        maxTokens: 16384,
      },
    ]);
  });

  test("omits invalid discovered token limits instead of persisting zeroes", () => {
    const updated = buildDiscoveredProviderConfigUpdate(
      {
        baseUrl: "https://old.example.com/v1",
        api: "openai-completions",
        apiKey: "EXISTING_API_KEY",
      },
      "nvidia-nim",
      {
        providerId: "nvidia-nim",
        api: "openai-completions",
        baseUrl: "https://integrate.api.nvidia.com/v1",
        apiKey: "",
      },
      [
        {
          id: "moonshotai/kimi-k2.5",
          name: "moonshotai/kimi-k2.5",
          api: "openai-completions",
          reasoning: true,
          input: ["text"],
          cost: {
            input: 0,
            output: 0,
            cacheRead: 0,
            cacheWrite: 0,
          },
          contextWindow: 0,
          maxTokens: 0,
        },
      ],
    );

    expect(updated.models).toEqual([
      {
        id: "moonshotai/kimi-k2.5",
        name: "moonshotai/kimi-k2.5",
        reasoning: true,
        input: ["text"],
        cost: {
          input: 0,
          output: 0,
          cacheRead: 0,
          cacheWrite: 0,
        },
      },
    ]);
  });

  test("refreshes only authenticated discoverable providers without persisting resolved auth storage keys", async () => {
    const refreshed = await refreshConfiguredProviderModels(
      {
        providers: {
          "custom-openai": {
            api: "openai-completions",
            baseUrl: "https://api.example.com/v1",
            models: [
              {
                id: "old-model",
                name: "Old Model",
                headers: {
                  "x-model-header": "!printf dynamic-token",
                },
              },
            ],
          },
          "no-auth-provider": {
            api: "openai-completions",
            baseUrl: "https://no-auth.example.com/v1",
            models: [
              {
                id: "stale-model",
              },
            ],
          },
        },
      },
      {
        hasAuth(provider) {
          return provider === "custom-openai";
        },
        async getApiKey(provider) {
          return provider === "custom-openai" ? "AUTH_STORAGE_KEY" : undefined;
        },
        set() {},
      },
      async (api, baseUrl, apiKey) => {
        expect(api).toBe("openai-completions");
        expect(baseUrl).toBe("https://api.example.com/v1");
        expect(apiKey).toBe("AUTH_STORAGE_KEY");

        return [
          {
            id: "fresh-model",
            name: "Fresh Model",
            api: "openai-completions",
            reasoning: true,
            input: ["text"],
            cost: {
              input: 0,
              output: 0,
              cacheRead: 0,
              cacheWrite: 0,
            },
            contextWindow: 128000,
            maxTokens: 16384,
          },
        ] satisfies OmniProviderModel[];
      },
    );

    expect(refreshed.refreshedProviders).toEqual(["custom-openai"]);
    expect(refreshed.config.providers).toEqual({
      "custom-openai": {
        api: "openai-completions",
        baseUrl: "https://api.example.com/v1",
        models: [
          {
            id: "fresh-model",
            name: "Fresh Model",
            reasoning: true,
            input: ["text"],
            cost: {
              input: 0,
              output: 0,
              cacheRead: 0,
              cacheWrite: 0,
            },
            contextWindow: 128000,
            maxTokens: 16384,
          },
        ],
      },
      "no-auth-provider": {
        api: "openai-completions",
        baseUrl: "https://no-auth.example.com/v1",
        models: [
          {
            id: "stale-model",
          },
        ],
      },
    });
  });
});
