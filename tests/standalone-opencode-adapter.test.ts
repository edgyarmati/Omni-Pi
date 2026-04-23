import { describe, expect, test } from "vitest";

import { createStandaloneShellState } from "../src/standalone/app-shell.js";
import {
  standaloneStateToOmniUiSnapshot,
  toOmniUiSnapshot,
} from "../src/standalone/opencode-adapter/mapper.js";

describe("standalone OpenCode-style adapter", () => {
  test("maps standalone state into adapter snapshot", () => {
    const state = createStandaloneShellState();
    state.session.sessionId = "session-1";
    state.session.modelLabel = "anthropic/claude-opus";
    state.workflow.activeTask = "OpenCode adoption";
    state.repoMapPreview = "repo map summary";
    state.conversation.push({
      id: "assistant-1",
      role: "assistant",
      text: "Working on it",
      streaming: true,
      toolCalls: [
        {
          id: "tool-1",
          name: "bash",
          status: "running",
          inputText: "npm test",
          outputText: "",
        },
      ],
    });

    const snapshot = standaloneStateToOmniUiSnapshot(state);

    expect(snapshot.session.id).toBe("session-1");
    expect(snapshot.session.model).toBe("anthropic/claude-opus");
    expect(snapshot.workflow.activeTask).toBe("OpenCode adoption");
    expect(snapshot.repoMapPreview).toBe("repo map summary");
    expect(snapshot.conversation).toEqual([
      {
        id: "assistant-1",
        role: "assistant",
        text: "Working on it",
        streaming: true,
        statusText: undefined,
        toolCalls: [
          {
            id: "tool-1",
            name: "bash",
            status: "running",
            input: "npm test",
            output: "",
          },
        ],
      },
    ]);
  });

  test("normalizes undefined streaming/tool fields", () => {
    const snapshot = toOmniUiSnapshot({
      statuses: [],
      session: { isStreaming: false, steeringQueue: [], followUpQueue: [] },
      workflow: {},
      providers: {
        items: [],
        connectedProviderCount: 0,
        configuredProviderCount: 0,
        availableModelCount: 0,
        enabledModelCount: 0,
        hasAnyOAuthProvider: false,
      },
      todos: [],
      repoMapPreview: "",
      conversation: [{ id: "u1", role: "user", text: "hi" }],
    });

    expect(snapshot.conversation[0]).toEqual({
      id: "u1",
      role: "user",
      text: "hi",
      streaming: false,
      statusText: undefined,
      toolCalls: [],
    });
  });
});
