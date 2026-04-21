import type {
  OmniStandaloneAppState,
  OmniStandaloneConversationItem,
  OmniStandaloneStatusItem,
  OmniStandaloneToolCall,
  OmniStandaloneWorkflowSnapshot,
} from "./contracts.js";

// biome-ignore lint/suspicious/noControlCharactersInRegex: intentional — stripping control bytes from untrusted text
const ANSI_PATTERN = /\u001b\[[0-9;?]*[ -/]*[@-~]/gu;
const TURN_SEPARATOR = "·".repeat(22);

function stripAnsi(text: string): string {
  return (
    text
      .replace(ANSI_PATTERN, "")
      // biome-ignore lint/suspicious/noControlCharactersInRegex: intentional — stripping control bytes from untrusted text
      .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/gu, "")
  );
}

function cleanupInlineMarkdown(text: string): string {
  return stripAnsi(text)
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, "$1 ($2)")
    .replace(/!\[([^\]]*)\]\(([^)]+)\)/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/__([^_]+)__/g, "$1")
    .replace(/(^|[^*])\*([^*\n]+)\*(?!\*)/g, "$1$2")
    .replace(/(^|[^_])_([^_\n]+)_(?!_)/g, "$1$2")
    .replace(/([.!?])([A-Z])/g, "$1 $2");
}

function splitMarkdownRow(row: string): string[] {
  return row
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((cell) => cleanupInlineMarkdown(cell.trim()));
}

function isMarkdownTableSeparator(line: string): boolean {
  return /^\s*\|?(?:\s*:?-{3,}:?\s*\|)+\s*:?-{3,}:?\s*\|?\s*$/u.test(line);
}

function isMarkdownTableRow(line: string): boolean {
  return /\|/.test(line.trim());
}

function padCell(value: string, width: number): string {
  return value.padEnd(width, " ");
}

function renderMarkdownTable(lines: string[]): string {
  const rows = lines.map(splitMarkdownRow).filter((row) => row.length > 0);
  if (rows.length < 2) {
    return lines.join("\n");
  }

  const header = rows[0] ?? [];
  const body = rows.slice(2);
  const columnCount = Math.max(...rows.map((row) => row.length), 0);
  const normalized = [header, ...body].map((row) =>
    Array.from({ length: columnCount }, (_, index) => row[index] ?? ""),
  );
  const widths = Array.from({ length: columnCount }, (_, index) =>
    Math.max(...normalized.map((row) => row[index]?.length ?? 0), 3),
  );

  const border = (left: string, middle: string, right: string) =>
    `${left}${widths.map((width) => "─".repeat(width + 2)).join(middle)}${right}`;
  const renderRow = (row: string[]) =>
    `│ ${row.map((cell, index) => padCell(cell, widths[index] ?? 3)).join(" │ ")} │`;

  return [
    border("┌", "┬", "┐"),
    renderRow(normalized[0] ?? []),
    border("├", "┼", "┤"),
    ...normalized.slice(1).map(renderRow),
    border("└", "┴", "┘"),
  ].join("\n");
}

function formatMarkdownBlocks(markdown: string): string {
  const normalized = cleanupInlineMarkdown(markdown).replace(/\r\n/g, "\n");
  const lines = normalized.split("\n");
  const output: string[] = [];

  for (let index = 0; index < lines.length; index += 1) {
    const current = lines[index] ?? "";
    const next = lines[index + 1] ?? "";
    if (isMarkdownTableRow(current) && isMarkdownTableSeparator(next)) {
      const tableLines = [current, next];
      let cursor = index + 2;
      while (cursor < lines.length && isMarkdownTableRow(lines[cursor] ?? "")) {
        tableLines.push(lines[cursor] ?? "");
        cursor += 1;
      }
      output.push(renderMarkdownTable(tableLines));
      index = cursor - 1;
      continue;
    }
    output.push(current);
  }

  return output.join("\n");
}

