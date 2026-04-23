import { existsSync } from "node:fs";

import type {
  BoxRenderable,
  CliRenderer,
  InputRenderable,
  ScrollBoxRenderable,
  TextRenderable,
} from "@opentui/core";
import { writeClipboardImageTemp } from "./bridges.js";
import { filterStandaloneSlashCommands } from "./commands.js";
import {
  appendAttachmentToken,
  type ComposerAttachment,
  createImageAttachmentToken,
  expandComposerAttachments,
  pruneComposerAttachments,
} from "./composer.js";
import type {
  OmniStandaloneAppState,
  OmniStandaloneToolCall,
} from "./contracts.js";
import type { OmniStandaloneController } from "./controller.js";
import { standaloneStateToOmniUiSnapshot } from "./opencode-adapter/mapper.js";
import type { OmniUiSnapshot } from "./opencode-adapter/contracts.js";
import {
  formatMarkdownForTerminal,
  renderOmniUiFooterMeta,
  renderOmniUiTodoPanel,
  renderOmniUiWorkflowPanel,
} from "./presenter.js";

const BASE_COLOR = {
  canvas: "#121318",
  surface: "#171922",
  surfaceAlt: "#1d2030",
  border: "#31354a",
  borderSoft: "#25293b",
  divider: "#373d55",
  text: "#f5f5f7",
  textMuted: "#e7e8ef",
  textFaint: "#c8ccda",
  userAccent: "#7dd3fc",
  info: "#60a5fa",
  success: "#86efac",
  warn: "#fcd34d",
  danger: "#fca5a5",
};

type ShellPalette = typeof BASE_COLOR & { accent: string; accentSoft: string };

function mixHex(hex: string, target: string, ratio: number): string {
  const toRgb = (value: string) => ({
    r: Number.parseInt(value.slice(1, 3), 16),
    g: Number.parseInt(value.slice(3, 5), 16),
    b: Number.parseInt(value.slice(5, 7), 16),
  });
  const from = toRgb(hex);
  const into = toRgb(target);
  const mix = (left: number, right: number) =>
    Math.round(left + (right - left) * ratio)
      .toString(16)
      .padStart(2, "0");
  return `#${mix(from.r, into.r)}${mix(from.g, into.g)}${mix(from.b, into.b)}`;
}

function buildPalette(state: OmniStandaloneAppState): ShellPalette {
  const accent = state.theme.brand;
  const welcome = state.theme.welcome;
  const charcoal = "#14161d";
  const canvas = mixHex(mixHex(charcoal, accent, 0.12), welcome, 0.06);
  const surface = mixHex(canvas, accent, 0.09);
  const surfaceAlt = mixHex(surface, welcome, 0.11);
  const border = mixHex(surfaceAlt, accent, 0.2);
  const borderSoft = mixHex(surface, accent, 0.12);
  const divider = mixHex(border, welcome, 0.14);

  return {
    ...BASE_COLOR,
    canvas,
    surface,
    surfaceAlt,
    border,
    borderSoft,
    divider,
    textMuted: mixHex(BASE_COLOR.textMuted, accent, 0.06),
    textFaint: mixHex(BASE_COLOR.textFaint, accent, 0.12),
    accent,
    accentSoft: mixHex(accent, canvas, 0.58),
  };
}

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

let COLOR: ShellPalette = {
  ...BASE_COLOR,
  accent: "#a78bfa",
  accentSoft: mixHex("#a78bfa", BASE_COLOR.canvas, 0.45),
};

