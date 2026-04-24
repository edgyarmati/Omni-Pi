import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const MANAGED_PROMPT_FILES = ["commit.md", "push.md"] as const;
const MANAGED_SUBDIR = "zz-omni-pi";

export function ensureBundledPromptTemplates(
  sourceDir: string,
  options?: {
    homeDir?: string;
    targetSubdir?: string;
    promptFiles?: readonly string[];
  },
): string[] {
  const homeDir = options?.homeDir ?? os.homedir();
  const targetSubdir = options?.targetSubdir ?? MANAGED_SUBDIR;
  const promptFiles = options?.promptFiles ?? MANAGED_PROMPT_FILES;
  const targetDir = path.join(homeDir, ".pi", "agent", "prompts", targetSubdir);

  mkdirSync(targetDir, { recursive: true });

  const written: string[] = [];
  for (const file of promptFiles) {
    const sourcePath = path.join(sourceDir, file);
    const targetPath = path.join(targetDir, file);
    const nextContent = readFileSync(sourcePath, "utf8");

    let currentContent: string | null = null;
    try {
      currentContent = readFileSync(targetPath, "utf8");
    } catch {
      currentContent = null;
    }

    if (currentContent === nextContent) {
      continue;
    }

    writeFileSync(targetPath, nextContent, "utf8");
    written.push(targetPath);
  }

  return written;
}