export function formatMarkdownForTerminal(markdown: string): string {
  return formatMarkdownBlocks(markdown)
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/^>\s?/gm, "")
    .replace(/^```[\w-]*\s*$/gm, "")
    .replace(/^~~~[\w-]*\s*$/gm, "")
    .replace(/^\s*[-*+]\s+/gm, "• ")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function truncateLine(value: string, max = 72): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length <= max) {
    return normalized;
  }
  return `${normalized.slice(0, max - 1).trimEnd()}…`;
}

function indentBlock(text: string, prefix = "  "): string {
  return text
    .split("\n")
    .map((line) => (line ? `${prefix}${line}` : prefix.trimEnd()))
    .join("\n");
}

function renderToolCall(toolCall: OmniStandaloneToolCall): string {
  const suffix =
    toolCall.status === "running"
      ? "running…"
      : toolCall.status === "done"
        ? "done"
        : toolCall.status === "failed"
          ? "failed"
          : "queued";
  return `↳ ${toolCall.name} · ${suffix}`;
}

function renderConversationItem(item: OmniStandaloneConversationItem): string {
  const title =
    item.role === "user"
      ? "You"
      : item.role === "assistant"
        ? item.statusText
          ? `Omni · ${truncateLine(item.statusText, 40)}`
          : "Omni"
        : "Notice";

  const lines: string[] = [title];
  if (
    item.role === "assistant" &&
    item.toolCalls &&
    item.toolCalls.length > 0
  ) {
    lines.push(
      ...item.toolCalls.map((toolCall) => `  ${renderToolCall(toolCall)}`),
    );
  }

  const text = formatMarkdownForTerminal(item.text);
  if (text) {
    lines.push(indentBlock(text));
  } else if (item.role === "assistant" && item.streaming) {
    lines.push("  Thinking…");
  }

  return lines.join("\n");
}

export function renderConversationLines(state: OmniStandaloneAppState): string {
  if (state.conversation.length === 0) {
    const lines = [
      "Omni",
      "  Welcome to Omni standalone.",
    ];

    if (state.providers.availableModelCount === 0) {
      lines.push(
        `  ${state.providers.summary ?? "No models are available yet."}`,
        `  ${state.providers.recommendedAction ?? "Open /providers to connect or refresh providers."}`,
      );
    } else {
      lines.push(
        `  ${state.providers.summary ?? `Ready with ${state.providers.availableModelCount} available models.`}`,
        "  Type a prompt below. Use Ctrl+P or /model to switch models.",
      );
    }

    lines.push("  Use /help for session, provider, and queue controls.");
    return lines.join("\n");
  }

  return state.conversation
    .map((item) => renderConversationItem(item))
    .join(`\n\n${TURN_SEPARATOR}\n\n`);
}

function renderStatusLines(statuses: OmniStandaloneStatusItem[]): string[] {
  return statuses
    .slice(0, 4)
    .map(
      (item) =>
        `${item.key}  ${truncateLine(formatMarkdownForTerminal(item.text), 80)}`,
    );
}

export function renderFooterMeta(state: OmniStandaloneAppState): string {
  const segments = [
    `model ${truncateLine(state.session.modelLabel ?? "default", 24)}`,
    `thinking ${truncateLine(state.session.thinkingLevel ?? "default", 12)}`,
    `models ${state.providers.availableModelCount}`,
    `providers ${state.providers.connectedProviderCount}/${Math.max(state.providers.configuredProviderCount, state.providers.connectedProviderCount)}`,
    `queue ${state.session.steeringQueue.length + state.session.followUpQueue.length}`,
  ];

  const sessionName = state.session.sessionName ?? state.session.sessionId;
  if (sessionName) {
    const normalizedSession = sessionName.startsWith("session-")
      ? sessionName.slice("session-".length)
      : sessionName;
    segments.push(truncateLine(normalizedSession, 20));
  }

  if (state.statuses.length > 0) {
    segments.push(truncateLine(renderStatusLines(state.statuses).join(" · "), 60));
  }

  return segments.join("  ·  ");
}

export function renderSessionPanel(state: OmniStandaloneAppState): string {
  return renderFooterMeta(state);
}

function cleanWorkflowLine(
  value: string | undefined,
  fallback = "—",
  max = 240,
): string {
  const trimmed = truncateLine(formatMarkdownForTerminal(value ?? ""), max);
  return trimmed || fallback;
}

function isMeaningfulBlocker(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  if (!normalized) return false;
  return (
    !normalized.startsWith("none") &&
    normalized !== "n/a" &&
    normalized !== "-" &&
    normalized !== "—"
  );
}

export function renderWorkflowPanel(
  workflow: OmniStandaloneWorkflowSnapshot,
): string {
  const phase = cleanWorkflowLine(workflow.phase, "—", 20);
  const task = cleanWorkflowLine(workflow.activeTask, "", 160);

  const lines: string[] = [];
  lines.push(task ? `${phase}  ·  ${task}` : phase);

  const summary = cleanWorkflowLine(workflow.statusSummary, "", 260);
  if (summary) {
    lines.push("", summary);
  }

  const next = cleanWorkflowLine(workflow.nextStep, "", 240);
  if (next) {
    lines.push("", `→  ${next}`);
  }

  const blockers = cleanWorkflowLine(workflow.blockers, "", 240);
  if (blockers && isMeaningfulBlocker(blockers)) {
    lines.push("", `!  ${blockers}`);
  }

  return lines.join("\n");
}

export function renderRepoMapPanel(state: OmniStandaloneAppState): string {
  return (
    formatMarkdownForTerminal(state.repoMapPreview) ||
    "Repo map cache not available yet."
  );
}

export function renderTodoPanel(state: OmniStandaloneAppState): string {
  if (state.todos.length === 0) {
    return "No active todos.";
  }

  const active =
    state.todos.find((todo) => todo.status === "in_progress") ??
    state.todos.find((todo) => todo.status === "todo") ??
    state.todos[0];
  const lines = [`${state.todos.length} active`, `now  ${truncateLine(active?.title ?? "-", 44)}`];

  for (const todo of state.todos.slice(0, 8)) {
    const glyph =
      todo.status === "in_progress"
        ? "◐"
        : todo.status === "blocked"
          ? "!"
          : "○";
    lines.push(`${glyph} ${truncateLine(todo.title, 48)}`);
  }

  return lines.join("\n");
}
