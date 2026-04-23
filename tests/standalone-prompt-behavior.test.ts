import { describe, expect, test } from "vitest";

import {
  applySlashSelection,
  isSlashPopoverVisible,
  movePromptHistory,
  stripPromptUiMetadata,
  type PromptHistoryCursor,
} from "../src/standalone/opencode-adapter/prompt-behavior.js";

describe("standalone prompt behavior adapter", () => {
  test("moves through history with vendor-style cursor semantics", () => {
    const history = ["first", "second", "third"];
    const cursor: PromptHistoryCursor = { index: 0, draft: "" };

    const up1 = movePromptHistory(history, cursor, -1, "");
    expect(up1.value).toBe("third");

    const up2 = movePromptHistory(history, up1.cursor, -1, "third");
    expect(up2.value).toBe("second");

    const down1 = movePromptHistory(history, up2.cursor, 1, "second");
    expect(down1.value).toBe("third");
  });

  test("detects slash popover visibility state", () => {
    expect(isSlashPopoverVisible("/model")).toBe(true);
    expect(isSlashPopoverVisible("/model openai/gpt")).toBe(false);
    expect(isSlashPopoverVisible("hello")).toBe(false);
  });

  test("strips prompt UI metadata control chars", () => {
    expect(stripPromptUiMetadata("hello\u0000\u0007")).toBe("hello");
  });

  test("applies slash selection flow", () => {
    expect(
      applySlashSelection({
        commandName: "help",
        hasArgs: false,
        submitIfNoArgs: true,
      }),
    ).toEqual({ nextInput: "", shouldSubmit: true });

    expect(
      applySlashSelection({
        commandName: "model",
        hasArgs: true,
        submitIfNoArgs: false,
      }),
    ).toEqual({ nextInput: "/model ", shouldSubmit: false });
  });
});
