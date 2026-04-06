import { describe, expect, test, vi } from "vitest";

import {
  disableAnthropicOAuth,
  disableAnthropicOAuthInAuthStorage,
} from "../src/anthropic-auth-guard.js";

describe("anthropic auth guard", () => {
  test("hides anthropic from oauth provider selection", () => {
    const authStorage = {
      getOAuthProviders() {
        return [
          { id: "anthropic", name: "Anthropic" },
          { id: "openai-codex", name: "OpenAI Codex" },
        ];
      },
    };
    const modelRegistry = {
      authStorage,
      refresh() {},
    };

    disableAnthropicOAuth(modelRegistry);

    expect(authStorage.getOAuthProviders()).toEqual([
      { id: "openai-codex", name: "OpenAI Codex" },
    ]);
  });

  test("keeps anthropic limited to api keys in auth storage", async () => {
    const originalApiKey = process.env.ANTHROPIC_API_KEY;
    const originalOauthToken = process.env.ANTHROPIC_OAUTH_TOKEN;

    process.env.ANTHROPIC_API_KEY = "";
    process.env.ANTHROPIC_OAUTH_TOKEN = "oauth-token-that-should-be-ignored";

    try {
      const authStorage = {
        get(provider: string) {
          if (provider === "anthropic") {
            return { type: "oauth" as const };
          }
          return undefined;
        },
        getOAuthProviders() {
          return [{ id: "anthropic", name: "Anthropic" }];
        },
        getApiKey: vi.fn(async () => "fallback"),
        hasAuth: vi.fn(() => true),
        login: vi.fn(async () => {}),
      };

      disableAnthropicOAuthInAuthStorage(authStorage);

      await expect(authStorage.getApiKey("anthropic")).resolves.toBeUndefined();
      expect(authStorage.hasAuth("anthropic")).toBe(false);
      expect(authStorage.getOAuthProviders()).toEqual([]);
      await expect(authStorage.login("anthropic", {})).rejects.toThrow(
        "Anthropic OAuth login is disabled in Omni-Pi. Use an Anthropic API key instead.",
      );
    } finally {
      if (originalApiKey === undefined) {
        delete process.env.ANTHROPIC_API_KEY;
      } else {
        process.env.ANTHROPIC_API_KEY = originalApiKey;
      }

      if (originalOauthToken === undefined) {
        delete process.env.ANTHROPIC_OAUTH_TOKEN;
      } else {
        process.env.ANTHROPIC_OAUTH_TOKEN = originalOauthToken;
      }
    }
  });

  test("re-runs the oauth removal after model registry refreshes", () => {
    const refresh = vi.fn();
    const authStorage = {
      getOAuthProviders() {
        return [
          { id: "anthropic", name: "Anthropic" },
          { id: "github-copilot", name: "GitHub Copilot" },
        ];
      },
    };
    const modelRegistry = {
      authStorage,
      refresh,
    };

    disableAnthropicOAuth(modelRegistry);
    modelRegistry.refresh();

    expect(refresh).toHaveBeenCalledTimes(1);
    expect(authStorage.getOAuthProviders()).toEqual([
      { id: "github-copilot", name: "GitHub Copilot" },
    ]);
  });
});
