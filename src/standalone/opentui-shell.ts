import type {
  BoxRenderable,
  CliRenderer,
  InputRenderable,
  ScrollBoxRenderable,
  TextRenderable,
} from "@opentui/core";
import type {
  OmniStandaloneAppState,
  OmniStandaloneToolCall,
} from "./contracts.js";
import type { OmniStandaloneController } from "./controller.js";
import {
  renderRepoMapPanel,
  renderSessionPanel,
  renderWorkflowPanel,
} from "./presenter.js";

const COLOR = {
  canvas: "#0b0b0f",
  surface: "#101014",
  surfaceAlt: "#16161d",
  border: "#26262e",
  borderSoft: "#1d1d24",
  divider: "#2a2a33",
  text: "#e6e6ea",
  textMuted: "#8a8a94",
  textFaint: "#5c5c66",
  accent: "#a78bfa",
  accentSoft: "#6d5cc3",
  userAccent: "#7dd3fc",
  info: "#60a5fa",
  success: "#86efac",
  warn: "#fcd34d",
  danger: "#fca5a5",
};

const TAGLINES = [
  "barely sentient, mostly caffeinated",
  "summoning daemons on your behalf",
  "pair programming with a ghost",
  "rubber duck, but it yaps back",
  "accidentally pretty smart",
  "suspiciously fast typist",
  "regex didn't stand a chance",
  "found your missing semicolon",
  "undefined is not a function (yet)",
  "git blame, politely",
  "does not sleep, just swaps",
  "your terminal's favourite roommate",
  "ships it, then asks questions",
  "quietly judging your indentation",
  "the pi does not forget",
  "cursor blink, but make it helpful",
  "promises you, it's synchronous",
  "side-channel for shipping code",
  "coffee-to-code transducer",
  "99 problems, but a bug ain't one",
];

function pickTagline(): string {
  const index = Math.floor(Math.random() * TAGLINES.length);
  return TAGLINES[index] ?? TAGLINES[0] ?? "";
}

interface SlashCommand {
  name: string;
  args?: string;
  description: string;
}

const SLASH_COMMANDS: SlashCommand[] = [
  { name: "help", description: "list the available commands" },
  { name: "new", description: "start a fresh session" },
  {
    name: "model",
    args: "<provider>/<id>",
    description: "switch the active model",
  },
  {
    name: "thinking",
    args: "<level>",
    description: "set thinking budget (low/medium/high)",
  },
  { name: "steer", args: "<msg>", description: "queue a steering message" },
  { name: "followup", args: "<msg>", description: "queue a follow-up prompt" },
  {
    name: "switch",
    args: "<session>",
    description: "switch to another session",
  },
  { name: "fork", args: "<entry-id>", description: "fork from a prior entry" },
];

function filterSlashCommands(value: string): SlashCommand[] {
  if (!value.startsWith("/")) return [];
  const rest = value.slice(1);
  // Stop showing suggestions once the command is fully typed with an argument.
  if (rest.includes(" ")) return [];
  const query = rest.toLowerCase();
  const matches = SLASH_COMMANDS.filter((cmd) =>
    cmd.name.toLowerCase().startsWith(query),
  );
  return matches.length > 0 ? matches : [];
}

function toolStatusGlyph(status: OmniStandaloneToolCall["status"]): {
  glyph: string;
  color: string;
  label: string;
} {
  switch (status) {
    case "running":
      return { glyph: "●", color: COLOR.info, label: "running" };
    case "done":
      return { glyph: "✓", color: COLOR.success, label: "done" };
    case "failed":
      return { glyph: "✗", color: COLOR.danger, label: "failed" };
    default:
      return { glyph: "○", color: COLOR.textFaint, label: "queued" };
  }
}

function shortSessionLabel(value: string | undefined): string {
  if (!value) return "new session";
  return value.length > 20 ? `${value.slice(0, 8)}…${value.slice(-6)}` : value;
}

