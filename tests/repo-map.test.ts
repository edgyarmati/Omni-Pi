import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, test } from "vitest";
import omniCoreExtension from "../extensions/omni-core/index.js";
import { refreshRepoMapState } from "../src/repo-map-index.js";
import {
  getRepoMapDebugSnapshot,
  recordRepoMapSignal,
} from "../src/repo-map-runtime.js";
import { repoMapStatePath } from "../src/repo-map-store.js";
import { saveOmniMode } from "../src/theme.js";

async function createTempProject(prefix: string): Promise<string> {
  return mkdtemp(path.join(os.tmpdir(), prefix));
}

describe("repo map", () => {
  test("stores repo-map cache under .pi and respects .gitignore during discovery", async () => {
    const rootDir = await createTempProject("repo-map-discovery-");
    await mkdir(path.join(rootDir, "src"), { recursive: true });
    await mkdir(path.join(rootDir, "dist"), { recursive: true });
    await writeFile(
      path.join(rootDir, ".gitignore"),
      "dist/\nignored.ts\n",
      "utf8",
    );
    await writeFile(
      path.join(rootDir, "src", "main.ts"),
      "export const main = true;\n",
      "utf8",
    );
    await writeFile(
      path.join(rootDir, "dist", "skip.ts"),
      "export const skip = true;\n",
      "utf8",
    );
    await writeFile(
      path.join(rootDir, "ignored.ts"),
      "export const ignored = true;\n",
      "utf8",
    );

    const result = await refreshRepoMapState(rootDir);
    const stored = JSON.parse(
      await readFile(repoMapStatePath(rootDir), "utf8"),
    ) as {
      files: Record<string, unknown>;
    };

    expect(result.state.files).toHaveProperty("src/main.ts");
    expect(result.state.files).not.toHaveProperty("dist/skip.ts");
    expect(result.state.files).not.toHaveProperty("ignored.ts");
    expect(Object.keys(stored.files)).toEqual(["src/main.ts"]);
    expect(repoMapStatePath(rootDir)).toContain(`${path.sep}.pi${path.sep}`);
  });

  test("re-indexes changed files incrementally without rescanning unchanged files", async () => {
    const rootDir = await createTempProject("repo-map-incremental-");
    await mkdir(path.join(rootDir, "src"), { recursive: true });
    await writeFile(
      path.join(rootDir, "src", "a.ts"),
      "export const a = 1;\n",
      "utf8",
    );
    await writeFile(
      path.join(rootDir, "src", "b.ts"),
      "export const b = 2;\n",
      "utf8",
    );

    const first = await refreshRepoMapState(rootDir);
    const firstA = first.state.files["src/a.ts"];
    const firstB = first.state.files["src/b.ts"];

    await new Promise((resolve) => setTimeout(resolve, 20));
    await writeFile(
      path.join(rootDir, "src", "a.ts"),
      "export const a = 3;\n",
      "utf8",
    );

    const second = await refreshRepoMapState(rootDir);

    expect(second.indexedPaths).toEqual(["src/a.ts"]);
    expect(second.reusedPaths).toEqual(["src/b.ts"]);
    expect(second.state.files["src/a.ts"].indexedAt).not.toBe(firstA.indexedAt);
    expect(second.state.files["src/b.ts"].indexedAt).toBe(firstB.indexedAt);
  });

  test("ranking reflects structural importance and recent activity signals", async () => {
    const rootDir = await createTempProject("repo-map-ranking-");
    await mkdir(path.join(rootDir, "src"), { recursive: true });
    await writeFile(
      path.join(rootDir, "src", "core.ts"),
      "export function core() {}\n",
      "utf8",
    );
    await writeFile(
      path.join(rootDir, "src", "feature-a.ts"),
      "import { core } from './core';\nexport const featureA = core;\n",
      "utf8",
    );
    await writeFile(
      path.join(rootDir, "src", "feature-b.ts"),
      "import { core } from './core';\nexport const featureB = core;\n",
      "utf8",
    );

    await refreshRepoMapState(rootDir);
    let snapshot = await getRepoMapDebugSnapshot(rootDir, { prompt: "" });

    expect(snapshot.ranked[0]?.path).toBe("src/core.ts");

    recordRepoMapSignal(rootDir, "edit", "src/feature-a.ts");
    snapshot = await getRepoMapDebugSnapshot(rootDir, {
      prompt: "work on feature-a.ts",
    });

    expect(snapshot.ranked[0]?.path).toBe("src/feature-a.ts");
    expect(snapshot.rendered).toContain("recently-edited");
  });

  test("prompt integration includes a repo-map block and recent edits affect subsequent ranking", async () => {
    const rootDir = await createTempProject("repo-map-prompt-");
    await mkdir(path.join(rootDir, "src"), { recursive: true });
    await writeFile(
      path.join(rootDir, "src", "brain.ts"),
      "export function brain() {}\n",
      "utf8",
    );
    await writeFile(
      path.join(rootDir, "src", "workflow.ts"),
      "import { brain } from './brain';\nexport const workflow = brain;\n",
      "utf8",
    );
    saveOmniMode(rootDir, true);
    const handlers = new Map<string, (...args: unknown[]) => unknown>();

    omniCoreExtension({
      registerMessageRenderer() {
        return undefined;
      },
      registerCommand() {},
      registerShortcut() {},
      sendMessage() {},
      on(event: string, handler: (...args: unknown[]) => unknown) {
        handlers.set(event, handler);
      },
    } as never);

    await handlers.get("session_start")?.(
      { type: "session_start" },
      {
        cwd: rootDir,
        ui: {
          setTitle() {},
          setTheme() {},
          setHeader() {},
          notify() {},
          setStatus() {},
        },
      },
    );

    let beforeStart = await handlers.get("before_agent_start")?.(
      {
        type: "before_agent_start",
        prompt: "inspect workflow.ts",
        systemPrompt: "BASE",
      },
      { cwd: rootDir },
    );

    expect(beforeStart.systemPrompt).toContain("## Repo Map");
    expect(beforeStart.systemPrompt).toContain("src/workflow.ts");

    recordRepoMapSignal(rootDir, "edit", "src/workflow.ts");
    beforeStart = await handlers.get("before_agent_start")?.(
      {
        type: "before_agent_start",
        prompt: "update workflow.ts",
        systemPrompt: "BASE",
      },
      { cwd: rootDir },
    );

    const repoMapSection =
      beforeStart.systemPrompt.split("## Repo Map")[1] ?? "";
    expect(repoMapSection).toContain("src/workflow.ts");
    expect(repoMapSection.indexOf("src/workflow.ts")).toBeLessThan(
      repoMapSection.indexOf("src/brain.ts"),
    );
  });

  test("normal mode also includes a compact repo-map block", async () => {
    const rootDir = await createTempProject("repo-map-normal-mode-");
    await mkdir(path.join(rootDir, "src"), { recursive: true });
    await writeFile(
      path.join(rootDir, "src", "brain.ts"),
      "export function brain() {}\n",
      "utf8",
    );
    await writeFile(
      path.join(rootDir, "src", "workflow.ts"),
      "import { brain } from './brain';\nexport const workflow = brain;\n",
      "utf8",
    );
    const handlers = new Map<string, (...args: unknown[]) => unknown>();

    omniCoreExtension({
      registerMessageRenderer() {
        return undefined;
      },
      registerCommand() {},
      registerShortcut() {},
      sendMessage() {},
      on(event: string, handler: (...args: unknown[]) => unknown) {
        handlers.set(event, handler);
      },
    } as never);

    await handlers.get("session_start")?.(
      { type: "session_start" },
      {
        cwd: rootDir,
        ui: {
          setTitle() {},
          setTheme() {},
          setHeader() {},
          notify() {},
          setStatus() {},
        },
      },
    );

    const beforeStart = await handlers.get("before_agent_start")?.(
      {
        type: "before_agent_start",
        prompt: "inspect workflow.ts",
        systemPrompt: "BASE",
      },
      { cwd: rootDir },
    );

    expect(beforeStart.systemPrompt).toContain("BASE");
    expect(beforeStart.systemPrompt).toContain("## Repo Map");
    expect(beforeStart.systemPrompt).toContain("src/workflow.ts");
    expect(beforeStart.systemPrompt).not.toContain("## Current Omni Workflow Files");
  });

  test("parser/index fallback on one file does not collapse repo-map output", async () => {
    const rootDir = await createTempProject("repo-map-fallback-");
    await mkdir(path.join(rootDir, "src"), { recursive: true });
    await writeFile(
      path.join(rootDir, "src", "good.ts"),
      "export function good() {}\n",
      "utf8",
    );
    await writeFile(
      path.join(rootDir, "src", "weird.ts"),
      "\u0000\u0001binary-ish",
      "utf8",
    );

    const result = await refreshRepoMapState(rootDir);
    const snapshot = await getRepoMapDebugSnapshot(rootDir, {
      prompt: "good.ts",
    });

    expect(result.state.files["src/weird.ts"]?.parserStatus).toBe(
      "binary-fallback",
    );
    expect(snapshot.rendered).toContain("src/good.ts");
  });
});
