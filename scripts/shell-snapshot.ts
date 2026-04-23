/**
 * Dev tool: render the standalone OpenTUI shell against the test renderer
 * and print the captured frame to stdout. Lets us eyeball the layout without
 * launching the alternate-screen app.
 *
 * Usage: bun ./scripts/shell-snapshot.ts [state]
 *   state: "empty" (default) | "conversation" | "narrow" | "slash"
 */
import { createMockKeys, createTestRenderer } from "@opentui/core/testing";
import { createStandaloneShellState } from "../src/standalone/app-shell.js";
import type {
  OmniStandaloneAppState,
  OmniStandaloneConversationItem,
} from "../src/standalone/contracts.js";
import type { OmniStandaloneController } from "../src/standalone/controller.js";
import { mountOmniShell } from "../src/standalone/opentui-shell.js";

function seedEmptyState(): OmniStandaloneAppState {
  const state = createStandaloneShellState();
  state.session.modelLabel = "anthropic/claude-sonnet";
  state.session.thinkingLevel = "medium";
  state.session.sessionName = "feat-opentui";
  state.session.isStreaming = false;
  state.workflow.phase = "Implement";
  state.workflow.activeTask = "Visual hardening pass";
  state.workflow.statusSummary =
    "Redesigning shell layout with OpenCode inspiration.";
  state.workflow.nextStep = "Iterate on top bar and empty state.";
  return state;
}

function seedConversationState(): OmniStandaloneAppState {
  const state = seedEmptyState();
  state.session.isStreaming = true;
  const items: OmniStandaloneConversationItem[] = [
    {
      id: "user-1",
      role: "user",
      text: "Rework the standalone shell layout. Take inspiration from OpenCode.",
    },
    {
      id: "assistant-1",
      role: "assistant",
      text: "Refactoring the layout now. I'll tighten the top bar, simplify the turn rendering, and make the right rail look like boxed panels.",
      streaming: false,
      toolCalls: [
        { id: "t1", name: "read_file", status: "done" },
        { id: "t2", name: "grep", status: "done" },
        { id: "t3", name: "edit", status: "running" },
      ],
    },
    {
      id: "system-1",
      role: "system",
      text: "Model set to anthropic/claude-sonnet.",
    },
    {
      id: "user-2",
      role: "user",
      text: "Looks better — iterate on the empty state and the input dock.",
    },
    {
      id: "assistant-2",
      role: "assistant",
      text: "",
      streaming: true,
      statusText: "using grep",
      toolCalls: [{ id: "t4", name: "grep", status: "running" }],
    },
  ];
  state.conversation = items;
  return state;
}

function createStubController(
  state: OmniStandaloneAppState,
): OmniStandaloneController {
  return {
    state,
    async start() {},
    async stop() {},
    async submitPrompt() {},
    async abort() {},
    async openModelPicker() {},
    getPreviousPromptHistory() {
      return undefined;
    },
    getNextPromptHistory() {
      return undefined;
    },
    resetPromptHistoryNavigation() {},
    updateDialogInput() {},
    moveDialogSelection() {},
    toggleDialogSelection() {},
    async submitDialog() {},
    async cancelDialog() {},
    onChange() {
      return () => {};
    },
    onQuit() {
      return () => {};
    },
  };
}

type SnapshotMode = "empty" | "conversation" | "narrow" | "slash";

function resolveMode(arg: string | undefined): SnapshotMode {
  switch (arg) {
    case "conversation":
    case "narrow":
    case "slash":
      return arg;
    default:
      return "empty";
  }
}

async function main(): Promise<void> {
  const mode = resolveMode(process.argv[2]);
  const state =
    mode === "conversation" ? seedConversationState() : seedEmptyState();
  const controller = createStubController(state);

  const width = mode === "narrow" ? 80 : 140;
  const height = mode === "narrow" ? 30 : 38;

  const { renderer, renderOnce, captureCharFrame } = await createTestRenderer({
    width,
    height,
  });

  const mounted = await mountOmniShell(renderer, controller);
  await renderOnce();

  if (mode === "slash") {
    const keys = createMockKeys(renderer);
    await keys.typeText("/");
    await renderOnce();
  }

  const frame = captureCharFrame();
  mounted.teardown();
  renderer.destroy();

  process.stdout.write(`\n=== ${mode} state (${width}x${height}) ===\n`);
  process.stdout.write(frame);
  process.stdout.write("\n");
}

main().catch((error) => {
  console.error(
    error instanceof Error ? (error.stack ?? error.message) : String(error),
  );
  process.exit(1);
});
