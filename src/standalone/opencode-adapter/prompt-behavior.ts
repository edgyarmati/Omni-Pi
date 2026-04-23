/**
 * Prompt behavior helpers adapted from OpenCode prompt modules:
 * - vendor/opencode-tui/component/prompt/history.tsx
 * - vendor/opencode-tui/component/prompt/index.tsx
 *
 * These helpers are framework-agnostic and used by Omni standalone shell/controller.
 */

export interface PromptHistoryCursor {
  index: number;
  draft: string;
}

export function movePromptHistory(
  history: string[],
  cursor: PromptHistoryCursor,
  direction: 1 | -1,
  currentInput: string,
): { value?: string; cursor: PromptHistoryCursor } {
  if (history.length === 0) {
    return { value: undefined, cursor };
  }

  if (cursor.index === 0) {
    const current = history.at(cursor.index - 1);
    if (current && current !== currentInput && currentInput.length > 0) {
      return { value: undefined, cursor };
    }
  }

  const nextIndex = cursor.index + direction;
  if (Math.abs(nextIndex) > history.length) {
    return { value: undefined, cursor };
  }

  if (nextIndex > 0) {
    return { value: undefined, cursor };
  }

  const nextCursor: PromptHistoryCursor = {
    index: nextIndex,
    draft: cursor.index === 0 && direction === -1 ? currentInput : cursor.draft,
  };

  if (nextIndex === 0) {
    return { value: nextCursor.draft, cursor: nextCursor };
  }

  return {
    value: history.at(nextIndex) ?? "",
    cursor: nextCursor,
  };
}

export function isSlashPopoverVisible(input: string): boolean {
  if (!input.startsWith("/")) return false;
  const rest = input.slice(1);
  return !rest.includes(" ");
}

export function stripPromptUiMetadata(input: string): string {
  return input
    .replace(/\u0000/g, "")
    .replace(/\r\n/g, "\n")
    .replace(/[\u0001-\u0008\u000b\u000c\u000e-\u001f\u007f]/gu, "")
    .trim();
}

export function applySlashSelection(input: {
  commandName: string;
  hasArgs: boolean;
  submitIfNoArgs: boolean;
}): { nextInput: string; shouldSubmit: boolean } {
  const commandText = `/${input.commandName}`;
  if (input.submitIfNoArgs && !input.hasArgs) {
    return { nextInput: "", shouldSubmit: true };
  }

  return {
    nextInput: input.hasArgs ? `${commandText} ` : commandText,
    shouldSubmit: false,
  };
}
