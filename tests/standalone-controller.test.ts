import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, test, vi } from "vitest";

import { REPO_MAP_SCHEMA_VERSION } from "../src/repo-map-contracts.js";
import { createStandaloneController } from "../src/standalone/controller.js";
import {
  formatMarkdownForTerminal,
  renderConversationLines,
  renderSessionPanel,
  renderWorkflowPanel,
} from "../src/standalone/presenter.js";
import type { OmniRpcClient } from "../src/standalone/rpc/client.js";
import type {
  OmniRpcEvent,
  OmniRpcExtensionUiRequest,
} from "../src/standalone/rpc/contracts.js";

function createRpcClientStub(): OmniRpcClient & {
  emitEvent: (event: OmniRpcEvent) => void;
  emitUi: (request: OmniRpcExtensionUiRequest) => void;
} {
  let eventListener: ((event: OmniRpcEvent) => void) | undefined;
  let uiListener: ((request: OmniRpcExtensionUiRequest) => void) | undefined;

  return {
    start: vi.fn(async () => {}),
    stop: vi.fn(async () => {}),
    restart: vi.fn(async () => {}),
    isRunning: vi.fn(() => true),
    send: vi.fn(async () => ({
      type: "response",
      command: "get_state",
      success: true as const,
      data: {
        sessionId: "session-1",
        thinkingLevel: "medium",
        isStreaming: false,
        model: { provider: "anthropic", id: "claude-sonnet" },
      },
    })),
    prompt: vi.fn(async () => {}),
    steer: vi.fn(async () => {}),
    followUp: vi.fn(async () => {}),
    newSession: vi.fn(async () => {}),
    switchSession: vi.fn(async () => {}),
    fork: vi.fn(async () => {}),
    compact: vi.fn(async () => ({ summary: "Compacted summary", tokensBefore: 12345 })),
    getSessionStats: vi.fn(async () => ({ messageCount: 2, tokenCount: 3456 })),
    getCommands: vi.fn(async () => []),
    getAvailableModels: vi.fn(async () => [
      { provider: "anthropic", id: "claude-sonnet", name: "Claude Sonnet" },
      { provider: "openai", id: "gpt-4.1", name: "GPT-4.1" },
    ]),
    exportHtml: vi.fn(async () => "/tmp/test-export.html"),
    setModel: vi.fn(async () => {}),
    setThinkingLevel: vi.fn(async () => {}),
    setSessionName: vi.fn(async () => {}),
    abort: vi.fn(async () => {}),
    sendExtensionUiResponse: vi.fn(async () => {}),
    onEvent(listener) {
      eventListener = listener;
      return () => {
        eventListener = undefined;
      };
    },
    onExtensionUiRequest(listener) {
      uiListener = listener;
      return () => {
        uiListener = undefined;
      };
    },
    getStderr: vi.fn(() => ""),
    emitEvent(event) {
      eventListener?.(event);
    },
    emitUi(request) {
      uiListener?.(request);
    },
  };
}

