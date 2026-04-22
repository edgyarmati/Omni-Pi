export interface ComposerAttachment {
  token: string;
  path: string;
  kind: "image";
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
