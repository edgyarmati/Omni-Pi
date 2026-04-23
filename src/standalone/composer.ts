import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

export interface ComposerAttachment {
  token: string;
  path: string;
  kind: "image";
}

export const MAX_PROMPT_HISTORY_ENTRIES = 50;

interface StoredPromptHistoryEntry {
  input: string;
}

export function createImageAttachmentToken(index: number): string {
  return `[image${index}]`;
}

export function appendAttachmentToken(draft: string, token: string): string {
  const trimmedEnd = draft.trimEnd();
  if (!trimmedEnd) return token;
  const separator = /\s$/u.test(draft) ? "" : " ";
  return `${draft}${separator}${token}`;
}

export function pruneComposerAttachments(
  draft: string,
  attachments: ComposerAttachment[],
): ComposerAttachment[] {
  return attachments.filter((attachment) => draft.includes(attachment.token));
}

export function expandComposerAttachments(
  draft: string,
  attachments: ComposerAttachment[],
): string {
  let expanded = draft;
  for (const attachment of attachments) {
    expanded = expanded.split(attachment.token).join(attachment.path);
  }
  return expanded;
}

function normalizePromptHistory(items: string[]): string[] {
  const normalized: string[] = [];
  for (const item of items) {
    const trimmed = item.trim();
    if (!trimmed) continue;
    if (normalized.at(-1) === trimmed) continue;
    normalized.push(trimmed);
  }
  return normalized;
}

export async function readDurablePromptHistory(historyFilePath: string): Promise<string[]> {
  try {
    const text = await readFile(historyFilePath, "utf8");
    const parsed = text
      .split("\n")
      .filter(Boolean)
      .map((line) => {
        try {
          return JSON.parse(line) as StoredPromptHistoryEntry;
        } catch {
          return undefined;
        }
      })
      .flatMap((entry) =>
        entry && typeof entry.input === "string" ? [entry.input] : [],
      );

    return normalizePromptHistory(parsed).slice(-MAX_PROMPT_HISTORY_ENTRIES);
  } catch {
    return [];
  }
}

export async function appendDurablePromptHistory(
  historyFilePath: string,
  prompt: string,
): Promise<void> {
  const next = prompt.trim();
  if (!next) return;

  const existing = await readDurablePromptHistory(historyFilePath);
  const merged = normalizePromptHistory([...existing, next]).slice(
    -MAX_PROMPT_HISTORY_ENTRIES,
  );

  await mkdir(path.dirname(historyFilePath), { recursive: true });
  const serialized = merged
    .map((input) => JSON.stringify({ input } satisfies StoredPromptHistoryEntry))
    .join("\n");
  await writeFile(historyFilePath, serialized.length > 0 ? `${serialized}\n` : "", "utf8");
}
