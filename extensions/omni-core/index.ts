import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

import { createOmniCommands } from "../../src/commands.js";
import {
  registerOmniMessageRenderer,
  registerPiCommands,
} from "../../src/pi.js";

export default function omniCoreExtension(api: ExtensionAPI): void {
  registerOmniMessageRenderer(api);
  const commands = createOmniCommands().filter((command) =>
    [
      "omni-init",
      "omni-plan",
      "omni-work",
      "omni-sync",
      "omni-model",
      "omni-commit",
    ].includes(command.name),
  );
  registerPiCommands(api, commands);
}
