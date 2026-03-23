import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

import { createOmniCommands } from "../../src/commands.js";
import { registerPiCommands } from "../../src/pi.js";

export default function omniSkillsExtension(api: ExtensionAPI): void {
  const commands = createOmniCommands().filter((command) => ["omni-skills"].includes(command.name));
  registerPiCommands(api, commands);
}
