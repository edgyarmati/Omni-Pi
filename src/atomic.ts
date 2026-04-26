import { randomBytes } from "node:crypto";
import { renameSync, unlinkSync, writeFileSync } from "node:fs";
import { mkdir, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";

// Atomic write helpers. Writes to a sibling temp file in the same
// directory, then renames over the destination. POSIX rename(2) is
// atomic when the source and destination are on the same filesystem,
// so a reader (or a concurrent writer) never observes a partially
// written state file. On Windows the rename is also atomic when the
// destination exists.
//
// The temp suffix includes a random nonce so two concurrent writers
// to the same path don't collide on their temp files.

function tempPathFor(filePath: string): string {
  return `${filePath}.${randomBytes(6).toString("hex")}.tmp`;
}

export async function writeFileAtomic(
  filePath: string,
  content: string | Uint8Array,
): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  const tempPath = tempPathFor(filePath);
  try {
    await writeFile(tempPath, content, "utf8");
    await rename(tempPath, filePath);
  } catch (error) {
    // Best-effort cleanup of the orphaned temp file; ignore failure
    // since the original error is what matters.
    try {
      await unlink(tempPath);
    } catch {
      /* temp may not exist */
    }
    throw error;
  }
}

export function writeFileAtomicSync(
  filePath: string,
  content: string | Uint8Array,
): void {
  const tempPath = tempPathFor(filePath);
  try {
    writeFileSync(tempPath, content, "utf8");
    renameSync(tempPath, filePath);
  } catch (error) {
    try {
      unlinkSync(tempPath);
    } catch {
      /* temp may not exist */
    }
    throw error;
  }
}
