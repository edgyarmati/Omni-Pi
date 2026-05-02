import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, test } from "vitest";
import {
  cleanAgentsSettings,
  projectOmniSettingsPath,
  readEffectiveOmniAgentsSettings,
  syncOmniSubagentRuntimeConfig,
  writeOmniAgentsSettings,
} from "../src/agent-settings.js";

async function tempDir(prefix: string): Promise<string> {
  return mkdtemp(path.join(os.tmpdir(), prefix));
}

describe("Omni optional agent settings", () => {
  test("defaults to disabled with no configured models", async () => {
    const rootDir = await tempDir("omni-agent-settings-root-");
    const homeDir = await tempDir("omni-agent-settings-home-");

    await expect(
      readEffectiveOmniAgentsSettings(rootDir, { homeDir }),
    ).resolves.toEqual({ enabled: false, models: {} });
  });

  test("merges global settings with project override", async () => {
    const rootDir = await tempDir("omni-agent-settings-root-");
    const homeDir = await tempDir("omni-agent-settings-home-");
    await writeOmniAgentsSettings(
      path.join(homeDir, ".omnicode", "settings.json"),
      {
        enabled: true,
        defaultModel: "openai/gpt-5-mini",
        models: { "omni-explorer": "opencode/nemotron" },
      },
    );
    await writeOmniAgentsSettings(projectOmniSettingsPath(rootDir), {
      enabled: false,
      models: {
        "omni-planner": { model: "openai/gpt-5.5", reasoningEffort: "high" },
      },
    });

    await expect(
      readEffectiveOmniAgentsSettings(rootDir, { homeDir }),
    ).resolves.toEqual({
      enabled: false,
      defaultModel: "openai/gpt-5-mini",
      models: {
        "omni-explorer": "opencode/nemotron",
        "omni-planner": { model: "openai/gpt-5.5", reasoningEffort: "high" },
      },
    });
  });

  test("cleans unknown and stale writer roles", async () => {
    expect(
      cleanAgentsSettings({
        enabled: true,
        models: {
          "omni-explorer": "model/a",
          "omni-worker": "model/b",
          worker: "model/c",
        },
      }),
    ).toEqual({
      enabled: true,
      models: { "omni-explorer": "model/a" },
    });
  });

  test("settings writes persist only cleaned agents values", async () => {
    const rootDir = await tempDir("omni-agent-settings-root-");
    const settingsPath = projectOmniSettingsPath(rootDir);
    await writeOmniAgentsSettings(settingsPath, {
      enabled: true,
      models: {
        "omni-verifier": "model/v",
        "omni-worker": "model/w",
      } as never,
    });

    const raw = JSON.parse(await readFile(settingsPath, "utf8")) as {
      agents: { models: Record<string, unknown> };
    };
    expect(raw.agents.models).toEqual({ "omni-verifier": "model/v" });
  });

  test("runtime sync exposes only Omni read-only roles when enabled", async () => {
    const rootDir = await tempDir("omni-agent-sync-root-");
    await mkdir(path.join(rootDir, ".pi"), { recursive: true });
    await writeFile(
      path.join(rootDir, ".pi", "settings.json"),
      JSON.stringify({
        subagents: { agentOverrides: { reviewer: { disabled: true } } },
      }),
    );
    await writeOmniAgentsSettings(projectOmniSettingsPath(rootDir), {
      enabled: true,
      defaultModel: "openai/gpt-5-mini",
      models: {
        "omni-explorer": "openai/gpt-5-mini",
        "omni-planner": "openai/gpt-5.5",
      },
    });

    await syncOmniSubagentRuntimeConfig(rootDir);

    const explorer = await readFile(
      path.join(rootDir, ".pi", "agents", "omni-explorer.md"),
      "utf8",
    );
    const settings = JSON.parse(
      await readFile(path.join(rootDir, ".pi", "settings.json"), "utf8"),
    ) as { subagents: { disableBuiltins: boolean } };

    expect(explorer).toContain("name: omni-explorer");
    expect(explorer).toContain("model: openai/gpt-5-mini");
    await expect(
      readFile(path.join(rootDir, ".pi", "agents", "omni-planner.md"), "utf8"),
    ).resolves.toContain("model: openai/gpt-5.5");
    expect(explorer).toContain("Never edit files");
    expect(settings.subagents.disableBuiltins).toBe(true);
    expect(settings.subagents).toMatchObject({
      agentOverrides: { reviewer: { disabled: true } },
    });
  });

  test("runtime sync gitignores project omnicode settings in git repos", async () => {
    const rootDir = await tempDir("omni-agent-sync-root-");
    await mkdir(path.join(rootDir, ".git"));
    await writeOmniAgentsSettings(projectOmniSettingsPath(rootDir), {
      enabled: true,
    });

    await syncOmniSubagentRuntimeConfig(rootDir);

    await expect(
      readFile(path.join(rootDir, ".gitignore"), "utf8"),
    ).resolves.toContain(".omnicode/");
  });

  test("runtime sync removes Omni roles when disabled", async () => {
    const rootDir = await tempDir("omni-agent-sync-root-");
    await writeOmniAgentsSettings(projectOmniSettingsPath(rootDir), {
      enabled: true,
    });
    await syncOmniSubagentRuntimeConfig(rootDir);
    await writeOmniAgentsSettings(projectOmniSettingsPath(rootDir), {
      enabled: false,
    });

    await syncOmniSubagentRuntimeConfig(rootDir);

    await expect(
      readFile(path.join(rootDir, ".pi", "agents", "omni-explorer.md"), "utf8"),
    ).rejects.toThrow();
  });
});
