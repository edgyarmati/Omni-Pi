import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

export interface SyncRequest {
  summary: string;
  decisions?: string[];
  nextHandoffNotes?: string[];
}

async function appendBullets(
  filePath: string,
  heading: string,
  bullets: string[],
): Promise<void> {
  if (bullets.length === 0) {
    return;
  }

  const content = await readFile(filePath, "utf8");
  const escapedHeading = heading.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  const sectionRegex = new RegExp(
    `(${escapedHeading}\\n\\n)([\\s\\S]*?)(?=\\n## |$)`,
    "u",
  );
  const match = content.match(sectionRegex);
  if (!match) {
    await writeFile(
      filePath,
      `${content.trimEnd()}\n\n${heading}\n\n${bullets.map((bullet) => `- ${bullet}`).join("\n")}\n`,
      "utf8",
    );
    return;
  }

  const prefix = match[1];
  const body = match[2].trimEnd();
  const merged = [body, ...bullets.map((bullet) => `- ${bullet}`)]
    .filter(Boolean)
    .join("\n");
  await writeFile(
    filePath,
    content.replace(sectionRegex, `${prefix}${merged}\n`),
    "utf8",
  );
}

export async function syncOmniMemory(
  rootDir: string,
  request: SyncRequest,
): Promise<void> {
  const sessionPath = path.join(rootDir, ".omni", "SESSION-SUMMARY.md");
  const decisionsPath = path.join(rootDir, ".omni", "DECISIONS.md");

  await appendBullets(sessionPath, "## Recent progress", [request.summary]);
  await appendBullets(
    sessionPath,
    "## Next handoff notes",
    request.nextHandoffNotes ?? [],
  );

  if (request.decisions && request.decisions.length > 0) {
    const decisionLines = request.decisions.map(
      (decision) =>
        `Date: pending\n  - Decision: ${decision}\n  - Why: Captured during sync.\n  - Impact: To be refined.`,
    );
    const content = await readFile(decisionsPath, "utf8");
    const next = `${content.trimEnd()}\n${decisionLines.map((line) => `\n- ${line}`).join("\n")}\n`;
    await writeFile(decisionsPath, next, "utf8");
  }
}
