import { createOmniCommands } from "../../src/commands.js";
import { registerCommands, type ExtensionApi } from "../../src/pi.js";

export default function omniStatusExtension(api: ExtensionApi): void {
  const commands = createOmniCommands().filter((command) =>
    ["/omni-status", "/omni-explain"].includes(command.name)
  );
  registerCommands(api, commands);
}
