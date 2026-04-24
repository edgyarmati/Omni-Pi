import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, test } from "vitest";
import omniCoreExtension from "../extensions/omni-core/index.js";
import omniSkillsExtension from "../extensions/omni-skills/index.js";
import omniStatusExtension from "../extensions/omni-status/index.js";
import { createOmniCommands } from "../src/commands.js";
import { rewriteCommandWithRtk } from "../src/rtk.js";
import { readOmniMode } from "../src/theme.js";

describe("Omni command surface", () => {
  test("createOmniCommands exposes Omni-Pi commands", () => {
    expect(createOmniCommands().map((command) => command.name)).toEqual([
      "omni-mode",
      "omni-rtk",
    ]);
  });

  test("omniCoreExtension registers the Omni-Pi commands", () => {
    let rendererRegistrations = 0;
    const commands: string[] = [];
    const events: string[] = [];

    omniCoreExtension({
      registerMessageRenderer() {
        rendererRegistrations += 1;
      },
      registerCommand(name: string) {
        commands.push(name);
      },
      registerShortcut() {},
      on(event: string) {
        events.push(event);
      },
    } as never);

    expect(rendererRegistrations).toBeGreaterThan(0);
    expect(commands).toEqual(["omni-mode", "omni-rtk", "theme", "update"]);
    expect(events).toContain("session_start");
    expect(events).toContain("before_agent_start");
    expect(events).toContain("tool_call");
    expect(events).toContain("turn_end");
  });

  test("status and skills extensions register no commands", () => {
    const statusRegistrations: string[] = [];
    const skillsRegistrations: string[] = [];

    omniStatusExtension({
      registerCommand(name: string) {
        statusRegistrations.push(name);
      },
    } as never);
    omniSkillsExtension({
      registerCommand(name: string) {
        skillsRegistrations.push(name);
      },
    } as never);

    expect(statusRegistrations).toEqual([]);
    expect(skillsRegistrations).toEqual([]);
  });

  test("omni-mode command toggles the persisted mode flag", async () => {
    const command = createOmniCommands()[0];
    const cwd = await mkdtemp(path.join(os.tmpdir(), "omni-mode-command-"));
    const statuses: string[] = [];

    const first = await command.execute({
      cwd,
      runtime: {
        pi: {} as never,
        ctx: {
          ui: {
            setStatus(_key: string, value: string) {
              statuses.push(value);
            },
            setWidget() {},
          },
        } as never,
      },
    });

    expect(typeof first).toBe("string");
    expect(readOmniMode(cwd)).toBe(true);

    await command.execute({
      cwd,
      runtime: {
        pi: {} as never,
        ctx: {
          ui: {
            setStatus(_key: string, value: string) {
              statuses.push(value);
            },
            setWidget() {},
          },
        } as never,
      },
    });

    expect(readOmniMode(cwd)).toBe(false);
    expect(statuses).toHaveLength(2);
  });

  test("rewriteCommandWithRtk returns rewritten bash command when supported", async () => {
    await expect(
      rewriteCommandWithRtk("git status", process.cwd(), async () => ({
        stdout: "rtk git status\n",
        stderr: "",
        code: 0,
      })),
    ).resolves.toBe("rtk git status");

    await expect(
      rewriteCommandWithRtk("echo hi", process.cwd(), async () => ({
        stdout: "",
        stderr: "unsupported",
        code: 1,
      })),
    ).resolves.toBeNull();
  });
});