describe("standalone controller", () => {
  test("loads initial session state and keeps tool activity inline with the assistant turn", async () => {
    const rpcClient = createRpcClientStub();
    const controller = createStandaloneController({ rpcClient });

    await controller.start();
    await controller.submitPrompt("Hello");

    rpcClient.emitEvent({ type: "agent_start" });
    rpcClient.emitEvent({
      type: "message_update",
      assistantMessageEvent: {
        type: "toolcall_end",
        toolCall: { name: "web_search" },
      },
    });
    rpcClient.emitEvent({
      type: "tool_execution_start",
      toolName: "web_search",
      input: { query: "omni" },
    });
    rpcClient.emitEvent({
      type: "message_update",
      assistantMessageEvent: { type: "text_delta", delta: "Hi" },
    });
    rpcClient.emitEvent({
      type: "message_update",
      assistantMessageEvent: { type: "text_delta", delta: " there" },
    });
    rpcClient.emitEvent({
      type: "tool_execution_end",
      toolName: "web_search",
      isError: false,
      output: { text: "search complete" },
    });
    rpcClient.emitEvent({ type: "message_end" });
    rpcClient.emitEvent({ type: "agent_end", messages: [] });

    expect(controller.state.session.modelLabel).toBe("anthropic/claude-sonnet");
    expect(controller.state.conversation).toHaveLength(2);
    expect(controller.state.conversation[1]?.text).toBe("Hi there");
    expect(controller.state.conversation[1]?.toolCalls).toEqual([
      {
        id: expect.any(String),
        name: "web_search",
        status: "done",
        inputText: '{"query":"omni"}',
        outputText: 'search complete',
      },
    ]);
    expect(controller.state.session.isStreaming).toBe(false);

    const rendered = renderConversationLines(controller.state);
    expect(rendered).toContain("Omni");
    expect(rendered).toContain("↳ web_search · done");
    expect(rendered).toContain("input");
    expect(rendered).toContain("search complete");
    expect(rendered).not.toContain("Tool:");
  });

  test("loads workflow and repo-map sidebar context from the project directory", async () => {
    const rpcClient = createRpcClientStub();
    const projectDir = await mkdtemp(
      path.join(os.tmpdir(), "omni-standalone-"),
    );

    await mkdir(path.join(projectDir, ".omni"), { recursive: true });
    await mkdir(path.join(projectDir, ".pi", "repo-map"), { recursive: true });
    await writeFile(
      path.join(projectDir, ".omni", "STATE.md"),
      "# State\n\nCurrent Phase: Build\nActive Task: M3\nStatus Summary: Working\nBlockers: None\nNext Step: Keep going\n",
      "utf8",
    );
    await writeFile(
      path.join(projectDir, ".omni", "TASKS.md"),
      "# Tasks\n\n| ID | Title | Status |\n| --- | --- | --- |\n| M3 | Shell | pending |\n",
      "utf8",
    );
    await writeFile(
      path.join(projectDir, ".pi", "repo-map", "state.json"),
      JSON.stringify({
        schemaVersion: REPO_MAP_SCHEMA_VERSION,
        indexedAt: new Date().toISOString(),
        files: {
          "src/main.ts": {
            path: "src/main.ts",
            language: "typescript",
            parserStatus: "indexed",
            size: 10,
            mtimeMs: 1,
            fingerprint: "abc",
            indexedAt: new Date().toISOString(),
            firstIndexedAt: new Date().toISOString(),
            symbols: [{ name: "main", kind: "function", exported: true }],
            imports: [],
            outgoingPaths: [],
            incomingPaths: [],
          },
        },
      }),
      "utf8",
    );

    const controller = createStandaloneController({
      rpcClient,
      cwd: projectDir,
    });
    await controller.start();

    expect(controller.state.workflow.phase).toBe("Build");
    expect(controller.state.workflow.activeTask).toBe("M3");
    expect(controller.state.workflow.tasksPreview).toContain(
      "| M3 | Shell | pending |",
    );
    expect(controller.state.repoMapPreview).toContain("## Repo Map");
    expect(controller.state.repoMapPreview).toContain("src/main.ts");
  });

  test("handles standalone slash commands for queue and model/session control", async () => {
    const rpcClient = createRpcClientStub();
    const controller = createStandaloneController({ rpcClient });

    await controller.start();
    await controller.submitPrompt("/model anthropic/claude-opus");
    await controller.submitPrompt("/thinking high");
    await controller.submitPrompt("/followup summarize later");
    await controller.submitPrompt("/steer focus on tests");
    await controller.submitPrompt("/name feature-branch");
    await controller.submitPrompt("/compact focus on code changes");
    await controller.submitPrompt("/session");

    expect(rpcClient.setModel).toHaveBeenCalledWith("anthropic", "claude-opus");
    expect(rpcClient.setThinkingLevel).toHaveBeenCalledWith("high");
    expect(rpcClient.followUp).toHaveBeenCalledWith("summarize later");
    expect(rpcClient.steer).toHaveBeenCalledWith("focus on tests");
    expect(rpcClient.setSessionName).toHaveBeenCalledWith("feature-branch");
    expect(rpcClient.compact).toHaveBeenCalledWith("focus on code changes");
    expect(rpcClient.getSessionStats).toHaveBeenCalled();
    expect(controller.state.session.modelLabel).toBe("anthropic/claude-opus");
    expect(controller.state.session.thinkingLevel).toBe("high");
    expect(controller.state.session.sessionName).toBe("feature-branch");

    await controller.submitPrompt("/omni-rtk status");
    expect(rpcClient.prompt).toHaveBeenCalledWith("/omni-rtk status");
  });

  test("opens scoped-models selector and persists enabled models", async () => {
    const rpcClient = createRpcClientStub();
    const projectDir = await mkdtemp(
      path.join(os.tmpdir(), "omni-standalone-scoped-"),
    );
    await mkdir(path.join(projectDir, ".pi"), { recursive: true });

    const controller = createStandaloneController({ rpcClient, cwd: projectDir });
    await controller.start();

    const pending = controller.submitPrompt("/scoped-models");
    for (let i = 0; i < 20 && controller.state.dialog?.kind !== "scoped-models"; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    expect(controller.state.dialog?.kind).toBe("scoped-models");
    controller.toggleDialogSelection();
    await controller.submitDialog();
    await pending;

    const settings = JSON.parse(
      await readFile(path.join(projectDir, ".pi", "settings.json"), "utf8"),
    ) as { enabledModels?: string[] };
    expect(settings.enabledModels).toEqual(["anthropic/claude-sonnet"]);
    expect(rpcClient.restart).toHaveBeenCalled();
  });

  test("exports session to HTML via RPC", async () => {
    const rpcClient = createRpcClientStub();
    const controller = createStandaloneController({ rpcClient });
    await controller.start();

    await controller.submitPrompt("/export");

    expect(rpcClient.exportHtml).toHaveBeenCalledWith(undefined);
    const lastItem = controller.state.conversation[controller.state.conversation.length - 1];
    expect(lastItem?.text).toContain("/tmp/test-export.html");
  });

  test("exports session to JSONL by copying session file", async () => {
    const rpcClient = createRpcClientStub();
    const projectDir = await mkdtemp(
      path.join(os.tmpdir(), "omni-standalone-export-"),
    );
    const sessionDir = path.join(projectDir, ".pi", "sessions");
    await mkdir(sessionDir, { recursive: true });
    const sessionFile = path.join(sessionDir, "test-session.jsonl");
    await writeFile(sessionFile, JSON.stringify({ type: "session", version: 1 }) + "\n");

    const controller = createStandaloneController({ rpcClient, cwd: projectDir });
    await controller.start();
    // Simulate having an active session file
    controller.state.session.sessionFile = sessionFile;

    const outPath = path.join(projectDir, "exported.jsonl");
    await controller.submitPrompt(`/export ${outPath}`);

    const lastItem = controller.state.conversation[controller.state.conversation.length - 1];
    expect(lastItem?.text).toContain("exported.jsonl");
    const content = await readFile(outPath, "utf8");
    expect(content).toContain("session");
  });

  test("shows usage error for /import with no path", async () => {
    const rpcClient = createRpcClientStub();
    const controller = createStandaloneController({ rpcClient });
    await controller.start();

    await controller.submitPrompt("/import");

    const lastItem = controller.state.conversation[controller.state.conversation.length - 1];
    expect(lastItem?.text).toContain("Usage");
  });

  test("opens model picker when /model has no args", async () => {
    const rpcClient = createRpcClientStub();
    const controller = createStandaloneController({ rpcClient });
    await controller.start();

    const pending = controller.submitPrompt("/model");
    for (let i = 0; i < 20 && controller.state.dialog?.kind !== "select"; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    expect(controller.state.dialog?.kind).toBe("select");
    expect(controller.state.dialog?.title).toBe("Switch model");
    const options = controller.state.dialog?.options ?? [];
    expect(options.length).toBeGreaterThanOrEqual(2);

    // Select the first model
    await controller.submitDialog();
    await pending;
    expect(rpcClient.setModel).toHaveBeenCalledWith("anthropic", "claude-sonnet");
    expect(controller.state.session.modelLabel).toBe("anthropic/claude-sonnet");
  });

  test("opens model picker via controller method", async () => {
    const rpcClient = createRpcClientStub();
    const controller = createStandaloneController({ rpcClient });
    await controller.start();

    const pending = controller.openModelPicker();
    for (let i = 0; i < 20 && controller.state.dialog?.kind !== "select"; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    expect(controller.state.dialog?.kind).toBe("select");
    expect(controller.state.dialog?.title).toBe("Switch model");
    await controller.submitDialog();
    await pending;
    expect(rpcClient.setModel).toHaveBeenCalled();
  });

  test("opens theme picker and persists the selected preset", async () => {
    const rpcClient = createRpcClientStub();
    const projectDir = await mkdtemp(
      path.join(os.tmpdir(), "omni-standalone-theme-"),
    );
    await mkdir(path.join(projectDir, ".pi"), { recursive: true });

    const controller = createStandaloneController({ rpcClient, cwd: projectDir });
    await controller.start();

    const pending = controller.submitPrompt("/theme");
    for (let i = 0; i < 20 && controller.state.dialog?.kind !== "select"; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    expect(controller.state.dialog?.kind).toBe("theme");
    expect(controller.state.dialog?.title).toBe("Theme");
    const originalPreset = controller.state.theme.presetName;
    controller.moveDialogSelection(1);
    expect(controller.state.theme.presetName).not.toBe(originalPreset);
    await controller.submitDialog();
    await pending;

    const settings = JSON.parse(
      await readFile(path.join(projectDir, ".pi", "settings.json"), "utf8"),
    ) as { omniTheme?: string };
    expect(settings.omniTheme).toBeDefined();
    expect(settings.omniTheme).not.toBe("lavender");
  });

  test("opens providers hub with setup actions", async () => {
    const rpcClient = createRpcClientStub();
    const controller = createStandaloneController({ rpcClient });
    await controller.start();

    const pending = controller.submitPrompt("/providers");
    for (let i = 0; i < 20 && controller.state.dialog?.kind !== "select"; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    expect(controller.state.dialog?.kind).toBe("select");
    expect(controller.state.dialog?.title).toBe("Providers");
    expect(controller.state.dialog?.options?.some((option) => option.value === "/login")).toBe(true);
    expect(controller.state.dialog?.options?.some((option) => option.value === "/model-setup add")).toBe(true);
    await controller.cancelDialog();
    await pending;
  });

  test("guides the empty state toward provider setup when no models are available", async () => {
    const rpcClient = createRpcClientStub();
    rpcClient.getAvailableModels = vi.fn(async () => []);
    const controller = createStandaloneController({ rpcClient });
    await controller.start();

    const rendered = renderConversationLines(controller.state);
    expect(rendered.toLowerCase()).toContain("no models are currently available");
    expect(rendered).toContain("/providers");
  });

  test("shows explicit bash tool input and output when provided by RPC events", async () => {
    const rpcClient = createRpcClientStub();
    const controller = createStandaloneController({ rpcClient });

    await controller.start();
    await controller.submitPrompt("Run git status");

    rpcClient.emitEvent({ type: "agent_start" });
    rpcClient.emitEvent({
      type: "message_update",
      assistantMessageEvent: {
        type: "toolcall_end",
        toolCall: { name: "bash", command: "rtk git status --short --branch" },
      },
    });
    rpcClient.emitEvent({
      type: "tool_execution_start",
      toolName: "bash",
      input: { command: "rtk git status --short --branch" },
    });
    rpcClient.emitEvent({
      type: "tool_execution_end",
      toolName: "bash",
      isError: false,
      output: {
        content: [
          {
            type: "text",
            text: "## feat/opentui-standalone-omni...origin/feat/opentui-standalone-omni",
          },
        ],
      },
    });
    rpcClient.emitEvent({ type: "message_end" });
    rpcClient.emitEvent({ type: "agent_end", messages: [] });

    const rendered = renderConversationLines(controller.state);
    expect(rendered).toContain("rtk git status --short --branch");
    expect(rendered).toContain("feat/opentui-standalone-omni");
    expect(rendered).not.toContain('{"content"');
  });

  test("tracks queue state and status notifications from RPC traffic", async () => {
    const rpcClient = createRpcClientStub();
    const controller = createStandaloneController({ rpcClient });

    await controller.start();

    rpcClient.emitEvent({
      type: "queue_update",
      steering: ["one"],
      followUp: ["two"],
    });
    rpcClient.emitUi({
      type: "extension_ui_request",
      id: "ui-1",
      method: "setStatus",
      statusKey: "omni",
      statusText: "Running",
    });
    rpcClient.emitUi({
      type: "extension_ui_request",
      id: "ui-2",
      method: "notify",
      message: "Heads up",
      notifyType: "info",
    });

    expect(controller.state.session.steeringQueue).toEqual(["one"]);
    expect(controller.state.session.followUpQueue).toEqual(["two"]);
    expect(controller.state.statuses).toEqual([
      { key: "omni", text: "Running" },
    ]);
    expect(controller.state.conversation.at(-1)?.text).toContain("Heads up");
  });

  test("sanitizes and compacts sidebar summaries", async () => {
    const rpcClient = createRpcClientStub();
    const controller = createStandaloneController({ rpcClient });
    await controller.start();

    rpcClient.emitUi({
      type: "extension_ui_request",
      id: "ui-3",
      method: "setStatus",
      statusKey: "omni",
      statusText: "\u001b[38;2;97;188;235mOmni mode ON\u001b[0m",
    });

    const sessionPanel = renderSessionPanel(controller.state);
    const workflowPanel = renderWorkflowPanel({
      phase: "Check",
      activeTask: "Standalone UX hardening pass complete",
      statusSummary:
        "The standalone shell now renders grouped conversation turns and keeps tool activity inline with the assistant turn.",
      nextStep:
        "Manually review the updated standalone shell in real conversations and decide what polish remains.",
    });

    expect(sessionPanel).toContain("Omni mode ON");
    expect(sessionPanel).not.toContain("\u001b");
    expect(sessionPanel).not.toMatch(/\bsession\b/);
    expect(workflowPanel).toContain("Check");
    expect(workflowPanel).toContain("Standalone UX hardening pass complete");
    expect(workflowPanel).toContain("→");
    expect(workflowPanel.length).toBeLessThan(640);
  });

  test("renders common markdown output into readable terminal text", () => {
    const rendered = formatMarkdownForTerminal(
      [
        "# Title",
        "",
        "- **Now:** **10°C**",
        "- [Source](https://example.com)",
        "",
        "Let me explain.Here's the answer:",
        "",
        "| Task | Status |",
        "| --- | --- |",
        "| U1 | done |",
        "| U2 | done |",
        "",
        "`inline code`",
      ].join("\n"),
    );

    expect(rendered).toContain("Title");
    expect(rendered).toContain("• Now: 10°C");
    expect(rendered).toContain("• Source (https://example.com)");
    expect(rendered).toContain("Let me explain. Here's the answer:");
    expect(rendered).toContain("┌");
    expect(rendered).toContain("│ Task │ Status │");
    expect(rendered).toContain("inline code");
    expect(rendered).not.toContain("**");
  });
});
