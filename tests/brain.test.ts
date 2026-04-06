import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, test } from "vitest";
import omniCoreExtension from "../extensions/omni-core/index.js";
import {
  buildBrainSystemPromptSuffix,
  buildPassiveOmniPromptSuffix,
  ensureOmniReady,
} from "../src/brain.js";
import { saveOmniMode } from "../src/theme.js";

async function createTempProject(prefix: string): Promise<string> {
  return mkdtemp(path.join(os.tmpdir(), prefix));
}

describe("Omni brain runtime", () => {
  test("ensureOmniReady bootstraps .omni when omni mode is enabled", async () => {
    const rootDir = await createTempProject("omni-brain-init-");

    const result = await ensureOmniReady(rootDir);
    const state = await readFile(
      path.join(rootDir, ".omni", "STATE.md"),
      "utf8",
    );

    expect(result.status).toBe("initialized");
    expect(state).toContain("Run onboarding interview");
  });

  test("buildBrainSystemPromptSuffix includes the single-brain workflow and durable files", async () => {
    const rootDir = await createTempProject("omni-brain-prompt-");
    await ensureOmniReady(rootDir);

    const prompt = await buildBrainSystemPromptSuffix(rootDir);

    expect(prompt).toContain("Omni-Pi Single-Brain Mode");
    expect(prompt).toContain("Interview the user until the requested behavior");
    expect(prompt).toContain(
      "use the interview tool to ask targeted clarification questions instead of asking them in chat",
    );
    expect(prompt).toContain(
      "treat direct user instructions as requested Omni app/product behavior by default",
    );
    expect(prompt).toContain(".omni/TASKS.md");
    expect(prompt).toContain("Run onboarding interview");
  });

  test("buildPassiveOmniPromptSuffix excludes workflow files and keeps durable guidance", async () => {
    const rootDir = await createTempProject("omni-brain-passive-");
    await ensureOmniReady(rootDir);

    const prompt = await buildPassiveOmniPromptSuffix(rootDir);

    expect(prompt).toContain("Omni Durable Standards");
    expect(prompt).toContain(".omni/PROJECT.md");
    expect(prompt).not.toContain("### .omni/TASKS.md");
    expect(prompt).not.toContain("### .omni/TESTS.md");
  });

  test("omniCoreExtension leaves omni init off by default and only injects passive prompt", async () => {
    const rootDir = await createTempProject("omni-brain-ext-");
    const handlers = new Map<string, (...args: unknown[]) => unknown>();
    const statuses: Array<string | undefined> = [];
    const sentMessages: string[] = [];

    omniCoreExtension({
      registerMessageRenderer() {
        return undefined;
      },
      registerCommand() {},
      registerShortcut() {},
      sendUserMessage(message: string) {
        sentMessages.push(message);
      },
      on(event: string, handler: (...args: unknown[]) => unknown) {
        handlers.set(event, handler);
      },
    } as never);

    await handlers.get("session_start")?.(
      { type: "session_start" },
      {
        cwd: rootDir,
        ui: {
          setTitle() {},
          setTheme() {},
          setHeader() {},
          notify() {},
          setStatus(_key: string, value: string | undefined) {
            statuses.push(value);
          },
        },
      },
    );
    const beforeStart = await handlers.get("before_agent_start")?.(
      {
        type: "before_agent_start",
        prompt: "Build me a todo app",
        systemPrompt: "BASE",
      },
      { cwd: rootDir },
    );

    expect(statuses).toHaveLength(1);
    expect(sentMessages).toHaveLength(0);
    expect(beforeStart.systemPrompt).toContain("BASE");
    expect(beforeStart.systemPrompt).not.toContain("Omni-Pi Single-Brain Mode");
  });

  test("omniCoreExtension initializes and injects workflow prompt when omni mode is on", async () => {
    const rootDir = await createTempProject("omni-brain-ext-on-");
    saveOmniMode(rootDir, true);
    const handlers = new Map<string, (...args: unknown[]) => unknown>();
    const sentMessages: string[] = [];

    omniCoreExtension({
      registerMessageRenderer() {
        return undefined;
      },
      registerCommand() {},
      registerShortcut() {},
      sendUserMessage(message: string) {
        sentMessages.push(message);
      },
      sendMessage() {},
      on(event: string, handler: (...args: unknown[]) => unknown) {
        handlers.set(event, handler);
      },
    } as never);

    const beforeStart = await handlers.get("before_agent_start")?.(
      {
        type: "before_agent_start",
        prompt: "Build me a todo app",
        systemPrompt: "BASE",
      },
      { cwd: rootDir },
    );

    expect(beforeStart.systemPrompt).toContain("Omni-Pi Single-Brain Mode");
    expect(sentMessages).toHaveLength(1);
  });
});
