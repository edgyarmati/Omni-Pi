import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, test } from "vitest";

import { createOmniCommands } from "../src/commands.js";
import omniCoreExtension from "../extensions/omni-core/index.js";
import omniSkillsExtension from "../extensions/omni-skills/index.js";
import omniStatusExtension from "../extensions/omni-status/index.js";
import { initializeOmniProject } from "../src/workflow.js";

async function createTempProject(prefix: string): Promise<string> {
  return mkdtemp(path.join(os.tmpdir(), prefix));
}

describe("Omni commands", () => {
  test("createOmniCommands exposes the expected command set", () => {
    const names = createOmniCommands().map((command) => command.name);

    expect(names).toEqual([
      "omni-init",
      "omni-plan",
      "omni-work",
      "omni-status",
      "omni-sync",
      "omni-skills",
      "omni-explain"
    ]);
  });

  test("omniCoreExtension registers the workflow commands", () => {
    const registrations: string[] = [];

    omniCoreExtension({
      registerMessageRenderer() {
        return undefined;
      },
      registerCommand(name) {
        registrations.push(name);
      }
    });

    expect(registrations).toEqual(["omni-init", "omni-plan", "omni-work", "omni-sync"]);
  });

  test("omniStatusExtension registers the status commands", () => {
    const registrations: string[] = [];

    omniStatusExtension({
      registerCommand(name) {
        registrations.push(name);
      }
    });

    expect(registrations).toEqual(["omni-status", "omni-explain"]);
  });

  test("omniSkillsExtension registers the skills command", () => {
    const registrations: string[] = [];

    omniSkillsExtension({
      registerCommand(name) {
        registrations.push(name);
      }
    } as never);

    expect(registrations).toEqual(["omni-skills"]);
  });

  test("/omni-skills renders the current skill registry", async () => {
    const rootDir = await createTempProject("omni-cmd-skills-");
    await initializeOmniProject(rootDir);
    const command = createOmniCommands().find((item) => item.name === "omni-skills");

    const output = await command?.execute({ cwd: rootDir });

    expect(output).toContain("Installed:");
    expect(output).toContain("find-skills");
    expect(output).toContain("Recommended:");
  });

  test("/omni-sync updates session summary", async () => {
    const rootDir = await createTempProject("omni-cmd-sync-");
    await initializeOmniProject(rootDir);
    const command = createOmniCommands().find((item) => item.name === "omni-sync");

    const output = await command?.execute({ cwd: rootDir, args: ["Captured", "progress"] });
    const sessionSummary = await readFile(path.join(rootDir, ".omni", "SESSION-SUMMARY.md"), "utf8");

    expect(output).toContain("Synced Omni-Pi memory");
    expect(sessionSummary).toContain("Captured progress");
  });
});
