import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, test } from "vitest";
import omniCoreExtension from "../extensions/omni-core/index.js";
import {
  buildBrainSystemPromptSuffix,
  ensureOmniInitialized,
} from "../src/brain.js";

async function createTempProject(prefix: string): Promise<string> {
  return mkdtemp(path.join(os.tmpdir(), prefix));
}

describe("Omni brain runtime", () => {
  test("ensureOmniInitialized bootstraps .omni on first use", async () => {
    const rootDir = await createTempProject("omni-brain-init-");

    const result = await ensureOmniInitialized(rootDir);
    const state = await readFile(
      path.join(rootDir, ".omni", "STATE.md"),
      "utf8",
    );

    expect(result).toBe("initialized");
    expect(state).toContain("Capture exact requirements");
  });

  test("buildBrainSystemPromptSuffix includes the single-brain workflow and durable files", async () => {
    const rootDir = await createTempProject("omni-brain-prompt-");
    await ensureOmniInitialized(rootDir);

    const prompt = await buildBrainSystemPromptSuffix(rootDir);

    expect(prompt).toContain("Omni-Pi Single-Brain Mode");
    expect(prompt).toContain("Interview the user until the requested behavior");
    expect(prompt).toContain(".omni/TASKS.md");
    expect(prompt).toContain("Capture exact requirements");
  });

  test("omniCoreExtension bootstraps startup messaging and prompt injection", async () => {
    const rootDir = await createTempProject("omni-brain-ext-");
    const sentMessages: Array<{ customType: string; content: string }> = [];
    const handlers = new Map<string, (...args: unknown[]) => unknown>();

    omniCoreExtension({
      registerMessageRenderer() {
        return undefined;
      },
      sendMessage(message: { customType: string; content: string }) {
        sentMessages.push(message);
      },
      on(event: string, handler: (...args: unknown[]) => unknown) {
        handlers.set(event, handler);
      },
    } as never);

    await handlers.get("session_start")?.(
      { type: "session_start" },
      { cwd: rootDir },
    );
    const beforeStart = await handlers.get("before_agent_start")?.(
      {
        type: "before_agent_start",
        prompt: "Build me a todo app",
        systemPrompt: "BASE",
      },
      { cwd: rootDir },
    );

    expect(sentMessages).toHaveLength(1);
    expect(sentMessages[0].customType).toBe("omni-status");
    expect(sentMessages[0].content).toContain("Single-brain mode is active");
    expect(beforeStart.systemPrompt).toContain("BASE");
    expect(beforeStart.systemPrompt).toContain("Omni-Pi Single-Brain Mode");
  });
});
