import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, test } from "vitest";
import omniCoreExtension from "../extensions/omni-core/index.js";
import omniProvidersExtension from "../extensions/omni-providers/index.js";
import omniSkillsExtension from "../extensions/omni-skills/index.js";
import omniStatusExtension from "../extensions/omni-status/index.js";
import { createOmniCommands } from "../src/commands.js";
import { initializeOmniProject } from "../src/workflow.js";

async function createTempProject(prefix: string): Promise<string> {
  return mkdtemp(path.join(os.tmpdir(), prefix));
}

describe("Omni commands", () => {
  test("createOmniCommands exposes the expected command set", () => {
    const names = createOmniCommands().map((command) => command.name);

    expect(names).toEqual([
      "omni-init",
      "omni-plan",
      "omni-work",
      "omni-status",
      "omni-sync",
      "omni-skills",
      "omni-explain",
      "omni-model",
      "omni-commit",
      "omni-doctor",
    ]);
  });

  test("omniCoreExtension registers the workflow commands", () => {
    const registrations: string[] = [];

    omniCoreExtension({
      registerMessageRenderer() {
        return undefined;
      },
      registerCommand(name: string, _options: { description: string }) {
        registrations.push(name);
      },
    } as never);

    expect(registrations).toEqual([
      "omni-init",
      "omni-plan",
      "omni-work",
      "omni-sync",
      "omni-model",
      "omni-commit",
    ]);
  });

  test("omniStatusExtension registers the status commands", () => {
    const registrations: string[] = [];

    omniStatusExtension({
      registerCommand(name: string, _options: { description: string }) {
        registrations.push(name);
      },
    } as never);

    expect(registrations).toEqual([
      "omni-status",
      "omni-explain",
      "omni-doctor",
    ]);
  });

  test("omniSkillsExtension registers the skills command", () => {
    const registrations: string[] = [];

    omniSkillsExtension({
      registerCommand(name: string, _options: { description: string }) {
        registrations.push(name);
      },
    } as never);

    expect(registrations).toEqual(["omni-skills"]);
  });

  test("omniProvidersExtension registers missing upstream providers", async () => {
    const registrations: string[] = [];
    const providerConfigs = new Map<string, { baseUrl?: string }>();
    const originalFetch = globalThis.fetch;
    const originalXiaomiBaseUrl = process.env.XIAOMI_BASE_URL;
    const originalGitlabDuoBaseUrl = process.env.GITLAB_DUO_BASE_URL;

    globalThis.fetch = (async () => {
      throw new Error("offline");
    }) as typeof fetch;

    try {
      process.env.XIAOMI_BASE_URL = "https://api.xiaomi.example/anthropic";
      process.env.GITLAB_DUO_BASE_URL = "https://gitlab.example/api/v4/chat";

      await omniProvidersExtension({
        registerProvider(name: string, config: { baseUrl?: string }) {
          registrations.push(name);
          providerConfigs.set(name, config);
        },
      } as never);
    } finally {
      globalThis.fetch = originalFetch;
      if (originalXiaomiBaseUrl === undefined) {
        delete process.env.XIAOMI_BASE_URL;
      } else {
        process.env.XIAOMI_BASE_URL = originalXiaomiBaseUrl;
      }
      if (originalGitlabDuoBaseUrl === undefined) {
        delete process.env.GITLAB_DUO_BASE_URL;
      } else {
        process.env.GITLAB_DUO_BASE_URL = originalGitlabDuoBaseUrl;
      }
    }

    expect(registrations).toContain("nvidia");
    expect(registrations).toContain("together");
    expect(registrations).toContain("moonshot");
    expect(registrations).toContain("gitlab-duo");
    expect(registrations).toContain("cloudflare-ai-gateway");
    expect(registrations).not.toContain("ollama");
    expect(providerConfigs.get("nvidia")?.baseUrl).toBe(
      "https://integrate.api.nvidia.com/v1",
    );
    expect(providerConfigs.get("qianfan")?.baseUrl).toBe(
      "https://qianfan.baidubce.com/v2",
    );
  });

  test("/omni-skills renders the current skill registry", async () => {
    const rootDir = await createTempProject("omni-cmd-skills-");
    await initializeOmniProject(rootDir);
    const command = createOmniCommands().find(
      (item) => item.name === "omni-skills",
    );

    const output = await command?.execute({ cwd: rootDir });

    expect(output).toContain("Installed:");
    expect(output).toContain("find-skills");
    expect(output).toContain("Recommended:");
  });

  test("/omni-sync updates session summary", async () => {
    const rootDir = await createTempProject("omni-cmd-sync-");
    await initializeOmniProject(rootDir);
    const command = createOmniCommands().find(
      (item) => item.name === "omni-sync",
    );

    const output = await command?.execute({
      cwd: rootDir,
      args: ["Captured", "progress"],
    });
    const sessionSummary = await readFile(
      path.join(rootDir, ".omni", "SESSION-SUMMARY.md"),
      "utf8",
    );

    expect(output).toContain("Synced Omni-Pi memory");
    expect(sessionSummary).toContain("Captured progress");
  });

  test("/omni-model accepts a custom provider/model reference", async () => {
    const rootDir = await createTempProject("omni-cmd-model-");
    await initializeOmniProject(rootDir);
    const command = createOmniCommands().find(
      (item) => item.name === "omni-model",
    );

    const output = await command?.execute({
      cwd: rootDir,
      runtime: {
        pi: {} as never,
        ctx: {
          ui: {
            async select(_title: string, options: string[]) {
              if (options.includes("worker")) {
                return "worker";
              }
              return "Enter custom provider/model";
            },
            async input() {
              return "openrouter/anthropic/claude-sonnet-4";
            },
          },
        } as never,
      },
    });

    const config = await readFile(
      path.join(rootDir, ".omni", "CONFIG.md"),
      "utf8",
    );

    expect(output).toContain("openrouter/anthropic/claude-sonnet-4");
    expect(config).toContain("openrouter/anthropic/claude-sonnet-4");
  });
});
