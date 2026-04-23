import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, test } from "vitest";

import {
  appendAttachmentToken,
  appendDurablePromptHistory,
  createImageAttachmentToken,
  expandComposerAttachments,
  pruneComposerAttachments,
  readDurablePromptHistory,
  type ComposerAttachment,
} from "../src/standalone/composer.js";

describe("standalone composer helpers", () => {
  test("creates stable image tokens", () => {
    expect(createImageAttachmentToken(1)).toBe("[image1]");
    expect(createImageAttachmentToken(2)).toBe("[image2]");
  });

  test("appends tokens with sensible spacing", () => {
    expect(appendAttachmentToken("", "[image1]")).toBe("[image1]");
    expect(appendAttachmentToken("look", "[image1]")).toBe("look [image1]");
    expect(appendAttachmentToken("look ", "[image1]")).toBe("look [image1]");
  });

  test("prunes attachments when their token is removed from the draft", () => {
    const attachments: ComposerAttachment[] = [
      { token: "[image1]", path: "/tmp/one.png", kind: "image" },
      { token: "[image2]", path: "/tmp/two.png", kind: "image" },
    ];

    expect(pruneComposerAttachments("hello [image2]", attachments)).toEqual([
      { token: "[image2]", path: "/tmp/two.png", kind: "image" },
    ]);
  });

  test("expands attachment tokens to underlying file paths", () => {
    const attachments: ComposerAttachment[] = [
      { token: "[image1]", path: "/tmp/one.png", kind: "image" },
      { token: "[image2]", path: "/tmp/two.png", kind: "image" },
    ];

    expect(
      expandComposerAttachments("compare [image1] and [image2]", attachments),
    ).toBe("compare /tmp/one.png and /tmp/two.png");
  });

  test("persists and trims durable prompt history", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "omni-composer-"));
    const historyFile = path.join(dir, ".pi", "prompt-history.jsonl");

    await appendDurablePromptHistory(historyFile, "first");
    await appendDurablePromptHistory(historyFile, "second");
    await appendDurablePromptHistory(historyFile, "second");

    expect(await readDurablePromptHistory(historyFile)).toEqual([
      "first",
      "second",
    ]);
  });
});