function truncateToolDetail(value: string, max = 140): string {
  const normalized = value.replace(/\s+/gu, " ").trim();
  if (normalized.length <= max) {
    return normalized;
  }
  return `${normalized.slice(0, Math.max(0, max - 1)).trimEnd()}…`;
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

function renderShortcuts(snapshot: OmniUiSnapshot): string {
  const abort = snapshot.session.streaming ? "esc abort  ·  " : "";
  return `${abort}enter send  ·  ctrl+k commands  ·  ctrl+p model  ·  /providers setup`;
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
    ASCIIFontRenderable,
  } = openTui;

  COLOR = buildPalette(controller.state);
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

  // --- Body: conversation + right rail ----------------------------------
  const body = new BoxRenderable(renderer, {
    width: "100%",
    flexGrow: 1,
    flexDirection: "row",
    backgroundColor: COLOR.canvas,
  });

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
  let uiSnapshot = standaloneStateToOmniUiSnapshot(controller.state);

  const workflowText = new TextRenderable(renderer, {
    content: renderOmniUiWorkflowPanel(uiSnapshot.workflow),
    fg: COLOR.textMuted,
  });
  workflowPanel.add(workflowText);

  const todoPanel = new BoxRenderable(renderer, {
    border: true,
    borderColor: COLOR.borderSoft,
    borderStyle: "rounded",
    title: " todos ",
    titleAlignment: "left",
    paddingLeft: 1,
    paddingRight: 1,
    paddingTop: 0,
    paddingBottom: 0,
    backgroundColor: COLOR.canvas,
  });
  const todoText = new TextRenderable(renderer, {
    content: renderOmniUiTodoPanel(uiSnapshot),
    fg: COLOR.textMuted,
  });
  todoPanel.add(todoText);

  sidebarColumn.add(workflowPanel);
  sidebarColumn.add(todoPanel);

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

  const dialogOverlay: BoxRenderable = new BoxRenderable(renderer, {
    id: "standalone-dialog-overlay",
    position: "absolute",
    top: 0,
    left: 0,
    width: "100%",
    height: "100%",
    zIndex: 100,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: COLOR.canvas,
    opacity: 0.96,
    visible: false,
  });

  const dialogBox: BoxRenderable = new BoxRenderable(renderer, {
    id: "standalone-dialog",
    width: Math.max(56, Math.min(terminalWidth - 8, 96)),
    maxWidth: "92%",
    maxHeight: "85%",
    flexDirection: "column",
    border: true,
    borderStyle: "rounded",
    borderColor: COLOR.border,
    paddingLeft: 2,
    paddingRight: 2,
    paddingTop: 1,
    paddingBottom: 1,
    backgroundColor: COLOR.surface,
    shouldFill: true,
  });
  dialogOverlay.add(dialogBox);

  const SLASH_VISIBLE_MAX = 6;
  let slashMatches = filterStandaloneSlashCommands("");
  let slashIndex = 0;
  let dialogWasActive = Boolean(controller.state.dialog);
  let suppressHistoryReset = false;
  let composerAttachments: ComposerAttachment[] = [];

  const syncComposerAttachments = () => {
    composerAttachments = pruneComposerAttachments(
      input.value,
      composerAttachments,
    );
  };

  const setInputValue = (value: string) => {
    suppressHistoryReset = true;
    input.value = value;
    suppressHistoryReset = false;
  };

  const insertImageAttachment = (imagePath: string) => {
    syncComposerAttachments();
    const token = createImageAttachmentToken(composerAttachments.length + 1);
    composerAttachments = [
      ...composerAttachments,
      { token, path: imagePath, kind: "image" },
    ];
    setInputValue(appendAttachmentToken(input.value, token));
    input.focus();
    refreshSlashPopover();
    renderer.requestRender();
  };

  const maybeHandleImagePathPaste = (text: string): boolean => {
    const candidate = text.trim();
    if (!candidate || !existsSync(candidate)) return false;
    if (!/\.(png|jpe?g|gif|webp)$/iu.test(candidate)) return false;
    insertImageAttachment(candidate);
    return true;
  };

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

  const renderDialog = (state: OmniStandaloneAppState) => {
    for (const child of dialogBox.getChildren()) {
      dialogBox.remove(child.id);
    }

    const dialog = state.dialog;
    if (!dialog) {
      dialogOverlay.visible = false;
      return;
    }

    const isModelPicker =
      dialog.kind === "select" && dialog.title === "Switch model";
    const isProviderPicker = isModelPicker && dialog.pickerMode === "provider";
    dialogBox.title = isModelPicker
      ? " model picker "
      : ` ${dialog.title.toLowerCase()} `;
    dialogBox.titleAlignment = "center";
    dialogOverlay.visible = true;

    const title = new TextRenderable(renderer, {
      id: "dialog-title",
      content: dialog.title,
      fg: COLOR.accent,
    });
    dialogBox.add(title);

    if (dialog.message) {
      dialogBox.add(
        new TextRenderable(renderer, {
          id: "dialog-message",
          content: dialog.message,
          fg: COLOR.textMuted,
        }),
      );
    }

    if (isModelPicker) {
      const searchBox = new BoxRenderable(renderer, {
        id: "dialog-search-box",
        width: "100%",
        flexDirection: "column",
        border: true,
        borderStyle: "rounded",
        borderColor: COLOR.borderSoft,
        paddingLeft: 1,
        paddingRight: 1,
        paddingTop: 0,
        paddingBottom: 0,
        marginTop: 1,
        backgroundColor: COLOR.surface,
      });
      searchBox.add(
        new TextRenderable(renderer, {
          id: "dialog-search-label",
          content: "search",
          fg: COLOR.textFaint,
        }),
      );
      searchBox.add(
        new TextRenderable(renderer, {
          id: "dialog-search-value",
          content:
            (dialog.query ?? "").trim().length > 0
              ? (dialog.query ?? "")
              : "Type to filter…",
          fg:
            (dialog.query ?? "").trim().length > 0
              ? COLOR.text
              : COLOR.textMuted,
        }),
      );
      dialogBox.add(searchBox);
    }

    if (
      dialog.kind === "select" ||
      dialog.kind === "confirm" ||
      dialog.kind === "scoped-models" ||
      dialog.kind === "theme"
    ) {
      const options =
        dialog.kind === "confirm"
          ? (dialog.options ?? [])
          : (dialog.options ?? []).filter((option) => {
              const query = (dialog.query ?? "").trim().toLowerCase();
              if (!query) return true;
              const haystack =
                `${option.label} ${option.searchText ?? ""} ${option.detail ?? ""}`.toLowerCase();
              return haystack.includes(query);
            });
      const selectedIndex = Math.min(
        dialog.selectedIndex ?? 0,
        Math.max(0, options.length - 1),
      );
      const visibleMax = isModelPicker ? SLASH_VISIBLE_MAX : SLASH_VISIBLE_MAX;
      const windowStart = Math.min(
        Math.max(0, selectedIndex - visibleMax + 1),
        Math.max(0, options.length - visibleMax),
      );
      const windowEnd = Math.min(options.length, windowStart + visibleMax);

      for (let index = windowStart; index < windowEnd; index += 1) {
        const option = options[index];
        const selected = index === selectedIndex;
        const isScoped = dialog.kind === "scoped-models";
        const scopedSelected =
          isScoped &&
          dialog.selectedValues?.includes(option?.value ?? "") === true;
        const row = new BoxRenderable(renderer, {
          id: `dialog-row-${index}`,
          width: "100%",
          flexDirection: "column",
          border: isModelPicker,
          borderStyle: isModelPicker ? "rounded" : "single",
          borderColor: selected ? COLOR.accent : COLOR.borderSoft,
          paddingLeft: isModelPicker ? 1 : 1,
          paddingRight: isModelPicker ? 1 : 1,
          paddingTop: isModelPicker ? 0 : 0,
          paddingBottom: isModelPicker ? 0 : 0,
          marginTop: 1,
          backgroundColor: selected ? COLOR.surfaceAlt : COLOR.surface,
        });

        if (isModelPicker) {
          row.add(
            new TextRenderable(renderer, {
              id: `dialog-label-${index}`,
              content: `${selected ? "→" : " "} ${option?.label ?? ""}`,
              fg: selected ? COLOR.accent : COLOR.text,
            }),
          );
          if (option?.detail) {
            row.add(
              new TextRenderable(renderer, {
                id: `dialog-detail-${index}`,
                content: `  ${option.detail}`,
                fg: isProviderPicker
                  ? COLOR.textMuted
                  : selected
                    ? COLOR.textMuted
                    : COLOR.textFaint,
              }),
            );
          }
        } else {
          row.add(
            new TextRenderable(renderer, {
              id: `dialog-label-${index}`,
              content: `${isScoped ? (scopedSelected ? "☑" : "☐") : selected ? "→" : " "} ${option?.label ?? ""}`,
              fg: selected ? COLOR.accent : COLOR.text,
            }),
          );
          if (option?.detail) {
            row.add(
              new TextRenderable(renderer, {
                id: `dialog-detail-${index}`,
                content: `  ${option.detail}`,
                fg: COLOR.textMuted,
              }),
            );
          }
        }
        dialogBox.add(row);
      }

      dialogBox.add(
        new TextRenderable(renderer, {
          id: "dialog-hint",
          content:
            dialog.kind === "confirm"
              ? " ↑↓ choose  ·  enter confirm  ·  esc cancel"
              : dialog.kind === "scoped-models"
                ? " type to search  ·  space toggle  ·  ↑↓ choose  ·  enter save  ·  esc cancel"
                : dialog.kind === "theme"
                  ? " type to search  ·  ↑↓ preview  ·  enter save  ·  esc cancel"
                  : isModelPicker
                    ? isProviderPicker
                      ? " type to search  ·  ↑↓ choose  ·  enter continue  ·  esc cancel"
                      : " type to search  ·  ↑↓ choose  ·  enter switch  ·  esc cancel"
                    : " type to search  ·  ↑↓ choose  ·  enter select  ·  esc cancel",
          fg: COLOR.textFaint,
        }),
      );
    } else {
      dialogBox.add(
        new TextRenderable(renderer, {
          id: "dialog-hint",
          content:
            dialog.kind === "editor"
              ? " edit in the prompt bar below  ·  enter submit  ·  esc cancel"
              : " type in the prompt bar below  ·  enter submit  ·  esc cancel",
          fg: COLOR.textFaint,
        }),
      );
    }
  };

  const refreshSlashPopover = () => {
    if (controller.state.dialog) {
      slashMatches = [];
      slashIndex = 0;
      popover.visible = false;
      renderer.requestRender();
      return;
    }
    const matches = filterStandaloneSlashCommands(input.value);
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

  const completeSelectedCommand = (submitIfNoArgs = false) => {
    const selected = slashMatches[slashIndex];
    if (!selected) return;
    const commandText = `/${selected.name}`;
    slashMatches = [];
    slashIndex = 0;
    popover.visible = false;
    if (submitIfNoArgs && !selected.args) {
      setInputValue("");
      controller.resetPromptHistoryNavigation();
      input.focus();
      void controller.submitPrompt(commandText).catch((error: unknown) => {
        console.error(error instanceof Error ? error.message : String(error));
      });
      renderer.requestRender();
      return;
    }
    setInputValue(selected.args ? `${commandText} ` : commandText);
    controller.resetPromptHistoryNavigation();
    input.focus();
    renderer.requestRender();
  };

  const openCommandPaletteFromComposer = () => {
    if (controller.state.dialog) {
      return;
    }
    setInputValue("/");
    controller.resetPromptHistoryNavigation();
    refreshSlashPopover();
    input.focus();
    renderer.requestRender();
  };

  const focusComposerFromMouse = () => {
    if (controller.state.dialog) {
      return;
    }
    input.focus();
    renderer.requestRender();
  };

  root.onMouseDown = focusComposerFromMouse;
  body.onMouseDown = focusComposerFromMouse;
  conversationColumn.onMouseDown = focusComposerFromMouse;
  conversationScroll.onMouseDown = focusComposerFromMouse;
  conversationStack.onMouseDown = focusComposerFromMouse;
  sidebarColumn.onMouseDown = focusComposerFromMouse;
  inputDock.onMouseDown = focusComposerFromMouse;
  popover.onMouseDown = focusComposerFromMouse;

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
    if (controller.state.dialog) {
      void controller.submitDialog().catch((error: unknown) => {
        console.error(error instanceof Error ? error.message : String(error));
      });
      return;
    }

    if (
      popover.visible &&
      slashMatches.length > 0 &&
      input.value.startsWith("/") &&
      !input.value.slice(1).includes(" ")
    ) {
      completeSelectedCommand(true);
      return;
    }

    const displayValue = input.value;
    syncComposerAttachments();
    const submittedValue = expandComposerAttachments(
      displayValue,
      composerAttachments,
    );
    setInputValue("");
    composerAttachments = [];
    controller.resetPromptHistoryNavigation();
    slashMatches = [];
    slashIndex = 0;
    popover.visible = false;
    input.focus();
    void controller
      .submitPrompt(submittedValue, displayValue)
      .catch((error: unknown) => {
        console.error(error instanceof Error ? error.message : String(error));
      });
  });
  input.on(InputRenderableEvents.INPUT, () => {
    if (controller.state.dialog) {
      controller.updateDialogInput(input.value);
      renderDialog(controller.state);
      renderer.requestRender();
      return;
    }
    if (!suppressHistoryReset) {
      controller.resetPromptHistoryNavigation();
    }
    syncComposerAttachments();
    refreshSlashPopover();
  });
  const defaultHandlePaste = input.handlePaste.bind(input);
  input.handlePaste = (event) => {
    if (controller.state.dialog) {
      defaultHandlePaste(event);
      return;
    }

    const mimeType = event.metadata?.mimeType;
    if (mimeType?.startsWith("image/")) {
      event.preventDefault();
      void writeClipboardImageTemp(event.bytes, mimeType)
        .then((imagePath) => {
          insertImageAttachment(imagePath);
        })
        .catch((error: unknown) => {
          console.error(error instanceof Error ? error.message : String(error));
        });
      return;
    }

    const pastedText = new TextDecoder().decode(event.bytes);
    if (maybeHandleImagePathPaste(pastedText)) {
      event.preventDefault();
      return;
    }

    defaultHandlePaste(event);
  };
  input.onKeyDown = (key) => {
    if (controller.state.dialog) {
      if (key.name === "up") {
        key.preventDefault();
        controller.moveDialogSelection(-1);
        return;
      }
      if (key.name === "down") {
        key.preventDefault();
        controller.moveDialogSelection(1);
        return;
      }
      if (key.name === "space") {
        key.preventDefault();
        controller.toggleDialogSelection();
        return;
      }
      if (key.name === "escape") {
        key.preventDefault();
        void controller.cancelDialog();
        return;
      }
      return;
    }

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
    if (key.name === "up") {
      key.preventDefault();
      const previous = controller.getPreviousPromptHistory(input.value);
      if (previous !== undefined) {
        setInputValue(previous);
        popover.visible = false;
        slashMatches = [];
        slashIndex = 0;
        input.focus();
        renderer.requestRender();
      }
      return;
    }
    if (key.name === "down") {
      key.preventDefault();
      const next = controller.getNextPromptHistory(input.value);
      if (next !== undefined) {
        setInputValue(next);
        refreshSlashPopover();
        input.focus();
        renderer.requestRender();
      }
      return;
    }
    if (key.name === "escape") {
      key.preventDefault();
      void controller.abort();
    }
    if (key.ctrl && key.name === "k") {
      key.preventDefault();
      openCommandPaletteFromComposer();
    }
    if (key.ctrl && key.name === "p") {
      key.preventDefault();
      void controller.openModelPicker().catch((error: unknown) => {
        console.error(error instanceof Error ? error.message : String(error));
      });
    }
  };
  inputRow.add(promptCaret);
  inputRow.add(input);

  const footerMetaRow = new BoxRenderable(renderer, {
    width: "100%",
    paddingTop: 0,
    paddingBottom: 0,
    backgroundColor: COLOR.canvas,
  });
  const footerMetaText = new TextRenderable(renderer, {
    content: renderOmniUiFooterMeta(uiSnapshot),
    fg: COLOR.textMuted,
  });
  footerMetaRow.add(footerMetaText);

  const shortcutsRow = new BoxRenderable(renderer, {
    width: "100%",
    paddingTop: 0,
    paddingBottom: 1,
    backgroundColor: COLOR.canvas,
  });
  const shortcutsText = new TextRenderable(renderer, {
    content: renderShortcuts(uiSnapshot),
    fg: COLOR.textFaint,
  });
  shortcutsRow.add(shortcutsText);

  inputDock.add(popover);
  inputDock.add(inputRow);
  inputDock.add(footerMetaRow);
  inputDock.add(shortcutsRow);

  root.add(body);
  root.add(inputDock);
  root.add(dialogOverlay);
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
    wrapper.onMouseDown = focusComposerFromMouse;
    wordmark.onMouseDown = focusComposerFromMouse;
    tagline.onMouseDown = focusComposerFromMouse;
    hint.onMouseDown = focusComposerFromMouse;
    wrapper.add(wordmark);
    wrapper.add(tagline);
    wrapper.add(hint);
    return wrapper;
  };

  // --- Conversation renderer -------------------------------------------
  const renderConversation = (snapshot: OmniUiSnapshot) => {
    for (const child of conversationStack.getChildren()) {
      conversationStack.remove(child.id);
    }

    if (snapshot.conversation.length === 0) {
      conversationScroll.verticalScrollBar.visible = false;
      conversationStack.add(buildEmptyState());
      return;
    }

    conversationScroll.verticalScrollBar.resetVisibilityControl();

    for (const item of snapshot.conversation) {
      if (item.role === "user") {
        const card = new BoxRenderable(renderer, {
          id: `${item.id}-card`,
          width: "100%",
          flexDirection: "column",
          border: ["left"],
          borderColor: COLOR.userAccent,
          paddingLeft: 2,
          paddingRight: 1,
          paddingTop: 0,
          paddingBottom: 0,
          backgroundColor: COLOR.surface,
        });
        const label = new TextRenderable(renderer, {
          id: `${item.id}-label`,
          content: "you",
          fg: COLOR.userAccent,
        });
        const text = new TextRenderable(renderer, {
          id: `${item.id}-text`,
          content: formatMarkdownForTerminal(item.text),
          fg: COLOR.text,
        });
        card.onMouseDown = focusComposerFromMouse;
        label.onMouseDown = focusComposerFromMouse;
        text.onMouseDown = focusComposerFromMouse;
        card.add(label);
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
        notice.onMouseDown = focusComposerFromMouse;
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
        paddingTop: 0,
        paddingBottom: 0,
        backgroundColor: COLOR.canvas,
      });
      const column = new BoxRenderable(renderer, {
        id: `${item.id}-col`,
        flexGrow: 1,
        flexDirection: "column",
        gap: 0,
        backgroundColor: COLOR.canvas,
      });

      const title = new TextRenderable(renderer, {
        id: `${item.id}-title`,
        content: item.statusText ? `omni  ·  ${item.statusText}` : "omni",
        fg: item.streaming ? COLOR.accent : COLOR.textMuted,
      });
      title.onMouseDown = focusComposerFromMouse;
      column.add(title);

      if (item.toolCalls && item.toolCalls.length > 0) {
        const toolsBox = new BoxRenderable(renderer, {
          id: `${item.id}-tools`,
          flexDirection: "column",
          gap: 0,
          marginTop: 0,
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
          toolRow.onMouseDown = focusComposerFromMouse;
          glyphText.onMouseDown = focusComposerFromMouse;
          nameText.onMouseDown = focusComposerFromMouse;
          toolRow.add(glyphText);
          toolRow.add(nameText);
          toolsBox.add(toolRow);
          if (toolCall.input) {
            const inputLine = new TextRenderable(renderer, {
              id: `${toolCall.id}-input`,
              content: `  input  ${truncateToolDetail(formatMarkdownForTerminal(toolCall.input))}`,
              fg: COLOR.textFaint,
            });
            inputLine.onMouseDown = focusComposerFromMouse;
            toolsBox.add(inputLine);
          }
          if (toolCall.output) {
            const outputLine = new TextRenderable(renderer, {
              id: `${toolCall.id}-output`,
              content: `  output ${truncateToolDetail(formatMarkdownForTerminal(toolCall.output))}`,
              fg: COLOR.textFaint,
            });
            outputLine.onMouseDown = focusComposerFromMouse;
            toolsBox.add(outputLine);
          }
        }
        column.add(toolsBox);
      }

      if (item.text.trim()) {
        const body = new TextRenderable(renderer, {
          id: `${item.id}-body`,
          content: formatMarkdownForTerminal(item.text.trim()),
          fg: COLOR.text,
        });
        body.onMouseDown = focusComposerFromMouse;
        column.add(body);
      } else if (
        item.streaming &&
        (!item.toolCalls || item.toolCalls.length === 0)
      ) {
        const thinking = new TextRenderable(renderer, {
          id: `${item.id}-thinking`,
          content: item.statusText ? item.statusText : "thinking…",
          fg: COLOR.textMuted,
        });
        thinking.onMouseDown = focusComposerFromMouse;
        column.add(thinking);
      }

      card.onMouseDown = focusComposerFromMouse;
      column.onMouseDown = focusComposerFromMouse;
      card.add(column);
      conversationStack.add(card);
    }
  };

  const unsubscribeQuit =
    "onQuit" in controller
      ? controller.onQuit(() => {
          renderer.destroy();
        })
      : () => {};

  const unsubscribe = controller.onChange((state) => {
    uiSnapshot = standaloneStateToOmniUiSnapshot(state);
    COLOR = buildPalette(state);
    renderer.setBackgroundColor(COLOR.canvas);
    root.backgroundColor = COLOR.canvas;
    body.backgroundColor = COLOR.canvas;
    conversationColumn.backgroundColor = COLOR.canvas;
    conversationStack.backgroundColor = COLOR.canvas;
    sidebarColumn.backgroundColor = COLOR.canvas;
    sidebarColumn.borderColor = COLOR.border;
    workflowPanel.borderColor = COLOR.borderSoft;
    todoPanel.borderColor = COLOR.borderSoft;
    inputDock.backgroundColor = COLOR.canvas;
    inputDock.borderColor = COLOR.border;
    popover.borderColor = COLOR.border;
    popover.backgroundColor = COLOR.surface;
    dialogOverlay.backgroundColor = COLOR.canvas;
    dialogBox.borderColor = COLOR.border;
    dialogBox.backgroundColor = COLOR.surface;
    inputRow.backgroundColor = COLOR.canvas;
    promptCaret.fg = COLOR.accent;
    footerMetaRow.backgroundColor = COLOR.canvas;
    footerMetaText.fg = COLOR.textMuted;
    shortcutsRow.backgroundColor = COLOR.canvas;
    shortcutsText.fg = COLOR.textFaint;
    shortcutsText.content = renderShortcuts(uiSnapshot);
    footerMetaText.content = renderOmniUiFooterMeta(uiSnapshot);
    renderConversation(uiSnapshot);
    workflowText.fg = COLOR.text;
    workflowText.content = renderOmniUiWorkflowPanel(uiSnapshot.workflow);
    todoText.fg = COLOR.text;
    todoText.content = renderOmniUiTodoPanel(uiSnapshot);
    renderDialog(state);

    if (state.dialog) {
      input.placeholder =
        state.dialog.placeholder ??
        (state.dialog.kind === "select" ||
        state.dialog.kind === "scoped-models" ||
        state.dialog.kind === "theme"
          ? "Type to search…"
          : state.dialog.kind === "editor"
            ? "Edit text…"
            : "Enter a value…");
      const desiredValue =
        state.dialog.kind === "select" ||
        state.dialog.kind === "scoped-models" ||
        state.dialog.kind === "theme"
          ? (state.dialog.query ?? "")
          : (state.dialog.value ?? "");
      if (input.value !== desiredValue) {
        setInputValue(desiredValue);
      }
      popover.visible = false;
    } else {
      input.placeholder = "Ask Omni…  (type / for commands)";
      if (dialogWasActive) {
        setInputValue("");
      }
    }

    dialogWasActive = Boolean(state.dialog);
    conversationScroll.scrollTo({ y: conversationScroll.scrollHeight, x: 0 });
    renderer.requestRender();
  });

  // Seed the initial empty state once so the wordmark shows before RPC loads.
  renderConversation(uiSnapshot);
  renderDialog(controller.state);

  return {
    teardown: () => {
      unsubscribe();
      unsubscribeQuit();
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
