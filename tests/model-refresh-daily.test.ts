import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { getAgentDir } from "@mariozechner/pi-coding-agent";
import { describe, expect, test, vi } from "vitest";

const mock = vi.hoisted(() => ({
  agentDir: "",
}));

vi.mock("@mariozechner/pi-coding-agent", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@mariozechner/pi-coding-agent")>();
  return {
    ...actual,
    getAgentDir: () => mock.agentDir || actual.getAgentDir(),
  };
});

vi.mock("../src/providers.js", () => ({
  discoverProviderModels: vi.fn(),
}));

import { refreshAuthenticatedProviderModelsWithDailyGuard } from "../src/model-setup.js";
import { discoverProviderModels } from "../src/providers.js";

function getModelsPath(): string {
  return path.join(getAgentDir(), "models.json");
}

describe("daily custom-provider refresh", () => {
  test("refreshes once per day and skips subsequent launches", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "omni-refresh-daily-"));
    mock.agentDir = dir;

    await writeFile(
      getModelsPath(),
      JSON.stringify(
        {
          providers: {
            "custom-openai": {
              api: "openai-completions",
              baseUrl: "https://api.example.com/v1",
              apiKey: "KEY",
              models: [{ id: "old-model" }],
            },
          },
        },
        null,
        2,
      ),
      "utf8",
    );

    vi.mocked(discoverProviderModels).mockResolvedValue([
      {
        id: "fresh-model",
        name: "Fresh Model",
        api: "openai-completions",
        reasoning: false,
        input: ["text"],
        cost: {
          input: 0,
          output: 0,
          cacheRead: 0,
          cacheWrite: 0,
        },
        contextWindow: 128000,
        maxTokens: 4096,
      },
    ]);

    const modelRegistry = {
      authStorage: {
        hasAuth(provider: string) {
          return provider === "custom-openai";
        },
        async getApiKey(provider: string) {
          return provider === "custom-openai" ? "KEY" : undefined;
        },
        get() {
          return { type: "api_key" as const, key: "KEY" };
        },
        set() {},
      },
      refresh: vi.fn(),
    };

    const first = await refreshAuthenticatedProviderModelsWithDailyGuard(
      modelRegistry as never,
      { now: new Date(2026, 3, 17, 8, 0, 0) },
    );

    expect(first).toEqual({
      refreshedProviders: ["custom-openai"],
      skipped: false,
    });
    expect(modelRegistry.refresh).toHaveBeenCalledTimes(1);

    const saved = JSON.parse(await readFile(getModelsPath(), "utf8")) as {
      providers: Record<string, { models: Array<{ id: string }> }>;
    };
    expect(saved.providers["custom-openai"].models).toEqual([
      {
        id: "fresh-model",
        name: "Fresh Model",
        reasoning: false,
        input: ["text"],
        cost: {
          input: 0,
          output: 0,
          cacheRead: 0,
          cacheWrite: 0,
        },
        contextWindow: 128000,
        maxTokens: 4096,
      },
    ]);

    const refreshStatePath = path.join(dir, "model-refresh-state.json");
    const refreshState = JSON.parse(
      await readFile(refreshStatePath, "utf8"),
    ) as { lastSuccessfulRefreshDate: string };
    expect(refreshState.lastSuccessfulRefreshDate).toBe("2026-04-17");

    const second = await refreshAuthenticatedProviderModelsWithDailyGuard(
      modelRegistry as never,
      { now: new Date(2026, 3, 17, 18, 0, 0) },
    );

    expect(second).toEqual({ refreshedProviders: [], skipped: true });
    expect(modelRegistry.refresh).toHaveBeenCalledTimes(1);
  });

  test("keeps successful refreshes even if one provider discovery fails", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "omni-refresh-failure-"));
    mock.agentDir = dir;

    await writeFile(
      getModelsPath(),
      JSON.stringify(
        {
          providers: {
            "good-provider": {
              api: "openai-completions",
              baseUrl: "https://good.example.com/v1",
              apiKey: "GOOD",
              models: [{ id: "old-good" }],
            },
            "bad-provider": {
              api: "openai-completions",
              baseUrl: "https://bad.example.com/v1",
              apiKey: "BAD",
              models: [{ id: "old-bad" }],
            },
          },
        },
        null,
        2,
      ),
      "utf8",
    );

    vi.mocked(discoverProviderModels).mockImplementation(
      async (_api, baseUrl) => {
        if (baseUrl.includes("good")) {
          return [
            {
              id: "good-model",
              name: "Good Model",
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
              maxTokens: 4096,
            },
          ];
        }

        throw new Error("boom");
      },
    );

    const modelRegistry = {
      authStorage: {
        hasAuth(provider: string) {
          return provider === "good-provider" || provider === "bad-provider";
        },
        async getApiKey(provider: string) {
          return provider === "good-provider" ? "GOOD" : "BAD";
        },
        get() {
          return { type: "api_key" as const, key: "GOOD" };
        },
        set() {},
      },
      refresh: vi.fn(),
    };

    const result = await refreshAuthenticatedProviderModelsWithDailyGuard(
      modelRegistry as never,
      { now: new Date(2026, 3, 17, 9, 0, 0) },
    );

    expect(result).toEqual({
      refreshedProviders: ["good-provider"],
      skipped: false,
    });
    expect(modelRegistry.refresh).toHaveBeenCalledTimes(1);

    const saved = JSON.parse(await readFile(getModelsPath(), "utf8")) as {
      providers: Record<string, { models: Array<{ id: string }> }>;
    };
    expect(saved.providers["good-provider"].models).toEqual([
      {
        id: "good-model",
        name: "Good Model",
        reasoning: true,
        input: ["text"],
        cost: {
          input: 0,
          output: 0,
          cacheRead: 0,
          cacheWrite: 0,
        },
        contextWindow: 128000,
        maxTokens: 4096,
      },
    ]);
    expect(saved.providers["bad-provider"].models).toEqual([{ id: "old-bad" }]);
  });
});
