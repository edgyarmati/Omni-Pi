import { createOmniCommands } from "../../src/commands.js";
import { registerCommands, type ExtensionApi } from "../../src/pi.js";

export default function omniCoreExtension(api: ExtensionApi): void {
  const commands = createOmniCommands().filter((command) =>
    ["/omni-init", "/omni-plan", "/omni-work", "/omni-sync"].includes(command.name)
  );
  registerCommands(api, commands);
}