function renderTopBar(
  state: OmniStandaloneAppState,
  availableWidth: number,
): string {
  const mode = state.session.isStreaming ? "working" : "ready";
  const model = state.session.modelLabel ?? "default model";
  const thinking = state.session.thinkingLevel ?? "default";
  const session = shortSessionLabel(
    state.session.sessionName ?? state.session.sessionId,
  );
  const queue =
    state.session.steeringQueue.length + state.session.followUpQueue.length;
  const queuePart = queue > 0 ? `  ·  queue ${queue}` : "";

  const segments: string[] = [`omni  ·  ${mode}`, model];
  if (availableWidth >= 90) {
    segments.push(`thinking ${thinking}`);
  }
  if (availableWidth >= 70) {
    segments.push(session);
  }
  let line = segments.join("  ·  ") + queuePart;
  if (line.length > availableWidth) {
    line = `${line.slice(0, Math.max(0, availableWidth - 1))}…`;
  }
  return line;
}

function renderShortcuts(state: OmniStandaloneAppState): string {
  const abort = state.session.isStreaming ? "esc abort  ·  " : "";
  return `${abort}enter send  ·  /help controls`;
}

export interface MountShellResult {
  teardown: () => void;
}

export async function mountOmniShell(
  renderer: CliRenderer,
  controller: OmniStandaloneController,
): Promise<MountShellResult> {
  const openTui = await import("@opentui/core");
  const {
    BoxRenderable,
    ScrollBoxRenderable,
    TextRenderable,
    InputRenderable,
    InputRenderableEvents,
    MarkdownRenderable,
    ASCIIFontRenderable,
    SyntaxStyle,
  } = openTui;

  renderer.setBackgroundColor(COLOR.canvas);

  const terminalWidth = renderer.terminalWidth ?? renderer.root.width ?? 100;
  // Hide the right rail below 100 cols so the conversation keeps breathing room.
  const sidebarVisible = terminalWidth >= 100;
  const sidebarWidth = terminalWidth >= 140 ? 40 : 34;

  const root = new BoxRenderable(renderer, {
    id: "omni-root",
    width: "100%",
    height: "100%",
    flexDirection: "column",
    backgroundColor: COLOR.canvas,
  });

  // --- Top status bar ---------------------------------------------------
  const topBar = new BoxRenderable(renderer, {
    width: "100%",
    flexShrink: 0,
    paddingLeft: 2,
    paddingRight: 2,
    paddingTop: 0,
    paddingBottom: 0,
    border: ["bottom"],
    borderColor: COLOR.border,
    backgroundColor: COLOR.canvas,
  });
  const topBarText = new TextRenderable(renderer, {
    content: renderTopBar(controller.state, terminalWidth - 4),
    fg: COLOR.textMuted,
  });
  topBar.add(topBarText);

  // --- Body: conversation + right rail ----------------------------------
  const body = new BoxRenderable(renderer, {
    width: "100%",
    flexGrow: 1,
    flexDirection: "row",
    backgroundColor: COLOR.canvas,
  });

  const syntaxStyle = SyntaxStyle.create();

  const conversationColumn = new BoxRenderable(renderer, {
    flexGrow: 1,
    flexDirection: "column",
    paddingLeft: 2,
    paddingRight: 2,
    paddingTop: 1,
    paddingBottom: 1,
    backgroundColor: COLOR.canvas,
  });
  const conversationScroll: ScrollBoxRenderable = new ScrollBoxRenderable(
    renderer,
    {
      flexGrow: 1,
      stickyScroll: true,
      stickyStart: "bottom",
      verticalScrollbarOptions: {
        showArrows: false,
        trackOptions: {
          backgroundColor: COLOR.canvas,
          foregroundColor: COLOR.borderSoft,
        },
      },
    },
  );
  const conversationStack = new BoxRenderable(renderer, {
    id: "conversation-stack",
    width: "100%",
    flexDirection: "column",
    gap: 1,
    backgroundColor: COLOR.canvas,
  });
  conversationScroll.add(conversationStack);
  conversationColumn.add(conversationScroll);

  // --- Right rail -------------------------------------------------------
  const sidebarColumn = new BoxRenderable(renderer, {
    width: sidebarWidth,
    flexDirection: "column",
    overflow: "hidden",
    gap: 1,
    paddingTop: 1,
    paddingBottom: 1,
    paddingLeft: 1,
    paddingRight: 1,
    border: ["left"],
    borderColor: COLOR.border,
    backgroundColor: COLOR.canvas,
  });

  const sessionPanel = new BoxRenderable(renderer, {
    border: true,
    borderColor: COLOR.borderSoft,
    borderStyle: "rounded",
    title: " session ",
    titleAlignment: "left",
    paddingLeft: 1,
    paddingRight: 1,
    paddingTop: 0,
    paddingBottom: 0,
    backgroundColor: COLOR.canvas,
  });
  const sessionText = new TextRenderable(renderer, {
    content: renderSessionPanel(controller.state),
    fg: COLOR.textMuted,
  });
  sessionPanel.add(sessionText);

  const workflowPanel = new BoxRenderable(renderer, {
    border: true,
    borderColor: COLOR.borderSoft,
    borderStyle: "rounded",
    title: " workflow ",
    titleAlignment: "left",
    paddingLeft: 1,
    paddingRight: 1,
    paddingTop: 0,
    paddingBottom: 0,
    backgroundColor: COLOR.canvas,
  });
  const workflowText = new TextRenderable(renderer, {
    content: renderWorkflowPanel(controller.state.workflow),
    fg: COLOR.textMuted,
  });
  workflowPanel.add(workflowText);

  const repoMapLayout = controller.state.layout.panels.find(
    (panel) => panel.id === "repoMap",
  );
  let repoMapPanel: BoxRenderable | undefined;
  let repoMapText: TextRenderable | undefined;
  if (repoMapLayout?.visible) {
    repoMapPanel = new BoxRenderable(renderer, {
      border: true,
      borderColor: COLOR.borderSoft,
      borderStyle: "rounded",
      title: " repo map ",
      titleAlignment: "left",
      paddingLeft: 1,
      paddingRight: 1,
      paddingTop: 0,
      paddingBottom: 0,
      flexGrow: 1,
      backgroundColor: COLOR.canvas,
    });
    repoMapText = new TextRenderable(renderer, {
      content: renderRepoMapPanel(controller.state),
      fg: COLOR.textMuted,
    });
    repoMapPanel.add(repoMapText);
  }

  sidebarColumn.add(sessionPanel);
  sidebarColumn.add(workflowPanel);
  if (repoMapPanel) {
    sidebarColumn.add(repoMapPanel);
  }

  body.add(conversationColumn);
  if (sidebarVisible) {
    body.add(sidebarColumn);
  }

  // --- Input dock -------------------------------------------------------
  const inputDock = new BoxRenderable(renderer, {
    width: "100%",
    flexShrink: 0,
    flexDirection: "column",
    paddingLeft: 2,
    paddingRight: 2,
    paddingTop: 0,
    paddingBottom: 0,
    border: ["top"],
    borderColor: COLOR.border,
    backgroundColor: COLOR.canvas,
  });

  // --- Slash command autocomplete popover ------------------------------
  const popover: BoxRenderable = new BoxRenderable(renderer, {
    id: "slash-popover",
    width: "100%",
    flexDirection: "column",
    border: true,
    borderStyle: "rounded",
    borderColor: COLOR.border,
    paddingLeft: 1,
    paddingRight: 1,
    paddingTop: 0,
    paddingBottom: 0,
    marginTop: 1,
    backgroundColor: COLOR.surface,
    visible: false,
  });

  const SLASH_VISIBLE_MAX = 6;
  let slashMatches: SlashCommand[] = [];
  let slashIndex = 0;

  const renderSlashPopover = () => {
    for (const child of popover.getChildren()) {
      popover.remove(child.id);
    }
    if (slashMatches.length === 0) {
      popover.visible = false;
      return;
    }

    // Keep the selected item on-screen within the visible window.
    const windowStart = Math.min(
      Math.max(0, slashIndex - SLASH_VISIBLE_MAX + 1),
      Math.max(0, slashMatches.length - SLASH_VISIBLE_MAX),
    );
    const windowEnd = Math.min(
      slashMatches.length,
      windowStart + SLASH_VISIBLE_MAX,
    );
    const visible = slashMatches.slice(windowStart, windowEnd);

    const nameWidth = Math.max(
      ...visible.map(
        (cmd) => cmd.name.length + 1 + (cmd.args ? cmd.args.length + 1 : 0),
      ),
      8,
    );

    visible.forEach((cmd, localIdx) => {
      const globalIdx = windowStart + localIdx;
      const isSelected = globalIdx === slashIndex;
      const row = new BoxRenderable(renderer, {
        id: `slash-row-${cmd.name}`,
        width: "100%",
        flexDirection: "row",
        gap: 2,
        paddingLeft: 1,
        paddingRight: 1,
        backgroundColor: isSelected ? COLOR.surfaceAlt : COLOR.surface,
      });
      const label = cmd.args ? `/${cmd.name} ${cmd.args}` : `/${cmd.name}`;
      const name = new TextRenderable(renderer, {
        id: `slash-name-${cmd.name}`,
        content: label.padEnd(nameWidth, " "),
        fg: isSelected ? COLOR.accent : COLOR.text,
      });
      const description = new TextRenderable(renderer, {
        id: `slash-desc-${cmd.name}`,
        content: cmd.description,
        fg: COLOR.textMuted,
      });
      row.add(name);
      row.add(description);
      popover.add(row);
    });

    const remaining = slashMatches.length - windowEnd;
    if (remaining > 0) {
      const more = new TextRenderable(renderer, {
        id: "slash-more",
        content: ` +${remaining} more  ·  ↑↓ navigate  ·  tab complete  ·  esc close`,
        fg: COLOR.textFaint,
      });
      popover.add(more);
    } else {
      const hint = new TextRenderable(renderer, {
        id: "slash-more",
        content: " ↑↓ navigate  ·  tab complete  ·  esc close",
        fg: COLOR.textFaint,
      });
      popover.add(hint);
    }
    popover.visible = true;
  };

  const refreshSlashPopover = () => {
    const matches = filterSlashCommands(input.value);
    if (matches.length === 0) {
      slashMatches = [];
      slashIndex = 0;
      popover.visible = false;
      renderer.requestRender();
      return;
    }
    if (slashIndex >= matches.length) slashIndex = 0;
    slashMatches = matches;
    renderSlashPopover();
    renderer.requestRender();
  };

  const completeSelectedCommand = () => {
    const selected = slashMatches[slashIndex];
    if (!selected) return;
    input.value = selected.args ? `/${selected.name} ` : `/${selected.name}`;
    slashMatches = [];
    popover.visible = false;
    renderer.requestRender();
  };

  const inputRow = new BoxRenderable(renderer, {
    width: "100%",
    flexDirection: "row",
    paddingTop: 1,
    paddingBottom: 0,
    gap: 1,
    backgroundColor: COLOR.canvas,
  });
  const promptCaret = new TextRenderable(renderer, {
    content: "❯",
    fg: COLOR.accent,
  });
  const input: InputRenderable = new InputRenderable(renderer, {
    flexGrow: 1,
    placeholder: "Ask Omni…  (type / for commands)",
    textColor: COLOR.text,
    focusedTextColor: COLOR.text,
    placeholderColor: COLOR.textFaint,
    backgroundColor: COLOR.canvas,
    focusedBackgroundColor: COLOR.canvas,
  });
  input.on(InputRenderableEvents.ENTER, () => {
    const value = input.value;
    input.value = "";
    slashMatches = [];
    slashIndex = 0;
    popover.visible = false;
    input.focus();
    void controller.submitPrompt(value).catch((error: unknown) => {
      console.error(error instanceof Error ? error.message : String(error));
    });
  });
  input.on(InputRenderableEvents.INPUT, () => {
    refreshSlashPopover();
  });
  input.onKeyDown = (key) => {
    if (popover.visible && slashMatches.length > 0) {
      if (key.name === "up") {
        key.preventDefault();
        slashIndex =
          (slashIndex - 1 + slashMatches.length) % slashMatches.length;
        renderSlashPopover();
        renderer.requestRender();
        return;
      }
      if (key.name === "down") {
        key.preventDefault();
        slashIndex = (slashIndex + 1) % slashMatches.length;
        renderSlashPopover();
        renderer.requestRender();
        return;
      }
      if (key.name === "tab") {
        key.preventDefault();
        completeSelectedCommand();
        return;
      }
      if (key.name === "escape") {
        key.preventDefault();
        slashMatches = [];
        slashIndex = 0;
        popover.visible = false;
        renderer.requestRender();
        return;
      }
    }
    if (key.name === "escape") {
      key.preventDefault();
      void controller.abort();
    }
  };
  inputRow.add(promptCaret);
  inputRow.add(input);

  const shortcutsRow = new BoxRenderable(renderer, {
    width: "100%",
    paddingTop: 0,
    paddingBottom: 1,
    backgroundColor: COLOR.canvas,
  });
  const shortcutsText = new TextRenderable(renderer, {
    content: renderShortcuts(controller.state),
    fg: COLOR.textFaint,
  });
  shortcutsRow.add(shortcutsText);

  inputDock.add(popover);
  inputDock.add(inputRow);
  inputDock.add(shortcutsRow);

  root.add(topBar);
  root.add(body);
  root.add(inputDock);
  renderer.root.add(root);
  input.focus();

  // --- Empty-state view -------------------------------------------------
  const sessionTagline = pickTagline();
  const buildEmptyState = () => {
    const wrapper = new BoxRenderable(renderer, {
      id: "welcome-wrapper",
      width: "100%",
      flexGrow: 1,
      flexDirection: "column",
      alignItems: "center",
      justifyContent: "center",
      paddingTop: 2,
      paddingBottom: 2,
      gap: 1,
      backgroundColor: COLOR.canvas,
    });
    const wordmark = new ASCIIFontRenderable(renderer, {
      id: "welcome-wordmark",
      text: "omni",
      font: "tiny",
      color: COLOR.accent,
      backgroundColor: COLOR.canvas,
      selectable: false,
    });
    const tagline = new TextRenderable(renderer, {
      id: "welcome-tagline",
      content: sessionTagline,
      fg: COLOR.textMuted,
    });
    const hint = new TextRenderable(renderer, {
      id: "welcome-hint",
      content: "type / for commands  ·  enter sends  ·  esc aborts",
      fg: COLOR.textFaint,
    });
    wrapper.add(wordmark);
    wrapper.add(tagline);
    wrapper.add(hint);
    return wrapper;
  };

  // --- Conversation renderer -------------------------------------------
  const renderConversation = (state: OmniStandaloneAppState) => {
    for (const child of conversationStack.getChildren()) {
      conversationStack.remove(child.id);
    }

    if (state.conversation.length === 0) {
      conversationStack.add(buildEmptyState());
      return;
    }

    for (const item of state.conversation) {
      if (item.role === "user") {
        const card = new BoxRenderable(renderer, {
          id: `${item.id}-card`,
          width: "100%",
          flexDirection: "column",
          border: ["left"],
          borderColor: COLOR.userAccent,
          paddingLeft: 2,
          paddingRight: 1,
          backgroundColor: COLOR.canvas,
        });
        const text = new TextRenderable(renderer, {
          id: `${item.id}-text`,
          content: item.text,
          fg: COLOR.text,
        });
        card.add(text);
        conversationStack.add(card);
        continue;
      }

      if (item.role === "system") {
        const notice = new TextRenderable(renderer, {
          id: `${item.id}-notice`,
          content: `  ${item.text}`,
          fg: COLOR.textFaint,
        });
        conversationStack.add(notice);
        continue;
      }

      const card = new BoxRenderable(renderer, {
        id: `${item.id}-card`,
        width: "100%",
        flexDirection: "column",
        border: ["left"],
        borderColor: item.streaming ? COLOR.accent : COLOR.accentSoft,
        paddingLeft: 2,
        paddingRight: 1,
        backgroundColor: COLOR.canvas,
      });
      const column = new BoxRenderable(renderer, {
        id: `${item.id}-col`,
        flexGrow: 1,
        flexDirection: "column",
        gap: 0,
        backgroundColor: COLOR.canvas,
      });

      if (item.toolCalls && item.toolCalls.length > 0) {
        const toolsBox = new BoxRenderable(renderer, {
          id: `${item.id}-tools`,
          flexDirection: "column",
          gap: 0,
          marginBottom: item.text.trim() ? 1 : 0,
          backgroundColor: COLOR.canvas,
        });
        for (const toolCall of item.toolCalls) {
          const { glyph, color, label } = toolStatusGlyph(toolCall.status);
          const toolRow = new BoxRenderable(renderer, {
            id: `${toolCall.id}-row`,
            flexDirection: "row",
            gap: 1,
            backgroundColor: COLOR.canvas,
          });
          const glyphText = new TextRenderable(renderer, {
            id: `${toolCall.id}-glyph`,
            content: glyph,
            fg: color,
          });
          const nameText = new TextRenderable(renderer, {
            id: `${toolCall.id}-name`,
            content: `${toolCall.name}  ${label}`,
            fg: COLOR.textMuted,
          });
          toolRow.add(glyphText);
          toolRow.add(nameText);
          toolsBox.add(toolRow);
        }
        column.add(toolsBox);
      }

      if (item.text.trim()) {
        const markdown = new MarkdownRenderable(renderer, {
          id: `${item.id}-markdown`,
          content: item.text.trim(),
          streaming: item.streaming ?? false,
          syntaxStyle,
          fg: COLOR.text,
          bg: COLOR.canvas,
          conceal: true,
          tableOptions: {
            borders: true,
            borderStyle: "rounded",
            borderColor: COLOR.border,
            cellPadding: 0,
          },
        });
        column.add(markdown);
      } else if (item.streaming) {
        const thinking = new TextRenderable(renderer, {
          id: `${item.id}-thinking`,
          content: item.statusText ? item.statusText : "thinking…",
          fg: COLOR.textMuted,
        });
        column.add(thinking);
      }

      card.add(column);
      conversationStack.add(card);
    }
  };

  const unsubscribe = controller.onChange((state) => {
    const currentWidth = renderer.terminalWidth ?? terminalWidth;
    topBarText.content = renderTopBar(state, currentWidth - 4);
    shortcutsText.content = renderShortcuts(state);
    renderConversation(state);
    sessionText.content = renderSessionPanel(state);
    workflowText.content = renderWorkflowPanel(state.workflow);
    if (repoMapText) {
      repoMapText.content = renderRepoMapPanel(state);
    }
    conversationScroll.scrollTo({ y: conversationScroll.scrollHeight, x: 0 });
    renderer.requestRender();
  });

  // Seed the initial empty state once so the wordmark shows before RPC loads.
  renderConversation(controller.state);

  return {
    teardown: () => {
      unsubscribe();
    },
  };
}

export async function runOpenTuiShell(
  controller: OmniStandaloneController,
): Promise<void> {
  const { createCliRenderer } = await import("@opentui/core");
  const renderer = await createCliRenderer({
    exitOnCtrlC: true,
    autoFocus: true,
    screenMode: "alternate-screen",
  });

  const mounted = await mountOmniShell(renderer, controller);

  try {
    await controller.start();
    renderer.requestRender();
    await renderer.idle();
    await new Promise<void>((resolve) => {
      renderer.on("destroy", () => resolve());
    });
  } finally {
    mounted.teardown();
    await controller.stop();
    renderer.destroy();
  }
}
