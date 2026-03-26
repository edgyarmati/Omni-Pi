import { describe, expect, test } from "vitest";
import omniCoreExtension from "../extensions/omni-core/index.js";
import omniProvidersExtension from "../extensions/omni-providers/index.js";
import omniSkillsExtension from "../extensions/omni-skills/index.js";
import omniStatusExtension from "../extensions/omni-status/index.js";
import { createOmniCommands } from "../src/commands.js";

describe("Omni command surface", () => {
  test("createOmniCommands exposes no slash commands in the simplified flow", () => {
    expect(createOmniCommands()).toEqual([]);
  });

  test("omniCoreExtension only registers the message renderer", () => {
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
      on(event: string) {
        events.push(event);
      },
    } as never);

    expect(rendererRegistrations).toBeGreaterThan(0);
    expect(commands).toEqual(["model-setup", "theme"]);
    expect(events).toContain("session_start");
    expect(events).toContain("before_agent_start");
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

  test("omniProvidersExtension does not register extra providers beyond Pi defaults", async () => {
    const registrations: string[] = [];

    await omniProvidersExtension({
      registerProvider(name: string) {
        registrations.push(name);
      },
    } as never);

    expect(registrations).toEqual([]);
  });
});
