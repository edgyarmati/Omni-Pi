import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, test } from "vitest";
import omniCoreExtension from "../extensions/omni-core/index.js";
import omniProvidersExtension from "../extensions/omni-providers/index.js";
import omniSkillsExtension from "../extensions/omni-skills/index.js";
import omniStatusExtension from "../extensions/omni-status/index.js";
import {
  createOmniCommands,
  resetRuntimeBrowserCustomModelSetupRunnerForTests,
  resetRuntimeBrowserModelSelectionRunnerForTests,
  setRuntimeBrowserCustomModelSetupRunnerForTests,
  setRuntimeBrowserModelSelectionRunnerForTests,
} from "../src/commands.js";
import { initializeOmniProject } from "../src/workflow.js";

async function createTempProject(prefix: string): Promise<string> {
  return mkdtemp(path.join(os.tmpdir(), prefix));
}

function createModelRuntime(options: {
  available?: Array<{ provider: string; id: string }>;
  all?: Array<{ provider: string; id: string }>;
  onSetAuth?: (provider: string, key: string) => void;
  ui: {
    select(title: string, options: string[]): Promise<string | undefined>;
    input(title: string, placeholder?: string): Promise<string | undefined>;
    confirm(title: string, message: string): Promise<boolean>;
  };
}) {
  let authProviders = new Set(
    (options.available ?? []).map((entry) => entry.provider),
  );
  const allModels = options.all ?? options.available ?? [];

  return {
    pi: {} as never,
    ctx: {
      ui: {
        select: options.ui.select,
        input: options.ui.input,
        confirm: options.ui.confirm,
      },
      modelRegistry: {
        getAvailable() {
          return allModels.filter((entry) => authProviders.has(entry.provider));
        },
        getAll() {
          return allModels;
        },
        refresh() {
          return undefined;
        },
        authStorage: {
          set(provider: string, credential: { type: "api_key"; key: string }) {
            authProviders = new Set(authProviders).add(provider);
            options.onSetAuth?.(provider, credential.key);
          },
          getOAuthProviders() {
            return [];
          },
        },
      },
    } as never,
  };
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
      "add-custom-model",
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
      "add-custom-model",
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

  test("omniProvidersExtension does not register extra providers beyond Pi defaults", async () => {
    const registrations: string[] = [];

    await omniProvidersExtension({
      registerProvider(name: string) {
        registrations.push(name);
      },
    } as never);

    expect(registrations).toEqual([]);
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

  test("/omni-model uses terminal search to assign an authenticated model", async () => {
    const rootDir = await createTempProject("omni-cmd-model-");
    await initializeOmniProject(rootDir);
    const command = createOmniCommands().find(
      (item) => item.name === "omni-model",
    );
    const seenSelections: string[][] = [];

    const output = await command?.execute({
      cwd: rootDir,
      runtime: createModelRuntime({
        available: [{ provider: "openai", id: "gpt-5.4" }],
        all: [
          { provider: "openai", id: "gpt-5.4" },
          { provider: "openai", id: "gpt-4.1" },
        ],
        ui: {
          async select(_title: string, options: string[]) {
            seenSelections.push(options);
            if (options.includes("worker")) {
              return "worker";
            }
            if (options.includes("Use terminal search")) {
              return "Use terminal search";
            }
            return "openai/gpt-5.4";
          },
          async input() {
            return "gpt-5.4";
          },
          async confirm() {
            return false;
          },
        },
      }),
    });

    const config = await readFile(
      path.join(rootDir, ".omni", "CONFIG.md"),
      "utf8",
    );

    expect(output).toContain("openai/gpt-5.4");
    expect(config).toContain("openai/gpt-5.4");
    expect(seenSelections[1]).toEqual([
      "Use terminal search",
      "Open browser view",
    ]);
    expect(seenSelections[2]).toContain("Open browser view");
  });

  test("/omni-model only lists authenticated models by default", async () => {
    const rootDir = await createTempProject("omni-cmd-model-auth-");
    await initializeOmniProject(rootDir);
    const command = createOmniCommands().find(
      (item) => item.name === "omni-model",
    );
    const seenSelections: string[][] = [];

    const output = await command?.execute({
      cwd: rootDir,
      runtime: createModelRuntime({
        available: [{ provider: "openai", id: "gpt-5.4" }],
        all: [
          { provider: "openai", id: "gpt-5.4" },
          { provider: "anthropic", id: "claude-sonnet-4-6" },
        ],
        ui: {
          async select(_title: string, options: string[]) {
            seenSelections.push(options);
            if (options.includes("worker")) {
              return "worker";
            }
            if (options.includes("Use terminal search")) {
              return "Use terminal search";
            }
            return "openai/gpt-5.4";
          },
          async input() {
            return "gpt";
          },
          async confirm() {
            return false;
          },
        },
      }),
    });

    expect(output).toContain("openai/gpt-5.4");
    expect(seenSelections[2]).toContain("openai/gpt-5.4 (current)");
    expect(seenSelections[2]).not.toContain("anthropic/claude-sonnet-4-6");
    expect(seenSelections[2]).toContain("Open browser view");
  });

  test("/omni-model can hand off selection to the browser flow", async () => {
    const rootDir = await createTempProject("omni-cmd-model-setup-");
    await initializeOmniProject(rootDir);
    const command = createOmniCommands().find(
      (item) => item.name === "omni-model",
    );
    setRuntimeBrowserModelSelectionRunnerForTests(
      async (_runtime, role, currentModel, models) => {
        expect(role).toBe("worker");
        expect(currentModel).toBe("openai/gpt-5.4");
        expect(models).toContain("openai/gpt-5.4");
        return {
          selectedModel: "openai/gpt-4.1",
          summary: "Selected openai/gpt-4.1 for worker.",
        };
      },
    );

    try {
      const output = await command?.execute({
        cwd: rootDir,
        runtime: createModelRuntime({
          available: [
            { provider: "openai", id: "gpt-5.4" },
            { provider: "openai", id: "gpt-4.1" },
          ],
          all: [
            { provider: "openai", id: "gpt-5.4" },
            { provider: "openai", id: "gpt-4.1" },
          ],
          ui: {
            async select(_title: string, options: string[]) {
              if (options.includes("worker")) {
                return "worker";
              }
              return "Open browser view";
            },
            async input() {
              return undefined;
            },
            async confirm() {
              return false;
            },
          },
        }),
      });

      const config = await readFile(
        path.join(rootDir, ".omni", "CONFIG.md"),
        "utf8",
      );

      expect(output).toContain("openai/gpt-4.1");
      expect(config).toContain("openai/gpt-4.1");
    } finally {
      resetRuntimeBrowserModelSelectionRunnerForTests();
    }
  });

  test("/add-custom-model can use the browser setup flow", async () => {
    const command = createOmniCommands().find(
      (item) => item.name === "add-custom-model",
    );
    setRuntimeBrowserCustomModelSetupRunnerForTests(async () => ({
      selectedModel: "my-proxy/gpt-oss-120b",
      summary: "Saved custom provider model my-proxy/gpt-oss-120b.",
    }));

    try {
      const output = await command?.execute({
        cwd: await createTempProject("omni-cmd-add-custom-browser-"),
        runtime: createModelRuntime({
          ui: {
            async select() {
              return "Open browser view";
            },
            async input() {
              return undefined;
            },
            async confirm() {
              return false;
            },
          },
        }),
      });

      expect(output).toContain("my-proxy/gpt-oss-120b");
    } finally {
      resetRuntimeBrowserCustomModelSetupRunnerForTests();
    }
  });
});
