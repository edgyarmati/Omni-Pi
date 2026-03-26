import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

import { createOmniCommands } from "../../src/commands.js";
import { registerPiCommands } from "../../src/pi.js";

export default function omniStatusExtension(api: ExtensionAPI): void {
  const commands = createOmniCommands().filter((command) =>
    ["omni-status", "omni-explain", "omni-doctor"].includes(command.name),
  );
  registerPiCommands(api, commands);
}
